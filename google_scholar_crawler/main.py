"""Fetch Google Scholar author metrics through SerpApi."""

import json
import logging
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

RESULTS_DIR = Path(__file__).resolve().parent / "results"
SERPAPI_ENDPOINT = "https://serpapi.com/search.json"
PROFILE_ID_RE = re.compile(r"^[A-Za-z0-9_-]+$")


def safe_int(value, default=None):
    """Convert API numeric values while tolerating null and empty strings."""
    if value is None or value == "":
        return default

    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def request_serpapi(
    author_id: str,
    api_key: str,
    attempts: int = 3,
) -> dict:
    query = urlencode(
        {
            "engine": "google_scholar_author",
            "author_id": author_id,
            "hl": "en",
            "num": 20,
            "api_key": api_key,
        }
    )

    request = Request(
        f"{SERPAPI_ENDPOINT}?{query}",
        headers={
            "Accept": "application/json",
            "User-Agent": "citation-badge/1.0",
        },
    )

    for attempt in range(1, attempts + 1):
        try:
            logger.info(
                "Requesting Scholar data from SerpApi (%d/%d)",
                attempt,
                attempts,
            )

            with urlopen(request, timeout=60) as response:
                data = json.load(response)

            if data.get("error"):
                raise RuntimeError(
                    f"SerpApi error: {data['error']}"
                )

            status = data.get(
                "search_metadata",
                {},
            ).get("status")

            if status == "Error":
                raise RuntimeError(
                    "SerpApi search failed"
                )

            return data

        except HTTPError as error:
            body = error.read().decode(
                "utf-8",
                errors="replace",
            )

            try:
                message = json.loads(body).get(
                    "error",
                    body,
                )
            except json.JSONDecodeError:
                message = body

            last_error = RuntimeError(
                f"SerpApi HTTP {error.code}: "
                f"{message[:300]}"
            )

            retryable = (
                error.code == 429
                or 500 <= error.code < 600
            )

        except (URLError, TimeoutError) as error:
            last_error = RuntimeError(
                f"SerpApi network error: {error}"
            )
            retryable = True

        if not retryable or attempt == attempts:
            raise last_error

        delay = 10 * attempt

        logger.warning(
            "Request failed; retrying in %d seconds: %s",
            delay,
            last_error,
        )

        time.sleep(delay)

    raise RuntimeError(
        "SerpApi returned no result"
    )


def metric_values(
    table: list,
    position: int,
    expected_key: str,
) -> tuple[int, int | None]:
    try:
        row = table[position]

        # 英文通常會回傳 citations、h_index、i10_index。
        # 如果欄位名稱因語言不同而改變，就讀取該列的第一組資料。
        values = (
            row.get(expected_key)
            or next(iter(row.values()))
        )

        total = safe_int(
            values.get("all"),
            0,
        )

        since = next(
            (
                safe_int(value)
                for key, value in values.items()
                if key != "all"
            ),
            None,
        )

        return total, since

    except (
        IndexError,
        KeyError,
        StopIteration,
        TypeError,
        ValueError,
    ) as error:
        raise RuntimeError(
            f"Invalid Scholar metric "
            f"at position {position}"
        ) from error


def parse_author(data: dict) -> dict:
    try:
        author = data["author"]
        table = data["cited_by"]["table"]

    except (KeyError, TypeError) as error:
        raise RuntimeError(
            "SerpApi response is missing "
            "author metrics"
        ) from error

    citedby, citedby5y = metric_values(
        table,
        0,
        "citations",
    )

    hindex, hindex5y = metric_values(
        table,
        1,
        "h_index",
    )

    i10index, i10index5y = metric_values(
        table,
        2,
        "i10_index",
    )

    publications = {}

    for article in data.get(
        "articles",
        [],
    ):
        citation_id = article.get(
            "citation_id"
        )

        if not citation_id:
            continue

        # cited_by 或 value 都可能是 null。
        cited_by = (
            article.get("cited_by")
            or {}
        )

        publications[citation_id] = {
            "author_pub_id": citation_id,
            "bib": {
                "title": article.get(
                    "title",
                    "",
                ),
                "author": article.get(
                    "authors",
                    "",
                ),
                "pub_year": article.get(
                    "year",
                    "",
                ),
                "citation": article.get(
                    "publication",
                    "",
                ),
            },
            "num_citations": safe_int(
                cited_by.get("value"),
                0,
            ),
        }

    return {
        "name": author.get(
            "name",
            "",
        ),
        "citedby": citedby,
        "citedby5y": citedby5y,
        "hindex": hindex,
        "hindex5y": hindex5y,
        "i10index": i10index,
        "i10index5y": i10index5y,
        "publications": publications,
        "updated": datetime.now(
            timezone.utc
        ).isoformat(),
    }


def write_json_atomic(
    path: Path,
    data: dict,
) -> None:
    path.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    temporary_path = path.with_suffix(
        path.suffix + ".tmp"
    )

    temporary_path.write_text(
        json.dumps(
            data,
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    temporary_path.replace(path)


def main() -> int:
    author_id = os.environ.get(
        "GOOGLE_SCHOLAR_ID",
        "",
    ).strip()

    api_key = os.environ.get(
        "SERPAPI_KEY",
        "",
    ).strip()

    if not author_id:
        logger.error(
            "GOOGLE_SCHOLAR_ID secret is missing"
        )
        return 2

    if not PROFILE_ID_RE.fullmatch(
        author_id
    ):
        logger.error(
            "GOOGLE_SCHOLAR_ID has "
            "an invalid format"
        )
        return 2

    if not api_key:
        logger.error(
            "SERPAPI_KEY secret is missing"
        )
        return 2

    try:
        response = request_serpapi(
            author_id,
            api_key,
        )

        author = parse_author(response)

    except Exception as error:
        logger.error(
            "Failed to fetch Scholar data: %s",
            error,
        )
        return 1

    write_json_atomic(
        RESULTS_DIR / "gs_data.json",
        author,
    )

    write_json_atomic(
        RESULTS_DIR
        / "gs_data_shieldsio.json",
        {
            "schemaVersion": 1,
            "label": "citations",
            "message": str(
                author["citedby"]
            ),
        },
    )

    logger.info(
        "Fetched %s: %d citations",
        author["name"],
        author["citedby"],
    )

    return 0


if __name__ == "__main__":
    sys.exit(main())

"""Fetch Google Scholar profile metrics with Playwright."""

import json
import logging
import os
import random
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode

from playwright.sync_api import Page, TimeoutError as PlaywrightTimeoutError, sync_playwright


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

RESULTS_DIR = Path(__file__).resolve().parent / "results"
PROFILE_ID_RE = re.compile(r"^[A-Za-z0-9_-]+$")


class ScholarBlockedError(RuntimeError):
    """Raised when Google Scholar returns a challenge or blocking page."""


def parse_number(value: str) -> int:
    digits = re.sub(r"[^0-9]", "", value)
    if not digits:
        raise ValueError(f"Could not parse number from {value!r}")
    return int(digits)


def detect_block(page: Page) -> None:
    body = page.locator("body").inner_text(timeout=5_000).lower()
    blocked_markers = (
        "unusual traffic",
        "not a robot",
        "please show you're not a robot",
        "automated queries",
    )
    if "/sorry/" in page.url or any(marker in body for marker in blocked_markers):
        raise ScholarBlockedError("Google Scholar returned a CAPTCHA/block page")


def scrape_once(page: Page, profile_url: str) -> dict:
    response = page.goto(profile_url, wait_until="domcontentloaded", timeout=45_000)
    if response and response.status >= 400:
        raise RuntimeError(f"Google Scholar returned HTTP {response.status}")

    detect_block(page)
    table = page.locator("#gsc_rsb_st")
    table.wait_for(state="visible", timeout=20_000)

    metrics: dict[str, list[int]] = {}
    for row in table.locator("tbody tr").all():
        cells = [text.strip() for text in row.locator("td").all_inner_texts()]
        if len(cells) >= 2:
            metrics[cells[0].lower()] = [parse_number(value) for value in cells[1:]]

    required = ("citations", "h-index", "i10-index")
    missing = [key for key in required if key not in metrics]
    if missing:
        raise RuntimeError(f"Scholar metrics missing: {', '.join(missing)}")

    name = page.locator("#gsc_prf_in").inner_text(timeout=10_000).strip()
    return {
        "name": name,
        "citedby": metrics["citations"][0],
        "citedby5y": metrics["citations"][1] if len(metrics["citations"]) > 1 else None,
        "hindex": metrics["h-index"][0],
        "hindex5y": metrics["h-index"][1] if len(metrics["h-index"]) > 1 else None,
        "i10index": metrics["i10-index"][0],
        "i10index5y": metrics["i10-index"][1] if len(metrics["i10-index"]) > 1 else None,
        # Keep the old JSON shape. Avoiding every publication request greatly
        # reduces Scholar rate limiting on GitHub-hosted runners.
        "publications": {},
        "updated": datetime.now(timezone.utc).isoformat(),
    }


def fetch_profile(profile_url: str, attempts: int = 2) -> dict:
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            headless=True,
            args=["--disable-dev-shm-usage", "--no-sandbox"],
        )
        try:
            for attempt in range(1, attempts + 1):
                context = browser.new_context(
                    locale="en-US",
                    timezone_id="UTC",
                    viewport={"width": 1280, "height": 900},
                )
                page = context.new_page()
                try:
                    logger.info("Fetching Scholar profile (attempt %d/%d)", attempt, attempts)
                    return scrape_once(page, profile_url)
                except (PlaywrightTimeoutError, ScholarBlockedError, RuntimeError) as exc:
                    logger.warning("Attempt %d failed: %s", attempt, exc)
                    try:
                        page.screenshot(
                            path=RESULTS_DIR / f"scholar-failure-{attempt}.png",
                            full_page=True,
                        )
                    except Exception:
                        logger.debug("Could not save failure screenshot", exc_info=True)

                    if attempt == attempts:
                        raise
                    delay = random.uniform(25, 45)
                    logger.info("Retrying in %.0f seconds", delay)
                    time.sleep(delay)
                finally:
                    context.close()
        finally:
            browser.close()

    raise RuntimeError("No Scholar result returned")


def write_json_atomic(path: Path, data: dict) -> None:
    temp_path = path.with_suffix(path.suffix + ".tmp")
    temp_path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temp_path.replace(path)


def main() -> int:
    author_id = os.environ.get("GOOGLE_SCHOLAR_ID", "").strip()
    if not author_id or not PROFILE_ID_RE.fullmatch(author_id):
        logger.error("GOOGLE_SCHOLAR_ID is missing or invalid")
        return 2

    profile_url = "https://scholar.google.com/citations?" + urlencode(
        {"user": author_id, "hl": "en"}
    )

    try:
        author = fetch_profile(profile_url)
    except Exception as exc:
        logger.error("Failed to fetch Scholar data: %s", exc)
        return 1

    write_json_atomic(RESULTS_DIR / "gs_data.json", author)
    write_json_atomic(
        RESULTS_DIR / "gs_data_shieldsio.json",
        {
            "schemaVersion": 1,
            "label": "citations",
            "message": str(author["citedby"]),
        },
    )
    logger.info("Fetched %s: %s citations", author["name"], author["citedby"])
    return 0


if __name__ == "__main__":
    sys.exit(main())

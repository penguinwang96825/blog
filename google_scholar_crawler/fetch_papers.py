"""Build assets/data/papers.json for the paper timeline page.

Parses publications.md, then enriches each paper with abstract / date
(arXiv, or Semantic Scholar for papers without an arXiv id) and citation
count (Google Scholar, as fetched by main.py into the google-scholar-stats
branch). Uses only the standard library.
"""

import json
import re
import time
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
SOURCE = Path(__file__).resolve().parent / "publications.md"
OUTPUT = ROOT / "assets" / "data" / "papers.json"

ARXIV_API = "http://export.arxiv.org/api/query"
S2_API = "https://api.semanticscholar.org/graph/v1/paper"
S2_FIELDS = "title,publicationDate,abstract"
# Written every two days by the get-citation-data workflow (main.py, Google Scholar via SerpApi)
SCHOLAR_DATA = "https://raw.githubusercontent.com/penguinwang96825/blog/google-scholar-stats/gs_data.json"
ATOM = {"a": "http://www.w3.org/2005/Atom"}

# Preprints are a plain list in publications.md (no thumbnail), so map them here by arXiv id.
PREPRINT_IMAGES = {
    "2309.11895": "/images/publications/preprint_2023_confit.png",
    "2603.10619": "/images/publications/preprint_2026_topic.png",
    "2606.04612": "/images/publications/preprint_2026_hybrid.png",
    "2608.04939": "/images/publications/preprint_2026_drivelology_plus.png",
    "2610.03632": "/images/publications/preprint_2026_web.png",
    "2610.17113": "/images/publications/preprint_2026_calon.png",
}


def get(url, accept="application/json", data=None, retries=5):
    for attempt in range(retries):
        try:
            headers = {"Accept": accept, "User-Agent": "paper-timeline/1.0"}
            if data is not None:
                headers["Content-Type"] = "application/json"
            req = Request(url, data=data, headers=headers)
            with urlopen(req, timeout=60) as resp:
                return resp.read()
        except HTTPError as e:
            if e.code == 404:
                return None
            if e.code == 429 and attempt < retries - 1:
                time.sleep(10 * (attempt + 1))
                continue
            raise
    return None


def split_authors_title(text):
    """'A, B E. C. Title. *Venue*. 2026' -> authors, title.

    Authors end at the first '. ' not preceded by a single-letter initial.
    """
    for m in re.finditer(r"\. ", text):
        prev = text[: m.start()].split()[-1]
        if len(prev) > 1:
            authors = text[: m.start()]
            rest = text[m.end():]
            title = re.split(r"\. \*|\. \d{4}", rest)[0]
            return authors, title.rstrip(".")
    raise ValueError(f"Cannot parse: {text}")


def parse_entry(line, links_line, badge=None, image=None):
    line = line.strip().lstrip("- ").replace("<br />", "").strip()
    authors, title = split_authors_title(line)
    venue = re.search(r"\*(.+?)\*", line)
    year = re.findall(r"(\d{4})\s*$", line)
    links = {k.lower(): v for k, v in re.findall(r"\[\[(\w+)\]\]\((\S+?)\)", links_line)}
    arxiv = re.search(r"arxiv\.org/(?:pdf|abs)/(\d{4}\.\d{4,5})", links.get("pdf", ""))
    return {
        "title": title,
        "authors": [a.strip() for a in authors.replace("`", "").split(",")],
        "venue": venue.group(1) if venue else None,
        "badge": badge,
        "year": int(year[0]) if year else None,
        "status": "published" if venue else "preprint",
        "image": image or PREPRINT_IMAGES.get(arxiv.group(1) if arxiv else None),
        "links": links,
        "arxiv_id": arxiv.group(1) if arxiv else None,
    }


def parse_publications():
    text = SOURCE.read_text(encoding="utf-8")
    papers = []

    box = re.compile(
        r"<div class=\"badge\">(.+?)</div><img src='(.+?)'.*?markdown=\"1\">\s*\n(- .+?)\n(.*?)\n</div>",
        re.S,
    )
    for badge, image, line, links in box.findall(text):
        papers.append(parse_entry(line, links, badge, image))

    preprint = text.split("# 📚 Preprint", 1)[1].split("\n# ", 1)[0]
    for block in re.split(r"\n\s*\n", preprint.strip()):
        lines = block.strip().splitlines()
        if lines and lines[0].startswith("- "):
            papers.append(parse_entry(lines[0], " ".join(lines[1:])))
    return papers


def fetch_arxiv(ids):
    url = f"{ARXIV_API}?{urlencode({'id_list': ','.join(ids), 'max_results': len(ids)})}"
    root = ET.fromstring(get(url, accept="application/atom+xml"))
    out = {}
    for entry in root.findall("a:entry", ATOM):
        aid = re.search(r"abs/(\d{4}\.\d{4,5})", entry.find("a:id", ATOM).text).group(1)
        out[aid] = {
            "abstract": " ".join(entry.find("a:summary", ATOM).text.split()),
            "date": entry.find("a:published", ATOM).text[:10],
        }
    return out


def fetch_s2_batch(ids):
    body = json.dumps({"ids": [f"arXiv:{i}" for i in ids]}).encode()
    results = json.loads(get(f"{S2_API}/batch?fields={S2_FIELDS}", data=body))
    return {i: r or {} for i, r in zip(ids, results)}


def fetch_s2_match(title):
    time.sleep(1.1)  # unauthenticated rate limit
    raw = get(f"{S2_API}/search/match?query={quote(title)}&fields={S2_FIELDS}")
    return json.loads(raw)["data"][0] if raw else {}


def title_key(title):
    """Titles compared without case, spacing or punctuation."""
    return re.sub(r"[^a-z0-9]", "", title.lower())


def fetch_scholar():
    data = json.loads(get(SCHOLAR_DATA))
    return {title_key(p["bib"]["title"]): p["num_citations"] for p in data["publications"].values()}


def main():
    papers = parse_publications()
    ids = [p["arxiv_id"] for p in papers if p["arxiv_id"]]
    arxiv = fetch_arxiv(ids)
    s2_by_arxiv = fetch_s2_batch(ids)
    scholar = fetch_scholar()

    for p in papers:
        s2 = s2_by_arxiv[p["arxiv_id"]] if p["arxiv_id"] else fetch_s2_match(p["title"])
        ax = arxiv.get(p["arxiv_id"], {})
        p["abstract"] = ax.get("abstract") or s2.get("abstract")
        p["date"] = ax.get("date") or s2.get("publicationDate") or f"{p['year']}-01-01"
        p["citations"] = scholar.get(title_key(p["title"]), 0)
        if title_key(p["title"]) not in scholar:
            print(f"  not on the Google Scholar profile: {p['title'][:60]}")
        print(f"{p['date']}  {p['citations']:>4}  {p['status']:<9}  {p['title'][:60]}")

    papers.sort(key=lambda p: p["date"])
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(papers, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(papers)} papers to {OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()

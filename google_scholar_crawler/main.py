"""
Google Scholar Crawler

This script fetches author information from Google Scholar using a provided ID.
It saves the complete author data as JSON and creates a shields.io compatible
citation badge file.
"""

import os
import sys
import json
import logging
from datetime import datetime

import jsonpickle
from scholarly import scholarly, ProxyGenerator

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Validate environment variable
author_id = os.environ.get('GOOGLE_SCHOLAR_ID')
if not author_id:
    logger.error("GOOGLE_SCHOLAR_ID environment variable not set")
    sys.exit(1)

# Setup proxy
pg = ProxyGenerator()
try:
    pg.FreeProxies()  # Use free rotating proxies
    scholarly.use_proxy(pg)
    logger.info("Proxy setup successful")
except Exception as e:
    logger.warning(f"Failed to setup proxy: {e}. Continuing without proxy.")

try:
    author = scholarly.search_author_id(author_id)
    scholarly.fill(author, sections=['basics', 'indices', 'counts', 'publications'])
    name = author['name']
    author['updated'] = str(datetime.now())
    author['publications'] = {v['author_pub_id']:v for v in author['publications']}
    logger.info(f"Successfully fetched data for {name}")
except Exception as e:
    logger.error(f"Failed to fetch author data: {e}")
    sys.exit(1)

print(json.dumps(author, indent=2))
os.makedirs('results', exist_ok=True)
with open(f'results/gs_data.json', 'w') as outfile:
    json.dump(author, outfile, ensure_ascii=False)

shieldio_data = {
  "schemaVersion": 1,
  "label": "citations",
  "message": f"{author['citedby']}",
}
with open(f'results/gs_data_shieldsio.json', 'w') as outfile:
    json.dump(shieldio_data, outfile, ensure_ascii=False)
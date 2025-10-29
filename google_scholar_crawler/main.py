"""
Google Scholar Crawler

This script fetches author information from Google Scholar using a provided ID.
It saves the complete author data as JSON and creates a shields.io compatible
citation badge file.
"""

import os
import json
from datetime import datetime

import jsonpickle
from scholarly import scholarly


def main():
    # Fetch author data using the ID from environment variables
    author: dict = scholarly.search_author_id(os.environ['GOOGLE_SCHOLAR_ID'])
    
    # Fill in additional author details
    scholarly.fill(author, sections=['basics', 'indices', 'counts', 'publications'])
    
    name = author['name']
    
    # Add timestamp for when the data was retrieved
    author['updated'] = str(datetime.now())
    
    # Convert publications list to a dictionary indexed by publication ID for easier access
    author['publications'] = {v['author_pub_id']: v for v in author['publications']}
    
    # Print the author data to console
    print(json.dumps(author, indent=2))
    
    # Ensure the results directory exists
    os.makedirs('results', exist_ok=True)
    
    # Save complete author data to file
    with open(f'results/gs_data.json', 'w') as outfile:
        json.dump(author, outfile, ensure_ascii=False)

    # Create shields.io compatible JSON for citation badge
    shieldio_data = {
        "schemaVersion": 1,
        "label": "citations",
        "message": f"{author['citedby']}",
    }
    
    # Save shields.io data to file
    with open(f'results/gs_data_shieldsio.json', 'w') as outfile:
        json.dump(shieldio_data, outfile, ensure_ascii=False)


if __name__ == "__main__":
    main()
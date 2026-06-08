---
permalink: /
title: ""
excerpt: ""
author_profile: true
redirect_from: 
  - /about/
  - /about.html
  - /education/
---

{% if site.google_scholar_stats_use_cdn %}
{% assign gsDataBaseUrl = "https://cdn.jsdelivr.net/gh/" | append: site.repository | append: "@" %}
{% else %}
{% assign gsDataBaseUrl = "https://raw.githubusercontent.com/" | append: site.repository | append: "/" %}
{% endif %}
{% assign url = gsDataBaseUrl | append: "google-scholar-stats/gs_data_shieldsio.json" %}

<span class='anchor' id='about-me'></span>

# About Me

I received my MSc in Computer Science with Speech and Language Processing from the University of Sheffield, where I was advised by Prof. Chenghua Lin (now at the University of Manchester). I earned my BSc in Applied Mathematics from National Chung Hsing University, Taiwan. All publications are available on <a href='https://scholar.google.com/citations?user=EPrTek0AAAAJ'><img src="https://img.shields.io/endpoint?url={{ url | url_encode }}&logo=Google%20Scholar&labelColor=f6f6f6&color=9cf&style=flat&label=citations"></a>.

My research interest includes: 
- Natural Language Processing
- Audio and Speech Processing

Work in progress:
- Psychological LLMs
- Multi-modality
- Knowledge/Reasoning Boundary
- Named Entity Recognition
- Automatic Speech Recognition

# 🎓 Education

- *2020.09 - 2021.09*, MSc in Computer Science with Speech and Language Processing, University of Sheffield, UK.
- *2014.09 - 2018.06*, BSc in Applied Mathematics, National Chung Hsing University, Taiwan.
<!-- - *2020.09 - 2021.09*, <a href="https://sheffield.ac.uk/"><img class="svg" src="/images/UoS_logo.png" width="23pt"></a> MSc in Computer Science with Speech and Language Processing, University of Sheffield, UK. -->
<!-- - *2014.09 - 2018.06*, <a href="https://www.nchu.edu.tw"><img class="svg" src="/images/NCHU_logo.png" width="20pt"></a> BSc in Applied Mathematics, National Chung Hsing University, Taiwan. -->

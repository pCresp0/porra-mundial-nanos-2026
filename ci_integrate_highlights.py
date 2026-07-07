#!/usr/bin/env python3
"""CI helper: integra highlights.json en data.json.

Uso: python ci_integrate_highlights.py
"""
import json
import os
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
highlights_path = os.path.join(BASE, "data", "highlights.json")
data_path = os.path.join(BASE, "data.json")

if not os.path.isfile(highlights_path):
    print("Sin highlights.json")
    sys.exit(0)

with open(highlights_path, encoding="utf-8") as f:
    highlights = json.load(f)

with open(data_path, encoding="utf-8") as f:
    dj = json.load(f)

count = 0
for m in dj.get("matches", []):
    vid = highlights.get(m.get("name", ""))
    if vid and m.get("highlights_video_id") != vid:
        m["highlights_video_id"] = vid
        count += 1

if count:
    with open(data_path, "w", encoding="utf-8") as f:
        json.dump(dj, f, ensure_ascii=False, separators=(",", ":"))
    print(f"Highlights integrados: {count}")
else:
    print("Sin nuevos highlights")

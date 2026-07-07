#!/usr/bin/env python3
"""CI helper: solo actualiza live.json con el marcador en tiempo real.
Se usa cuando no hay partido activo confirmado pero queremos puntos provisionales.

Uso: python ci_fetch_live.py
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import fetch_results as fr

cfg = fr._load_config()
url = cfg.get("api_url", "https://worldcup26.ir/get/games")
try:
    games = fr._fetch_games(url)
    fr.write_live_json(games)
    print("live.json actualizado")
except Exception as e:
    print(f"Live fetch error: {e}")

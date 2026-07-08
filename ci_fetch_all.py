#!/usr/bin/env python3
"""CI helper: descarga resultados de la API y escribe results/live/scorers/penalties JSON.
No modifica Excel ni data.json – eso lo hace patch_data.py después.

Uso: python ci_fetch_all.py
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import fetch_results as fr

cfg = fr._load_config()
url = cfg.get("api_url", "https://worldcup26.ir/get/games")
print(f"Descargando desde {url}...")
try:
    games = fr._fetch_games(url)
    match_map = fr._load_data_json_match_map()
    # Penaltis antes que resultados: write_results_json necesita el ganador en empates 0-0
    fr.write_penalties_json(games)
    fr.write_scorers_json(games)
    fr.write_results_json(games, match_map)
    fr.write_live_json(games)
    print("Descarga completada")
except Exception as e:
    print(f"Error descargando resultados: {e}")
    sys.exit(0)  # No falla el workflow si la API no responde

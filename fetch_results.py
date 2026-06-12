#!/usr/bin/env python3
"""
Descarga resultados en vivo del Mundial 2026 y los escribe en WORLDCUP (AC/AD).
Fuente: https://worldcup26.ir/get/games (API pública, sin clave).

  python3 fetch_results.py
"""
import json
import os
import sys
import unicodedata
import urllib.error
import urllib.request

import openpyxl

BASE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE)

from excel_sync import excel_paths as _excel_paths
from team_names import to_spanish, _norm


def _load_config():
    path = os.path.join(BASE, "update_config.json")
    defaults = {
        "fetch_live_results": True,
        "api_url": "https://worldcup26.ir/get/games",
    }
    if os.path.isfile(path):
        with open(path, encoding="utf-8") as f:
            defaults.update(json.load(f))
    return defaults


def _fetch_games(url: str) -> list:
    req = urllib.request.Request(url, headers={"User-Agent": "PorraLosNanos/1.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.load(resp)
    games = data.get("games", data) if isinstance(data, dict) else data
    if not isinstance(games, list):
        raise ValueError("Respuesta API inesperada")
    return games


def _match_key(home_es: str, away_es: str) -> str:
    return f"{home_es.strip()}-{away_es.strip()}"


def _norm_key(key: str) -> str:
    s = unicodedata.normalize("NFD", key.lower())
    return "".join(c for c in s if unicodedata.category(c) != "Mn")


def update_excel(games: list, file1: str) -> int:
    """Write finished match scores into WORLDCUP columns AC (29) and AD (30)."""
    wb = openpyxl.load_workbook(file1, data_only=False)
    wc = wb["WORLDCUP"]
    # Read team names with cached values (cols AA/AF are often formulas)
    wb_ro = openpyxl.load_workbook(file1, data_only=True)
    wc_ro = wb_ro["WORLDCUP"]

    row_index = {}
    for r in range(4, 148):
        home = wc_ro.cell(r, 27).value
        away = wc_ro.cell(r, 32).value
        if not home or not away:
            continue
        key = _match_key(str(home), str(away))
        row_index[_norm_key(key)] = r

    updated = 0
    for g in games:
        if str(g.get("finished", "")).upper() != "TRUE":
            continue
        home_es = to_spanish(g.get("home_team_name_en", ""))
        away_es = to_spanish(g.get("away_team_name_en", ""))
        try:
            gl = int(g.get("home_score", ""))
            gv = int(g.get("away_score", ""))
        except (TypeError, ValueError):
            continue

        key = _norm_key(_match_key(home_es, away_es))
        row = row_index.get(key)
        if not row:
            # try swapped (rare)
            key2 = _norm_key(_match_key(away_es, home_es))
            row = row_index.get(key2)
            if row:
                gl, gv = gv, gl
        if not row:
            print(f"  ⚠ Sin fila Excel: {home_es} vs {away_es}")
            continue

        cur_l = wc.cell(row, 29).value
        cur_v = wc.cell(row, 30).value
        if cur_l == gl and cur_v == gv:
            continue
        wc.cell(row, 29).value = gl
        wc.cell(row, 30).value = gv
        print(f"  ✓ {home_es} {gl}-{gv} {away_es}  (fila WORLDCUP {row})")
        updated += 1

    if updated:
        wb.save(file1)
        print(f"💾 Excel guardado ({updated} partido(s) actualizado(s))")
        print(f"   → {file1}")
    else:
        print("ℹ️  Sin cambios en el Excel")
    return updated


def main():
    cfg = _load_config()
    if not cfg.get("fetch_live_results", True):
        print("ℹ️  fetch_live_results=false en update_config.json — omitido")
        return 0

    _, file1, _ = _excel_paths()
    if not os.path.isfile(file1):
        print(f"❌ No encuentro: {file1}")
        return 1

    url = cfg.get("api_url", "https://worldcup26.ir/get/games")
    print(f"🌐 Descargando resultados desde {url}…")
    try:
        games = _fetch_games(url)
    except (urllib.error.URLError, TimeoutError, ValueError) as e:
        print(f"❌ Error al descargar: {e}")
        return 1

    finished = [g for g in games if str(g.get("finished", "")).upper() == "TRUE"]
    print(f"📥 {len(finished)} partido(s) finalizado(s) en la API")
    update_excel(games, file1)
    return 0


if __name__ == "__main__":
    sys.exit(main())

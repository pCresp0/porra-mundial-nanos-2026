#!/usr/bin/env python3
"""
Descarga resultados en vivo del Mundial 2026 y los escribe en WORLDCUP (AC/AD).
Fuente: https://worldcup26.ir/get/games (API pública, sin clave).

  python3 fetch_results.py
"""
import json
import os
import re
import sys
import unicodedata
import urllib.error
import urllib.request

import openpyxl

BASE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE)

SCORERS_JSON = os.path.join(BASE, "data", "scorers.json")

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


def _parse_scorers(raw, team: str) -> list:
    """Parse the API scorer string into [{player, minute, own_goal, team}].

    The API uses Postgres-array-like strings, e.g.:
      '{"D. Bobadilla 7\'(OG)","F. Balogun 45\'+5\'"}'

    Patterns handled:
      "Name 7'(OG)"  → minute="7'",     own_goal=True
      "Name 31'"     → minute="31'",    own_goal=False
      "Name 45'+5'"  → minute="45'+5'", own_goal=False
    """
    if raw is None:
        return []
    s = str(raw).strip()
    if not s or s.lower() == "null":
        return []
    # Extract quoted segments (straight " or curly “ ” ”)
    segments = re.findall(r"[\"\u201c\u201d\u201e]([^\"\u201c\u201d\u201e]+)[\"\u201c\u201d\u201e]", s)
    if not segments:
        inner = s.strip("{}").strip()
        if inner and inner.lower() != "null":
            segments = [p.strip() for p in inner.split(",")]
    out = []
    for seg in segments:
        seg = seg.strip().strip(",").strip()
        if not seg or seg.lower() == "null":
            continue
        # Extra-time: "Name 45'+5'" or "Name 45'+ 5'"
        m = re.match(r"^(.*?)\s*(\d+)\s*'?\s*\+\s*(\d+)\s*'?\s*(\(OG\))?\s*$", seg, re.IGNORECASE)
        if m and m.group(1).strip():
            player   = m.group(1).strip()
            minute   = f"{m.group(2)}'+{m.group(3)}'"
            own_goal = bool(m.group(4))
        else:
            # Regular: "Name 7'" or "Name 7'(OG)"
            m = re.match(r"^(.*?)\s*(\d+)\s*'?\s*(\(OG\))?\s*$", seg, re.IGNORECASE)
            if m and m.group(1).strip():
                player   = m.group(1).strip()
                minute   = m.group(2) + "'"
                own_goal = bool(m.group(3))
            else:
                player, minute, own_goal = seg, "", False
        out.append({"player": player, "minute": minute, "own_goal": own_goal, "team": team})
    return out


def _scorers_for_game(g) -> list:
    return (_parse_scorers(g.get("home_scorers"), "home")
            + _parse_scorers(g.get("away_scorers"), "away"))


def write_scorers_json(games: list) -> int:
    """Write goalscorers (with minute) keyed by 'Local-Visitante' to scorers.json."""
    scorers = {}
    for g in games:
        if str(g.get("finished", "")).upper() != "TRUE":
            continue
        home_es = to_spanish(g.get("home_team_name_en", ""))
        away_es = to_spanish(g.get("away_team_name_en", ""))
        if not home_es or not away_es:
            continue
        sc = _scorers_for_game(g)
        if sc:
            scorers[_match_key(home_es, away_es)] = sc
    os.makedirs(os.path.dirname(SCORERS_JSON), exist_ok=True)
    with open(SCORERS_JSON, "w", encoding="utf-8") as f:
        json.dump(scorers, f, ensure_ascii=False, indent=2)
    print(f"⚽ Goleadores guardados: {len(scorers)} partido(s) → {SCORERS_JSON}")
    return len(scorers)


def _patch_worldcup_scores(path: str, updates: dict) -> list:
    """Surgically set AC/AD score cells in the WORLDCUP sheet XML.

    Writing with openpyxl rewrites the whole sheet and DROPS the cached values
    of every formula cell (team names, dates, flags are formulas), which breaks
    the next read by both this script and build_data. Patching the raw XML keeps
    every other cell — including formula caches — untouched.

    updates: {row:int -> (gl:int, gv:int)}
    """
    import tempfile
    import zipfile

    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        infos = z.infolist()
        contents = {n: z.read(n) for n in names}

    wbxml = contents["xl/workbook.xml"].decode("utf-8")
    rels = contents["xl/_rels/workbook.xml.rels"].decode("utf-8")
    m = (re.search(r'<sheet[^>]*name="WORLDCUP"[^>]*?r:id="(rId\d+)"', wbxml)
         or re.search(r'<sheet[^>]*?r:id="(rId\d+)"[^>]*name="WORLDCUP"', wbxml))
    if not m:
        raise ValueError("Pestaña WORLDCUP no encontrada en workbook.xml")
    rid = m.group(1)
    t = re.search(r'Id="' + rid + r'"[^>]*Target="([^"]+)"', rels)
    sheetpath = "xl/" + t.group(1).lstrip("/")
    xml = contents[sheetpath].decode("utf-8")

    def set_cell(xml_str, ref, value):
        pat = re.compile(r'<c r="' + re.escape(ref) + r'"([^>]*?)(/>|>.*?</c>)', re.DOTALL)

        def repl(mm):
            attrs = re.sub(r'\s+t="[^"]*"', "", mm.group(1))
            return f'<c r="{ref}"{attrs}><v>{value}</v></c>'

        return pat.subn(repl, xml_str, count=1)

    missing = []
    for row, (gl, gv) in updates.items():
        for col, val in (("AC", gl), ("AD", gv)):
            ref = f"{col}{row}"
            xml, n = set_cell(xml, ref, val)
            if n == 0:
                missing.append(ref)
    contents[sheetpath] = xml.encode("utf-8")

    fd, tmp = tempfile.mkstemp(suffix=".xlsx", dir=os.path.dirname(path) or ".")
    os.close(fd)
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for info in infos:
            zout.writestr(info, contents[info.filename])
    os.replace(tmp, path)
    return missing


def update_excel(games: list, path: str, label: str = "") -> int:
    """Write finished match scores into WORLDCUP columns AC (29) and AD (30)."""
    wb_ro = openpyxl.load_workbook(path, data_only=True)
    if "WORLDCUP" not in wb_ro.sheetnames:
        print(f"  ⚠ {label or path}: sin pestaña WORLDCUP, omitido")
        return 0
    wc_ro = wb_ro["WORLDCUP"]

    row_index = {}
    for r in range(4, 148):
        home = wc_ro.cell(r, 27).value
        away = wc_ro.cell(r, 32).value
        if not home or not away:
            continue
        key = _match_key(str(home), str(away))
        row_index[_norm_key(key)] = r

    if not row_index:
        print(f"  ⚠ Excel {label}: sin nombres de equipo en WORLDCUP "
              f"(caché de fórmulas borrada). Ábrelo y guárdalo en Excel para regenerar.")

    updates = {}
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
            row = row_index.get(_norm_key(_match_key(away_es, home_es)))
            if row:
                gl, gv = gv, gl
        if not row:
            print(f"  ⚠ Sin fila Excel: {home_es} vs {away_es}")
            continue

        cur_l = wc_ro.cell(row, 29).value
        cur_v = wc_ro.cell(row, 30).value
        try:
            same = cur_l is not None and cur_v is not None and int(cur_l) == gl and int(cur_v) == gv
        except (TypeError, ValueError):
            same = False
        if same:
            continue
        updates[row] = (gl, gv)
        print(f"  ✓ {home_es} {gl}-{gv} {away_es}  (fila WORLDCUP {row})")

    if updates:
        missing = _patch_worldcup_scores(path, updates)
        if missing:
            print(f"  ⚠ Celdas no encontradas en XML: {', '.join(missing)}")
        print(f"💾 Excel {label} guardado ({len(updates)} partido(s) actualizado(s))")
        print(f"   → {path}")
    else:
        print(f"ℹ️  Excel {label}: sin cambios")
    return len(updates)


def main():
    cfg = _load_config()
    if not cfg.get("fetch_live_results", True):
        print("ℹ️  fetch_live_results=false en update_config.json — omitido")
        return 0

    _, file1, file2 = _excel_paths()
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

    # Update BOTH Excel files (WORLDCUP tab) with the scores
    update_excel(games, file1, "[1]")
    if file2 and os.path.isfile(file2):
        update_excel(games, file2, "[2]")
    else:
        print("ℹ️  Excel [2] no encontrado, omitido")

    # Save goalscorers (with minute) for the website
    write_scorers_json(games)
    return 0


if __name__ == "__main__":
    sys.exit(main())

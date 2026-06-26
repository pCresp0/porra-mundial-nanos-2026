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
LIVE_JSON = os.path.join(BASE, "data", "live.json")

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


def _fetch_games(url: str, retries: int = 12, backoff: float = 3.0) -> list:
    """Fetch games from the API with retries (the server is flaky)."""
    import time as _time

    last_err = None
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "PorraLosNanos/1.0"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.load(resp)
            games = data.get("games", data) if isinstance(data, dict) else data
            if not isinstance(games, list):
                raise ValueError("Respuesta API inesperada")
            if attempt > 1:
                print(f"  ✅ API respondió en intento {attempt}/{retries}")
            return games
        except Exception as e:
            last_err = e
            if attempt < retries:
                wait = backoff * attempt
                print(f"  ⚠️  Intento {attempt}/{retries} falló ({e}), reintentando en {wait:.0f}s…")
                _time.sleep(wait)
    raise last_err


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
      "Name 7'(P)"   → minute="7'",     penalty=True
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
        # Extra-time: "Name 45'+5'" or "Name 45'+ 5'" with optional (OG)/(P)
        m = re.match(r"^(.*?)\s*(\d+)\s*'?\s*\+\s*(\d+)\s*'?\s*(\(OG\)|\(P\))?\s*$", seg, re.IGNORECASE)
        if m and m.group(1).strip():
            player   = m.group(1).strip()
            minute   = f"{m.group(2)}'+{m.group(3)}'"
            tag      = (m.group(4) or "").upper()
            own_goal = tag == "(OG)"
            penalty  = tag == "(P)"
        else:
            # Regular: "Name 7'" or "Name 7'(OG)" or "Name 7'(P)"
            m = re.match(r"^(.*?)\s*(\d+)\s*'?\s*(\(OG\)|\(P\))?\s*$", seg, re.IGNORECASE)
            if m and m.group(1).strip():
                player   = m.group(1).strip()
                minute   = m.group(2) + "'"
                tag      = (m.group(3) or "").upper()
                own_goal = tag == "(OG)"
                penalty  = tag == "(P)"
            else:
                player, minute, own_goal, penalty = seg, "", False, False
        out.append({"player": player, "minute": minute, "own_goal": own_goal, "penalty": penalty, "team": team})
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


def _is_live(g) -> bool:
    """A match is live when it has started but is not finished yet.

    The API exposes ``time_elapsed`` as "notstarted", "finished" or a live
    marker (a minute like "67'", "HT", "45'+2'", …). Live matches keep updating
    ``home_score`` / ``away_score``.
    """
    if str(g.get("finished", "")).upper() == "TRUE":
        return False
    te = str(g.get("time_elapsed", "")).strip().lower()
    if te in ("", "notstarted", "not started", "null", "none"):
        return False
    return True


def write_live_json(games: list) -> int:
    """Write currently-live scores keyed by 'Local-Visitante' to live.json.

    Rebuilt from scratch on every run, so finished/not-started matches drop out
    automatically. Official results stay in the Excel (source of truth); this
    file only feeds the provisional, in-progress overlay on the website.
    """
    live = {}
    for g in games:
        if not _is_live(g):
            continue
        home_es = to_spanish(g.get("home_team_name_en", ""))
        away_es = to_spanish(g.get("away_team_name_en", ""))
        if not home_es or not away_es:
            continue
        try:
            gl = int(g.get("home_score"))
            gv = int(g.get("away_score"))
        except (TypeError, ValueError):
            gl, gv = 0, 0
        live[_match_key(home_es, away_es)] = {
            "home":    gl,
            "away":    gv,
            "minute":  str(g.get("time_elapsed", "")).strip(),
            "scorers": _scorers_for_game(g),
        }
    os.makedirs(os.path.dirname(LIVE_JSON), exist_ok=True)
    with open(LIVE_JSON, "w", encoding="utf-8") as f:
        json.dump(live, f, ensure_ascii=False, indent=2)
    if live:
        print(f"🔴 Partidos en vivo: {len(live)} → {LIVE_JSON}")
    else:
        print(f"⚪ Sin partidos en vivo → {LIVE_JSON}")
    return len(live)


def _patch_excel_cells(path: str, sheet_name: str, updates: dict) -> list:
    """Surgically set cell values in the sheet XML.
    updates: {cell_ref: str -> value} (e.g. {"AC101": 3, "AA101": "España"})
    """
    import tempfile
    import zipfile

    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        infos = z.infolist()
        contents = {n: z.read(n) for n in names}

    wbxml = contents["xl/workbook.xml"].decode("utf-8")
    rels = contents["xl/_rels/workbook.xml.rels"].decode("utf-8")
    m = (re.search(r'<sheet[^>]*name="' + re.escape(sheet_name) + r'"[^>]*?r:id="(rId\d+)"', wbxml)
         or re.search(r'<sheet[^>]*?r:id="(rId\d+)"[^>]*name="' + re.escape(sheet_name) + r'"', wbxml))
    if not m:
        raise ValueError(f"Pestaña {sheet_name} no encontrada en workbook.xml")
    rid = m.group(1)
    t = (re.search(r'Id="' + rid + r'"[^>]*Target="([^"]+)"', rels)
         or re.search(r'Target="([^"]+)"[^>]*Id="' + rid + r'"', rels))
    sp = t.group(1).lstrip("/")
    sheetpath = sp if sp.startswith("xl/") else "xl/" + sp
    xml = contents[sheetpath].decode("utf-8")

    def set_cell(xml_str, ref, value):
        pat = re.compile(r'<c r="' + re.escape(ref) + r'"([^>]*?)(/>|>.*?</c>)', re.DOTALL)

        def repl(mm):
            if isinstance(value, str):
                return f'<c r="{ref}" t="str"><v>{value}</v></c>'
            else:
                attrs = re.sub(r'\s+t="[^"]*"', "", mm.group(1))
                return f'<c r="{ref}"{attrs}><v>{value}</v></c>'

        return pat.subn(repl, xml_str, count=1)

    missing = []
    for ref, val in updates.items():
        if val is None:
            continue
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


def _patch_worldcup_cells(path: str, updates: dict) -> list:
    """Surgically set cell values in the WORLDCUP sheet XML.
    updates: {cell_ref: str -> value} (e.g. {"AC101": 3, "AA101": "España"})
    """
    return _patch_excel_cells(path, "WORLDCUP", updates)


def _patch_worldcup_scores(path: str, updates: dict) -> list:
    """Surgically set AC/AD score cells in the WORLDCUP sheet XML.
    updates: {row:int -> (gl:int, gv:int)}
    """
    cell_updates = {}
    for row, (gl, gv) in updates.items():
        cell_updates[f"AC{row}"] = gl
        cell_updates[f"AD{row}"] = gv
    return _patch_worldcup_cells(path, cell_updates)


def update_excel(games: list, path: str, label: str = "") -> int:
    """Write finished match scores into WORLDCUP columns AC (29) and AD (30)."""
    wb_ro = openpyxl.load_workbook(path, data_only=False)
    if "WORLDCUP" not in wb_ro.sheetnames:
        print(f"  ⚠ {label or path}: sin pestaña WORLDCUP, omitido")
        return 0
    wc_ro = wb_ro["WORLDCUP"]

    # Build team maps from Idiomas and Equipos sheets to resolve formulas
    team_map = {}
    if "Idiomas" in wb_ro.sheetnames:
        ws_idiomas = wb_ro["Idiomas"]
        for r in range(212, 260):
            num = ws_idiomas.cell(r, 3).value
            name = ws_idiomas.cell(r, 15).value
            if num is not None and name is not None:
                team_map[int(num)] = str(name).strip()

    equipos_map = {}
    if "Equipos" in wb_ro.sheetnames:
        ws_equipos = wb_ro["Equipos"]
        for r in range(2, 50):
            num = ws_equipos.cell(r, 1).value
            if num is not None:
                equipos_map[r] = team_map.get(int(num))

    def get_resolved_val(sheet, r, c):
        val = sheet.cell(r, c).value
        if val is None:
            return None
        val_str = str(val).strip()
        if not val_str.startswith('='):
            return val_str
        formula = val_str[1:].lstrip('+').strip()
        m_eq = re.match(r'^(?:Equipos!)?B(\d+)$', formula)
        if m_eq:
            return equipos_map.get(int(m_eq.group(1)))
        m_a = re.match(r'^A(\d+)$', formula)
        if m_a:
            return get_resolved_val(sheet, int(m_a.group(1)), 1)
        if 'INDEX(' in formula and 'MATCH(' in formula and sheet.title == 'Equipos':
            num = sheet.cell(r, 1).value
            if num is not None:
                return team_map.get(int(num))
        return val_str

    row_index = {}
    for r in range(4, 148):
        home = get_resolved_val(wc_ro, r, 27)
        away = get_resolved_val(wc_ro, r, 32)
        if not home or not away or str(home).startswith("=") or str(away).startswith("="):
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


TEAM_FLAGS = {
     "Argelia": "🇩🇿", "Angola": "🇦🇴", "Argentina": "🇦🇷", "Australia": "🇦🇺",
     "Austria": "🇦🇹", "Bélgica": "🇧🇪", "Bolivia": "🇧🇴", "Brasil": "🇧🇷",
     "Camerún": "🇨🇲", "Canadá": "🇨🇦", "Chile": "🇨🇱", "China": "🇨🇳",
     "Colombia": "🇨🇴", "Costa Rica": "🇨🇷", "Croacia": "🇭🇷", "República Checa": "🇨🇿",
     "Dinamarca": "🇩🇰", "Ecuador": "🇪🇨", "Egipto": "🇪🇬", "Inglaterra": "🏴\u200d󠁧󠁢󠁥󠁮\u200d󠁿",
     "Francia": "🇫🇷", "Alemania": "🇩🇪", "Ghana": "🇬🇭", "Grecia": "🇬🇷",
     "Honduras": "🇭🇳", "Hungría": "🇭🇺", "Indonesia": "🇮🇩", "Irán": "🇮🇷",
     "Irak": "🇮🇶", "Israel": "🇮🇱", "Italia": "🇮🇹", "Costa de Marfil": "🇨🇮",
     "Bosnia y Herzegovina": "🇧🇦",
     "Jamaica": "🇯🇲", "Japón": "🇯🇵", "México": "🇲🇽", "Marruecos": "🇲🇦",
     "Países Bajos": "🇳🇱", "Nueva Zelanda": "🇳🇿", "Nigeria": "🇳🇬", "Noruega": "🇳🇴",
     "Panamá": "🇵🇦", "Paraguay": "🇵🇾", "Perú": "🇵🇪", "Polonia": "🇵🇱",
     "Portugal": "🇵🇹", "Catar": "🇶🇦", "Rumanía": "🇷🇴", "Arabia Saudita": "🇸🇦",
     "Escocia": "🏴\u200d󠁧󠁢󠁳󠁣󠁴\u200d󠁿", "Senegal": "🇸🇳", "Serbia": "🇷🇸", "Eslovaquia": "🇸🇰",
     "Eslovenia": "🇸🇮", "Sudáfrica": "🇿🇦", "Corea del Sur": "🇰🇷", "España": "🇪🇸",
     "Suecia": "🇸🇪", "Suiza": "🇨🇭", "Túnez": "🇹🇳", "Turquía": "🇹🇷",
     "Ucrania": "🇺🇦", "Estados Unidos": "🇺🇸", "Uruguay": "🇺🇾", "Uzbekistán": "🇺🇿",
     "Venezuela": "🇻🇪", "Gales": "🏴\u200d󠁧󠁢󠁷󠁡\u200d󠁿", "Kenia": "🇰🇪", "Tanzania": "🇹🇿",
     "Congo RD": "🇨🇩", "RD Congo": "🇨🇩", "Emiratos Árabes Unidos": "🇦🇪"
}

def fetch_bbc_knockout_matchups() -> list:
    """Fetch knockout stage matchups from BBC World Cup schedule."""
    import urllib.request
    import re
    import json
    import codecs

    url = "https://www.bbc.com/sport/football/world-cup/schedule"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            html = resp.read().decode("utf-8")
    except Exception as e:
        print(f"  ❌ Error al descargar el calendario de la BBC: {e}")
        return []

    m = re.search(r'window\.__INITIAL_DATA__\s*=\s*"(.*?)"\s*;', html)
    if not m:
        m = re.search(r'window\.__INITIAL_DATA__\s*=\s*"(.*?)"', html)

    if not m:
        print("  ❌ No se pudo encontrar window.__INITIAL_DATA__ en la web de la BBC")
        return []

    try:
        raw_val = m.group(1)
        unescaped = codecs.escape_decode(raw_val.encode('utf-8'))[0].decode('utf-8')
        data = json.loads(unescaped)
        nested_data = data.get("data", {})
        
        wc_key = None
        for k in nested_data.keys():
            if "tournament=world-cup" in k:
                wc_key = k
                break
        
        if not wc_key:
            return []
            
        wc_data = nested_data[wc_key]
        wc_stage = wc_data.get("data", {}).get("knockoutStage", {})
        
        rounds = []
        for r in wc_stage.get("preFinalRounds", []):
            rname = r.get("roundName")
            matches = []
            for m_item in r.get("matches", []):
                ev = m_item.get("event", {})
                teams = ev.get("teams", [])
                t_list = []
                for t in teams:
                    name = t.get("name", {}).get("fullName", "")
                    placeholder = t.get("knockoutGroupPlaceholder", "")
                    t_list.append({"name": name, "placeholder": placeholder})
                matches.append({
                    "id": ev.get("id"),
                    "date": ev.get("date", {}).get("isoDate"),
                    "teams": t_list
                })
            rounds.append({"name": rname, "matches": matches})
        
        third = wc_stage.get("thirdPlacePlayoff", {})
        if third:
            rname = third.get("roundName")
            m_item = third.get("match", {})
            if m_item:
                ev = m_item.get("event", {})
                teams = ev.get("teams", [])
                t_list = []
                for t in teams:
                    name = t.get("name", {}).get("fullName", "")
                    placeholder = t.get("knockoutGroupPlaceholder", "")
                    t_list.append({"name": name, "placeholder": placeholder})
                rounds.append({
                    "name": rname,
                    "matches": [{
                        "id": ev.get("id"),
                        "date": ev.get("date", {}).get("isoDate"),
                        "teams": t_list
                    }]
                })
        
        fin = wc_stage.get("final", {})
        if fin:
            rname = fin.get("roundName")
            m_item = fin.get("match", {})
            if m_item:
                ev = m_item.get("event", {})
                teams = ev.get("teams", [])
                t_list = []
                for t in teams:
                    name = t.get("name", {}).get("fullName", "")
                    placeholder = t.get("knockoutGroupPlaceholder", "")
                    t_list.append({"name": name, "placeholder": placeholder})
                rounds.append({
                    "name": rname,
                    "matches": [{
                        "id": ev.get("id"),
                        "date": ev.get("date", {}).get("isoDate"),
                        "teams": t_list
                    }]
                })
        return rounds
    except Exception as e:
        print(f"  ❌ Error al parsear JSON de la BBC: {e}")
        return []


def update_excel_knockout_matchups(path: str, rounds: list) -> int:
    """Read the Excel file's WORLDCUP sheet, match BBC rounds, and surgically update AA/AF and AB/AE in the visual row."""
    wb_ro = openpyxl.load_workbook(path, data_only=True)
    if "WORLDCUP" not in wb_ro.sheetnames:
        return 0
    ws = wb_ro["WORLDCUP"]

    def norm_ph(p: str) -> str:
        if not p: return ""
        p = str(p).strip().upper()
        if p[-1].isdigit():
            return p[-1] + p[:-1]
        return p

    def wc_row_to_admin_row(wc_row: int) -> int:
        if 101 <= wc_row <= 116:
            return wc_row + 63
        if 120 <= wc_row <= 127:
            return wc_row + 80
        if 131 <= wc_row <= 134:
            return wc_row + 89
        if 138 <= wc_row <= 139:
            return wc_row + 94
        if wc_row == 143:
            return 244
        if wc_row == 147:
            return 247
        return wc_row

    ws_admin = wb_ro["ADMIN"] if "ADMIN" in wb_ro.sheetnames else None

    excel_matches = {}
    row_current_values = {}
    for r in range(101, 148):
        mid = ws.cell(row=r, column=10).value # J
        home = ws.cell(row=r, column=1).value # A (original placeholder)
        away = ws.cell(row=r, column=2).value # B (original placeholder)
        ah = ws.cell(row=r, column=34).value # AH (visual MatchNo)
        
        actual_home = ws.cell(row=r, column=27).value # AA (current home name)
        actual_away = ws.cell(row=r, column=32).value # AF (current away name)
        
        admin_row = wc_row_to_admin_row(r)
        admin_k = ws_admin.cell(row=admin_row, column=11).value if ws_admin else None # K (concatenate name)
        
        row_current_values[r] = {
            "home": str(actual_home).strip() if actual_home else "",
            "away": str(actual_away).strip() if actual_away else "",
            "admin_k": str(admin_k).strip() if admin_k else ""
        }
        
        if mid or home or away:
            excel_matches[r] = {
                "id": str(mid).strip() if mid else "",
                "home_ph": norm_ph(home),
                "away_ph": norm_ph(away),
                "ah": str(ah).strip() if ah else ""
            }

    def find_visual_row(mid: str) -> int:
        for r, info in excel_matches.items():
            if info["ah"] == mid:
                return r
        return None

    bbc_last_32 = []
    bbc_last_16 = []
    bbc_qf = []
    bbc_sf = []
    bbc_third = []
    bbc_final = []

    for rd in rounds:
        rname = rd["name"].lower()
        if "32" in rname:
            bbc_last_32 = rd["matches"]
        elif "16" in rname:
            bbc_last_16 = rd["matches"]
        elif "quarter" in rname:
            bbc_qf = rd["matches"]
        elif "semi" in rname:
            bbc_sf = rd["matches"]
        elif "3rd" in rname:
            bbc_third = rd["matches"]
        elif "final" in rname:
            bbc_final = rd["matches"]

    last_32_mapping = {}
    excel_last_32_rows = list(range(101, 117))
    
    for bbc_idx, bm in enumerate(bbc_last_32):
        if len(bm["teams"]) != 2:
            continue
        t1_ph = norm_ph(bm["teams"][0]["placeholder"])
        t2_ph = norm_ph(bm["teams"][1]["placeholder"])
        bm_set = {t1_ph, t2_ph}
        
        matched_row = None
        for r in excel_last_32_rows:
            ex_info = excel_matches[r]
            ex_set = {ex_info["home_ph"], ex_info["away_ph"]}
            if bm_set == ex_set:
                matched_row = r
                break
        if matched_row:
            last_32_mapping[bbc_idx + 1] = matched_row
            bm["excel_row"] = matched_row
            bm["excel_id"] = excel_matches[matched_row]["id"]

    last_16_mapping = {}
    excel_last_16_rows = list(range(120, 128))
    
    for bbc_idx, bm in enumerate(bbc_last_16):
        if len(bm["teams"]) != 2:
            continue
        
        def translate_placeholder(p: str) -> str:
            p = p.strip()
            m_match = re.match(r'^([WL])-32-(\d+)$', p, re.IGNORECASE)
            if m_match:
                side = m_match.group(1).upper()
                idx = int(m_match.group(2))
                ex_row = last_32_mapping.get(idx)
                if ex_row:
                    ex_id = excel_matches[ex_row]["id"]
                    return f"{side}{ex_id}"
            return p

        t1_ph = translate_placeholder(bm["teams"][0]["placeholder"])
        t2_ph = translate_placeholder(bm["teams"][1]["placeholder"])
        bm_set = {t1_ph, t2_ph}
        
        matched_row = None
        for r in excel_last_16_rows:
            ex_info = excel_matches[r]
            ex_set = {ex_info["home_ph"], ex_info["away_ph"]}
            if bm_set == ex_set:
                matched_row = r
                break
        if matched_row:
            last_16_mapping[bbc_idx + 1] = matched_row
            bm["excel_row"] = matched_row
            bm["excel_id"] = excel_matches[matched_row]["id"]

    qf_mapping = {}
    excel_qf_rows = list(range(131, 135))
    
    for bbc_idx, bm in enumerate(bbc_qf):
        if len(bm["teams"]) != 2:
            continue
        
        def translate_placeholder(p: str) -> str:
            p = p.strip()
            m_match = re.match(r'^([WL])-16-(\d+)$', p, re.IGNORECASE)
            if m_match:
                side = m_match.group(1).upper()
                idx = int(m_match.group(2))
                ex_row = last_16_mapping.get(idx)
                if ex_row:
                    ex_id = excel_matches[ex_row]["id"]
                    return f"{side}{ex_id}"
            return p

        t1_ph = translate_placeholder(bm["teams"][0]["placeholder"])
        t2_ph = translate_placeholder(bm["teams"][1]["placeholder"])
        bm_set = {t1_ph, t2_ph}
        
        matched_row = None
        for r in excel_qf_rows:
            ex_info = excel_matches[r]
            ex_set = {ex_info["home_ph"], ex_info["away_ph"]}
            if bm_set == ex_set:
                matched_row = r
                break
        if matched_row:
            qf_mapping[bbc_idx + 1] = matched_row
            bm["excel_row"] = matched_row
            bm["excel_id"] = excel_matches[matched_row]["id"]

    sf_mapping = {}
    excel_sf_rows = list(range(138, 140))
    
    for bbc_idx, bm in enumerate(bbc_sf):
        if len(bm["teams"]) != 2:
            continue
        
        def translate_placeholder(p: str) -> str:
            p = p.strip().upper()
            m_match = re.match(r'^([WL])-QF(\d+)$', p)
            if m_match:
                side = m_match.group(1)
                idx = int(m_match.group(2))
                ex_row = qf_mapping.get(idx)
                if ex_row:
                    ex_id = excel_matches[ex_row]["id"]
                    return f"{side}{ex_id}"
            return p

        t1_ph = translate_placeholder(bm["teams"][0]["placeholder"])
        t2_ph = translate_placeholder(bm["teams"][1]["placeholder"])
        bm_set = {t1_ph, t2_ph}
        
        matched_row = None
        for r in excel_sf_rows:
            ex_info = excel_matches[r]
            ex_set = {ex_info["home_ph"], ex_info["away_ph"]}
            if bm_set == ex_set:
                matched_row = r
                break
        if matched_row:
            sf_mapping[bbc_idx + 1] = matched_row
            bm["excel_row"] = matched_row
            bm["excel_id"] = excel_matches[matched_row]["id"]

    excel_third_row = 143
    if bbc_third and len(bbc_third[0]["teams"]) == 2:
        bm = bbc_third[0]
        def translate_placeholder(p: str) -> str:
            p = p.strip().upper()
            m_match = re.match(r'^([WL])-SF(\d+)$', p)
            if m_match:
                side = m_match.group(1)
                idx = int(m_match.group(2))
                ex_row = sf_mapping.get(idx)
                if ex_row:
                    ex_id = excel_matches[ex_row]["id"]
                    return f"{side}{ex_id}"
            return p
        t1_ph = translate_placeholder(bm["teams"][0]["placeholder"])
        t2_ph = translate_placeholder(bm["teams"][1]["placeholder"])
        bm["excel_row"] = excel_third_row
        bm["excel_id"] = excel_matches[excel_third_row]["id"]

    excel_final_row = 147
    if bbc_final and len(bbc_final[0]["teams"]) == 2:
        bm = bbc_final[0]
        def translate_placeholder(p: str) -> str:
            p = p.strip().upper()
            m_match = re.match(r'^([WL])-SF(\d+)$', p)
            if m_match:
                side = m_match.group(1)
                idx = int(m_match.group(2))
                ex_row = sf_mapping.get(idx)
                if ex_row:
                    ex_id = excel_matches[ex_row]["id"]
                    return f"{side}{ex_id}"
            return p
        t1_ph = translate_placeholder(bm["teams"][0]["placeholder"])
        t2_ph = translate_placeholder(bm["teams"][1]["placeholder"])
        bm["excel_row"] = excel_final_row
        bm["excel_id"] = excel_matches[excel_final_row]["id"]

    def is_ph(name: str) -> bool:
        n = name.strip()
        if not n: return True
        n_up = n.upper()
        if re.match(r'^[WL]-(?:32|16|QF|SF|F)-?\d*$', n_up):
            return True
        if re.match(r'^[WL]\d+$', n_up):
            return True
        if re.match(r'^[1-4]?[A-L]+[1-4]?$', n_up):
            return True
        if len(n_up) <= 6 and any(c.isdigit() for c in n_up):
            return True
        return False

    cell_updates = {}
    admin_updates = {}
    updates_count = 0

    all_bbc_matches = bbc_last_32 + bbc_last_16 + bbc_qf + bbc_sf + bbc_third + bbc_final
    for bm in all_bbc_matches:
        r_physical = bm.get("excel_row")
        if not r_physical:
            continue
        mid = bm.get("excel_id")
        r_visual = find_visual_row(mid)
        if not r_visual:
            print(f"  ⚠️ Warning: No visual row found for Match ID {mid}")
            continue

        t1_name = bm["teams"][0]["name"]
        t2_name = bm["teams"][1]["name"]
        
        if not is_ph(t1_name) and not is_ph(t2_name):
            t1_es = to_spanish(t1_name)
            t2_es = to_spanish(t2_name)
            t1_flag = TEAM_FLAGS.get(t1_es, "")
            t2_flag = TEAM_FLAGS.get(t2_es, "")
            
            ex_home = row_current_values[r_visual]["home"]
            ex_away = row_current_values[r_visual]["away"]
            ex_admin_k = row_current_values[r_visual]["admin_k"]
            
            bm_t1_ph = norm_ph(bm["teams"][0]["placeholder"])
            ex_home_ph = excel_matches[r_physical]["home_ph"]
            
            if bm_t1_ph == ex_home_ph:
                home_es, away_es = t1_es, t2_es
                home_flag, away_flag = t1_flag, t2_flag
            else:
                home_es, away_es = t2_es, t1_es
                home_flag, away_flag = t2_flag, t1_flag
                
            expected_admin_k = f"{home_es}-{away_es}"
            
            needs_wc = ex_home != home_es or ex_away != away_es
            needs_admin = ex_admin_k != expected_admin_k
            
            if needs_wc or needs_admin:
                if needs_wc:
                    cell_updates[f"AA{r_visual}"] = home_es
                    cell_updates[f"AF{r_visual}"] = away_es
                    if home_flag: cell_updates[f"AB{r_visual}"] = home_flag
                    if away_flag: cell_updates[f"AE{r_visual}"] = away_flag
                if needs_admin:
                    admin_row = wc_row_to_admin_row(r_visual)
                    admin_updates[f"K{admin_row}"] = expected_admin_k
                
                print(f"  ✓ cruce visual {r_visual} (Partido {mid}): {home_es} {home_flag} vs {away_es} {away_flag}")
                updates_count += 1

    if cell_updates or admin_updates:
        if cell_updates:
            missing_wc = _patch_excel_cells(path, "WORLDCUP", cell_updates)
            if missing_wc:
                print(f"  ⚠ Celdas no encontradas en WORLDCUP XML: {', '.join(missing_wc)}")
        
        if admin_updates:
            missing_admin = _patch_excel_cells(path, "ADMIN", admin_updates)
            if missing_admin:
                print(f"  ⚠ Celdas no encontradas en ADMIN XML: {', '.join(missing_admin)}")
            
        print(f"💾 Excel guardado ({updates_count} cruce(s) de eliminatorias actualizado(s))")
        print(f"   → {path}")
    else:
        print("ℹ️  Cruces de eliminatorias: sin cambios")
        
    return updates_count


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
    # Save in-progress live scores (provisional overlay)
    write_live_json(games)

    # Update knockout matchups from BBC
    print("🌐 Sincronizando cruces de eliminatorias desde BBC…")
    try:
        rounds = fetch_bbc_knockout_matchups()
        if rounds:
            update_excel_knockout_matchups(file1, rounds)
            if file2 and os.path.isfile(file2):
                update_excel_knockout_matchups(file2, rounds)
        else:
            print("  ⚠️ No se pudieron descargar los cruces de eliminatorias desde BBC")
    except Exception as e:
        print(f"  ❌ Error al sincronizar cruces desde BBC: {e}")
        
    return 0


if __name__ == "__main__":
    sys.exit(main())

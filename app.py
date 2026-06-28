"""
Porra Mundial 'Los Nanos' 2026  –  Flask web dashboard
Reads ADMIN-Excel-Mundial_NANOS_2026 [1].xlsx (5 players) and
            ADMIN-Excel-Mundial_NANOS_2026 [2].xlsx (1 player: Crespo)
"""

import os, json, time, warnings, re
from datetime import datetime, timedelta
from flask import Flask, jsonify, send_from_directory
import openpyxl

warnings.filterwarnings("ignore")

BASE  = os.path.dirname(os.path.abspath(__file__))

def _excel_paths():
    from excel_sync import excel_paths
    return excel_paths()

ADMIN, FILE1, FILE2 = _excel_paths()

import urllib.request as _urllib_req

from fixture_data import lookup_fixture, TV_LABELS
from team_players import get_team_players, KEY_PLAYERS as _KEY_PLAYERS

# ── Club country map (club name → country flag + name) ─────────────────────────
# Used in _build_player_clubs() to enrich the scorers table.
_CLUB_COUNTRY = {
    # España
    "Real Madrid":"🇪🇸 España", "FC Barcelona":"🇪🇸 España", "Barcelona":"🇪🇸 España",
    "Atletico de Madrid":"🇪🇸 España", "Atlético de Madrid":"🇪🇸 España",
    "Athletic Club":"🇪🇸 España", "Real Sociedad":"🇪🇸 España", "Villarreal":"🇪🇸 España",
    "Sevilla":"🇪🇸 España", "Rayo Vallecano":"🇪🇸 España", "Valencia":"🇪🇸 España",
    # Inglaterra
    "Arsenal FC":"🇬🇧 Inglaterra", "Arsenal":"🇬🇧 Inglaterra",
    "Liverpool FC":"🇬🇧 Inglaterra", "Liverpool":"🇬🇧 Inglaterra",
    "Man City":"🇬🇧 Inglaterra", "Manchester City":"🇬🇧 Inglaterra",
    "Man United":"🇬🇧 Inglaterra", "Manchester United":"🇬🇧 Inglaterra",
    "Chelsea":"🇬🇧 Inglaterra", "Tottenham":"🇬🇧 Inglaterra",
    "Newcastle":"🇬🇧 Inglaterra", "Aston Villa":"🇬🇧 Inglaterra",
    "West Ham":"🇬🇧 Inglaterra", "Crystal Palace":"🇬🇧 Inglaterra",
    "Brighton":"🇬🇧 Inglaterra", "Fulham":"🇬🇧 Inglaterra",
    "Bournemouth":"🇬🇧 Inglaterra", "Leicester City":"🇬🇧 Inglaterra",
    "Nottm Forest":"🇬🇧 Inglaterra", "Ipswich Town":"🇬🇧 Inglaterra",
    # Alemania
    "Bayern München":"🇩🇪 Alemania", "FC Bayern München":"🇩🇪 Alemania",
    "Borussia Dortmund":"🇩🇪 Alemania", "RB Leipzig":"🇩🇪 Alemania",
    "Bayer Leverkusen":"🇩🇪 Alemania", "Mainz":"🇩🇪 Alemania",
    "SC Freiburg":"🇩🇪 Alemania", "Stuttgart":"🇩🇪 Alemania", "AGF Aarhus":"🇩🇰 Dinamarca",
    # Francia
    "PSG":"🇫🇷 Francia", "Paris Saint-Germain":"🇫🇷 Francia",
    "Olympique de Marsella":"🇫🇷 Francia", "OM Marseille":"🇫🇷 Francia",
    "OGC Niza":"🇫🇷 Francia", "Montpellier":"🇫🇷 Francia", "FC Nantes":"🇫🇷 Francia",
    "Monaco":"🇫🇷 Francia",
    # Italia
    "AC Milan":"🇮🇹 Italia", "FC Internazionale Milano":"🇮🇹 Italia",
    "Inter de Milán":"🇮🇹 Italia", "Juventus":"🇮🇹 Italia", "Roma":"🇮🇹 Italia",
    "Napoli":"🇮🇹 Italia", "Fiorentina":"🇮🇹 Italia", "Venezia FC":"🇮🇹 Italia",
    "Salernitana":"🇮🇹 Italia", "Aris Limassol":"🇨🇾 Chipre",
    # Portugal
    "Benfica":"🇵🇹 Portugal", "Porto":"🇵🇹 Portugal", "Sporting CP":"🇵🇹 Portugal",
    # Países Bajos
    "Feyenoord":"🇳🇱 Países Bajos", "PSV":"🇳🇱 Países Bajos", "Ajax":"🇳🇱 Países Bajos",
    "FC Utrecht":"🇳🇱 Países Bajos",
    # Bélgica
    "Beerschot":"🇧🇪 Bélgica",
    # Turquía
    "Galatasaray":"🇹🇷 Turquía", "Fenerbahçe SK":"🇹🇷 Turquía", "Fenerbahçe":"🇹🇷 Turquía",
    # Arabia / Medio Oriente
    "Al-Nassr":"🇸🇦 Arabia Saudita", "Al-Hilal":"🇸🇦 Arabia Saudita",
    "Al-Ahli":"🇸🇦 Arabia Saudita", "Al-Dawsari":"🇸🇦 Arabia Saudita",
    "Al-Talaba":"🇮🇶 Iraq", "Al-Zawraa":"🇮🇶 Iraq", "Al-Shorta":"🇮🇶 Iraq",
    "Al-Karma":"🇮🇶 Iraq", "Al-Dhafra":"🇦🇪 Emiratos", "Dibba Al-Hisn":"🇦🇪 Emiratos",
    "Al-Ahly":"🇪🇬 Egipto", "Al-Duhail":"🇶🇦 Qatar", "Al-Sadd":"🇶🇦 Qatar",
    "Al-Arabi":"🇶🇦 Qatar", "Al-Jazeera":"🇯🇴 Jordania", "Al-Faisaly":"🇯🇴 Jordania",
    "Al-Ramtha":"🇯🇴 Jordania", "Al-Najma":"🇧🇭 Bahréin",
    # Resto Europa
    "Cracovia":"🇵🇱 Polonia", "Pogoń Szczecin":"🇵🇱 Polonia",
    "Pakhtakor":"🇺🇿 Uzbekistán", "Port FC":"🇹🇭 Tailandia",
    "Viktoria Plzeň":"🇨🇿 Rep. Checa", "Persib Bandung":"🇮🇩 Indonesia",
    "Sarpsborg 08":"🇳🇴 Noruega",
    # América
    "Inter Miami":"🇺🇸 EE.UU.", "Nashville SC":"🇺🇸 EE.UU.",
    "New England Rev.":"🇺🇸 EE.UU.", "Atlanta United":"🇺🇸 EE.UU.",
    "Corinthians":"🇧🇷 Brasil", "Palmeiras":"🇧🇷 Brasil", "LDU Quito":"🇪🇨 Ecuador",
    "Club América":"🇲🇽 México", "Necaxa":"🇲🇽 México", "Club Tijuana":"🇲🇽 México",
    "Panathinaikos":"🇬🇷 Grecia",
    # África
    "Mamelodi Sundowns":"🇿🇦 Sudáfrica", "Espérance":"🇹🇳 Túnez",
    "Hafr Al-Batin":"🇸🇦 Arabia Saudita",
    # Varios / retirados
    "Al-Karma":"🇮🇶 Iraq", "AEK Larnaca":"🇨🇾 Chipre",
    "Retirado":"—", "Retirado/Amateur":"—", "Burton Albion":"🇬🇧 Inglaterra",
    "Wigan Athletic":"🇬🇧 Inglaterra", "Le Havre":"🇫🇷 Francia",
    "Hajduk Split":"🇭🇷 Croacia", "Torino":"🇮🇹 Italia",
    "FC Macarthur":"🇦🇺 Australia", "Celtic":"🏴󠁧󠁢󠁳󠁣󠁴󠁿 Escocia",
}

def _build_player_clubs():
    """Return dict {display_name: {club, club_country}} from KEY_PLAYERS."""
    import unicodedata as _ud
    out = {}
    for players in _KEY_PLAYERS.values():
        for p in players:
            full = p["name"]
            parts = full.split()
            display = f"{parts[0][0]}. {' '.join(parts[1:])}" if len(parts) >= 2 else full
            club = p.get("club", "")
            country = _CLUB_COUNTRY.get(club, "")
            # Store under both full name and display name for lookup flexibility
            entry = {"club": club, "club_country": country}
            out[full] = entry
            out[display] = entry
    return out

app = Flask(__name__)


@app.after_request
def _security_headers(response):
    """Cabeceras de seguridad básicas (no alteran el funcionamiento)."""
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    return response


# ── cache so we don't re-read Excel on every browser refresh ────────────────
_cache = {"data": None, "ts": 0, "error": None}
CACHE_TTL = 30  # seconds


PLAYER_COLORS = [
    "#F5C518",   # gold
    "#3B82F6",   # blue
    "#10B981",   # green
    "#F97316",   # orange
    "#A855F7",   # purple
    "#EF4444",   # red
]

PHASE_LABELS = {
    "groups":    "Fase de Grupos",
    "positions": "Posiciones Grupos",
    "q16":       "Clasificados 16avos",
    "r16":       "Dieciseisavos",
    "r8":        "Octavos",
    "r4":        "Cuartos",
    "r2":        "Semifinales",
    "r34":       "3º y 4º Puesto",
    "final":     "Final",
    "honor":     "Cuadro de Honor",
}

# ── data extraction helpers ─────────────────────────────────────────────────

def _val(ws, row, col):
    """Return cell value, converting datetime objects to ISO strings."""
    v = ws.cell(row=row, column=col).value
    if isinstance(v, datetime):
        return v.strftime("%Y-%m-%d")
    return v


def _phase_for_row(row: int) -> str:
    if 6 <= row <= 77:    return "groups"
    if 80 <= row <= 127:  return "positions"
    if 130 <= row <= 161: return "q16"
    if 163 <= row <= 179: return "r16"
    if 181 <= row <= 209: return "r8"
    if 210 <= row <= 225: return "r4"
    if 226 <= row <= 235: return "r2"
    if 236 <= row <= 238: return "r34"
    if 239 <= row <= 242: return "final"
    if 243 <= row <= 245: return "r34"
    if 246 <= row <= 248: return "final"
    return "honor"


def _parse_result(m_val):
    """Parse 'sign|score' string into dict. Returns None if not played.
    Only actual match results have the 'sign|score' pipe format."""
    if not m_val:
        return None
    s = str(m_val).strip()
    if "|" in s and s not in ("-",):
        sign, score = s.split("|", 1)
        return {"sign": sign.strip(), "score": score.strip()}
    return None  # position/team cells, TBD markers, etc.


def _parse_pred(pred_val):
    if not pred_val or str(pred_val).strip().startswith("Pegar"):
        return None
    s = str(pred_val).strip()
    # Knockout format: "EquipoLocal-EquipoVisitante·sign|score"
    # The middle dot (·) separates the team matchup from the score prediction
    pred_home = None
    pred_away = None
    if "·" in s:
        teams_part, score_part = s.split("·", 1)
        # Parse the team names (format: "TeamA-TeamB")
        if "-" in teams_part:
            # Need to handle team names with hyphens (e.g., "RD Congo", "Bosnia y Herzegovina")
            # We assume it's split at the first "-" that separates two team names
            # Use a best-effort split: try known compound names
            teams_split = teams_part.split("-", 1)
            if len(teams_split) == 2:
                pred_home = teams_split[0].strip()
                pred_away = teams_split[1].strip()
        s = score_part.strip()
    if "|" in s:
        sign, score = s.split("|", 1)
        result = {"sign": sign.strip(), "score": score.strip()}
    else:
        result = {"sign": s, "score": s}
    if pred_home:
        result["pred_home"] = pred_home
    if pred_away:
        result["pred_away"] = pred_away
    return result


def _parse_score_parts(score_str):
    if not score_str or "-" not in str(score_str):
        return None, None
    parts = str(score_str).split("-", 1)
    try:
        return int(parts[0]), int(parts[1])
    except ValueError:
        return None, None


def _result_from_goals(gl, gv):
    """Build sign|score dict from goal counts."""
    if gl is None or gv is None:
        return None
    try:
        gl, gv = int(gl), int(gv)
    except (TypeError, ValueError):
        return None
    sign = "1" if gl > gv else ("2" if gv > gl else "X")
    return {"sign": sign, "score": f"{gl}-{gv}"}


# Transliteration aliases from the API (worldcup26.ir uses Arabic/Persian transliteration)
# Format: "api_name_lowercase_no_accents" → "canonical display name"
# Explicit overrides take priority over fuzzy matching.
_SCORER_NAME_ALIASES = {
    # Kylian Mbappé
    "kilian ambaph":  "K. Mbappé",
    "kylian mbappe":  "K. Mbappé",
    "k. mbappe":      "K. Mbappé",
    # Bradley Barcola
    "brdli barkvla":  "B. Barcola",
    "bradley barcola": "B. Barcola",
    # Add explicit overrides here for names the fuzzy cannot resolve correctly
}

# Spanish team name → FIFA code (same names used as keys in live.json / scorers.json)
_TEAM_ES_TO_FIFA = {
    "México":"MEX","Sudáfrica":"RSA","Corea del Sur":"KOR","República Checa":"CZE",
    "Canadá":"CAN","Bosnia y Herzegovina":"BIH","Catar":"QAT","Qatar":"QAT","Suiza":"SUI",
    "Brasil":"BRA","Marruecos":"MAR","Haití":"HAI","Escocia":"SCO",
    "Estados Unidos":"USA","EE.UU.":"USA","Paraguay":"PRY","Australia":"AUS","Turquía":"TUR",
    "Alemania":"GER","Curazao":"CUW","Costa de Marfil":"CIV","Ecuador":"ECU",
    "Países Bajos":"NED","Japón":"JPN","Suecia":"SWE","Túnez":"TUN",
    "Bélgica":"BEL","Egipto":"EGY","Irán":"IRN","Nueva Zelanda":"NZL",
    "España":"ESP","Cabo Verde":"CPV","Arabia Saudita":"KSA","Uruguay":"URU",
    "Francia":"FRA","Senegal":"SEN","Irak":"IRQ","Iraq":"IRQ","Noruega":"NOR",
    "Argentina":"ARG","Argelia":"DZA","Austria":"AUT","Jordania":"JOR",
    "Portugal":"POR","RD Congo":"COD","R.D. Congo":"COD","Uzbekistán":"UZB","Colombia":"COL",
    "Inglaterra":"ENG","Croacia":"HRV","Ghana":"GHA","Panamá":"PAN",
    "Dinamarca":"DEN","Grecia":"GRE","Serbia":"SRB","Nigeria":"NGA",
    "Costa Rica":"CRC","Honduras":"HON","Jamaica":"JAM","Venezuela":"VEN",
    "Chile":"CHI","Bolivia":"BOL","Perú":"PER",
}

# ── Fuzzy player lookup built lazily from team_players.KEY_PLAYERS ─────────────
_PLAYER_LOOKUP = None  # dict {fifa_code: [(norm_str, display_name), ...]}, built lazily

def _build_player_lookup():
    """Build normalised lookup from KEY_PLAYERS → dict {fifa_code: [(norm, display), ...]}"""
    import unicodedata as _ud
    try:
        from team_players import KEY_PLAYERS
    except ImportError:
        return {}
    result = {}
    for fifa_code, players in KEY_PLAYERS.items():
        entries = []
        for p in players:
            full = p["name"]
            parts = full.split()
            display = f"{parts[0][0]}. {' '.join(parts[1:])}" if len(parts) >= 2 else full
            norm = _ud.normalize("NFD", full.lower().replace("-", " "))
            norm = "".join(c for c in norm if _ud.category(c) != "Mn")
            entries.append((norm, display))
        result[fifa_code] = entries
    return result

def _fuzzy_player_match(norm_key, fifa_code=None, threshold=0.68):
    """Return display name for closest squad player, or None if below threshold.
    If fifa_code is given, only searches that team's players.
    """
    global _PLAYER_LOOKUP
    if _PLAYER_LOOKUP is None:
        _PLAYER_LOOKUP = _build_player_lookup()
    if not _PLAYER_LOOKUP:
        return None
    import difflib
    tokens = norm_key.split()
    candidates = [norm_key, " ".join(reversed(tokens))]
    # Scope to one team if known, else all teams
    if fifa_code and fifa_code in _PLAYER_LOOKUP:
        entries = _PLAYER_LOOKUP[fifa_code]
    else:
        entries = [e for team_entries in _PLAYER_LOOKUP.values() for e in team_entries]
    best_score, best_display = 0.0, None
    for norm_canon, display in entries:
        for api_str in candidates:
            s = difflib.SequenceMatcher(None, api_str, norm_canon, autojunk=False).ratio()
            if s > best_score:
                best_score, best_display = s, display
    return best_display if best_score >= threshold else None

def _fix_scorer_name(name, fifa_code=None):
    """Fix API transliteration errors in scorer names.

    1. Explicit alias dict (exact known mappings).
    2. Fuzzy match scoped to the team's squad (fifa_code) when available.
    3. Return original name if nothing matches well enough.
    """
    import unicodedata as _ud
    norm = _ud.normalize("NFD", name.strip().lower())
    key  = "".join(c for c in norm if _ud.category(c) != "Mn")
    if key in _SCORER_NAME_ALIASES:
        return _SCORER_NAME_ALIASES[key]
    fuzzy = _fuzzy_player_match(key, fifa_code=fifa_code)
    return fuzzy if fuzzy else name.strip()


def _normalize_scorer(s: dict) -> dict:
    """Normalise scorer dicts that were saved with the old broken parser.

    Old issues (caused by an incorrect regex in _parse_scorers):
    - OG baked into player: {player:"D. Bobadilla 7'(OG)", minute:""}
      → {player:"D. Bobadilla", minute:"7'", own_goal:True}
    - Extra-time split: {player:"F. Balogun 45'+", minute:"5'"}
      → {player:"F. Balogun", minute:"45'+5'", own_goal:False}
    """
    import re as _re
    player  = s.get("player", "")
    minute  = s.get("minute", "")
    own_goal = bool(s.get("own_goal", False))
    penalty  = bool(s.get("penalty", False))

    # Case 1: extra-time split — player ends with "NN'+" and minute is "M'"
    m = _re.match(r"^(.*?)\s*(\d+)\s*'\s*\+\s*$", player)
    if m:
        extra = _re.match(r"^(\d+)'?$", minute.strip())
        if extra:
            return {**s, "player": _fix_scorer_name(m.group(1).strip()),
                    "minute": f"{m.group(2)}'+{extra.group(1)}'",
                    "own_goal": own_goal, "penalty": penalty}

    # Case 2: OG embedded in player with minute: "Name 7'(OG)"
    m = _re.match(r"^(.*?)\s*(\d+)\s*'?\s*\(OG\)\s*$", player, _re.IGNORECASE)
    if m:
        return {**s, "player": _fix_scorer_name(m.group(1).strip()),
                "minute": m.group(2) + "'",
                "own_goal": True, "penalty": False}

    # Case 3: penalty embedded in player: "Name 7'(P)"
    m = _re.match(r"^(.*?)\s*(\d+)\s*'?\s*\(P\)\s*$", player, _re.IGNORECASE)
    if m:
        return {**s, "player": _fix_scorer_name(m.group(1).strip()),
                "minute": m.group(2) + "'",
                "own_goal": False, "penalty": True}

    # Already OK
    return {**s, "player": _fix_scorer_name(player), "own_goal": own_goal, "penalty": penalty}


def _load_scorers():
    """Goalscorers from data/scorers.json (written by fetch_results.py).

    Returns {normalized 'home-away' key -> [{player, minute, own_goal, team}, …]}.
    """
    path = os.path.join(BASE, "data", "scorers.json")
    out = {}
    try:
        with open(path, encoding="utf-8") as fh:
            raw = json.load(fh)
    except (FileNotFoundError, ValueError):
        return out
    for key, lst in raw.items():
        if not isinstance(lst, list):
            continue
        normalised = [_normalize_scorer(s) for s in lst]
        out[key] = normalised
        out[key.replace(" ", "")] = normalised
    return out


def _lookup_scorers(scorers, match_name):
    if not match_name or not scorers:
        return []
    name = str(match_name).strip()
    if name in scorers:
        return scorers[name]
    compact = name.replace(" ", "")
    if compact in scorers:
        return scorers[compact]
    return []


def _load_live():
    """In-progress live scores from data/live.json (written by fetch_results.py).

    Returns {'home-away' key -> {home, away, minute, scorers}}. Only currently
    live matches are present; the file is rebuilt on every fetch run.
    """
    path = os.path.join(BASE, "data", "live.json")
    out = {}
    try:
        with open(path, encoding="utf-8") as fh:
            raw = json.load(fh)
    except (FileNotFoundError, ValueError):
        return out
    if not isinstance(raw, dict):
        return out
    for key, val in raw.items():
        if not isinstance(val, dict):
            continue
        # Extract home/away FIFA codes from the key ("Irak-Noruega" → IRQ, NOR)
        key_parts = key.split("-", 1)
        home_fifa = _TEAM_ES_TO_FIFA.get(key_parts[0].strip()) if len(key_parts) >= 1 else None
        away_fifa = _TEAM_ES_TO_FIFA.get(key_parts[1].strip()) if len(key_parts) >= 2 else None
        # Fix API transliteration errors in scorer names, scoped to the scorer's team
        scorers = val.get("scorers", [])
        if scorers and isinstance(scorers, list):
            def _fix_sc(sc):
                side = sc.get("team")  # "home" or "away"
                code = home_fifa if side == "home" else away_fifa
                return {**sc, "player": _fix_scorer_name(sc.get("player", ""), fifa_code=code)}
            scorers = [_fix_sc(sc) for sc in scorers]
            val = {**val, "scorers": scorers}
            # Recalculate score from scorers when API score lags behind
            # (API updates scorers list before updating home/away score fields)
            home_from_sc = sum(1 for sc in scorers if sc.get("team") == "home" and not sc.get("own_goal"))
            home_from_sc += sum(1 for sc in scorers if sc.get("team") == "away" and sc.get("own_goal"))
            away_from_sc = sum(1 for sc in scorers if sc.get("team") == "away" and not sc.get("own_goal"))
            away_from_sc += sum(1 for sc in scorers if sc.get("team") == "home" and sc.get("own_goal"))
            api_home = val.get("home", 0) or 0
            api_away = val.get("away", 0) or 0
            val = {**val,
                   "home": max(api_home, home_from_sc),
                   "away": max(api_away, away_from_sc)}
        out[key] = val
        out[key.replace(" ", "")] = val
    return out


def _lookup_live(live, match_name):
    if not match_name or not live:
        return None
    name = str(match_name).strip()
    if name in live:
        return live[name]
    compact = name.replace(" ", "")
    if compact in live:
        return live[compact]
    return None


def _build_wc_scores(filepath):
    """Goals from WORLDCUP AC/AD keyed by 'Local-Visitante' (Spanish team names)."""
    wb_val = openpyxl.load_workbook(filepath, data_only=True)
    wc_val = wb_val["WORLDCUP"]

    scores = {}
    for r in range(4, 148):
        home = wc_val.cell(r, 27).value
        away = wc_val.cell(r, 32).value
        gl   = wc_val.cell(r, 29).value
        gv   = wc_val.cell(r, 30).value
        if not home or not away or str(home).startswith("=") or str(away).startswith("="):
            continue
        if gl is None or gv is None or str(gl).strip() == "" or str(gv).strip() == "":
            continue
        try:
            gl, gv = int(gl), int(gv)
        except (TypeError, ValueError):
            continue
        key = f"{str(home).strip()}-{str(away).strip()}"
        scores[key] = (gl, gv)
        scores[key.replace(" ", "")] = (gl, gv)

    wb_val.close()
    return scores


def _build_spain_times(wb):
    """Map 'Local-Visitante' → datetime España (WORLDCUP col X)."""
    wc = wb["WORLDCUP"]
    times = {}
    for r in range(4, 148):
        aa = wc.cell(row=r, column=27).value
        af = wc.cell(row=r, column=32).value
        x  = wc.cell(row=r, column=24).value
        if not aa or not af:
            continue
        if isinstance(x, datetime):
            key = f"{aa}-{af}".strip()
            times[key] = x
            times[key.replace(" ", "")] = x
    return times


def _build_wc_match_meta(wb):
    """Metadata per WORLDCUP match: teams, flags, optional scorers."""
    wc = wb["WORLDCUP"]
    meta = {}
    for r in range(4, 148):
        home = _val(wc, r, 27)  # AA
        away = _val(wc, r, 32)  # AF
        if not home or not away or str(home) in ("Casa", "Fuera", "Fecha"):
            continue
        key = f"{str(home).strip()}-{str(away).strip()}"
        fh = _val(wc, r, 28)   # AB flag
        fa = _val(wc, r, 31)   # AE flag
        # Scorer slots (if filled in Excel with player names)
        scorers = []
        for col, team in ((5, home), (6, away), (8, home), (9, away),
                          (11, home), (12, away), (14, home), (15, away)):
            v = _val(wc, r, col)
            if not v or not isinstance(v, str):
                continue
            s = v.strip()
            if s in ("-", "") or s.startswith("P.") or "Empate" in s:
                continue
            if len(s) > 2 and not s.replace(".", "").replace(" ", "").isdigit():
                scorers.append({"team": str(team).strip(), "player": s})
        ph_h = _val(wc, r, 1)  # A
        ph_a = _val(wc, r, 2)  # B
        meta[key] = {
            "home":      str(home).strip(),
            "away":      str(away).strip(),
            "home_placeholder": str(ph_h).strip() if ph_h else "",
            "away_placeholder": str(ph_a).strip() if ph_a else "",
            "flag_home": str(fh).strip() if fh else "",
            "flag_away": str(fa).strip() if fa else "",
            "scorers":   scorers,
        }
        meta[key.replace(" ", "")] = meta[key]
    return meta


def _lookup_wc_meta(meta, match_name):
    if not match_name:
        return None
    name = str(match_name).strip()
    if name in meta:
        return meta[name]
    compact = name.replace(" ", "")
    if compact in meta:
        return meta[compact]
    for k, v in meta.items():
        if k.replace(" ", "") == compact:
            return v
    # fallback: split match name
    if "-" in name:
        parts = name.split("-", 1)
        return {"home": parts[0].strip(), "away": parts[1].strip(),
                "flag_home": "", "flag_away": "", "scorers": []}
    return None


def _lookup_spain_time(times, match_name):
    if not match_name:
        return None
    name = str(match_name).strip()
    if name in times:
        return times[name]
    compact = name.replace(" ", "")
    if compact in times:
        return times[compact]
    for k, v in times.items():
        if k.replace(" ", "") == compact:
            return v
    return None


def _score_breakdown(pred, result, goals_l, goals_v,
                     pts_sign=2, pts_diff=1, pts_exact=3,
                     diff_factor=1.0, multiplier=1):
    """Replica la lógica de puntuación de fase de grupos del Excel."""
    empty = {"sign": 0, "diff": 0, "exact": 0, "total": 0, "reasons": []}
    if not pred or not result:
        return empty

    pred_sign = pred.get("sign", "")
    pred_score = pred.get("score", "")
    res_sign = result.get("sign", "")
    res_score = result.get("score", "")

    if goals_l is None or goals_v is None:
        gl, gv = _parse_score_parts(res_score)
        goals_l = gl if gl is not None else 0
        goals_v = gv if gv is not None else 0

    full_pred = f"{pred_sign}|{pred_score}"
    full_res  = f"{res_sign}|{res_score}"

    if full_pred == full_res:
        reasons = [
            f"1X2 correcto (+{pts_sign})",
            f"Diferencia de goles (+{pts_diff})",
            f"Resultado exacto (+{pts_exact})",
        ]
        total = (pts_sign + pts_diff + pts_exact) * multiplier
        return {
            "sign": pts_sign * multiplier,
            "diff": pts_diff * multiplier,
            "exact": pts_exact * multiplier,
            "total": total,
            "reasons": reasons,
        }

    reasons = []
    sign_pts = diff_pts = 0

    if pred_sign == res_sign:
        sign_pts = pts_sign
        reasons.append(f"1X2 correcto (+{pts_sign})")

        pl, pv = _parse_score_parts(pred_score)
        if pl is not None and pv is not None:
            actual_diff = abs(int(goals_l) - int(goals_v))
            if pred_sign == "X":
                pred_diff = abs(pl - pv)
                diff_error = abs(actual_diff - pred_diff)
            else:
                pred_diff = abs(pl - pv)
                diff_error = abs(actual_diff - pred_diff)

            raw_diff = pts_diff * (1 - diff_error * diff_factor)
            diff_pts = max(0, round(raw_diff, 2))
            if diff_pts > 0:
                reasons.append(f"Diferencia de goles (+{diff_pts:g})")
            else:
                reasons.append("Diferencia de goles no acertada")
    else:
        reasons.append("1X2 incorrecto — 0 pts")

    total = round((sign_pts + diff_pts) * multiplier, 2)
    return {
        "sign": sign_pts * multiplier,
        "diff": diff_pts * multiplier,
        "exact": 0,
        "total": total,
        "reasons": reasons,
    }


def _week_ranges_from_dates(dates):
    """Build calendar-week filter ranges from match datetimes."""
    if not dates:
        return []
    start = min(dates).date()
    end   = max(dates).date()
    months_es = {1:"Ene",2:"Feb",3:"Mar",4:"Abr",5:"May",6:"Jun",
                 7:"Jul",8:"Ago",9:"Sep",10:"Oct",11:"Nov",12:"Dic"}
    weeks = []
    cur = start - timedelta(days=start.weekday())  # Monday
    idx = 1
    while cur <= end:
        w_end = cur + timedelta(days=6)
        m1 = months_es[cur.month]
        m2 = months_es[w_end.month]
        if cur.month == w_end.month:
            label = f"{cur.day}–{w_end.day} {m1}"
        else:
            label = f"{cur.day} {m1} – {w_end.day} {m2}"
        weeks.append({
            "id":    f"w{idx}",
            "label": label,
            "from":  cur.isoformat(),
            "to":    w_end.isoformat(),
        })
        cur += timedelta(days=7)
        idx += 1
    return weeks


STANDINGS_PHASES = [
    ("groups",    "Fase de Grupos",     "Partidos + marcadores"),
    ("positions", "Posiciones Grupos",  "1º, 2º, 3º y 4º por grupo"),
    ("q16",       "Clasificados 16avos","Equipos que pasan a dieciseisavos"),
    ("r16",       "Dieciseisavos",      "Partidos de 16avos"),
    ("r8",        "Octavos",            "Partidos de octavos"),
    ("r4",        "Cuartos",            "Partidos de cuartos"),
    ("r2",        "Semifinales",        "Partidos de semifinales"),
    ("r34_final", "3º puesto + Final",  "Partido 3º/4º y final"),
    ("honor",     "Cuadro de Honor",    "Campeón, botas, balones"),
]

_MONTHS_ES = {1:"ene",2:"feb",3:"mar",4:"abr",5:"may",6:"jun",
              7:"jul",8:"ago",9:"sep",10:"oct",11:"nov",12:"dic"}

STRENGTH_SKILLS = [
    {"key": "hits_exact",    "label": "Resultados exactos",    "icon": "🎯", "sort": "count"},
    {"key": "hits_diff",     "label": "Diferencia de goles",   "icon": "📐", "sort": "count"},
    {"key": "hits_1x2",      "label": "Signo 1X2",             "icon": "1️⃣", "sort": "count"},
    {"key": "goals_home",    "label": "Goles local exactos",   "icon": "🏠", "sort": "count"},
    {"key": "goals_away",    "label": "Goles visitante exactos","icon": "✈️", "sort": "count"},
    {"key": "avg_match",     "label": "Media pts/partido",     "icon": "⚡", "sort": "value"},
    {"key": "hit_rate",      "label": "Tasa de acierto",       "icon": "✅", "sort": "value"},
    {"key": "phase_positions","label": "Posiciones de grupos", "icon": "📊", "sort": "value"},
    {"key": "phase_q16",     "label": "Clasificados 16avos",  "icon": "🏁", "sort": "value"},
    {"key": "phase_ko",      "label": "Eliminatorias (KO)",   "icon": "⚔️", "sort": "value"},
    {"key": "phase_honor",   "label": "Cuadro de honor",      "icon": "🏆", "sort": "value"},
]

STRENGTH_BADGES = {
    "hits_exact":     "Francotirador",
    "hits_diff":      "Ojo clínico (dif.)",
    "hits_1x2":       "Rey del 1X2",
    "goals_home":     "Goles local",
    "goals_away":     "Goles visitante",
    "avg_match":      "Rendimiento puro",
    "hit_rate":       "Consistente",
    "phase_positions":"Estratega de grupos",
    "phase_q16":      "Visionario 16avos",
    "phase_ko":       "Maestro KO",
    "phase_honor":    "Oráculo del honor",
}


def _build_player_strengths(matches, standings, player_names):
    """Per-player skill stats and cross-player rankings."""
    group_played = [m for m in matches if m["phase"] == "groups" and m["played"]]
    colors = {s["name"]: s["color"] for s in standings}

    raw = {}
    for name in player_names:
        st = standings[[x["name"] for x in standings].index(name)] if name in [x["name"] for x in standings] else {}
        ko_pts = sum(float(st.get(k, 0) or 0) for k in ("r16", "r8", "r4", "r2", "r34_final"))
        raw[name] = {
            "hits_1x2": 0, "pts_1x2": 0.0,
            "hits_diff": 0, "pts_diff": 0.0,
            "hits_exact": 0, "pts_exact": 0.0,
            "goals_home": 0, "goals_away": 0,
            "matches": 0, "hits_any": 0, "pts_groups": 0.0,
            "phase_positions": float(st.get("positions", 0) or 0),
            "phase_q16": float(st.get("q16", 0) or 0),
            "phase_ko": ko_pts,
            "phase_honor": float(st.get("honor", 0) or 0),
        }

    for m in group_played:
        gl, gv = m.get("goals_l"), m.get("goals_v")
        for name in player_names:
            pd = m["predictions"].get(name, {})
            pred = pd.get("pred")
            if not pred:
                continue
            s = raw[name]
            s["matches"] += 1
            score = float(pd.get("score") or 0)
            s["pts_groups"] += score
            if score > 0:
                s["hits_any"] += 1
            brk = pd.get("breakdown") or {}
            if brk.get("sign", 0) > 0:
                s["hits_1x2"] += 1
                s["pts_1x2"] += float(brk["sign"])
            if brk.get("diff", 0) > 0:
                s["hits_diff"] += 1
                s["pts_diff"] += float(brk["diff"])
            if brk.get("exact", 0) > 0:
                s["hits_exact"] += 1
                s["pts_exact"] += float(brk["exact"])
            pl, pv = _parse_score_parts(pred.get("score", ""))
            if pl is not None and gl is not None and pl == int(gl):
                s["goals_home"] += 1
            if pv is not None and gv is not None and pv == int(gv):
                s["goals_away"] += 1

    # Build comparable values per skill
    skill_values = {sk["key"]: {} for sk in STRENGTH_SKILLS}
    for name, s in raw.items():
        n = s["matches"] or 0
        skill_values["hits_exact"][name]     = {"count": s["hits_exact"], "pts": s["pts_exact"]}
        skill_values["hits_diff"][name]      = {"count": s["hits_diff"],  "pts": s["pts_diff"]}
        skill_values["hits_1x2"][name]       = {"count": s["hits_1x2"],   "pts": s["pts_1x2"]}
        skill_values["goals_home"][name]     = {"count": s["goals_home"]}
        skill_values["goals_away"][name]     = {"count": s["goals_away"]}
        skill_values["avg_match"][name]      = {"value": round(s["pts_groups"] / n, 2) if n else 0}
        skill_values["hit_rate"][name]       = {"value": round(100 * s["hits_any"] / n) if n else 0, "hits": s["hits_any"], "total": n}
        skill_values["phase_positions"][name]= {"value": s["phase_positions"]}
        skill_values["phase_q16"][name]      = {"value": s["phase_q16"]}
        skill_values["phase_ko"][name]       = {"value": s["phase_ko"]}
        skill_values["phase_honor"][name]    = {"value": s["phase_honor"]}

    def _sort_key(skill_key, name):
        v = skill_values[skill_key][name]
        sk = next(x for x in STRENGTH_SKILLS if x["key"] == skill_key)
        if sk["sort"] == "count":
            return (v.get("count", 0), v.get("pts", 0))
        return (v.get("value", 0),)

    rankings = {}
    ranks_for_player = {name: {} for name in player_names}
    for sk in STRENGTH_SKILLS:
        key = sk["key"]
        ordered = sorted(player_names, key=lambda n: _sort_key(key, n), reverse=True)
        rows = []
        for i, name in enumerate(ordered):
            rank = i + 1
            ranks_for_player[name][key] = rank
            v = skill_values[key][name]
            if key in ("hits_exact", "hits_diff", "hits_1x2"):
                display = f"{v['count']} aciertos · {v.get('pts', 0):.0f} pts"
            elif key in ("goals_home", "goals_away"):
                display = f"{v['count']} aciertos"
            elif key == "avg_match":
                display = f"{v['value']:.2f} pts/partido"
            elif key == "hit_rate":
                display = f"{v['value']}% ({v.get('hits', 0)}/{v.get('total', 0)})"
            else:
                display = f"{v['value']:.0f} pts"
            rows.append({
                "rank": rank, "name": name, "color": colors.get(name, "#888"),
                "display": display,
                "value": v.get("count", v.get("value", 0)),
            })
        rankings[key] = rows

    players_out = []
    for st_row in standings:
        name = st_row["name"]
        s = raw[name]
        n = s["matches"]
        # Top 4 skills by rank (lowest rank number = best)
        ranked_skills = sorted(
            [(k, r) for k, r in ranks_for_player[name].items()],
            key=lambda x: (x[1], -_sort_key(x[0], name)[0] if isinstance(_sort_key(x[0], name)[0], (int, float)) else 0),
        )
        top_skills = []
        badges = []
        for key, rank in ranked_skills[:5]:
            sk = next(x for x in STRENGTH_SKILLS if x["key"] == key)
            v = skill_values[key][name]
            # Skip zero-value skills unless nothing else
            has_value = (
                v.get("count", 0) > 0 or v.get("value", 0) > 0 or v.get("pts", 0) > 0
            )
            if not has_value and len(top_skills) >= 1:
                continue
            row = next(r for r in rankings[key] if r["name"] == name)
            top_skills.append({
                "key": key, "label": sk["label"], "icon": sk["icon"],
                "rank": rank, "display": row["display"],
            })
            if rank == 1 and has_value:
                badges.append({"icon": sk["icon"], "label": STRENGTH_BADGES.get(key, sk["label"])})
            if len(top_skills) >= 4:
                break

        # Best scoring phase (from standings columns)
        phase_scores = [
            ("groups", float(st_row.get("groups", 0) or 0), "Fase de grupos"),
            ("positions", float(st_row.get("positions", 0) or 0), "Posiciones"),
            ("q16", float(st_row.get("q16", 0) or 0), "Cl. 16avos"),
            ("ko", s["phase_ko"], "Eliminatorias"),
            ("honor", s["phase_honor"], "Cuadro de honor"),
        ]
        phase_scores = [p for p in phase_scores if p[1] > 0]
        best_phase = max(phase_scores, key=lambda x: x[1]) if phase_scores else None

        players_out.append({
            "name": name,
            "color": st_row["color"],
            "pos": st_row["pos"],
            "matches_played": n,
            "stats": {
                "hits_1x2": s["hits_1x2"], "pts_1x2": s["pts_1x2"],
                "hits_diff": s["hits_diff"], "pts_diff": s["pts_diff"],
                "hits_exact": s["hits_exact"], "pts_exact": s["pts_exact"],
                "goals_home": s["goals_home"], "goals_away": s["goals_away"],
                "hit_rate": skill_values["hit_rate"][name]["value"],
                "avg_match": skill_values["avg_match"][name]["value"],
            },
            "ranks": ranks_for_player[name],
            "top_skills": top_skills,
            "badges": badges[:2],
            "best_phase": {"label": best_phase[2], "pts": best_phase[1]} if best_phase else None,
        })

    return {"players": players_out, "rankings": rankings, "skills": STRENGTH_SKILLS}


def _load_scoring_rules(ws):
    """Read all scoring criteria from ADMIN rows 8-47."""
    sections = [
        ("groups_match", "Fase de Grupos — Partidos",        range(8,  11)),
        ("groups_pos",   "Fase de Grupos — Posiciones",      range(11, 15)),
        ("q16_team",     "Clasificados Dieciseisavos",       range(15, 16)),
        ("r16",          "Dieciseisavos de Final",           range(16, 19)),
        ("r8_team",      "Clasificados Octavos",             range(19, 20)),
        ("r8",           "Octavos de Final",                 range(20, 23)),
        ("r4_team",      "Clasificados Cuartos",             range(23, 24)),
        ("r4",           "Cuartos de Final",                 range(24, 27)),
        ("r2_team",      "Clasificados Semifinales",         range(27, 28)),
        ("r2",           "Semifinales",                      range(28, 31)),
        ("r34_team",     "Clasificados 3º y 4º Puesto",      range(31, 32)),
        ("final_team",   "Clasificados Final",               range(32, 33)),
        ("r34",          "3º y 4º Puesto",                   range(33, 36)),
        ("final",        "Final",                            range(36, 39)),
        ("honor",        "Cuadro de Honor",                  range(39, 48)),
    ]
    result = []
    for key, title, rows in sections:
        items = []
        for r in rows:
            label = _val(ws, r, 3)
            pts   = _val(ws, r, 4)
            if not label or pts is None:
                continue
            try:
                pts = float(pts)
            except (ValueError, TypeError):
                continue
            # Clean label — remove redundant prefix
            lbl = str(label).strip()
            items.append({"label": lbl, "pts": pts})
        if items:
            result.append({"key": key, "title": title, "items": items})

    diff_adj = _val(ws, 50, 4)
    try:
        diff_adj = float(diff_adj) if diff_adj is not None else 0
    except (ValueError, TypeError):
        diff_adj = 0

    max_group_match = sum(i["pts"] for s in result if s["key"] == "groups_match" for i in s["items"])

    return {
        "sections":    result,
        "diff_adjustment": diff_adj,
        "max_per_group_match": max_group_match,
    }


def _parse_honor_actual(val):
    """Return real honor result or None if placeholder / TBD."""
    if val is None:
        return None
    s = str(val).strip()
    if not s or s in ("WF", "LF", "W34", "None", "-"):
        return None
    low = s.lower()
    if low.startswith("escribe") or low.startswith("pegar"):
        return None
    return _normalize_honor_name(s)


# Mapa de aliases → nombre canónico para predicciones de honor
_HONOR_NAME_ALIASES = {
    # Harry Kane
    "Kane":        "Harry Kane",
    "H. Kane":     "Harry Kane",
    "H.Kane":      "Harry Kane",
    # Cristiano Ronaldo
    "CR7":         "Cristiano Ronaldo",
    "Cristiano":   "Cristiano Ronaldo",
    "C. Ronaldo":  "Cristiano Ronaldo",
    # Vinicius Jr.
    "Vini":        "Vinicius Jr.",
    "Vini Jr":     "Vinicius Jr.",
    "Vini Jr.":    "Vinicius Jr.",
    "Vinicius":    "Vinicius Jr.",
    # Mbappé
    "Mbappe":      "Mbappé",
    "Mbappe´":     "Mbappé",
    # Oyarzabal
    "M. Oyarzabal": "Oyarzabal",
    # Haaland
    "Erling Haaland": "Haaland",
    "E. Haaland":  "Haaland",
}

def _normalize_honor_name(name):
    """Aplica aliases al nombre canónico de un jugador de honor."""
    if not name:
        return name
    return _HONOR_NAME_ALIASES.get(name.strip(), name.strip())


def _abbr_team(name):
    """3 letras en mayúscula para etiqueta compacta del eje X."""
    letters = [c for c in str(name) if c.isalpha()]
    return "".join(letters[:3]).upper() if letters else "?"


def _build_daily_progression(matches, player_names, player_positions_pts=None, all_groups_finished=False):
    """Puntos acumulados tras cada partido jugado (orden cronológico)."""
    group = [m for m in matches
             if m["phase"] == "groups" and m.get("played") and m.get("date")]
    if not group:
        return {"labels": [], "flag_labels": [], "dates": [], "titles": [],
                "players": {n: [] for n in player_names},
                "day_points": {n: [] for n in player_names}}

    # Orden cronológico: fecha + hora España
    group.sort(key=lambda m: (m.get("date", ""), m.get("time_es", "")))

    cumulative  = {n: 0.0 for n in player_names}
    players_out = {n: [] for n in player_names}
    day_points  = {n: [] for n in player_names}
    labels      = []
    flag_labels = []
    dates  = []
    titles = []

    for m in group:
        for n in player_names:
            earned = m["predictions"][n]["score"]
            cumulative[n] = round(cumulative[n] + earned, 1)
            players_out[n].append(cumulative[n])
            day_points[n].append(round(earned, 1))

        ab = f"{_abbr_team(m.get('home'))}-{_abbr_team(m.get('away'))}"
        labels.append(ab)
        fh = m.get("flag_home", "")
        fa = m.get("flag_away", "")
        flag_labels.append(f"{fh}{fa}" if (fh or fa) else ab)
        dates.append(m.get("date", ""))

        gl, gv = m.get("goals_l"), m.get("goals_v")
        score = f" {gl}-{gv} " if gl is not None and gv is not None else " vs "
        title = f"{m.get('home','')}{score}{m.get('away','')}"
        dt_part = ""
        if m.get("date"):
            try:
                dt = datetime.strptime(m["date"], "%Y-%m-%d")
                dt_part = f" · {dt.day} {_MONTHS_ES[dt.month]}"
            except ValueError:
                pass
        titles.append(title + dt_part)

    # Si la fase de grupos ha terminado, añadimos un paso final para los puntos de posiciones de grupo
    if all_groups_finished and player_positions_pts:
        labels.append("Pos. Grupos")
        flag_labels.append("🏆")
        last_date = dates[-1] if dates else datetime.now().strftime("%Y-%m-%d")
        dates.append(last_date)
        titles.append("Posiciones de Fase de Grupos")
        for n in player_names:
            pos_earned = player_positions_pts.get(n, 0.0)
            cumulative[n] = round(cumulative[n] + pos_earned, 1)
            players_out[n].append(cumulative[n])
            day_points[n].append(round(pos_earned, 1))

    return {
        "labels":      labels,
        "flag_labels": flag_labels,
        "dates":       dates,
        "titles":      titles,
        "players":     players_out,
        "day_points":  day_points,
    }


def _load_file1():
    """Load 5 players from file [1]."""
    wb = openpyxl.load_workbook(FILE1, data_only=True)
    ws = wb["ADMIN"]
    players = []
    # col indices: (name_col, pred_col, score_col)
    defs = [
        ("S", 19, 19, 20),   # player letter, name_row5_col, pred_col, score_col
        ("V", 22, 22, 23),
        ("Y", 25, 25, 26),
        ("AB", 28, 28, 29),
        ("AE", 31, 31, 32),
    ]
    for letter, nc, pc, sc in defs:
        name = _val(ws, 5, nc)
        if not name or str(name).startswith("Pegar"):
            continue
        players.append({
            "name": str(name).strip(),
            "pred_col": pc,
            "score_col": sc,
        })

    clas_ws = wb["CLAS"]
    # read phase breakdowns from CLAS rows 5-9
    clas_data = {}
    for r in range(5, 10):
        player_name = _val(clas_ws, r, 3)
        if not player_name:
            continue
        clas_data[str(player_name).strip()] = {
            "total": _val(clas_ws, r, 4) or 0,
            "groups":    _val(clas_ws, r, 5)  or 0,
            "positions": _val(clas_ws, r, 6)  or 0,
            "q16":       _val(clas_ws, r, 7)  or 0,
            "r16":       _val(clas_ws, r, 8)  or 0,
            "r8":        _val(clas_ws, r, 9)  or 0,
            "r4":        _val(clas_ws, r, 10) or 0,
            "r2":        _val(clas_ws, r, 11) or 0,
            "r34_final": _val(clas_ws, r, 12) or 0,
            "honor":     _val(clas_ws, r, 13) or 0,
        }
    return ws, players, clas_data


def _load_file2():
    """Load Crespo from file [2]."""
    wb = openpyxl.load_workbook(FILE2, data_only=True)
    ws = wb["ADMIN"]
    name = _val(ws, 5, 19)
    if not name or str(name).startswith("Pegar"):
        name = "Crespo"
    player = {
        "name": str(name).strip(),
        "pred_col": 19,
        "score_col": 20,
    }
    clas_ws = wb["CLAS"]
    clas_data = {}
    for r in range(5, 10):
        player_name = _val(clas_ws, r, 3)
        if not player_name or str(player_name).startswith("Pegar"):
            continue
        clas_data[str(player_name).strip()] = {
            "total":     _val(clas_ws, r, 4)  or 0,
            "groups":    _val(clas_ws, r, 5)  or 0,
            "positions": _val(clas_ws, r, 6)  or 0,
            "q16":       _val(clas_ws, r, 7)  or 0,
            "r16":       _val(clas_ws, r, 8)  or 0,
            "r8":        _val(clas_ws, r, 9)  or 0,
            "r4":        _val(clas_ws, r, 10) or 0,
            "r2":        _val(clas_ws, r, 11) or 0,
            "r34_final": _val(clas_ws, r, 12) or 0,
            "honor":     _val(clas_ws, r, 13) or 0,
        }
    return ws, player, clas_data


def build_data():
    """Read both Excel files and return complete dashboard data."""
    global ADMIN, FILE1, FILE2
    ADMIN, FILE1, FILE2 = _excel_paths()

    wb1_raw = openpyxl.load_workbook(FILE1, data_only=True)
    ws1, players1, clas1 = _load_file1()
    ws2, player2, clas2  = _load_file2()

    spain_times = _build_spain_times(wb1_raw)
    wc_meta     = _build_wc_match_meta(wb1_raw)
    wc_scores   = _build_wc_scores(FILE1)
    wc_scorers  = _load_scorers()
    wc_live     = _load_live()
    pts_sign  = float(_val(ws1, 8,  4) or 2)
    pts_diff  = float(_val(ws1, 9,  4) or 1)
    pts_exact = float(_val(ws1, 10, 4) or 3)
    diff_factor = float(_val(ws1, 50, 4) or 1)

    # ── Puntos de fases de eliminación (leídos del Excel, filas 16-38) ──
    KO_PHASE_PTS = {
        "r16":   {"sign": float(_val(ws1, 16, 4) or 3), "diff": float(_val(ws1, 17, 4) or 2), "exact": float(_val(ws1, 18, 4) or 4)},
        "r8":    {"sign": float(_val(ws1, 20, 4) or 4), "diff": float(_val(ws1, 21, 4) or 3), "exact": float(_val(ws1, 22, 4) or 5)},
        "r4":    {"sign": float(_val(ws1, 24, 4) or 5), "diff": float(_val(ws1, 25, 4) or 4), "exact": float(_val(ws1, 26, 4) or 6)},
        "r2":    {"sign": float(_val(ws1, 28, 4) or 6), "diff": float(_val(ws1, 29, 4) or 5), "exact": float(_val(ws1, 30, 4) or 8)},
        "r34":   {"sign": float(_val(ws1, 33, 4) or 6), "diff": float(_val(ws1, 34, 4) or 5), "exact": float(_val(ws1, 35, 4) or 8)},
        "final": {"sign": float(_val(ws1, 36, 4) or 8), "diff": float(_val(ws1, 37, 4) or 6), "exact": float(_val(ws1, 38, 4) or 12)},
    }
    # Mapeamos las fases del Excel (r34 y final) a las claves de standings (r34_final)
    _KO_STANDINGS_KEY = {"r16": "r16", "r8": "r8", "r4": "r4", "r2": "r2", "r34": "r34_final", "final": "r34_final"}

    all_players = players1 + [player2]
    all_ws      = [ws1] * len(players1) + [ws2]
    all_clas    = {**clas1, **clas2}

    player_names = [p["name"] for p in all_players]

    # ── collect all matches / prediction rows ────────────────────────────────
    matches = []
    played_count = {p["name"]: 0 for p in all_players}
    # Puntos de fase de grupos recalculados en Python (no dependen de la caché
    # de fórmulas del Excel, que NO se recalcula al escribir marcadores por la
    # API). Así la actualización automática refleja siempre los puntos correctos.
    group_points = {p["name"]: 0.0 for p in all_players}
    # Puntos de fases de eliminación también calculados en Python.
    ko_points    = {ph: {p["name"]: 0.0 for p in all_players} for ph in KO_PHASE_PTS}
    # Puntos provisionales de partidos EN CURSO (overlay no oficial). No se
    # suman a group_points; alimentan la clasificación provisional de la web.
    live_points  = {p["name"]: 0.0 for p in all_players}
    live_match_names = []
    spain_dates  = []

    for row in range(6, 268):
        match_name = _val(ws1, row, 11)  # K
        if not match_name or str(match_name).strip() in ("", "None"):
            continue

        phase = _phase_for_row(row)
        match_id = _val(ws1, row, 10)    # J
        result_raw = _val(ws1, row, 13)  # M

        goals_l = _val(ws1, row, 15)   # O
        goals_v = _val(ws1, row, 16)   # P
        mkey = str(match_name).strip()
        if mkey in wc_scores:
            goals_l, goals_v = wc_scores[mkey]
            result = _result_from_goals(goals_l, goals_v)
            played = result is not None
        else:
            result = _parse_result(result_raw)
            played = result is not None
        mult_raw = _val(ws1, row, 9)
        try:
            multiplier = float(mult_raw) if mult_raw is not None else 1.0
        except (ValueError, TypeError):
            multiplier = 1.0

        # Spain datetime
        spain_dt = _lookup_spain_time(spain_times, match_name)
        if spain_dt:
            spain_dates.append(spain_dt)
            date_es  = spain_dt.strftime("%Y-%m-%d")
            time_es  = spain_dt.strftime("%H:%M")
            day_label = spain_dt.strftime("%A %d %B").replace(
                "Monday", "Lunes").replace("Tuesday", "Martes").replace(
                "Wednesday", "Miércoles").replace("Thursday", "Jueves").replace(
                "Friday", "Viernes").replace("Saturday", "Sábado").replace(
                "Sunday", "Domingo")
            # Spanish month names
            for en, es in [("January","enero"),("February","febrero"),("March","marzo"),
                           ("April","abril"),("May","mayo"),("June","junio"),
                           ("July","julio"),("August","agosto"),("September","septiembre"),
                           ("October","octubre"),("November","noviembre"),("December","diciembre")]:
                day_label = day_label.replace(en, es)
        else:
            h_val = _val(ws1, row, 8)
            date_es = str(h_val)[:10] if h_val else ""
            time_es = ""
            day_label = date_es

        predictions = {}
        # ── overlay EN CURSO: solo si el partido no está finalizado en Excel ──
        live_info = None
        if not played:
            li = _lookup_live(wc_live, match_name)
            if li is not None:
                try:
                    lgl = int(li.get("home"))
                    lgv = int(li.get("away"))
                except (TypeError, ValueError):
                    lgl = lgv = None
                if lgl is not None and lgv is not None:
                    live_info = {
                        "goals_l": lgl,
                        "goals_v": lgv,
                        "minute":  str(li.get("minute", "")).strip(),
                        "result":  _result_from_goals(lgl, lgv),
                        "scorers": li.get("scorers", []),
                    }
                    live_match_names.append(str(match_name).strip())

        wc = _lookup_wc_meta(wc_meta, match_name) or {}  # needed before player loop for team matching
        for p, ws in zip(all_players, all_ws):
            pred_raw  = _val(ws, row, p["pred_col"])
            score_raw = _val(ws, row, p["score_col"])
            pred  = _parse_pred(pred_raw)
            score = float(score_raw) if score_raw is not None else 0

            breakdown = None
            live_breakdown = None
            if played and phase == "groups" and pred and "|" in str(pred_raw or ""):
                gl = int(goals_l) if goals_l is not None else None
                gv = int(goals_v) if goals_v is not None else None
                breakdown = _score_breakdown(
                    pred, result, gl, gv,
                    pts_sign, pts_diff, pts_exact,
                    diff_factor, multiplier,
                )
                # El punto calculado en Python manda sobre la fórmula del Excel
                # (que puede estar desactualizada tras una actualización automática).
                score = breakdown["total"]
                group_points[p["name"]] += breakdown["total"]
            elif played and phase in KO_PHASE_PTS and pred and "|" in str(pred_raw or ""):
                # Fases de eliminación: puntos calculados en Python igual que grupos.
                # Primero verificamos si el jugador prediøjo los equipos correctos.
                gl = int(goals_l) if goals_l is not None else None
                gv = int(goals_v) if goals_v is not None else None
                actual_home = wc.get("home", "")
                actual_away = wc.get("away", "")
                ph = pred.get("pred_home", "")
                pa = pred.get("pred_away", "")
                home_ok = bool(ph and actual_home and ph.strip() == actual_home.strip())
                away_ok = bool(pa and actual_away and pa.strip() == actual_away.strip())
                # team_match: 'both', 'home', 'away', 'none', or None if no team pred
                if ph and pa:
                    if home_ok and away_ok:
                        team_match = "both"
                    elif home_ok:
                        team_match = "home"
                    elif away_ok:
                        team_match = "away"
                    else:
                        team_match = "none"
                else:
                    team_match = None
                ko_cfg = KO_PHASE_PTS[phase]
                breakdown = _score_breakdown(
                    pred, result, gl, gv,
                    ko_cfg["sign"], ko_cfg["diff"], ko_cfg["exact"],
                    diff_factor, multiplier,
                )
                # Si el jugador puso equipos equivocados en AMBOS, sus puntos son 0
                if team_match == "none":
                    breakdown = {**breakdown, "total": 0.0, "sign": 0.0, "diff": 0.0, "exact": 0.0,
                                 "reasons": ["Equipos incorrectos (0 pts)"]}
                breakdown["team_match"] = team_match
                breakdown["pred_home"] = ph
                breakdown["pred_away"] = pa
                score = breakdown["total"]
                ko_points[phase][p["name"]] += breakdown["total"]
            elif live_info and phase == "groups" and pred and "|" in str(pred_raw or ""):
                # Puntos provisionales del partido en curso (no oficiales).
                live_breakdown = _score_breakdown(
                    pred, live_info["result"],
                    live_info["goals_l"], live_info["goals_v"],
                    pts_sign, pts_diff, pts_exact,
                    diff_factor, multiplier,
                )
                live_points[p["name"]] += live_breakdown["total"]
            elif live_info and phase in KO_PHASE_PTS and pred and "|" in str(pred_raw or ""):
                # Puntos provisionales EN CURSO para fases KO.
                actual_home = wc.get("home", "")
                actual_away = wc.get("away", "")
                ph = pred.get("pred_home", "")
                pa = pred.get("pred_away", "")
                home_ok = bool(ph and actual_home and ph.strip() == actual_home.strip())
                away_ok = bool(pa and actual_away and pa.strip() == actual_away.strip())
                if ph and pa:
                    team_match = "both" if (home_ok and away_ok) else ("home" if home_ok else ("away" if away_ok else "none"))
                else:
                    team_match = None
                ko_cfg = KO_PHASE_PTS[phase]
                live_breakdown = _score_breakdown(
                    pred, live_info["result"],
                    live_info["goals_l"], live_info["goals_v"],
                    ko_cfg["sign"], ko_cfg["diff"], ko_cfg["exact"],
                    diff_factor, multiplier,
                )
                if team_match == "none":
                    live_breakdown = {**live_breakdown, "total": 0.0, "sign": 0.0, "diff": 0.0, "exact": 0.0,
                                      "reasons": ["Equipos incorrectos (0 pts)"]}
                live_breakdown["team_match"] = team_match
                live_breakdown["pred_home"] = ph
                live_breakdown["pred_away"] = pa
                live_points[p["name"]] += live_breakdown["total"]

            predictions[p["name"]] = {
                "pred":      pred,
                "score":     score,
                "breakdown": breakdown,
                "live_breakdown": live_breakdown,
                "live_score":     live_breakdown["total"] if live_breakdown else None,
            }

        if phase == "groups" and played:
            for name in player_names:
                played_count[name] += 1

        fix = lookup_fixture(row)
        matches.append({
            "row":       row,
            "id":        str(match_id) if match_id else "",
            "name":      str(match_name).strip(),
            "home":      wc.get("home", ""),
            "away":      wc.get("away", ""),
            "home_placeholder": wc.get("home_placeholder", ""),
            "away_placeholder": wc.get("away_placeholder", ""),
            "flag_home": wc.get("flag_home", ""),
            "flag_away": wc.get("flag_away", ""),
            "city":       fix.get("city", ""),
            "country":    fix.get("country", ""),
            "tv":         "both" if (wc.get("home", "") == "España" or wc.get("away", "") == "España") else fix.get("tv", ""),
            "tv_label":   TV_LABELS.get("both" if (wc.get("home", "") == "España" or wc.get("away", "") == "España") else fix.get("tv", ""), ""),
            "stadium":    fix.get("stadium", ""),
            "lat":        fix.get("lat"),
            "lon":        fix.get("lon"),
            "capacity":   fix.get("capacity"),
            "city_pop":   fix.get("city_pop", ""),
            "venue_fact": fix.get("fact", ""),
            "wiki":       fix.get("wiki", ""),
            "date":      date_es,
            "time_es":   time_es,
            "day_label": day_label,
            "datetime_es": spain_dt.isoformat() if spain_dt else date_es,
            "phase":     phase,
            "result":    result,
            "played":    played,
            "live":      bool(live_info),
            "live_minute":  live_info["minute"] if live_info else "",
            "live_goals_l": live_info["goals_l"] if live_info else None,
            "live_goals_v": live_info["goals_v"] if live_info else None,
            "live_scorers": live_info["scorers"] if live_info else [],
            "goals_l":   int(goals_l) if (played and goals_l is not None) else None,
            "goals_v":   int(goals_v) if (played and goals_v is not None) else None,
            "scorers":   _lookup_scorers(wc_scorers, match_name) if played else [],
            "phase_pts":  KO_PHASE_PTS.get(phase),  # puntos posibles por criterio para este partido
            "predictions": predictions,
        })

    # ── Recalcular puntos de posiciones de grupo y clasificados a 16avos ──
    # Para evitar depender de la caché de fórmulas de Excel, que no se actualiza
    # al escribir datos programáticamente.
    actual_standings = {}
    group_matches_count = {}
    for m in matches:
        if m["phase"] == "groups" and m["id"]:
            grp = m["id"][0]
            group_matches_count[grp] = group_matches_count.get(grp, 0) + (1 if m["played"] else 0)

    # Calcular clasificaciones de grupos en base a partidos
    group_teams = {}
    for m in matches:
        if m["phase"] == "groups" and m["id"]:
            grp = m["id"][0]
            if grp not in group_teams:
                group_teams[grp] = {}
            for t in (m["home"], m["away"]):
                if t and t not in group_teams[grp]:
                    group_teams[grp][t] = {"pts": 0, "gd": 0, "gf": 0, "gc": 0, "name": t}
            if m["played"] and m["goals_l"] is not None and m["goals_v"] is not None:
                h, a = m["home"], m["away"]
                gl, gv = m["goals_l"], m["goals_v"]
                group_teams[grp][h]["gf"] += gl
                group_teams[grp][h]["gc"] = group_teams[grp][h].get("gc", 0) + gv
                group_teams[grp][a]["gf"] += gv
                group_teams[grp][a]["gc"] = group_teams[grp][a].get("gc", 0) + gl
                if gl > gv:
                    group_teams[grp][h]["pts"] += 3
                elif gl < gv:
                    group_teams[grp][a]["pts"] += 3
                else:
                    group_teams[grp][h]["pts"] += 1
                    group_teams[grp][a]["pts"] += 1

    for grp, teams in group_teams.items():
        for t in teams.values():
            t["gd"] = t["gf"] - t["gc"]
        sorted_teams = sorted(teams.values(), key=lambda x: (x["pts"], x["gd"], x["gf"]), reverse=True)
        actual_standings[grp] = [t["name"] for t in sorted_teams]

    actual_positions_map = {}
    pts_pos_rules = {
        0: float(_val(ws1, 11, 4) or 4.0), # 1º
        1: float(_val(ws1, 12, 4) or 3.0), # 2º
        2: float(_val(ws1, 13, 4) or 2.0), # 3º
        3: float(_val(ws1, 14, 4) or 1.0)  # 4º
    }

    total_group_matches_played = sum(1 for m in matches if m["phase"] == "groups" and m["played"])
    all_groups_finished = (total_group_matches_played == 72)

    for r in range(80, 128):
        grp = _val(ws1, r, 10)
        if not grp:
            k_val = str(_val(ws1, r, 11))
            m_g = re.search(r'GRUPO\s+([A-L])', k_val)
            grp = m_g.group(1) if m_g else None
        pos_idx = (r - 80) % 4
        if grp and all_groups_finished:
            actual_positions_map[r] = actual_standings[grp][pos_idx]
        else:
            actual_positions_map[r] = f"{pos_idx+1}{grp}"

    actual_q16_qualifiers = set()
    ws_wc = wb1_raw["WORLDCUP"]
    for r in range(101, 117):
        t1 = ws_wc.cell(r, 27).value # AA
        t2 = ws_wc.cell(r, 32).value # AF
        def is_real_team(t):
            if not t: return False
            t_str = str(t).strip()
            if not t_str or t_str.startswith("1") or t_str.startswith("2") or t_str.startswith("3") or t_str.startswith("W") or t_str.startswith("L") or "-" in t_str:
                return False
            return True
        if is_real_team(t1): actual_q16_qualifiers.add(str(t1).strip())
        if is_real_team(t2): actual_q16_qualifiers.add(str(t2).strip())

    pts_q16_team = float(_val(ws1, 15, 4) or 2.0)

    player_positions_pts = {}
    player_q16_pts = {}

    for p, ws in zip(all_players, all_ws):
        name = p["name"]
        pos_pts = 0.0
        for r in range(80, 128):
            actual = actual_positions_map.get(r)
            pred = _val(ws, r, p["pred_col"])
            if actual and pred and str(actual).strip() == str(pred).strip():
                pos_pts += pts_pos_rules[(r - 80) % 4]
        player_positions_pts[name] = pos_pts

        # Clasificados Dieciseisavos (q16) no se puntúan
        q16_pts = 0.0
        player_q16_pts[name] = q16_pts

    # ── standings ────────────────────────────────────────────────────────────
    standings_raw = []
    for i, p in enumerate(all_players):
        name = p["name"]
        clas = all_clas.get(name, {})

        def fv(key):
            v = clas.get(key, 0)
            try: return float(v) if v else 0.0
            except: return 0.0

        groups_calc = round(group_points.get(name, 0.0), 2)
        groups_excel = fv("groups")
        
        positions_calc = player_positions_pts.get(name, 0.0)
        positions_excel = fv("positions")
        
        q16_calc      = 0.0  # clasificados 16avos no puntúan según las reglas
        r16_calc      = round(ko_points["r16"].get(name, 0.0), 2)
        r8_calc       = round(ko_points["r8"].get(name, 0.0), 2)
        r4_calc       = round(ko_points["r4"].get(name, 0.0), 2)
        r2_calc       = round(ko_points["r2"].get(name, 0.0), 2)
        r34_final_calc = round(ko_points["r34"].get(name, 0.0) + ko_points["final"].get(name, 0.0), 2)

        total = round(groups_calc + positions_calc + r16_calc + r8_calc + r4_calc + r2_calc + r34_final_calc, 2)
        lp = round(live_points.get(name, 0.0), 2)
        total_live = round(total + lp, 2)
        phase_detail = []
        for key, label, desc in STANDINGS_PHASES:
            if key == "groups":
                pts = groups_calc
            elif key == "positions":
                pts = positions_calc
            elif key == "r16":
                pts = r16_calc
            elif key == "r8":
                pts = r8_calc
            elif key == "r4":
                pts = r4_calc
            elif key == "r2":
                pts = r2_calc
            elif key == "r34_final":
                pts = r34_final_calc
            else:
                pts = 0.0
            if pts > 0:
                phase_detail.append({"key": key, "label": label, "desc": desc, "pts": pts})

        standings_raw.append({
            "name":     name,
            "total":    total,
            "live_points": lp,
            "total_live":  total_live,
            "groups":   groups_calc,
            "positions": positions_calc,
            "q16":      q16_calc,
            "r16":      r16_calc,
            "r8":       r8_calc,
            "r4":       r4_calc,
            "r2":       r2_calc,
            "r34_final":r34_final_calc,
            "honor":    0.0,
            "phase_detail": phase_detail,
            "color":    PLAYER_COLORS[i % len(PLAYER_COLORS)],
            "played":   played_count.get(name, 0),
            "_excel_total": fv("total"),  # total del Excel (jornada anterior)
            "_orig_idx": i,               # orden original para desempate
        })

    # ── Posiciones previas para desempate y flechas de cambio ────────────────
    # prev_standings.json almacena 3 campos:
    #   display_positions — posiciones de ANTES del último cambio (para flechas ▲▼=)
    #   current_positions — posiciones tras el último cambio (tiebreak + futuro display)
    #   totals            — totales tras el último cambio (detectar nuevo cambio)
    prev_standings_path = os.path.join(BASE, "data", "prev_standings.json")
    display_pos_map = {}   # para mostrar flechas
    tiebreak_pos_map = {}  # para desempate en sort
    prev_totals = {}
    try:
        if os.path.isfile(prev_standings_path):
            with open(prev_standings_path, encoding="utf-8") as f:
                prev_data = json.load(f)
            display_pos_map = prev_data.get("display_positions",
                                            prev_data.get("positions", {}))
            tiebreak_pos_map = prev_data.get("current_positions",
                                             prev_data.get("positions", {}))
            prev_totals = prev_data.get("totals", {})
    except (OSError, ValueError):
        pass

    # Desempate: si dos jugadores tienen los mismos puntos, el que tenía
    # mejor posición previa (pos más baja) se mantiene por encima.
    # Usa current_positions (las más recientes confirmadas) para tiebreak.
    standings_raw.sort(
        key=lambda x: (
            x["total"],
            -tiebreak_pos_map.get(x["name"], 99),   # menor pos previa = mejor
            x.get("_excel_total", 0),
            -x.get("_orig_idx", 0),
        ),
        reverse=True,
    )

    # Determinar posiciones actuales y ver si hubo cambio de puntos
    current_positions = {}
    current_totals = {}
    for i, s in enumerate(standings_raw):
        current_positions[s["name"]] = i + 1
        current_totals[s["name"]] = s["total"]

    # Si los puntos cambiaron respecto al prev guardado, actualizamos prev
    if current_totals != prev_totals and prev_totals:
        # Los puntos han cambiado:
        #   display_positions ← las posiciones que había JUSTO ANTES (current del fichero)
        #   current_positions ← las posiciones NUEVAS tras el cambio
        #   totals ← los totales nuevos
        try:
            with open(prev_standings_path, "w", encoding="utf-8") as f:
                json.dump({
                    "display_positions": tiebreak_pos_map,
                    "current_positions": current_positions,
                    "totals": current_totals,
                }, f, ensure_ascii=False, indent=2)
        except OSError:
            pass
        display_pos_map = tiebreak_pos_map  # flechas comparan contra el estado anterior
    elif not prev_totals:
        # Primera vez (no hay prev) → guardar estado actual, sin flechas
        display_pos_map = current_positions
        try:
            with open(prev_standings_path, "w", encoding="utf-8") as f:
                json.dump({
                    "display_positions": current_positions,
                    "current_positions": current_positions,
                    "totals": current_totals,
                }, f, ensure_ascii=False, indent=2)
        except OSError:
            pass

    standings = []
    for i, s in enumerate(standings_raw):
        s["pos"] = i + 1
        prev_p = display_pos_map.get(s["name"], i + 1)
        s["pos_change"] = prev_p - s["pos"]  # positivo = subió, negativo = bajó
        # Eliminar campos auxiliares de desempate
        s.pop("_excel_total", None)
        s.pop("_orig_idx", None)
        standings.append(s)

    # Posición provisional (incluye puntos de partidos en curso)
    # Desempate: si empatan en total_live, el que tiene mejor posición oficial gana
    live_order = sorted(standings, key=lambda x: (x["total_live"], -x["pos"]), reverse=True)
    for i, s in enumerate(live_order):
        s["live_pos"] = i + 1

    scoring_rules = _load_scoring_rules(ws1)

    # ── cuadro de honor (rows 249-258) ───────────────────────────────────────
    HONOR_ROWS = [
        {"row": 250, "title": "🥇 Campeón",           "category": "podium",   "short": "Campeón"},
        {"row": 251, "title": "🥈 Subcampeón",        "category": "podium",   "short": "Subcampeón"},
        {"row": 252, "title": "🥉 3er Puesto",        "category": "podium",   "short": "3er puesto"},
        {"row": 253, "title": "⚽ Bota de Oro",        "category": "scorers",  "short": "Bota de Oro"},
        {"row": 254, "title": "🥈 Bota de Plata",     "category": "scorers",  "short": "Bota de Plata"},
        {"row": 255, "title": "🥉 Bota de Bronce",    "category": "scorers",  "short": "Bota de Bronce"},
        {"row": 256, "title": "🏆 Balón de Oro",      "category": "players",  "short": "Balón de Oro"},
        {"row": 257, "title": "🥈 Balón de Plata",    "category": "players",  "short": "Balón de Plata"},
        {"row": 258, "title": "🥉 Balón de Bronce",   "category": "players",  "short": "Balón de Bronce"},
    ]
    honor_pts_rules = []
    for sec in scoring_rules.get("sections", []):
        if sec.get("key") == "honor":
            honor_pts_rules = [float(i["pts"]) for i in sec.get("items", [])]
            break

    honor = []
    honor_correct = {p["name"]: 0 for p in all_players}
    honor_filled  = {p["name"]: 0 for p in all_players}
    resolved_count = 0

    for idx, meta in enumerate(HONOR_ROWS):
        row = meta["row"]
        title = meta["title"]
        max_pts = honor_pts_rules[idx] if idx < len(honor_pts_rules) else None
        result_raw = _val(ws1, row, 13)
        actual = _parse_honor_actual(result_raw)
        if actual:
            resolved_count += 1

        preds = {}
        preds_list = []
        for p, ws in zip(all_players, all_ws):
            pv = _val(ws, row, p["pred_col"])
            sv = _val(ws, row, p["score_col"])
            pred_raw = str(pv).strip() if pv and not str(pv).startswith("Pegar") else None
            pred = _normalize_honor_name(pred_raw) if pred_raw else None
            score = float(sv) if sv else 0
            correct = bool(actual and pred and pred == actual)
            if pred:
                honor_filled[p["name"]] += 1
            if correct:
                honor_correct[p["name"]] += 1
            entry = {
                "name": p["name"],
                "pred": pred,
                "score": score,
                "correct": correct,
                "color": PLAYER_COLORS[all_players.index(p) % len(PLAYER_COLORS)],
            }
            preds[p["name"]] = {"pred": pred, "score": score, "correct": correct}
            if pred:
                preds_list.append(entry)

        preds_list.sort(key=lambda x: (-x["score"], -int(x["correct"]), x["name"]))

        # Predicción más popular (consenso del grupo)
        pick_counts = {}
        for e in preds_list:
            pick_counts[e["pred"]] = pick_counts.get(e["pred"], 0) + 1
        consensus = max(pick_counts.items(), key=lambda x: x[1])[0] if pick_counts else None
        consensus_n = pick_counts.get(consensus, 0) if consensus else 0

        honor.append({
            "title": title,
            "short": meta["short"],
            "category": meta["category"],
            "max_pts": max_pts,
            "actual": actual,
            "resolved": actual is not None,
            "predictions": preds,
            "predictions_list": preds_list,
            "consensus": consensus,
            "consensus_count": consensus_n,
            "filled_count": len(preds_list),
        })

    honor_summary = {
        "total_items": len(HONOR_ROWS),
        "resolved": resolved_count,
        "pending": len(HONOR_ROWS) - resolved_count,
        "max_total_pts": float(_val(ws1, 62, 4) or 0),
        "by_player": sorted([
            {
                "name": p["name"],
                "honor_pts": float(all_clas.get(p["name"], {}).get("honor", 0) or 0),
                "correct": honor_correct[p["name"]],
                "filled": honor_filled[p["name"]],
                "color": PLAYER_COLORS[i % len(PLAYER_COLORS)],
            }
            for i, p in enumerate(all_players)
        ], key=lambda x: (-x["honor_pts"], -x["correct"], x["name"])),
    }

    # ── max points reference ─────────────────────────────────────────────────
    max_points = {
        "groups":    _val(ws1, 56, 4),
        "positions": _val(ws1, 57, 4),
        "q16":       None,
        "r16":       _val(ws1, 57, 4),
        "r8":        _val(ws1, 58, 4),
        "r4":        _val(ws1, 59, 4),
        "r2":        _val(ws1, 60, 4),
        "r34_final": _val(ws1, 61, 4),
        "honor":     _val(ws1, 62, 4),
    }

    weeks = _week_ranges_from_dates(spain_dates)
    progression = _build_daily_progression(matches, player_names, player_positions_pts, all_groups_finished)
    player_strengths = _build_player_strengths(matches, standings, player_names)

    from update_schedule import build_update_meta

    return {
        "meta": {
            "title":     "Porra Mundial 'Los Nanos' 2026",
            "generated": datetime.now().strftime("%d/%m/%Y %H:%M"),
            "update":    build_update_meta(),
            "players":   player_names,
            "live": {
                "active":  bool(live_match_names),
                "count":   len(live_match_names),
                "matches": live_match_names,
            },
            "colors":    {p["name"]: PLAYER_COLORS[i] for i, p in enumerate(all_players)},
            "weeks":     weeks,
            "scoring": {
                "sign":  pts_sign,
                "diff":  pts_diff,
                "exact": pts_exact,
            },
            "prizes": {"first": 40, "second": 20, "currency": "€"},
            "group_progress": {grp: count for grp, count in group_matches_count.items()},
        },
        "standings":   standings,
        "matches":     matches,
        "progression": progression,
        "honor":       honor,
        "honor_summary": honor_summary,
        "max_points":  max_points,
        "scoring_rules": scoring_rules,
        "player_strengths": player_strengths,
    }


def get_data():
    global _cache
    now = time.time()
    if _cache["data"] is None or (now - _cache["ts"]) > CACHE_TTL:
        try:
            data = build_data()
            # Inject highlights (data/highlights.json) into each match
            _hl_path = os.path.join(BASE, "data", "highlights.json")
            if os.path.isfile(_hl_path):
                try:
                    with open(_hl_path, encoding="utf-8") as _f:
                        _hl = json.load(_f)
                    for _m in data.get("matches", []):
                        _vid = _hl.get(_m.get("name", ""))
                        if _vid:
                            _m["highlights_video_id"] = _vid
                except (OSError, ValueError):
                    pass
            _cache["data"] = data
            _cache["error"] = None
        except Exception as e:
            _cache["error"] = str(e)
            if _cache["data"] is None:
                raise
        _cache["ts"] = now
    return _cache["data"]


# ── routes ───────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return send_from_directory(BASE, "index.html")


@app.route("/favicon.ico")
def favicon():
    return send_from_directory(os.path.join(BASE, "static"), "favicon.ico")


@app.route("/static/<path:filename>")
def static_files(filename):
    return send_from_directory(os.path.join(BASE, "static"), filename)


def _no_cache(response):
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


@app.route("/api/data")
def api_data():
    try:
        return _no_cache(jsonify(get_data()))
    except Exception as e:
        import traceback
        traceback.print_exc()
        return _no_cache(jsonify({"error": str(e), "detail": "No se pudieron leer los Excel. Cierra Excel si los tienes abiertos e inténtalo de nuevo."})), 500


@app.route("/api/refresh")
def api_refresh():
    """Invalida la caché local para forzar una relectura del Excel.
    Solo afecta al servidor Flask local; no llama a la API externa."""
    _cache["ts"] = 0
    return _no_cache(jsonify({"ok": True, "ts": datetime.now().isoformat()}))


# ── Live match data proxy (scorers, results) ─────────────────────────────────
_wc_games_cache: dict = {"data": None, "ts": 0.0}
WC_GAMES_TTL = 300  # 5 minutes


@app.route("/api/wc_games")
def api_wc_games():
    global _wc_games_cache
    now = time.time()
    if _wc_games_cache["data"] is None or (now - _wc_games_cache["ts"]) > WC_GAMES_TTL:
        try:
            req = _urllib_req.Request(
                "https://worldcup26.ir/get/games",
                headers={"User-Agent": "PorraNanos/1.0"},
            )
            with _urllib_req.urlopen(req, timeout=12) as r:
                raw = json.load(r)
            games = raw.get("games", raw) if isinstance(raw, dict) else raw
            _wc_games_cache["data"] = games
            _wc_games_cache["ts"] = now
        except Exception as exc:
            if _wc_games_cache["data"] is not None:
                pass  # serve stale cache on network error
            else:
                return _no_cache(jsonify({"error": str(exc)})), 503
    return _no_cache(jsonify(_wc_games_cache["data"]))


if __name__ == "__main__":
    print("\n🏆  Porra Mundial 'Los Nanos' 2026")
    print("   http://localhost:5050\n")
    app.run(host="0.0.0.0", port=5050, debug=False)

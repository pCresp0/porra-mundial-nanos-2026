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
from team_players import get_team_players

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
    if 181 <= row <= 199: return "r8"
    if 200 <= row <= 209: return "r4"
    if 210 <= row <= 225: return "r2"
    if 226 <= row <= 238: return "r34"
    if 239 <= row <= 261: return "final"
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
    if "|" in s:
        sign, score = s.split("|", 1)
        return {"sign": sign.strip(), "score": score.strip()}
    return {"sign": s, "score": s}


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


def _build_wc_scores(wb):
    """Goals from WORLDCUP AC/AD keyed by 'Local-Visitante' (Spanish team names)."""
    wc = wb["WORLDCUP"]
    scores = {}
    for r in range(4, 148):
        home = _val(wc, r, 27)
        away = _val(wc, r, 32)
        gl   = _val(wc, r, 29)
        gv   = _val(wc, r, 30)
        if not home or not away:
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
        meta[key] = {
            "home":      str(home).strip(),
            "away":      str(away).strip(),
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
        # Top 3 skills by rank (lowest rank number = best)
        ranked_skills = sorted(
            [(k, r) for k, r in ranks_for_player[name].items()],
            key=lambda x: (x[1], -_sort_key(x[0], name)[0] if isinstance(_sort_key(x[0], name)[0], (int, float)) else 0),
        )
        top_skills = []
        badges = []
        for key, rank in ranked_skills[:4]:
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
            if len(top_skills) >= 3:
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
    return s


def _build_daily_progression(matches, player_names):
    """Puntos acumulados al cierre de cada día natural (hora España)."""
    group = [m for m in matches if m["phase"] == "groups" and m.get("date")]
    if not group:
        return {"labels": [], "dates": [], "players": {n: [] for n in player_names},
                "day_points": {n: [] for n in player_names}}

    all_dates = sorted(set(m["date"] for m in group if m["date"]))
    cumulative = {n: 0.0 for n in player_names}
    players_out = {n: [] for n in player_names}
    day_points  = {n: [] for n in player_names}
    labels = []

    for date in all_dates:
        earned = {n: 0.0 for n in player_names}
        for m in group:
            if m["date"] == date and m["played"]:
                for n in player_names:
                    earned[n] += m["predictions"][n]["score"]

        for n in player_names:
            cumulative[n] = round(cumulative[n] + earned[n], 1)
            players_out[n].append(cumulative[n])
            day_points[n].append(round(earned[n], 1))

        dt = datetime.strptime(date, "%Y-%m-%d")
        labels.append(f"{dt.day} {_MONTHS_ES[dt.month]}")

    return {
        "labels":     labels,
        "dates":      all_dates,
        "players":    players_out,
        "day_points": day_points,
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
    wc_scores   = _build_wc_scores(wb1_raw)
    pts_sign  = float(_val(ws1, 8,  4) or 2)
    pts_diff  = float(_val(ws1, 9,  4) or 1)
    pts_exact = float(_val(ws1, 10, 4) or 3)
    diff_factor = float(_val(ws1, 50, 4) or 1)

    all_players = players1 + [player2]
    all_ws      = [ws1] * len(players1) + [ws2]
    all_clas    = {**clas1, **clas2}

    player_names = [p["name"] for p in all_players]

    # ── collect all matches / prediction rows ────────────────────────────────
    matches = []
    played_count = {p["name"]: 0 for p in all_players}
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
        for p, ws in zip(all_players, all_ws):
            pred_raw  = _val(ws, row, p["pred_col"])
            score_raw = _val(ws, row, p["score_col"])
            pred  = _parse_pred(pred_raw)
            score = float(score_raw) if score_raw is not None else 0

            breakdown = None
            if played and phase == "groups" and pred and "|" in str(pred_raw or ""):
                gl = int(goals_l) if goals_l is not None else None
                gv = int(goals_v) if goals_v is not None else None
                breakdown = _score_breakdown(
                    pred, result, gl, gv,
                    pts_sign, pts_diff, pts_exact,
                    diff_factor, multiplier,
                )

            predictions[p["name"]] = {
                "pred":      pred,
                "score":     score,
                "breakdown": breakdown,
            }

        if phase == "groups" and "|" in str(result_raw or ""):
            if played:
                for name in player_names:
                    played_count[name] += 1

        wc = _lookup_wc_meta(wc_meta, match_name) or {}
        fix = lookup_fixture(row)
        matches.append({
            "row":       row,
            "id":        str(match_id) if match_id else "",
            "name":      str(match_name).strip(),
            "home":      wc.get("home", ""),
            "away":      wc.get("away", ""),
            "flag_home": wc.get("flag_home", ""),
            "flag_away": wc.get("flag_away", ""),
            "city":       fix.get("city", ""),
            "country":    fix.get("country", ""),
            "tv":         fix.get("tv", ""),
            "tv_label":   TV_LABELS.get(fix.get("tv", ""), ""),
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
            "goals_l":   int(goals_l) if goals_l is not None else None,
            "goals_v":   int(goals_v) if goals_v is not None else None,
            "predictions": predictions,
        })

    # ── standings ────────────────────────────────────────────────────────────
    standings_raw = []
    for i, p in enumerate(all_players):
        name = p["name"]
        clas = all_clas.get(name, {})

        def fv(key):
            v = clas.get(key, 0)
            try: return float(v) if v else 0.0
            except: return 0.0

        total = fv("total")
        phase_detail = []
        for key, label, desc in STANDINGS_PHASES:
            pts = fv(key)
            if pts > 0:
                phase_detail.append({"key": key, "label": label, "desc": desc, "pts": pts})

        standings_raw.append({
            "name":     name,
            "total":    total,
            "groups":   fv("groups"),
            "positions":fv("positions"),
            "q16":      fv("q16"),
            "r16":      fv("r16"),
            "r8":       fv("r8"),
            "r4":       fv("r4"),
            "r2":       fv("r2"),
            "r34_final":fv("r34_final"),
            "honor":    fv("honor"),
            "phase_detail": phase_detail,
            "color":    PLAYER_COLORS[i % len(PLAYER_COLORS)],
            "played":   played_count.get(name, 0),
        })

    standings_raw.sort(key=lambda x: x["total"], reverse=True)
    standings = []
    for i, s in enumerate(standings_raw):
        s["pos"] = i + 1
        standings.append(s)

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
            pred = str(pv).strip() if pv and not str(pv).startswith("Pegar") else None
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
    progression = _build_daily_progression(matches, player_names)
    player_strengths = _build_player_strengths(matches, standings, player_names)

    from update_schedule import build_update_meta

    return {
        "meta": {
            "title":     "Porra Mundial 'Los Nanos' 2026",
            "generated": datetime.now().strftime("%d/%m/%Y %H:%M"),
            "update":    build_update_meta(),
            "players":   player_names,
            "colors":    {p["name"]: PLAYER_COLORS[i] for i, p in enumerate(all_players)},
            "weeks":     weeks,
            "scoring": {
                "sign":  pts_sign,
                "diff":  pts_diff,
                "exact": pts_exact,
            },
            "prizes": {"first": 40, "second": 20, "currency": "€"},
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
            _cache["data"] = build_data()
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

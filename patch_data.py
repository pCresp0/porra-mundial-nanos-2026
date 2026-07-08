#!/usr/bin/env python3
"""
patch_data.py — Aplica resultados nuevos de la API a data.json sin reconstruir
desde cero. Solo modifica los partidos de las fases de octavos en adelante
(r8, r4, r2, r34, final) calculando puntos automáticamente.

Las fases anteriores (grupos, dieciseisavos) no se tocan: sus puntos
ya están correctamente fijados desde el Excel por el proceso manual.

Uso:
    python3 patch_data.py               # aplica results.json + live.json
    python3 patch_data.py --live-only   # solo actualiza puntos provisionales
    python3 patch_data.py --dry-run     # muestra cambios sin guardar

Se puede llamar desde GitHub Actions después de fetch_results.py:
    python3 fetch_results.py
    python3 patch_data.py
"""
from __future__ import annotations
import argparse
import json
import os
import sys
import unicodedata
from datetime import datetime, timezone

BASE = os.path.dirname(os.path.abspath(__file__))
DATA_JSON    = os.path.join(BASE, "data.json")
RESULTS_JSON = os.path.join(BASE, "data", "results.json")
LIVE_JSON    = os.path.join(BASE, "data", "live.json")
SCORERS_JSON = os.path.join(BASE, "data", "scorers.json")

# ─── Scoring rules per phase (sign, diff, exact) ────────────────────────────
PHASE_PTS: dict[str, dict[str, float]] = {
    "groups": {"sign": 2.0, "diff": 1.0, "exact": 3.0},
    "r16":    {"sign": 3.0, "diff": 2.0, "exact": 4.0},
    "r8":     {"sign": 4.0, "diff": 3.0, "exact": 5.0},
    "r4":     {"sign": 5.0, "diff": 4.0, "exact": 6.0},
    "r2":     {"sign": 6.0, "diff": 5.0, "exact": 8.0},
    "r34":    {"sign": 6.0, "diff": 5.0, "exact": 8.0},
    "final":  {"sign": 8.0, "diff": 6.0, "exact": 12.0},
}

# Phases that patch_data.py manages (don't touch groups, r16, positions)
AUTO_PHASES = {"r8", "r4", "r2", "r34", "final"}

# Puntos por acertar quién pasa de ronda en cada fase (bonus «Pasa: X»)
QUAL_PTS_BY_PHASE: dict[str, float] = {
    "r16": 3.0,
    "r8":  5.0,
    "r4":  8.0,
    "r2":  12.0,
    "r34": 5.0,
    "final": 12.0,
}

# Columna de standings donde suman esos bonus (r8 partido → columna r4, etc.)
STANDINGS_COL_FOR_QUAL: dict[str, str] = {
    "r16": "r8",
    "r8":  "r4",
    "r4":  "r2",
    "r2":  "r34_final",
    "r34": "r34_final",
    "final": "r34_final",
}


def _norm(s: str) -> str:
    """Normalize string: remove accents, lowercase."""
    s2 = unicodedata.normalize("NFD", s.lower())
    return "".join(c for c in s2 if unicodedata.category(c) != "Mn")


def _sign(gl: int, gv: int) -> str:
    if gl > gv:
        return "1"
    elif gl < gv:
        return "2"
    return "X"


def _align_goals_to_match(
    match: dict, api_home: str, api_away: str, gh: int, ga: int
) -> tuple[int, int, bool]:
    """Map API home/away goals to data.json home/away. Returns (gl, gv, swapped)."""
    dh = str(match.get("home") or "").strip()
    da = str(match.get("away") or "").strip()
    ah = str(api_home or "").strip()
    aa = str(api_away or "").strip()
    if dh == ah and da == aa:
        return gh, ga, False
    if dh == aa and da == ah:
        return ga, gh, True
    return gh, ga, False


def _remap_scorers(scorers: list | None, swapped: bool) -> list | None:
    if not scorers or not swapped:
        return scorers
    out = []
    for s in scorers:
        s2 = dict(s)
        if s2.get("team") == "home":
            s2["team"] = "away"
        elif s2.get("team") == "away":
            s2["team"] = "home"
        out.append(s2)
    return out


def _sync_match_teams_from_api(match: dict, api_home: str, api_away: str) -> bool:
    """Update home/away/name/flags when data.json still has wrong KO pairing."""
    from fetch_results import TEAM_FLAGS

    ah = str(api_home or "").strip()
    aa = str(api_away or "").strip()
    if not ah or not aa:
        return False
    dh = str(match.get("home") or "").strip()
    da = str(match.get("away") or "").strip()
    if {dh, da} == {ah, aa}:
        return False
    match["home"] = ah
    match["away"] = aa
    match["name"] = f"{ah}-{aa}"
    match["flag_home"] = TEAM_FLAGS.get(ah, match.get("flag_home", ""))
    match["flag_away"] = TEAM_FLAGS.get(aa, match.get("flag_away", ""))
    return True


def calc_match_score(pred: dict | None, gl: int, gv: int, phase: str, match: dict | None = None) -> tuple[float, dict]:
    """Calculate player score given prediction and actual result.
    Returns (score, breakdown).
    """
    if not pred:
        return 0.0, {}

    pts = PHASE_PTS.get(phase, PHASE_PTS["r8"])
    sign_pts = pts["sign"]
    diff_pts = pts["diff"]
    exact_pts = pts["exact"]

    team_match = None
    cmp_gl, cmp_gv = gl, gv
    if phase not in ("groups", "r16") and match:
        ph = str(pred.get("pred_home") or "").strip()
        pa = str(pred.get("pred_away") or "").strip()
        home = str(match.get("home") or "").strip()
        away = str(match.get("away") or "").strip()
        if ph and pa and home and away:
            home_ok = ph == home
            away_ok = pa == away
            home_as_away = ph == away
            away_as_home = pa == home
            if (home_ok and away_ok) or (home_as_away and away_as_home):
                team_match = "both"
            elif home_ok or home_as_away:
                team_match = "home" if home_ok else "away"
            elif away_ok or away_as_home:
                team_match = "away" if away_ok else "home"
            else:
                team_match = "none"
            if home_as_away and away_as_home and not (home_ok and away_ok):
                cmp_gl, cmp_gv = gv, gl
        if team_match not in ("both", None):
            reason = "Equipos incorrectos (0 pts)" if team_match == "none" else "Solo un equipo correcto — sin puntos de resultado"
            return 0.0, {
                "sign": 0.0, "diff": 0.0, "exact": 0, "total": 0.0,
                "team_match": team_match, "pred_home": ph, "pred_away": pa,
                "reasons": [reason],
            }

    # Parse prediction score
    pred_score = pred.get("score", "") or ""
    pred_sign  = pred.get("sign", "")

    actual_sign = _sign(cmp_gl, cmp_gv)
    sign_ok = (pred_sign == actual_sign)

    reasons = []
    score = 0.0

    if not sign_ok:
        reasons.append("1X2 incorrecto — 0 pts")
        bd = {"sign": 0.0, "diff": 0.0, "exact": 0, "total": 0.0, "reasons": reasons}
        if team_match is not None:
            bd["team_match"] = team_match
            bd["pred_home"] = pred.get("pred_home")
            bd["pred_away"] = pred.get("pred_away")
        return 0.0, bd

    score += sign_pts
    reasons.append(f"1X2 correcto (+{sign_pts:.0f})")

    # Parse prediction score for diff/exact
    diff_ok = False
    exact_ok = False
    pred_gl, pred_gv = None, None
    try:
        parts = str(pred_score).split("-")
        pred_gl = int(parts[0].strip())
        pred_gv = int(parts[1].strip())
        pred_diff = pred_gl - pred_gv
        actual_diff = cmp_gl - cmp_gv
        diff_ok = (pred_diff == actual_diff)
        exact_ok = (pred_gl == cmp_gl and pred_gv == cmp_gv)
    except (IndexError, ValueError, AttributeError):
        pass

    if exact_ok:
        score += diff_pts + exact_pts
        reasons.append(f"Diferencia de goles (+{diff_pts:.0f})")
        reasons.append(f"Resultado exacto (+{exact_pts:.0f})")
    elif diff_ok:
        score += diff_pts
        reasons.append(f"Diferencia de goles (+{diff_pts:.0f})")
    else:
        reasons.append("Diferencia de goles no acertada")

    bd = {
        "sign": sign_pts if sign_ok else 0.0,
        "diff": diff_pts if diff_ok or exact_ok else 0.0,
        "exact": exact_pts if exact_ok else 0,
        "total": score,
        "reasons": reasons,
    }
    if team_match is not None:
        bd["team_match"] = team_match
        bd["pred_home"] = pred.get("pred_home")
        bd["pred_away"] = pred.get("pred_away")
    return score, bd


def _winners_match(pred_w: str, actual_w: str) -> bool:
    pw = str(pred_w or "").strip().lower()
    aw = str(actual_w or "").strip().lower()
    if not pw or not aw:
        return False
    return pw == aw or pw in aw or aw in pw


def _winner_from_penalties(home: str, away: str, pen: dict, pen_key_home: str) -> str:
    """pen.home/away son goles de penalti; pen_key_home es el local del key en penalties.json."""
    ph = int(pen.get("home", 0))
    pa = int(pen.get("away", 0))
    if ph == pa:
        return ""
    if pen_key_home == home:
        return home if ph > pa else away
    return away if ph > pa else home


def _resolve_ko_winner(
    match: dict,
    gl: int,
    gv: int,
    winner: str = "",
    pen_entry: dict | None = None,
    pen_data: dict | None = None,
) -> str:
    """Ganador del partido KO: goles en tiempo reglamentario o penaltis si empate."""
    w = str(winner or "").strip()
    home = str(match.get("home") or "").strip()
    away = str(match.get("away") or "").strip()
    if gl > gv:
        return home or w
    if gv > gl:
        return away or w
    if w:
        return w
    pen = pen_entry or match.get("penalties")
    if isinstance(pen, dict) and home and away:
        return _winner_from_penalties(home, away, pen, home)
    if isinstance(pen_data, dict) and home and away:
        pen_key = f"{home}-{away}"
        pen_key_rev = f"{away}-{home}"
        pen = pen_data.get(pen_key) or pen_data.get(pen_key_rev)
        if isinstance(pen, dict):
            key_home = home if pen_key in pen_data else away
            return _winner_from_penalties(home, away, pen, key_home)
    return ""


def repair_missing_winners(
    dj: dict,
    pen_data: dict | None = None,
    by_match_num: dict | None = None,
) -> int:
    """Partidos jugados con empate/penaltis pero sin actual_winner (p. ej. penaltis llegaron después)."""
    fixed = 0
    for m in dj.get("matches", []):
        if not m.get("played"):
            continue
        if str(m.get("actual_winner") or "").strip():
            continue
        gl, gv = m.get("goals_l"), m.get("goals_v")
        if gl is None or gv is None:
            continue
        entry = (by_match_num or {}).get(str(m.get("match_num", "")))
        winner_hint = entry.get("winner", "") if isinstance(entry, dict) else ""
        w = _resolve_ko_winner(m, int(gl), int(gv), winner_hint, None, pen_data)
        if not w:
            continue
        m["actual_winner"] = w
        fixed += 1
        print(f"  ↻ Ganador reparado: {m.get('name')} → {w}")
    return fixed


def apply_qual_pts(match: dict) -> dict[str, float]:
    """Asigna qual_pts (bonus «Pasa: X») y devuelve delta por jugador."""
    phase = match.get("phase", "")
    base = QUAL_PTS_BY_PHASE.get(phase, 0.0)
    if not base or not match.get("played"):
        return {}
    actual_w = str(match.get("actual_winner") or "").strip()
    if not actual_w:
        return {}

    deltas: dict[str, float] = {}
    for player, pred_data in match.get("predictions", {}).items():
        pred = pred_data.get("pred")
        if not pred:
            continue
        old_qual = float(pred_data.get("qual_pts") or 0)

        if phase not in ("groups", "r16"):
            tm = (pred_data.get("breakdown") or {}).get("team_match")
            if tm == "none":
                new_qual = 0.0
            elif _winners_match(pred.get("winner"), actual_w):
                new_qual = base
            else:
                new_qual = 0.0
        elif _winners_match(pred.get("winner"), actual_w):
            new_qual = base
        else:
            new_qual = 0.0

        if abs(new_qual - old_qual) < 0.001:
            continue
        pred_data["qual_pts"] = new_qual if new_qual > 0 else None
        deltas[player] = new_qual - old_qual
    return deltas


def backfill_qual_pts(dj: dict) -> tuple[int, dict[str, dict[str, float]]]:
    """Recalcula qual_pts en todos los KO jugados. Devuelve (n preds, deltas standings)."""
    from collections import defaultdict

    standings_deltas: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    updated = 0
    for m in dj.get("matches", []):
        if not m.get("played") or m.get("phase") in ("groups", None):
            continue
        phase = m.get("phase", "")
        col = STANDINGS_COL_FOR_QUAL.get(phase)
        if not col:
            continue
        for player, delta in apply_qual_pts(m).items():
            if delta == 0:
                continue
            standings_deltas[player][col] += delta
            updated += 1
    return updated, standings_deltas


def _apply_standings_qual_deltas(dj: dict, standings_deltas: dict[str, dict[str, float]]):
    for st in dj.get("standings", []):
        name = st["name"]
        for col, delta in standings_deltas.get(name, {}).items():
            if delta == 0:
                continue
            st[col] = float(st.get(col) or 0) + delta
            st["total"] = float(st.get("total") or 0) + delta
            st["total_live"] = float(st.get("total_live") or 0) + delta


def backfill_breakdowns(dj: dict) -> int:
    """Rellena breakdown en predicciones de partidos jugados que no lo tienen."""
    from app import _score_breakdown

    updated = 0
    for m in dj.get("matches", []):
        if not m.get("played"):
            continue
        gl, gv = m.get("goals_l"), m.get("goals_v")
        if gl is None or gv is None:
            continue
        phase = m.get("phase", "groups")
        result = m.get("result") or {"sign": _sign(int(gl), int(gv)), "score": f"{int(gl)}-{int(gv)}"}
        pp = m.get("phase_pts") or PHASE_PTS.get(phase, PHASE_PTS["groups"])

        for pred_data in m.get("predictions", {}).values():
            pred = pred_data.get("pred")
            if not pred:
                continue
            if phase == "groups":
                bd = _score_breakdown(
                    pred, result, int(gl), int(gv),
                    pp.get("sign", 2), pp.get("diff", 1), pp.get("exact", 3),
                )
            else:
                _, bd = calc_match_score(pred, int(gl), int(gv), phase, m)
            if pred_data.get("breakdown") != bd:
                pred_data["breakdown"] = bd
                updated += 1
    return updated


def load_json(path: str) -> dict | list:
    if not os.path.isfile(path):
        return {}
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def apply_confirmed_result(
    match: dict,
    goals_h: int,
    goals_a: int,
    winner: str,
    scorers: list | None = None,
    penalties: dict | None = None,
) -> dict[str, float]:
    """Apply a confirmed final result to a match dict.
    Returns {player_name: score_delta} for standings update.
    """
    phase = match.get("phase", "")
    gl, gv = goals_h, goals_a
    score_str = f"{gl}-{gv}"
    act_sign  = _sign(gl, gv)

    match["result"]       = {"sign": act_sign, "score": score_str}
    match["played"]       = True
    match["live"]         = False
    match["live_minute"]  = ""
    match["live_goals_l"] = None
    match["live_goals_v"] = None
    match["goals_l"]      = gl
    match["goals_v"]      = gv
    match["actual_winner"] = _resolve_ko_winner(match, gl, gv, winner, penalties)
    if scorers is not None:
        match["scorers"] = scorers
    elif match.get("scorers"):
        match["scorers"] = []
    if penalties is not None:
        match["penalties"] = penalties

    deltas: dict[str, float] = {}
    for player, pred_data in match.get("predictions", {}).items():
        pred = pred_data.get("pred")
        old_score = float(pred_data.get("score") or 0)
        new_score, breakdown = calc_match_score(pred, gl, gv, phase, match)
        pred_data["score"] = new_score
        pred_data["breakdown"] = breakdown
        pred_data["live_score"] = None
        pred_data["live_breakdown"] = None
        deltas[player] = new_score - old_score

    qual_deltas = apply_qual_pts(match)
    return deltas, qual_deltas


def apply_live_score(match: dict, gl: int, gv: int, minute: str, scorers: list | None = None):
    """Update in-progress live scores (provisional points)."""
    phase    = match.get("phase", "")
    act_sign = _sign(gl, gv)

    match["live"]         = True
    match["live_minute"]  = minute
    match["live_goals_l"] = gl
    match["live_goals_v"] = gv
    if scorers is not None:
        match["live_scorers"] = scorers

    for player, pred_data in match.get("predictions", {}).items():
        pred = pred_data.get("pred")
        live_score, live_breakdown = calc_match_score(pred, gl, gv, phase, match)
        pred_data["live_score"]     = live_score
        pred_data["live_breakdown"] = live_breakdown


def clear_live_score(match: dict):
    """Remove live overlay if match is no longer live."""
    match["live"]         = False
    match["live_minute"]  = ""
    match["live_goals_l"] = None
    match["live_goals_v"] = None
    for pred_data in match.get("predictions", {}).values():
        pred_data["live_score"]     = None
        pred_data["live_breakdown"] = None


def rebuild_standings(dj: dict):
    """Recompute standings totals from match prediction scores."""
    player_names = [p["name"] for p in dj.get("standings", [])]

    # Sum per-player scores across all AUTO_PHASES matches
    auto_sums: dict[str, float] = {p: 0.0 for p in player_names}
    auto_live: dict[str, float] = {p: 0.0 for p in player_names}

    for m in dj.get("matches", []):
        if m.get("phase") not in AUTO_PHASES:
            continue
        for player, pred_data in m.get("predictions", {}).items():
            if player not in auto_sums:
                continue
            auto_sums[player] += float(pred_data.get("score") or 0)
            live = pred_data.get("live_score")
            if live is not None:
                auto_live[player] += float(live)

    for st in dj.get("standings", []):
        name = st["name"]
        # Get base (non-auto) totals from existing phase data
        base_total = (
            float(st.get("groups") or 0)
            + float(st.get("positions") or 0)
            + float(st.get("r16") or 0)
        )
        # Compute auto-phase subtotals from match scores
        r8_pts = r4_pts = r2_pts = r34_final_pts = 0.0
        for m in dj.get("matches", []):
            phase = m.get("phase")
            if phase not in AUTO_PHASES:
                continue
            score = float(m.get("predictions", {}).get(name, {}).get("score") or 0)
            if phase == "r8":
                r8_pts += score
            elif phase == "r4":
                r4_pts += score
            elif phase in ("r2",):
                r2_pts += score
            elif phase in ("r34", "final"):
                r34_final_pts += score

        # Also add Octavofinalista (Clasif.) and Cuartofinalista scores from base
        # These are stored in the phase sums already in standings from Excel.
        # We need to keep the clasif/Octavofinalista portion of r8 and r4 intact.
        # The auto_sums only has the match scores; clasif portions come from Excel.
        # So we use: r8 = (r8 from Excel, i.e., Octavofinalista portion) + (r8 match scores)
        # But we already stored the total r8 (including Octavofinalista) in standings from Excel.
        # The delta from apply_confirmed_result gives us what to add.

        # This is the AUTHORITATIVE total: base + all match predictions (r8–final)
        st["r8"]        = float(st.get("r8") or 0)   # preserve Octavofinalista portion from Excel
        st["r4"]        = float(st.get("r4") or 0)   # preserve Cuartofinalista from Excel
        # The above will be incremented via deltas; we don't recompute fully here.
        # Total
        total = (float(st.get("groups") or 0)
                 + float(st.get("positions") or 0)
                 + float(st.get("r16") or 0)
                 + float(st.get("r8") or 0)
                 + float(st.get("r4") or 0)
                 + float(st.get("r2") or 0)
                 + float(st.get("r34_final") or 0)
                 + float(st.get("honor") or 0))
        st["total"] = total
        live_extra = auto_live.get(name, 0.0)
        st["live_points"] = live_extra
        st["total_live"] = total + live_extra

    # Re-sort and re-assign positions
    dj["standings"].sort(key=lambda x: x.get("total_live", x.get("total", 0)), reverse=True)
    for i, st in enumerate(dj["standings"]):
        st["live_pos"] = i + 1
    dj["standings"].sort(key=lambda x: x.get("total", 0), reverse=True)
    for i, st in enumerate(dj["standings"]):
        st["pos"] = i + 1


def main():
    parser = argparse.ArgumentParser(description="Parchear data.json con resultados de API")
    parser.add_argument("--live-only", action="store_true",
                        help="Solo actualizar puntos en vivo (no resultados confirmados)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Mostrar cambios sin guardar")
    parser.add_argument("--repair-played", action="store_true",
                        help="Reaplicar resultados aunque el partido ya esté marcado como jugado")
    args = parser.parse_args()

    if not os.path.isfile(DATA_JSON):
        print(f"❌ No encontrado: {DATA_JSON}")
        return 1

    with open(DATA_JSON, encoding="utf-8") as f:
        dj = json.load(f)

    # Build match_num → match index
    num_to_match: dict[int, dict] = {}
    name_to_match: dict[str, dict] = {}
    for m in dj.get("matches", []):
        if m.get("match_num"):
            num_to_match[int(m["match_num"])] = m
        if m.get("name"):
            name_to_match[_norm(m["name"])] = m

    changes = 0

    # ── 1. Apply confirmed results ───────────────────────────────────────────
    if not args.live_only:
        results_data = load_json(RESULTS_JSON)
        by_match_num = results_data.get("by_match_num", {}) if isinstance(results_data, dict) else {}
        scorers_data = load_json(SCORERS_JSON)
        pen_data     = load_json(os.path.join(BASE, "data", "penalties.json"))

        for num_str, entry in by_match_num.items():
            try:
                num = int(num_str)
            except ValueError:
                continue

            match = num_to_match.get(num)
            if not match:
                # Try by name
                home = entry.get("home", "")
                away = entry.get("away", "")
                key  = _norm(f"{home}-{away}")
                krev = _norm(f"{away}-{home}")
                match = name_to_match.get(key) or name_to_match.get(krev)

            if not match:
                continue

            phase = match.get("phase", "")
            if phase not in AUTO_PHASES:
                continue  # Don't touch groups or r16 (trust Excel)

            if match.get("played") and not args.repair_played:
                continue  # Already applied

            api_home = str(entry.get("home", "")).strip()
            api_away = str(entry.get("away", "")).strip()
            if _sync_match_teams_from_api(match, api_home, api_away):
                print(f"  ↻ Equipos corregidos: {match['name']}")

            goals_h = int(entry.get("goals_h", 0))
            goals_a = int(entry.get("goals_a", 0))
            winner  = entry.get("winner", "")

            gl, gv, swapped = _align_goals_to_match(match, api_home, api_away, goals_h, goals_a)

            # Get scorers
            sc_key = f"{api_home}-{api_away}"
            scorers = scorers_data.get(sc_key) if isinstance(scorers_data, dict) else None
            scorers = _remap_scorers(scorers, swapped)

            # Get penalties
            pen_entry = (pen_data.get(sc_key)
                         if isinstance(pen_data, dict) else None)
            winner = _resolve_ko_winner(match, gl, gv, winner, pen_entry, pen_data)

            deltas, qual_deltas = apply_confirmed_result(match, gl, gv, winner, scorers, pen_entry)

            # Update standings phase totals (match result points)
            for st in dj.get("standings", []):
                name = st["name"]
                delta = deltas.get(name, 0.0)
                if delta == 0:
                    continue
                if phase == "r8":
                    st["r8"] = float(st.get("r8") or 0) + delta
                elif phase == "r4":
                    st["r4"] = float(st.get("r4") or 0) + delta
                elif phase in ("r2",):
                    st["r2"] = float(st.get("r2") or 0) + delta
                elif phase in ("r34", "final"):
                    st["r34_final"] = float(st.get("r34_final") or 0) + delta
                st["total"] = (float(st.get("total") or 0) + delta)
                st["total_live"] = (float(st.get("total_live") or 0) + delta)

            # Bonus «Pasa: X» → columna de la fase siguiente
            qual_col = STANDINGS_COL_FOR_QUAL.get(phase)
            if qual_col:
                for st in dj.get("standings", []):
                    qd = qual_deltas.get(st["name"], 0.0)
                    if qd == 0:
                        continue
                    st[qual_col] = float(st.get(qual_col) or 0) + qd
                    st["total"] = float(st.get("total") or 0) + qd
                    st["total_live"] = float(st.get("total_live") or 0) + qd

            # Update progression
            _update_progression(dj, match, deltas)

            print(f"  ✓ {match['name']} {gl}-{gv} → scores: "
                  + " ".join(f"{n}={d:+.0f}" for n, d in deltas.items() if d != 0))
            changes += 1

    # ── 2. Apply live in-progress scores ────────────────────────────────────
    live_data = load_json(LIVE_JSON)
    if isinstance(live_data, dict):
        for key, live_entry in live_data.items():
            # Try to find match
            key_n = _norm(key)
            parts = key.split("-", 1)
            key_rev = _norm(f"{parts[1].strip()}-{parts[0].strip()}") if len(parts) == 2 else ""
            match = name_to_match.get(key_n) or name_to_match.get(key_rev)
            if not match:
                continue
            if match.get("phase") not in AUTO_PHASES:
                continue
            if match.get("played"):
                continue

            api_parts = key.split("-", 1)
            api_home = api_parts[0].strip() if api_parts else ""
            api_away = api_parts[1].strip() if len(api_parts) > 1 else ""
            if not api_home or not api_away:
                continue
            gl = int(live_entry.get("home", 0))
            gv = int(live_entry.get("away", 0))
            gl, gv, swapped = _align_goals_to_match(match, api_home, api_away, gl, gv)
            minute = live_entry.get("minute", "")
            scorers = _remap_scorers(live_entry.get("scorers"), swapped)
            apply_live_score(match, gl, gv, minute, scorers)
            changes += 1

    # Clear live overlay from matches not in live.json anymore
    live_keys = {_norm(k) for k in (live_data.keys() if isinstance(live_data, dict) else [])}
    for m in dj.get("matches", []):
        if m.get("phase") not in AUTO_PHASES:
            continue
        if m.get("played"):
            continue
        n = _norm(m.get("name", ""))
        home_s = _norm(m.get("home", ""))
        away_s = _norm(m.get("away", ""))
        key_n  = f"{home_s}-{away_s}"
        if m.get("live") and key_n not in live_keys and n not in live_keys:
            clear_live_score(m)

    # Recompute live standings positions
    for st in dj.get("standings", []):
        live = sum(
            float(m.get("predictions", {}).get(st["name"], {}).get("live_score") or 0)
            for m in dj.get("matches", [])
            if m.get("live")
        )
        st["live_points"]  = live
        st["total_live"]   = float(st.get("total") or 0) + live

    dj["standings"].sort(key=lambda x: x.get("total_live", x.get("total", 0)), reverse=True)
    for i, st in enumerate(dj["standings"]):
        st["live_pos"] = i + 1
    dj["standings"].sort(key=lambda x: x.get("total", 0), reverse=True)
    for i, st in enumerate(dj["standings"]):
        st["pos"] = i + 1

    # Update meta timestamp
    if "meta" in dj:
        dj["meta"]["generated"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        dj["meta"]["live"] = any(m.get("live") for m in dj.get("matches", []))

    from app import _backfill_match_flags, _propagate_bracket_winners
    _backfill_match_flags(dj.get("matches", []))
    _propagate_bracket_winners(dj.get("matches", []))
    bf = backfill_breakdowns(dj)
    if bf:
        print(f"  ↻ Desgloses rellenados: {bf}")
        changes += bf

    pen_data_repair = load_json(os.path.join(BASE, "data", "penalties.json"))
    results_repair = load_json(RESULTS_JSON)
    by_num_repair = results_repair.get("by_match_num", {}) if isinstance(results_repair, dict) else {}
    rw = repair_missing_winners(dj, pen_data_repair, by_num_repair)
    if rw:
        changes += rw

    bq, qual_sd = backfill_qual_pts(dj)
    if bq:
        print(f"  ↻ Puntos «Pasa» rellenados: {bq}")
        _apply_standings_qual_deltas(dj, qual_sd)
        dj["standings"].sort(key=lambda x: x.get("total_live", x.get("total", 0)), reverse=True)
        for i, st in enumerate(dj["standings"]):
            st["live_pos"] = i + 1
        dj["standings"].sort(key=lambda x: x.get("total", 0), reverse=True)
        for i, st in enumerate(dj["standings"]):
            st["pos"] = i + 1
        changes += bq

    if not args.dry_run:
        from app import sync_progression_from_matches
        sync_progression_from_matches(dj)
        print("  ↻ Progresión sincronizada (incl. puntos «Pasa»)")

    if args.dry_run:
        print(f"\n📋 Dry-run: {changes} cambio(s) detectados (sin guardar)")
        return 0

    with open(DATA_JSON, "w", encoding="utf-8") as f:
        json.dump(dj, f, ensure_ascii=False, separators=(",", ":"))

    live_count = sum(1 for m in dj.get("matches", []) if m.get("live"))
    played_count = sum(1 for m in dj.get("matches", []) if m.get("played"))
    print(f"✅ data.json actualizado: {changes} cambio(s), {played_count} jugados, {live_count} en vivo")
    return 0


def _update_progression(dj: dict, match: dict, deltas: dict[str, float]):
    """Añade un evento de progresión por partido y sincroniza la serie acumulada."""
    from app import (
        _abbr_team, _append_progression_event, _award_grid_on_ko_win,
        _match_prog_title, _prog_match_earned, _progression_grid_context_from_data,
        _sync_prog_players,
    )

    prog = dj.get("progression")
    if not prog or not prog.get("day_points"):
        return

    player_names = dj.get("meta", {}).get("players", [])
    if not player_names:
        return

    date = match.get("date", "")
    if not str(date).startswith("2026-"):
        dates = prog.get("dates", [])
        date = next((d for d in reversed(dates) if str(d).startswith("2026-")), "2026-07-07")

    earned = {
        n: round(_prog_match_earned(match, match.get("predictions", {}).get(n, {})), 1)
        for n in player_names
    }
    label = f"{_abbr_team(match.get('home'))}-{_abbr_team(match.get('away'))}"
    flag = f"{match.get('flag_home', '')}{match.get('flag_away', '')}" or label
    _append_progression_event(
        prog, player_names, label, flag, date,
        _match_prog_title(match), match.get("phase", "r8"), earned,
    )

    grid_ctx = _progression_grid_context_from_data(dj)
    if grid_ctx and match.get("phase") in ("r16", "r8", "r4", "r2"):
        awarded = set()
        grid_earned = _award_grid_on_ko_win(
            match, player_names, grid_ctx["grid_preds"],
            grid_ctx["pts"], awarded, grid_ctx["actual"],
        )
        if any(v > 0 for v in grid_earned.values()):
            w = str(match.get("actual_winner") or "").strip()
            phase_map = {"r16": "r8_team", "r8": "r4_team", "r4": "r2_team", "r2": "final_team"}
            _append_progression_event(
                prog, player_names, f"Clasif. {_abbr_team(w)}", "✓", date,
                f"Clasificado a fase siguiente: {w}",
                phase_map.get(match.get("phase"), "grid"), grid_earned,
            )

    _sync_prog_players(prog, player_names)


if __name__ == "__main__":
    sys.exit(main())

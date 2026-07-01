import os, json, warnings, re
import openpyxl

warnings.filterwarnings("ignore")

BASE = os.path.dirname(os.path.abspath(__file__))
FASE_DIR = os.path.join(BASE, "data", "Fase final")
OUT_PATH = os.path.join(BASE, "data", "ko_predictions.json")
DATA_DIR = os.path.join(BASE, "data")

PRED_ROWS = (
    list(range(164, 180)) +
    list(range(200, 208)) +
    list(range(220, 224)) +
    list(range(232, 234)) +
    [244] +
    [247]
)

PLAYER_MAP = {
    "JUANCHO":  "JUANCHO",
    "LARRY":    "LARRY",
    "LUISVIR":  "LUIS/VIR",
    "MEDINA":   "MEDINA",
    "VICTOR":   "VÍCTOR",
    "CRESPO":   "CRESPO",
}


def _load_match_num_to_winner_code() -> dict:
    """Load match_num -> winner_code map from the ADMIN Excel WORLDCUP sheet.
    This uses the ADMIN (template) Excel which has W73, W76, W90 etc. as
    placeholder codes in column D — unlike player Excels which have resolved
    team names in column D.
    """
    # Locate the ADMIN Excel (may have a suffix like ' [2]')
    admin_candidates = [f for f in os.listdir(DATA_DIR) if f.startswith("ADMIN-Excel") and f.endswith(".xlsx")]
    if not admin_candidates:
        return {}
    admin_path = os.path.join(DATA_DIR, sorted(admin_candidates)[-1])
    try:
        wb_admin = openpyxl.load_workbook(admin_path, data_only=True)
        ws_admin = wb_admin["WORLDCUP"]
    except Exception:
        return {}
    result: dict = {}
    for r in range(101, 148):
        j_val = ws_admin.cell(r, 10).value   # J = match_num
        d_val = ws_admin.cell(r, 4).value    # D = winner code (e.g. 'W73', 'W90')
        if j_val is not None and d_val:
            code_str = str(d_val).strip()
            # Only accept W/L codes, not resolved team names
            if re.match(r'^[WwLl]\d+$', code_str):
                try:
                    result[int(j_val)] = code_str
                except (ValueError, TypeError):
                    pass
    return result


# Precomputed once at module import time
MATCH_NUM_TO_WINNER_CODE: dict = _load_match_num_to_winner_code()


def parse_pred_cell(raw):
    if not raw or not isinstance(raw, str):
        return None
    raw = raw.strip()
    if "\xb7" not in raw or "|" not in raw:
        return None
    try:
        name_part, rest = raw.split("\xb7", 1)
        sign, scores = rest.split("|", 1)
        if "-" not in scores:
            return None
        scores = re.sub(r"\s*\(.*?\)", "", scores).strip()
        gl, gv = scores.split("-", 1)
        return name_part.strip(), sign.strip(), int(gl.strip()), int(gv.strip())
    except Exception:
        return None


def extract_player_predictions(xlsx_path):
    wb = openpyxl.load_workbook(xlsx_path, data_only=True)
    ws = wb["Pool"]
    preds = {}
    
    # Try to extract winners from the corresponding markdown file
    md_path = xlsx_path.replace(".xlsx", ".md")
    winners = {}
    if os.path.exists(md_path):
        with open(md_path, "r", encoding="utf-8") as f:
            for line in f:
                if line.startswith("|") and "Resultado" not in line and "---" not in line:
                    parts = [p.strip() for p in line.split("|") if p.strip()]
                    if len(parts) == 4:
                        # parts: Local, Resultado, Visitante, Ganador
                        match_key = f"{parts[0]}-{parts[2]}"
                        winner_str = parts[3].replace("**", "").strip()
                        res_str = parts[1]
                        if "(" in res_str and ")" in res_str:
                            penalties = res_str[res_str.find("("):res_str.find(")")+1]
                            winner_str += f" {penalties}"
                        winners[match_key] = winner_str

    # Extract Cuadro de Honor predictions
    honor = {}
    for r in range(250, 259):
        raw = ws.cell(r, 3).value
        if raw and str(raw).strip() and str(raw).strip() != "No rellenar":
            honor[str(r)] = str(raw).strip()
    if honor:
        preds["_honor"] = honor

    POOL_TO_WORLDCUP_ROW = {
        164: 101, 165: 102, 166: 103, 167: 104, 168: 105, 169: 106, 170: 107, 171: 108,
        172: 109, 173: 110, 174: 111, 175: 112, 176: 113, 177: 114, 178: 115, 179: 116,
        200: 120, 201: 121, 202: 122, 203: 123, 204: 124, 205: 125, 206: 126, 207: 127,
        220: 131, 221: 132, 222: 133, 223: 134,
        232: 138, 233: 139,
        244: 143,
        247: 147
    }

    ROW_TO_MATCH_NUM = {
        164: 73, 165: 74, 166: 75, 167: 76, 168: 77, 169: 78, 170: 79, 171: 80,
        172: 81, 173: 82, 174: 83, 175: 84, 176: 85, 177: 86, 178: 87, 179: 88,
        200: 89, 201: 90, 202: 91, 203: 92, 204: 93, 205: 94, 206: 95, 207: 96,
        220: 97, 221: 98, 222: 99, 223: 100,
        232: 101, 233: 102,
        244: 103,
        247: 104
    }

    ws_wc = wb["WORLDCUP"]

    # ── j_to_winner: match_num -> team_name (winner of that match) ──────────
    # Built incrementally from the player's own predictions as rows are processed.
    # Starts empty — populated when R16 rows are parsed, then R8 rows, etc.
    # This lets us correctly derive bracket slot keys for later phases.
    j_to_winner: dict = {}

    # R16 pool rows (164-179): additionally populate j_to_winner from the
    # parsed R16 prediction winner fields (more reliable than D column cache).
    # We do a pre-pass over R16 rows first.
    R16_POOL_ROWS = set(range(164, 180))

    def _derive_winner(mname, sign, gl, gv, winners_dict):
        """Derive winner team name from prediction fields."""
        parts = mname.split("-", 1)
        home = parts[0].strip()
        away = parts[1].strip() if len(parts) > 1 else ""
        if sign == "1":
            return home
        elif sign == "2":
            return away
        else:  # "X" draw — try winners dict (handles penalty shootouts)
            w = winners_dict.get(mname)
            if w:
                # Strip penalty annotation from winner string
                return w.split("(")[0].strip() if "(" in w else w
            return None

    # Use the globally precomputed map (loaded from the ADMIN Excel which has
    # proper W-codes in column D, unlike player Excels that have team names).
    match_num_to_winner_code = MATCH_NUM_TO_WINNER_CODE

    # ── Pre-pass: populate j_to_winner from the player's R16 predictions ─────
    # We must do this BEFORE processing R8+ rows so that the reverse lookup
    # (team_name -> match_num -> winner_code) works when computing slot keys.
    for r in R16_POOL_ROWS:
        raw = ws.cell(r, 3).value
        parsed_r16 = parse_pred_cell(str(raw) if raw else "")
        if not parsed_r16:
            continue
        mn_r16, sg_r16, gl_r16, gv_r16 = parsed_r16
        match_num_r16 = ROW_TO_MATCH_NUM.get(r)
        if match_num_r16 is None:
            continue
        # Derive winner from the prediction
        parts_r16 = mn_r16.split("-", 1)
        home_r16 = parts_r16[0].strip()
        away_r16 = parts_r16[1].strip() if len(parts_r16) > 1 else ""
        if sg_r16 == "1":
            w_r16 = home_r16
        elif sg_r16 == "2":
            w_r16 = away_r16
        else:
            # Draw: look up in winners dict (penalty shootout)
            w_r16 = winners.get(mn_r16)
            if w_r16 and "(" in w_r16:
                w_r16 = w_r16.split("(")[0].strip()
        if w_r16:
            j_to_winner[int(match_num_r16)] = w_r16

    for r in PRED_ROWS:
        raw = ws.cell(r, 3).value
        parsed = parse_pred_cell(str(raw) if raw else "")
        if not parsed:
            continue

        mname_excel, sign, gl, gv = parsed
        mname = mname_excel  # default; may be resolved below

        wc_row = POOL_TO_WORLDCUP_ROW.get(r)

        # ── For R8+ matches: resolve bracket placeholders if needed ──────────
        # Players usually write real team names (e.g. "Portugal-España") so we
        # should trust those.  Only substitute teams that are still placeholders
        # like "W73" or "W84" (which means the player left the Excel formula as-is).
        if wc_row is not None and r not in R16_POOL_ROWS:
            def _is_placeholder(name):
                return not name or bool(re.match(r'^[WwLl]\d+$', name.strip()))

            parts_excel = mname_excel.split("-", 1)
            home_excel = parts_excel[0].strip() if len(parts_excel) > 0 else ""
            away_excel = parts_excel[1].strip() if len(parts_excel) > 1 else ""

            # Resolve only the placeholder parts using j_to_winner
            def _resolve_placeholder(team_name):
                """If team_name is a 'W73'-style placeholder, look up the winner."""
                if not _is_placeholder(team_name):
                    return team_name  # already a real name, keep it
                m = re.match(r'^[Ww](\d+)$', team_name.strip())
                if m:
                    code_num = int(m.group(1))
                    return j_to_winner.get(code_num)  # may be None
                return None

            resolved_home = _resolve_placeholder(home_excel)
            resolved_away = _resolve_placeholder(away_excel)

            # Only update mname if both sides could be resolved
            if resolved_home and resolved_away:
                mname = f"{resolved_home}-{resolved_away}"
            elif resolved_home and not _is_placeholder(away_excel):
                mname = f"{resolved_home}-{away_excel}"
            elif not _is_placeholder(home_excel) and resolved_away:
                mname = f"{home_excel}-{resolved_away}"
            # else: keep mname_excel as-is (real team names written by player)

        winner = _derive_winner(mname, sign, gl, gv, winners)
        # Fallback for draws with penalty shootout
        if winner is None and mname != mname_excel:
            fallback_winner = _derive_winner(mname_excel, sign, gl, gv, winners)
            if fallback_winner:
                corrected_teams = {t.strip() for t in mname.split("-", 1)}
                winner = fallback_winner if fallback_winner in corrected_teams else None

        pred_str = f"{mname}·{sign}|{gl}-{gv}"
        if winner:
            pred_str += f"|{winner}"

        # ── Compute slot_key from the TEAMS the player wrote ──────────────────
        # We must NOT use the row-based WORLDCUP slot (ph_home/ph_away from
        # wc_row), because the player may have filled octavos rows in a
        # different order than the WORLDCUP sheet.
        # Reverse-look up each team in j_to_winner to find which PREVIOUS-PHASE
        # match produced it, then convert match_num -> winner_code (W73 etc).
        # IMPORTANT: compute rev_winner BEFORE updating j_to_winner below so
        # that the reverse map only sees the previous phase's winners (not the
        # current match's winner which would create a duplicate and override the
        # correct source match_num).
        slot_key = None
        if wc_row and r not in R16_POOL_ROWS:
            parts_mname = mname.split("-", 1)
            h_team = parts_mname[0].strip()
            a_team = parts_mname[1].strip() if len(parts_mname) > 1 else ""
            # Build reverse: team_name -> match_num.
            # When a team appears as winner of multiple matches (can happen in
            # dict comprehension if same team wins consecutive phases), prefer
            # the match with the smallest match_num (i.e. the earliest phase).
            rev_winner: dict = {}
            for mn_k, mn_v in j_to_winner.items():
                if isinstance(mn_v, str):
                    if mn_v not in rev_winner or mn_k < rev_winner[mn_v]:
                        rev_winner[mn_v] = mn_k
            h_src = rev_winner.get(h_team)
            a_src = rev_winner.get(a_team)
            h_code = match_num_to_winner_code.get(h_src) if h_src is not None else None
            a_code = match_num_to_winner_code.get(a_src) if a_src is not None else None
            if h_code and a_code:
                slot_key = f"{h_code}-{a_code}"
            else:
                # Fallback: use the row's WORLDCUP slot
                ph_home_val = ws_wc.cell(wc_row, 1).value
                ph_away_val = ws_wc.cell(wc_row, 2).value
                if ph_home_val and ph_away_val:
                    slot_key = f"{ph_home_val}-{ph_away_val}"

        # Update j_to_winner so subsequent phases (R4, SF, Final) can chain
        if wc_row and r not in R16_POOL_ROWS:
            match_num = ROW_TO_MATCH_NUM.get(r)
            if match_num is not None:
                if winner:
                    j_to_winner[int(match_num)] = winner
                preds[str(match_num)] = pred_str
            if slot_key:
                preds[slot_key] = pred_str

        elif wc_row and r in R16_POOL_ROWS:
            match_num = ROW_TO_MATCH_NUM.get(r)
            if match_num is not None:
                if winner:
                    j_to_winner[int(match_num)] = winner
                preds[str(match_num)] = pred_str

        preds[mname] = pred_str
        # Keep row key as fallback
        preds[str(r)] = pred_str

    return preds



def main():
    all_preds = {}
    for fname in sorted(os.listdir(FASE_DIR)):
        if not fname.endswith(".xlsx"):
            continue
        prefix = fname.split("_")[0].upper()
        player_name = PLAYER_MAP.get(prefix)
        if not player_name:
            print(f"  WARNING: Prefijo no reconocido: {prefix} ({fname})")
            continue
        fpath = os.path.join(FASE_DIR, fname)
        preds = extract_player_predictions(fpath)
        all_preds[player_name] = preds
        print(f"  OK {player_name}: {len(preds)} predicciones leidas")

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(all_preds, f, ensure_ascii=False, indent=2)
    print(f"\nGuardado en {OUT_PATH}")
    return all_preds


if __name__ == "__main__":
    main()

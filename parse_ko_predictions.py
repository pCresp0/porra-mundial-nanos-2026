import os, json, warnings, re
import openpyxl

warnings.filterwarnings("ignore")

BASE = os.path.dirname(os.path.abspath(__file__))
FASE_DIR = os.path.join(BASE, "data", "Fase final")
OUT_PATH = os.path.join(BASE, "data", "ko_predictions.json")

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

    # ── Build j_to_winner from R16 D column (column 4) ──────────────────────
    # Column D at R16 WORLDCUP rows (101-116) contains the player's correctly
    # computed predicted winner for each R16 match, indexed by J (match_num).
    # We use this (not the formula-computed AA/AF via AH cross-reference) to
    # derive the correct team pairings for R8+ bracket slots.
    j_to_winner = {}
    for wc_r in range(101, 148):  # R16 through Final WORLDCUP rows
        j_val = ws_wc.cell(wc_r, 10).value   # J = match_num
        d_val = ws_wc.cell(wc_r, 4).value    # D = predicted winner
        if j_val is not None and d_val:
            try:
                j_to_winner[int(j_val)] = str(d_val).strip()
            except (ValueError, TypeError):
                pass

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
                    # The WORLDCUP sheet assigns W-codes non-linearly.
                    # Build a local code->match_num map from the WORLDCUP sheet.
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

        # Update j_to_winner so subsequent phases (R4, SF, Final) can use this winner.
        # Key it by the player's predicted winner team: find which R16 match produced it.
        if wc_row and r not in R16_POOL_ROWS:
            match_num = ROW_TO_MATCH_NUM.get(r)
            if match_num is not None:
                if winner:
                    j_to_winner[int(match_num)] = winner
                preds[str(match_num)] = pred_str

            # Store under the WORLDCUP bracket-slot key (e.g. "W83-W84") so app.py
            # can look up by match_name regardless of which row the player used.
            ph_home_val = ws_wc.cell(wc_row, 1).value
            ph_away_val = ws_wc.cell(wc_row, 2).value
            if ph_home_val and ph_away_val:
                slot_key = f"{ph_home_val}-{ph_away_val}"
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

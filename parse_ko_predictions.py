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

    for r in PRED_ROWS:
        raw = ws.cell(r, 3).value
        parsed = parse_pred_cell(str(raw) if raw else "")
        if parsed:
            mname, sign, gl, gv = parsed
            pred_str = f"{sign}|{gl}-{gv}"
            winner = winners.get(mname)
            if winner:
                pred_str += f"|{winner}"
            preds[mname] = pred_str
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

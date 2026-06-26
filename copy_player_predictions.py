import os
import openpyxl
from fetch_results import _patch_excel_cells

BASE = os.path.dirname(os.path.abspath(__file__))
PLAYER_DIR = "/Users/pcrespo/Documents/MEGA/Mundial 2026/01. Primera Fase"

ADMIN_FILES = [
    # (filepath, list of (player_file_name, col_letter))
    (
        os.path.join(BASE, "data", "ADMIN-Excel-Mundial_NANOS_2026 [1].xlsx"),
        [
            ("Juancho_Excel-Mundial-2026.xlsx", "S"),
            ("Larry_Excel-Mundial-2026.xlsx", "V"),
            ("Luis_Excel-Mundial-2026.xlsx", "Y"),
            ("Medina_Excel-Mundial-2026.xlsx", "AB"),
            ("Victor_Excel-Mundial-2026.xlsx", "AE")
        ]
    ),
    (
        os.path.join(BASE, "data", "ADMIN-Excel-Mundial_NANOS_2026 [2].xlsx"),
        [
            ("Pablo_Excel-Mundial-2026.xlsx", "S")
        ]
    ),
    (
        "/Users/pcrespo/Documents/MEGA/Mundial 2026/00. ADMIN/ADMIN-Excel-Mundial_NANOS_2026 [1].xlsx",
        [
            ("Juancho_Excel-Mundial-2026.xlsx", "S"),
            ("Larry_Excel-Mundial-2026.xlsx", "V"),
            ("Luis_Excel-Mundial-2026.xlsx", "Y"),
            ("Medina_Excel-Mundial-2026.xlsx", "AB"),
            ("Victor_Excel-Mundial-2026.xlsx", "AE")
        ]
    ),
    (
        "/Users/pcrespo/Documents/MEGA/Mundial 2026/00. ADMIN/ADMIN-Excel-Mundial_NANOS_2026 [2].xlsx",
        [
            ("Pablo_Excel-Mundial-2026.xlsx", "S")
        ]
    )
]

def main():
    for admin_path, mappings in ADMIN_FILES:
        if not os.path.exists(admin_path):
            print(f"Skipping missing ADMIN file: {admin_path}")
            continue
        
        print(f"Processing ADMIN file: {admin_path}")
        
        updates = {}
        for player_file, col_letter in mappings:
            player_path = os.path.join(PLAYER_DIR, player_file)
            if not os.path.exists(player_path):
                print(f"  ❌ Player file not found: {player_path}")
                continue
            
            print(f"  Reading predictions from {player_file} for col {col_letter}...")
            wb_player = openpyxl.load_workbook(player_path, data_only=True)
            ws_player = wb_player['Pool']
            
            for r in range(80, 253):
                val = ws_player.cell(r, 3).value # Col C
                if val is not None:
                    updates[f"{col_letter}{r}"] = val
            
            wb_player.close()
        
        if updates:
            print(f"  Writing {len(updates)} prediction updates via XML surgery...")
            missing = _patch_excel_cells(admin_path, "ADMIN", updates)
            if missing:
                print(f"  ⚠️ Warning: missing cells in XML: {missing}")
            print(f"  Successfully patched {admin_path}")

if __name__ == "__main__":
    main()

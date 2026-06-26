import json
import app as app_mod
from excel_sync import sync_excel_sources
import openpyxl

# Load data
app_mod.ADMIN, app_mod.FILE1, app_mod.FILE2 = app_mod._excel_paths()
data = app_mod.build_data()

print("--- Matches Scoring ---")
matches = data["matches"]
group_matches = [m for m in matches if m["phase"] == "groups" and m["played"]]
print(f"Group matches played: {len(group_matches)}")

# Check scoring logic directly against app.py's output
players = data["meta"]["players"]
calc_totals = {p: 0 for p in players}

for m in group_matches:
    for p in players:
        calc_totals[p] += m["predictions"][p]["score"]

print("Calculated Totals from matches vs Standings 'groups' field:")
for p in players:
    standing_group = next(s["groups"] for s in data["standings"] if s["name"] == p)
    print(f"  {p}: Matches Sum={calc_totals[p]:.2f}, Standings Groups={standing_group:.2f}")
    assert abs(calc_totals[p] - standing_group) < 0.01

print("\n--- Progression Check ---")
prog = data["progression"]
print(f"Progression labels length: {len(prog['labels'])}")
for p in players:
    last_prog_score = prog["players"][p][-1] if prog["players"][p] else 0
    print(f"  {p}: Last Progression Score={last_prog_score:.2f}, Matches Sum={calc_totals[p]:.2f}")
    assert abs(last_prog_score - calc_totals[p]) < 0.01

print("\n--- All Checks Passed ---")

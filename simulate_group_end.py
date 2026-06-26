import app as app_mod
from datetime import datetime

def mock_build_data():
    player_names = ["JUANCHO", "LARRY", "LUIS/VIR", "MEDINA", "VÍCTOR", "CRESPO"]

    matches = []
    # Create 72 dummy matches
    for i in range(72):
        matches.append({
            "phase": "groups",
            "played": True,
            "date": "2026-06-25",
            "time_es": "18:00",
            "home": "A", "away": "B",
            "predictions": {n: {"score": 2.0} for n in player_names}
        })
    
    player_positions_pts = {n: 15.0 for n in player_names}
    all_groups_finished = True
    
    progression = app_mod._build_daily_progression(matches, player_names, player_positions_pts, all_groups_finished)
    
    print("--- Simulation: 72 Matches Finished ---")
    print(f"Progression labels length: {len(progression['labels'])}")
    print(f"Last label: {progression['labels'][-1]}")
    print(f"Last title: {progression['titles'][-1]}")
    
    for p in player_names:
        matches_total = 72 * 2.0
        expected_total = matches_total + 15.0
        actual_total = progression["players"][p][-1]
        print(f"  {p}: Expected Total={expected_total:.2f}, Actual Total={actual_total:.2f}")
        assert abs(expected_total - actual_total) < 0.01

mock_build_data()
print("\n--- Simulation Checks Passed ---")

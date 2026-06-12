#!/usr/bin/env python3
"""
Comprueba que las APIs funcionan correctamente.

  python3 test_api.py              # local + externa
  python3 test_api.py --local      # solo GET /api/data (Flask en :5050)
  python3 test_api.py --external   # solo worldcup26.ir
  python3 test_api.py --fetch      # prueba descarga → Excel (sin guardar si --dry-run)

Requisitos:
  - Servidor local: python3 launch.py  (puerto 5050)
  - Excel en data/ o ../00. ADMIN/
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request

LOCAL_BASE = "http://localhost:5050"
DEFAULT_EXTERNAL = "https://worldcup26.ir/get/games"


def _get_json(url: str, timeout: int = 15) -> dict | list:
    req = urllib.request.Request(url, headers={"User-Agent": "PorraLosNanos-Test/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.load(resp)


def test_local(base: str = LOCAL_BASE) -> int:
    print(f"\n── API local ({base}) ──")
    ok = True

    # /api/data
    try:
        data = _get_json(f"{base}/api/data")
        if "error" in data:
            print(f"  ✗ /api/data → error: {data.get('detail', data['error'])}")
            ok = False
        else:
            n_players = len(data.get("meta", {}).get("players", []))
            n_matches = len(data.get("matches", []))
            n_honor = len(data.get("honor", []))
            played = sum(1 for m in data.get("matches", []) if m.get("played"))
            print(f"  ✓ /api/data → {n_players} jugadores, {n_matches} partidos ({played} jugados), {n_honor} honor")
            hs = data.get("honor_summary", {})
            if hs:
                print(f"    honor: {hs.get('resolved', 0)}/{hs.get('total_items', 0)} resueltos")
    except urllib.error.URLError as e:
        print(f"  ✗ /api/data → no responde ({e})")
        print("    ¿Está arrancado? → python3 launch.py")
        ok = False

    # /api/refresh
    try:
        r = _get_json(f"{base}/api/refresh")
        if r.get("ok"):
            print(f"  ✓ /api/refresh → caché invalidada ({r.get('ts', '')[:19]})")
        else:
            print("  ✗ /api/refresh → respuesta inesperada")
            ok = False
    except urllib.error.URLError as e:
        print(f"  ✗ /api/refresh → {e}")
        ok = False

    return 0 if ok else 1


def test_external(url: str = DEFAULT_EXTERNAL) -> int:
    print(f"\n── API externa de resultados ──")
    print(f"   {url}")
    try:
        raw = _get_json(url, timeout=30)
        games = raw.get("games", raw) if isinstance(raw, dict) else raw
        if not isinstance(games, list):
            print("  ✗ Formato inesperado (no es lista de partidos)")
            return 1
        finished = [g for g in games if str(g.get("finished", "")).upper() == "TRUE"]
        print(f"  ✓ {len(games)} partidos en API, {len(finished)} finalizados")
        for g in finished[:5]:
            h = g.get("home_team_name_en", "?")
            a = g.get("away_team_name_en", "?")
            print(f"    · {h} {g.get('home_score','?')}-{g.get('away_score','?')} {a}")
        if len(finished) > 5:
            print(f"    … y {len(finished) - 5} más")
        return 0
    except (urllib.error.URLError, TimeoutError, ValueError) as e:
        print(f"  ✗ Error: {e}")
        return 1


def test_fetch_pipeline(dry_run: bool = False) -> int:
    print("\n── Pipeline fetch_results → Excel ──")
    try:
        import fetch_results
        cfg = fetch_results._load_config()
        url = cfg.get("api_url", DEFAULT_EXTERNAL)
        games = fetch_results._fetch_games(url)
        finished = [g for g in games if str(g.get("finished", "")).upper() == "TRUE"]
        print(f"  ✓ Descarga OK ({len(finished)} finalizados)")
        if dry_run:
            print("  ℹ Modo dry-run: no se escribe en el Excel")
            return 0
        _, file1, _ = fetch_results._excel_paths()
        n = fetch_results.update_excel(games, file1)
        print(f"  ✓ Excel actualizado: {n} fila(s) modificada(s)")
        return 0
    except Exception as e:
        print(f"  ✗ {e}")
        return 1


def main():
    p = argparse.ArgumentParser(description="Prueba APIs de la porra Los Nanos")
    p.add_argument("--local", action="store_true", help="Solo API Flask local")
    p.add_argument("--external", action="store_true", help="Solo API worldcup26.ir")
    p.add_argument("--fetch", action="store_true", help="Probar fetch_results → Excel")
    p.add_argument("--dry-run", action="store_true", help="Con --fetch: no guardar Excel")
    p.add_argument("--base", default=LOCAL_BASE, help="URL base Flask (default localhost:5050)")
    args = p.parse_args()

    run_all = not (args.local or args.external or args.fetch)
    code = 0

    print("🏆 Test APIs — Porra Los Nanos 2026")

    if run_all or args.local:
        code |= test_local(args.base)
    if run_all or args.external:
        code |= test_external()
    if run_all or args.fetch:
        code |= test_fetch_pipeline(dry_run=args.dry_run)

    print("\n── Flujo previsto ──")
    print("  1. GitHub Actions (cada 2h) o tú manualmente:")
    print("       python3 fetch_results.py     → API externa → Excel WORLDCUP")
    print("       python3 build_static.py      → Excel → data.json (GitHub Pages)")
    print("  2. En local:")
    print("       python3 launch.py            → Flask lee Excel → /api/data → web")
    print("  3. La web NO escribe pronósticos; solo LEE Excel y muestra JSON.")
    print("  4. /api/refresh solo vacía la caché (30 s), no llama a APIs externas.\n")

    sys.exit(code)


if __name__ == "__main__":
    main()

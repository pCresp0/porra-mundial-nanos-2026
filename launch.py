#!/usr/bin/env python3
"""
Launch script for Porra Mundial 'Los Nanos' 2026
  - Starts Flask server on port 5050
  - Opens Chrome automatically
"""
import subprocess, sys, time, os, threading

PORT = 5050
URL  = f"http://localhost:{PORT}"

def open_chrome():
    time.sleep(1.5)
    try:
        subprocess.run(["open", "-a", "Google Chrome", URL], check=False)
    except Exception:
        try:
            subprocess.run(["open", URL], check=False)
        except Exception:
            print(f"\n  Abre manualmente: {URL}")

if __name__ == "__main__":
    print("\n" + "═"*50)
    print("  🏆  PORRA MUNDIAL 'LOS NANOS' 2026")
    print(f"  🌐  {URL}")
    print("  🔄  Abriendo Chrome automáticamente...")
    print("  ⏹   Ctrl+C para detener")
    print("═"*50 + "\n")

    threading.Thread(target=open_chrome, daemon=True).start()

    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

    from excel_sync import sync_excel_sources, pick_admin_dir
    print("🔄 Sincronizando Excel…")
    sync_excel_sources()
    print(f"📂 Leyendo desde: {pick_admin_dir()}\n")

    from app import app
    app.run(host="0.0.0.0", port=PORT, debug=False, use_reloader=False)

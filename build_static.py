#!/usr/bin/env python3
"""
Genera data.json para GitHub Pages a partir de los Excel ADMIN.
Opcionalmente descarga resultados en vivo antes de generar.

  python3 build_static.py           # solo lee Excel
  python3 build_static.py --fetch   # API + Excel + data.json
"""
import argparse
import json
import os
import subprocess
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
OUT  = os.path.join(BASE, "data.json")

sys.path.insert(0, BASE)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--fetch", action="store_true",
                        help="Descargar resultados en vivo antes de generar")
    args = parser.parse_args()

    from excel_sync import sync_excel_sources
    import app as app_mod
    from app import build_data

    print("🔄 Comprobando Excel (00. ADMIN/ → data/)…")
    sync_excel_sources()
    app_mod.ADMIN, app_mod.FILE1, app_mod.FILE2 = app_mod._excel_paths()
    ADMIN, FILE1, FILE2 = app_mod.ADMIN, app_mod.FILE1, app_mod.FILE2

    if args.fetch:
        print("🌐 Actualizando resultados desde la API…")
        subprocess.run([sys.executable, os.path.join(BASE, "fetch_results.py")],
                       check=False)

    for label, path in [("[1]", FILE1), ("[2]", FILE2)]:
        if not os.path.isfile(path):
            print(f"❌ No encuentro el Excel {label}:\n   {path}")
            print(f"   Carpeta ADMIN: {ADMIN}")
            sys.exit(1)

    print("📊 Leyendo Excel ADMIN…")
    data = build_data()

    from update_schedule import build_update_meta
    data["meta"]["update"] = build_update_meta()

    # Conserva los históricos embebidos por otros procesos (foto de visitas y
    # registro de llamadas API). build_data() los regenera desde el Excel y NO
    # los incluye, así que si no los rescatamos del data.json anterior se
    # perderían en cada actualización tras un partido (hasta la siguiente foto
    # horaria). Los archivos de histórico (data/visits_log.json, data/api_log.json)
    # no se tocan; esto solo evita vaciar lo que la web ya mostraba.
    if os.path.isfile(OUT):
        try:
            with open(OUT, encoding="utf-8") as f:
                prev_meta = json.load(f).get("meta", {})
            for key in ("visits_log", "api_log"):
                if prev_meta.get(key) is not None:
                    data["meta"][key] = prev_meta[key]
        except (OSError, ValueError):
            pass

    # Integrar highlights de DAZN (data/highlights.json)
    highlights_path = os.path.join(BASE, "data", "highlights.json")
    if os.path.isfile(highlights_path):
        try:
            with open(highlights_path, encoding="utf-8") as f:
                highlights = json.load(f)
            count = 0
            for m in data.get("matches", []):
                vid = highlights.get(m.get("name", ""))
                if vid:
                    m["highlights_video_id"] = vid
                    count += 1
            if count:
                print(f"🎬 Highlights integrados: {count} partido(s)")
        except (OSError, ValueError):
            pass

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    size_kb = os.path.getsize(OUT) / 1024
    print(f"✅ Generado {OUT} ({size_kb:.0f} KB)")
    print(f"   Fuente Excel: {ADMIN}")


if __name__ == "__main__":
    main()

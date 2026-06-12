#!/usr/bin/env python3
"""
Genera data.json para GitHub Pages a partir de los Excel ADMIN.
Ejecutar antes de subir cambios a GitHub cuando actualices resultados en Excel.

  python3 build_static.py
"""
import json
import os
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
OUT  = os.path.join(BASE, "data.json")

sys.path.insert(0, BASE)


def main():
    from app import FILE1, FILE2, build_data

    for label, path in [("[1]", FILE1), ("[2]", FILE2)]:
        if not os.path.isfile(path):
            print(f"❌ No encuentro el Excel {label}:\n   {path}")
            print("   Asegúrate de que existen en '../00. ADMIN/'")
            sys.exit(1)

    print("📊 Leyendo Excel ADMIN…")
    data = build_data()

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    size_kb = os.path.getsize(OUT) / 1024
    print(f"✅ Generado {OUT} ({size_kb:.0f} KB)")
    print("   Sube index.html, data.json y static/ a GitHub para actualizar la web.")


if __name__ == "__main__":
    main()

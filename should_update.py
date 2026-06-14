"""Guardián de la actualización automática.

Decide si la GitHub Action debe hacer trabajo real (llamar a la API, actualizar
los Excel y regenerar data.json) o salir sin hacer nada.

Tiene sentido actualizar cuando:
  • Hay un partido EN CURSO (ya ha empezado y aún no ha terminado): así se
    capturan el marcador y los puntos provisionales cada ~15 min.
  • Hay un partido que ya debería haber terminado pero cuyo resultado todavía
    NO está en data.json: para capturar el resultado final.
Fuera de esas ventanas no se hace nada (no se generan commits innecesarios).

Imprime en stdout una sola línea apta para $GITHUB_OUTPUT:
    run=yes   → hay que actualizar
    run=no    → no hay nada pendiente, salir
Los mensajes de diagnóstico van a stderr.
"""
import json
import os
import sys
from datetime import datetime, timedelta

try:
    from zoneinfo import ZoneInfo
    TZ = ZoneInfo("Europe/Madrid")
except Exception:  # pragma: no cover
    TZ = None

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BASE, "data.json")

# Ventana de actividad alrededor de cada partido. Empezamos un par de minutos
# antes del inicio (para captar el directo en cuanto arranca) y seguimos hasta
# 6 h después por si hay prórroga, penaltis o la API tarda en publicar.
# A partir de ~110 min el partido ya debería haber terminado.
WINDOW_START = timedelta(minutes=-2)
FINISHED_AFTER = timedelta(minutes=110)
WINDOW_END = timedelta(hours=6)


def main() -> None:
    now = datetime.now(TZ) if TZ else datetime.now()

    try:
        with open(DATA, encoding="utf-8") as fh:
            data = json.load(fh)
    except (FileNotFoundError, ValueError):
        # Sin datos legibles: mejor intentar la actualización.
        print("run=yes")
        print("Sin data.json legible → actualizar por seguridad", file=sys.stderr)
        return

    for m in data.get("matches", []):
        if m.get("played"):
            continue  # resultado ya capturado
        date = (m.get("date") or "")[:10]
        t = m.get("time_es") or ""
        if len(date) < 10 or ":" not in t:
            continue
        try:
            y, mo, dd = map(int, date.split("-"))
            hh, mm = map(int, t.split(":"))
        except ValueError:
            continue
        kickoff = (datetime(y, mo, dd, hh, mm, tzinfo=TZ) if TZ
                   else datetime(y, mo, dd, hh, mm))
        elapsed = now - kickoff
        if WINDOW_START <= elapsed <= WINDOW_END:
            mins = int(elapsed.total_seconds() // 60)
            estado = "en curso" if elapsed < FINISHED_AFTER else "pendiente de resultado"
            print("run=yes")
            print(f"Partido {estado}: {m.get('name')} "
                  f"(inicio hace {mins} min) → actualizar", file=sys.stderr)
            return

    print("run=no")
    print("Ningún partido en curso ni recién terminado → no actualizar",
          file=sys.stderr)


if __name__ == "__main__":
    main()

"""Guardián de la actualización automática.

Decide si la GitHub Action debe hacer trabajo real (llamar a la API, actualizar
los Excel y regenerar data.json) o salir sin hacer nada.

Solo tiene sentido actualizar cuando hay un partido que ya debería haber
terminado pero cuyo resultado todavía NO está en data.json. Así la Action,
aunque se despierte cada 30 min, únicamente actúa justo después de cada partido
y deja de intentarlo en cuanto captura el resultado.

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

# Un partido puede darse por terminado ~110 min después del inicio
# (90' + descanso + tiempo añadido). Seguimos intentando hasta 6 h después por
# si hay prórroga, penaltis o la API tarda en publicar el resultado.
MIN_AFTER = timedelta(minutes=110)
MAX_AFTER = timedelta(hours=6)


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
        if MIN_AFTER <= elapsed <= MAX_AFTER:
            mins = int(elapsed.total_seconds() // 60)
            print("run=yes")
            print(f"Partido pendiente de resultado: {m.get('name')} "
                  f"(inicio hace {mins} min) → actualizar", file=sys.stderr)
            return

    print("run=no")
    print("Ningún partido recién terminado pendiente → no actualizar",
          file=sys.stderr)


if __name__ == "__main__":
    main()

"""Guardián de la actualización automática.

Decide si la GitHub Action debe hacer trabajo real (llamar a la API, actualizar
los Excel y regenerar data.json) o salir sin hacer nada.

Tiene sentido actualizar cuando:
  • Hay un partido ACTIVO (desde 30 min antes del inicio hasta 30 min después
    del final, cubriendo prórroga y penaltis): así se capturan marcador y puntos
    provisionales en cada pasada → cadencia de ~2 min con el cron externo.
  • Fuera de esa ventana, han pasado ≥15 min desde la última llamada: una
    comprobación periódica (cada 15 min) para captar cambios que la API publique
    con retraso, sin llamar cada 2 min sin necesidad.
Fuera de esas condiciones no se hace nada (no se generan commits innecesarios).

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
LOG_JSON = os.path.join(BASE, "data", "api_log.json")

# Un partido se considera ACTIVO desde 30 min antes del inicio hasta 30 min
# después del final. Tomamos ~160 min como duración máxima (90' + descanso +
# tiempo añadido + prórroga + penaltis en eliminatorias) y sumamos 30 min de
# margen, así que la ventana activa va de -30 min a +190 min respecto al inicio.
# Mientras hay un partido activo actualizamos en cada pasada: como el cron
# externo dispara cada ~2 min, la cadencia efectiva es de 2 min.
WINDOW_START = timedelta(minutes=-30)
ACTIVE_END = timedelta(minutes=190)
# Tras el pitido final la API a veces tarda horas en marcar finished=TRUE.
# Seguimos consultando cada pasada mientras el partido lleve ≥95 min sin
# resultado en Excel (90'+margen) y no hayan pasado más de 8 h.
RESULT_PENDING_START = timedelta(minutes=95)
RESULT_PENDING_MAX = timedelta(hours=8)
# Fuera de la ventana de partido NO actualizamos en cada pasada: solo si han
# pasado al menos 15 min desde la última llamada registrada. Así se captan
# resultados o cambios que la API publique con retraso sin llamar cada 2 min.
IDLE_INTERVAL = timedelta(minutes=15)


def _last_api_call(now):
    """Devuelve el datetime de la última llamada API registrada, o None."""
    try:
        with open(LOG_JSON, encoding="utf-8") as fh:
            entries = json.load(fh)
    except (FileNotFoundError, ValueError):
        return None
    if not isinstance(entries, list) or not entries:
        return None
    ts = entries[-1].get("ts_iso")
    if not ts:
        return None
    try:
        d = datetime.fromisoformat(ts)
    except ValueError:
        return None
    # Alinea la zona horaria para poder restar con `now`.
    if now.tzinfo is None and d.tzinfo is not None:
        d = d.replace(tzinfo=None)
    elif now.tzinfo is not None and d.tzinfo is None:
        d = d.replace(tzinfo=now.tzinfo)
    return d


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

    def _kickoff(m):
        date = (m.get("date") or "")[:10]
        t = m.get("time_es") or ""
        if len(date) < 10 or ":" not in t:
            return None
        try:
            y, mo, dd = map(int, date.split("-"))
            hh, mm = map(int, t.split(":"))
        except ValueError:
            return None
        return (datetime(y, mo, dd, hh, mm, tzinfo=TZ) if TZ
                else datetime(y, mo, dd, hh, mm))

    # 1) ¿Hay algún partido ACTIVO ahora mismo? → actualizar en cada pasada (2 min).
    for m in data.get("matches", []):
        if m.get("played"):
            continue  # resultado ya capturado
        kickoff = _kickoff(m)
        if kickoff is None:
            continue
        elapsed = now - kickoff
        if WINDOW_START <= elapsed <= ACTIVE_END:
            mins = int(elapsed.total_seconds() // 60)
            print("run=yes")
            print(f"Partido activo: {m.get('name')} "
                  f"(inicio hace {mins} min) → actualizar (cadencia 2 min)",
                  file=sys.stderr)
            return

    # 2) ¿Partido que ya debería haber acabado pero sigue sin resultado en Excel?
    #    (p. ej. España-Arabia 4-0: la API publicó finished=TRUE con horas de retraso)
    for m in data.get("matches", []):
        if m.get("played"):
            continue
        kickoff = _kickoff(m)
        if kickoff is None:
            continue
        elapsed = now - kickoff
        if RESULT_PENDING_START <= elapsed <= RESULT_PENDING_MAX:
            mins = int(elapsed.total_seconds() // 60)
            print("run=yes")
            print(f"Resultado pendiente: {m.get('name')} "
                  f"(inicio hace {mins} min, sin jugado en Excel) → actualizar",
                  file=sys.stderr)
            return

    # 3) Sin partido activo ni pendiente → comprobación periódica cada 15 min.
    last = _last_api_call(now)
    if last is None:
        print("run=yes")
        print("Sin partido activo y sin registro previo → comprobar", file=sys.stderr)
        return
    gap = now - last
    if gap >= IDLE_INTERVAL:
        print("run=yes")
        print(f"Sin partido activo; última llamada hace "
              f"{int(gap.total_seconds() // 60)} min (≥15) → comprobar",
              file=sys.stderr)
        return

    print("run=no")
    print(f"Sin partido activo; última llamada hace "
          f"{int(gap.total_seconds() // 60)} min (<15) → no actualizar",
          file=sys.stderr)


if __name__ == "__main__":
    main()

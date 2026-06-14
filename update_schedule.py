"""Horarios de actualización automática.

El workflow `update-porra` (GitHub Actions) corre con cron cada 5 min, pero
`should_update.py` actúa de guardián: solo regenera data.json (API + Excel)
cuando hay un partido EN CURSO o recién terminado sin resultado. Fuera de esa
ventana comprueba pero no actualiza, así que no genera commits innecesarios.
"""
import json
import os
from datetime import datetime, timedelta

try:
    from zoneinfo import ZoneInfo
except ImportError:
    ZoneInfo = None  # type: ignore

BASE = os.path.dirname(os.path.abspath(__file__))

# Cadencia real del cron (minutos). Debe coincidir con
# .github/workflows/update-porra.yml ("*/5 * * * *").
CHECK_EVERY_MIN = 5


def _now_madrid() -> datetime:
    if ZoneInfo is None:
        return datetime.now()
    return datetime.now(ZoneInfo("Europe/Madrid"))


def next_check_slot(after=None) -> datetime:
    """Próximo múltiplo de CHECK_EVERY_MIN estrictamente posterior a `after`."""
    now = after or _now_madrid()
    if now.tzinfo is None and ZoneInfo:
        now = now.replace(tzinfo=ZoneInfo("Europe/Madrid"))
    base = now.replace(second=0, microsecond=0)
    add = CHECK_EVERY_MIN - (base.minute % CHECK_EVERY_MIN)
    return base + timedelta(minutes=add)


def build_update_meta() -> dict:
    """Metadatos de actualización para la barra superior de la web."""
    now = _now_madrid()
    nxt = next_check_slot(now)
    return {
        "timezone": "Europe/Madrid",
        "schedule_label": "Comprueba cada 5 min · actualiza durante los partidos",
        "last_updated_iso": now.strftime("%Y-%m-%dT%H:%M"),
        "last_updated_time": now.strftime("%H:%M"),
        "last_updated_date": now.strftime("%d/%m/%Y"),
        "next_update_iso": nxt.strftime("%Y-%m-%dT%H:%M"),
        "next_update_time": nxt.strftime("%H:%M"),
        "next_update_date": nxt.strftime("%d/%m/%Y"),
    }

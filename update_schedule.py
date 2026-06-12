"""Horarios de actualización automática (cada hora en punto, Europe/Madrid)."""
import json
import os
from datetime import datetime, timedelta

try:
    from zoneinfo import ZoneInfo
except ImportError:
    ZoneInfo = None  # type: ignore

BASE = os.path.dirname(os.path.abspath(__file__))


def _now_madrid() -> datetime:
    if ZoneInfo is None:
        return datetime.now()
    return datetime.now(ZoneInfo("Europe/Madrid"))


def next_hour_slot(after=None) -> datetime:
    """Próxima hora en punto estrictamente posterior a `after`."""
    now = after or _now_madrid()
    if now.tzinfo is None and ZoneInfo:
        now = now.replace(tzinfo=ZoneInfo("Europe/Madrid"))
    nxt = now.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
    return nxt


def build_update_meta() -> dict:
    """Metadatos de actualización para la barra superior de la web."""
    now = _now_madrid()
    nxt = next_hour_slot(now)
    return {
        "timezone": "Europe/Madrid",
        "schedule_label": "cada hora en punto",
        "last_updated_iso": now.strftime("%Y-%m-%dT%H:%M"),
        "last_updated_time": now.strftime("%H:%M"),
        "last_updated_date": now.strftime("%d/%m/%Y"),
        "next_update_iso": nxt.strftime("%Y-%m-%dT%H:%M"),
        "next_update_time": nxt.strftime("%H:%M"),
        "next_update_date": nxt.strftime("%d/%m/%Y"),
    }

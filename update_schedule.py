"""Horarios de actualización automática (horas pares, Europe/Madrid)."""
import json
import os
from datetime import datetime, timedelta

try:
    from zoneinfo import ZoneInfo
except ImportError:
    ZoneInfo = None  # type: ignore

BASE = os.path.dirname(os.path.abspath(__file__))
EVEN_HOURS = list(range(0, 24, 2))  # 0, 2, 4, …, 22


def load_update_config() -> dict:
    path = os.path.join(BASE, "update_config.json")
    defaults = {
        "timezone": "Europe/Madrid",
        "interval_hours": 2,
        "even_hours_only": True,
        "fetch_live_results": True,
        "api_url": "https://worldcup26.ir/get/games",
    }
    if os.path.isfile(path):
        with open(path, encoding="utf-8") as f:
            defaults.update(json.load(f))
    return defaults


def _now_madrid() -> datetime:
    if ZoneInfo is None:
        return datetime.now()
    tz = ZoneInfo("Europe/Madrid")
    return datetime.now(tz)


def next_even_hour_slot(after=None):
    """Próximo hueco en hora par (España) estrictamente posterior a `after`."""
    now = after or _now_madrid()
    if now.tzinfo is None and ZoneInfo:
        now = now.replace(tzinfo=ZoneInfo("Europe/Madrid"))

    for day_offset in range(0, 3):
        day = now.date() + timedelta(days=day_offset)
        for hour in EVEN_HOURS:
            slot = now.replace(
                year=day.year, month=day.month, day=day.day,
                hour=hour, minute=0, second=0, microsecond=0,
            )
            if slot > now:
                return slot
    return now + timedelta(hours=2)


def build_update_meta() -> dict:
    """Metadatos de actualización para la barra superior de la web."""
    now = _now_madrid()
    nxt = next_even_hour_slot(now)
    return {
        "timezone": "Europe/Madrid",
        "schedule_label": "cada 2 h (horas pares)",
        "last_updated_time": now.strftime("%H:%M"),
        "last_updated_date": now.strftime("%d/%m/%Y"),
        "next_update_time": nxt.strftime("%H:%M"),
        "next_update_date": nxt.strftime("%d/%m/%Y"),
    }

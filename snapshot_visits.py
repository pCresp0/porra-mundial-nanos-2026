#!/usr/bin/env python3
"""Toma una "foto" horaria del contador de visitas y la guarda en el repo.

La web es estática y el contador (page-views-api.ratneshc.com) solo da el TOTAL
acumulado de visitas, sin histórico. Para poder mostrar "visitas por hora" en el
panel de admin, este script lee ese total una vez por hora (vía GitHub Action) y
lo añade a ``data/visits_log.json`` como ``{ts_iso, total}``.

Las visitas de cada hora se calculan después como la diferencia entre dos fotos
consecutivas (lo hace el frontend). Así, sin ninguna cuenta ni servicio extra,
tenemos el número de entradas por hora, filtrable por día.

Embebe además las fotos recientes en ``data.json`` → ``meta.visits_log`` para que
el panel las lea sin pedir otro archivo.

Uso:
    python3 snapshot_visits.py
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta

try:
    from zoneinfo import ZoneInfo
    TZ = ZoneInfo("Europe/Madrid")
except Exception:  # pragma: no cover
    TZ = None

BASE = os.path.dirname(os.path.abspath(__file__))
DATA_JSON = os.path.join(BASE, "data.json")
LOG_JSON = os.path.join(BASE, "data", "visits_log.json")

# Mismos valores que static/js/app.js
VISITOR_API = "https://page-views-api.ratneshc.com/api/v1"
VISITOR_SITE = "porra-mundial-nanos-2026"
VISITOR_PATH = "/porra-mundial-nanos-2026"

ARCHIVE_DAYS = 45      # cuánto histórico guardamos en el archivo
ARCHIVE_MAX = 2000
EMBED_DAYS = 10        # cuántos días embebemos en data.json para el panel


def _now():
    return datetime.now(TZ) if TZ else datetime.now()


def _fetch_total() -> int | None:
    url = (f"{VISITOR_API}/views?site={VISITOR_SITE}&path={VISITOR_PATH}")
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "PorraLosNanos/1.0"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.load(resp)
        views = data.get("views")
        return int(views) if views is not None else None
    except (urllib.error.URLError, ValueError, TypeError, OSError) as exc:
        print(f"No se pudo leer el contador: {exc}", file=sys.stderr)
        return None


def _load_log() -> list:
    if not os.path.isfile(LOG_JSON):
        return []
    try:
        with open(LOG_JSON, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except (OSError, ValueError):
        return []


def _prune(entries: list, now: datetime) -> list:
    cutoff = now - timedelta(days=ARCHIVE_DAYS)
    kept = []
    for e in entries:
        ts = e.get("ts_iso")
        try:
            d = datetime.fromisoformat(ts) if ts else None
        except ValueError:
            d = None
        if d is None or d >= cutoff:
            kept.append(e)
    return kept[-ARCHIVE_MAX:]


def _embed_recent(entries: list, now: datetime) -> list:
    cutoff = now - timedelta(days=EMBED_DAYS)
    out = []
    for e in entries:
        ts = e.get("ts_iso")
        try:
            d = datetime.fromisoformat(ts) if ts else None
        except ValueError:
            d = None
        if d is None or d >= cutoff:
            out.append(e)
    return out


def main() -> None:
    now = _now()
    total = _fetch_total()
    if total is None:
        print("Sin total de visitas → no se registra foto", file=sys.stderr)
        return

    entries = _prune(_load_log(), now)

    # Evita duplicados si la Action se dispara dos veces en la misma hora:
    # si la última foto es de esta misma hora, la sustituimos.
    hour_key = now.strftime("%Y-%m-%dT%H")
    if entries and str(entries[-1].get("ts_iso", "")).startswith(hour_key):
        entries[-1] = {"ts_iso": now.isoformat(timespec="seconds"), "total": total}
    else:
        entries.append({"ts_iso": now.isoformat(timespec="seconds"), "total": total})

    os.makedirs(os.path.dirname(LOG_JSON), exist_ok=True)
    with open(LOG_JSON, "w", encoding="utf-8") as f:
        json.dump(entries, f, ensure_ascii=False, indent=2)

    # Embebe las fotos recientes en data.json
    try:
        with open(DATA_JSON, encoding="utf-8") as f:
            raw = f.read()
        if "<<<<<<<" in raw or ">>>>>>>" in raw:
            print("data.json tiene marcadores de conflicto git — abortando", file=sys.stderr)
            sys.exit(1)
        data = json.loads(raw)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"No se pudo leer data.json para embeber: {exc}", file=sys.stderr)
        sys.exit(1)

    data.setdefault("meta", {})["visits_log"] = _embed_recent(entries, now)
    with open(DATA_JSON, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"Foto de visitas guardada: total={total} ({len(entries)} en histórico)",
          file=sys.stderr)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Registra cada llamada real a la API del Mundial.

La GitHub Action solo llama a la API (``fetch_results.py``) cuando un partido
acaba de terminar. Pero no todas esas llamadas actualizan datos en el repo: si
la API todavía no ha publicado el resultado, la llamada no cambia nada.

Este script se ejecuta DESPUÉS de ``build_static.py`` (que regenera data.json)
y antes del commit. Hace tres cosas:

  1. Compara los resultados de partidos del ``data.json`` recién generado con la
     versión anterior (``git show HEAD:data.json``). Si algún marcador cambió,
     la llamada se marca como ``updated: true`` y se guarda QUÉ cambió.
  2. Añade una entrada con la fecha/hora exacta al archivo ``data/api_log.json``
     (archivo histórico, podado a los últimos 30 días).
  3. Embebe las últimas entradas en ``data.json`` → ``meta.api_log`` para que la
     web (panel de admin) las pueda mostrar sin pedir otro archivo.

Imprime en stdout una línea apta para $GITHUB_OUTPUT:
    updated=yes  → la llamada actualizó datos reales
    updated=no   → la llamada no cambió ningún marcador
Los mensajes de diagnóstico van a stderr.

Uso:
    python3 log_api_call.py [--trigger schedule]
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timedelta

try:
    from zoneinfo import ZoneInfo
    TZ = ZoneInfo("Europe/Madrid")
except Exception:  # pragma: no cover
    TZ = None

BASE = os.path.dirname(os.path.abspath(__file__))
DATA_JSON = os.path.join(BASE, "data.json")
LOG_JSON = os.path.join(BASE, "data", "api_log.json")

# Cuánto histórico guardamos en el archivo y cuánto embebemos en data.json.
ARCHIVE_DAYS = 30
ARCHIVE_MAX = 2000
EMBED_MAX = 120


def _now():
    return datetime.now(TZ) if TZ else datetime.now()


def _result_signature(data: dict) -> dict:
    """Mapa nombre_partido -> firma del marcador, para detectar cambios reales."""
    sig = {}
    for m in data.get("matches", []):
        name = m.get("name") or f"{m.get('home','')}-{m.get('away','')}"
        sig[name] = {
            "gl": m.get("goals_l"),
            "gv": m.get("goals_v"),
            "result": m.get("result"),
            "played": bool(m.get("played")),
            "home": m.get("home", ""),
            "away": m.get("away", ""),
            "flag_home": m.get("flag_home", ""),
            "flag_away": m.get("flag_away", ""),
            "date": (m.get("date") or "")[:10],
        }
    return sig


def _load_previous_data() -> dict | None:
    """data.json tal como está en el último commit (HEAD)."""
    try:
        out = subprocess.run(
            ["git", "show", "HEAD:data.json"],
            cwd=BASE, capture_output=True, text=True, timeout=30,
        )
        if out.returncode != 0:
            return None
        return json.loads(out.stdout)
    except (OSError, ValueError, subprocess.SubprocessError):
        return None


def _diff_results(old: dict | None, new: dict) -> list:
    """Lista de cambios entre el data.json viejo y el nuevo.

    Cada cambio es un dict con ``label`` (texto legible), ``name`` (clave del
    partido) y ``date`` (YYYY-MM-DD), para que el panel de admin pueda enlazar
    al partido en la pestaña de Partidos.
    """
    new_sig = _result_signature(new)
    if old is None:
        return []
    old_sig = _result_signature(old)
    changes = []
    for name, ns in new_sig.items():
        os_ = old_sig.get(name)
        if os_ is None:
            continue
        score_changed = (ns["gl"], ns["gv"], ns["result"]) != (os_["gl"], os_["gv"], os_["result"])
        played_changed = ns["played"] != os_["played"]
        if score_changed or played_changed:
            gl = ns["gl"] if ns["gl"] is not None else "?"
            gv = ns["gv"] if ns["gv"] is not None else "?"
            label = f"{ns['flag_home']}{ns['home']} {gl}-{gv} {ns['away']}{ns['flag_away']}".strip()
            changes.append({"label": label, "name": name, "date": ns["date"]})
    return changes


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


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--trigger", default="schedule",
                        help="Evento que disparó la Action (schedule, workflow_dispatch…)")
    args = parser.parse_args()

    now = _now()

    try:
        with open(DATA_JSON, encoding="utf-8") as f:
            new_data = json.load(f)
    except (OSError, ValueError) as exc:
        print("updated=no")
        print(f"No se pudo leer data.json: {exc}", file=sys.stderr)
        return

    old_data = _load_previous_data()
    changes = _diff_results(old_data, new_data)
    updated = bool(changes)

    entry = {
        "ts_iso": now.isoformat(timespec="seconds"),
        "date": now.strftime("%d/%m/%Y"),
        "time": now.strftime("%H:%M:%S"),
        "updated": updated,
        "trigger": args.trigger,
        "changes": changes,
    }

    # 1) Archivo histórico
    entries = _prune(_load_log(), now)
    entries.append(entry)
    os.makedirs(os.path.dirname(LOG_JSON), exist_ok=True)
    with open(LOG_JSON, "w", encoding="utf-8") as f:
        json.dump(entries, f, ensure_ascii=False, indent=2)

    # 2) Embeber las últimas entradas (más recientes primero) en data.json
    recent = list(reversed(entries))[:EMBED_MAX]
    new_data.setdefault("meta", {})["api_log"] = recent
    with open(DATA_JSON, "w", encoding="utf-8") as f:
        json.dump(new_data, f, ensure_ascii=False, indent=2)

    print(f"updated={'yes' if updated else 'no'}")
    if updated:
        labels = ", ".join(c["label"] for c in changes)
        print(f"Llamada API actualizó {len(changes)} marcador(es): {labels}",
              file=sys.stderr)
    else:
        print("Llamada API sin cambios de marcador (la API aún no publica "
              "el resultado o nada nuevo)", file=sys.stderr)


if __name__ == "__main__":
    main()

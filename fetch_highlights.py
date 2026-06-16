#!/usr/bin/env python3
"""
Busca resúmenes de partidos jugados en el canal de DAZN ES en YouTube
y los guarda en data/highlights.json  →  { "México-Sudáfrica": "VIDEO_ID", … }

Requisitos:
  - Variable de entorno YOUTUBE_API_KEY con la clave de YouTube Data API v3.
  - La API key debe tener habilitada la YouTube Data API v3 en Google Cloud.

Uso manual:
  YOUTUBE_API_KEY=AIzaSy... python3 fetch_highlights.py

El script solo hace búsquedas para partidos jugados que aún no tienen highlights
almacenados, así que el coste en cuota (100 unidades / búsqueda) es mínimo.
"""
import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

BASE = os.path.dirname(os.path.abspath(__file__))
HIGHLIGHTS_JSON = os.path.join(BASE, "data", "highlights.json")
DATA_JSON       = os.path.join(BASE, "data.json")

DAZN_CHANNEL_ID = "UCK-mxP4hLap1t3dp4bPbSBg"
YT_SEARCH_URL   = "https://www.googleapis.com/youtube/v3/search"


def _load_json(path: str, default):
    if os.path.isfile(path):
        try:
            with open(path, encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError):
            pass
    return default


def _save_json(path: str, data) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def _search_highlight(api_key: str, match_name: str, home: str, away: str,
                      match_date: str) -> str | None:
    """
    Busca el resumen del partido en DAZN ES.
    Devuelve el video_id si lo encuentra, None si no.
    """
    # La query imita el formato del título: "México vs Sudáfrica Resumen"
    query = f"{home} {away} Resumen Copa Mundial FIFA 2026"

    # Solo buscar vídeos publicados después de la fecha del partido
    # (añadimos 1 día de margen para zonas horarias distintas)
    if match_date:
        try:
            after_dt = datetime.strptime(match_date, "%Y-%m-%d") + timedelta(hours=12)
            published_after = after_dt.replace(tzinfo=timezone.utc).strftime(
                "%Y-%m-%dT%H:%M:%SZ"
            )
        except ValueError:
            published_after = None
    else:
        published_after = None

    params = {
        "part": "snippet",
        "channelId": DAZN_CHANNEL_ID,
        "q": query,
        "type": "video",
        "order": "date",
        "maxResults": 5,
        "key": api_key,
    }
    if published_after:
        params["publishedAfter"] = published_after

    url = YT_SEARCH_URL + "?" + urllib.parse.urlencode(params)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "PorraLosNanos/1.0"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.load(resp)
    except Exception as e:
        print(f"  ⚠️  Error buscando highlights para {match_name}: {e}")
        return None

    items = data.get("items", [])
    for item in items:
        title = item.get("snippet", {}).get("title", "").lower()
        video_id = item.get("id", {}).get("videoId", "")
        # Verificar que el título incluye alguno de los equipos y "resumen"
        home_norm = home.lower().split()[0]  # primera palabra del nombre
        away_norm = away.lower().split()[0]
        if video_id and "resumen" in title and (home_norm in title or away_norm in title):
            print(f"  ✅  Encontrado: [{video_id}] {item['snippet']['title'][:70]}")
            return video_id

    print(f"  ℹ️  Sin resumen disponible aún para {match_name}")
    return None


def main():
    api_key = os.environ.get("YOUTUBE_API_KEY", "").strip()
    if not api_key:
        print("❌ YOUTUBE_API_KEY no definida — omitiendo fetch_highlights")
        sys.exit(0)  # salida limpia para no romper el workflow si falta la key

    # Cargar partidos del data.json generado justo antes
    data = _load_json(DATA_JSON, {})
    matches = data.get("matches", [])
    if not matches:
        print("⚠️  data.json vacío o no encontrado — nada que buscar")
        sys.exit(0)

    # Cargar highlights existentes
    highlights = _load_json(HIGHLIGHTS_JSON, {})
    changed = False

    played = [m for m in matches if m.get("played") and m.get("home") and m.get("away")]
    print(f"🎬 Buscando resúmenes DAZN para {len(played)} partidos jugados…")

    for m in played:
        name = m.get("name", "")
        if not name:
            continue
        if name in highlights:
            # Ya tenemos el video_id guardado
            continue

        home  = m.get("home", "")
        away  = m.get("away", "")
        date  = m.get("date", "")

        print(f"  🔍 {name} ({home} vs {away})")
        video_id = _search_highlight(api_key, name, home, away, date)
        if video_id:
            highlights[name] = video_id
            changed = True

    if changed:
        _save_json(HIGHLIGHTS_JSON, highlights)
        print(f"✅ Guardados en {HIGHLIGHTS_JSON} ({len(highlights)} entradas)")
    else:
        print("ℹ️  Sin novedades en highlights")


if __name__ == "__main__":
    main()

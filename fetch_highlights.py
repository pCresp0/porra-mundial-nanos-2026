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

try:
    from team_names import EN_TO_ES
except Exception:
    EN_TO_ES = {}

BASE = os.path.dirname(os.path.abspath(__file__))
HIGHLIGHTS_JSON = os.path.join(BASE, "data", "highlights.json")
DATA_JSON       = os.path.join(BASE, "data.json")

# Canales DAZN en YouTube (ES y Fútbol)
DAZN_CHANNELS = [
    "UCK-mxP4hLap1t3dp4bPbSBg",  # DAZN ES
    "UCz9FiMLz6SOgR_4VEFvjeIA",  # DAZN Fútbol
]
YT_SEARCH_URL   = "https://www.googleapis.com/youtube/v3/search"

# Intervalo mínimo entre búsquedas del mismo partido sin resultado (30 min).
HL_SEARCH_INTERVAL = timedelta(minutes=30)


def _norm(s):
    import unicodedata

    s = unicodedata.normalize("NFD", (s or "").lower().strip())
    return "".join(c for c in s if unicodedata.category(c) != "Mn")


_ES_TO_EN = {}
for en_name, es_name in EN_TO_ES.items():
    _ES_TO_EN.setdefault(_norm(es_name), set()).add(_norm(en_name))

# Alias adicionales en español que DAZN usa en sus títulos
_EXTRA_ES_ALIASES = {
    "republica checa": ["chequia"],
    "estados unidos": ["usa", "eeuu"],
    "paises bajos": ["holanda"],
    "costa de marfil": ["cote divoire"],
    "corea del sur": ["corea"],
    "bosnia y herzegovina": ["bosnia"],
    "arabia saudita": ["arabia saudi"],
    "rd congo": ["congo", "rep. dem. congo", "dr congo"],
}
for es_norm, aliases in _EXTRA_ES_ALIASES.items():
    _ES_TO_EN.setdefault(es_norm, set()).update(aliases)


def _team_terms(name: str) -> list[str]:
    base = _norm(name)
    terms = {base}
    terms.update(_ES_TO_EN.get(base, set()))
    if " " in base:
        terms.add(base.split()[0])
    return sorted(t for t in terms if t)


def _candidate_queries(home: str, away: str) -> list[str]:
    home_terms = _team_terms(home)
    away_terms = _team_terms(away)
    home_primary = home_terms[0] if home_terms else _norm(home)
    away_primary = away_terms[0] if away_terms else _norm(away)
    queries = [
        f"{home} {away} Resumen y goles",
        f"{home} {away} Resumen",
        f"{home} {away} Highlights",
        f"{home_primary} {away_primary} highlights",
    ]
    return list(dict.fromkeys(q for q in queries if q.strip()))


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


def _search_highlight(api_key, match_name, home, away, match_date):
    """
    Busca el resumen del partido en DAZN ES.
    Devuelve el video_id si lo encuentra, None si no.
    """
    # Buscamos varias variantes del título para cubrir DAZN ES y títulos
    # en inglés o con palabras/orden distinto.

    # Solo buscar vídeos publicados después de la fecha del partido.
    # Usamos el inicio del día en UTC para no perder vídeos subidos pronto.
    if match_date:
        try:
            after_dt = datetime.strptime(match_date, "%Y-%m-%d")
            published_after = after_dt.replace(tzinfo=timezone.utc).strftime(
                "%Y-%m-%dT%H:%M:%SZ"
            )
        except ValueError:
            published_after = None
    else:
        published_after = None

    base_params = {
        "part": "snippet",
        "type": "video",
        "order": "date",
        "maxResults": 10,
        "key": api_key,
    }
    if published_after:
        base_params["publishedAfter"] = published_after

    # Estrategia escalonada para ahorrar cuota (100 unidades/búsqueda):
    # 1. Búsqueda principal en DAZN ES (1 query)
    # 2. Si no, DAZN Fútbol (1 query)
    # 3. Si no, queries variantes en ambos canales
    # 4. Si no, búsqueda sin canal como último recurso (1 query)
    queries = _candidate_queries(home, away)
    primary_query = queries[0] if queries else f"{home} {away} Resumen"
    alt_queries = queries[1:] if len(queries) > 1 else []

    # Nivel 1: query principal en canales DAZN
    for channel_id in DAZN_CHANNELS:
        result = _try_search(api_key, base_params, channel_id, primary_query,
                             home, away, match_name)
        if result:
            return result

    # Nivel 2: queries alternativas en canales DAZN
    for channel_id in DAZN_CHANNELS:
        for query in alt_queries:
            result = _try_search(api_key, base_params, channel_id, query,
                                 home, away, match_name)
            if result:
                return result

    # Nivel 3: búsqueda abierta (sin canal) — solo el query principal
    result = _try_search(api_key, base_params, None, primary_query,
                         home, away, match_name)
    if result:
        return result

    print(f"  ℹ️  Sin resumen disponible aún para {match_name}")
    return None


def _try_search(api_key, base_params, channel_id, query, home, away, match_name):
    """Ejecuta una búsqueda y devuelve video_id si hay match, None si no."""
    params = dict(base_params)
    if channel_id:
        params["channelId"] = channel_id
    params["q"] = query
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
        title_raw = item.get("snippet", {}).get("title", "")
        title = _norm(title_raw)
        video_id = item.get("id", {}).get("videoId", "")
        has_keyword = any(word in title for word in ("resumen", "highlight", "highlights", "goles"))
        has_home = any(term in title for term in _team_terms(home))
        has_away = any(term in title for term in _team_terms(away))
        if video_id and has_keyword and has_home and has_away:
            print(f"  ✅  Encontrado: [{video_id}] {title_raw[:70]}")
            return video_id
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

    # Timestamps de la última búsqueda por partido (para partidos sin resultado aún)
    last_searched = highlights.get("_last_searched", {})
    now_utc = datetime.now(timezone.utc)

    for m in played:
        name = m.get("name", "")
        if not name:
            continue
        if name in highlights and not name.startswith("_"):
            # Ya tenemos el video_id guardado
            continue

        # Rate-limit: no buscar el mismo partido más de 1 vez cada 30 min
        last_ts_str = last_searched.get(name)
        if last_ts_str:
            try:
                last_ts = datetime.fromisoformat(last_ts_str)
                if last_ts.tzinfo is None:
                    last_ts = last_ts.replace(tzinfo=timezone.utc)
                if now_utc - last_ts < HL_SEARCH_INTERVAL:
                    print(f"  ⏩ {name}: buscado hace < 30 min, esperando")
                    continue
            except ValueError:
                pass

        home  = m.get("home", "")
        away  = m.get("away", "")
        date  = m.get("date", "")

        print(f"  🔍 {name} ({home} vs {away})")
        video_id = _search_highlight(api_key, name, home, away, date)
        # Registrar timestamp de búsqueda (con o sin resultado)
        last_searched[name] = now_utc.strftime("%Y-%m-%dT%H:%M:%SZ")
        if video_id:
            highlights[name] = video_id
        changed = True  # siempre guardar para actualizar _last_searched

    highlights["_last_searched"] = last_searched
    if changed:
        _save_json(HIGHLIGHTS_JSON, highlights)
        found = sum(1 for k, v in highlights.items() if not k.startswith("_") and v)
        print(f"✅ Guardados en {HIGHLIGHTS_JSON} ({found} resúmenes encontrados)")
    else:
        print("ℹ️  Sin novedades en highlights")


if __name__ == "__main__":
    main()

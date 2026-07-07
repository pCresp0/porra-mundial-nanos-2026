"""
Sedes y emisión en España (DAZN / TVE La 1) — Copa Mundial FIFA 2026.
Fuentes: calendario FIFA + calendario TV España (RTVC / DAZN).
"""

# ── Venue data for each of the 16 stadiums ───────────────────────────────────
VENUES = {
    "Ciudad de México": {
        "stadium": "Estadio Azteca",
        "lat": 19.3029, "lon": -99.1505,
        "capacity": 83_000,
        "city_pop": "21.5 M (área metro)",
        "country": "México",
        "wiki": "Estadio_Azteca",
        "fact": "El único estadio en albergar dos finales de Copa del Mundo (1970 y 1986).",
    },
    "Guadalajara": {
        "stadium": "Estadio Akron",
        "lat": 20.6869, "lon": -103.4623,
        "capacity": 46_232,
        "city_pop": "5.3 M (área metro)",
        "country": "México",
        "wiki": "Estadio_Akron",
        "fact": "Casa del Chivas de Guadalajara. Inaugurado en 2010.",
    },
    "Monterrey": {
        "stadium": "Estadio BBVA",
        "lat": 25.6697, "lon": -100.2445,
        "capacity": 53_500,
        "city_pop": "5.1 M (área metro)",
        "country": "México",
        "wiki": "Estadio_BBVA",
        "fact": "Considerado uno de los mejores estadios de fútbol de América.",
    },
    "Toronto": {
        "stadium": "BMO Field",
        "lat": 43.6333, "lon": -79.4181,
        "capacity": 30_000,
        "city_pop": "6.7 M (área metro)",
        "country": "Canadá",
        "wiki": "BMO_Field",
        "fact": "Sede principal del Toronto FC. A orillas del lago Ontario.",
    },
    "Vancouver": {
        "stadium": "BC Place",
        "lat": 49.2767, "lon": -123.1118,
        "capacity": 54_500,
        "city_pop": "2.6 M (área metro)",
        "country": "Canadá",
        "wiki": "BC_Place",
        "fact": "Estadio cubierto con el techo retráctil más grande del mundo.",
    },
    "Los Ángeles": {
        "stadium": "SoFi Stadium",
        "lat": 33.9535, "lon": -118.3392,
        "capacity": 70_240,
        "city_pop": "13.2 M (área metro)",
        "country": "EE.UU.",
        "wiki": "SoFi_Stadium",
        "fact": "El estadio más caro jamás construido (~5.500 M$). Casa de los Rams y Chargers.",
    },
    "San Francisco": {
        "stadium": "Levi's Stadium",
        "lat": 37.4032, "lon": -121.9697,
        "capacity": 68_500,
        "city_pop": "7.7 M (área metro)",
        "country": "EE.UU.",
        "wiki": "Levi%27s_Stadium",
        "fact": "Casa de los San Francisco 49ers. Tecnología solar propia.",
    },
    "Houston": {
        "stadium": "NRG Stadium",
        "lat": 29.6847, "lon": -95.4107,
        "capacity": 72_220,
        "city_pop": "7.3 M (área metro)",
        "country": "EE.UU.",
        "wiki": "NRG_Stadium",
        "fact": "Primer estadio del Super Bowl con techo retráctil.",
    },
    "Dallas": {
        "stadium": "AT&T Stadium",
        "lat": 32.7480, "lon": -97.0943,
        "capacity": 80_000,
        "city_pop": "7.8 M (área metro)",
        "country": "EE.UU.",
        "wiki": "AT%26T_Stadium",
        "fact": "Conocido como «Jerry World». Tiene la pantalla de TV más grande del mundo.",
    },
    "Kansas City": {
        "stadium": "Arrowhead Stadium",
        "lat": 39.0489, "lon": -94.4839,
        "capacity": 76_416,
        "city_pop": "2.2 M (área metro)",
        "country": "EE.UU.",
        "wiki": "Arrowhead_Stadium",
        "fact": "Registrado como el estadio más ruidoso del mundo en 2014 (142.2 dB).",
    },
    "Miami": {
        "stadium": "Hard Rock Stadium",
        "lat": 25.9580, "lon": -80.2389,
        "capacity": 65_326,
        "city_pop": "6.2 M (área metro)",
        "country": "EE.UU.",
        "wiki": "Hard_Rock_Stadium",
        "fact": "Sede del Super Bowl VI veces. A 30 km del centro de Miami.",
    },
    "Filadelfia": {
        "stadium": "Lincoln Financial Field",
        "lat": 39.9007, "lon": -75.1675,
        "capacity": 69_176,
        "city_pop": "6.2 M (área metro)",
        "country": "EE.UU.",
        "wiki": "Lincoln_Financial_Field",
        "fact": "Casa de los Philadelphia Eagles. En el corazón del «Linc».",
    },
    "Nueva York": {
        "stadium": "MetLife Stadium",
        "lat": 40.8135, "lon": -74.0744,
        "capacity": 82_500,
        "city_pop": "20.1 M (área metro)",
        "country": "EE.UU.",
        "wiki": "MetLife_Stadium",
        "fact": "Albergará la Final del Mundial 2026 el 19 de julio. Sede del Super Bowl XLVIII.",
    },
    "Boston": {
        "stadium": "Gillette Stadium",
        "lat": 42.0909, "lon": -71.2643,
        "capacity": 65_878,
        "city_pop": "4.9 M (área metro)",
        "country": "EE.UU.",
        "wiki": "Gillette_Stadium",
        "fact": "Casa de los New England Patriots, 6 veces campeones del Super Bowl.",
    },
    "Seattle": {
        "stadium": "Lumen Field",
        "lat": 47.5952, "lon": -122.3316,
        "capacity": 68_740,
        "city_pop": "4.0 M (área metro)",
        "country": "EE.UU.",
        "wiki": "Lumen_Field",
        "fact": "Rodeado de agua por tres lados. Sede de los Seahawks y del Seattle Sounders.",
    },
    "Atlanta": {
        "stadium": "Mercedes-Benz Stadium",
        "lat": 33.7554, "lon": -84.4010,
        "capacity": 71_000,
        "city_pop": "6.2 M (área metro)",
        "country": "EE.UU.",
        "wiki": "Mercedes-Benz_Stadium",
        "fact": "Estadio con el techo de pétalos más grande del mundo. Super Bowl LIII en 2019.",
    },
}


def get_venue(city: str) -> dict:
    return VENUES.get(city, {})


# ── TV broadcast in Spain per match row ──────────────────────────────────────
FIXTURE_BY_ROW = {
    # ── Fase de grupos — jornada 1 ──
    6:  {"city": "Ciudad de México", "tv": "both"},
    7:  {"city": "Guadalajara",      "tv": "dazn"},
    8:  {"city": "Toronto",          "tv": "both"},
    9:  {"city": "San Francisco",    "tv": "dazn"},
    10: {"city": "Nueva York",       "tv": "both"},
    11: {"city": "Boston",           "tv": "dazn"},
    12: {"city": "Los Ángeles",      "tv": "dazn"},
    13: {"city": "Vancouver",        "tv": "dazn"},
    14: {"city": "Houston",          "tv": "both"},
    15: {"city": "Filadelfia",       "tv": "dazn"},
    16: {"city": "Dallas",           "tv": "dazn"},
    17: {"city": "Monterrey",        "tv": "dazn"},
    18: {"city": "Seattle",          "tv": "dazn"},
    19: {"city": "Los Ángeles",      "tv": "dazn"},
    20: {"city": "Atlanta",          "tv": "both"},
    21: {"city": "Miami",            "tv": "dazn"},
    22: {"city": "Nueva York",       "tv": "both"},
    23: {"city": "Boston",           "tv": "dazn"},
    24: {"city": "Kansas City",      "tv": "dazn"},
    25: {"city": "San Francisco",    "tv": "dazn"},
    26: {"city": "Houston",          "tv": "dazn"},
    27: {"city": "Ciudad de México", "tv": "dazn"},
    28: {"city": "Dallas",           "tv": "both"},
    29: {"city": "Toronto",          "tv": "dazn"},
    # ── jornada 2 ──
    30: {"city": "Atlanta",          "tv": "dazn"},
    31: {"city": "Guadalajara",      "tv": "dazn"},
    32: {"city": "Los Ángeles",      "tv": "both"},
    33: {"city": "Vancouver",        "tv": "dazn"},
    34: {"city": "Boston",           "tv": "dazn"},
    35: {"city": "Filadelfia",       "tv": "dazn"},
    36: {"city": "Seattle",          "tv": "both"},
    37: {"city": "San Francisco",    "tv": "dazn"},
    38: {"city": "Toronto",          "tv": "dazn"},
    39: {"city": "Kansas City",      "tv": "dazn"},
    40: {"city": "Houston",          "tv": "both"},
    41: {"city": "Monterrey",        "tv": "dazn"},
    42: {"city": "Los Ángeles",      "tv": "dazn"},
    43: {"city": "Vancouver",        "tv": "dazn"},
    44: {"city": "Atlanta",          "tv": "both"},
    45: {"city": "Miami",            "tv": "dazn"},
    46: {"city": "Filadelfia",       "tv": "dazn"},
    47: {"city": "Nueva York",       "tv": "dazn"},
    48: {"city": "Dallas",           "tv": "both"},
    49: {"city": "San Francisco",    "tv": "dazn"},
    50: {"city": "Houston",          "tv": "dazn"},
    51: {"city": "Guadalajara",      "tv": "dazn"},
    52: {"city": "Boston",           "tv": "both"},
    53: {"city": "Toronto",          "tv": "dazn"},
    # ── jornada 3 ──
    54: {"city": "Ciudad de México", "tv": "dazn"},
    55: {"city": "Monterrey",        "tv": "dazn"},
    56: {"city": "Vancouver",        "tv": "dazn"},
    57: {"city": "Seattle",          "tv": "dazn"},
    58: {"city": "Miami",            "tv": "dazn"},
    59: {"city": "Atlanta",          "tv": "dazn"},
    60: {"city": "Los Ángeles",      "tv": "dazn"},
    61: {"city": "San Francisco",    "tv": "dazn"},
    62: {"city": "Filadelfia",       "tv": "dazn"},
    63: {"city": "Nueva York",       "tv": "both"},
    64: {"city": "Dallas",           "tv": "dazn"},
    65: {"city": "Kansas City",      "tv": "dazn"},
    66: {"city": "Seattle",          "tv": "dazn"},
    67: {"city": "Vancouver",        "tv": "dazn"},
    68: {"city": "Houston",          "tv": "dazn"},
    69: {"city": "Guadalajara",      "tv": "both"},
    70: {"city": "Boston",           "tv": "dazn"},
    71: {"city": "Toronto",          "tv": "dazn"},
    72: {"city": "Kansas City",      "tv": "dazn"},
    73: {"city": "Dallas",           "tv": "dazn"},
    74: {"city": "Miami",            "tv": "both"},
    75: {"city": "Atlanta",          "tv": "dazn"},
    76: {"city": "Nueva York",       "tv": "dazn"},
    77: {"city": "Filadelfia",       "tv": "dazn"},
    # ── Dieciseisavos ──
    164: {"city": "Los Ángeles",      "tv": "dazn"},  # Sudáfrica-Canadá
    165: {"city": "Houston",          "tv": "dazn"},  # Brasil-Japón
    166: {"city": "Boston",           "tv": "dazn"},  # Alemania-Paraguay
    167: {"city": "Monterrey",        "tv": "dazn"},  # Países Bajos-Marruecos
    168: {"city": "Dallas",           "tv": "dazn"},  # Costa de Marfil-Noruega
    169: {"city": "Nueva York",       "tv": "both"},  # Francia-Suecia (La 1 de RTVE y DAZN)
    170: {"city": "Ciudad de México", "tv": "dazn"},  # México-Ecuador
    171: {"city": "Atlanta",          "tv": "dazn"},  # Inglaterra-RD Congo
    172: {"city": "Seattle",          "tv": "dazn"},  # Bélgica-Senegal
    173: {"city": "San Francisco",    "tv": "dazn"},  # Estados Unidos-Bosnia y Herzegovina
    174: {"city": "Los Ángeles",      "tv": "both"},  # España-Austria (La 1 de RTVE y DAZN)
    175: {"city": "Toronto",          "tv": "dazn"},  # Portugal-Croacia
    176: {"city": "Vancouver",        "tv": "dazn"},  # Suiza-Argelia
    177: {"city": "Dallas",           "tv": "dazn"},  # Australia-Egipto
    178: {"city": "Miami",            "tv": "dazn"},  # Argentina-Cabo Verde
    179: {"city": "Kansas City",      "tv": "dazn"},  # Colombia-Ghana
    # ── Octavos (calendario TV España, jul 2026) ──
    200: {"city": "Filadelfia",       "tv": "both"},  # 4 jul 23:00 Paraguay-Francia · La 1 + DAZN
    201: {"city": "Houston",          "tv": "dazn"},  # 4 jul 19:00 Canadá-Marruecos · DAZN
    202: {"city": "Nueva York",       "tv": "both"},  # 5 jul 22:00 Brasil-Noruega · La 1 + DAZN
    203: {"city": "Ciudad de México", "tv": "dazn"},  # 6 jul 02:00 México-Inglaterra · DAZN
    204: {"city": "Dallas",           "tv": "both"},  # 6 jul 21:00 Portugal-España · La 1 + DAZN
    205: {"city": "Seattle",          "tv": "dazn"},  # 7 jul 02:00 EE.UU.-Bélgica · DAZN
    206: {"city": "Atlanta",          "tv": "dazn"},  # 7 jul 19:00 Argentina-Egipto · DAZN
    207: {"city": "Vancouver",        "tv": "dazn"},  # 7 jul 22:00 Suiza-Colombia · DAZN
    # ── Cuartos ──
    220: {"city": "Boston",           "tv": "dazn"},  # 9 jul 21:00 Francia-Marruecos
    221: {"city": "Los Ángeles",      "tv": "both"},  # 10 jul 23:00 España-Bélgica
    222: {"city": "Miami",            "tv": "dazn"},  # 11 jul 22:00 Noruega-Inglaterra
    223: {"city": "Kansas City",      "tv": "dazn"},  # 12 jul 03:00 W95-W96
    # ── Semis ──
    232: {"city": "Dallas",           "tv": "both"},
    233: {"city": "Atlanta",          "tv": "both"},
    # ── 3º puesto y Final ──
    244: {"city": "Miami",            "tv": "both"},
    247: {"city": "Nueva York",       "tv": "both"},
}

TV_LABELS = {
    "dazn": "DAZN",
    "tve":  "TVE La 1",
    "both": "DAZN + TVE La 1",
}

# Horarios España peninsular para filas sin fecha en WORLDCUP (col X).
# Evita que data.json quede con date="Octavos de" / "Cuartos de".
SCHEDULE_BY_ROW: dict[int, dict] = {
    205: {"date": "2026-07-07", "time_es": "02:00", "day_label": "Martes 07 julio"},
    206: {"date": "2026-07-07", "time_es": "19:00", "day_label": "Martes 07 julio"},
    207: {"date": "2026-07-07", "time_es": "22:00", "day_label": "Martes 07 julio"},
    220: {"date": "2026-07-09", "time_es": "21:00", "day_label": "Jueves 09 julio"},
    221: {"date": "2026-07-10", "time_es": "23:00", "day_label": "Viernes 10 julio"},
    222: {"date": "2026-07-11", "time_es": "22:00", "day_label": "Sábado 11 julio"},
    223: {"date": "2026-07-12", "time_es": "03:00", "day_label": "Domingo 12 julio"},
}


def lookup_fixture(row: int) -> dict:
    f = FIXTURE_BY_ROW.get(row, {})
    if not f:
        sched = SCHEDULE_BY_ROW.get(row, {})
        return dict(sched)
    city = f["city"]
    venue = get_venue(city)
    out = {
        "city":      city,
        "country":   venue.get("country", ""),
        "tv":        f.get("tv", ""),
        "stadium":   venue.get("stadium", ""),
        "lat":       venue.get("lat"),
        "lon":       venue.get("lon"),
        "capacity":  venue.get("capacity"),
        "city_pop":  venue.get("city_pop", ""),
        "fact":      venue.get("fact", ""),
        "wiki":      venue.get("wiki", ""),
    }
    out.update(SCHEDULE_BY_ROW.get(row, {}))
    return out

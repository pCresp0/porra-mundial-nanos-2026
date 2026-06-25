"""Map API team names (English) → Excel WORLDCUP names (Spanish)."""

import unicodedata


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFD", s.lower().strip())
    return "".join(c for c in s if unicodedata.category(c) != "Mn")


# English / API variants → Spanish name used in Excel WORLDCUP
EN_TO_ES = {
    "mexico": "México",
    "south africa": "Sudáfrica",
    "south korea": "Corea del Sur",
    "korea republic": "Corea del Sur",
    "czech republic": "República Checa",
    "czechia": "República Checa",
    "canada": "Canadá",
    "bosnia and herzegovina": "Bosnia y Herzegovina",
    "bosnia & herzegovina": "Bosnia y Herzegovina",
    "bosnia-herzegovina": "Bosnia y Herzegovina",
    "qatar": "Catar",
    "switzerland": "Suiza",
    "brazil": "Brasil",
    "morocco": "Marruecos",
    "haiti": "Haití",
    "scotland": "Escocia",
    "usa": "Estados Unidos",
    "united states": "Estados Unidos",
    "australia": "Australia",
    "turkey": "Turquía",
    "turkiye": "Turquía",
    "germany": "Alemania",
    "curacao": "Curazao",
    "curaçao": "Curazao",
    "ivory coast": "Costa de Marfil",
    "cote d'ivoire": "Costa de Marfil",
    "ecuador": "Ecuador",
    "netherlands": "Países Bajos",
    "japan": "Japón",
    "sweden": "Suecia",
    "tunisia": "Túnez",
    "belgium": "Bélgica",
    "egypt": "Egipto",
    "iran": "Irán",
    "new zealand": "Nueva Zelanda",
    "spain": "España",
    "cape verde": "Cabo Verde",
    "saudi arabia": "Arabia Saudita",
    "uruguay": "Uruguay",
    "france": "Francia",
    "senegal": "Senegal",
    "iraq": "Irak",
    "norway": "Noruega",
    "argentina": "Argentina",
    "algeria": "Argelia",
    "austria": "Austria",
    "jordan": "Jordania",
    "portugal": "Portugal",
    "dr congo": "RD Congo",
    "democratic republic of the congo": "RD Congo",
    "congo dr": "RD Congo",
    "uzbekistan": "Uzbekistán",
    "colombia": "Colombia",
    "england": "Inglaterra",
    "croatia": "Croacia",
    "ghana": "Ghana",
    "panama": "Panamá",
    "paraguay": "Paraguay",
}


def to_spanish(name_en: str) -> str:
    if not name_en:
        return ""
    key = _norm(name_en)
    if key in EN_TO_ES:
        return EN_TO_ES[key]
    # fallback: title-case original
    return name_en.strip()

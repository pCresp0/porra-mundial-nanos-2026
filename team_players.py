"""
Jugadores clave a seguir por cada selección — Copa Mundial FIFA 2026.
Fuente: plantillas confirmadas para el Mundial 2026.
Keyed by FIFA code (uppercase).
"""

# Each player: {name, pos, club, age, note}
KEY_PLAYERS = {
    # ── Grupo A ──────────────────────────────────────────────────────────────
    "MEX": [
        {"name": "Santiago Giménez",  "pos": "DC",  "club": "Feyenoord",         "note": "Máximo goleador de México en activo"},
        {"name": "Hirving Lozano",    "pos": "EXT", "club": "PSV",               "note": "Velocidad y desborde por la banda"},
        {"name": "Guillermo Ochoa",   "pos": "POR", "club": "Club América",       "note": "Leyenda viva del fútbol mexicano"},
        {"name": "Edson Álvarez",     "pos": "MCD", "club": "West Ham",          "note": "Pilar del centro del campo"},
    ],
    "RSA": [
        {"name": "Percy Tau",         "pos": "EXT", "club": "Mamelodi Sundowns", "note": "Mejor jugador africano 2022"},
        {"name": "Themba Zwane",      "pos": "MC",  "club": "Mamelodi Sundowns", "note": "Elegancia y visión de juego"},
        {"name": "Ronwen Williams",   "pos": "POR", "club": "Mamelodi Sundowns", "note": "Portero número 1 de Sudáfrica"},
    ],
    "KOR": [
        {"name": "Son Heung-min",     "pos": "EXT", "club": "Tottenham",         "note": "Capitán y referencia absoluta"},
        {"name": "Lee Jae-sung",      "pos": "MC",  "club": "Mainz",             "note": "Motor del centro del campo"},
        {"name": "Kim Min-jae",       "pos": "DFC", "club": "Bayern München",    "note": "Uno de los mejores centrales del mundo"},
    ],
    "CZE": [
        {"name": "Patrik Schick",     "pos": "DC",  "club": "Bayer Leverkusen",  "note": "Potencia y gol. 2º goleador de la Eurocopa 2020"},
        {"name": "Tomáš Souček",      "pos": "MCD", "club": "West Ham",          "note": "Presencia aérea y garra"},
        {"name": "Vladimír Coufal",   "pos": "LAD", "club": "West Ham",          "note": "Lateral derecho fiable y con llegada"},
    ],
    # ── Grupo B ──────────────────────────────────────────────────────────────
    "CAN": [
        {"name": "Alphonso Davies",   "pos": "LAI", "club": "Bayern München",    "note": "Velocidad extrema. Mejor jugador canadiense de la historia"},
        {"name": "Jonathan David",    "pos": "DC",  "club": "Lille",             "note": "Uno de los goleadores más letales de Europa"},
        {"name": "Tajon Buchanan",    "pos": "EXT", "club": "Inter de Milán",    "note": "Desequilibrio por la banda"},
    ],
    "BIH": [
        {"name": "Edin Džeko",        "pos": "DC",  "club": "Fenerbahçe",        "note": "Máximo goleador histórico de Bosnia"},
        {"name": "Miralem Pjanić",    "pos": "MC",  "club": "Retirado/Amateur",  "note": "Leyenda bosnia (posible convocatoria)"},
        {"name": "Ermedin Demirović", "pos": "DC",  "club": "Stuttgart",         "note": "Nuevo referente del gol bosnio"},
    ],
    "QAT": [
        {"name": "Akram Afif",        "pos": "EXT", "club": "Al-Sadd",           "note": "Mejor jugador de la Copa de Asia 2023"},
        {"name": "Almoez Ali",        "pos": "DC",  "club": "Al-Duhail",         "note": "Máximo goleador histórico de Qatar"},
        {"name": "Abdelkarim Hassan", "pos": "LAI", "club": "Al-Arabi",          "note": "Lateral rápido y con llegada"},
    ],
    "SUI": [
        {"name": "Granit Xhaka",      "pos": "MC",  "club": "Bayer Leverkusen",  "note": "Liderazgo y técnica. Corazón de Suiza"},
        {"name": "Xherdan Shaqiri",   "pos": "EXT", "club": "Chicago Fire",      "note": "Imprevisible. Campeón de la Eurocopa 2008"},
        {"name": "Yann Sommer",       "pos": "POR", "club": "Inter de Milán",    "note": "Portero de clase mundial"},
        {"name": "Manuel Akanji",     "pos": "DFC", "club": "Man City",          "note": "Central sólido y con salida de balón"},
    ],
    # ── Grupo C ──────────────────────────────────────────────────────────────
    "BRA": [
        {"name": "Vinícius Jr.",      "pos": "EXT", "club": "Real Madrid",       "note": "Balón de Oro 2024. El más desequilibrante del mundo"},
        {"name": "Rodrygo",           "pos": "EXT", "club": "Real Madrid",       "note": "Clutch player. Decisivo en los grandes momentos"},
        {"name": "Endrick",           "pos": "DC",  "club": "Real Madrid",       "note": "Joya de 18 años. El futuro del fútbol brasileño"},
        {"name": "Alisson Becker",    "pos": "POR", "club": "Liverpool",         "note": "Mejor portero del mundo en los últimos años"},
    ],
    "MAR": [
        {"name": "Achraf Hakimi",     "pos": "LAD", "club": "PSG",               "note": "Mejor lateral derecho del mundo. 4º puesto en Qatar 2022"},
        {"name": "Hakim Ziyech",      "pos": "EXT", "club": "Galatasaray",       "note": "Magia y creatividad en el ataque"},
        {"name": "Youssef En-Nesyri", "pos": "DC",  "club": "Fenerbahçe",        "note": "Punta letal. Héroe de la semifinal del 2022"},
        {"name": "Sofyan Amrabat",    "pos": "MCD", "club": "Fiorentina",        "note": "Destructor con balón. Sensación del Mundial 2022"},
    ],
    "HAI": [
        {"name": "Frantzdy Pierrot",  "pos": "DC",  "club": "Atlanta United",    "note": "Artillero de la MLS"},
        {"name": "Duckens Nazon",     "pos": "EXT", "club": "Panathinaikos",     "note": "Velocidad y desborde"},
        {"name": "Naïco Ducasse",     "pos": "MC",  "club": "FC Nantes",         "note": "Mediocampista elegante"},
    ],
    "SCO": [
        {"name": "Andrew Robertson",  "pos": "LAI", "club": "Liverpool",         "note": "Capitán. Uno de los mejores laterales del mundo"},
        {"name": "Scott McTominay",   "pos": "MC",  "club": "Napoli",            "note": "Gol y llegada desde segunda línea"},
        {"name": "Che Adams",         "pos": "DC",  "club": "Torino",            "note": "Delantero físico y trabajador"},
    ],
    # ── Grupo D ──────────────────────────────────────────────────────────────
    "USA": [
        {"name": "Christian Pulisic", "pos": "EXT", "club": "AC Milan",          "note": "Capitán y estrella. «Captain America»"},
        {"name": "Tyler Adams",       "pos": "MCD", "club": "Bournemouth",       "note": "Dinamismo e intensidad en el centro"},
        {"name": "Gio Reyna",         "pos": "MC",  "club": "Borussia Dortmund", "note": "Talento generacional. Hijo de Claudio Reyna"},
        {"name": "Matt Turner",       "pos": "POR", "club": "Crystal Palace",    "note": "Portero seguro bajo los tres palos"},
    ],
    "PRY": [
        {"name": "Miguel Almirón",    "pos": "MC",  "club": "Newcastle",         "note": "Motor incansable. Dobletes con Newcastle"},
        {"name": "Julio Enciso",      "pos": "EXT", "club": "Brighton",          "note": "Joven talento. El nuevo referente paraguayo"},
        {"name": "Gustavo Gómez",     "pos": "DFC", "club": "Palmeiras",         "note": "Capitán. Líder de la defensa"},
    ],
    "AUS": [
        {"name": "Mathew Ryan",       "pos": "POR", "club": "Real Sociedad",     "note": "Portero experimentado y seguro"},
        {"name": "Marco Tilio",       "pos": "EXT", "club": "Celtic",            "note": "Joven promesa del fútbol australiano"},
        {"name": "Mitchell Duke",     "pos": "DC",  "club": "FC Macarthur",      "note": "Héroe del gol ante Dinamarca en Qatar 2022"},
    ],
    "TUR": [
        {"name": "Arda Güler",        "pos": "MC",  "club": "Real Madrid",       "note": "Joya de 19 años. El nuevo Özil"},
        {"name": "Hakan Çalhanoğlu",  "pos": "MCD", "club": "Inter de Milán",    "note": "Lanzador de falta letal. Cerebro del equipo"},
        {"name": "Merih Demiral",     "pos": "DFC", "club": "Al-Ahli",           "note": "Central potente y buen salto"},
        {"name": "Kerem Aktürkoğlu",  "pos": "EXT", "club": "Galatasaray",       "note": "Velocidad y regates. Goleador en Champions"},
    ],
    # ── Grupo E ──────────────────────────────────────────────────────────────
    "GER": [
        {"name": "Jamal Musiala",     "pos": "MC",  "club": "Bayern München",    "note": "El más prometedor de Europa. Gambeta y gol"},
        {"name": "Florian Wirtz",     "pos": "MC",  "club": "Bayer Leverkusen",  "note": "Elegancia y visión. Corazón del Leverkusen campeón"},
        {"name": "Harry Kane",        "pos": "DC",  "club": "Bayern München",    "note": "Máximo goleador de la historia del Bayern"},
        {"name": "Toni Kroos",        "pos": "MC",  "club": "Real Madrid",       "note": "Regresó a las convocatorias. Leyenda absoluta"},
    ],
    "CUW": [
        {"name": "Leandro Bacuna",    "pos": "MC",  "club": "Burton Albion",     "note": "Experiencia y técnica"},
        {"name": "Jarchinio Antonia", "pos": "EXT", "club": "Beerschot",         "note": "Habilidad y regates"},
        {"name": "Cuco Martina",      "pos": "LAD", "club": "Retirado",          "note": "Leyenda y capitán histórico"},
    ],
    "CIV": [
        {"name": "Sébastien Haller",  "pos": "DC",  "club": "Borussia Dortmund", "note": "Luchó contra el cáncer y volvió más fuerte"},
        {"name": "Franck Kessié",     "pos": "MC",  "club": "Al-Ahli",           "note": "Físico y gol. Pulmón del centro"},
        {"name": "Nicolas Pépé",      "pos": "EXT", "club": "OGC Niza",          "note": "Desequilibrio y velocidad"},
    ],
    "ECU": [
        {"name": "Enner Valencia",    "pos": "DC",  "club": "LDU Quito",         "note": "El goleador histórico de Ecuador. Héroe de Qatar 2022"},
        {"name": "Moisés Caicedo",    "pos": "MCD", "club": "Chelsea",           "note": "Centrocampista élite. Fichaje récord del Chelsea"},
        {"name": "Gonzalo Plata",     "pos": "EXT", "club": "Galatasaray",       "note": "Velocidad y peligro por la derecha"},
    ],
    # ── Grupo F ──────────────────────────────────────────────────────────────
    "NED": [
        {"name": "Virgil van Dijk",   "pos": "DFC", "club": "Liverpool",         "note": "Mejor central del mundo en los últimos años"},
        {"name": "Cody Gakpo",        "pos": "EXT", "club": "Liverpool",         "note": "Llegó al Mundial 2022 de suplente y fue figura"},
        {"name": "Frenkie de Jong",   "pos": "MC",  "club": "Barcelona",         "note": "El más elegante de Países Bajos"},
        {"name": "Memphis Depay",     "pos": "DC",  "club": "Corinthians",       "note": "Gol e instinto en cualquier equipo"},
    ],
    "JPN": [
        {"name": "Takehiro Tomiyasu", "pos": "DFC", "club": "Arsenal",           "note": "Polivalente. Titular en el Arsenal"},
        {"name": "Wataru Endō",       "pos": "MCD", "club": "Liverpool",         "note": "Fichaje sorpresa del Liverpool. Solidez en el centro"},
        {"name": "Takumi Minamino",   "pos": "MC",  "club": "Monaco",            "note": "Gol y trabajo. Referente japonés en Europa"},
        {"name": "Ritsu Doan",        "pos": "EXT", "club": "SC Freiburg",       "note": "Goleador del histórico 2-1 a Alemania en Qatar"},
    ],
    "SWE": [
        {"name": "Victor Nilsson Lindelöf", "pos": "DFC", "club": "Man United", "note": "Central sólido y con salida de balón"},
        {"name": "Dejan Kulusevski",  "pos": "EXT", "club": "Tottenham",         "note": "Creatividad y llegada desde la banda"},
        {"name": "Alexander Isak",    "pos": "DC",  "club": "Newcastle",         "note": "Rápido y letal. Figura de la Premier League"},
    ],
    "TUN": [
        {"name": "Youssef Msakni",    "pos": "EXT", "club": "Espérance",         "note": "Líder histórico. El referente ofensivo"},
        {"name": "Wahbi Khazri",      "pos": "MC",  "club": "Montpellier",       "note": "Experiencia y calidad en el balón parado"},
        {"name": "Dylan Bronn",       "pos": "DFC", "club": "Salernitana",       "note": "Solidez defensiva"},
    ],
    # ── Grupo G ──────────────────────────────────────────────────────────────
    "BEL": [
        {"name": "Kevin De Bruyne",   "pos": "MC",  "club": "Man City",          "note": "Quizás el mejor centrocampista del mundo"},
        {"name": "Romelu Lukaku",     "pos": "DC",  "club": "Roma",              "note": "El goleador histórico de Bélgica. Fuerza bruta"},
        {"name": "Thibaut Courtois",  "pos": "POR", "club": "Real Madrid",       "note": "Uno de los mejores porteros del mundo"},
        {"name": "Lois Openda",       "pos": "DC",  "club": "RB Leipzig",        "note": "Goleador en auge. La nueva generación belga"},
    ],
    "EGY": [
        {"name": "Mohamed Salah",     "pos": "EXT", "club": "Liverpool",         "note": "El Faraón. Uno de los 3 mejores jugadores del mundo"},
        {"name": "Omar Marmoush",     "pos": "EXT", "club": "Man City",          "note": "En estado de gracia. Máximo goleador de la Bundesliga 2023/24"},
        {"name": "Mohamed El-Shenawy","pos": "POR", "club": "Al-Ahly",           "note": "Portero experto en la Champions africana"},
    ],
    "IRN": [
        {"name": "Mehdi Taremi",      "pos": "DC",  "club": "Inter de Milán",    "note": "Técnica y gol. El más completo de Irán"},
        {"name": "Sardar Azmoun",     "pos": "EXT", "club": "Roma",              "note": "El «Messi iraní». Muy querido en su país"},
        {"name": "Alireza Jahanbakhsh","pos": "EXT","club": "Feyenoord",         "note": "Velocidad y desborde"},
    ],
    "NZL": [
        {"name": "Chris Wood",        "pos": "DC",  "club": "Nottm Forest",      "note": "El goleador histórico de Nueva Zelanda"},
        {"name": "Ryan Thomas",       "pos": "MC",  "club": "PSV",               "note": "Holandés-neozelandés. Técnica en el centro"},
        {"name": "Bill Tuilagi",      "pos": "DFC", "club": "Wigan Athletic",    "note": "Defensa contundente"},
    ],
    # ── Grupo H ──────────────────────────────────────────────────────────────
    "ESP": [
        {"name": "Lamine Yamal",      "pos": "EXT", "club": "Barcelona",         "note": "Campeón de Europa con 17 años. La nueva joya mundial"},
        {"name": "Pedri",             "pos": "MC",  "club": "Barcelona",         "note": "Sucesor de Iniesta. Elegancia y técnica infinita"},
        {"name": "Rodri",             "pos": "MCD", "club": "Man City",          "note": "Balón de Oro 2023. El mejor pivote del mundo"},
        {"name": "Unai Simón",        "pos": "POR", "club": "Athletic Club",     "note": "Portero titular de La Roja desde 2021"},
    ],
    "CPV": [
        {"name": "Garry Rodrigues",   "pos": "EXT", "club": "Galatasaray",       "note": "El mejor jugador histórico de Cabo Verde"},
        {"name": "Jamiro Monteiro",   "pos": "MC",  "club": "New England Rev.",  "note": "Creatividad en el centro del campo"},
        {"name": "Dicko Diagne",      "pos": "DC",  "club": "Stoke City",        "note": "Fuerza y gol"},
    ],
    "KSA": [
        {"name": "Salem Al-Dawsari",  "pos": "EXT", "club": "Al-Hilal",          "note": "El «Messi árabe». Hizo el gol que eliminó a Argentina en 2022"},
        {"name": "Mohamed Kanno",     "pos": "MCD", "club": "Al-Hilal",          "note": "El cerebro del mediocampo saudí"},
        {"name": "Yasser Al-Shahrani","pos": "LAI", "club": "Al-Hilal",          "note": "Lateral con llegada y buen despliegue"},
    ],
    "URU": [
        {"name": "Darwin Núñez",      "pos": "DC",  "club": "Liverpool",         "note": "Explosión física y gol. El gran delantero uruguayo"},
        {"name": "Federico Valverde", "pos": "MC",  "club": "Real Madrid",       "note": "Capacidad física tremenda. Gol y asistencia"},
        {"name": "Ronald Araújo",     "pos": "DFC", "club": "Barcelona",         "note": "Uno de los mejores centrales del mundo"},
        {"name": "Luis Suárez",       "pos": "DC",  "club": "Retirado",          "note": "Leyenda uruguaya. Posible llamada sentimental"},
    ],
    # ── Grupo I ──────────────────────────────────────────────────────────────
    "FRA": [
        {"name": "Kylian Mbappé",     "pos": "DC",  "club": "Real Madrid",       "note": "El mejor del mundo. Capitán y faro ofensivo"},
        {"name": "Antoine Griezmann", "pos": "MC",  "club": "Atlético de Madrid","note": "El corazón de Francia. Campeón del Mundo 2018"},
        {"name": "Aurélien Tchouaméni","pos": "MCD","club": "Real Madrid",       "note": "La nueva generación. Sólido y con balón"},
        {"name": "Mike Maignan",      "pos": "POR", "club": "AC Milan",          "note": "Sucesor de Lloris. Portazo cuando le necesitas"},
    ],
    "SEN": [
        {"name": "Sadio Mané",        "pos": "EXT", "club": "Al-Nassr",          "note": "Campeón Africa Cup 2022. La estrella de Senegal"},
        {"name": "Kalidou Koulibaly", "pos": "DFC", "club": "Al-Hilal",          "note": "Uno de los centrales más completos del mundo"},
        {"name": "Ismaïla Sarr",      "pos": "EXT", "club": "Crystal Palace",    "note": "Velocidad extrema por la banda derecha"},
    ],
    "IRQ": [
        # Porteros
        {"name": "Fahad Talib",       "pos": "POR", "club": "Al-Talaba",         "note": "Portero titular de Iraq"},
        {"name": "Jalal Hassan",      "pos": "POR", "club": "Al-Zawraa",         "note": "Segundo portero"},
        {"name": "Ahmed Basil",       "pos": "POR", "club": "Al-Shorta",         "note": "Tercer portero"},
        # Defensas
        {"name": "Hussein Ali",       "pos": "DFC", "club": "Pogoń Szczecin",    "note": "Central con experiencia en Europa"},
        {"name": "Manaf Younis",      "pos": "DFC", "club": "Al-Shorta",         "note": "Defensa central"},
        {"name": "Zaid Tahseen",      "pos": "DFC", "club": "Pakhtakor",         "note": "Central en Uzbekistán"},
        {"name": "Rebin Sulaka",      "pos": "DFC", "club": "Port FC",           "note": "Defensa lateral"},
        {"name": "Akam Hashem",       "pos": "DFC", "club": "Al-Zawraa",         "note": "Defensa"},
        {"name": "Merchas Doski",     "pos": "DFC", "club": "Viktoria Plzeň",    "note": "Defensa en la liga checa"},
        {"name": "Ahmed Yahya",       "pos": "DFC", "club": "Al-Shorta",         "note": "Defensa"},
        {"name": "Frans Putros",      "pos": "DFC", "club": "Persib Bandung",    "note": "Defensa con experiencia asiática"},
        {"name": "Mustafa Saadoon",   "pos": "DFC", "club": "Al-Shorta",         "note": "Defensa"},
        # Centrocampistas
        {"name": "Zaid Ismail",       "pos": "MC",  "club": "Al-Talaba",         "note": "Centrocampista"},
        {"name": "Amir Al-Ammari",    "pos": "MC",  "club": "Cracovia",          "note": "Mediocampista en Polonia"},
        {"name": "Kevin Yakob",       "pos": "MC",  "club": "AGF Aarhus",        "note": "Centrocampista en Dinamarca"},
        {"name": "Zidane Iqbal",      "pos": "MC",  "club": "FC Utrecht",        "note": "Joven centrocampista formado en el Man United"},
        {"name": "Aimar Sher",        "pos": "MC",  "club": "Sarpsborg 08",      "note": "Centrocampista en Noruega"},
        {"name": "Ibrahim Bayesh",    "pos": "MCD", "club": "Al-Dhafra",         "note": "Pivote defensivo"},
        {"name": "Ahmed Qasim",       "pos": "MC",  "club": "Nashville SC",      "note": "Centrocampista en la MLS"},
        # Delanteros
        {"name": "Youssef Amyn",      "pos": "DC",  "club": "AEK Larnaca",       "note": "Delantero en Chipre"},
        {"name": "Marko Farji",       "pos": "DC",  "club": "Venezia FC",        "note": "Delantero en la Serie A italiana"},
        {"name": "Ali Jassim",        "pos": "DC",  "club": "Al-Najma",          "note": "Delantero"},
        {"name": "Ali Al Hamadi",     "pos": "DC",  "club": "Ipswich Town",      "note": "Delantero en la Premier League"},
        {"name": "Ali Yousef",        "pos": "DC",  "club": "Al-Talaba",         "note": "Delantero"},
        {"name": "Aymen Hussein",     "pos": "DC",  "club": "Al-Karma",          "note": "Máximo goleador de la selección iraquí"},
        {"name": "Mohanad Ali",       "pos": "DC",  "club": "Dibba Al-Hisn",     "note": "Goleador histórico de Iraq"},
    ],
    "NOR": [
        {"name": "Erling Haaland",    "pos": "DC",  "club": "Man City",          "note": "La máquina de hacer goles. Récords en la Premier"},
        {"name": "Martin Ødegaard",   "pos": "MC",  "club": "Arsenal",           "note": "Capitán del Arsenal. Técnica y liderazgo"},
        {"name": "Alexander Sørloth", "pos": "DC",  "club": "Atlético de Madrid","note": "Físico intimidante y muy buen rematador"},
        {"name": "Sander Berge",      "pos": "MCD", "club": "Fulham",            "note": "Contención y distribución en el centro"},
    ],
    # ── Grupo J ──────────────────────────────────────────────────────────────
    "ARG": [
        {"name": "Lionel Messi",      "pos": "DC",  "club": "Inter Miami",       "note": "El mejor de la historia. Campeón del Mundo 2022"},
        {"name": "Julián Álvarez",    "pos": "DC",  "club": "Atlético de Madrid","note": "La araña. Héroe del Mundial 2022. Dos goles en la final"},
        {"name": "Enzo Fernández",    "pos": "MC",  "club": "Chelsea",           "note": "Mejor jugador joven del Mundial 2022"},
        {"name": "Emiliano Martínez", "pos": "POR", "club": "Aston Villa",       "note": "Dibu. El portero de los penaltis históricos"},
    ],
    "DZA": [
        {"name": "Riyad Mahrez",      "pos": "EXT", "club": "Al-Ahli",           "note": "El más técnico del fútbol argelino. Campeón de África 2019"},
        {"name": "Islam Slimani",     "pos": "DC",  "club": "Montpellier",       "note": "Goleador histórico de Argelia"},
        {"name": "Youcef Atal",       "pos": "LAD", "club": "OGC Niza",          "note": "Lateral atacante con mucho peligro"},
    ],
    "AUT": [
        {"name": "Marcel Sabitzer",   "pos": "MC",  "club": "Borussia Dortmund", "note": "Gol y carácter. Motor del mediocampo"},
        {"name": "David Alaba",       "pos": "DFC", "club": "Real Madrid",       "note": "Capitán y leyenda. Polivalencia máxima"},
        {"name": "Christoph Baumgartner","pos": "MC","club": "RB Leipzig",       "note": "Talento en alza. Trabajo y gol"},
    ],
    "JOR": [
        {"name": "Yazan Al-Naimat",   "pos": "DC",  "club": "Al-Jazeera",        "note": "El artillero de la selección jordana"},
        {"name": "Ahmad Hayel",       "pos": "MCD", "club": "Al-Faisaly",        "note": "La sangre del mediocampo jordano"},
        {"name": "Baha' Faisal",      "pos": "EXT", "club": "Al-Ramtha",         "note": "Velocidad y peligro por banda"},
    ],
    # ── Grupo K ──────────────────────────────────────────────────────────────
    "POR": [
        {"name": "Cristiano Ronaldo", "pos": "DC",  "club": "Al-Nassr",          "note": "El máximo goleador de la historia del fútbol internacional"},
        {"name": "Bruno Fernandes",   "pos": "MC",  "club": "Man United",        "note": "Capitán. Creatividad y gol desde el centro"},
        {"name": "Rafael Leão",       "pos": "EXT", "club": "AC Milan",          "note": "Velocidad y desborde. El más explosivo de Portugal"},
        {"name": "Rúben Dias",        "pos": "DFC", "club": "Man City",          "note": "El mejor central portugués. Defensivamente impecable"},
    ],
    "COD": [
        {"name": "Cédric Bakambu",    "pos": "DC",  "club": "OM Marseille",      "note": "El goleador más prolífico de R.D. Congo"},
        {"name": "Chancel Mbemba",    "pos": "DFC", "club": "OM Marseille",      "note": "Central poderoso. Referente defensivo"},
        {"name": "Yannick Bolasie",   "pos": "EXT", "club": "Aris Limassol",     "note": "Velocidad y habilidad por banda"},
    ],
    "UZB": [
        {"name": "Eldor Shomurodov",  "pos": "DC",  "club": "Roma",              "note": "El delantero uzbeko en la Serie A"},
        {"name": "Jaloliddin Masharipov","pos": "MC","club": "Pakhtakor",        "note": "El jugador más técnico de Uzbekistán"},
        {"name": "Dostonbek Khamdamov","pos": "MCD","club": "Pakhtakor",         "note": "Pilar del centro uzbeko"},
    ],
    "COL": [
        {"name": "Luis Díaz",         "pos": "EXT", "club": "Liverpool",         "note": "Velocidad, magia y gol. Figura de Colombia"},
        {"name": "James Rodríguez",   "pos": "MC",  "club": "Rayo Vallecano",    "note": "El Bota de Oro del Mundial 2014. Todavía brillante"},
        {"name": "Richard Ríos",      "pos": "MCD", "club": "Palmeiras",         "note": "La revelación de la Copa América 2024"},
        {"name": "Davinson Sánchez",  "pos": "DFC", "club": "Galatasaray",       "note": "Central con experiencia en las grandes ligas"},
    ],
    # ── Grupo L ──────────────────────────────────────────────────────────────
    "ENG": [
        {"name": "Jude Bellingham",   "pos": "MC",  "club": "Real Madrid",       "note": "El mejor centrocampista de su generación"},
        {"name": "Phil Foden",        "pos": "MC",  "club": "Man City",          "note": "El Mago de Stockport. Habilidad en estado puro"},
        {"name": "Harry Kane",        "pos": "DC",  "club": "Bayern München",    "note": "Máximo goleador histórico de Inglaterra"},
        {"name": "Bukayo Saka",       "pos": "EXT", "club": "Arsenal",           "note": "El chico de oro del Arsenal. Constante y letal"},
    ],
    "HRV": [
        {"name": "Luka Modrić",       "pos": "MC",  "club": "Real Madrid",       "note": "Balón de Oro 2018. Una leyenda viva a sus 38 años"},
        {"name": "Ivan Perišić",      "pos": "EXT", "club": "Hajduk Split",      "note": "Incansable. Héroe del 2º puesto en Rusia 2018"},
        {"name": "Mateo Kovačić",     "pos": "MC",  "club": "Man City",          "note": "Control y velocidad. Imprescindible para Croacia"},
    ],
    "GHA": [
        {"name": "Mohammed Kudus",    "pos": "EXT", "club": "West Ham",          "note": "Joya ghanesa. Técnica y gol en la Premier League"},
        {"name": "André Ayew",        "pos": "MC",  "club": "Le Havre",          "note": "Capitán histórico. Liderazgo y experiencia"},
        {"name": "Jordan Ayew",       "pos": "EXT", "club": "Leicester City",    "note": "Hermano de André. Trabajo y desequilibrio"},
    ],
    "PAN": [
        {"name": "Rolando Blackburn", "pos": "DC",  "club": "Necaxa",            "note": "Fuerza y gol del delantero panameño"},
        {"name": "Cecilio Waterman",  "pos": "DC",  "club": "Club Tijuana",      "note": "Velocidad y peligro en el área"},
        {"name": "Alberto Quintero",  "pos": "EXT", "club": "New England Rev.",  "note": "Desborde y asistencias por banda"},
    ],
}


def get_team_players(fifa_code: str) -> list:
    """Return key players list for a given FIFA code (e.g. 'ESP', 'MEX')."""
    return KEY_PLAYERS.get(fifa_code.upper(), [])

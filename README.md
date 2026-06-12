<p align="center">
  <img src="docs/header-banner.png" alt="Porra Los Nanos Mundial 2026" width="100%" />
</p>

<h1 align="center">Porra Mundial «Los Nanos» 2026</h1>

<p align="center">
  <strong>Dashboard web interactivo para la porra privada del Mundial FIFA 2026</strong><br>
  <a href="https://pcresp0.github.io/porra-mundial-nanos-2026/">🌐 Ver demo en vivo</a>
  &nbsp;·&nbsp;
  <a href="docs/screenshot-partidos.png">📸 Capturas</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Python-3.9+-3776AB?logo=python&logoColor=white" alt="Python" />
  <img src="https://img.shields.io/badge/Flask-3.x-000?logo=flask&logoColor=white" alt="Flask" />
  <img src="https://img.shields.io/badge/GitHub_Pages-live-brightgreen?logo=github" alt="GitHub Pages" />
  <img src="https://img.shields.io/badge/Mundial-2026-F5C518" alt="World Cup 2026" />
</p>

---

## Descripción

Proyecto personal desarrollado para el grupo de amigos **«Los Nanos»** del barrio de **Aluche** (Madrid). Convierte los Excel de administración de la porra en un panel visual con clasificación, partidos, pronósticos, estadísticas y cuadro de honor.

La web **no sustituye al Excel**: lo lee y lo presenta de forma clara para que los seis participantes puedan seguir el torneo sin abrir hojas de cálculo.

| | |
|---|---|
| **Participantes** | Juancho, Larry, Luis/Vir, Medina, Víctor, Crespo |
| **Premios** | 🥇 40 € · 🥈 20 € |
| **Sede del grupo** | Aluche, Madrid |
| **Torneo** | Copa Mundial FIFA 2026 · USA · CANADA · MEXICO |

---

## Demo

🔗 **[https://pcresp0.github.io/porra-mundial-nanos-2026/](https://pcresp0.github.io/porra-mundial-nanos-2026/)**

![Vista de partidos](docs/screenshot-partidos.png)

---

## Características

| Pestaña | Contenido |
|---------|-----------|
| ⚽ **Partidos** | Filtros por semana/fase, sede, TV (DAZN / TVE), desglose de puntos |
| 🏅 **Clasificación** | Podio, tabla por fases, fortalezas y badges por jugador |
| 📈 **Progresión** | Gráfica de puntos acumulados día a día |
| 🏆 **Cuadro de Honor** | Campeón, botas, balones y pronósticos vs. realidad |
| 📋 **Puntuación** | Reglas Matejero extraídas del Excel |
| 📊 **Estadísticas** | Tendencias, tasas de acierto, proyecciones |
| ℹ️ **Más info** | Historia del grupo, arquitectura y créditos |

---

## Arquitectura

Dos modos de despliegue que comparten la misma interfaz (`index.html`):

```
┌─────────────────────────────────────────────────────────────────┐
│                         index.html + static/                    │
│              (Tailwind CSS · Chart.js · 7 pestañas)             │
└────────────────────────────┬────────────────────────────────────┘
                             │
           ┌─────────────────┴─────────────────┐
           ▼                                   ▼
   ┌───────────────┐                   ┌───────────────┐
   │  LOCAL Flask  │                   │ GitHub Pages  │
   │ localhost:5050│                   │  (estático)   │
   └───────┬───────┘                   └───────┬───────┘
           │                                   │
           ▼                                   ▼
   GET /api/data                      GET data.json
           │                                   │
           └─────────────┬─────────────────────┘
                         ▼
              ┌─────────────────────┐
              │  app.py · build_data │
              │  openpyxl → JSON     │
              └──────────┬──────────┘
                         ▼
              ┌─────────────────────┐
              │  data/*.xlsx        │
              │  Excel ADMIN (×2)   │
              └─────────────────────┘
```

### Estructura del repositorio

```
porra-mundial-nanos-2026/
├── index.html              # Interfaz web (raíz → GitHub Pages)
├── data.json               # Snapshot para la versión online
├── data/                   # Excel ADMIN (fuente de verdad en el repo)
│   ├── ADMIN-Excel-… [1].xlsx
│   └── ADMIN-Excel-… [2].xlsx
├── app.py                  # Backend Flask + motor de lectura Excel
├── build_static.py         # Genera data.json
├── fetch_results.py        # Descarga resultados en vivo → Excel
├── fixture_data.py         # Sedes y TV (104 partidos)
├── team_names.py           # Mapeo nombres API → Excel
├── update_config.json      # Horarios de actualización automática
├── launch.py               # Arranque local + Chrome
├── static/                 # Logo WC 2026, favicons, fondos
├── docs/                   # Capturas para el README
└── .github/workflows/      # CI: actualización programada
```

---

## Fuentes de datos

### Excel ADMIN (`data/`)

| Hoja | Contenido |
|------|-----------|
| **ADMIN** | Pronósticos y puntos por partido |
| **CLAS** | Clasificación y desglose por fase |
| **WORLDCUP** | Equipos, horarios, resultados (AC/AD) |

### Complementarios

| Fuente | Uso |
|--------|-----|
| `fixture_data.py` | Ciudad, país y emisión TV en España |
| [worldcup26.ir API](https://worldcup26.ir/get/games) | Resultados en vivo (actualización automática) |

---

## Instalación y uso local

```bash
git clone https://github.com/pCresp0/porra-mundial-nanos-2026.git
cd porra-mundial-nanos-2026
pip install -r requirements.txt
python3 launch.py
```

Abre [http://localhost:5050](http://localhost:5050). En macOS también puedes usar doble clic en `RUN - Porra Los Nanos.command`.

> Si no hay Excel en `data/`, el backend busca en `../00. ADMIN/` (modo desarrollo local).

---

## GitHub Pages

1. **Settings → Pages** → Branch `main` → Folder `/ (root)`
2. La web carga `index.html` + `data.json` + `static/`

### Actualizar manualmente

```bash
# Tras editar pronósticos en Excel:
python3 build_static.py
git add data.json data/
git commit -m "Actualizar datos de la porra"
git push
```

### Actualización automática

GitHub Actions se ejecuta **cada 2 horas en horas pares** (0:00, 2:00, 4:00 … 22:00, hora España):

1. Descarga resultados en vivo y los escribe en el Excel (`fetch_results.py`)
2. Regenera `data.json` (`build_static.py`)
3. Hace commit y push automático

La barra superior de la web muestra *Actualizada a las XX:XX · Próxima actualización a las XX:XX*. Configuración en `update_config.json` y `.github/workflows/update-porra.yml`.

También puedes lanzarlo manualmente: **Actions → Actualizar porra → Run workflow**.

---

## Sistema de puntuación (fase de grupos)

| Criterio | Puntos |
|----------|--------|
| Signo 1X2 | 2 |
| Diferencia de goles *(si acertó 1X2)* | 1 |
| Resultado exacto | 3 |
| **Máximo por partido** | **6** |

Puntos adicionales por posiciones de grupos, eliminatorias, final y cuadro de honor según el Excel ADMIN.

---

## API local

| Endpoint | Descripción |
|----------|-------------|
| `GET /` | Interfaz web |
| `GET /api/data` | JSON completo del dashboard |
| `GET /api/refresh` | Invalida caché (30 s) |

---

## Scripts

| Comando | Descripción |
|---------|-------------|
| `python3 launch.py` | Servidor local en puerto 5050 |
| `python3 build_static.py` | Genera `data.json` desde Excel |
| `python3 build_static.py --fetch` | API + Excel + `data.json` |
| `python3 fetch_results.py` | Solo descarga resultados a Excel |

---

## Limitaciones

- GitHub Pages no ejecuta Python: la versión online depende de `data.json`
- Los pronósticos solo se editan en Excel (la web es de lectura)
- La API de resultados es orientativa; el Excel del grupo sigue siendo la referencia para disputas
- Con pocos partidos jugados, tendencias y fortalezas son indicativas

---

## Autor

**Pablo Crespo** — desarrollo, diseño e integración de datos

<p>
  <a href="https://www.linkedin.com/in/pablocrespobellido/"><img src="https://img.shields.io/badge/LinkedIn-0A66C2?logo=linkedin&logoColor=white" alt="LinkedIn" /></a>
  <a href="https://x.com/CrespoToTheWild"><img src="https://img.shields.io/badge/X-000?logo=x&logoColor=white" alt="X" /></a>
  <a href="https://github.com/pCresp0"><img src="https://img.shields.io/badge/GitHub-181717?logo=github&logoColor=white" alt="GitHub" /></a>
</p>

---

<p align="center"><em>Copa Mundial FIFA 2026 · USA · CANADA · MEXICO · Hecho con ☕ en Aluche</em></p>

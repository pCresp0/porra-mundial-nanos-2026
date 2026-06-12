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
├── team_players.py         # Jugadores destacados por selección
├── excel_sync.py           # Sincroniza 00. ADMIN/ → data/
├── update_schedule.py      # Calcula próxima actualización (banner)
├── update_config.json      # Horarios de actualización automática
├── launch.py               # Arranque local + Chrome
├── test_api.py             # Pruebas manuales de las APIs
├── requirements.txt        # Dependencias (flask, openpyxl)
├── static/                 # Logo WC 2026, favicons, fondos, audio
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
2. La web sirve `index.html` + `data.json` + `static/` (no ejecuta Python en el servidor)

---

## Actualización de datos

La web **solo lee** datos; **nunca escribe** pronósticos. Hay dos flujos distintos que conviene no mezclar:

| | **Goles del Mundial** | **Pronósticos del grupo** |
|---|---|---|
| **Qué es** | Resultado real de cada partido (columnas AC/AD en WORLDCUP) | Lo que apostáis cada uno en el Excel ADMIN |
| **Quién lo actualiza** | Automático (GitHub Actions) | Tú, a mano en Excel |
| **Frecuencia** | **Justo después de cada partido** (el bot vigila cada 30 min) | Cuando cambiéis un pronóstico |
| **¿Hay que hacer push?** | No — el bot lo hace solo | Sí — `build_static.py` + `git push` |

### Flujo automático (goles → web online)

Cuando acaba un partido, **no tienes que subir nada a mano** para que la web pública se entere.
La Action se despierta **cada 30 minutos**, pero un **guardián** (`should_update.py`) decide si hay
trabajo real: solo llama a la API cuando un partido acaba de terminar y su resultado todavía no está
publicado. El resto de veces sale sin gastar nada. Esto es lo que pasa:

```
  API pública                         Repositorio GitHub              Web (GitHub Pages)
  ───────────                         ──────────────────              ────────────────────

  worldcup26.ir/get/games
           │
           ▼
  should_update.py  ──►  ¿hay un partido recién terminado sin resultado? (si no, fin)
           │
           ▼
  fetch_results.py  ──►  escribe goles en los dos data/*.xlsx (hoja WORLDCUP, por cirugía XML)
           │
           ▼
  build_static.py   ──►  genera data.json y RECALCULA los puntos de grupos en Python
           │
           ▼
  git commit + push ──►  main actualizado
           │
           └──────────────────────────────────────────►  index.html lee data.json
```

**Scripts implicados:**

| Paso | Script | Qué hace |
|------|--------|----------|
| 0 | `should_update.py` | Guardián: solo deja seguir si hay un partido recién terminado pendiente de resultado |
| 1 | `fetch_results.py` | Descarga partidos de la API y escribe goles en los dos Excel del repo (preservando las cachés de fórmulas) |
| 2 | `build_static.py` | Lee el Excel y genera `data.json`; los puntos de la fase de grupos se **recalculan en Python** |
| 3 | Workflow GitHub | Hace commit y push si hay cambios (`github-actions[bot]`) |

> **Por qué se recalculan los puntos en Python:** al escribir los goles directamente en el `.xlsx` no
> se ejecuta el motor de fórmulas de Excel, así que las celdas de puntos quedarían congeladas hasta
> abrir el archivo a mano. Para que la actualización sea 100% automática, `app.py` recalcula los
> puntos de la fase de grupos (1X2, diferencia y resultado exacto) al generar `data.json`.

**API de resultados:** [https://worldcup26.ir/get/games](https://worldcup26.ir/get/games) (pública, sin clave). Configuración en `update_config.json`. Horario del cron en `.github/workflows/update-porra.yml` (`*/30 * * * *` = cada 30 min, filtrado por `should_update.py`).

**Dos ritmos distintos:**

- **Pipeline en GitHub:** se despierta cada 30 min, pero solo publica `data.json` cuando un partido acaba de terminar.
- **Navegador del usuario:** carga `data.json` al abrir la web. Para ver datos nuevos basta con recargar la página.

La barra superior de la web («Actualizada a las XX:XX · Próxima actualización…») refleja ese ciclo.

### Flujo manual (pronósticos)

Cuando alguien del grupo cambia un pronóstico, posición de grupo, cuadro de honor, etc. en el Excel:

```bash
# Tras editar el Excel (en 00. ADMIN/ o directamente en data/):
python3 build_static.py
git add data.json data/
git commit -m "Actualizar pronósticos de la porra"
git push
```

La web online **no** puede guardar pronósticos; siempre pasan por el Excel.

### Excel del Mac vs Excel del repositorio

Existen **dos copias** del Excel ADMIN:

| Ubicación | Uso |
|-----------|-----|
| `../00. ADMIN/` (carpeta local en el Mac) | Donde sueles editar a mano en el día a día |
| `data/` (dentro del repo en GitHub) | Fuente de verdad para la web online |

- **GitHub Actions solo actualiza `data/` en el repo** (goles vía API).
- Si trabajas en local con `launch.py`, `excel_sync.py` puede copiar de `00. ADMIN/` → `data/` si tu copia local es más nueva.
- Para traerte los goles que el bot ha escrito: `git pull`, o ejecuta `python3 fetch_results.py` en tu Mac.

### Configuración en GitHub (una sola vez)

Para que el pipeline automático pueda subir cambios al repo:

1. **Settings → Actions → General**
   - *Actions permissions:* **Allow all actions and reusable workflows**
   - *Workflow permissions:* **Read and write permissions** → **Save**

2. **Settings → Pages**
   - Branch `main`, carpeta `/ (root)`

3. **Comprobar que funciona**
   - Ve a **Actions → Actualizar porra → Run workflow**
   - La ejecución debe terminar en verde
   - En **Commits** deberías ver entradas de `github-actions[bot]` con mensaje `chore: actualización automática de datos (...)`  
     (o el log dirá «Sin cambios que subir» si la API no trajo goles nuevos — también es correcto)

4. **Forzar una actualización** sin esperar al siguiente ciclo: **Actions → Actualizar porra → Run workflow** (el lanzamiento manual se salta el guardián y ejecuta siempre)

### Uso local (Flask)

En tu Mac, `python3 launch.py` lee el Excel en vivo y sirve `GET /api/data`. Ahí los datos se refrescan al recargar el navegador (caché de 30 s). Para traer goles de la API en local:

```bash
python3 fetch_results.py          # API → Excel
python3 build_static.py --fetch   # API + Excel + data.json en un solo comando
```

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
| `GET /` | Interfaz web (`index.html`) |
| `GET /api/data` | JSON completo del dashboard (lee Excel, caché 30 s) |
| `GET /api/wc_games` | Proxy de resultados en vivo (worldcup26.ir, caché 5 min) |
| `GET /static/<archivo>` | Assets (logo, audio, favicons) |

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

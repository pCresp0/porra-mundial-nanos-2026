/* ═══════════════════════════════════════════════════════════════
   GLOBAL STATE
═══════════════════════════════════════════════════════════════ */
let D = null;  // full data
const IS_GH_PAGES = location.hostname.endsWith("github.io");
const DATA_URL = IS_GH_PAGES ? "data.json" : "/api/data";
const VISITOR_API = "https://page-views-api.ratneshc.com/api/v1";
const VISITOR_SITE = "porra-mundial-nanos-2026";
const VISITOR_PATH = "/porra-mundial-nanos-2026";
// URL de la Web App de Google Apps Script que recoge las sugerencias.
// Pégala tras desplegar docs/feedback_apps_script.gs (termina en /exec).
// Si queda vacía, el formulario avisa de que el envío no está disponible.
const FEEDBACK_API = "https://script.google.com/macros/s/AKfycbwoXHBr6i2H7Klp4KBPS2KCBUtIiuX2DAimFk1e-mkRKzNeWLtZRlfKZikyvltcRPLd/exec";
let progressionChart = null;
let hitRateChart = null;
let breakdownChart = null;
let currentPhase = "all";
let currentWeek  = "all";
let scrollMatchesToToday = true;
let matchesDaysBefore = 0;
let porraUnlocked = true;
let matchesDaysAfter  = 0;
let teamIndex = [];
let selectedTeamFilter = null;
let teamSearchInited = false;
let teamSuggestIdx = -1;
// Filtros (semana/fase) guardados al activar la búsqueda de equipo, para
// restaurarlos cuando se quite la búsqueda. null = no hay búsqueda activa.
let savedFiltersBeforeSearch = null;

function todaySpainISO() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Madrid" });
}

function addDaysISO(iso, n) {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

// Fecha "ancla" de la pestaña Partidos: el partido en juego (prioridad) o el
// próximo por jugar. Si no hay ninguno (Mundial terminado o sin datos), usa
// el día de hoy. Sirve para centrar la ventana de días y el auto-scroll.
function matchesAnchorISO() {
  const today = todaySpainISO();
  let anchorName = null;
  if (_liveMatchIds && _liveMatchIds.size) anchorName = [..._liveMatchIds][0];
  else if (_nextMatchId) anchorName = _nextMatchId;
  if (anchorName && D?.matches) {
    const m = D.matches.find(x => x.name === anchorName || x.id === anchorName);
    if (m?.date && m.date.length >= 10) return m.date.slice(0, 10);
  }
  return today;
}

function shortDayLabel(label) {
  if (!label) return "";
  const m = label.match(/(\d{1,2})\s+de\s+(\w+)/i);
  if (m) return `${m[1]} ${m[2].slice(0, 3).toLowerCase()}`;
  if (label.length > 20) return label.slice(0, 18) + "…";
  return label;
}

function resetMatchesDayWindow() {
  matchesDaysBefore = 0;
  matchesDaysAfter  = 0;
}

function showMoreMatchDays() {
  matchesDaysAfter++;
  scrollMatchesToToday = false;
  renderMatches(currentPhase, currentWeek);
}

function showEarlierMatchDays() {
  matchesDaysBefore++;
  scrollMatchesToToday = false;
  renderMatches(currentPhase, currentWeek);
}

function normalizeSearch(s) {
  return (s || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Solo selecciones reales: excluye slots (1, 1A, 3ABCDF, «Dieciseisavofinalista»…) */
function isSearchableTeam(name, flag) {
  if (!name || typeof name !== "string") return false;
  const n = name.trim();
  if (n.length < 2) return false;
  if (/^\d+$/.test(n)) return false;
  if (/^[12]\d?[A-L]$/i.test(n)) return false;
  if (/^3[A-Z]{3,6}$/i.test(n)) return false;
  if (/^W\d+/i.test(n)) return false;
  if (/º|finalista|dieciseisavo|octavo|cuart|semi/i.test(n)) return false;
  if (!flag || flag === "🏳️" || !/\p{Regional_Indicator}/u.test(flag)) return false;
  return true;
}

function buildTeamIndex() {
  if (!D?.matches) { teamIndex = []; return; }
  const map = new Map();
  D.matches.forEach(m => {
    [["home", m.flag_home], ["away", m.flag_away]].forEach(([side, flag]) => {
      const name = m[side];
      if (!isSearchableTeam(name, flag)) return;
      if (!map.has(name)) map.set(name, { name, flag, count: 0 });
      else if (flag) map.get(name).flag = flag;
      map.get(name).count++;
    });
  });
  teamIndex = [...map.values()]
    .map(t => ({ ...t, norm: normalizeSearch(t.name) }))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

function getTeamSuggestions(q) {
  const raw = q.trim();
  const nq = normalizeSearch(raw);
  if (nq.length < 2) return [];
  const starts = [], contains = [];
  teamIndex.forEach(t => {
    if (t.norm.startsWith(nq)) starts.push(t);
    else if (t.norm.includes(nq)) contains.push(t);
  });
  return [...starts, ...contains].slice(0, 10);
}

function hideTeamSuggestions() {
  const suggest = document.getElementById("team-search-suggest");
  const input = document.getElementById("team-search-input");
  if (!suggest) return;
  suggest.classList.add("hidden");
  suggest.innerHTML = "";
  teamSuggestIdx = -1;
  if (input) input.setAttribute("aria-expanded", "false");
}

function renderTeamSuggestions(query) {
  const suggest = document.getElementById("team-search-suggest");
  const input = document.getElementById("team-search-input");
  if (!suggest) return;

  const items = getTeamSuggestions(query);
  if (!items.length) {
    if (normalizeSearch(query).length < 2) {
      hideTeamSuggestions();
      return;
    }
    suggest.innerHTML = `<li class="team-suggest-item" style="cursor:default;opacity:.6"><span class="ts-name">Sin coincidencias</span></li>`;
    suggest.classList.remove("hidden");
    input.setAttribute("aria-expanded", "true");
    return;
  }

  suggest.innerHTML = items.map((t, i) => `
    <li class="team-suggest-item${i === teamSuggestIdx ? " active" : ""}" role="option" data-team-idx="${i}">
      <span class="ts-flag">${t.flag}</span>
      <span class="ts-name">${t.name}</span>
      <span class="ts-count">${t.count} partido${t.count !== 1 ? "s" : ""}</span>
    </li>`).join("");
  suggest._items = items;
  suggest.classList.remove("hidden");
  input.setAttribute("aria-expanded", "true");
}

function selectTeamFilter(team) {
  // Guardar los filtros activos la primera vez que se entra en búsqueda, para
  // poder restaurarlos al quitarla. Al buscar un equipo se quitan los filtros
  // de semana y fase para que aparezcan TODOS sus partidos.
  if (savedFiltersBeforeSearch === null) {
    savedFiltersBeforeSearch = { week: currentWeek, phase: currentPhase };
  }
  selectedTeamFilter = team;
  currentWeek = "all";
  currentPhase = "all";
  syncMatchFiltersUI();
  const input = document.getElementById("team-search-input");
  const clearBtn = document.getElementById("team-search-clear");
  if (input) input.value = `${team.flag} ${team.name}`;
  if (clearBtn) clearBtn.classList.remove("hidden");
  hideTeamSuggestions();
  closeTeamSearchSheet();
  updateNavSearchBtn();
  resetMatchesDayWindow();
  scrollMatchesToToday = false;
  renderMatches(currentPhase, currentWeek);
  // Al filtrar por equipo, lleva al usuario al principio de los resultados
  // (el banner con el equipo) en vez de dejarlo donde estuviera (a menudo
  // abajo del todo). Especialmente importante en móvil.
  scrollMatchesTopIntoView();
}

function clearTeamFilter() {
  selectedTeamFilter = null;
  // Restaurar los filtros de semana/fase que había antes de buscar.
  if (savedFiltersBeforeSearch) {
    currentWeek = savedFiltersBeforeSearch.week;
    currentPhase = savedFiltersBeforeSearch.phase;
    savedFiltersBeforeSearch = null;
  }
  syncMatchFiltersUI();
  const input = document.getElementById("team-search-input");
  const clearBtn = document.getElementById("team-search-clear");
  if (input) input.value = "";
  if (clearBtn) clearBtn.classList.add("hidden");
  hideTeamSuggestions();
  updateNavSearchBtn();
  resetMatchesDayWindow();
  scrollMatchesToToday = true;
  renderMatches(currentPhase, currentWeek);
}

// Refleja el estado de currentWeek/currentPhase en los botones de filtro
function syncMatchFiltersUI() {
  document.querySelectorAll("#week-filter .week-btn").forEach(b =>
    b.classList.toggle("active", b.dataset.week === currentWeek));
  document.querySelectorAll(".phase-btn").forEach(b =>
    b.classList.toggle("active", b.dataset.phase === currentPhase));
}

// Restaura los filtros de semana/fase guardados si la búsqueda ya no está
// activa (no hay equipo seleccionado) pero quedaron filtros pendientes de
// restaurar. Cubre el caso de abandonar la búsqueda sin pulsar ✕ (p. ej.
// borrando el texto y cerrando el panel). Devuelve true si restauró algo.
function restoreSearchFiltersIfNeeded() {
  if (selectedTeamFilter || !savedFiltersBeforeSearch) return false;
  currentWeek = savedFiltersBeforeSearch.week;
  currentPhase = savedFiltersBeforeSearch.phase;
  savedFiltersBeforeSearch = null;
  syncMatchFiltersUI();
  resetMatchesDayWindow();
  scrollMatchesToToday = true;
  renderMatches(currentPhase, currentWeek);
  return true;
}

function syncTeamSearchUI() {
  const input = document.getElementById("team-search-input");
  const clearBtn = document.getElementById("team-search-clear");
  if (selectedTeamFilter) {
    const still = teamIndex.find(t => t.name === selectedTeamFilter.name);
    if (!still) selectedTeamFilter = null;
    else if (input) input.value = `${still.flag} ${still.name}`;
  }
  if (clearBtn) clearBtn.classList.toggle("hidden", !selectedTeamFilter);
}

function initTeamSearch() {
  if (teamSearchInited) return;
  teamSearchInited = true;

  const wrap = document.getElementById("team-search-wrap");
  const input = document.getElementById("team-search-input");
  const suggest = document.getElementById("team-search-suggest");
  const clearBtn = document.getElementById("team-search-clear");
  if (!input || !suggest) return;

  let blurTimer = null;

  input.addEventListener("input", () => {
    const expected = selectedTeamFilter ? `${selectedTeamFilter.flag} ${selectedTeamFilter.name}` : "";
    if (selectedTeamFilter && input.value !== expected) {
      selectedTeamFilter = null;
      clearBtn.classList.add("hidden");
    }
    teamSuggestIdx = -1;
    renderTeamSuggestions(input.value);
  });

  input.addEventListener("focus", () => {
    clearTimeout(blurTimer);
    teamSuggestIdx = -1;
    renderTeamSuggestions(input.value);
  });

  input.addEventListener("blur", () => {
    blurTimer = setTimeout(() => {
      hideTeamSuggestions();
      // Si se abandonó la búsqueda con el campo vacío y sin equipo elegido,
      // recupera los filtros que había antes de buscar.
      if (!selectedTeamFilter && !input.value.trim()) restoreSearchFiltersIfNeeded();
    }, 160);
  });

  input.addEventListener("keydown", e => {
    const items = suggest._items || [];
    if (e.key === "Escape") {
      if (selectedTeamFilter) clearTeamFilter();
      else { input.value = ""; hideTeamSuggestions(); }
      return;
    }
    if (!items.length || suggest.classList.contains("hidden")) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      teamSuggestIdx = Math.min(teamSuggestIdx + 1, items.length - 1);
      renderTeamSuggestions(input.value);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      teamSuggestIdx = Math.max(teamSuggestIdx - 1, 0);
      renderTeamSuggestions(input.value);
    } else if (e.key === "Enter" && teamSuggestIdx >= 0) {
      e.preventDefault();
      selectTeamFilter(items[teamSuggestIdx]);
    }
  });

  suggest.addEventListener("mousedown", e => {
    e.preventDefault();
    const li = e.target.closest(".team-suggest-item[data-team-idx]");
    if (!li || !suggest._items) return;
    const team = suggest._items[parseInt(li.dataset.teamIdx, 10)];
    if (team) selectTeamFilter(team);
  });

  clearBtn.addEventListener("click", clearTeamFilter);

  document.addEventListener("click", e => {
    if (!wrap.contains(e.target)) hideTeamSuggestions();
  });
}

/* ── Panel de búsqueda en móvil (icono 🔍 de la barra superior) ──
   Reubica el mismo .team-search-wrap dentro del panel para reutilizar toda
   la lógica de búsqueda; al cerrar lo devuelve a su sitio original. */
let _tsSheetInited = false;
function _tsHome() { return document.querySelector(".matches-row"); }

function openTeamSearchSheet() {
  const sheet = document.getElementById("ts-sheet");
  const body  = document.getElementById("ts-sheet-body");
  const wrap  = document.getElementById("team-search-wrap");
  const input = document.getElementById("team-search-input");
  if (!sheet || !body || !wrap) return;
  body.appendChild(wrap);
  sheet.classList.add("open");
  sheet.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  setTimeout(() => { input && input.focus(); }, 220);
}

function closeTeamSearchSheet() {
  const sheet = document.getElementById("ts-sheet");
  const wrap  = document.getElementById("team-search-wrap");
  const home  = _tsHome();
  if (!sheet) return;
  hideTeamSuggestions();
  if (wrap && home && wrap.parentElement?.id === "ts-sheet-body") home.appendChild(wrap);
  sheet.classList.remove("open");
  sheet.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
  // Si se cierra el panel sin un equipo seleccionado, restaura los filtros
  // que había antes de abrir la búsqueda.
  restoreSearchFiltersIfNeeded();
}

/* Muestra el icono 🔍 sólo en la pestaña Partidos y marca un punto cuando
   hay un equipo filtrado. */
function updateNavSearchBtn() {
  const btn = document.getElementById("nav-search-btn");
  const dot = document.getElementById("nav-search-dot");
  if (!btn) return;
  const onMatches = !document.getElementById("tab-matches")?.classList.contains("hidden");
  btn.hidden = !onMatches;
  if (dot) dot.hidden = !selectedTeamFilter;
}

function initTeamSearchSheet() {
  if (_tsSheetInited) return;
  _tsSheetInited = true;
  document.getElementById("nav-search-btn")?.addEventListener("click", openTeamSearchSheet);
  document.getElementById("ts-sheet-close")?.addEventListener("click", closeTeamSearchSheet);
  document.getElementById("ts-sheet-backdrop")?.addEventListener("click", closeTeamSearchSheet);
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && document.getElementById("ts-sheet")?.classList.contains("open")) {
      closeTeamSearchSheet();
    }
  });
  // Si la ventana se agranda a escritorio con el panel abierto, ciérralo.
  window.addEventListener("resize", () => {
    if (window.innerWidth > 767 && document.getElementById("ts-sheet")?.classList.contains("open")) {
      closeTeamSearchSheet();
    }
  });
  updateNavSearchBtn();
}

// Lleva la vista al principio de la lista de partidos (la barra de filtros /
// el buscador), útil al activar el filtro por equipo para que el usuario vea
// los resultados desde arriba en lugar de quedarse donde estuviera.
function scrollMatchesTopIntoView() {
  const top = document.querySelector(".matches-topbar") || document.getElementById("matches-list");
  if (!top) return;
  let navH = 0;
  document.querySelectorAll("nav, .mobile-nav").forEach(n => {
    const s = getComputedStyle(n);
    if (s.display === "none" || s.visibility === "hidden") return;
    if ((s.position === "sticky" || s.position === "fixed") && n.offsetHeight > 0) {
      navH = Math.max(navH, n.offsetHeight);
    }
  });
  requestAnimationFrame(() => setTimeout(() => {
    const y = top.getBoundingClientRect().top + window.scrollY - navH - 12;
    window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
  }, 80));
}

function scrollToTodayInMatches() {
  // Altura de la cabecera fija/sticky visible (en móvil es .mobile-nav, en
  // escritorio el <nav>), para no dejar la tarjeta oculta debajo.
  let navH = 0;
  document.querySelectorAll("nav, .mobile-nav").forEach(n => {
    const s = getComputedStyle(n);
    if (s.display === "none" || s.visibility === "hidden") return;
    if ((s.position === "sticky" || s.position === "fixed") && n.offsetHeight > 0) {
      navH = Math.max(navH, n.offsetHeight);
    }
  });
  const scrollToEl = el => {
    const top = el.getBoundingClientRect().top + window.scrollY - navH - 16;
    window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  };

  // Prioridad: llevar al usuario al partido en juego o, en su defecto, al
  // próximo partido por jugar (no al día de hoy).
  const card = document.querySelector(".match-row.live-match")
            || document.querySelector(".match-row.next-match");
  if (card) { scrollToEl(card); return; }

  // Si no hay tarjeta de próximo/en-juego en el DOM, caemos a la fecha ancla
  // (próximo partido) y, si tampoco, al día más cercano.
  const anchor = matchesAnchorISO();
  const sections = [...document.querySelectorAll("[data-day-date]")];
  if (!sections.length) return;

  let target = document.getElementById(`day-${anchor}`);
  if (!target) {
    const dated = sections
      .map(el => ({ el, d: el.dataset.dayDate }))
      .filter(x => x.d && x.d !== "sin-fecha")
      .sort((a, b) => a.d.localeCompare(b.d));
    target = dated.find(x => x.d >= anchor)?.el
          || [...dated].reverse().find(x => x.d < anchor)?.el
          || sections[0];
  }
  if (target) scrollToEl(target);
}

const PHASE_LABELS = {
  groups:    "Fase de Grupos",
  positions: "Posiciones",
  q16:       "Cl. 16avos",
  r16:       "16avos",
  r8:        "Octavos",
  r4:        "Cuartos",
  r2:        "Semis",
  r34:       "3-4 Puesto",
  final:     "Final",
  honor:     "C. Honor",
};

// Banderas de jugadores del Cuadro de Honor
const HONOR_PLAYER_FLAGS = {
  "Harry Kane":       "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
  "Cristiano Ronaldo":"🇵🇹",
  "Vinicius Jr.":     "🇧🇷",
  "Mbappé":           "🇫🇷",
  "Haaland":          "🇳🇴",
  "Lamine Yamal":     "🇪🇸",
  "Pedri":            "🇪🇸",
  "Bellingham":       "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
  "Oyarzabal":        "🇪🇸",
  "Musiala":          "🇩🇪",
  "Vitinha":          "🇵🇹",
  "Courtois":         "🇧🇪",
  "Rodri":            "🇪🇸",
  "Lewandowski":      "🇵🇱",
  "Salah":            "🇪🇬",
  "Neymar":           "🇧🇷",
  "De Bruyne":        "🇧🇪",
};

const MEDAL = ["🥇","🥈","🥉","4️⃣","5️⃣","6️⃣"];

/* ── worldcup26.ir English name → Spanish name (for game lookup) ── */
const EN_TO_ESP_TEAM = {
  "Mexico":"México","South Africa":"Sudáfrica","South Korea":"Corea del Sur",
  "Czech Republic":"Rep. Checa","Czechia":"Rep. Checa",
  "Canada":"Canadá","Bosnia and Herzegovina":"Bosnia","Bosnia":"Bosnia",
  "Qatar":"Qatar","Switzerland":"Suiza","Brazil":"Brasil","Morocco":"Marruecos",
  "Haiti":"Haití","Scotland":"Escocia","United States":"EE.UU.",
  "Paraguay":"Paraguay","Australia":"Australia","Turkey":"Turquía","Germany":"Alemania",
  "Curacao":"Curazao","Curaçao":"Curazao","Ivory Coast":"Costa de Marfil",
  "Ecuador":"Ecuador","Netherlands":"Países Bajos","Japan":"Japón","Sweden":"Suecia",
  "Tunisia":"Túnez","Belgium":"Bélgica","Egypt":"Egipto","Iran":"Irán",
  "New Zealand":"Nueva Zelanda","Spain":"España","Cape Verde":"Cabo Verde",
  "Saudi Arabia":"Arabia Saudí","Uruguay":"Uruguay","France":"Francia",
  "Senegal":"Senegal","Iraq":"Iraq","Norway":"Noruega","Argentina":"Argentina",
  "Algeria":"Argelia","Austria":"Austria","Jordan":"Jordania","Portugal":"Portugal",
  "DR Congo":"R.D. Congo","Uzbekistan":"Uzbekistán","Colombia":"Colombia",
  "England":"Inglaterra","Croatia":"Croacia","Ghana":"Ghana","Panama":"Panamá",
  "Denmark":"Dinamarca","Greece":"Grecia","Serbia":"Serbia","Nigeria":"Nigeria",
  "Costa Rica":"Costa Rica","Honduras":"Honduras",
};

const TV_URL = {
  tve:  "https://www.rtve.es/play/videos/directo/canales-lineales/",
  dazn: "https://www.dazn.com/es-ES/competition/Competition:70excpe1synn9kadnbppahdn7",
};

function tvBadgeLink(kind, label) {
  const url = TV_URL[kind];
  if (!url) return `<span class="tv-badge tv-${kind}">${label}</span>`;
  return `<a class="tv-badge tv-${kind}" href="${url}" target="_blank" rel="noopener noreferrer" title="Ver en ${label}">${label}</a>`;
}

// Badges de TV (DAZN / TVE / ambas) según m.tv
function tvBadgesHtml(m) {
  if (m.tv === "both") return tvBadgeLink("dazn", "DAZN") + tvBadgeLink("tve", "TVE");
  if (m.tv === "tve")  return tvBadgeLink("tve", "TVE");
  if (m.tv === "dazn") return tvBadgeLink("dazn", "DAZN");
  return "";
}

/* ── Spanish team name → FIFA code ── */
const TEAM_TO_FIFA = {
  "México":"MEX","Sudáfrica":"RSA","Corea del Sur":"KOR","Rep. Checa":"CZE","Chequia":"CZE","República Checa":"CZE",
  "Canadá":"CAN","Bosnia":"BIH","Bosnia y Herz.":"BIH","Bosnia y Herzegovina":"BIH","Qatar":"QAT","Catar":"QAT","Suiza":"SUI",
  "Brasil":"BRA","Marruecos":"MAR","Haití":"HAI","Escocia":"SCO",
  "EE.UU.":"USA","Estados Unidos":"USA","Paraguay":"PRY","Australia":"AUS","Turquía":"TUR",
  "Alemania":"GER","Curazao":"CUW","Costa de Marfil":"CIV","Ecuador":"ECU",
  "Países Bajos":"NED","Holanda":"NED","Japón":"JPN","Suecia":"SWE","Túnez":"TUN",
  "Bélgica":"BEL","Egipto":"EGY","Irán":"IRN","Nueva Zelanda":"NZL",
  "España":"ESP","Cabo Verde":"CPV","Arabia Saudí":"KSA","Arabia Saudita":"KSA","Uruguay":"URU",
  "Francia":"FRA","Senegal":"SEN","Iraq":"IRQ","Noruega":"NOR",
  "Argentina":"ARG","Argelia":"DZA","Austria":"AUT","Jordania":"JOR",
  "Portugal":"POR","R.D. Congo":"COD","Congo DR":"COD","Uzbekistán":"UZB","Colombia":"COL",
  "Inglaterra":"ENG","Croacia":"HRV","Ghana":"GHA","Panamá":"PAN",
  "Dinamarca":"DEN","Grecia":"GRE","Serbia":"SRB","Nigeria":"NGA",
  "Costa Rica":"CRC","Honduras":"HON","Jamaica":"JAM","Venezuela":"VEN",
  "Chile":"CHI","Bolivia":"BOL","Perú":"PER",
};

/* ── Key players per FIFA code ── */
const KEY_PLAYERS = {
  "MEX":[{"name":"Santiago Giménez","pos":"DC","club":"Feyenoord","note":"Máximo goleador de México en activo"},{"name":"Hirving Lozano","pos":"EXT","club":"PSV","note":"Velocidad y desborde por la banda"},{"name":"Guillermo Ochoa","pos":"POR","club":"Club América","note":"Leyenda viva del fútbol mexicano"},{"name":"Edson Álvarez","pos":"MCD","club":"West Ham","note":"Pilar del centro del campo"}],
  "RSA":[{"name":"Percy Tau","pos":"EXT","club":"Mamelodi Sundowns","note":"Mejor jugador africano 2022"},{"name":"Themba Zwane","pos":"MC","club":"Mamelodi Sundowns","note":"Elegancia y visión de juego"},{"name":"Ronwen Williams","pos":"POR","club":"Mamelodi Sundowns","note":"Portero número 1 de Sudáfrica"}],
  "KOR":[{"name":"Son Heung-min","pos":"EXT","club":"Tottenham","note":"Capitán y referencia absoluta"},{"name":"Lee Jae-sung","pos":"MC","club":"Mainz","note":"Motor del centro del campo"},{"name":"Kim Min-jae","pos":"DFC","club":"Bayern München","note":"Uno de los mejores centrales del mundo"}],
  "CZE":[{"name":"Patrik Schick","pos":"DC","club":"Bayer Leverkusen","note":"Potencia y gol. 2º goleador de la Eurocopa 2020"},{"name":"Tomáš Souček","pos":"MCD","club":"West Ham","note":"Presencia aérea y garra"},{"name":"Vladimír Coufal","pos":"LAD","club":"West Ham","note":"Lateral derecho fiable y con llegada"}],
  "CAN":[{"name":"Alphonso Davies","pos":"LAI","club":"Bayern München","note":"Velocidad extrema. Mejor jugador canadiense de la historia"},{"name":"Jonathan David","pos":"DC","club":"Lille","note":"Uno de los goleadores más letales de Europa"},{"name":"Tajon Buchanan","pos":"EXT","club":"Inter de Milán","note":"Desequilibrio por la banda"}],
  "BIH":[{"name":"Edin Džeko","pos":"DC","club":"Fenerbahçe","note":"Máximo goleador histórico de Bosnia"},{"name":"Ermedin Demirović","pos":"DC","club":"Stuttgart","note":"Nuevo referente del gol bosnio"},{"name":"Miralem Pjanić","pos":"MC","club":"—","note":"Leyenda bosnia"}],
  "QAT":[{"name":"Akram Afif","pos":"EXT","club":"Al-Sadd","note":"Mejor jugador de la Copa de Asia 2023"},{"name":"Almoez Ali","pos":"DC","club":"Al-Duhail","note":"Máximo goleador histórico de Qatar"},{"name":"Abdelkarim Hassan","pos":"LAI","club":"Al-Arabi","note":"Lateral rápido y con llegada"}],
  "SUI":[{"name":"Granit Xhaka","pos":"MC","club":"Bayer Leverkusen","note":"Liderazgo y técnica. Corazón de Suiza"},{"name":"Xherdan Shaqiri","pos":"EXT","club":"Chicago Fire","note":"Imprevisible. Campeón de la Eurocopa 2008"},{"name":"Yann Sommer","pos":"POR","club":"Inter de Milán","note":"Portero de clase mundial"},{"name":"Manuel Akanji","pos":"DFC","club":"Man City","note":"Central sólido y con salida de balón"}],
  "BRA":[{"name":"Vinícius Jr.","pos":"EXT","club":"Real Madrid","note":"Balón de Oro 2024. El más desequilibrante del mundo"},{"name":"Rodrygo","pos":"EXT","club":"Real Madrid","note":"Clutch player. Decisivo en los grandes momentos"},{"name":"Endrick","pos":"DC","club":"Real Madrid","note":"Joya de 18 años. El futuro del fútbol brasileño"},{"name":"Alisson Becker","pos":"POR","club":"Liverpool","note":"Mejor portero del mundo en los últimos años"}],
  "MAR":[{"name":"Achraf Hakimi","pos":"LAD","club":"PSG","note":"Mejor lateral derecho del mundo. 4º puesto en Qatar 2022"},{"name":"Hakim Ziyech","pos":"EXT","club":"Galatasaray","note":"Magia y creatividad en el ataque"},{"name":"Youssef En-Nesyri","pos":"DC","club":"Fenerbahçe","note":"Héroe de la semifinal de Qatar 2022"},{"name":"Sofyan Amrabat","pos":"MCD","club":"Fiorentina","note":"Sensación del Mundial 2022"}],
  "HAI":[{"name":"Frantzdy Pierrot","pos":"DC","club":"Atlanta United","note":"Artillero de la MLS"},{"name":"Duckens Nazon","pos":"EXT","club":"Panathinaikos","note":"Velocidad y desborde"},{"name":"Naïco Ducasse","pos":"MC","club":"FC Nantes","note":"Mediocampista elegante"}],
  "SCO":[{"name":"Andrew Robertson","pos":"LAI","club":"Liverpool","note":"Capitán. Uno de los mejores laterales del mundo"},{"name":"Scott McTominay","pos":"MC","club":"Napoli","note":"Gol y llegada desde segunda línea"},{"name":"Che Adams","pos":"DC","club":"Torino","note":"Delantero físico y trabajador"}],
  "USA":[{"name":"Christian Pulisic","pos":"EXT","club":"AC Milan","note":"Capitán y estrella. «Captain America»"},{"name":"Tyler Adams","pos":"MCD","club":"Bournemouth","note":"Dinamismo e intensidad en el centro"},{"name":"Gio Reyna","pos":"MC","club":"Borussia Dortmund","note":"Talento generacional"},{"name":"Matt Turner","pos":"POR","club":"Crystal Palace","note":"Portero seguro bajo los tres palos"}],
  "PRY":[{"name":"Miguel Almirón","pos":"MC","club":"Newcastle","note":"Motor incansable. Dobletes con Newcastle"},{"name":"Julio Enciso","pos":"EXT","club":"Brighton","note":"Joven talento. El nuevo referente paraguayo"},{"name":"Gustavo Gómez","pos":"DFC","club":"Palmeiras","note":"Capitán. Líder de la defensa"}],
  "AUS":[{"name":"Mathew Ryan","pos":"POR","club":"Real Sociedad","note":"Portero experimentado y seguro"},{"name":"Marco Tilio","pos":"EXT","club":"Celtic","note":"Joven promesa del fútbol australiano"},{"name":"Mitchell Duke","pos":"DC","club":"FC Macarthur","note":"Héroe del gol ante Dinamarca en Qatar 2022"}],
  "TUR":[{"name":"Arda Güler","pos":"MC","club":"Real Madrid","note":"Joya de 19 años. El nuevo Özil"},{"name":"Hakan Çalhanoğlu","pos":"MCD","club":"Inter de Milán","note":"Cerebro del equipo. Lanzador de falta letal"},{"name":"Merih Demiral","pos":"DFC","club":"Al-Ahli","note":"Central potente y buen salto"},{"name":"Kerem Aktürkoğlu","pos":"EXT","club":"Galatasaray","note":"Goleador en Champions"}],
  "GER":[{"name":"Jamal Musiala","pos":"MC","club":"Bayern München","note":"El más prometedor de Europa. Gambeta y gol"},{"name":"Florian Wirtz","pos":"MC","club":"Bayer Leverkusen","note":"Elegancia y visión. Corazón del Leverkusen campeón"},{"name":"Harry Kane","pos":"DC","club":"Bayern München","note":"Máximo goleador de la historia del Bayern"},{"name":"Toni Kroos","pos":"MC","club":"Real Madrid","note":"Leyenda absoluta"}],
  "CUW":[{"name":"Leandro Bacuna","pos":"MC","club":"Burton Albion","note":"Experiencia y técnica"},{"name":"Jarchinio Antonia","pos":"EXT","club":"Beerschot","note":"Habilidad y regates"}],
  "CIV":[{"name":"Sébastien Haller","pos":"DC","club":"Borussia Dortmund","note":"Luchó contra el cáncer y volvió más fuerte"},{"name":"Franck Kessié","pos":"MC","club":"Al-Ahli","note":"Físico y gol. Pulmón del centro"},{"name":"Nicolas Pépé","pos":"EXT","club":"OGC Niza","note":"Desequilibrio y velocidad"}],
  "ECU":[{"name":"Enner Valencia","pos":"DC","club":"LDU Quito","note":"El goleador histórico de Ecuador. Héroe de Qatar 2022"},{"name":"Moisés Caicedo","pos":"MCD","club":"Chelsea","note":"Centrocampista élite. Fichaje récord del Chelsea"},{"name":"Gonzalo Plata","pos":"EXT","club":"Galatasaray","note":"Velocidad y peligro por la derecha"}],
  "NED":[{"name":"Virgil van Dijk","pos":"DFC","club":"Liverpool","note":"Mejor central del mundo en los últimos años"},{"name":"Cody Gakpo","pos":"EXT","club":"Liverpool","note":"Llegó al Mundial 2022 de suplente y fue figura"},{"name":"Frenkie de Jong","pos":"MC","club":"Barcelona","note":"El más elegante de Países Bajos"},{"name":"Memphis Depay","pos":"DC","club":"Corinthians","note":"Gol e instinto en cualquier equipo"}],
  "JPN":[{"name":"Takehiro Tomiyasu","pos":"DFC","club":"Arsenal","note":"Polivalente. Titular en el Arsenal"},{"name":"Wataru Endō","pos":"MCD","club":"Liverpool","note":"Solidez en el centro"},{"name":"Takumi Minamino","pos":"MC","club":"Monaco","note":"Gol y trabajo"},{"name":"Ritsu Doan","pos":"EXT","club":"SC Freiburg","note":"Goleador del histórico 2-1 a Alemania en Qatar"}],
  "SWE":[{"name":"Victor Nilsson Lindelöf","pos":"DFC","club":"Man United","note":"Central sólido y con salida de balón"},{"name":"Dejan Kulusevski","pos":"EXT","club":"Tottenham","note":"Creatividad y llegada desde la banda"},{"name":"Alexander Isak","pos":"DC","club":"Newcastle","note":"Rápido y letal. Figura de la Premier League"}],
  "TUN":[{"name":"Youssef Msakni","pos":"EXT","club":"Espérance","note":"Líder histórico. El referente ofensivo"},{"name":"Wahbi Khazri","pos":"MC","club":"Montpellier","note":"Experiencia y calidad en el balón parado"}],
  "BEL":[{"name":"Kevin De Bruyne","pos":"MC","club":"Man City","note":"Quizás el mejor centrocampista del mundo"},{"name":"Romelu Lukaku","pos":"DC","club":"Roma","note":"El goleador histórico de Bélgica. Fuerza bruta"},{"name":"Thibaut Courtois","pos":"POR","club":"Real Madrid","note":"Uno de los mejores porteros del mundo"},{"name":"Lois Openda","pos":"DC","club":"RB Leipzig","note":"La nueva generación belga"}],
  "EGY":[{"name":"Mohamed Salah","pos":"EXT","club":"Liverpool","note":"El Faraón. Uno de los 3 mejores jugadores del mundo"},{"name":"Omar Marmoush","pos":"EXT","club":"Man City","note":"En estado de gracia. Máximo goleador de la Bundesliga 2023/24"},{"name":"Mohamed El-Shenawy","pos":"POR","club":"Al-Ahly","note":"Portero experto en la Champions africana"}],
  "IRN":[{"name":"Mehdi Taremi","pos":"DC","club":"Inter de Milán","note":"Técnica y gol. El más completo de Irán"},{"name":"Sardar Azmoun","pos":"EXT","club":"Roma","note":"El «Messi iraní». Muy querido en su país"},{"name":"Alireza Jahanbakhsh","pos":"EXT","club":"Feyenoord","note":"Velocidad y desborde"}],
  "NZL":[{"name":"Chris Wood","pos":"DC","club":"Nottm Forest","note":"El goleador histórico de Nueva Zelanda"},{"name":"Ryan Thomas","pos":"MC","club":"PSV","note":"Técnica en el centro"},{"name":"Bill Tuilagi","pos":"DFC","club":"Wigan Athletic","note":"Defensa contundente"}],
  "ESP":[{"name":"Lamine Yamal","pos":"EXT","club":"Barcelona","note":"Campeón de Europa con 17 años. La nueva joya mundial"},{"name":"Pedri","pos":"MC","club":"Barcelona","note":"Sucesor de Iniesta. Elegancia y técnica infinita"},{"name":"Rodri","pos":"MCD","club":"Man City","note":"Balón de Oro 2023. El mejor pivote del mundo"},{"name":"Unai Simón","pos":"POR","club":"Athletic Club","note":"Portero titular de La Roja desde 2021"}],
  "CPV":[{"name":"Garry Rodrigues","pos":"EXT","club":"Galatasaray","note":"El mejor jugador histórico de Cabo Verde"},{"name":"Jamiro Monteiro","pos":"MC","club":"New England Rev.","note":"Creatividad en el centro del campo"}],
  "KSA":[{"name":"Salem Al-Dawsari","pos":"EXT","club":"Al-Hilal","note":"El gol que eliminó a Argentina en 2022"},{"name":"Mohamed Kanno","pos":"MCD","club":"Al-Hilal","note":"El cerebro del mediocampo saudí"},{"name":"Yasser Al-Shahrani","pos":"LAI","club":"Al-Hilal","note":"Lateral con llegada y buen despliegue"}],
  "URU":[{"name":"Darwin Núñez","pos":"DC","club":"Liverpool","note":"Explosión física y gol. El gran delantero uruguayo"},{"name":"Federico Valverde","pos":"MC","club":"Real Madrid","note":"Capacidad física tremenda. Gol y asistencia"},{"name":"Ronald Araújo","pos":"DFC","club":"Barcelona","note":"Uno de los mejores centrales del mundo"},{"name":"Luis Suárez","pos":"DC","club":"—","note":"Leyenda uruguaya"}],
  "FRA":[{"name":"Kylian Mbappé","pos":"DC","club":"Real Madrid","note":"El mejor del mundo. Capitán y faro ofensivo"},{"name":"Antoine Griezmann","pos":"MC","club":"Atlético de Madrid","note":"El corazón de Francia. Campeón del Mundo 2018"},{"name":"Aurélien Tchouaméni","pos":"MCD","club":"Real Madrid","note":"La nueva generación. Sólido y con balón"},{"name":"Mike Maignan","pos":"POR","club":"AC Milan","note":"Portazo cuando le necesitas"}],
  "SEN":[{"name":"Sadio Mané","pos":"EXT","club":"Al-Nassr","note":"Campeón Africa Cup 2022. La estrella de Senegal"},{"name":"Kalidou Koulibaly","pos":"DFC","club":"Al-Hilal","note":"Uno de los centrales más completos del mundo"},{"name":"Ismaïla Sarr","pos":"EXT","club":"Crystal Palace","note":"Velocidad extrema por la banda derecha"}],
  "IRQ":[{"name":"Amjed Attwan","pos":"MCD","club":"Al-Shorta","note":"Capitán histórico de Iraq"},{"name":"Mohanad Ali","pos":"DC","club":"Al-Zawraa","note":"Máximo goleador histórico de Iraq"},{"name":"Bashar Resan","pos":"EXT","club":"PAOK","note":"El más brillante de la generación actual"}],
  "NOR":[{"name":"Erling Haaland","pos":"DC","club":"Man City","note":"La máquina de hacer goles. Récords en la Premier"},{"name":"Martin Ødegaard","pos":"MC","club":"Arsenal","note":"Capitán del Arsenal. Técnica y liderazgo"},{"name":"Alexander Sørloth","pos":"DC","club":"Atlético de Madrid","note":"Físico intimidante y muy buen rematador"},{"name":"Sander Berge","pos":"MCD","club":"Fulham","note":"Contención y distribución en el centro"}],
  "ARG":[{"name":"Lionel Messi","pos":"DC","club":"Inter Miami","note":"El mejor de la historia. Campeón del Mundo 2022"},{"name":"Julián Álvarez","pos":"DC","club":"Atlético de Madrid","note":"La araña. Héroe del Mundial 2022"},{"name":"Enzo Fernández","pos":"MC","club":"Chelsea","note":"Mejor jugador joven del Mundial 2022"},{"name":"Emiliano Martínez","pos":"POR","club":"Aston Villa","note":"Dibu. El portero de los penaltis históricos"}],
  "DZA":[{"name":"Riyad Mahrez","pos":"EXT","club":"Al-Ahli","note":"El más técnico del fútbol argelino. Campeón de África 2019"},{"name":"Islam Slimani","pos":"DC","club":"Montpellier","note":"Goleador histórico de Argelia"},{"name":"Youcef Atal","pos":"LAD","club":"OGC Niza","note":"Lateral atacante con mucho peligro"}],
  "AUT":[{"name":"Marcel Sabitzer","pos":"MC","club":"Borussia Dortmund","note":"Gol y carácter. Motor del mediocampo"},{"name":"David Alaba","pos":"DFC","club":"Real Madrid","note":"Capitán y leyenda. Polivalencia máxima"},{"name":"Christoph Baumgartner","pos":"MC","club":"RB Leipzig","note":"Talento en alza. Trabajo y gol"}],
  "JOR":[{"name":"Yazan Al-Naimat","pos":"DC","club":"Al-Jazeera","note":"El artillero de la selección jordana"},{"name":"Ahmad Hayel","pos":"MCD","club":"Al-Faisaly","note":"La sangre del mediocampo jordano"}],
  "POR":[{"name":"Cristiano Ronaldo","pos":"DC","club":"Al-Nassr","note":"El máximo goleador de la historia del fútbol internacional"},{"name":"Bruno Fernandes","pos":"MC","club":"Man United","note":"Capitán. Creatividad y gol desde el centro"},{"name":"Rafael Leão","pos":"EXT","club":"AC Milan","note":"Velocidad y desborde. El más explosivo de Portugal"},{"name":"Rúben Dias","pos":"DFC","club":"Man City","note":"El mejor central portugués"}],
  "COD":[{"name":"Cédric Bakambu","pos":"DC","club":"OM Marseille","note":"El goleador más prolífico de R.D. Congo"},{"name":"Chancel Mbemba","pos":"DFC","club":"OM Marseille","note":"Central poderoso. Referente defensivo"},{"name":"Yannick Bolasie","pos":"EXT","club":"Aris Limassol","note":"Velocidad y habilidad por banda"}],
  "UZB":[{"name":"Eldor Shomurodov","pos":"DC","club":"Roma","note":"El delantero uzbeko en la Serie A"},{"name":"Jaloliddin Masharipov","pos":"MC","club":"Pakhtakor","note":"El jugador más técnico de Uzbekistán"}],
  "COL":[{"name":"Luis Díaz","pos":"EXT","club":"Liverpool","note":"Velocidad, magia y gol. Figura de Colombia"},{"name":"James Rodríguez","pos":"MC","club":"Rayo Vallecano","note":"El Bota de Oro del Mundial 2014"},{"name":"Richard Ríos","pos":"MCD","club":"Palmeiras","note":"La revelación de la Copa América 2024"},{"name":"Davinson Sánchez","pos":"DFC","club":"Galatasaray","note":"Central con experiencia en las grandes ligas"}],
  "ENG":[{"name":"Jude Bellingham","pos":"MC","club":"Real Madrid","note":"El mejor centrocampista de su generación"},{"name":"Phil Foden","pos":"MC","club":"Man City","note":"El Mago de Stockport. Habilidad en estado puro"},{"name":"Harry Kane","pos":"DC","club":"Bayern München","note":"Máximo goleador histórico de Inglaterra"},{"name":"Bukayo Saka","pos":"EXT","club":"Arsenal","note":"El chico de oro del Arsenal. Constante y letal"}],
  "HRV":[{"name":"Luka Modrić","pos":"MC","club":"Real Madrid","note":"Balón de Oro 2018. Una leyenda viva a sus 38 años"},{"name":"Ivan Perišić","pos":"EXT","club":"Hajduk Split","note":"Héroe del 2º puesto en Rusia 2018"},{"name":"Mateo Kovačić","pos":"MC","club":"Man City","note":"Control y velocidad. Imprescindible para Croacia"}],
  "GHA":[{"name":"Mohammed Kudus","pos":"EXT","club":"West Ham","note":"Joya ghanesa. Técnica y gol en la Premier League"},{"name":"André Ayew","pos":"MC","club":"Le Havre","note":"Capitán histórico. Liderazgo y experiencia"},{"name":"Jordan Ayew","pos":"EXT","club":"Leicester City","note":"Trabajo y desequilibrio"}],
  "PAN":[{"name":"Rolando Blackburn","pos":"DC","club":"Necaxa","note":"Fuerza y gol del delantero panameño"},{"name":"Cecilio Waterman","pos":"DC","club":"Club Tijuana","note":"Velocidad y peligro en el área"},{"name":"Alberto Quintero","pos":"EXT","club":"New England Rev.","note":"Desborde y asistencias por banda"}],
};

/* ═══════════════════════════════════════════════════════════════
   FETCH DATA
═══════════════════════════════════════════════════════════════ */
async function loadData(silent = false) {
  const loadingEl  = document.getElementById("loading");
  const loadingTxt = document.getElementById("loading-text");
  const retryBtn   = document.getElementById("loading-retry");
  const spinner    = document.getElementById("loading-spinner");

  try {
    if (!silent) {
      loadingEl.style.display = "flex";
      loadingEl.style.opacity = "1";
      loadingTxt.textContent = "Cargando datos del mundial…";
      loadingTxt.style.color = "";
      retryBtn.classList.add("hidden");
      spinner.classList.remove("hidden");
    }

    const url = IS_GH_PAGES ? `${DATA_URL}?t=${Date.now()}` : `${DATA_URL}?v=${Date.now()}`;
    const res = await fetch(url, { cache: "no-store" });
    const json = await res.json();

    if (!res.ok || json.error) {
      throw new Error(json.detail || json.error || `Error al cargar datos (${res.status})`);
    }

    if (silent) {
      // Recarga en segundo plano: no toques la pantalla de carga ni el scroll.
      // Si los datos no han cambiado, no re-renderizamos para evitar parpadeos.
      const newSig = _dataSignature(json);
      if (newSig === _lastDataSig) return;
      _lastDataSig = newSig;
      const scrollY = window.scrollY;
      D = json;
      render();
      window.scrollTo({ top: scrollY, behavior: "instant" });
      return;
    }

    D = json;
    _lastDataSig = _dataSignature(json);
    render();
    loadingEl.style.opacity = "0";
    setTimeout(() => loadingEl.style.display = "none", 400);
  } catch (err) {
    console.error("loadData error:", err);
    if (silent) return;  // en segundo plano: fallar en silencio, reintentará luego
    spinner.classList.add("hidden");
    loadingTxt.innerHTML = `<span style="color:#FCA5A5">⚠ Error al cargar datos</span><br><span class="text-xs text-gray-500 mt-2 block">${err.message || err}</span>`;
    retryBtn.classList.remove("hidden");
  }
}
let _lastDataSig = null;

/* Firma de cambios para decidir si hay que re-renderizar en el refresco
   silencioso. Incluye TODO lo que afecta a cualquier clasificación:
     · standings / progression → clasificación y progresión de la porra
     · estado de cada partido (resultado final + en vivo)
     · goleadores (finales y en vivo) → sub-tab Goleadores
   De este modo, cuando la API corrige un partido (marcador, estado en vivo
   o goleadores), se recalculan Grupos, Terceros, Fase Final y Goleadores.
   Se excluyen campos volátiles (timestamps de meta.update) para no provocar
   re-render —y parpadeo— en cada poll sin cambios reales. */
function _dataSignature(json) {
  if (!json) return "";
  const matchesSig = (json.matches || []).map(m =>
    [
      m.id,
      m.played ? 1 : 0,
      m.goals_l ?? "",
      m.goals_v ?? "",
      m.live ? 1 : 0,
      m.live_goals_l ?? "",
      m.live_goals_v ?? "",
      (m.scorers || []).length,
      (m.live_scorers || []).length,
    ].join(":") +
    // contenido de goleadores (autor/min/penalti/og) para captar correcciones
    // que no cambian el marcador
    "#" + JSON.stringify(m.scorers || []) +
    "@" + JSON.stringify(m.live_scorers || [])
  ).join("|");
  return JSON.stringify(json.standings) + JSON.stringify(json.progression) + "||" + matchesSig;
}

async function forceRefresh() {
  document.getElementById("loading").style.display = "flex";
  document.getElementById("loading").style.opacity = "1";
  if (!IS_GH_PAGES) await fetch("/api/refresh");
  await loadData();
}

/* ═══════════════════════════════════════════════════════════════
   RENDER EVERYTHING
═══════════════════════════════════════════════════════════════ */
function render() {
  buildTeamIndex();
  initTeamSearch();
  syncTeamSearchUI();
  initTeamSearchSheet();
  renderPodium();
  renderStandingsTable();
  renderPlayerStrengths();
  renderWeekFilter();
  initCountdown();
  renderMatches(currentPhase, currentWeek);
  renderCalendar();
  renderBracket();
  renderTeams();
  renderBets();
  renderProgression();
  renderHonor();
  renderScoring();
  renderStats();
  renderMeta();
}

/* ── Compute next update slot (next full hour in Spain time) from browser ── */
/** Hora y minuto actuales en España (formato 24 h). */
function spainHourMinute() {
  const s = new Date().toLocaleTimeString("es-ES", {
    timeZone: "Europe/Madrid",
    hour: "2-digit", minute: "2-digit",
    hour12: false,
  });
  const [h, m] = s.split(":").map(n => parseInt(n, 10));
  return { h, m };
}

/** Última y próxima comprobación del cron (cada 5 min) según hora España.
 *  Coincide con el cron de update-porra.yml ("*​/5 * * * *"). */
function naturalHourSlots() {
  const { h, m } = spainHourMinute();
  const lastMin = m - (m % 5);
  const last = `${String(h).padStart(2, "0")}:${String(lastMin).padStart(2, "0")}`;
  const add = 5 - (m % 5);
  let nextTotal = h * 60 + m + add;
  const nextH = Math.floor(nextTotal / 60) % 24;
  const nextMin = nextTotal % 60;
  const next = `${String(nextH).padStart(2, "0")}:${String(nextMin).padStart(2, "0")}`;
  const mins = add;
  return { last, next, mins };
}

let _countdownTimer = null;

/* Códigos FIFA de 3 letras por nombre (español) usado en la porra. */
const FIFA_CODES = {
  "Alemania": "GER", "Arabia Saudita": "KSA", "Arabia Saudí": "KSA",
  "Argelia": "ALG", "Argentina": "ARG", "Australia": "AUS", "Austria": "AUT",
  "Bélgica": "BEL", "Bosnia y Herzegovina": "BIH", "Brasil": "BRA",
  "Cabo Verde": "CPV", "Canadá": "CAN", "Catar": "QAT", "Colombia": "COL",
  "Corea del Sur": "KOR", "Costa de Marfil": "CIV", "Croacia": "CRO",
  "Curazao": "CUW", "Ecuador": "ECU", "Egipto": "EGY", "Escocia": "SCO",
  "España": "ESP", "Estados Unidos": "USA", "Francia": "FRA", "Ghana": "GHA",
  "Haití": "HAI", "Inglaterra": "ENG", "Irak": "IRQ", "Irán": "IRN",
  "Japón": "JPN", "Jordania": "JOR", "Marruecos": "MAR", "México": "MEX",
  "Noruega": "NOR", "Nueva Zelanda": "NZL", "Panamá": "PAN", "Paraguay": "PAR",
  "Países Bajos": "NED", "Portugal": "POR", "RD Congo": "COD",
  "República Checa": "CZE", "Senegal": "SEN", "Sudáfrica": "RSA",
  "Suecia": "SWE", "Suiza": "SUI", "Turquía": "TUR", "Túnez": "TUN",
  "Uruguay": "URU", "Uzbekistán": "UZB",
};

function teamCode(name) {
  if (!name) return "";
  return FIFA_CODES[name] || name.slice(0, 3).toUpperCase();
}

/* Último partido jugado en orden cronológico (fecha + hora España). */
function lastPlayedMatch() {
  const played = (D?.matches || [])
    .filter(m => m.played && m.date)
    .sort((a, b) => (a.date + (a.time_es || "")).localeCompare(b.date + (b.time_es || "")));
  return played.at(-1) || null;
}

/* "🇶🇦 QAT 4-1 SUI 🇨🇭" para un partido (banderas + código + marcador). */
function matchResultLabel(m) {
  if (!m) return "";
  const score = (m.result && m.result.score)
    || (m.goals_l != null && m.goals_v != null ? `${m.goals_l}-${m.goals_v}` : "");
  const fh = m.flag_home || "", fa = m.flag_away || "";
  const ch = teamCode(m.home), ca = teamCode(m.away);
  const mid = score ? `${ch} ${score} ${ca}` : `${ch} vs ${ca}`;
  return `${fh} ${mid} ${fa}`.replace(/\s+/g, " ").trim();
}

function tickBanner() {
  const upd = D?.meta?.update || {};
  const lastEl = document.getElementById("upd-last");
  const nextEl = document.getElementById("upd-next");

  // ── Si hay partidos en juego, el banner anuncia el directo ──
  const liveMatches = (D?.matches || []).filter(m => !m.played && m.live);
  const lineEl = document.getElementById("upd-line");
  const tzEl = document.getElementById("upd-tz");
  if (lineEl) {
    if (liveMatches.length) {
      const parts = liveMatches.map(m => {
        const ch = teamCode(m.home), ca = teamCode(m.away);
        const fh = m.flag_home || "", fa = m.flag_away || "";
        const sc = (m.live_goals_l != null && m.live_goals_v != null)
          ? `${m.live_goals_l}-${m.live_goals_v}` : "";
        const min = m.live_minute ? ` · ${liveMinuteLabel(m.live_minute)}` : "";
        return `${fh} ${ch} ${sc} ${ca} ${fa}${min}`.replace(/\s+/g, " ").trim();
      });
      const lead = liveMatches.length > 1 ? "Partidos en juego" : "Partido en juego";
      lineEl.innerHTML = `<span class="upd-live-dot"></span><strong class="upd-live-lead">${lead}:</strong> ${parts.join(" · ")} <span class="upd-live-prov">· clasificación provisional</span>`;
      lineEl.classList.add("upd-line-live");
      if (tzEl) tzEl.classList.add("hidden");
      // El resto del tick (próxima revisión) sigue actualizándose abajo.
    } else {
      lineEl.classList.remove("upd-line-live");
      if (tzEl) tzEl.classList.remove("hidden");
      // Restaura la estructura estática si venía del modo directo.
      if (!document.getElementById("upd-last")) {
        lineEl.innerHTML = `Datos actualizados a las <strong id="upd-last">—</strong><span id="upd-match"></span>`;
      }
    }
  }

  // "Datos actualizados a las" → solo si hay fecha real en el JSON.
  const lastEl2 = document.getElementById("upd-last");
  if (lastEl2 && !liveMatches.length) {
    lastEl2.textContent = upd.last_updated_time || naturalHourSlots().last;
  }

  // "tras [bandera] COD score COD [bandera]" del último partido jugado.
  const matchEl = document.getElementById("upd-match");
  if (matchEl && !liveMatches.length) {
    const m = lastPlayedMatch();
    const lbl = matchResultLabel(m);
    if (lbl && m?.date) {
      const safeName = (m.name || "").replace(/"/g, "&quot;");
      matchEl.innerHTML = ` tras <button class="upd-match-link" data-date="${m.date}" data-match="${safeName}">${lbl}</button>`;
    } else {
      matchEl.textContent = lbl ? ` tras ${lbl}` : "";
    }
  }

  // "Próxima revisión a las" = siguiente múltiplo de 5 min desde ahora (hora España).
  const { next, mins } = naturalHourSlots();
  if (nextEl) nextEl.textContent = next;

  // Misma lógica en la celda del panel admin (si está abierto).
  const admNext = document.getElementById("adm-next-update");
  if (admNext) admNext.textContent = `${next} (en ~${mins} min)`;
}

function startCountdown() {
  tickBanner();
  if (_countdownTimer) clearInterval(_countdownTimer);
  _countdownTimer = setInterval(tickBanner, 30000);
}

/* ── Auto-poll: refresca datos silenciosamente cuando hay partido en juego
   o uno arranca en menos de 20 min. Fuera de esa ventana no hace nada. ── */
let _livePollTimer = null;
const LIVE_POLL_MS = 60_000; // 60 s cuando hay partido activo

function _isMatchImminent() {
  if (!D) return false;
  const nowMs = Date.now();
  return (D.matches || []).some(m => {
    if (m.played || m.live) return false;
    // date = "YYYY-MM-DD", time_es = "HH:MM"
    if (!m.date || !m.time_es) return false;
    try {
      const kickoff = new Date(`${m.date}T${m.time_es}:00`).getTime();
      const diff = kickoff - nowMs;
      return diff > 0 && diff < 20 * 60_000; // dentro de los próximos 20 min
    } catch { return false; }
  });
}

function _shouldPollNow() {
  if (!D) return false;
  const hasLive = D.meta?.live?.active === true ||
                  (D.matches || []).some(m => m.live && !m.played);
  return hasLive || _isMatchImminent();
}

function _updateLiveBadge(active) {
  const el = document.getElementById("upd-live-poll-badge");
  if (!el) return;
  el.classList.toggle("hidden", !active);
}

function startLivePoll() {
  // Limpia timer anterior si existe
  if (_livePollTimer) { clearInterval(_livePollTimer); _livePollTimer = null; }

  if (!_shouldPollNow()) { _updateLiveBadge(false); return; }

  _updateLiveBadge(true);

  _livePollTimer = setInterval(async () => {
    await loadData(true); // silent reload: no spinner, no scroll
    tickBanner();         // actualiza el banner en directo inmediatamente
    if (!_shouldPollNow()) {
      clearInterval(_livePollTimer);
      _livePollTimer = null;
      _updateLiveBadge(false);
    }
  }, LIVE_POLL_MS);
}

function renderMeta() {
  const upd = D?.meta?.update;
  const banner = document.getElementById("update-banner");

  if (banner) banner.classList.remove("hidden");

  startCountdown();
  startLivePoll();

  const iu = document.getElementById("info-updated");
  if (iu) {
    const apiUrl = "https://worldcup26.ir/get/games";
    iu.innerHTML = `
      <strong class="text-gray-200">Pronósticos</strong> — manual: se cambian en el Excel ADMIN y hay que publicar con
      <code class="text-xs text-blue-300">build_static.py</code> + push.<br>
      <strong class="text-gray-200">Goles del Mundial</strong> — automático: cuando un partido acaba de terminar,
      <code class="text-xs text-blue-300">fetch_results.py</code> (GitHub Actions) consulta la API, escribe los goles en
      los dos Excel del repo, recalcula los puntos y regenera <code class="text-xs text-blue-300">data.json</code>.
      Sin tocar nada a mano.<br>
      Código y detalle:
      <a href="https://github.com/pCresp0/porra-mundial-nanos-2026" target="_blank" rel="noopener" class="text-blue-300 hover:text-yellow-400">GitHub del proyecto</a> ·
      API:
      <a href="${apiUrl}" target="_blank" rel="noopener" class="text-blue-300 hover:text-yellow-400 break-all">${apiUrl}</a>`;
  }
}

/* ─── PODIUM ─── */
function renderPodium() {
  const container = document.getElementById("podium");
  const restEl    = document.getElementById("podium-rest");
  _renderLiveStandingsBanner();
  const liveActive = _liveStandingsActive();
  const ranked = liveActive
    ? [...D.standings].sort((a, b) => (b.total_live || 0) - (a.total_live || 0))
    : D.standings;
  const totOf = p => liveActive ? (p.total_live != null ? p.total_live : p.total) : p.total;
  const provTag = p => (liveActive && p.live_points > 0)
    ? `<div class="podium-prov">+${_fmtPts(p.live_points)} en juego</div>` : "";
  const top3 = ranked.slice(0, 3);
  const order  = [{ idx: 1, cls: "podium-2nd", medal: "🥈" },
                  { idx: 0, cls: "podium-1st", medal: "🥇" },
                  { idx: 2, cls: "podium-3rd", medal: "🥉" }];

  container.innerHTML = order.map(({ idx, cls, medal }) => {
    const p = top3[idx];
    if (!p) return "";
    const rankLbl = idx === 0 ? "1º" : idx === 1 ? "2º" : "3º";
    return `
      <div class="podium-col ${cls}${liveActive ? " podium-prov-col" : ""}">
        <div class="podium-player">
          <div class="text-3xl mb-1">${medal}</div>
          <div class="bebas text-2xl tracking-wide" style="color:${p.color}">${p.name}</div>
          <div class="podium-score bebas" style="color:${p.color};font-size:1.1rem;opacity:.85">${_fmtPts(totOf(p))} pts${liveActive ? " <span class='prov-tag'>prov.</span>" : ""}</div>
          ${provTag(p)}
        </div>
        <div class="podium-block" aria-label="${rankLbl} puesto">${rankLbl}</div>
      </div>`;
  }).join("");

  const rest = ranked.slice(3);
  restEl.innerHTML = rest.map((p, i) => `
    <div class="card p-3 flex items-center justify-between" style="border-left:3px solid ${p.color}">
      <div>
        <span class="text-xs text-gray-500 font-bold">#${liveActive ? (i + 4) : p.pos}</span>
        <span class="font-bold text-white ml-2">${p.name}</span>
        ${(liveActive && p.live_points > 0) ? `<span class="rest-prov">+${_fmtPts(p.live_points)} en juego</span>` : ""}
      </div>
      <span class="bebas text-xl" style="color:${p.color}">${_fmtPts(totOf(p))}${liveActive ? " <span class='prov-tag'>prov.</span>" : ""}</span>
    </div>`).join("");
}

/* ¿Hay clasificación provisional activa (algún partido en curso con puntos)? */
function _liveStandingsActive() {
  if (!D || !D.meta || !D.meta.live || !D.meta.live.active) return false;
  return (D.standings || []).some(p => (p.live_points || 0) > 0);
}

function _fmtPts(v) {
  v = +v || 0;
  return Number.isInteger(v) ? v : v.toFixed(2).replace(/\.?0+$/, "");
}

/* Banner "clasificación provisional" en la pestaña de clasificación. */
function _renderLiveStandingsBanner() {
  const el = document.getElementById("live-standings-banner");
  if (!el) return;
  if (!_liveStandingsActive()) { el.classList.add("hidden"); el.innerHTML = ""; return; }
  const liveMatches = (D.matches || []).filter(m => !m.played && m.live);
  const names = liveMatches.map(m => {
    const home = m.home || (m.name.split("-")[0] || "").trim();
    const away = m.away || (m.name.split("-").slice(1).join("-") || "").trim();
    const sc = (m.live_goals_l != null && m.live_goals_v != null) ? ` ${m.live_goals_l}-${m.live_goals_v}` : "";
    return `${home}${sc} ${away}`.trim();
  });
  const list = names.length
    ? `<div class="lsb-matches">${names.map(n => `<span class="lsb-match"><span class="live-dot"></span>${n}</span>`).join("")}</div>`
    : "";
  el.innerHTML = `
    <div class="lsb-head"><span class="lsb-badge">🔴 PROVISIONAL</span>
      <span class="lsb-text">La clasificación incluye los puntos de los partidos <strong>en juego</strong>. Se confirmará al finalizar.</span>
    </div>${list}`;
  el.classList.remove("hidden");
}

function liveMinuteLabel(raw) {
  const s = String(raw || "").trim();
  if (!s) return "EN JUEGO";
  const low = s.toLowerCase();
  if (low === "ht" || low === "halftime" || low === "half-time") return "DESCANSO";
  if (low === "ft" || low === "finished") return "FINAL";
  // "67'", "45'+2'" → tal cual; si es solo número, añade comilla
  if (/^\d+$/.test(s)) return s + "'";
  return s;
}

function matchTeamsHtml(m) {
  const home = m.home || (m.name.includes("-") ? m.name.split("-")[0].trim() : m.name);
  const away = m.away || (m.name.includes("-") ? m.name.split("-").slice(1).join("-").trim() : "");
  const fh = m.flag_home || "🏳️";
  const fa = m.flag_away || "🏳️";
  const hasLiveScore = !m.played && m.live && m.live_goals_l != null && m.live_goals_v != null;
  const isLive = hasLiveScore || (_liveMatchIds && _liveMatchIds.has(m.name));
  let scoreHtml;
  if (m.played && m.result) {
    const playedTime = m.time_es
      ? `<div class="match-played-time" title="Hora de inicio (España peninsular)">🕒 ${m.time_es} h</div>`
      : "";
    scoreHtml = `<div class="match-score-big">${m.result.score.replace("-", " - ")}</div>${playedTime}`;
  } else if (hasLiveScore) {
    const minute = (m.live_minute || "").trim();
    const minLabel = minute ? liveMinuteLabel(minute) : "EN JUEGO";
    scoreHtml = `<div class="match-score-big match-score-live">${m.live_goals_l} - ${m.live_goals_v}</div>
      <div class="live-minute-pill"><span class="live-ball">⚽</span> ${minLabel} · EN DIRECTO</div>`;
  } else if (isLive) {
    scoreHtml = `<div style="margin-top:.5rem;font-size:2.2rem;font-weight:900;color:#3B82F6;font-family:'Bebas Neue',sans-serif;letter-spacing:.08em">EN CURSO</div>
      <div style="font-size:.78rem;color:#93C5FD;margin-top:.15rem;letter-spacing:.04em">${m.time_es} h</div>`;
  } else if (m.time_es) {
    const isNext = _nextMatchId && (m.id === _nextMatchId || m.name === _nextMatchId);
    if (isNext) {
      scoreHtml = `<div style="margin-top:.4rem;font-size:1.1rem;font-weight:700;color:#64748B;letter-spacing:.03em">${m.time_es}<span style="font-size:.7rem;font-weight:400;margin-left:.3rem;opacity:.7">h</span></div>
        <div id="match-countdown" style="font-family:'Courier New',monospace;font-size:1.2rem;font-weight:900;color:var(--gold);letter-spacing:.06em;margin-top:.3rem">--:--</div>`;
    } else {
      scoreHtml = `<div style="margin-top:.4rem;font-size:1.1rem;font-weight:700;color:#64748B;letter-spacing:.03em">${m.time_es}<span style="font-size:.7rem;font-weight:400;margin-left:.3rem;opacity:.7">h</span></div>`;
    }
  } else {
    scoreHtml = `<div style="margin-top:.4rem;font-size:.85rem;color:#334155;font-weight:600;letter-spacing:.06em;text-transform:uppercase">vs</div>`;
  }
  return `
    <div class="match-header-center">
      <div class="match-teams-row">
        <span class="match-flag">${fh}</span>
        <span class="match-team-name team-name-btn" data-team="${home.replace(/"/g,'&quot;')}" title="Ver partidos de ${home}">${home}</span>
        <span class="match-vs">vs</span>
        <span class="match-team-name team-name-btn" data-team="${away.replace(/"/g,'&quot;')}" title="Ver partidos de ${away}">${away}</span>
        <span class="match-flag">${fa}</span>
      </div>
      ${scoreHtml}
      ${matchScorersHtml(m)}
    </div>`;
}

function matchScorersHtml(m) {
  const list = m.played ? m.scorers : (m.live ? m.live_scorers : null);
  if (!Array.isArray(list) || !list.length) return "";

  function fmtMinute(raw) {
    // "45'+5'" → <span>45'</span><span class="ms-extra">+5'</span>
    // "90'+8'" → same pattern
    // "31'"    → just the minute
    if (!raw) return "";
    const et = raw.match(/^(\d+)'\+(\d+)'$/);
    if (et) return `${et[1]}'<span class="ms-extra">+${et[2]}'</span>`;
    return escapeHtml(raw);
  }

  function fmtLine(s, side) {
    const isOG  = s.own_goal;
    const isPen = s.penalty;
    const icon  = isOG ? '<span class="ms-og-icon">⚽</span>' : "⚽";
    const penTag = isPen ? ' <span class="ms-pen-tag">penalty</span>' : "";
    const ogTag  = isOG  ? ' <span class="ms-og-tag">PP</span>' : "";
    const name  = `<span class="ms-name${isOG ? " ms-og" : ""}">${escapeHtml(s.player)}${ogTag}${penTag}</span>`;
    const min   = s.minute ? `<span class="ms-min">${fmtMinute(s.minute)}</span>` : "";
    if (side === "away") {
      return `<div class="ms-line ms-line-away">${min} ${name} ${icon}</div>`;
    }
    return `<div class="ms-line">${icon} ${name} ${min}</div>`;
  }

  const homeS = list.filter(s => s.team === "home");
  const awayS = list.filter(s => s.team === "away");
  if (!homeS.length && !awayS.length) return "";
  const col = (arr, side) => `<div class="ms-col ms-col-${side}">${arr.map(s => fmtLine(s, side)).join("")}</div>`;
  return `<div class="match-scorers">${col(homeS, "home")}<div class="ms-sep"></div>${col(awayS, "away")}</div>`;
}

function matchMetaHtml(m) {
  const parts = [];
  // La hora ya sale en matchTeamsHtml; aquí solo mostramos sede y TV
  if (m.city && m.country) {
    // Venue is a clickable button if we have coords or players info
    const hasDetail = m.lat || m.stadium || (m.home && TEAM_TO_FIFA[m.home]);
    if (hasDetail) {
      parts.push(`<button class="match-detail-btn" onclick="openMatchDetail('${m.name.replace(/'/g,"\\'")}');event.stopPropagation()" title="Ver sede del partido">📍 ${m.city} (${m.country})</button>`);
    } else {
      parts.push(`<span class="match-venue">📍 ${m.city} (${m.country})</span>`);
    }
  }
  const tv = tvBadgesHtml(m);
  if (tv) parts.push(tv);
  if (!parts.length) return "";
  return `<div class="match-meta-row">${parts.join("")}</div>`;
}

/* ─── STANDINGS TABLE ─── */
function renderStandingsTable() {
  const tbody = document.getElementById("standings-table");
  const rows = _standingsRows();
  const { key, dir } = _stSort;
  rows.sort((a, b) => {
    let va = a[key], vb = b[key];
    if (typeof va === "string") {
      const cmp = va.toLowerCase().localeCompare(vb.toLowerCase());
      return dir === "asc" ? cmp : -cmp;
    }
    return dir === "asc" ? va - vb : vb - va;
  });
  const fmt = v => Number.isInteger(v) ? v : (+v).toFixed(2).replace(/\.?0+$/, "");
  const liveActive = _liveStandingsActive();
  tbody.innerHTML = rows.map(r => {
    const medal = r.pos <= 3 ? MEDAL[r.pos - 1] + " " : "";
    const provBadge = (liveActive && r.live_points > 0)
      ? ` <span class="prov-tag">prov.</span>` : "";
    return `<tr${liveActive ? ' class="st-prov-row"' : ""}>
      <td class="font-bold" style="color:${r.color}">${r.pos}</td>
      <td class="text-left font-semibold text-white">${medal}${r.name}</td>
      <td class="font-extrabold text-lg" style="color:${r.color}">${fmt(r.total)}${provBadge}</td>
      <td>${fmt(r.groups)}</td>
      <td>${fmt(r.s1x2)}</td>
      <td>${fmt(r.sdiff)}</td>
      <td>${fmt(r.sexact)}</td>
      <td>${fmt(r.positions)}</td>
    </tr>`;
  }).join("");
  _syncStandingsSortIndicators();
  _renderStandingsUpdated();
  // Indicador "PROVISIONAL" junto al título de la tabla
  const provLbl = document.getElementById("standings-prov-label");
  if (provLbl) {
    if (_liveStandingsActive()) {
      provLbl.innerHTML = `<span class="standings-prov-badge">🔴 PROVISIONAL</span> `;
    } else {
      provLbl.textContent = "";
    }
  }
}

/* Nota junto a "Tabla completa": cuándo y tras qué partido se actualizó. */
function _renderStandingsUpdated() {
  const el = document.getElementById("standings-updated");
  if (!el || !D) return;

  // Último partido jugado en orden cronológico (fecha + hora España)
  const lastM = lastPlayedMatch();
  if (!lastM) { el.textContent = ""; return; }

  // Tiempo transcurrido desde la última actualización de datos
  const iso = D?.meta?.update?.last_updated_iso;
  let when = "";
  if (iso) {
    const d = new Date(iso);
    if (!isNaN(d)) {
      const mins = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
      if (mins < 1)        when = "hace un momento";
      else if (mins < 60)  when = `hace ${mins} min`;
      else {
        const h = Math.floor(mins / 60), mm = mins % 60;
        when = `hace ${h}h${mm ? " " + mm + "min" : ""}`;
      }
    }
  }

  const match = matchResultLabel(lastM);
  el.textContent = `· actualizada ${when} tras jugarse ${match}`;
}

/* Desglose de puntos por motivo (1X2 / diferencia / exacto) a partir de
   los partidos de grupos jugados, más los datos de la clasificación. */
function _standingsRows() {
  const liveActive = _liveStandingsActive();
  const gm = (D.matches || []).filter(m => m.phase === "groups" && m.played);
  const lm = liveActive
    ? (D.matches || []).filter(m => m.phase === "groups" && !m.played && m.live)
    : [];
  return D.standings.map(p => {
    let s1x2 = 0, sdiff = 0, sexact = 0;
    gm.forEach(m => {
      const b = m.predictions?.[p.name]?.breakdown;
      if (b) {
        s1x2   += +b.sign  || 0;
        sdiff  += +b.diff  || 0;
        sexact += +b.exact || 0;
      }
    });
    lm.forEach(m => {
      const b = m.predictions?.[p.name]?.live_breakdown;
      if (b) {
        s1x2   += +b.sign  || 0;
        sdiff  += +b.diff  || 0;
        sexact += +b.exact || 0;
      }
    });
    const lp = +p.live_points || 0;
    return {
      pos: liveActive ? (p.live_pos || p.pos) : p.pos,
      name: p.name, color: p.color,
      total: liveActive ? (+p.total_live || +p.total || 0) : (+p.total || 0),
      groups: (+p.groups || 0) + (liveActive ? lp : 0),
      positions: +p.positions || 0,
      s1x2, sdiff, sexact,
      live_points: lp,
    };
  });
}

const _stSort = { key: "pos", dir: "asc" };
const _ST_DEFAULT_DIR = { name: "asc" }; // el resto, numéricas → desc

function _syncStandingsSortIndicators() {
  const head = document.getElementById("standings-head");
  if (!head) return;
  head.querySelectorAll("th.st-sortable").forEach(th => {
    const active = th.dataset.key === _stSort.key;
    th.classList.toggle("st-active", active);
    let arrow = th.querySelector(".st-arrow");
    if (!arrow) {
      arrow = document.createElement("span");
      arrow.className = "st-arrow";
      th.appendChild(arrow);
    }
    arrow.textContent = active ? (_stSort.dir === "asc" ? "▲" : "▼") : "↕";
  });
}

(function initStandingsSort() {
  document.addEventListener("click", e => {
    const th = e.target.closest("#standings-head th.st-sortable");
    if (!th) return;
    const key = th.dataset.key;
    if (_stSort.key === key) {
      _stSort.dir = _stSort.dir === "asc" ? "desc" : "asc";
    } else {
      _stSort.key = key;
      _stSort.dir = _ST_DEFAULT_DIR[key] || "desc";
    }
    renderStandingsTable();
  });
})();

/* ─── PLAYER STRENGTHS ─── */
function renderPlayerStrengths() {
  const ps = D.player_strengths;
  if (!ps) return;

  const rankEl = document.getElementById("strength-rankings");
  const profEl = document.getElementById("strength-profiles");

  // Mini leaderboards — only skills with activity, top 4 each
  const activeSkills = (ps.skills || []).filter(sk => {
    const rows = ps.rankings[sk.key] || [];
    return rows.some(r => r.value > 0);
  });
  rankEl.innerHTML = activeSkills.map(sk => {
    const rows = (ps.rankings[sk.key] || []).filter(r => r.value > 0).slice(0, 4);
    if (!rows.length) return "";
    const pillClass = r => r.rank === 1 ? "rank-pill-1" : r.rank === 2 ? "rank-pill-2" : r.rank === 3 ? "rank-pill-3" : "rank-pill-4";
    return `<div class="card ranking-mini-card">
      <div class="ranking-mini-head">
        <span class="rm-icon">${sk.icon}</span>
        <h4>${sk.label}</h4>
      </div>
      <div class="ranking-mini-body">
      ${rows.map(r => `
        <div class="ranking-mini-row">
          <span class="rm-player">
            <span class="rank-pill ${pillClass(r)}">#${r.rank}</span>
            <span style="color:${r.color}">${r.name}</span>
          </span>
          <span class="rm-val">${r.display}</span>
        </div>`).join("")}
      </div>
    </div>`;
  }).join("");

  // Per-player profile cards
  profEl.innerHTML = (ps.players || []).map(p => {
    const badges = (p.badges || []).map(b =>
      `<span class="strength-badge">${b.icon} ${b.label}</span>`
    ).join(" ");
    const bestPhase = p.best_phase
      ? `<p class="text-xs text-gray-500 mt-2">Más puntos en: <strong class="text-gray-300">${p.best_phase.label}</strong> (${p.best_phase.pts} pts)</p>`
      : "";

    const skillsHtml = (p.top_skills || []).map(sk => {
      const rc = sk.rank === 1 ? "skill-rank-1" : sk.rank === 2 ? "skill-rank-2" : sk.rank === 3 ? "skill-rank-3" : "skill-rank-n";
      const maxRank = D.meta.players.length;
      const pct = Math.round((1 - (sk.rank - 1) / Math.max(maxRank - 1, 1)) * 100);
      return `<div class="skill-rank-row">
        <span class="skill-rank-num ${rc}">${sk.rank}</span>
        <div class="flex-1 min-w-0">
          <div class="flex justify-between gap-2">
            <span class="text-gray-200 font-semibold truncate">${sk.icon} ${sk.label}</span>
            <span class="text-xs text-gray-500 shrink-0">${sk.display}</span>
          </div>
          <div class="skill-bar-wrap mt-1"><div class="skill-bar" style="width:${pct}%;background:${p.color}"></div></div>
        </div>
      </div>`;
    }).join("");

    const s = p.stats || {};
    const detailGrid = p.matches_played > 0 ? `
      <div class="grid grid-cols-3 gap-2 mt-3 pt-3 border-t text-center" style="border-color:var(--border)">
        <div><div class="text-xs text-gray-500">1X2</div><div class="font-bold text-sm" style="color:${p.color}">${s.hits_1x2}/${p.matches_played}</div></div>
        <div><div class="text-xs text-gray-500">Dif.</div><div class="font-bold text-sm" style="color:${p.color}">${s.hits_diff}/${p.matches_played}</div></div>
        <div><div class="text-xs text-gray-500">Exactos</div><div class="font-bold text-sm" style="color:${p.color}">${s.hits_exact}/${p.matches_played}</div></div>
      </div>` : `<p class="text-xs text-gray-600 mt-3">Sin partidos jugados aún</p>`;

    return `<div class="card strength-card p-4" style="border-left-color:${p.color}">
      <div class="flex items-start justify-between gap-2 mb-3">
        <div>
          <span class="font-extrabold text-white uppercase text-lg">${p.name}</span>
          <span class="text-xs text-gray-500 ml-2">#${p.pos}</span>
          ${badges ? `<div class="flex flex-wrap gap-1.5 mt-2">${badges}</div>` : ""}
        </div>
      </div>
      <p class="text-xs font-bold text-gray-500 uppercase mb-2">Top habilidades</p>
      ${skillsHtml || `<p class="text-xs text-gray-600">Aún sin datos suficientes</p>`}
      ${detailGrid}
      ${bestPhase}
    </div>`;
  }).join("");
}

/* ─── WEEK FILTER ─── */
function renderWeekFilter() {
  const el = document.getElementById("week-filter");
  const weeks = D.meta.weeks || [];
  const today = todaySpainISO();

  // Auto-select the current week on first render (no mientras hay búsqueda de
  // equipo activa: en ese caso queremos ver todas las semanas)
  if (currentWeek === "all" && weeks.length && !selectedTeamFilter) {
    const cur = weeks.find(w => today >= w.from && today <= w.to);
    if (cur) currentWeek = cur.id;
  }

  el.innerHTML = `<button class="week-btn ${currentWeek==='all'?'active':''}" data-week="all">Todas</button>` +
    weeks.map(w => `<button class="week-btn ${currentWeek===w.id?'active':''}" data-week="${w.id}">${w.label}</button>`).join("");
  el.querySelectorAll(".week-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      el.querySelectorAll(".week-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentWeek = btn.dataset.week;
      resetMatchesDayWindow();
      scrollMatchesToToday = true;
      renderMatches(currentPhase, currentWeek);
    });
  });
}

/* ═══════════════════════════════════════════════════════════════
   CARA A CARA (H2H entre dos jugadores)
═══════════════════════════════════════════════════════════════ */
let _h2hA = null, _h2hB = null;

/* Categoría de acierto de una predicción a partir del desglose.
   "exact" | "diff" | "sign" | "miss" | "none" (sin predicción). */
function _h2hCat(pd) {
  if (!pd || !pd.pred) return "none";
  const b = pd.breakdown || {};
  if ((+b.exact || 0) > 0) return "exact";
  if ((+b.diff  || 0) > 0) return "diff";
  if ((+b.sign  || 0) > 0) return "sign";
  return "miss";
}

/* Racha activa (partidos seguidos puntuando desde el último jugado hacia atrás). */
function _h2hStreak(name, played) {
  let s = 0;
  for (let i = played.length - 1; i >= 0; i--) {
    if ((played[i].predictions?.[name]?.score || 0) > 0) s++; else break;
  }
  return s;
}

/* Calcula toda la comparativa entre dos jugadores sobre los partidos jugados. */
function _h2hCompute(a, b) {
  const played = (D.matches || []).filter(m => m.played);
  const stats = {
    a: { pts: 0, exact: 0, diff: 0, sign: 0, miss: 0, played: 0 },
    b: { pts: 0, exact: 0, diff: 0, sign: 0, miss: 0, played: 0 },
  };
  let aWins = 0, bWins = 0, draws = 0;
  const diffMatches = [];

  played.forEach(m => {
    const pa = m.predictions?.[a], pb = m.predictions?.[b];
    const sa = pa?.score || 0, sb = pb?.score || 0;
    const ca = _h2hCat(pa), cb = _h2hCat(pb);
    if (ca !== "none") { stats.a.played++; stats.a.pts += sa; stats.a[ca]++; }
    if (cb !== "none") { stats.b.played++; stats.b.pts += sb; stats.b[cb]++; }
    // Duelo del partido: quién sacó más puntos
    if (sa > sb) aWins++; else if (sb > sa) bWins++; else draws++;
    // Partido donde uno puntuó y el otro no
    if ((sa > 0) !== (sb > 0)) {
      diffMatches.push({ m, sa, sb, ca, cb, winner: sa > 0 ? "a" : "b" });
    }
  });

  stats.a.streak = _h2hStreak(a, played);
  stats.b.streak = _h2hStreak(b, played);
  stats.a.hits = stats.a.exact + stats.a.diff + stats.a.sign;
  stats.b.hits = stats.b.exact + stats.b.diff + stats.b.sign;
  stats.a.pct = stats.a.played > 0 ? Math.round(stats.a.hits / stats.a.played * 100) : 0;
  stats.b.pct = stats.b.played > 0 ? Math.round(stats.b.hits / stats.b.played * 100) : 0;

  return { stats, aWins, bWins, draws, diffMatches, playedCount: played.length };
}

/* Cambia uno de los jugadores seleccionados y vuelve a pintar. */
function _h2hPick(which, val) {
  if (which === "a") _h2hA = val; else _h2hB = val;
  renderH2H();
}

/* Fila de la tabla comparativa con resaltado del mejor valor.
   lowerBetter=true → gana quien tiene el valor más bajo (p.ej. fallos). */
function _h2hStatRow(label, va, vb, fmtFn, lowerBetter) {
  const f = fmtFn || (v => v);
  const aw = lowerBetter ? va < vb : va > vb;
  const bw = lowerBetter ? vb < va : vb > va;
  return `<tr>
    <td class="h2h-cell h2h-cell-a ${aw ? "h2h-win" : ""}">${f(va)}</td>
    <td class="h2h-cell-lbl">${label}</td>
    <td class="h2h-cell h2h-cell-b ${bw ? "h2h-win" : ""}">${f(vb)}</td>
  </tr>`;
}

function renderH2H() {
  const cont = document.getElementById("h2h-container");
  if (!cont || !D) return;
  const players = D.meta?.players || [];
  const colors  = D.meta?.colors  || {};
  if (players.length < 2) {
    cont.innerHTML = `<div class="card p-5 text-center text-gray-400">Hacen falta al menos dos jugadores para comparar.</div>`;
    return;
  }

  // Valores por defecto: los dos primeros de la clasificación
  const order = (D.standings || []).map(s => s.name).filter(n => players.includes(n));
  const fallback = order.length ? order : players;
  if (!_h2hA || !players.includes(_h2hA)) _h2hA = fallback[0];
  if (!_h2hB || !players.includes(_h2hB)) _h2hB = fallback[1] || fallback[0];

  const opts = (sel) => players.map(n =>
    `<option value="${escapeHtml(n)}" ${n === sel ? "selected" : ""}>${escapeHtml(n)}</option>`).join("");

  const pickers = `
    <div class="h2h-pickers card">
      <select class="h2h-select" onchange="_h2hPick('a', this.value)" style="--h2h-c:${colors[_h2hA] || "#fff"}">${opts(_h2hA)}</select>
      <span class="h2h-vs-pill">VS</span>
      <select class="h2h-select" onchange="_h2hPick('b', this.value)" style="--h2h-c:${colors[_h2hB] || "#fff"}">${opts(_h2hB)}</select>
    </div>`;

  if (_h2hA === _h2hB) {
    cont.innerHTML = pickers + `<div class="card p-5 text-center text-gray-400 mt-4">Elige dos jugadores distintos para compararlos.</div>`;
    return;
  }

  const { stats, aWins, bWins, draws, diffMatches, playedCount } = _h2hCompute(_h2hA, _h2hB);

  if (playedCount === 0) {
    cont.innerHTML = pickers + `<div class="card p-5 text-center text-gray-400 mt-4">Aún no hay partidos jugados para comparar.</div>`;
    return;
  }

  const cA = colors[_h2hA] || "#F5C518", cB = colors[_h2hB] || "#22C55E";
  const sA = (D.standings || []).find(s => s.name === _h2hA) || {};
  const sB = (D.standings || []).find(s => s.name === _h2hB) || {};
  const fmtNum = v => Math.round(v * 10) / 10;

  // Cabecera con nombre, posición y total
  const head = `
    <div class="h2h-head">
      <div class="h2h-head-side" style="--h2h-c:${cA}">
        <div class="h2h-head-name">${escapeHtml(_h2hA)}</div>
        <div class="h2h-head-sub">#${sA.pos ?? "—"} · ${fmtNum(+sA.total || 0)} pts</div>
      </div>
      <div class="h2h-head-mid">🆚</div>
      <div class="h2h-head-side h2h-head-side-b" style="--h2h-c:${cB}">
        <div class="h2h-head-name">${escapeHtml(_h2hB)}</div>
        <div class="h2h-head-sub">#${sB.pos ?? "—"} · ${fmtNum(+sB.total || 0)} pts</div>
      </div>
    </div>`;

  // Duelo directo (partidos donde sacó más puntos que el otro)
  const total = aWins + bWins + draws || 1;
  const duel = `
    <div class="card h2h-duel">
      <div class="h2h-duel-title">⚔️ Duelo directo <span class="h2h-duel-note">partidos donde sacó más puntos que el rival</span></div>
      <div class="h2h-duel-bar">
        <div class="h2h-duel-seg h2h-seg-a" style="width:${aWins / total * 100}%;background:${cA}">${aWins || ""}</div>
        <div class="h2h-duel-seg h2h-seg-d" style="width:${draws / total * 100}%">${draws || ""}</div>
        <div class="h2h-duel-seg h2h-seg-b" style="width:${bWins / total * 100}%;background:${cB}">${bWins || ""}</div>
      </div>
      <div class="h2h-duel-legend">
        <span style="color:${cA}">●</span> ${escapeHtml(_h2hA)} ganó <strong>${aWins}</strong>
        · <span class="h2h-draw-dot">●</span> ${draws} empate${draws === 1 ? "" : "s"}
        · <span style="color:${cB}">●</span> ${escapeHtml(_h2hB)} ganó <strong>${bWins}</strong>
        <span class="h2h-duel-of">(${playedCount} partidos jugados)</span>
      </div>
    </div>`;

  // Tabla comparativa
  const table = `
    <div class="card h2h-table-wrap">
      <table class="h2h-table">
        <thead><tr>
          <th style="color:${cA}">${escapeHtml(_h2hA)}</th>
          <th class="h2h-cell-lbl"></th>
          <th style="color:${cB}">${escapeHtml(_h2hB)}</th>
        </tr></thead>
        <tbody>
          ${_h2hStatRow("Puntos sumados", stats.a.pts, stats.b.pts, fmtNum)}
          ${_h2hStatRow("🎯 Marcadores exactos", stats.a.exact, stats.b.exact)}
          ${_h2hStatRow("🔵 1X2 + Dif.", stats.a.diff, stats.b.diff)}
          ${_h2hStatRow("🟠 Solo 1X2", stats.a.sign, stats.b.sign)}
          ${_h2hStatRow("⚪ Fallos (0 pts)", stats.a.miss, stats.b.miss, null, true)}
          ${_h2hStatRow("% de acierto", stats.a.pct, stats.b.pct, v => v + "%")}
          ${_h2hStatRow("🔥 Racha activa", stats.a.streak, stats.b.streak)}
        </tbody>
      </table>
    </div>`;

  // Partidos donde uno clavó y el otro falló
  let diffHtml = "";
  if (diffMatches.length === 0) {
    diffHtml = `<div class="card p-4 text-center text-gray-500 h2h-diff-empty">No hay partidos donde uno puntuara y el otro no. ¡Van muy parejos!</div>`;
  } else {
    const rows = diffMatches.map(d => {
      const m = d.m;
      const fh = m.flag_home || "🏳️", fa = m.flag_away || "🏳️";
      const phase = PHASE_LABELS[m.phase] || m.phase || "";
      const res = m.result?.score || "";
      const predA = m.predictions?.[_h2hA]?.pred?.score || "—";
      const predB = m.predictions?.[_h2hB]?.pred?.score || "—";
      const aHit = d.winner === "a";
      return `<div class="h2h-diff-row">
        <div class="h2h-diff-match">
          <div class="h2h-diff-teams">${fh} ${escapeHtml(m.home)} <span class="h2h-diff-res">${escapeHtml(res)}</span> ${escapeHtml(m.away)} ${fa}</div>
          <div class="h2h-diff-phase">${escapeHtml(phase)}</div>
        </div>
        <div class="h2h-diff-preds">
          <span class="h2h-diff-pred ${aHit ? "h2h-pred-hit" : "h2h-pred-miss"}" style="--h2h-c:${cA}">
            ${aHit ? "✓" : "✗"} ${escapeHtml(predA)} <small>+${fmtNum(d.sa)}</small>
          </span>
          <span class="h2h-diff-pred ${!aHit ? "h2h-pred-hit" : "h2h-pred-miss"}" style="--h2h-c:${cB}">
            ${!aHit ? "✓" : "✗"} ${escapeHtml(predB)} <small>+${fmtNum(d.sb)}</small>
          </span>
        </div>
      </div>`;
    }).join("");
    const aHits = diffMatches.filter(d => d.winner === "a").length;
    const bHits = diffMatches.filter(d => d.winner === "b").length;
    diffHtml = `
      <div class="h2h-diff-block">
        <div class="h2h-diff-head">
          <h3 class="font-bold text-white">⚡ Partidos donde uno clavó y el otro falló</h3>
          <span class="text-xs text-gray-500">${escapeHtml(_h2hA)} ${aHits} · ${bHits} ${escapeHtml(_h2hB)}</span>
        </div>
        <div class="h2h-diff-list">${rows}</div>
      </div>`;
  }

  cont.innerHTML = pickers + head + duel + table + diffHtml;
}

/* ─── PROGRESSION CHART (por partido) ─── */
function renderProgression() {
  const players = D.meta.players;
  const colors  = D.meta.colors;
  const prog    = D.progression;
  const allLabels     = prog.labels      || [];
  const allFlagLabels = prog.flag_labels || allLabels;
  const allDates  = prog.dates  || [];
  const allTitles = prog.titles || [];

  // Cut to today — no future data
  const todayStr = todaySpainISO();
  let cutIdx = allDates.length - 1;
  for (let i = 0; i < allDates.length; i++) {
    if (allDates[i] > todayStr) { cutIdx = i - 1; break; }
  }
  cutIdx = Math.max(0, cutIdx);
  const labels = allFlagLabels.slice(0, cutIdx + 1);
  const dates  = allDates.slice(0, cutIdx + 1);
  const titles = allTitles.slice(0, cutIdx + 1);

  // Different dash patterns so overlapping lines (tied players) are always distinguishable
  const DASHES = [[], [8,4], [4,4], [12,4,4,4], [5,2,2,2], [2,2]];
  const POINT_STYLES = ["circle","triangle","rect","rectRot","star","cross"];

  const datasets = players.map((name, idx) => ({
    label: name,
    data:  ((prog.players && prog.players[name]) || []).slice(0, cutIdx + 1),
    borderColor: colors[name],
    backgroundColor: colors[name] + "22",
    borderWidth: 2.5,
    pointRadius: 4,
    pointHoverRadius: 7,
    pointStyle: POINT_STYLES[idx % POINT_STYLES.length],
    borderDash: DASHES[idx % DASHES.length],
    tension: 0.25,
    fill: false,
  }));

  if (progressionChart) progressionChart.destroy();
  const ctx = document.getElementById("progressionChart").getContext("2d");
  progressionChart = new Chart(ctx, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#1C2240",
          borderColor: "#2A3060",
          borderWidth: 1,
          titleColor: "#F5C518",
          bodyColor: "#E2E8F0",
          callbacks: {
            title: items => {
              const i = items[0].dataIndex;
              const dayPts = prog.day_points?.[items[0].dataset.label]?.[i];
              const head = titles[i] || dates[i] || labels[i];
              return `${head}${dayPts > 0 ? ` (+${dayPts} este partido)` : ""}`;
            },
            label: item => ` ${item.dataset.label}: ${item.parsed.y} pts acumulados`,
          }
        }
      },
      scales: {
        x: {
          title: { display: true, text: "Partido (orden cronológico)", color: "#64748B", font: { size: 11 } },
          grid: { color: "rgba(255,255,255,.05)" },
          ticks: { color: "#475569", font: { size: 14 }, maxRotation: 0, minRotation: 0, autoSkip: true, autoSkipPadding: 4, padding: 6 }
        },
        y: {
          title: { display: true, text: "Puntos acumulados", color: "#64748B", font: { size: 11 } },
          beginAtZero: true,
          grid: { color: "rgba(255,255,255,.05)" },
          ticks: { color: "#475569", font: { size: 11 } }
        }
      }
    }
  });

  // legend
  const legend = document.getElementById("prog-legend");
  legend.innerHTML = players.map(name => `
    <div class="flex items-center gap-1.5 text-xs font-semibold">
      <div style="width:12px;height:12px;border-radius:3px;background:${colors[name]}"></div>
      <span>${name}</span>
    </div>`).join("");

  // mini cards — show current total + last day delta
  const cardsEl = document.getElementById("prog-cards");
  const maxTotal = Math.max(...D.standings.map(s => s.total), 1);
  const progDates = prog.dates || [];
  const lastDate  = progDates.at(-1) || null;
  // Índices de los partidos disputados en la última jornada (misma fecha)
  const lastDayIdx = lastDate
    ? progDates.map((d, i) => d === lastDate ? i : -1).filter(i => i >= 0)
    : [];
  cardsEl.innerHTML = D.standings.map(p => {
    const series = prog.players?.[p.name] || [];
    const last   = series.at(-1) || 0;
    const prev   = series.length > 1 ? series.at(-2) : 0;
    const dayArr = prog.day_points?.[p.name] || [];
    const matchDelta = dayArr.at(-1) || 0;                       // último partido
    const dayDelta   = lastDayIdx.reduce((s, i) => s + (dayArr[i] || 0), 0); // último día
    const dayFmt     = Math.round(dayDelta * 10) / 10;
    const pct  = Math.round((last / maxTotal) * 100);
    const matchesPl = p.played || 0;
    const avg = matchesPl > 0 ? (p.groups / matchesPl).toFixed(1) : "—";
    const deltaCls = v => v > 0 ? "color:var(--green)" : "color:#64748B";
    return `
      <div class="card p-4 text-center">
        <div class="text-xs text-gray-400 uppercase font-bold tracking-wider mb-2">${p.name}</div>
        <div class="bebas text-3xl" style="color:${p.color}">${last}</div>
        <div class="text-xs text-gray-500 mb-1">acumulado</div>
        <div class="prog-deltas mb-2">
          <div class="text-xs font-bold" style="${deltaCls(matchDelta)}">+${matchDelta} último partido</div>
          <div class="text-xs font-bold" style="${deltaCls(dayDelta)}">+${dayFmt} último día</div>
        </div>
        <div class="score-bar-wrap mb-2">
          <div class="score-bar" style="background:${p.color};width:${pct}%"></div>
        </div>
        <div class="text-xs text-gray-400">~${avg} pts/partido</div>
      </div>`;
  }).join("");
}

/* ─── MATCHES ─── */
function renderMatches(phase, week) {
  const list = document.getElementById("matches-list");
  let filtered = phase === "all" ? D.matches : D.matches.filter(m => m.phase === phase);

  // week filter (only applies when date_es is set)
  if (week && week !== "all") {
    const wk = (D.meta.weeks || []).find(w => w.id === week);
    if (wk) {
      filtered = filtered.filter(m => m.date && m.date >= wk.from && m.date <= wk.to);
    }
  }

  const teamMode = !!selectedTeamFilter;
  if (teamMode) {
    filtered = filtered.filter(m =>
      m.home === selectedTeamFilter.name || m.away === selectedTeamFilter.name
    );
  }

  if (filtered.length === 0) {
    const msg = teamMode
      ? `Sin partidos de ${selectedTeamFilter.flag} ${selectedTeamFilter.name} en este filtro`
      : "Sin partidos en este filtro";
    list.innerHTML = `<div class="card p-8 text-center text-gray-500">${msg}</div>`;
    return;
  }

  const players = D.meta.players;
  const colors  = D.meta.colors;

  // group by day (Spain date) — sin fecha al final
  const NO_DATE = "Sin fecha";
  const byDay = {};
  filtered.forEach(m => {
    const hasDate = m.date && m.date.length >= 10;
    const key = hasDate ? (m.day_label || m.date) : NO_DATE;
    if (!byDay[key]) byDay[key] = [];
    byDay[key].push(m);
  });

  // ordenar días: más antiguos arriba, sin fecha abajo del todo
  const dayKeys = Object.keys(byDay).sort((a, b) => {
    const da = byDay[a][0]?.date || "";
    const db = byDay[b][0]?.date || "";
    const aNoDate = a === NO_DATE || !da;
    const bNoDate = b === NO_DATE || !db;
    if (aNoDate && bNoDate) return 0;
    if (aNoDate) return 1;
    if (bNoDate) return -1;
    return da.localeCompare(db);
  });

  const today = todaySpainISO();
  const anchor = matchesAnchorISO();
  const visibleStart = addDaysISO(anchor, -1 - matchesDaysBefore);
  const visibleEnd   = addDaysISO(anchor,  1 + matchesDaysAfter);

  const dayISO = key => {
    const iso = byDay[key][0]?.date;
    return iso && iso.length >= 10 ? iso : null;
  };

  const datedKeys = dayKeys.filter(k => k !== NO_DATE);
  const filterDates = datedKeys.map(dayISO).filter(Boolean);
  const anchorInFilter = filterDates.length
    ? anchor >= filterDates[0] && anchor <= filterDates[filterDates.length - 1]
    : false;

  let visibleDayKeys, hiddenBefore, hiddenAfter;
  if (teamMode) {
    visibleDayKeys = datedKeys;
    hiddenBefore = [];
    hiddenAfter  = [];
  } else if (anchorInFilter) {
    visibleDayKeys = datedKeys.filter(k => {
      const iso = dayISO(k);
      return iso && iso >= visibleStart && iso <= visibleEnd;
    });
    hiddenBefore = datedKeys.filter(k => dayISO(k) < visibleStart);
    hiddenAfter  = datedKeys.filter(k => dayISO(k) > visibleEnd);
  } else {
    visibleDayKeys = datedKeys;
    hiddenBefore = [];
    hiddenAfter  = [];
  }
  const showNoDate = dayKeys.includes(NO_DATE) && !hiddenBefore.length && !hiddenAfter.length;

  const renderDaySection = dayKey => {
    const dayMatches = [...byDay[dayKey]].sort((a, b) => {
      if (a.time_es && b.time_es) return a.time_es.localeCompare(b.time_es);
      return (a.row || 0) - (b.row || 0);
    });
    const count = dayMatches.length;
    const playedInDay = dayMatches.filter(m => m.played).length;
    const isoDate = dayMatches[0]?.date || "sin-fecha";
    const dayId = isoDate === "sin-fecha" ? "day-sin-fecha" : `day-${isoDate}`;
    const isToday = isoDate === today;
    const todayCls = isToday ? " today-header" : "";
    const cards = dayMatches.map(m => renderMatchCard(m, players, colors)).join("");

    return `
      <div class="day-section">
        <div class="day-header${todayCls}" id="${dayId}" data-day-date="${isoDate}" onclick="toggleDay(this)">
          <span class="day-name">${dayKey === NO_DATE ? "Sin fecha" : dayKey}</span>
          <span class="day-count">${count} partido${count!==1?"s":""}${playedInDay ? ` · ${playedInDay} jugado${playedInDay!==1?"s":""}` : ""}</span>
          <span class="day-chevron">▼</span>
        </div>
        <div class="day-matches">
          ${cards}
        </div>
      </div>`;
  };

  const prevKey   = hiddenBefore.length ? hiddenBefore[hiddenBefore.length - 1] : null;
  const nextKey   = hiddenAfter.length ? hiddenAfter[0] : null;
  const prevLabel = prevKey ? (byDay[prevKey][0]?.day_label || prevKey) : "";
  const nextLabel = nextKey ? (byDay[nextKey][0]?.day_label || nextKey) : "";

  const earlierBtn = hiddenBefore.length
    ? `<button type="button" class="matches-load-more matches-load-earlier" onclick="showEarlierMatchDays()">
        <span class="mlm-long">← Ver día anterior · ${prevLabel}</span>
        <span class="mlm-short">← ${shortDayLabel(prevLabel)}</span>
      </button>`
    : "";
  const moreBtn = hiddenAfter.length
    ? `<button type="button" class="matches-load-more" onclick="showMoreMatchDays()">
        <span class="mlm-long">Ver más · ${nextLabel} →</span>
        <span class="mlm-short">Ver más · ${shortDayLabel(nextLabel)} →</span>
      </button>`
    : "";

  const daySections = visibleDayKeys.map(renderDaySection).join("");
  const noDateSection = showNoDate ? renderDaySection(NO_DATE) : "";

  const teamBanner = teamMode
    ? `<div class="team-filter-banner">
        <span class="tfb-text">Mostrando <strong>${selectedTeamFilter.flag} ${selectedTeamFilter.name}</strong> · ${filtered.length} partido${filtered.length !== 1 ? "s" : ""}</span>
        <button type="button" class="tfb-clear" onclick="clearTeamFilter()" aria-label="Quitar filtro de equipo">✕ Quitar</button>
      </div>`
    : "";

  list.innerHTML = teamBanner + earlierBtn + daySections + noDateSection + moreBtn;

  if (scrollMatchesToToday && !document.getElementById("tab-matches").classList.contains("hidden")) {
    scrollMatchesToToday = false;
    requestAnimationFrame(() => setTimeout(scrollToTodayInMatches, 120));
  }
}

function toggleDay(header) {
  const isCollapsed = header.classList.toggle("collapsed");
  const matches = header.nextElementSibling;
  if (matches) matches.classList.toggle("collapsed", isCollapsed);
}

function renderMatchCard(m, players, colors) {
  const isLiveMatch = !m.played && ((m.live === true) || (_liveMatchIds && _liveMatchIds.has(m.name)));
  const hasLiveScoreCard = !m.played && m.live && m.live_goals_l != null && m.live_goals_v != null;
  const playedClass = m.played ? "played" : "";
  const liveClass = isLiveMatch ? " live-match" : "";
  const isNextMatch = !m.played && !isLiveMatch && _nextMatchId && (m.id === _nextMatchId || m.name === _nextMatchId);

  const playerCards = players.map(name => {
    const pd = m.predictions[name];
    if (!pd || !pd.pred) {
      return `<div class="player-pred-card opacity-40 pp-trigger" data-player="${(name||"").replace(/"/g,"&quot;")}">
        <div class="pname" style="color:${colors[name]}">${name}</div>
        <span class="text-xs text-gray-600">—</span>
      </div>`;
    }
    const lb = (isLiveMatch && pd.live_breakdown) ? pd.live_breakdown : null;
    let badgeClass = "badge-pending";
    if (m.played) {
      if (pd.score > 0) {
        const isExact = m.result && pd.pred.score === m.result.score;
        badgeClass = isExact ? "badge-exact" : "badge-sign";
      } else {
        badgeClass = "badge-miss";
      }
    } else if (lb) {
      badgeClass = lb.total > 0 ? (lb.exact > 0 ? "badge-exact" : "badge-sign") : "badge-miss";
    }
    const predTxt = pd.pred.score || pd.pred.sign;
    const fmt = v => Math.round(v * 10) / 10;  // 2.0→2, 1.0→1, 3.0→3

    let brkHtml = "";
    if (m.played && pd.breakdown) {
      const b = pd.breakdown;
      const chips = [
        { label: "1X2",       ok: b.sign  > 0, pts: fmt(b.sign)  },
        { label: "Dif. goles", ok: b.diff  > 0, pts: fmt(b.diff)  },
        { label: "Exacto",    ok: b.exact > 0, pts: fmt(b.exact) },
      ];
      brkHtml = `<div class="mt-1 flex flex-wrap justify-center gap-0.5">
        ${chips.map(c =>
          `<span class="brk-chip ${c.ok ? "ok" : "miss"}">${c.label} ${c.ok ? "✓" : "✗"}${c.ok ? ` (+${c.pts})` : ""}</span>`
        ).join("")}
      </div>`;
    } else if (m.played && pd.score === 0) {
      brkHtml = `<div class="mt-1 flex flex-wrap justify-center gap-0.5">
        <span class="brk-chip miss">1X2 ✗</span>
        <span class="brk-chip miss">Dif. goles ✗</span>
        <span class="brk-chip miss">Exacto ✗</span>
      </div>`;
    } else if (lb) {
      const chips = [
        { label: "1X2",       ok: lb.sign  > 0, pts: fmt(lb.sign)  },
        { label: "Dif. goles", ok: lb.diff  > 0, pts: fmt(lb.diff)  },
        { label: "Exacto",    ok: lb.exact > 0, pts: fmt(lb.exact) },
      ];
      brkHtml = `<div class="mt-1 flex flex-wrap justify-center gap-0.5 brk-prov">
        ${chips.map(c =>
          `<span class="brk-chip ${c.ok ? "ok" : "miss"}">${c.label} ${c.ok ? "✓" : "✗"}${c.ok ? ` (+${c.pts})` : ""}</span>`
        ).join("")}
      </div>`;
    }

    let scoreHtml = "";
    if (m.played) {
      scoreHtml = `<span class="text-base font-extrabold" style="color:${pd.score > 0 ? colors[name] : '#EF4444'}">${pd.score > 0 ? "+"+Math.round(pd.score) : "✗"}</span>`;
    } else if (lb) {
      scoreHtml = `<span class="text-base font-extrabold live-prov-score" style="color:${lb.total > 0 ? colors[name] : '#EF4444'}">${lb.total > 0 ? "+"+fmt(lb.total) : "✗"}<span class="prov-tag">prov.</span></span>`;
    }

    return `<div class="player-pred-card pp-trigger" data-player="${(name||"").replace(/"/g,"&quot;")}">
      <div class="ppc-top">
        <div class="pname" style="color:${colors[name]}">${name}</div>
        <div class="ppc-score">
          <span class="${badgeClass} px-2 py-0.5 rounded text-xs font-mono">${predTxt}</span>
          ${scoreHtml}
        </div>
      </div>
      <div class="ppc-chips">${brkHtml}</div>
    </div>`;
  }).join("");

  return `
    <div class="card match-row ${playedClass}${liveClass}${isNextMatch ? " next-match" : ""} p-4 mb-2" data-match-name="${(m.name||"").replace(/"/g,"&quot;")}">
      <div class="card-corner-tags">
        ${isNextMatch ? `<div class="card-corner-tag"><span class="text-xs font-bold next-match-tag">⏱ Próximo partido</span></div>` : (m.played ? `<div class="card-corner-tag"><span class="text-xs font-bold finished-tag">✓ Finalizado</span></div>` : "<div></div>")}
        <div class="card-corner-tag-right">${(() => {
          if (m.phase === "groups" && m.id) {
            const grp = m.id.charAt(0).toUpperCase();
            return `<span class="text-xs font-bold phase-corner-tag phase-corner-tag--group grp-badge-btn" data-group="${grp}" title="Ver Grupo ${grp}">Grupo ${grp}</span>`;
          }
          const lbl = PHASE_LABELS[m.phase] || m.phase || "";
          return lbl ? `<span class="text-xs font-bold phase-corner-tag">${lbl}</span>` : "";
        })()}</div>
      </div>
      ${matchTeamsHtml(m)}
      ${matchMetaHtml(m)}
      ${(isLiveMatch && !hasLiveScoreCard) ? `<div class="match-live-row"><span class="text-xs font-bold live-tag"><span class="live-ball">⚽</span> En Curso</span></div>` : ""}
      <div class="match-players-grid porra-only">${playerCards}</div>
    </div>`;
}

/* ═══════════════════════════════════════════════════════════════
   PLAYER INFO POPOVER (Partidos)
═══════════════════════════════════════════════════════════════ */

function _playerPopHtml(name) {
  const ps = D && D.player_strengths;
  const p = ps && ps.players ? ps.players.find(x => x.name === name) : null;
  const color = (D && D.meta && D.meta.colors && D.meta.colors[name]) || (p && p.color) || "#94A3B8";
  if (!p) {
    return `<div class="ppop-head"><span class="ppop-name" style="color:${color}">${name}</span></div>
      <p class="text-xs text-gray-500 mt-1">Sin datos todavía.</p>`;
  }
  const badges = (p.badges || []).map(b => `<span class="strength-badge">${b.icon} ${b.label}</span>`).join("");
  const maxRank = (D.meta.players || []).length || 1;
  const skills = (p.top_skills || []).map(sk => {
    const rc = sk.rank === 1 ? "skill-rank-1" : sk.rank === 2 ? "skill-rank-2" : sk.rank === 3 ? "skill-rank-3" : "skill-rank-n";
    const pct = Math.round((1 - (sk.rank - 1) / Math.max(maxRank - 1, 1)) * 100);
    return `<div class="skill-rank-row">
      <span class="skill-rank-num ${rc}">${sk.rank}</span>
      <div class="flex-1 min-w-0">
        <div class="flex justify-between gap-2">
          <span class="text-gray-200 font-semibold truncate">${sk.icon} ${sk.label}</span>
          <span class="text-xs text-gray-500 shrink-0">${sk.display}</span>
        </div>
        <div class="skill-bar-wrap mt-1"><div class="skill-bar" style="width:${pct}%;background:${color}"></div></div>
      </div>
    </div>`;
  }).join("");
  const s = p.stats || {};
  const grid = p.matches_played > 0 ? `
    <div class="ppop-grid">
      <div><div class="ppop-g-lbl">1X2</div><div class="ppop-g-val" style="color:${color}">${s.hits_1x2}/${p.matches_played}</div></div>
      <div><div class="ppop-g-lbl">Dif.</div><div class="ppop-g-val" style="color:${color}">${s.hits_diff}/${p.matches_played}</div></div>
      <div><div class="ppop-g-lbl">Exactos</div><div class="ppop-g-val" style="color:${color}">${s.hits_exact}/${p.matches_played}</div></div>
    </div>` : `<p class="text-xs text-gray-600 mt-2">Sin partidos jugados aún</p>`;
  const best = p.best_phase ? `<p class="ppop-best">Más puntos en: <strong>${p.best_phase.label}</strong> (${p.best_phase.pts} pts)</p>` : "";
  return `
    <div class="ppop-head">
      <span class="ppop-name" style="color:${color}">${name}</span>
      <span class="ppop-pos">#${p.pos}</span>
    </div>
    ${badges ? `<div class="ppop-badges">${badges}</div>` : ""}
    <p class="ppop-section">Top habilidades</p>
    ${skills || `<p class="text-xs text-gray-600">Aún sin datos suficientes</p>`}
    ${grid}
    ${best}`;
}



/* ═══════════════════════════════════════════════════════════════
   MATCH DETAIL PANEL
═══════════════════════════════════════════════════════════════ */

let _detailMap = null;
let _detailMarker = null;
let _wcGamesCache = null;
let _wcGamesLoading = false;

const _wikiImgCache = {};

async function fetchStadiumImage(wikiTitle) {
  if (!wikiTitle) return null;
  if (_wikiImgCache[wikiTitle] !== undefined) return _wikiImgCache[wikiTitle];
  try {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${wikiTitle}`;
    const res = await fetch(url, { cache: "force-cache" });
    if (!res.ok) { _wikiImgCache[wikiTitle] = null; return null; }
    const data = await res.json();
    const img = data.originalimage?.source || data.thumbnail?.source || null;
    _wikiImgCache[wikiTitle] = img;
    return img;
  } catch (e) {
    _wikiImgCache[wikiTitle] = null;
    return null;
  }
}

async function fetchWcGames() {
  if (_wcGamesCache) return _wcGamesCache;
  if (_wcGamesLoading) {
    // wait for pending request
    await new Promise(r => setTimeout(r, 600));
    return _wcGamesCache;
  }
  _wcGamesLoading = true;
  try {
    const res = await fetch("/api/wc_games");
    if (res.ok) _wcGamesCache = await res.json();
  } catch (e) {
    console.warn("wc_games fetch failed:", e);
  }
  _wcGamesLoading = false;
  return _wcGamesCache || [];
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseScorers(str) {
  if (!str || str === "null" || str === "{}" || str === "{}") return [];
  // Format: {"J. Quiñones 9'","R. Jiménez 67'"}
  const inner = str.replace(/^\{/, "").replace(/\}$/, "");
  if (!inner.trim()) return [];
  return inner.split('","')
    .map(s => s.replace(/^"/, "").replace(/"$/, "").trim())
    .filter(s => s && s !== "null");
}

function openMatchDetail(matchName) {
  if (!D) return;
  const m = D.matches.find(x => x.name === matchName);
  if (!m) return;

  const drawer = document.getElementById("match-detail-drawer");
  const overlay = document.getElementById("panel-overlay");
  const titleEl = document.getElementById("panel-match-title");
  const body = document.getElementById("panel-body");

  // Title
  const home = m.home || matchName.split("-")[0]?.trim() || matchName;
  const away = m.away || matchName.split("-").slice(1).join("-")?.trim() || "";
  titleEl.innerHTML = `<span>${m.flag_home||"🏳️"}</span> <span style="margin:0 .3rem">${home}</span> <span style="color:#64748B">vs</span> <span style="margin:0 .3rem">${away}</span> <span>${m.flag_away||"🏳️"}</span>`;

  // Show skeleton while loading
  body.innerHTML = `<div class="panel-section"><div class="panel-section-title">Cargando datos…</div><div style="height:40px;display:flex;align-items:center;justify-content:center"><div class="spinner" style="width:24px;height:24px;border-width:3px"></div></div></div>`;

  drawer.classList.add("open");
  drawer.setAttribute("aria-hidden", "false");
  overlay.classList.add("open");
  document.body.style.overflow = "hidden";

  // Async fill with real content
  _fillMatchDetail(m, body);
}

async function _fillMatchDetail(m, body) {
  // Fetch live games and Wikipedia image in parallel
  const [games, wikiImg] = await Promise.all([
    fetchWcGames(),
    m.wiki ? fetchStadiumImage(m.wiki) : Promise.resolve(null),
  ]);

  // Find matching game by team names (API uses English, Excel uses Spanish)
  const game = (games || []).find(g => {
    const hEsp = EN_TO_ESP_TEAM[g.home_team_name_en] || g.home_team_name_en;
    const aEsp = EN_TO_ESP_TEAM[g.away_team_name_en] || g.away_team_name_en;
    return (hEsp === m.home || g.home_team_name_en === m.home) &&
           (aEsp === m.away || g.away_team_name_en === m.away);
  });

  let html = "";

  // ── Venue ────────────────────────────────────────────────────────────────
  if (m.stadium || m.city) {
    html += `<div class="panel-section">
      <div class="panel-section-title">🏟️ Sede del partido</div>`;

    // Stadium photo from Wikipedia (if available)
    if (wikiImg) {
      html += `<div class="stadium-photo-wrap">
        <img src="${escapeHtml(wikiImg)}" alt="${escapeHtml(m.stadium)}" class="stadium-photo" loading="lazy"
             onerror="this.parentElement.style.display='none'">
        <div class="stadium-photo-caption">${escapeHtml(m.stadium)}</div>
      </div>`;
    }

    // Map placeholder — Leaflet will attach here after animation
    if (m.lat && m.lon) {
      html += `<div id="panel-map"></div>`;
    }

    // Stats grid
    html += `<div class="venue-grid">`;
    if (m.stadium) {
      html += `<div class="venue-stat"><div class="venue-stat-label">Estadio</div><div class="venue-stat-value">${m.stadium}</div></div>`;
    }
    if (m.city) {
      html += `<div class="venue-stat"><div class="venue-stat-label">Ciudad</div><div class="venue-stat-value">${m.city}, ${m.country}</div></div>`;
    }
    if (m.capacity) {
      html += `<div class="venue-stat"><div class="venue-stat-label">Aforo</div><div class="venue-stat-value">${m.capacity.toLocaleString("es-ES")} espect.</div></div>`;
    }
    if (m.city_pop) {
      html += `<div class="venue-stat"><div class="venue-stat-label">Área metropolitana</div><div class="venue-stat-value">${m.city_pop}</div></div>`;
    }
    html += `</div>`;

    if (m.venue_fact) {
      html += `<div class="venue-fact-text">💡 ${m.venue_fact}</div>`;
    }
    html += `</div>`;
  }

  // ── Key players ──────────────────────────────────────────────────────────
  const home = m.home || "";
  const away = m.away || "";
  const homeCode = TEAM_TO_FIFA[home] || TEAM_TO_FIFA[home.trim()];
  const awayCode = TEAM_TO_FIFA[away] || TEAM_TO_FIFA[away.trim()];
  const homePlayers = homeCode ? (KEY_PLAYERS[homeCode] || []) : [];
  const awayPlayers = awayCode ? (KEY_PLAYERS[awayCode] || []) : [];

  if (homePlayers.length || awayPlayers.length) {
    const renderTeamCol = (flag, teamName, players) => {
      if (!players.length) return `<div class="kp-team-col"><div class="kp-team-name">${flag} ${teamName}</div><p class="kp-no-data">Sin datos</p></div>`;
      const playerItems = players.slice(0, 4).map(p => `
        <div class="kp-player">
          <div class="kp-player-name">${p.name}</div>
          <div class="kp-player-meta">
            <span class="kp-pos-badge">${p.pos}</span>
            <span>${p.club}</span>
          </div>
          ${p.note ? `<div class="kp-player-note">${p.note}</div>` : ""}
        </div>`).join("");
      return `<div class="kp-team-col">
        <div class="kp-team-name">${flag} ${teamName}</div>
        ${playerItems}
      </div>`;
    };

    html += `<div class="panel-section">
      <div class="panel-section-title">⭐ Jugadores a seguir</div>
      <div class="kp-teams">
        ${renderTeamCol(m.flag_home||"🏳️", home, homePlayers)}
        ${renderTeamCol(m.flag_away||"🏳️", away, awayPlayers)}
      </div>
    </div>`;
  }

  if (!html) {
    html = `<div class="panel-section"><p class="text-sm text-gray-500">Sin información adicional disponible para este partido.</p></div>`;
  }

  body.innerHTML = html;

  // ── Init Leaflet map ──────────────────────────────────────────────────────
  // Delay until AFTER the drawer slide-in animation (280ms) + a small buffer
  if (m.lat && m.lon) {
    setTimeout(() => _initMapInPanel(m), 340);
  }
}

function _initMapInPanel(m) {
  if (typeof L === "undefined") {
    console.warn("Leaflet not loaded");
    const el = document.getElementById("panel-map");
    if (el) el.innerHTML = `<div style="height:200px;display:flex;align-items:center;justify-content:center;color:#475569;font-size:.8rem">Mapa no disponible (sin conexión)</div>`;
    return;
  }
  const mapEl = document.getElementById("panel-map");
  if (!mapEl) return;

  try {
    // Destroy previous instance if any
    if (_detailMap) {
      _detailMap.remove();
      _detailMap = null;
      _detailMarker = null;
    }

    _detailMap = L.map("panel-map", {
      zoomControl: true,
      attributionControl: false,
      dragging: true,
      tap: false,       // avoids double-tap issues on iOS
    }).setView([m.lat, m.lon], 13);

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      subdomains: "abcd",
      maxZoom: 19,
    }).addTo(_detailMap);

    const stadiumIcon = L.divIcon({
      className: "",
      html: `<div class="map-stadium-marker">🏟️</div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 16],
      popupAnchor: [0, -18],
    });

    _detailMarker = L.marker([m.lat, m.lon], { icon: stadiumIcon }).addTo(_detailMap);
    if (m.stadium) {
      _detailMarker.bindPopup(
        `<b style="color:#E2E8F0;font-size:.9rem">${m.stadium}</b>` +
        `<br><span style="color:#94A3B8;font-size:.75rem">📍 ${m.city}, ${m.country}</span>` +
        (m.capacity ? `<br><span style="color:#64748B;font-size:.7rem">Aforo: ${m.capacity.toLocaleString("es-ES")}</span>` : "")
      ).openPopup();
    }

    // Force two reflows to handle the slide animation correctly
    setTimeout(() => { _detailMap && _detailMap.invalidateSize(true); }, 80);
    setTimeout(() => { _detailMap && _detailMap.invalidateSize(true); }, 250);
  } catch (e) {
    console.warn("Leaflet init error:", e);
  }
}

function closeMatchDetail() {
  const drawer = document.getElementById("match-detail-drawer");
  const overlay = document.getElementById("panel-overlay");
  drawer.classList.remove("open");
  drawer.setAttribute("aria-hidden", "true");
  overlay.classList.remove("open");
  document.body.style.overflow = "";
  // clean up map to avoid stale instance issues
  if (_detailMap) {
    _detailMap.remove();
    _detailMap = null;
    _detailMarker = null;
  }
}

// Close panel/modales abiertos con la tecla Escape
document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  const grpModal  = document.getElementById("group-modal");
  const teamModal = document.getElementById("team-modal");
  if (grpModal && !grpModal.classList.contains("hidden")) { closeGroupModal(); return; }
  if (teamModal && !teamModal.classList.contains("hidden")) { closeTeamModal(); return; }
  closeMatchDetail();
});

/* ─── PUNTUACIÓN ─── */
function renderScoring() {
  const el = document.getElementById("scoring-content");
  const sr = D.scoring_rules;
  if (!sr) { el.innerHTML = ""; return; }

  const adj = sr.diff_adjustment;
  const adjPct = adj > 0 ? Math.round(adj * 100) : 0;

  const sectionNotes = {
    q16_team: "En la práctica <strong class=\"text-gray-300\">no se puntúa</strong>: antes de la Fase 2 se insertan en el Excel los cruces reales de dieciseisavos.",
    final_team: "Vuestro campeón del Cuadro de Honor se copia a la casilla de la final.",
    r34_team: "Vuestro tercer puesto del Cuadro de Honor se traslada a las casillas correspondientes.",
  };

  const sectionsHtml = sr.sections.map(sec => {
    const rows = sec.items.map(item => {
      const shortLabel = item.label
        .replace(/^FASE DE GRUPOS – /, "")
        .replace(/^DIECISEISAVOS – /, "")
        .replace(/^OCTAVOS – ?/, "")
        .replace(/^CUARTOS – ?/, "")
        .replace(/^SEMIFINALES – ?/, "")
        .replace(/^3ºy4º PUESTO – /, "")
        .replace(/^FINAL – /, "");
      return `<div class="score-rule-row">
        <span class="text-sm text-gray-300 flex-1">${shortLabel}</span>
        <span class="score-pts-badge">${item.pts} pts</span>
      </div>`;
    }).join("");
    const maxInSection = sec.items.reduce((s, i) => s + i.pts, 0);
    const note = sectionNotes[sec.key]
      ? `<p class="scoring-callout mt-3 mb-0">${sectionNotes[sec.key]}</p>` : "";
    return `<div class="card p-5">
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-bold text-white">${sec.title}</h3>
        ${sec.items.length > 1 ? `<span class="text-xs text-gray-500">máx. ${maxInSection} pts</span>` : ""}
      </div>
      ${rows}
      ${note}
    </div>`;
  }).join("");

  el.innerHTML = `
    <div class="card p-5 mb-5">
      <h2 class="text-lg font-bold text-white mb-2">Sistema de puntuación — Los Nanos</h2>
      <p class="text-sm text-gray-400 mb-3">
        Valores configurados en nuestro Excel. Basado en el sistema
        <a href="https://matejero.es/puntuaciones-excel-mundial-2026/" target="_blank" rel="noopener"
           class="text-blue-400 hover:text-yellow-400">Matejero Excel Mundial 2026</a>.
      </p>
      <div class="grid grid-cols-1 md:grid-cols-1 gap-3 text-sm max-w-xs">
        <div class="rounded-lg p-3" style="background:var(--card2)">
          <div class="text-xs text-gray-500 uppercase font-bold mb-1">Máx. por partido (grupos)</div>
          <div class="bebas text-2xl text-yellow-400">${sr.max_per_group_match} pts</div>
          <div class="text-xs text-gray-500 mt-1">1X2 + Diferencia + Exacto</div>
        </div>
      </div>
    </div>

    <div class="card p-5 mb-5">
      <h3 class="font-bold text-white mb-3">📝 Cómo rellenar la porra (Excel)</h3>
      <p class="text-sm text-gray-400 mb-3 leading-relaxed">
        Todo se rellena en la pestaña <strong class="text-gray-200">WORLDCUP</strong> del Excel que os enviamos:
        ahí van los pronósticos (resultados de cada partido). Antes de empezar, mirad el vídeo explicativo:
        <a href="https://www.youtube.com/watch?v=Vh--XEkQDFg" target="_blank" rel="noopener"
           class="text-blue-400 hover:text-yellow-400">📺 Tutorial en YouTube</a>.
      </p>
      <p class="text-sm text-gray-400 mb-4 leading-relaxed">
        Para que nadie se quede sin opciones si fallan sus equipos en un cruce, la porra se entrega en
        <strong class="text-gray-200">dos fases</strong>. Enviad cada fase respondiendo al correo de la porra.
      </p>

      <div class="scoring-phase">
        <p class="text-sm font-bold text-white mb-1">Fase 1 — Grupos y Cuadro de Honor</p>
        <p class="text-sm text-gray-400 leading-relaxed">
          Rellenad todos los resultados de la fase de grupos (partidos hasta el grupo L, inclusive).
          La fase de grupos en el torneo termina en la madrugada del <strong class="text-gray-200">domingo 28 de junio</strong>
          con el último partido: <strong class="text-gray-200">Jordania vs. Argentina</strong> a las <strong class="text-gray-200">04:00</strong> (hora peninsular).
        </p>
        <p class="text-sm text-gray-400 mt-2 leading-relaxed">
          <strong class="text-gray-200">Importante:</strong> en esta primera entrega también debéis rellenar el
          <strong class="text-gray-200">Cuadro de Honor</strong> del final del Excel (campeón, podio, botas, balones…).
        </p>
      </div>

      <div class="scoring-phase">
        <p class="text-sm font-bold text-white mb-1">Fase 2 — Fase final (eliminatorias)</p>
        <p class="text-sm text-gray-400 leading-relaxed">
          Cuando acabe el último partido de grupos (madrugada del 28), rellenad y enviad de nuevo el Excel con la
          fase final completa: desde <strong class="text-gray-200">dieciseisavos</strong> hasta la <strong class="text-gray-200">final</strong>.
          El primer partido de dieciseisavos es ese mismo domingo <strong class="text-gray-200">28 de junio a las 21:00</strong>.
        </p>
      </div>

      <div class="scoring-deadline mt-4">
        <p class="text-sm font-bold text-yellow-400 mb-2">🚨 Fechas límite de entrega</p>
        <ul class="text-sm text-gray-300 list-none pl-0">
          <li><strong class="text-white">Fase 1:</strong> domingo <strong class="text-yellow-400">7 de junio</strong> a las <strong class="text-yellow-400">23:55</strong> — grupos + Cuadro de Honor.</li>
          <li><strong class="text-white">Fase 2:</strong> domingo <strong class="text-yellow-400">28 de junio</strong> antes de las <strong class="text-yellow-400">19:00</strong> — eliminatorias completas.</li>
        </ul>
      </div>
    </div>

    <div class="card p-5 mb-5">
      <h3 class="font-bold text-white mb-3">🏟️ Fase final: reglas especiales de puntuación</h3>
      <div class="scoring-callout mb-3">
        <strong class="text-gray-200">Clasificados a dieciseisavos — no se puntúa lo que hayáis puesto en la Fase 1.</strong><br>
        En el Excel Matejero aparece la fila «Equipo clasificado para dieciseisavos», pero en nuestra porra
        <strong class="text-gray-200">no cuenta</strong>: no vais a competir por acertar quién llega a dieciseisavos.
      </div>
      <p class="text-sm text-gray-400 mb-3 leading-relaxed">
        El <strong class="text-gray-200">domingo 28 de junio antes de las 19:00</strong>, cuando enviéis la Fase 2,
        en el Excel maestro se insertarán automáticamente en el de cada uno los
        <strong class="text-gray-200">cruces reales de dieciseisavos</strong> (los 16 equipos que hayan quedado).
        A partir de ahí vosotros rellenáis:
      </p>
      <ul class="text-sm text-gray-400 mb-3 pl-5 leading-relaxed" style="list-style:disc">
        <li>Los <strong class="text-gray-200">resultados</strong> de los partidos de dieciseisavos.</li>
        <li>Los <strong class="text-gray-200">cruces y equipos</strong> de octavos, cuartos, semifinales y final.</li>
        <li>Se copiará también vuestro <strong class="text-gray-200">campeón</strong> y <strong class="text-gray-200">tercer puesto</strong> del Cuadro de Honor a las casillas de la fase final.</li>
      </ul>
      <p class="text-xs text-gray-500">
        A partir de dieciseisavos sí puntúan los partidos y clasificados de cada ronda según las reglas de abajo
        (1X2, diferencia, exacto, equipos que pasan de fase…).
      </p>
    </div>

    <div class="card p-5 mb-5">
      <h3 class="font-bold text-white mb-3">¿Cómo se puntúa un partido?</h3>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
        <div class="rounded-lg p-4 border" style="border-color:var(--border)">
          <div class="font-bold text-blue-400 mb-1">1️⃣ Signo 1X2</div>
          <p class="text-gray-400 text-xs">Acertar si gana el local (1), empatan (X) o gana el visitante (2).</p>
        </div>
        <div class="rounded-lg p-4 border" style="border-color:var(--border)">
          <div class="font-bold text-green-400 mb-1">2️⃣ Diferencia de goles</div>
          <p class="text-gray-400 text-xs">Solo si acertaste el 1X2. Premia acertar cuántos goles separan a los equipos.</p>
        </div>
        <div class="rounded-lg p-4 border" style="border-color:var(--border)">
          <div class="font-bold text-yellow-400 mb-1">3️⃣ Resultado exacto</div>
          <p class="text-gray-400 text-xs">Acertar el marcador exacto (ej. 2-0). Se suma además del 1X2 y la diferencia.</p>
        </div>
      </div>
      <p class="text-xs text-gray-500 mt-3">
        En eliminatorias con empate al 90′ cuenta el resultado del minuto 120′.
        Los criterios de «Equipo clasificado para…» suman si acertaste qué equipo pasa, independientemente del partido concreto.
      </p>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">${sectionsHtml}</div>
  `;
}

/* ─── CUADRO DE HONOR ─── */
const HONOR_CATEGORIES = {
  podium:  { title: "🏆 Podio del torneo",     desc: "Campeón, subcampeón y tercer puesto" },
  scorers: { title: "⚽ Máximos goleadores",   desc: "Bota de Oro, Plata y Bronce" },
  players: { title: "🌟 Mejores jugadores",    desc: "Balón de Oro, Plata y Bronce" },
};

function renderHonor() {
  const summaryEl = document.getElementById("honor-summary");
  const sectionsEl = document.getElementById("honor-sections");
  const hs = D.honor_summary || {};
  const items = D.honor || [];

  // Resumen superior
  summaryEl.innerHTML = `
    <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
      <div>
        <h2 class="text-lg font-bold text-white">Cuadro de Honor</h2>
        <p class="text-xs text-gray-400 mt-1">
          ${hs.resolved || 0}/${hs.total_items || 9} categorías resueltas ·
          máximo ${hs.max_total_pts || 135} pts en total por jugador
        </p>
      </div>
      <div class="flex gap-2 text-xs">
        <span class="px-2 py-1 rounded badge-exact">${hs.resolved || 0} resueltas</span>
        <span class="px-2 py-1 rounded badge-pending">${hs.pending || 9} pendientes</span>
      </div>
    </div>
    <p class="text-xs text-gray-500 uppercase font-bold mb-2">Puntos en honor (clasificación)</p>
    <div class="honor-summary-grid">
      ${(hs.by_player || []).map(p => `
        <div class="honor-player-chip" style="border-color:${p.color}44">
          <div class="font-extrabold text-sm uppercase" style="color:${p.color}">${p.name}</div>
          <div class="bebas text-2xl text-white mt-1">${p.honor_pts || 0}</div>
          <div class="text-xs text-gray-500">pts honor</div>
          <div class="text-xs text-gray-600 mt-1">${p.correct || 0} aciertos · ${p.filled || 0}/9 pronósticos</div>
        </div>`).join("")}
    </div>`;

  // Secciones por categoría
  sectionsEl.innerHTML = Object.entries(HONOR_CATEGORIES).map(([cat, meta]) => {
    const catItems = items.filter(h => h.category === cat);
    if (!catItems.length) return "";

    const cards = catItems.map(h => {
      const statusBadge = h.resolved
        ? `<span class="badge-exact px-2 py-0.5 rounded text-xs font-bold">${h.actual}</span>`
        : `<span class="badge-pending px-2 py-0.5 rounded text-xs">Pendiente</span>`;

      const consensusHtml = !h.resolved && h.consensus
        ? `<div class="honor-consensus mt-2">💬 Apuesta del grupo: <strong class="text-gray-200">${HONOR_PLAYER_FLAGS[h.consensus] ? HONOR_PLAYER_FLAGS[h.consensus] + " " : ""}${h.consensus}</strong> (${h.consensus_count}/${h.filled_count})</div>`
        : "";

      const rows = (h.predictions_list || []).map(p => {
        const icon = h.resolved ? (p.correct ? "✓" : "✗") : "·";
        const iconColor = h.resolved ? (p.correct ? "var(--green)" : "var(--red)") : "#64748B";
        const flag = HONOR_PLAYER_FLAGS[p.pred] ? `${HONOR_PLAYER_FLAGS[p.pred]} ` : "";
        return `<div class="honor-pred-row">
          <span class="font-bold truncate" style="color:${p.color}">${p.name}</span>
          <span class="text-gray-200 truncate text-right">${flag}${p.pred}</span>
          <span class="font-bold shrink-0" style="color:${iconColor}">${icon}${p.score > 0 ? " +" + p.score : ""}</span>
        </div>`;
      }).join("");

      return `<div class="card honor-item-card ${h.resolved ? "resolved" : ""} p-4">
        <div class="flex items-start justify-between gap-2 mb-3">
          <div>
            <h4 class="font-extrabold text-white">${h.title}</h4>
            <p class="text-xs text-gray-500 mt-0.5">Vale hasta ${h.max_pts ? h.max_pts + " pts" : "—"}</p>
          </div>
          ${statusBadge}
        </div>
        ${rows || `<p class="text-xs text-gray-600 italic">Sin pronósticos rellenados</p>`}
        ${consensusHtml}
      </div>`;
    }).join("");

    return `
      <div class="mb-6">
        <h3 class="honor-section-title">${meta.title}</h3>
        <p class="text-xs text-gray-500 mb-3">${meta.desc}</p>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">${cards}</div>
      </div>`;
  }).join("");
}

/* Signo 1X2 ("1"/"X"/"2") a partir de un marcador en texto ("2-0"). */
function _signFromScore(score) {
  const mt = String(score || "").match(/(\d+)\s*-\s*(\d+)/);
  if (!mt) return null;
  const h = +mt[1], a = +mt[2];
  return h > a ? "1" : h < a ? "2" : "X";
}

/* ─── STATS ─── */
function renderStats() {
  const players = D.meta.players;
  const colors  = D.meta.colors;

  const groupMatches = D.matches.filter(m => m.phase === "groups" && m.played);
  const playedAll    = D.matches.filter(m => m.played);

  // ── per-player breakdown (groups) ──────────────────────────────────────
  const perPlayer = players.map(name => {
    let exact = 0, diff = 0, sign = 0, miss = 0, best = 0, streak = 0, curStreak = 0, bestDay = 0;
    groupMatches.forEach(m => {
      const pd = m.predictions[name];
      const sc = pd?.score ?? 0;
      if (sc > best) best = sc;
      const reasons = pd?.breakdown?.reasons || [];
      const hasExact = reasons.some(r => r.toLowerCase().includes("exacto") && !r.toLowerCase().includes("no"));
      const hasDiff  = reasons.some(r => r.includes("Diferencia") && !r.includes("no acertada"));
      const hasSign  = reasons.some(r => r.includes("1X2 correcto"));
      if (hasExact)        exact++;
      else if (hasDiff)    diff++;
      else if (hasSign)    sign++;
      else                 miss++;
      if (sc > 0) { curStreak++; if (curStreak > streak) streak = curStreak; }
      else        { curStreak = 0; }
    });
    // current (active) streak from the end
    let liveStreak = 0;
    for (let i = groupMatches.length - 1; i >= 0; i--) {
      const sc = groupMatches[i].predictions[name]?.score ?? 0;
      if (sc > 0) liveStreak++; else break;
    }
    const hits = exact + diff + sign;
    const total = groupMatches.length;
    const pct   = total > 0 ? Math.round(hits / total * 100) : 0;
    const avg   = total > 0 ? (((D.standings.find(s => s.name === name)?.groups) || 0) / total).toFixed(2) : "—";
    return { name, exact, diff, sign, miss, hits, total, pct, avg, best, streak: liveStreak, maxStreak: streak };
  });

  // ── HERO numbers ───────────────────────────────────────────────────────
  const heroEl = document.getElementById("stats-hero");
  const totalExacts = perPlayer.reduce((s, p) => s + p.exact, 0);
  const bestPlayer  = [...perPlayer].sort((a,b) => b.pct - a.pct)[0];
  const bestPct     = bestPlayer?.pct ?? -1;
  const bestPlayers = perPlayer.filter(p => p.pct === bestPct);
  const streakKing  = [...perPlayer].sort((a,b) => b.streak - a.streak)[0];
  const topExact    = [...perPlayer].sort((a,b) => b.exact - a.exact)[0];
  const bestSub     = bestPlayers.length > 1 ? bestPlayers.map(p => p.name).join(" · ") + " (empate)" : (bestPlayer?.name || "");
  heroEl.innerHTML = [
    { icon: "⚽", val: groupMatches.length, label: "Partidos jugados (grupos)", sub: (() => { const tot = D.matches.filter(m=>m.phase==="groups").length; const pct = tot > 0 ? Math.round(groupMatches.length / tot * 100) : 0; return `de ${tot} totales · ${pct}% completado`; })(),
      info: "Número de partidos de la <strong>fase de grupos</strong> que ya se han jugado y puntuado, sobre el total de partidos de grupos del Mundial." },
    { icon: "🎯", val: totalExacts, label: "Marcadores exactos clavados", sub: `${perPlayer.reduce((s,p)=>s+p.miss,0)} predicciones falladas (0 pts) · suma de los ${players.length} jugadores`,
      info: "Número total de <strong>marcadores exactos clavados</strong> (resultado idéntico = 6 pts) entre todos los jugadores en la fase de grupos. Cada partido cuenta una vez por jugador, así que este número suma los aciertos de todos los participantes. Debajo: cuántas predicciones se quedaron a <strong>0 puntos</strong> (ni 1X2, ni diferencia, ni exacto), también sumando a todos los jugadores." },
    { icon: "📈", val: bestPlayer ? `${bestPlayer.pct}%` : "—", label: "Mayor tasa de acierto", sub: bestSub,
      info: "Jugador con mayor <strong>tasa de acierto</strong>: porcentaje de partidos de grupos en los que ha sumado al menos 1 punto (acertó el 1X2, la diferencia o el resultado exacto)." },
    { icon: streakKing?.streak > 0 ? "🔥" : "🤦", val: streakKing ? `${streakKing.streak}` : "—", label: "Racha activa más larga", sub: streakKing?.streak > 0 ? `${streakKing.name} · ${streakKing.streak} en racha` : "Nadie acertó en el último partido",
      info: "<strong>Racha activa</strong>: partidos seguidos puntuando (≥1 pt) contando desde el último partido hacia atrás. Se muestra quién tiene la racha viva más larga ahora mismo." },
  ].map(h => `
    <div class="card p-4 text-center" style="position:relative;isolation:isolate">
      <div class="stat-info-corner">${infoTip(h.info, "right")}</div>
      <div class="text-2xl mb-1">${h.icon}</div>
      <div class="bebas text-3xl text-yellow-400">${h.val}</div>
      <div class="text-xs font-bold text-gray-300 mt-1">${h.label}</div>
      <div class="text-xs text-gray-600 mt-0.5">${h.sub}</div>
    </div>`).join("");

  // ── Tasa de acierto (ordenada de mayor a menor, con % encima) ──────────
  if (hitRateChart) hitRateChart.destroy();
  const sortedHR = [...perPlayer].sort((a, b) => b.pct - a.pct);
  // Actualizar el contador de partidos en el título
  const hrCount = document.getElementById("hr-count");
  if (hrCount) hrCount.textContent = `(${groupMatches.length} partido${groupMatches.length !== 1 ? "s" : ""})`;
  hitRateChart = new Chart(document.getElementById("hitRateChart").getContext("2d"), {
    type: "bar",
    data: {
      labels: sortedHR.map(h => h.name),
      datasets: [{
        label: "Partidos con ≥1 pt",
        data: sortedHR.map(h => h.pct),
        backgroundColor: sortedHR.map(h => colors[h.name] + "99"),
        borderColor: sortedHR.map(h => colors[h.name]),
        borderWidth: 2, borderRadius: 6,
      }]
    },
    plugins: [{
      id: "pctLabels",
      afterDatasetsDraw(chart) {
        const { ctx, data } = chart;
        chart.getDatasetMeta(0).data.forEach((bar, i) => {
          const val = data.datasets[0].data[i];
          if (val == null) return;
          ctx.save();
          ctx.fillStyle = "#CBD5E1";
          ctx.font = "bold 11px sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "bottom";
          ctx.fillText(val + "%", bar.x, bar.y - 4);
          ctx.restore();
        });
      }
    }],
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: i => ` ${i.parsed.y}% (${sortedHR[i.dataIndex].hits}/${sortedHR[i.dataIndex].total} partidos)` } },
      },
      scales: {
        y: { beginAtZero: true, suggestedMax: Math.max(...sortedHR.map(h => h.pct)) + 8, display: false },
        x: { grid: { display: false }, ticks: { color: "#94A3B8", font: { weight: "bold" } } }
      },
      layout: { padding: { top: 24 } },
    }
  });

  // ── Desglose de aciertos ───────────────────────────────────────────────
  if (breakdownChart) breakdownChart.destroy();
  breakdownChart = new Chart(document.getElementById("breakdownChart").getContext("2d"), {
    type: "bar",
    data: {
      labels: perPlayer.map(p => p.name),
      datasets: [
        { label: "Exacto",     data: perPlayer.map(p => p.exact), backgroundColor: "rgba(34,197,94,.75)",   borderColor: "#22C55E", borderWidth: 1.5, borderRadius: 4 },
        { label: "1X2 + Dif.", data: perPlayer.map(p => p.diff),  backgroundColor: "rgba(59,130,246,.65)",  borderColor: "#3B82F6", borderWidth: 1.5, borderRadius: 4 },
        { label: "Solo 1X2",   data: perPlayer.map(p => p.sign),  backgroundColor: "rgba(249,115,22,.65)",  borderColor: "#F97316", borderWidth: 1.5, borderRadius: 4 },
        { label: "0 pts",      data: perPlayer.map(p => p.miss),  backgroundColor: "rgba(100,116,139,.45)", borderColor: "#64748B", borderWidth: 1.5, borderRadius: 4 },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: "bottom", labels: { color: "#94A3B8", font: { size: 10 }, boxWidth: 12 } },
        tooltip: {
          mode: "index",
          callbacks: {
            title: items => `${items[0].label} — ${groupMatches.length} partidos`,
            label: i => ` ${i.dataset.label}: ${i.parsed.y} partidos`
          }
        }
      },
      scales: {
        x: { stacked: true, grid: { display: false }, ticks: { color: "#94A3B8", font: { weight: "bold" } } },
        y: { stacked: true, grid: { color: "rgba(255,255,255,.05)" }, ticks: { color: "#475569", stepSize: 1 } }
      }
    }
  });

  // ── Ficha por jugador (clara, todo en una tarjeta) ─────────────────────
  const playersInfoEl = document.getElementById("stats-players-info");
  if (playersInfoEl) {
    playersInfoEl.innerHTML = infoTip(
      "<strong>Cómo leer cada ficha:</strong><br>" +
      "• <strong>Puntos totales</strong>: todos los puntos del jugador en el Mundial.<br>" +
      "• <strong>Tasa de acierto</strong>: % de partidos de grupos en los que sumó ≥1 pt.<br>" +
      "• <strong>Pts/partido</strong>: media de puntos por partido de grupos.<br>" +
      "• <strong>Racha activa</strong>: partidos seguidos puntuando ahora mismo.<br>" +
      "• <strong>Exactos</strong>: resultados clavados (6 pts).<br>" +
      "• <strong>Mejor partido</strong>: máximo de puntos logrado en un solo partido.<br>" +
      "• <strong>Últimos partidos</strong>: cada cuadro es un partido reciente (ver leyenda).",
      "left"
    );
  }

  const playersEl = document.getElementById("stats-players");
  playersEl.innerHTML = D.standings.map(p => {
    const pp = perPlayer.find(x => x.name === p.name) || {};
    const last10 = groupMatches.slice(-10);
    const scoreColor = (sc) => sc >= 5 ? "#22C55E" : sc >= 3 ? "#EAB308" : sc >= 1 ? "#F97316" : "#374151";
    const lastBar = last10.length ? `<div class="flex gap-1 mt-1 flex-wrap">
      ${last10.map(m => {
        const sc = m.predictions[p.name]?.score ?? 0;
        const col = scoreColor(sc);
        const lbl = `${m.name}: ${sc} pts`;
        return `<div title="${lbl.replace(/"/g,"&quot;")}" style="width:13px;height:20px;border-radius:3px;background:${col};flex-shrink:0"></div>`;
      }).join("")}
    </div>` : `<div class="text-xs text-gray-600 mt-1">Aún sin partidos</div>`;

    return `
      <div class="card p-5 pstat-card" style="border-color:${p.color}44">
        <div class="pstat-head">
          <div class="pstat-bar" style="background:${p.color}"></div>
          <div>
            <div class="font-extrabold text-white text-lg uppercase">${p.name}</div>
            <div class="text-xs text-gray-400">#${p.pos} en la clasificación general</div>
          </div>
        </div>

        <div class="pstat-grid">
          <div class="pstat-box" style="background:${p.color}18">
            <div class="pstat-num" style="color:${p.color}">${p.total}</div>
            <div class="pstat-lbl">Puntos totales</div>
          </div>
          <div class="pstat-box">
            <div class="pstat-num text-white">${pp.pct ?? 0}%</div>
            <div class="pstat-lbl">Tasa de acierto</div>
          </div>
          <div class="pstat-box">
            <div class="pstat-num text-white">${pp.avg ?? "—"}</div>
            <div class="pstat-lbl">Pts / partido</div>
          </div>
          <div class="pstat-box" style="background:rgba(34,197,94,.10)">
            <div class="pstat-num" style="color:var(--green)">${pp.streak ?? 0}</div>
            <div class="pstat-lbl">Racha activa</div>
          </div>
          <div class="pstat-box" style="background:rgba(245,197,24,.10)">
            <div class="pstat-num" style="color:var(--gold)">${pp.exact ?? 0}</div>
            <div class="pstat-lbl">Exactos (6 pts)</div>
          </div>
          <div class="pstat-box">
            <div class="pstat-num" style="color:${p.color}">${pp.best ?? 0}</div>
            <div class="pstat-lbl">Mejor partido</div>
          </div>
        </div>

        <div class="pstat-last-head">
          <span>Últimos ${last10.length || 10} partidos (grupos)</span>
        </div>
        ${lastBar}
        <div class="pstat-legend">
          <span><i style="background:#22C55E"></i> 5+ pts</span>
          <span><i style="background:#EAB308"></i> 3-4 pts</span>
          <span><i style="background:#F97316"></i> 1-2 pts</span>
          <span><i style="background:#374151"></i> 0 pts</span>
        </div>
      </div>`;
  }).join("");

  // ── Ranking de partidos más acertados ──────────────────────────────────
  const topMatchesEl = document.getElementById("stats-top-matches");
  if (topMatchesEl && playedAll.length) {
    const players = D.meta.players;
    const colors  = D.meta.colors;
    const MAX_PTS = players.length * 6;

    const matchRows = playedAll.map(m => {
      const byPlayer = players.map(name => ({
        name,
        pts: m.predictions?.[name]?.score ?? 0,
      }));
      const totalPts = byPlayer.reduce((s, p) => s + p.pts, 0);
      return { m, byPlayer, totalPts };
    }).sort((a, b) => b.totalPts - a.totalPts);

    const MEDAL = ["🥇", "🥈", "🥉"];
    const ptColor = (pts) => pts >= 5 ? "#22C55E" : pts >= 3 ? "#EAB308" : pts >= 1 ? "#F97316" : "#374151";

    const playerCols = players.map(name =>
      `<th class="text-center" style="color:${colors[name] || '#94A3B8'}">${name}</th>`
    ).join("");

    const rows = matchRows.map((row, i) => {
      const { m, byPlayer, totalPts } = row;
      const pct   = Math.round(totalPts / MAX_PTS * 100);
      const medal = i < 3 ? MEDAL[i] : `${i + 1}`;
      const score = m.goals_l != null ? `<span class="font-bold" style="color:var(--gold)">${m.goals_l}–${m.goals_v}</span>` : "";
      const playerCells = byPlayer.map(p =>
        `<td class="text-center font-bold" style="color:${ptColor(p.pts)}">${p.pts}</td>`
      ).join("");
      const evenBg = i % 2 === 1 ? "background:rgba(255,255,255,.02)" : "";
      return `
        <tr style="${evenBg}">
          <td class="text-center font-bold" style="color:#64748B">${medal}</td>
          <td>
            <div style="font-size:.85rem;color:#E2E8F0;font-weight:600">${m.flag_home || ""} ${escapeHtml(m.home)} vs ${escapeHtml(m.away)} ${m.flag_away || ""}</div>
            <div style="font-size:.7rem;color:#64748B;margin-top:.1rem">${score}${score ? " · " : ""}${m.day_label || ""}</div>
          </td>
          <td class="text-center">
            <span class="font-bold" style="font-family:'Bebas Neue',sans-serif;font-size:1.3rem;color:var(--gold);line-height:1">${totalPts}</span><span style="font-size:.7rem;color:#475569">/${MAX_PTS}</span>
            <div style="height:3px;background:rgba(255,255,255,.07);border-radius:2px;margin-top:.25rem"><div style="height:3px;width:${pct}%;background:var(--gold);border-radius:2px"></div></div>
          </td>
          ${playerCells}
        </tr>`;
    }).join("");

    topMatchesEl.innerHTML = `
      <div class="card overflow-hidden mb-4">
        <div class="px-6 py-4 border-b" style="border-color:var(--border)">
          <h2 class="text-lg font-bold text-white">🏆 Partidos más acertados</h2>
          <p class="text-xs text-gray-400 mt-1">Puntos totales sumados entre todos los participantes. Máximo ${MAX_PTS} pts (${players.length} jugadores × 6 pts). Solo partidos ya jugados.</p>
        </div>
        <div class="overflow-x-auto">
          <table class="pred-table w-full">
            <thead>
              <tr>
                <th>#</th>
                <th class="text-left">Partido</th>
                <th>Pts totales</th>
                ${playerCols}
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
  }

  // ── El gemelo: parejas con predicciones más parecidas / opuestas ───────
  const twinsEl = document.getElementById("stats-twins");
  if (twinsEl) {
    const players = D.meta.players;
    const colors  = D.meta.colors;
    const withPred = D.matches.filter(m => m.predictions);

    const pairs = [];
    for (let i = 0; i < players.length; i++) {
      for (let j = i + 1; j < players.length; j++) {
        const a = players[i], b = players[j];
        let common = 0, sameExact = 0, sameSign = 0;
        withPred.forEach(m => {
          const pa = m.predictions?.[a]?.pred, pb = m.predictions?.[b]?.pred;
          const scA = pa?.score, scB = pb?.score;
          if (!scA || !scB) return;
          common++;
          if (scA === scB) { sameExact++; sameSign++; return; }
          const sa = _signFromScore(scA), sb = _signFromScore(scB);
          if (sa && sb && sa === sb) sameSign++;
        });
        if (common === 0) continue;
        // Afinidad: marcador idéntico vale doble que solo el signo.
        const score = (sameExact * 2 + (sameSign - sameExact)) / (common * 2);
        pairs.push({ a, b, common, sameExact, sameSign, pct: Math.round(score * 100) });
      }
    }

    if (pairs.length === 0) {
      twinsEl.innerHTML = "";
    } else {
      const sorted = [...pairs].sort((x, y) => y.pct - x.pct);
      const twin = sorted[0];
      const opposite = sorted[sorted.length - 1];

      const card = (data, kind) => {
        const isTwin = kind === "twin";
        const cA = colors[data.a] || "#94A3B8", cB = colors[data.b] || "#94A3B8";
        const icon = isTwin ? "🃏" : "🧊";
        const title = isTwin ? "El gemelo" : "Los polos opuestos";
        const sub = isTwin
          ? "Las predicciones más parecidas de la porra"
          : "Los que casi nunca coinciden";
        return `
          <div class="twin-card ${isTwin ? "twin-card-best" : "twin-card-worst"}">
            <div class="twin-card-head">
              <span class="twin-icon">${icon}</span>
              <div>
                <div class="twin-title">${title}</div>
                <div class="twin-sub">${sub}</div>
              </div>
            </div>
            <div class="twin-names">
              <span class="twin-name" style="color:${cA}">${escapeHtml(data.a)}</span>
              <span class="twin-amp">${isTwin ? "&amp;" : "vs"}</span>
              <span class="twin-name" style="color:${cB}">${escapeHtml(data.b)}</span>
            </div>
            <div class="twin-bar"><div class="twin-bar-fill ${isTwin ? "is-best" : "is-worst"}" style="width:${data.pct}%"></div></div>
            <div class="twin-pct">${data.pct}% de afinidad</div>
            <div class="twin-detail">
              🎯 ${data.sameExact} marcador${data.sameExact === 1 ? "" : "es"} idéntico${data.sameExact === 1 ? "" : "s"}
              · 🔵 ${data.sameSign} mismo signo
              <span class="twin-detail-of">de ${data.common} en común</span>
            </div>
          </div>`;
      };

      const rankRows = sorted.map((p, i) => {
        const cA = colors[p.a] || "#94A3B8", cB = colors[p.b] || "#94A3B8";
        return `<tr>
          <td class="text-center" style="color:#64748B;font-weight:700">${i + 1}</td>
          <td><span style="color:${cA};font-weight:700">${escapeHtml(p.a)}</span> <span style="color:#475569">·</span> <span style="color:${cB};font-weight:700">${escapeHtml(p.b)}</span></td>
          <td class="text-center" style="color:#CBD5E1">${p.sameExact}</td>
          <td class="text-center" style="color:#CBD5E1">${p.sameSign}</td>
          <td class="text-center"><span class="twin-rank-pct">${p.pct}%</span></td>
        </tr>`;
      }).join("");

      twinsEl.innerHTML = `
        <div class="flex items-center gap-2 mb-1">
          <h2 class="text-lg font-bold text-white">🃏 El gemelo</h2>
          ${infoTip("La <strong>afinidad</strong> mide cuánto se parecen las predicciones de dos jugadores. Por cada partido que ambos han pronosticado: <strong>marcador idéntico</strong> (ej. los dos ponen 2-0) cuenta el máximo, <strong>mismo signo</strong> (los dos dan ganador al local pero con distinto marcador) cuenta la mitad, y predicciones con distinto signo no suman. El porcentaje es la media sobre todos los partidos en común.", "left")}
        </div>
        <p class="text-sm text-gray-400 mb-4">Qué dos jugadores tienen las predicciones más parecidas (y los más opuestos), comparando todos los pronósticos rellenados.</p>
        <div class="twin-cards">
          ${card(twin, "twin")}
          ${card(opposite, "opposite")}
        </div>
        <div class="card overflow-hidden mt-4">
          <div class="px-6 py-4 border-b" style="border-color:var(--border)">
            <h3 class="font-bold text-white">Afinidad de todas las parejas</h3>
            <p class="text-xs text-gray-400 mt-1">Ordenadas de más parecidas a más opuestas. Un marcador idéntico cuenta doble que coincidir solo en el signo.</p>
          </div>
          <div class="overflow-x-auto">
            <table class="pred-table w-full">
              <thead>
                <tr>
                  <th>#</th>
                  <th class="text-left">Pareja</th>
                  <th>🎯 Iguales</th>
                  <th>🔵 Mismo signo</th>
                  <th>Afinidad</th>
                </tr>
              </thead>
              <tbody>${rankRows}</tbody>
            </table>
          </div>
        </div>`;
    }
  }
}

/* ═══════════════════════════════════════════════════════════════
   PORRA MODE — pronósticos siempre visibles (sin modo invitado)
═══════════════════════════════════════════════════════════════ */
function applyPorraMode() {
  document.body.classList.add("porra-unlocked");
}

applyPorraMode();

/* ── Info tooltips: abrir/cerrar al tocar (móvil) además del hover ── */
(function() {
  // Decide si el tooltip se abre hacia arriba o hacia abajo según el espacio
  // disponible sobre el icono (evita que quede tapado por la barra de nav fija).
  function placeInfoTip(wrap) {
    if (!wrap) return;
    const tip = wrap.querySelector(".info-tip");
    if (!tip) return;
    // Borde inferior real de la barra de navegación visible (sticky).
    const nav = [...document.querySelectorAll(".desktop-nav, .mobile-nav")]
      .find(n => n.offsetParent !== null);
    const navBottom = nav ? nav.getBoundingClientRect().bottom : 0;
    const btn = wrap.querySelector(".info-btn") || wrap;
    const bRect = btn.getBoundingClientRect();
    // offsetHeight es 0 si está oculto; lo medimos forzando visibilidad temporal
    let tipH = tip.offsetHeight;
    if (!tipH) {
      const prev = tip.style.cssText;
      tip.style.cssText += ";display:block;visibility:hidden;";
      tipH = tip.offsetHeight;
      tip.style.cssText = prev;
    }
    // Si abriendo hacia arriba el tooltip se metería bajo el nav → abrir abajo.
    const upwardTop = bRect.top - tipH - 12;
    wrap.classList.toggle("tip-below", upwardTop < navBottom + 4);
  }

  // Hover (escritorio) y foco (teclado): recalcular antes de mostrarse
  document.addEventListener("mouseover", e => {
    const wrap = e.target.closest?.(".info-wrap");
    if (wrap) placeInfoTip(wrap);
  });
  document.addEventListener("focusin", e => {
    const wrap = e.target.closest?.(".info-wrap");
    if (wrap) placeInfoTip(wrap);
  });

  document.addEventListener("click", e => {
    const btn = e.target.closest(".info-btn");
    // Cierra los demás tips abiertos
    document.querySelectorAll(".info-wrap.open").forEach(w => {
      if (!btn || w !== btn.closest(".info-wrap")) w.classList.remove("open");
    });
    if (btn) {
      e.stopPropagation();
      const wrap = btn.closest(".info-wrap");
      if (wrap) {
        placeInfoTip(wrap);
        wrap.classList.toggle("open");
      }
    }
  });
})();

/* Devuelve el HTML de un icono (i) con su tooltip. pos: "left" | "right" | "center" */
function infoTip(text, pos = "left") {
  const cls = pos === "right" ? " tip-right" : pos === "center" ? " tip-center" : "";
  return `<span class="info-wrap${cls}"><span class="info-btn" tabindex="0" role="button" aria-label="Más información">i</span><span class="info-tip">${text}</span></span>`;
}

/* ═══════════════════════════════════════════════════════════════
   NEXT-MATCH COUNTDOWN + LIVE DETECTION
═══════════════════════════════════════════════════════════════ */
let _nextMatchId       = null;   // match.name of the next upcoming match
let _liveMatchIds      = new Set(); // matches currently in progress
let _matchCountdownTimer = null;

const MATCH_DURATION_MS = 115 * 60 * 1000; // ~115 min including extra time

function initCountdown() {
  if (_matchCountdownTimer) clearInterval(_matchCountdownTimer);

  const toSpainUTC = (dateISO, timeEs) => {
    const [y, mo, dd] = dateISO.slice(0, 10).split("-").map(Number);
    const [hh, mm]    = timeEs.split(":").map(Number);
    const guess    = Date.UTC(y, mo - 1, dd, hh, mm, 0);
    const guessDate = new Date(guess);
    const spainStr  = guessDate.toLocaleString("sv-SE", { timeZone: "Europe/Madrid" });
    const spainMs   = new Date(spainStr + "Z").getTime();
    const offsetMs  = guess - spainMs;
    return guess + offsetMs;
  };

  const now = Date.now();
  const withTs = (D?.matches || [])
    .filter(m => m.date && m.time_es && /^\d{2}:\d{2}$/.test(m.time_es))
    .map(m => ({ m, ts: toSpainUTC(m.date, m.time_es) }));

  // Detect live: real live data from the server (m.live), plus a time-based
  // fallback (started within last MATCH_DURATION_MS and not yet marked played).
  _liveMatchIds = new Set(
    withTs
      .filter(x => !x.m.played && x.ts <= now && (now - x.ts) < MATCH_DURATION_MS)
      .map(x => x.m.name)
  );
  (D?.matches || []).forEach(m => {
    if (!m.played && m.live) _liveMatchIds.add(m.name);
  });

  const upcoming = withTs
    .filter(x => !x.m.played && x.ts > now)
    .sort((a, b) => a.ts - b.ts);

  _nextMatchId = upcoming.length ? upcoming[0].m.name : null;
  const next = upcoming[0];

  if (!next) return;

  const tick = () => {
    const el   = document.getElementById("match-countdown");
    if (!el) return;
    const diff = next.ts - Date.now();
    if (diff <= 0) {
      el.textContent = "¡Ya!";
      el.style.color = "var(--green)";
      clearInterval(_matchCountdownTimer);
      return;
    }
    const h   = Math.floor(diff / 3600000);
    const min = Math.floor((diff % 3600000) / 60000);
    const sec = Math.floor((diff % 60000) / 1000);
    const pad = n => String(n).padStart(2, "0");
    el.textContent = h > 0 ? `${pad(h)}:${pad(min)}:${pad(sec)}` : `${pad(min)}:${pad(sec)}`;
    el.style.color = diff < 3600000 ? "var(--green)" : "var(--gold)";
  };
  tick();
  _matchCountdownTimer = setInterval(tick, 1000);
}

/* ═══════════════════════════════════════════════════════════════
   CALENDAR TAB
═══════════════════════════════════════════════════════════════ */
let calView = "week"; // "day" | "week" | "month" — por defecto la semana en curso
let calOffset = 0;     // desplazamiento (en días/semanas/meses) respecto al periodo base

const MESES_CAL = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];

// Primer y último día del Mundial (días con partidos, dentro de junio/julio 2026)
function _calWcBounds(byDate) {
  const dates = Object.keys(byDate).filter(d => d >= "2026-06-01" && d <= "2026-07-31").sort();
  return { first: dates[0] || null, last: dates[dates.length - 1] || null };
}

// Lunes (ISO) de la semana que contiene `iso`
function _calWeekMonday(iso) { return _calWeekDays(iso)[0]; }

// Título de una semana a partir de sus 7 días (p. ej. "8 – 14 junio")
function _calWeekTitle(days) {
  const [, m1, d1] = days[0].split("-").map(Number);
  const [, m2, d2] = days[6].split("-").map(Number);
  return m1 === m2
    ? `${d1} – ${d2} ${MESES_CAL[m2 - 1]}`
    : `${d1} ${MESES_CAL[m1 - 1]} – ${d2} ${MESES_CAL[m2 - 1]}`;
}

// Barra de navegación con flechas ‹ › (se ocultan en los extremos del Mundial,
// pero mantienen su hueco para que el título quede siempre centrado)
function _calNavBar(title, canPrev, canNext) {
  const prev = canPrev
    ? `<button type="button" class="cal-nav-btn" onclick="calStep(-1)" aria-label="Periodo anterior">‹</button>`
    : `<span class="cal-nav-btn is-hidden" aria-hidden="true">‹</span>`;
  const next = canNext
    ? `<button type="button" class="cal-nav-btn" onclick="calStep(1)" aria-label="Periodo siguiente">›</button>`
    : `<span class="cal-nav-btn is-hidden" aria-hidden="true">›</span>`;
  return `<div class="cal-nav">${prev}<div class="cal-nav-title">${title}</div>${next}</div>`;
}

// Avanza/retrocede el periodo visible (día, semana o mes según la vista)
function calStep(n) { calOffset += n; renderCalendar(); }

// Días (ISO) de la semana lunes-domingo que contiene `todayISO`
function _calWeekDays(todayISO) {
  const [y, m, d] = todayISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const wd = (dt.getUTCDay() + 6) % 7; // Lunes = 0
  const days = [];
  for (let i = 0; i < 7; i++) {
    const x = new Date(dt);
    x.setUTCDate(dt.getUTCDate() - wd + i);
    days.push(x.toISOString().slice(0, 10));
  }
  return days;
}

// Suma (o resta) días a una fecha ISO y devuelve la nueva ISO
function _calAddDays(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

// Chip de un partido para la rejilla (vistas Semana / Mes)
function _calMatchChip(m, iso) {
  const fh = m.flag_home || "";
  const fa = m.flag_away || "";
  const ch = TEAM_TO_FIFA[m.home] || (m.home || "").slice(0,3).toUpperCase();
  const ca = TEAM_TO_FIFA[m.away] || (m.away || "").slice(0,3).toUpperCase();
  const looksLikePlaceholder = v => !v || /^\d|^Win|^Los|^[A-Z]\d|^[A-Z]{1,2}\d/.test(v);
  const homeOk = fh && !looksLikePlaceholder(m.home);
  const awayOk = fa && !looksLikePlaceholder(m.away);
  const nm = (m.name || "").replace(/'/g, "\\'").replace(/"/g, "&quot;");
  const chipClick = `onclick="event.stopPropagation();goToMatchesDay('${iso}','${nm}')"`;
  if (!homeOk && !awayOk) return `<div class="cal-chip" ${chipClick}>⚽</div>`;
  return `<div class="cal-chip cal-chip-match" ${chipClick}>${homeOk ? fh : "🏳"}<span class="cal-chip-code">${ch}</span><span class="cal-chip-sep">–</span><span class="cal-chip-code">${ca}</span>${awayOk ? fa : "🏳"}</div>`;
}

// Etiqueta de día como respaldo si el partido no trae day_label
function _calFmtDay(iso) {
  const [y, mo, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  const dn = ["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"][dt.getUTCDay()];
  const mn = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"][mo - 1];
  return `${dn} ${d} ${mn}`;
}

// Una fila de partido con hora para las vistas Hoy / Esta semana
function _calRow(m, iso) {
  const looksPlaceholder = v => !v || /^\d|^Win|^Los|^[A-Z]\d|^[A-Z]{1,2}\d/.test(v);
  const fh = (m.flag_home && !looksPlaceholder(m.home)) ? m.flag_home : "🏳";
  const fa = (m.flag_away && !looksPlaceholder(m.away)) ? m.flag_away : "🏳";
  const home = m.home || "—";
  const away = m.away || "—";
  const time = m.time_es || "--:--";
  const mid = m.played
    ? `<span class="cal-row-score">${(m.result && m.result.score) || (`${m.goals_l ?? ""}-${m.goals_v ?? ""}`)}</span>`
    : `<span class="cal-row-vs">vs</span>`;
  const nm = (m.name || "").replace(/'/g, "\\'").replace(/"/g, "&quot;");
  const tv = tvBadgesHtml(m);
  return `<div class="cal-row" onclick="goToMatchesDay('${iso}','${nm}')">
      <span class="cal-row-time">${time}</span>
      <span class="cal-row-teams">
        <span class="cal-row-team">${fh} ${home}</span>
        ${mid}
        <span class="cal-row-team">${away} ${fa}</span>
      </span>
      ${tv ? `<span class="cal-row-tv" onclick="event.stopPropagation()">${tv}</span>` : ""}
    </div>`;
}

// Lista de días con sus partidos (vistas Hoy / Esta semana)
function _calRenderList(days, today, byDate, emptyMsg) {
  const blocks = [];
  for (const iso of days) {
    const matches = byDate[iso];
    if (!matches || !matches.length) continue;
    const isToday = iso === today;
    const head = matches[0].day_label || _calFmtDay(iso);
    const rows = matches.map(m => _calRow(m, iso)).join("");
    blocks.push(
      `<div class="cal-list-day${isToday ? " is-today" : ""}">` +
        `<div class="cal-list-day-head">${head}${isToday ? " · hoy" : ""}</div>` +
        rows +
      `</div>`);
  }
  if (!blocks.length) return `<div class="cal-list-empty">${emptyMsg}</div>`;
  return `<div class="cal-list">${blocks.join("")}</div>`;
}

// Rejilla de la semana en curso (mismo estilo que la vista Mes)
function _calRenderWeekGrid(days, today, byDate, showTitle = true) {
  const DAYS_ES = ["L","M","X","J","V","S","D"];
  const WEEKENDS = [5, 6];

  const weekdayHeader = DAYS_ES.map((d, i) =>
    `<div class="cal-weekday${WEEKENDS.includes(i) ? " weekend" : ""}">${d}</div>`
  ).join("");

  const cells = days.map(iso => {
    const [, mo, dd] = iso.split("-").map(Number);
    const matches = byDate[iso] || [];
    const isToday = iso === today;
    const hasMatch = matches.length > 0;

    let cls = "cal-day";
    cls += hasMatch ? " has-match" : " no-match";
    if (isToday) cls += " is-today";

    const chips = matches.map(m => _calMatchChip(m, iso)).join("");
    const clickAttr = hasMatch
      ? `onclick="goToMatchesDay('${iso}')" title="${matches.map(m=>(m.home||"")+" - "+(m.away||"")).join(" · ")}"`
      : "";
    return `<div class="${cls}" ${clickAttr}><div class="cal-day-num">${dd}</div>${chips}</div>`;
  }).join("");

  return `
    <div class="cal-month">
      ${showTitle ? `<div class="cal-month-title">${_calWeekTitle(days)}</div>` : ""}
      <div class="cal-weekdays">${weekdayHeader}</div>
      <div class="cal-days">${cells}</div>
    </div>`;
}

// Rejilla de un mes concreto (junio o julio 2026)
function _calRenderMonthGrid(year, month, label, today, byDate, showTitle = true) {
  const DAYS_ES = ["L","M","X","J","V","S","D"];
  const WEEKENDS = [5, 6]; // índices sábado/domingo (0=Lunes)
  const daysInMonth = new Date(year, month, 0).getDate();

  const weekdayHeader = DAYS_ES.map((d, i) =>
    `<div class="cal-weekday${WEEKENDS.includes(i) ? " weekend" : ""}">${d}</div>`
  ).join("");

  // Primer día del mes con partido, para saltar semanas vacías al principio
  const firstMatchDay = (() => {
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${year}-${String(month).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
      if (byDate[iso]?.length) return d;
    }
    return 1;
  })();
  const firstMatchWd = new Date(year, month - 1, firstMatchDay).getDay();
  const firstMatchOffset = (firstMatchWd + 6) % 7; // Mon=0
  const startDay = firstMatchDay - firstMatchOffset;

  // El bucle empieza en el lunes de la primera semana con partido (startDay) y
  // la guarda `day < 1` rellena los huecos previos al día 1, así que no hay que
  // anteponer celdas vacías (hacerlo desplazaría todos los días).
  let cells = [];
  for (let day = startDay; day <= daysInMonth; day++) {
    if (day < 1) { cells.push(`<div class="cal-day empty"></div>`); continue; }
    const iso = `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    const matches = byDate[iso] || [];
    const isToday = iso === today;
    const hasMath = matches.length > 0;

    let cls = "cal-day";
    cls += hasMath ? " has-match" : " no-match";
    if (isToday) cls += " is-today";

    const chips = matches.map(m => _calMatchChip(m, iso)).join("");
    const clickAttr = hasMath
      ? `onclick="goToMatchesDay('${iso}')" title="${matches.map(m=>(m.home||"")+" - "+(m.away||"")).join(" · ")}"`
      : "";
    cells.push(`<div class="${cls}" ${clickAttr}><div class="cal-day-num">${day}</div>${chips}</div>`);
  }

  return `
    <div class="cal-month">
      ${showTitle ? `<div class="cal-month-title">${label}</div>` : ""}
      <div class="cal-weekdays">${weekdayHeader}</div>
      <div class="cal-days">${cells.join("")}</div>
    </div>`;
}

/* ═══════════════════════════════════════════════════════════════
   APUESTAS INTERNAS — Firebase-backed bets for the 6 porra players
═══════════════════════════════════════════════════════════════ */

// ── Firebase config — fill in after creating project ──────────
// Go to https://console.firebase.google.com → New project →
// Realtime Database → Create → Copy config here.
const BETS_FIREBASE_CONFIG = {
  apiKey:            "PENDING_SETUP",
  authDomain:        "PENDING_SETUP.firebaseapp.com",
  databaseURL:       "https://PENDING_SETUP-default-rtdb.europe-west1.firebasedatabase.app",
  projectId:         "PENDING_SETUP",
  storageBucket:     "PENDING_SETUP.appspot.com",
  messagingSenderId: "PENDING_SETUP",
  appId:             "PENDING_SETUP"
};

// ── Users: username → { display name, porra player key, SHA-256 hash }
const BETS_USERS = {
  juancho: { display: "JUANCHO",  player: "JUANCHO",  hash: "e63a53411cff0d1c065b43ca221edee2865eff73c7232fc97856895128767729" },
  larry:   { display: "LARRY",    player: "LARRY",    hash: "205fe0688ffc6a367d53c8230377d554b180351d2a4d11cb0998ff0d13c9dd37" },
  luisvir: { display: "LUIS/VIR", player: "LUIS/VIR", hash: "b606777ebf22023183e9589eed9339ee8bb1f7cab78987d6a2ef4666e86cc51c" },
  medina:  { display: "MEDINA",   player: "MEDINA",   hash: "100c19f3cc037014eb8fbca3d2961e3da76ffa275030f9d1b3fdbbcb3e58a047" },
  victor:  { display: "VÍCTOR",   player: "VÍCTOR",   hash: "d68c196140e560f42337d6687acf4b4045eabbb10b07398e4f951fb3a0f039ec" },
  crespo:  { display: "CRESPO",   player: "CRESPO",   hash: "68e1c78aee99060a8537deda8a1e280455718b64c5419f2cebddd90738832acf" },
};

const BETS_QUESTIONS = [
  { id: "winner_porra",  emoji: "🏆", label: "¿Quién ganará la Porra?",                   type: "player" },
  { id: "winner_groups", emoji: "📊", label: "¿Quién sacará más puntos en Fase de Grupos?", type: "player" },
  { id: "winner_ko",     emoji: "⚔️", label: "¿Quién sacará más puntos en la Eliminatoria?", type: "player" },
  { id: "world_champ",   emoji: "🌍", label: "¿Qué selección ganará el Mundial?",           type: "team"   },
];

let betsCurrentUser = null;
let betsDb = null;
let betsAllData = {};

async function sha256(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function initBetsFirebase() {
  if (betsDb) return true;
  try {
    if (typeof firebase === "undefined") return false;
    const cfg = BETS_FIREBASE_CONFIG;
    if (!cfg.apiKey || cfg.apiKey === "PENDING_SETUP") return false;
    const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(cfg);
    betsDb = firebase.database(app);
    return true;
  } catch(e) {
    console.warn("Firebase init error:", e);
    return false;
  }
}

async function betsLoadAll() {
  if (!betsDb) return;
  try {
    const snap = await betsDb.ref("bets").get();
    betsAllData = snap.exists() ? snap.val() : {};
  } catch(e) {
    console.warn("Bets load error:", e);
  }
}

async function betsSave(username, predictions) {
  if (!betsDb) return false;
  try {
    const payload = { locked: true, submittedAt: new Date().toISOString(), ...predictions };
    await betsDb.ref("bets/" + username).set(payload);
    betsAllData[username] = payload;
    return true;
  } catch(e) {
    console.warn("Bets save error:", e);
    return false;
  }
}

function renderBets() {
  const container = document.getElementById("bets-container");
  if (!container) return;
  initBetsFirebase();
  if (!betsCurrentUser) {
    renderBetsLogin(container);
  } else {
    betsLoadAll().then(() => renderBetsMain(container));
  }
}

function renderBetsLogin(container) {
  const userOptions = Object.entries(BETS_USERS)
    .map(([k, u]) => `<option value="${k}">${escapeHtml(u.display)}</option>`)
    .join("");
  const fbReady = betsDb !== null;

  container.innerHTML = `
    <div class="bts-root">
      <div class="bts-login-card">
        <div class="bts-lock-icon">🎲</div>
        <h2 class="bts-login-title">Apuestas Internas</h2>
        <p class="bts-login-sub">Zona exclusiva para los jugadores de la Porra&nbsp;«Los&nbsp;Nanos».</p>
        ${!fbReady ? `<div class="bts-setup-warn">⚙️ Firebase pendiente de configurar. Contacta con Crespo.</div>` : ""}
        <div class="bts-login-form">
          <label class="bts-label" for="bts-user-select">Tu nombre</label>
          <select id="bts-user-select" class="bts-select">
            <option value="">— Selecciona tu nombre —</option>
            ${userOptions}
          </select>
          <label class="bts-label" for="bts-pwd">Contraseña</label>
          <input id="bts-pwd" type="password" class="bts-input" placeholder="Tu contraseña" autocomplete="current-password" />
          <div id="bts-login-err" class="bts-login-err hidden"></div>
          <button id="bts-login-btn" class="bts-login-btn" ${!fbReady ? "disabled" : ""}>Entrar →</button>
        </div>
      </div>
    </div>`;

  const doLogin = async () => {
    const username = document.getElementById("bts-user-select").value;
    const pwd = document.getElementById("bts-pwd").value.trim();
    const err = document.getElementById("bts-login-err");
    err.classList.add("hidden");
    if (!username || !pwd) {
      err.textContent = "Selecciona tu nombre e introduce la contraseña.";
      err.classList.remove("hidden"); return;
    }
    const hash = await sha256(pwd);
    if (hash !== BETS_USERS[username]?.hash) {
      err.textContent = "Contraseña incorrecta. Recuerda que la contraseña es tu nombre + 26 (ej: Juancho26).";
      err.classList.remove("hidden"); return;
    }
    betsCurrentUser = username;
    await betsLoadAll();
    renderBetsMain(document.getElementById("bets-container"));
  };

  document.getElementById("bts-login-btn")?.addEventListener("click", doLogin);
  document.getElementById("bts-pwd")?.addEventListener("keydown", e => { if (e.key === "Enter") doLogin(); });
}

function renderBetsMain(container) {
  if (!container) return;
  const user = BETS_USERS[betsCurrentUser];
  const myBet = betsAllData[betsCurrentUser];
  const isLocked = myBet?.locked === true;

  // Build team list from D.matches (real teams only)
  const allTeams = D ? [...new Set(
    (D.matches || []).flatMap(m => [m.home, m.away])
      .filter(t => t && !/^(W|L)\d|^\d+[A-Z]|^[A-Z]\d/.test(t))
  )].sort() : [];

  const otherPlayers = (D?.meta?.players || []).filter(p => p !== user.player);

  // ── Form (not yet submitted) ───────────────────────────────────────────────
  let contentHtml = "";
  if (!isLocked) {
    const questionsHtml = BETS_QUESTIONS.map(q => {
      let opts = "";
      if (q.type === "player") {
        opts = otherPlayers.map(p => `<option value="${p}">${escapeHtml(p)}</option>`).join("");
      } else {
        opts = allTeams.map(t => `<option value="${t}">${escapeHtml(t)}</option>`).join("");
      }
      return `<div class="bts-q">
        <label class="bts-q-label">${q.emoji} ${q.label}</label>
        <select class="bts-select bts-q-sel" data-q="${q.id}">
          <option value="">— Elige —</option>
          ${opts}
        </select>
      </div>`;
    }).join("");

    contentHtml = `
      <div class="bts-form-card">
        <p class="bts-form-intro">Haz tus predicciones y pulsa <strong>ENVIAR</strong>. Solo puedes enviarlo <strong>una vez</strong> — cuando lo envíes no podrás modificarlo.</p>
        ${questionsHtml}
        <div id="bts-submit-err" class="bts-login-err hidden"></div>
        <button id="bts-submit-btn" class="bts-submit-btn">🔒 Enviar mis apuestas</button>
      </div>`;

  } else {
    // ── Already submitted: show own predictions ──────────────────────────────
    const myPredHtml = BETS_QUESTIONS.map(q => {
      const val = myBet[q.id] || "—";
      return `<div class="bts-pred-row">
        <span class="bts-pred-q">${q.emoji} ${escapeHtml(q.label)}</span>
        <span class="bts-pred-v">${escapeHtml(val)}</span>
      </div>`;
    }).join("");

    contentHtml = `
      <div class="bts-submitted-banner">✅ Apuestas enviadas el ${new Date(myBet.submittedAt).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" })}</div>
      <div class="bts-my-preds card mb-4 p-4">
        <h3 class="bts-preds-title">Mis predicciones</h3>
        ${myPredHtml}
      </div>`;
  }

  // ── Overview table (visible after submitting) ─────────────────────────────
  let summaryHtml = "";
  if (isLocked) {
    const colHeaders = BETS_QUESTIONS.map(q => `<th title="${escapeHtml(q.label)}">${q.emoji}</th>`).join("");
    const rows = Object.entries(BETS_USERS).map(([k, u]) => {
      const bet = betsAllData[k];
      const isMe = k === betsCurrentUser;
      if (!bet?.locked) {
        return `<tr class="bts-tbl-row bts-tbl-pending">
          <td class="bts-tbl-name">${escapeHtml(u.display)}</td>
          ${BETS_QUESTIONS.map(() => `<td class="bts-tbl-empty">…</td>`).join("")}
        </tr>`;
      }
      return `<tr class="bts-tbl-row ${isMe ? "bts-tbl-me" : ""}">
        <td class="bts-tbl-name">${escapeHtml(u.display)}${isMe ? " <span class='bts-tbl-you'>(tú)</span>" : ""}</td>
        ${BETS_QUESTIONS.map(q => `<td class="bts-tbl-val">${escapeHtml(bet[q.id] || "—")}</td>`).join("")}
      </tr>`;
    }).join("");

    const viewOpts = Object.entries(BETS_USERS)
      .filter(([k]) => k !== betsCurrentUser && betsAllData[k]?.locked)
      .map(([k, u]) => `<option value="${k}">${escapeHtml(u.display)}</option>`)
      .join("");

    summaryHtml = `
      <div class="card overflow-hidden mt-4">
        <div class="px-4 py-3 border-b" style="border-color:var(--border)">
          <h3 class="bts-preds-title">Resumen de apuestas</h3>
          <p class="text-xs text-gray-400 mt-0.5">… = aún no ha enviado sus apuestas.</p>
        </div>
        <div class="overflow-x-auto">
          <table class="bts-overview-table">
            <thead>
              <tr>
                <th class="bts-tbl-name" style="text-align:left">Jugador</th>
                ${colHeaders}
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        ${viewOpts ? `<div class="bts-view-others px-4 py-3 border-t" style="border-color:var(--border)">
          <label class="bts-label mb-1 block">Ver apuestas de:</label>
          <select id="bts-view-select" class="bts-select" style="max-width:220px">
            <option value="">— Elige jugador —</option>
            ${viewOpts}
          </select>
          <div id="bts-view-detail"></div>
        </div>` : ""}
      </div>`;
  }

  container.innerHTML = `
    <div class="bts-root">
      <div class="bts-header">
        <div>
          <h2 class="bts-main-title">🎲 Apuestas Internas</h2>
          <p class="bts-main-sub">Sesión: <strong>${escapeHtml(user.display)}</strong></p>
        </div>
        <button id="bts-logout-btn" class="bts-logout-btn">Cerrar sesión</button>
      </div>
      ${contentHtml}
      ${summaryHtml}
    </div>`;

  // ── Handlers ──────────────────────────────────────────────────────────────
  document.getElementById("bts-logout-btn")?.addEventListener("click", () => {
    betsCurrentUser = null;
    renderBetsLogin(document.getElementById("bets-container"));
  });

  document.getElementById("bts-submit-btn")?.addEventListener("click", async () => {
    const sels = document.querySelectorAll(".bts-q-sel");
    const predictions = {};
    let valid = true;
    sels.forEach(s => {
      if (!s.value) valid = false;
      else predictions[s.dataset.q] = s.value;
    });
    const errEl = document.getElementById("bts-submit-err");
    if (!valid) {
      errEl.textContent = "Responde todas las preguntas antes de enviar.";
      errEl.classList.remove("hidden"); return;
    }
    const btn = document.getElementById("bts-submit-btn");
    btn.disabled = true;
    btn.textContent = "Enviando…";
    const ok = await betsSave(betsCurrentUser, predictions);
    if (ok) {
      renderBetsMain(document.getElementById("bets-container"));
    } else {
      btn.disabled = false;
      btn.textContent = "🔒 Enviar mis apuestas";
      errEl.textContent = "Error al guardar. Comprueba tu conexión e inténtalo de nuevo.";
      errEl.classList.remove("hidden");
    }
  });

  document.getElementById("bts-view-select")?.addEventListener("change", function() {
    const k = this.value;
    const detail = document.getElementById("bts-view-detail");
    if (!k || !betsAllData[k]?.locked) { if (detail) detail.innerHTML = ""; return; }
    const bet = betsAllData[k];
    const uName = BETS_USERS[k]?.display || k;
    if (detail) detail.innerHTML = `
      <div class="bts-other-preds mt-3">
        <h4 class="bts-other-title">Apuestas de ${escapeHtml(uName)}:</h4>
        ${BETS_QUESTIONS.map(q => `<div class="bts-pred-row">
          <span class="bts-pred-q">${q.emoji} ${escapeHtml(q.label)}</span>
          <span class="bts-pred-v">${escapeHtml(bet[q.id] || "—")}</span>
        </div>`).join("")}
      </div>`;
  });
}

/* ═══════════════════════════════════════════════════════════════
   CLASIFICACIÓN MUNDIAL — sub-tabs: Grupos / Goleadores / General
═══════════════════════════════════════════════════════════════ */
let _teamsSubTab = "groups"; // "groups" | "scorers" | "general" | "thirds" | "bracket"

function renderTeams() {
  const container = document.getElementById("teams-container");
  if (!container || !D) return;

  // ── Sub-tab shell (solo la primera vez o tras reset) ────────
  if (!container.querySelector(".tms-sub-tabs")) {
    container.innerHTML = `
      <div class="tms-root">
        <h2 class="tms-title">${_TMS_TITLES[_teamsSubTab] || "🌍 Clasificaciones Mundial 2026"}</h2>
        <div class="tms-sub-tabs" id="tms-sub-tabs">
          <button class="tms-sub-tab active" data-stab="groups">📊 Grupos</button>
          <button class="tms-sub-tab" data-stab="scorers">⚽ Goleadores</button>
          <button class="tms-sub-tab" data-stab="general">🏆 Clasificación general</button>
          <button class="tms-sub-tab" data-stab="thirds">🥉 Terceros</button>
        </div>
        <div id="tms-sub-body"></div>
      </div>`;

    container.querySelectorAll(".tms-sub-tab").forEach(btn => {
      btn.addEventListener("click", () => {
        // Usa _switchTeamsSubTab para actualizar también el título de la sección
        // (sin scroll: el usuario ya está mirando las sub-pestañas).
        _switchTeamsSubTab(btn.dataset.stab, false);
      });
    });
  }

  // Mantén el título sincronizado con la sub-tab activa en cada re-render
  const titleEl = container.querySelector(".tms-title");
  if (titleEl) titleEl.textContent = _TMS_TITLES[_teamsSubTab] || "🌍 Clasificaciones Mundial 2026";

  // Sync active tab (in case of re-render)
  container.querySelectorAll(".tms-sub-tab").forEach(b =>
    b.classList.toggle("active", b.dataset.stab === _teamsSubTab));

  _renderTeamsSubBody();
}

function _renderTeamsSubBody() {
  const body = document.getElementById("tms-sub-body");
  if (!body || !D) return;
  // Marca el root para que CSS pueda liberar el max-width en Fase Final
  const root = document.querySelector(".tms-root");
  if (root) root.classList.toggle("tms-mode-bracket", _teamsSubTab === "bracket");
  if (_teamsSubTab === "groups")  body.innerHTML = _teamsGroupsHtml();
  if (_teamsSubTab === "scorers") body.innerHTML = _teamsScorersHtml();
  if (_teamsSubTab === "general") body.innerHTML = _teamsGeneralHtml();
  if (_teamsSubTab === "thirds")  body.innerHTML = _teamsThirdsHtml();
  if (_teamsSubTab === "bracket") {
    body.innerHTML = '<div id="tms-bracket-inner"></div>';
    renderBracket(document.getElementById("tms-bracket-inner"));
  }
}

/* ── Sub-tab 1: Clasificación de grupos ── */
function _teamsGroupsHtml() {
  const grpLetters = [...new Set(
    (D.matches || []).filter(m => m.phase === "groups" && m.id)
                     .map(m => m.id.charAt(0).toUpperCase())
  )].sort();

  if (!grpLetters.length) return `<div class="card p-5 text-gray-500 text-sm">Aún no hay partidos de grupos.</div>`;

  const allThirds = _computeAllThirds();

  return _worldProvBanner() + grpLetters.map(g => {
    const table = _computeGroupStanding(g);
    const thirdRankInfo = allThirds.find(t => t.group === g) || null;
    const thirdRank = thirdRankInfo ? thirdRankInfo.rank : null;
    const thirdQual = thirdRank !== null && thirdRank <= 8;
    const totalThirds = allThirds.length;
    const playedInGroup = (D.matches || []).filter(m => m.phase === "groups" && m.id?.startsWith(g) && m.played).length;
    const liveInGroup = (D.matches || []).some(m => m.phase === "groups" && m.id && m.id.charAt(0).toUpperCase() === g && !m.played && m.live && m.live_goals_l != null && m.live_goals_v != null);

    const rows = table.map((t, i) => {
      let rowCls = i < 2 ? "grp-qual" : (i === 2 ? (thirdQual ? "grp-third" : "grp-third grp-third-out") : "");
      const tieBadge = t.tieNote === "lots"
        ? `<span class="grp-tie-badge" title="Igualados en todos los criterios FIFA — posición decidida por sorteo">🎲 sorteo</span>`
        : "";
      const dif = t.gf - t.gc;
      const difStr = dif > 0 ? `+${dif}` : `${dif}`;
      const difCls = dif > 0 ? "tms-pos-num" : dif < 0 ? "tms-neg" : "";
      return `<tr class="${rowCls}">
        <td class="grp-td-team"><button class="team-name-btn" data-team="${escapeHtml(t.name)}">${t.flag} ${escapeHtml(t.name)}</button>${tieBadge}</td>
        <td>${t.pj}</td><td>${t.pg}</td><td>${t.pe}</td><td>${t.pp}</td>
        <td>${t.gf}</td><td>${t.gc}</td>
        <td class="${difCls}">${difStr}</td>
        <td class="tms-pts-cell">${t.pts}</td>
      </tr>`;
    }).join("");

    // Leyenda 3º
    let thirdLegHtml = "";
    if (table[2]) {
      const rankTxt = thirdRank !== null ? `N.º <strong>${thirdRank}</strong> de ${totalThirds}` : "sin datos";
      const prov = playedInGroup < 3 ? " <em>(provisional)</em>" : "";
      const thirdsLink = `<button class="grp-thirds-link" onclick="event.stopPropagation();goToTeamsSubTab('thirds')" type="button">ver clasificación de terceros →</button>`;
      // Empate 2.º/3.º: mostrar ambos nombres
      const thirdEntry = allThirds.find(t => t.group === g);
      const tiedWith = thirdEntry?.tiedWithSecond;
      const teamNames = tiedWith
        ? `<strong>${escapeHtml(table[2].name)}</strong> o <strong>${escapeHtml(tiedWith.name)}</strong> 🎲`
        : `(${rankTxt})${prov}`;
      thirdLegHtml = thirdQual
        ? `<div class="grp-legend-item grp-legend-third-yes">🟡 3.º — <strong>clasificaría</strong>: ${teamNames} ${thirdsLink}</div>`
        : `<div class="grp-legend-item grp-legend-third-no">⬜ 3.º — <strong>no clasificaría</strong>: ${teamNames} ${thirdsLink}</div>`;
    }
    const sorteoLeg = table.some(t => t.tieNote === "lots")
      ? `<div class="grp-legend-item" style="color:#94A3B8">🎲 <strong>sorteo</strong> — equipos totalmente igualados; posición provisional decidida por sorteo FIFA</div>`
      : "";

    return `
      <div class="tms-grp-block">
        <div class="tms-grp-hd">Grupo ${g}${liveInGroup ? ` <span class="tms-grp-live">🔴 EN JUEGO</span>` : ""}</div>
        <div class="card overflow-hidden">
          <div class="overflow-x-auto">
            <table class="grp-table tms-grp-table">
              <thead><tr>
                <th style="text-align:left;width:40%">Equipo</th>
                <th title="Partidos jugados">PJ</th><th title="Ganados">G</th>
                <th title="Empatados">E</th><th title="Perdidos">P</th>
                <th title="Goles a favor">GF</th><th title="Goles en contra">GC</th>
                <th title="Diferencia">DIF</th><th title="Puntos">PTS</th>
              </tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
          <div class="flex flex-col gap-0.5 px-3 py-2">
            <div class="grp-legend-item grp-legend-qual">🟢 Top 2 — clasificados directamente</div>
            ${thirdLegHtml}${sorteoLeg}
          </div>
        </div>
      </div>`;
  }).join("");
}

/* ── Sub-tab 2: Máximos goleadores ── */
function _teamsScorersHtml() {
  const played = (D.matches || []).filter(m => m.played);
  const scorersMap = {};
  played.forEach(m => {
    (m.scorers || []).forEach(s => {
      const name = s.player;
      if (!name) return;
      const side = s.team === "home" ? "home" : "away";
      const team = side === "home" ? m.home : m.away;
      const flag = side === "home" ? (m.flag_home || "") : (m.flag_away || "");
      if (!scorersMap[name]) scorersMap[name] = { name, team, flag, goals: 0, pens: 0, og: 0, matches: new Set() };
      if (s.own_goal) { scorersMap[name].og++; }
      else { scorersMap[name].goals++; if (s.penalty) scorersMap[name].pens++; }
      scorersMap[name].matches.add(m.name);
      scorersMap[name].team = team;
      scorersMap[name].flag = flag;
    });
  });

  const list = Object.values(scorersMap)
    .filter(s => s.goals > 0)
    .map(s => ({ ...s, matches: s.matches.size }))
    .sort((a, b) => (b.goals - a.goals) || (a.matches - b.matches) || a.name.localeCompare(b.name));

  if (!list.length) return `<div class="card p-5 text-gray-500 text-sm">Aún no hay goleadores registrados.</div>`;

  const rows = list.map((s, i) => {
    const penStr = s.pens > 0 ? `<span class="tsc-pen-tag">${s.pens}P</span>` : "—";
    return `<tr>
      <td class="tsc-pos">${i + 1}</td>
      <td class="tsc-name"><span class="tsc-player">${escapeHtml(s.name)}</span></td>
      <td class="tsc-team"><span class="tsc-flag">${s.flag}</span><button class="team-name-btn" data-team="${escapeHtml(s.team)}">${escapeHtml(s.team)}</button></td>
      <td class="tsc-g tsc-g-val">${s.goals}</td>
      <td class="tsc-pen">${penStr}</td>
      <td class="tsc-pj">${s.matches}</td>
    </tr>`;
  }).join("");

  return `<div class="card overflow-hidden">
    <div class="px-5 py-4 border-b" style="border-color:var(--border)">
      <p class="text-xs text-gray-400 mt-0.5">Los goles en propia portería no se contabilizan. (P) = penalti.</p>
    </div>
    <div class="overflow-x-auto">
      <table class="tm-scorers-table">
        <thead><tr>
          <th class="tsc-pos">#</th>
          <th class="tsc-name text-left">Jugador</th>
          <th class="tsc-team text-left">Equipo</th>
          <th title="Goles" class="tsc-g">⚽</th>
          <th title="De penalti" class="tsc-pen">(P)</th>
          <th title="Partidos" class="tsc-pj">PJ</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>`;
}

/* ── Sub-tab 3: Clasificación general ── */
const _TMS_TITLES = {
  groups:  "📊 Clasificación de grupos",
  scorers: "⚽ Goleadores",
  general: "🏆 Clasificación general",
  thirds:  "🥉 Clasificación de terceros",
  bracket: "⚔️ Fase Final",
};

function _switchTeamsSubTab(stab, scroll = true) {
  _teamsSubTab = stab;
  document.querySelectorAll(".tms-sub-tab").forEach(b =>
    b.classList.toggle("active", b.dataset.stab === stab));
  // Actualiza el título de la sección
  const titleEl = document.querySelector(".tms-root .tms-title");
  if (titleEl) titleEl.textContent = _TMS_TITLES[stab] || "🌍 Clasificaciones Mundial 2026";
  _renderTeamsSubBody();
  // scroll al inicio de la sección (solo cuando se navega desde un modal;
  // desde la nav, el cambio de pestaña ya posiciona la vista con
  // scrollToContentTop, y este scrollIntoView adicional la empujaría hacia abajo)
  if (scroll) {
    document.getElementById("tms-sub-body")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

/* ── Sub-tab 4: Clasificación de terceros ── */
function _teamsThirdsHtml() {
  const thirds = _computeAllThirds();
  const totalGroups = [...new Set(
    (D.matches || []).filter(m => m.phase === "groups" && m.id)
                     .map(m => m.id.charAt(0).toUpperCase())
  )].length;

  if (!thirds.length) return `<div class="card p-5 text-gray-500 text-sm">Aún no hay datos de terceros clasificados.</div>`;

  const hasTieAtCutoff = thirds.some(t => t.tieAtCutoff);
  const hasTieInGroup  = thirds.some(t => t.tiedWithSecond);

  const rows = thirds.map((t, i) => {
    const qual = i < 8 || t.tieAtCutoff;
    const dif = t.gf - t.gc;
    const difStr = dif > 0 ? `+${dif}` : `${dif}`;
    const difCls = dif > 0 ? "tms-pos-num" : dif < 0 ? "tms-neg" : "";
    let rowCls;
    if (t.tieAtCutoff) rowCls = "grp-third grp-third-tie-cutoff";
    else if (i < 8) rowCls = "grp-third";
    else rowCls = "grp-third grp-third-out";
    const tieCutoffBadge = t.tieAtCutoff ? `<span class="trd-tie-badge">⚠️ empate corte</span>` : "";
    const tieGrpBadge = t.tiedWithSecond ? `<span class="trd-tie-badge trd-tie-grp">🎲 sorteo con 2.º</span>` : "";
    const tieBadges = (tieCutoffBadge || tieGrpBadge)
      ? `<span class="trd-badges">${tieCutoffBadge}${tieGrpBadge}</span>` : "";

    // Nombre: si hay empate con el 2.º, mostrar "Brasil o Marruecos"
    const teamCell = t.tiedWithSecond
      ? `<td class="tlg-team">
          <span class="trd-team-line"><span class="tlg-flag">${t.flag || ""}</span><button class="team-name-btn" data-team="${escapeHtml(t.name)}">${escapeHtml(t.name)}</button>
          <span class="trd-or-sep">o</span>
          <span class="tlg-flag">${t.tiedWithSecond.flag || ""}</span><button class="team-name-btn" data-team="${escapeHtml(t.tiedWithSecond.name)}">${escapeHtml(t.tiedWithSecond.name)}</button>
          <span class="trd-grp-tag">Gr. ${t.group}</span></span>${tieBadges}
         </td>`
      : `<td class="tlg-team"><span class="trd-team-line"><span class="tlg-flag">${t.flag || ""}</span><button class="team-name-btn" data-team="${escapeHtml(t.name)}">${escapeHtml(t.name)}</button>
          <span class="trd-grp-tag">Gr. ${t.group}</span></span>${tieBadges}</td>`;

    return `<tr class="${rowCls}">
      <td class="tlg-pos">${i + 1}</td>
      ${teamCell}
      <td>${t.pj}</td>
      <td class="tlg-g">${t.pg}</td>
      <td>${t.pe}</td>
      <td class="tlg-l">${t.pp}</td>
      <td>${t.gf}</td>
      <td>${t.gc}</td>
      <td class="${difCls}">${difStr}</td>
      <td class="tlg-pts tlg-pts-val">${t.pts}</td>
    </tr>`;
  }).join("");

  const provisional = thirds.length < totalGroups
    ? `<p class="text-xs text-yellow-400 mb-3">⚠️ Provisional — aún no han jugado todos los grupos (${thirds.length}/${totalGroups}).</p>`
    : "";

  return `
    ${_worldProvBanner()}
    <div class="card overflow-hidden mb-4">
      <div class="px-5 py-4 border-b" style="border-color:var(--border)">
        <h2 class="text-base font-bold text-white">🥉 Clasificación de terceros</h2>
        <p class="text-xs text-gray-400 mt-0.5">Los 8 mejores terceros de grupo pasan a 16avos de final. Criterios: Pts → DIF → GF.</p>
      </div>
      <div class="px-5 pt-3">${provisional}</div>
      <div class="overflow-x-auto">
        <table class="tm-league-table">
          <thead><tr>
            <th class="tlg-pos">#</th>
            <th class="tlg-team text-left">Equipo</th>
            <th title="Partidos jugados">PJ</th>
            <th title="Ganados">G</th>
            <th title="Empatados">E</th>
            <th title="Perdidos">P</th>
            <th title="Goles a favor">GF</th>
            <th title="Goles en contra">GC</th>
            <th title="Diferencia de goles">DIF</th>
            <th title="Puntos" class="tlg-pts">PTS</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="px-5 py-3 flex flex-col gap-0.5">
        <div class="grp-legend-item grp-legend-third-yes">🟡 Top 8 — clasifican a 16avos de final</div>
        ${hasTieAtCutoff ? `<div class="grp-legend-item" style="color:#F59E0B">⚠️ <strong>Empate en el corte (posición 8/9)</strong> — se necesitan más criterios (fair play, ranking FIFA) o sorteo para desempatar. Estado provisional.</div>` : ""}
        ${hasTieInGroup ? `<div class="grp-legend-item" style="color:#94A3B8">🎲 <strong>sorteo con 2.º</strong> — el 2.º y el 3.º del grupo están igualados en todos los criterios; quién actúa como tercero se decide por sorteo FIFA.</div>` : ""}
        <div class="grp-legend-item grp-legend-third-no">⬜ Eliminados</div>
      </div>
    </div>`;
}

function _teamsGeneralHtml() {
  const counted = (D.matches || []).filter(m => _matchGoals(m));
  const teamsMap = {};
  function ensureTeam(name, flag) {
    if (!teamsMap[name]) teamsMap[name] = { name, flag: flag || "", pj: 0, pg: 0, pe: 0, pp: 0, gf: 0, gc: 0 };
  }
  counted.forEach(m => {
    const isReal = n => n && !/^(W|L)\d|^\d+[A-Z]|^[A-Z]\d/.test(n);
    if (!isReal(m.home) || !isReal(m.away)) return;
    ensureTeam(m.home, m.flag_home); ensureTeam(m.away, m.flag_away);
    const eff = _matchGoals(m); const gh = eff.gh, ga = eff.ga;
    const h = teamsMap[m.home], a = teamsMap[m.away];
    h.pj++; a.pj++; h.gf += gh; h.gc += ga; a.gf += ga; a.gc += gh;
    if (gh > ga)      { h.pg++; a.pp++; }
    else if (gh < ga) { a.pg++; h.pp++; }
    else              { h.pe++; a.pe++; }
  });

  const list = Object.values(teamsMap)
    .filter(t => t.pj > 0)
    .map(t => ({ ...t, pts: t.pg * 3 + t.pe, dif: t.gf - t.gc }))
    .sort((a, b) => (b.pts - a.pts) || (b.dif - a.dif) || (b.gf - a.gf) || a.name.localeCompare(b.name));

  if (!list.length) return `<div class="card p-5 text-gray-500 text-sm">Aún no hay partidos jugados.</div>`;

  const rows = list.map((t, i) => {
    const difStr = t.dif > 0 ? `+${t.dif}` : `${t.dif}`;
    const difCls = t.dif > 0 ? "tms-pos-num" : t.dif < 0 ? "tms-neg" : "";
    return `<tr>
      <td class="tlg-pos">${i + 1}</td>
      <td class="tlg-team"><span class="tlg-flag">${t.flag}</span><button class="team-name-btn" data-team="${escapeHtml(t.name)}">${escapeHtml(t.name)}</button></td>
      <td>${t.pj}</td>
      <td class="tlg-g">${t.pg}</td>
      <td>${t.pe}</td>
      <td class="tlg-l">${t.pp}</td>
      <td>${t.gf}</td><td>${t.gc}</td>
      <td class="${difCls}">${difStr}</td>
      <td class="tlg-pts tlg-pts-val">${t.pts}</td>
    </tr>`;
  }).join("");

  return `${_worldProvBanner()}<div class="card overflow-hidden">
    <div class="px-5 py-4 border-b" style="border-color:var(--border)">
      <p class="text-xs text-gray-400 mt-0.5">Todos los partidos contabilizados (${counted.length}). Pts → DIF → GF.</p>
    </div>
    <div class="overflow-x-auto">
      <table class="tm-league-table">
        <thead><tr>
          <th class="tlg-pos">#</th>
          <th class="tlg-team text-left">Equipo</th>
          <th title="PJ">PJ</th><th title="Ganados">G</th><th title="Empatados">E</th>
          <th title="Perdidos">P</th><th title="GF">GF</th><th title="GC">GC</th>
          <th title="DIF">DIF</th><th title="Puntos" class="tlg-pts">PTS</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>`;
}

/* ═══════════════════════════════════════════════════════════════
  const played = allMatches.filter(m => m.played);

  // ── Clasificación global de equipos ─────────────────────────
  // Agrupa TODOS los partidos jugados (grupos + KO)
  const teamsMap = {};
  function ensureTeam(name, flag) {
    if (!name || !teamsMap[name]) {
      teamsMap[name] = { name, flag: flag || "", pj: 0, pg: 0, pe: 0, pp: 0, gf: 0, gc: 0 };
    }
  }
  played.forEach(m => {
    // Ignorar partidos con nombres de equipos no resueltos (slots)
    const isRealTeam = n => n && !/^(W|L)\d|^\d+[A-Z]|^[A-Z]\d/.test(n) && !n.startsWith("Por def");
    if (!isRealTeam(m.home) || !isRealTeam(m.away)) return;

    ensureTeam(m.home, m.flag_home);
    ensureTeam(m.away, m.flag_away);
    const gh = m.goals_l ?? 0, ga = m.goals_v ?? 0;
    const h = teamsMap[m.home], a = teamsMap[m.away];
    h.pj++; a.pj++;
    h.gf += gh; h.gc += ga;
    a.gf += ga; a.gc += gh;
    if (gh > ga)      { h.pg++; a.pp++; }
    else if (gh < ga) { a.pg++; h.pp++; }
    else              { h.pe++; a.pe++; }
  });

  const teamsList = Object.values(teamsMap)
    .filter(t => t.pj > 0)
    .map(t => ({ ...t, pts: t.pg * 3 + t.pe, dif: t.gf - t.gc }))
    .sort((a, b) =>
      (b.pts - a.pts) || (b.dif - a.dif) || (b.gf - a.gf) || a.name.localeCompare(b.name)
    );

  const totalPlayed = played.filter(m => {
    const isRealTeam = n => n && !/^(W|L)\d|^\d+[A-Z]|^[A-Z]\d/.test(n);
    return isRealTeam(m.home) && isRealTeam(m.away);
  }).length;

  const teamTableHtml = teamsList.length ? `
    <div class="card overflow-hidden mb-6">
      <div class="px-5 py-4 border-b" style="border-color:var(--border)">
        <h2 class="text-base font-bold text-white">Clasificación general de equipos</h2>
        <p class="text-xs text-gray-400 mt-0.5">Todos los partidos jugados (${totalPlayed} partidos). Ordenado por puntos, después diferencia de goles y goles a favor.</p>
      </div>
      <div class="overflow-x-auto">
        <table class="tm-league-table">
          <thead>
            <tr>
              <th class="tlg-pos">#</th>
              <th class="tlg-team text-left">Equipo</th>
              <th title="Partidos jugados">PJ</th>
              <th title="Ganados">G</th>
              <th title="Empatados">E</th>
              <th title="Perdidos">P</th>
              <th title="Goles a favor">GF</th>
              <th title="Goles en contra">GC</th>
              <th title="Diferencia de goles">DIF</th>
              <th title="Puntos" class="tlg-pts">PTS</th>
            </tr>
          </thead>
          <tbody>
            ${teamsList.map((t, i) => {
              const difStr = t.dif > 0 ? `+${t.dif}` : `${t.dif}`;
              const difCls = t.dif > 0 ? "tlg-pos-num" : t.dif < 0 ? "tlg-neg" : "";
              return `<tr class="tlg-row ${t.pj === 0 ? "tlg-no-games" : ""}">
                <td class="tlg-pos">${i + 1}</td>
                <td class="tlg-team"><span class="tlg-flag">${t.flag}</span><button class="team-name-btn" data-team="${escapeHtml(t.name)}">${escapeHtml(t.name)}</button></td>
                <td>${t.pj}</td>
                <td class="tlg-g">${t.pg}</td>
                <td>${t.pe}</td>
                <td class="tlg-l">${t.pp}</td>
                <td>${t.gf}</td>
                <td>${t.gc}</td>
                <td class="${difCls}">${difStr}</td>
                <td class="tlg-pts tlg-pts-val">${t.pts}</td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
    </div>` : `<div class="card p-5 mb-6 text-gray-500 text-sm">Aún no hay partidos jugados.</div>`;

  // ── Máximos goleadores ──────────────────────────────────────
  const scorersMap = {};
  played.forEach(m => {
    (m.scorers || []).forEach(s => {
      const name = s.player;
      if (!name) return;
      const side = s.team === "home" ? "home" : "away";
      const team = side === "home" ? m.home : m.away;
      const flag = side === "home" ? (m.flag_home || "") : (m.flag_away || "");
      if (!scorersMap[name]) {
        scorersMap[name] = { name, team, flag, goals: 0, pens: 0, og: 0, matches: new Set() };
      }
      if (s.own_goal) {
        scorersMap[name].og++;
      } else {
        scorersMap[name].goals++;
        if (s.penalty) scorersMap[name].pens++;
      }
      scorersMap[name].matches.add(m.name);
      // Actualizar equipo (puede haber jugado en otro equipo en KO)
      scorersMap[name].team = team;
      scorersMap[name].flag = flag;
    });
  });

  const scorersList = Object.values(scorersMap)
    .filter(s => s.goals > 0)
    .map(s => ({ ...s, matches: s.matches.size }))
    .sort((a, b) => (b.goals - a.goals) || (a.matches - b.matches) || a.name.localeCompare(b.name));

  const scorersHtml = scorersList.length ? `
    <div class="card overflow-hidden">
      <div class="px-5 py-4 border-b" style="border-color:var(--border)">
        <h2 class="text-base font-bold text-white">⚽ Máximos goleadores</h2>
        <p class="text-xs text-gray-400 mt-0.5">Los goles en propia portería no se contabilizan. (P) = penalti.</p>
      </div>
      <div class="overflow-x-auto">
        <table class="tm-scorers-table">
          <thead>
            <tr>
              <th class="tsc-pos">#</th>
              <th class="tsc-name text-left">Jugador</th>
              <th class="tsc-team text-left">Equipo</th>
              <th title="Goles" class="tsc-g">⚽</th>
              <th title="De penalti" class="tsc-pen">(P)</th>
              <th title="Partidos" class="tsc-pj">PJ</th>
            </tr>
          </thead>
          <tbody>
            ${scorersList.map((s, i) => {
              const penStr = s.pens > 0 ? `<span class="tsc-pen-tag">${s.pens}P</span>` : "—";
              return `<tr>
                <td class="tsc-pos">${i + 1}</td>
                <td class="tsc-name"><button class="tsc-player">${escapeHtml(s.name)}</button></td>
                <td class="tsc-team"><span class="tsc-flag">${s.flag}</span><button class="team-name-btn" data-team="${escapeHtml(s.team)}">${escapeHtml(s.team)}</button></td>
                <td class="tsc-g tsc-g-val">${s.goals}</td>
                <td class="tsc-pen">${penStr}</td>
                <td class="tsc-pj">${s.matches}</td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
    </div>` : `<div class="card p-5 text-gray-500 text-sm">Aún no hay goleadores registrados.</div>`;

/* ═══════════════════════════════════════════════════════════════
   BRACKET — Eliminatoria
═══════════════════════════════════════════════════════════════ */
function renderBracket(overrideEl) {
  const container = overrideEl || document.getElementById("bracket-container");
  if (!container || !D) return;

  // ── Definición de rondas (fases reales con fechas válidas) ──
  const ROUNDS = [
    { phase: "r16", label: "16avos",    sub: "16 partidos" },
    { phase: "r4",  label: "Octavos",   sub: "8 partidos"  },
    { phase: "r2",  label: "Cuartos",   sub: "4 partidos"  },
    { phase: "r34", label: "Semis",     sub: "2 partidos"  },
  ];
  const MONTH_SHORT = ["","ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];

  function getRealMatches(phase) {
    return (D.matches || [])
      .filter(m => m.phase === phase && m.date && m.date.startsWith("2026"))
      .sort((a, b) => (a.date + (a.time_es || "")).localeCompare(b.date + (b.time_es || "")));
  }

  const byPhase = {};
  ROUNDS.forEach(r => { byPhase[r.phase] = getRealMatches(r.phase); });
  const finalAll = getRealMatches("final").sort((a, b) => a.date.localeCompare(b.date));
  const finalMatch = finalAll.find(m => m.name && m.name.startsWith("W")) || null;
  const thirdMatch = finalAll.find(m => m.name && m.name.startsWith("L")) || null;

  function isPlaceholder(name) {
    return !name || /^(W|L)\d|^\d+[A-Z]|^[A-Z]\d|^Por def/i.test(name) || name.trim() === "";
  }

  // Resolver slot provisional (ej "1A"→1º gA, "2B"→2º gB, "3ABCD"→mejor 3º de esos grupos)
  function _resolveSlot(slot) {
    if (!slot || !D) return null;
    // Patrón "1A" o "2C" → posición + letra
    const m1 = slot.match(/^([12])([A-L])$/);
    if (m1) {
      const pos = parseInt(m1[1]) - 1;
      const grp = m1[2];
      const table = _computeGroupStanding(grp);
      const t = table[pos];
      return t ? { name: t.name, flag: t.flag } : null;
    }
    // Patrón "3ABCDF" → mejor 3.º de entre esos grupos
    const m3 = slot.match(/^3([A-L]+)$/);
    if (m3) {
      const letters = m3[1].split("");
      const thirds = _computeAllThirds().filter(t => letters.includes(t.group));
      const best = thirds[0];
      return best ? { name: best.name, flag: best.flag || "" } : null;
    }
    return null;
  }

  function matchCard(m, extra) {
    const cls = extra || "";
    if (!m) {
      return `<div class="bkt-card bkt-tbd${cls ? " " + cls : ""}">
        <div class="bkt-team"><span class="bkt-ph">Por definir</span></div>
        <div class="bkt-mid bkt-no-date">—</div>
        <div class="bkt-team"><span class="bkt-ph">Por definir</span></div>
      </div>`;
    }
    const played = m.played;
    const gh = m.goals_l ?? 0, ga = m.goals_v ?? 0;
    const winH = played && gh > ga, winA = played && ga > gh;
    const [,mo,dd] = (m.date || "").split("-");
    const dateStr = mo ? `${parseInt(dd)} ${MONTH_SHORT[parseInt(mo)]}` : "";
    const timeStr = m.time_es || "";
    const midHtml = played
      ? `<div class="bkt-mid bkt-score${gh === ga ? " bkt-draw" : ""}">${gh}–${ga}</div>`
      : `<div class="bkt-mid bkt-time">${timeStr}<span class="bkt-dt">${dateStr}</span></div>`;
    const ph_h = isPlaceholder(m.home), ph_a = isPlaceholder(m.away);
    // Intentar resolver slots de grupo (1A, 2B, 3ABCD) provisionalmente
    const isGroupSlot = s => s && /^[123][A-L]/.test(s);
    const provH = ph_h && isGroupSlot(m.home) ? _resolveSlot(m.home) : null;
    const provA = ph_a && isGroupSlot(m.away) ? _resolveSlot(m.away) : null;
    const da = m.date ? `data-date="${m.date}" data-match="${(m.name || "").replace(/"/g, "&quot;")}"` : "";
    function teamHtml(isPh, prov, slot, flag, name, isWin) {
      if (!isPh) return `<div class="bkt-team${isWin ? " bkt-win" : ""}"><span class="bkt-fl">${flag || "🛡"}</span><span class="bkt-tn">${escapeHtml(name)}</span></div>`;
      if (prov) return `<div class="bkt-team"><span class="bkt-fl">${prov.flag || "🛡"}</span><span class="bkt-tn bkt-prov" title="Provisional según clasificación actual">${escapeHtml(prov.name)}<span class="bkt-prov-slot">${slot}</span></span></div>`;
      return `<div class="bkt-team"><span class="bkt-fl">🛡</span><span class="bkt-tn"><span class="bkt-ph">Por definir</span></span></div>`;
    }
    return `<div class="bkt-card${played ? " bkt-played" : ""}${m.date ? " grp-match-link bkt-click" : ""}${cls ? " " + cls : ""}" ${da}>
      ${teamHtml(ph_h, provH, m.home, m.flag_home, m.home, winH)}
      ${midHtml}
      ${teamHtml(ph_a, provA, m.flag_away, m.flag_away, m.away, winA)}
    </div>`;
  }

  // ── Vista DESKTOP: bracket horizontal scrollable ──
  function buildDesktopBracket() {
    let html = `<div class="bkt-track">`;

    ROUNDS.forEach(({ phase, label, sub }, roundIdx) => {
      const ms = byPhase[phase];
      const count = { r16: 16, r4: 8, r2: 4, r34: 2 }[phase];
      const sf = { r16: 1, r4: 2, r2: 4, r34: 8 }[phase]; // slot factor

      html += `<div class="bkt-col bkt-col-${phase}" style="--sf:${sf}">
        <div class="bkt-col-hd">${label}<span>${sub}</span></div>
        <div class="bkt-col-body">`;

      for (let i = 0; i < count; i += 2) {
        const isLastRound = roundIdx === ROUNDS.length - 1;
        html += `<div class="bkt-pair${isLastRound ? " bkt-pair-last" : ""}">
          <div class="bkt-slot">${matchCard(ms[i] || null)}</div>
          <div class="bkt-slot">${matchCard(ms[i + 1] || null)}</div>
        </div>`;
      }

      html += `</div></div>`;
    });

    // Columna final
    html += `<div class="bkt-col bkt-col-final">
      <div class="bkt-col-hd">Final<span>2 partidos</span></div>
      <div class="bkt-col-body bkt-col-final-body">
        <div class="bkt-final-inner">
          <div class="bkt-final-lbl">🏆 Final · 19 jul</div>
          ${matchCard(finalMatch, "bkt-card-final")}
          <div class="bkt-final-lbl bkt-3rd-lbl">3.er y 4.º puesto · 18 jul</div>
          ${matchCard(thirdMatch, "bkt-card-3rd")}
        </div>
      </div>
    </div>`;

    html += `</div>`;
    return html;
  }

  // ── Vista MÓVIL: acordeón vertical por ronda ──
  function buildMobileBracket() {
    const MOB_ROUNDS = [
      { phase: "r16",      label: "16avos",  count: 16 },
      { phase: "r4",       label: "Octavos", count: 8  },
      { phase: "r2",       label: "Cuartos", count: 4  },
      { phase: "r34",      label: "Semis",   count: 2  },
      { phase: "r34_final",label: "Final",   count: 2  },
    ];

    // Generar contenido de cada ronda
    function roundContent(phase) {
      if (phase === "r34_final") {
        const semis = byPhase["r34"];
        return `
          <div class="bkt-mob-lbl">Semifinales</div>
          ${semis.map(m => matchCard(m, "bkt-mob-card")).join("")}
          <div class="bkt-mob-lbl">3.er y 4.º puesto · 18 jul</div>
          ${matchCard(thirdMatch, "bkt-mob-card")}
          <div class="bkt-mob-lbl">🏆 Final · 19 jul</div>
          ${matchCard(finalMatch, "bkt-mob-card")}`;
      }
      const ms = byPhase[phase];
      const count = { r16: 16, r4: 8, r2: 4, r34: 2 }[phase];
      return Array.from({ length: count }, (_, i) => matchCard(ms[i] || null, "bkt-mob-card")).join("");
    }

    // Progreso por ronda
    function prog(phase) {
      if (phase === "r34_final") {
        const s = byPhase["r34"].filter(m => m.played).length;
        const f = (finalMatch?.played ? 1 : 0) + (thirdMatch?.played ? 1 : 0);
        return `${s + f}/4`;
      }
      const ms = byPhase[phase];
      const count = { r16: 16, r4: 8, r2: 4, r34: 2 }[phase];
      return `${ms.filter(m => m.played).length}/${count}`;
    }

    const tabsHtml = MOB_ROUNDS.map((r, i) =>
      `<button class="bkt-mob-tab${i === 0 ? " active" : ""}" data-bkt-round="${r.phase}">${r.label}<span class="bkt-mob-tab-prog">${prog(r.phase)}</span></button>`
    ).join("");

    const firstContent = roundContent(MOB_ROUNDS[0].phase);
    let _mobRoundIdx = 0;

    function navBtnsHtml(idx) {
      const hasPrev = idx > 0;
      const hasNext = idx < MOB_ROUNDS.length - 1;
      const nextLabel = hasNext ? MOB_ROUNDS[idx + 1].label : "";
      const prevLabel = hasPrev ? MOB_ROUNDS[idx - 1].label : "";
      return `<div class="bkt-mob-nav">
        <button class="bkt-mob-nav-btn bkt-mob-nav-prev" data-dir="-1" ${hasPrev ? "" : "disabled"}>${hasPrev ? "← " + prevLabel : ""}</button>
        <span class="bkt-mob-nav-label">${MOB_ROUNDS[idx].label}</span>
        <button class="bkt-mob-nav-btn bkt-mob-nav-next" data-dir="1" ${hasNext ? "" : "disabled"}>${hasNext ? nextLabel + " →" : ""}</button>
      </div>`;
    }

    return `<div class="bkt-mobile">
      <div class="bkt-mob-tabs" id="bkt-mob-tabs">${tabsHtml}</div>
      <div class="bkt-mob-body" id="bkt-mob-body">${firstContent}</div>
      <div id="bkt-mob-nav-wrap">${navBtnsHtml(0)}</div>
    </div>`;
  }

  const isMobile = window.matchMedia("(max-width: 767px)").matches;
  const isEmbedded = !!overrideEl;

  container.innerHTML = `
    <div class="bkt-root${isEmbedded ? " bkt-root-embedded" : ""}">
      ${isEmbedded ? "" : `<div class="bkt-title-bar"><h2 class="bkt-main-title">⚔️ Eliminatoria</h2><p class="bkt-sub">Cruces de la fase eliminatoria · se actualiza automáticamente</p></div>`}
      ${isEmbedded ? "" : _worldProvBanner()}
      ${isMobile
        ? buildMobileBracket()
        : `<div class="bkt-scroll-wrap">${buildDesktopBracket()}</div>`
      }
    </div>`;

  // Tabs móvil: listener de clicks + flechas prev/next
  if (isMobile) {
    const tabsEl = container.querySelector("#bkt-mob-tabs");
    const bodyEl = container.querySelector("#bkt-mob-body");
    const navWrap = container.querySelector("#bkt-mob-nav-wrap");
    const MOB_ROUNDS_REF = [
      { phase: "r16", label: "16avos", count: 16 },
      { phase: "r4", label: "Octavos", count: 8 },
      { phase: "r2", label: "Cuartos", count: 4 },
      { phase: "r34", label: "Semis", count: 2 },
      { phase: "r34_final", label: "Final", count: 2 },
    ];
    let currentIdx = 0;

    function switchMobRound(idx) {
      if (idx < 0 || idx >= MOB_ROUNDS_REF.length) return;
      currentIdx = idx;
      const r = MOB_ROUNDS_REF[idx];
      tabsEl.querySelectorAll(".bkt-mob-tab").forEach(b => b.classList.toggle("active", b.dataset.bktRound === r.phase));
      const phase = r.phase;
      if (phase === "r34_final") {
        bodyEl.innerHTML = `
          <div class="bkt-mob-lbl">Semifinales</div>
          ${byPhase["r34"].map(m => matchCard(m, "bkt-mob-card")).join("")}
          <div class="bkt-mob-lbl">3.er y 4.º puesto · 18 jul</div>
          ${matchCard(thirdMatch, "bkt-mob-card")}
          <div class="bkt-mob-lbl">🏆 Final · 19 jul</div>
          ${matchCard(finalMatch, "bkt-mob-card")}`;
      } else {
        const ms = byPhase[phase];
        const count = { r16: 16, r4: 8, r2: 4, r34: 2 }[phase];
        bodyEl.innerHTML = Array.from({ length: count }, (_, i) => matchCard(ms[i] || null, "bkt-mob-card")).join("");
      }
      bodyEl.scrollTop = 0;
      // Update nav buttons
      if (navWrap) {
        const hasPrev = idx > 0, hasNext = idx < MOB_ROUNDS_REF.length - 1;
        navWrap.innerHTML = `<div class="bkt-mob-nav">
          <button class="bkt-mob-nav-btn bkt-mob-nav-prev" data-dir="-1" ${hasPrev ? "" : "disabled"}>${hasPrev ? "\u2190 " + MOB_ROUNDS_REF[idx-1].label : ""}</button>
          <span class="bkt-mob-nav-label">${r.label}</span>
          <button class="bkt-mob-nav-btn bkt-mob-nav-next" data-dir="1" ${hasNext ? "" : "disabled"}>${hasNext ? MOB_ROUNDS_REF[idx+1].label + " \u2192" : ""}</button>
        </div>`;
        navWrap.querySelector(".bkt-mob-nav-prev")?.addEventListener("click", () => switchMobRound(currentIdx - 1));
        navWrap.querySelector(".bkt-mob-nav-next")?.addEventListener("click", () => switchMobRound(currentIdx + 1));
      }
    }

    if (tabsEl) {
      tabsEl.addEventListener("click", e => {
        const btn = e.target.closest(".bkt-mob-tab");
        if (!btn) return;
        const phase = btn.dataset.bktRound;
        const idx = MOB_ROUNDS_REF.findIndex(r => r.phase === phase);
        if (idx >= 0) switchMobRound(idx);
      });
    }
    // Wire up initial nav buttons
    navWrap?.querySelector(".bkt-mob-nav-next")?.addEventListener("click", () => switchMobRound(currentIdx + 1));
    navWrap?.querySelector(".bkt-mob-nav-prev")?.addEventListener("click", () => switchMobRound(currentIdx - 1));
  }

  // Re-render al cruzar breakpoint (solo desde el bracket-container original)
  const realBktEl = document.getElementById("bracket-container");
  if (realBktEl && !realBktEl.dataset.resizeBound) {
    realBktEl.dataset.resizeBound = "1";
    let _wasM = window.matchMedia("(max-width: 767px)").matches;
    window.addEventListener("resize", () => {
      const isM = window.matchMedia("(max-width: 767px)").matches;
      if (isM !== _wasM) {
        _wasM = isM;
        if (!document.getElementById("tab-bracket").classList.contains("hidden")) {
          renderBracket();
        }
        const tmsEl = document.getElementById("tms-bracket-inner");
        if (tmsEl) renderBracket(tmsEl);
      }
    });
  }
}

function renderCalendar() {
  const container = document.getElementById("cal-container");
  if (!container || !D) return;

  const today = todaySpainISO(); // "YYYY-MM-DD"

  // ── Filtro de vista (Hoy / Esta semana / Este mes) ──
  const filter = document.getElementById("cal-view-filter");
  if (filter && !filter.dataset.bound) {
    filter.dataset.bound = "1";
    filter.querySelectorAll(".cal-view-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        calView = btn.dataset.view;
        calOffset = 0; // al cambiar de vista volvemos al periodo actual
        renderCalendar();
      });
    });
    // Re-render al cruzar el breakpoint móvil/web (la vista semana cambia
    // entre listado y rejilla según el ancho).
    let _wasMobile = window.matchMedia("(max-width: 767px)").matches;
    window.addEventListener("resize", () => {
      const isMobile = window.matchMedia("(max-width: 767px)").matches;
      if (isMobile !== _wasMobile) {
        _wasMobile = isMobile;
        if (calView === "week" && !document.getElementById("tab-calendar").classList.contains("hidden")) {
          renderCalendar();
        }
      }
    });
  }
  if (filter) {
    filter.querySelectorAll(".cal-view-btn").forEach(b =>
      b.classList.toggle("active", b.dataset.view === calView));
  }

  // Index matches by ISO date
  const byDate = {};
  (D.matches || []).forEach(m => {
    if (!m.date || m.date.length < 10) return;
    const d = m.date.slice(0, 10);
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(m);
  });
  // Ordenar los partidos de cada día por hora
  Object.values(byDate).forEach(arr =>
    arr.sort((a, b) => (a.time_es || "").localeCompare(b.time_es || "")));

  // Límites del Mundial (para no dejar navegar fuera de junio/julio)
  const { first: wcFirst, last: wcLast } = _calWcBounds(byDate);

  // ── Vistas Hoy / Mañana (un solo día, con flechas día a día) ──
  if (calView === "day" || calView === "tomorrow") {
    const base = calView === "tomorrow" ? _calAddDays(today, 1) : today;
    let refDate = _calAddDays(base, calOffset);
    if (wcFirst && refDate < wcFirst) refDate = wcFirst;
    if (wcLast && refDate > wcLast) refDate = wcLast;
    const canPrev = !!wcFirst && refDate > wcFirst;
    const canNext = !!wcLast && refDate < wcLast;
    const title = (refDate === today ? "Hoy · " : "") + _calFmtDay(refDate);
    const empty = refDate === today ? "No hay partidos hoy." : "No hay partidos este día.";
    container.innerHTML = _calNavBar(title, canPrev, canNext) +
      _calRenderList([refDate], today, byDate, empty);
    return;
  }

  // ── Vista Esta semana (con flechas semana a semana) ──
  if (calView === "week") {
    const baseMonday = _calWeekMonday(today);
    const refMonday = _calAddDays(baseMonday, calOffset * 7);
    const days = _calWeekDays(refMonday);
    const firstMonday = wcFirst ? _calWeekMonday(wcFirst) : null;
    const lastMonday = wcLast ? _calWeekMonday(wcLast) : null;
    const canPrev = !!firstMonday && refMonday > firstMonday;
    const canNext = !!lastMonday && refMonday < lastMonday;
    // En móvil: listado con horas; en web: rejilla tipo calendario
    const isMobile = window.matchMedia("(max-width: 767px)").matches;
    const body = isMobile
      ? _calRenderList(days, today, byDate, "No hay partidos esta semana.")
      : _calRenderWeekGrid(days, today, byDate, false);
    container.innerHTML = _calNavBar(_calWeekTitle(days), canPrev, canNext) + body;
    return;
  }

  // ── Vista Este mes (rejilla, con flechas entre junio y julio) ──
  const [ty, tm] = today.split("-").map(Number);
  const baseMonth = (ty === 2026 && (tm === 6 || tm === 7)) ? tm : 6;
  let month = baseMonth + calOffset;
  if (month < 6) month = 6;
  if (month > 7) month = 7;
  const canPrev = month > 6;
  const canNext = month < 7;
  const label = (month === 6 ? "Junio" : "Julio") + " 2026";
  container.innerHTML = _calNavBar(label, canPrev, canNext) +
    _calRenderMonthGrid(2026, month, label, today, byDate, false);
}

function goToMatchesDay(isoDate, matchName) {
  // 1. Switch to matches tab MANUALLY (avoid the click handler's scroll-to-today)
  document.querySelectorAll(".tab-btn").forEach(b =>
    b.classList.toggle("active", b.dataset.tab === "matches"));
  ["matches","calendar","standings","progression","stats","honor","bracket","teams","bets","scoring","info","h2h"].forEach(t => {
    const sec = document.getElementById("tab-" + t);
    if (sec) sec.classList.toggle("hidden", t !== "matches");
  });
  if (typeof setNavCurrent === "function") setNavCurrent("⚽ Partidos");
  scrollMatchesToToday = false; // do NOT auto-scroll to today; we scroll to the target

  // 2. Calculate how far the target date is from today and expand the day window
  const today = todaySpainISO();
  const diffDays = (a, b) => {
    const da = new Date(a + "T00:00:00Z");
    const db = new Date(b + "T00:00:00Z");
    return Math.round((da - db) / 86400000);
  };
  const delta = diffDays(isoDate, today);
  if (delta > 0) matchesDaysAfter  = Math.max(matchesDaysAfter,  delta + 1);
  if (delta < 0) matchesDaysBefore = Math.max(matchesDaysBefore, -delta + 1);

  // 3. Show all weeks and re-render
  currentWeek = null;
  renderMatches(currentPhase, currentWeek);

  // 4. Scroll to day header and ensure accordion is open
  const scrollTo = () => {
    const el = document.getElementById("day-" + isoDate);
    if (!el) return;

    // Collapse every other day so the page isn't a huge scroll — keep only the target open
    document.querySelectorAll("#matches-list .day-header").forEach(h => {
      const isTarget = h.id === "day-" + isoDate;
      h.classList.toggle("collapsed", !isTarget);
      const dm = h.nextElementSibling;
      if (dm && dm.classList.contains("day-matches")) dm.classList.toggle("collapsed", !isTarget);
    });

    el.scrollIntoView({ behavior: "smooth", block: "start" });

    // Pulse to clearly show the user which match they picked.
    // If a specific match was clicked, pulse only that one; otherwise pulse the whole day.
    const dayMatches = el.nextElementSibling;
    let targets = dayMatches ? [...dayMatches.querySelectorAll(".match-row")] : [];
    if (matchName) {
      const one = targets.find(c => c.getAttribute("data-match-name") === matchName);
      if (one) {
        targets = [one];
        one.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
    targets.forEach(c => {
      c.classList.remove("match-pulse");
      void c.offsetWidth; // restart animation
      c.classList.add("match-pulse");
      setTimeout(() => c.classList.remove("match-pulse"), 2100);
    });
  };
  setTimeout(scrollTo, 120);
}

/* ═══════════════════════════════════════════════════════════════
   TAB NAVIGATION
═══════════════════════════════════════════════════════════════ */
/* ── menú lateral deslizante (hamburger drawer, solo móvil) ── */
function setNavCurrent(label) {
  const el = document.getElementById("nav-current");
  if (el && label) el.textContent = label;
}
function openNav() {
  document.body.classList.add("nav-open");
  document.getElementById("nav-burger")?.setAttribute("aria-expanded", "true");
  document.getElementById("nav-drawer")?.setAttribute("aria-hidden", "false");
}
function closeNav() {
  document.body.classList.remove("nav-open");
  document.getElementById("nav-burger")?.setAttribute("aria-expanded", "false");
  document.getElementById("nav-drawer")?.setAttribute("aria-hidden", "true");
}
(function() {
  document.getElementById("nav-burger")?.addEventListener("click", () => {
    document.body.classList.contains("nav-open") ? closeNav() : openNav();
  });
  document.getElementById("nav-drawer-close")?.addEventListener("click", closeNav);
  document.getElementById("nav-overlay")?.addEventListener("click", closeNav);
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeNav(); });
})();

/* ── dropdown "Más" (solo escritorio) ── */
(function() {
  const btn  = document.getElementById("tab-more-btn");
  const drop = document.getElementById("tab-more-dropdown");
  if (!btn || !drop) return;
  btn.addEventListener("click", e => {
    e.stopPropagation();
    const open = !drop.classList.contains("hidden");
    drop.classList.toggle("hidden", open);
    btn.setAttribute("aria-expanded", String(!open));
  });
  document.addEventListener("click", () => {
    drop.classList.add("hidden");
    btn.setAttribute("aria-expanded", "false");
  });
  drop.addEventListener("click", e => e.stopPropagation());
  function syncMoreBtn() {
    const anyActive = !!drop.querySelector(".tab-btn.active");
    btn.classList.toggle("has-active", anyActive);
  }
  document.addEventListener("tabChanged", syncMoreBtn);
  syncMoreBtn();
})();

function closeMoreDropdown() {
  document.getElementById("tab-more-dropdown")?.classList.add("hidden");
  document.getElementById("tab-more-btn")?.setAttribute("aria-expanded", "false");
}

/** Navega a la pestaña Clasificaciones Mundial y activa la sub-tab indicada.
 *  Funciona desde cualquier pestaña y desde dentro de modales.
 *  opts.scroll (por defecto true): si es false, no hace scroll adicional al
 *  sub-body — se usa para los accesos directos de la nav, donde el cambio de
 *  pestaña ya coloca la vista en el inicio del contenido. */
function goToTeamsSubTab(stab, opts = {}) {
  const scroll = opts.scroll !== false;
  // 1. Cerrar cualquier modal abierto
  document.getElementById("group-modal")?.classList.add("hidden");
  document.getElementById("team-modal")?.classList.add("hidden");
  document.body.style.overflow = "";
  // 2. Activar pestaña "teams" (simula click en el tab-btn)
  const teamsBtn = document.querySelector('.tab-btn[data-tab="teams"]');
  if (teamsBtn) {
    teamsBtn.click();
  } else {
    // fallback manual
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === "teams"));
    ["matches","calendar","standings","progression","stats","honor","bracket","teams","bets","scoring","info","h2h"].forEach(t => {
      document.getElementById("tab-" + t)?.classList.toggle("hidden", t !== "teams");
    });
    if (typeof renderTeams === "function" && D) renderTeams();
  }
  // 3. Cambiar sub-tab tras breve espera para que renderTeams haya montado el shell
  setTimeout(() => _switchTeamsSubTab(stab, scroll), 80);
}

/** Lleva la vista al inicio del contenido (nav sticky pegado arriba, cabecera
 *  oculta). Calcula la altura del nav visible y posiciona el <main> justo
 *  debajo. */
function scrollToContentTop() {
  const main = document.querySelector("main");
  if (!main) { window.scrollTo({ top: 0, behavior: "instant" }); return; }
  const navEl = [...document.querySelectorAll(".desktop-nav, .mobile-nav")]
    .find(n => n.offsetParent !== null);
  const navH = navEl ? navEl.offsetHeight : 0;
  const target = main.getBoundingClientRect().top + window.scrollY - navH;
  window.scrollTo({ top: Math.max(0, target), behavior: "instant" });
}

document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const tab = btn.dataset.tab;
    if (!tab) return;
    // Sincroniza el estado activo en ambas navegaciones (escritorio + móvil)
    document.querySelectorAll(".tab-btn").forEach(b =>
      b.classList.toggle("active", b.dataset.tab === tab));
    setNavCurrent(btn.textContent.trim());
    closeNav();
    closeMoreDropdown();
    if (typeof closeTeamSearchSheet === "function") closeTeamSearchSheet();
    ["matches","calendar","standings","progression","stats","honor","bracket","teams","bets","scoring","info","h2h"].forEach(t => {
      document.getElementById("tab-"+t).classList.toggle("hidden", t !== tab);
    });
    if (typeof updateNavSearchBtn === "function") updateNavSearchBtn();
    document.dispatchEvent(new CustomEvent("tabChanged"));
    // Coloca la vista al inicio del contenido: nav pegado arriba y cabecera
    // oculta (no aporta nada al cambiar de pestaña). Si el usuario hace scroll
    // hacia arriba, la cabecera reaparece de forma natural.
    scrollToContentTop();
    if (tab === "matches") scrollMatchesToToday = true;
    if (tab === "progression" && D) renderProgression();
    if (tab === "stats" && D) renderStats();
    if (tab === "teams" && D) renderTeams();
    if (tab === "bets") renderBets();
    if (tab === "matches" && D) renderMatches(currentPhase, currentWeek);
    if (tab === "scoring" && D) renderScoring();
    if (tab === "h2h" && D) renderH2H();
  });
});

/* ── Accesos directos del modo público: navegan a una sub-sección de
      "Clasificaciones Mundial" como si fueran pestañas de primer nivel ── */
document.querySelectorAll(".subnav-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const stab = btn.dataset.stab;
    if (!stab) return;
    closeNav();
    closeMoreDropdown();
    if (typeof closeTeamSearchSheet === "function") closeTeamSearchSheet();
    // goToTeamsSubTab activa la pestaña "teams" (que desmarca toda la nav)
    // y conmuta la sub-tab; marcamos este acceso directo como activo después.
    // scroll:false → el cambio de pestaña ya posiciona la vista (sin empujón).
    goToTeamsSubTab(stab, { scroll: false });
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(`.subnav-btn[data-stab="${stab}"]`).forEach(b => b.classList.add("active"));
    setNavCurrent(btn.textContent.trim());
  });
});

/* ═══════════════════════════════════════════════════════════════
   PHASE FILTER
═══════════════════════════════════════════════════════════════ */
document.querySelectorAll(".phase-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".phase-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentPhase = btn.dataset.phase;
    resetMatchesDayWindow();
    scrollMatchesToToday = true;
    if (D) renderMatches(currentPhase, currentWeek);
  });
});

/* ═══════════════════════════════════════════════════════════════
   INIT
═══════════════════════════════════════════════════════════════ */

// On tab change, scroll the nav so the active button is visible (mobile)
function scrollNavToActive() {
  const nav   = document.getElementById("tab-nav-scroll");
  const active = nav?.querySelector(".tab-btn.active");
  if (!nav || !active) return;
  const navLeft  = nav.getBoundingClientRect().left;
  const btnLeft  = active.getBoundingClientRect().left;
  const btnRight = active.getBoundingClientRect().right;
  const navRight = nav.getBoundingClientRect().right;
  if (btnLeft < navLeft + 8) {
    nav.scrollBy({ left: btnLeft - navLeft - 8, behavior: "smooth" });
  } else if (btnRight > navRight - 8) {
    nav.scrollBy({ left: btnRight - navRight + 8, behavior: "smooth" });
  }
}

document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => setTimeout(scrollNavToActive, 50));
});

// Banner de hora: visible y dinámico desde el primer momento
document.getElementById("update-banner")?.classList.remove("hidden");
startCountdown();

/* ═══════════════════════════════════════════════════════════════
   ADMIN PANEL — desbloqueo secreto: 6 clics en el contador de visitas
   + contraseña (se guarda solo el hash SHA-256, nunca el texto)
═══════════════════════════════════════════════════════════════ */
// SHA-256 de la contraseña de admin. El texto en claro NO está en el código.
const ADMIN_PASS_HASH = "1b5c3adff66e91951d10c58faba0be3167fcb6ceecabf87f35d972e317f42283";

async function _sha256Hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

(function initAdminUnlock() {
  const NEEDED = 4;
  let clicks = 0, timer = null;

  // En móvil (pantalla táctil) se abre con pulsación larga para evitar el
  // zoom que provoca pulsar varias veces seguidas. En escritorio se mantienen
  // las 4 pulsaciones de siempre.
  // Detectamos "móvil de verdad": puntero principal grueso (dedo) y sin ratón
  // disponible (un portátil táctil con ratón seguirá usando las 4 pulsaciones).
  const mq = q => { try { return window.matchMedia(q).matches; } catch { return false; } };
  const isTouch = (mq("(pointer: coarse)") && !mq("(any-pointer: fine)"))
    || (!window.matchMedia && ("ontouchstart" in window || navigator.maxTouchPoints > 0));

  function reset() { clicks = 0; }

  function showHint(msg) {
    const wrap = document.getElementById("visitor-counter");
    if (!wrap) return;
    wrap.querySelectorAll(".admin-hint").forEach(h => h.remove());
    const h = document.createElement("div");
    h.className = "admin-hint";
    h.textContent = msg;
    // El contador es position:fixed, así que ya es contenedor de hijos absolutos.
    // NO cambiamos su position (eso lo hacía saltar de sitio y rompía los clics).
    wrap.appendChild(h);
    setTimeout(() => h.remove(), 1400);
  }

  if (isTouch) {
    // ── Pulsación larga (long-press) en móvil ──
    // Atamos los listeners SOLO al contador para no interferir con el resto
    // de la página (p. ej. el input de contraseña del propio panel).
    const LONG_MS = 650;
    let pressTimer = null, fired = false, startY = 0, startX = 0;

    function clearPress() {
      clearTimeout(pressTimer);
      pressTimer = null;
    }

    function bind(counter) {
      if (!counter || counter.dataset.lpBound === "1") return;
      counter.dataset.lpBound = "1";

      counter.addEventListener("touchstart", e => {
        const t = e.touches ? e.touches[0] : e;
        startX = t.clientX; startY = t.clientY;
        fired = false;
        clearPress();
        pressTimer = setTimeout(() => {
          fired = true;
          if (navigator.vibrate) navigator.vibrate(30);
          openAdminGate();
        }, LONG_MS);
      }, { passive: true });

      counter.addEventListener("touchmove", e => {
        if (pressTimer == null) return;
        const t = e.touches ? e.touches[0] : e;
        if (Math.abs(t.clientX - startX) > 12 || Math.abs(t.clientY - startY) > 12) clearPress();
      }, { passive: true });

      counter.addEventListener("touchend", e => {
        // Si disparó el long-press, evita el click fantasma posterior.
        if (fired && e.cancelable) e.preventDefault();
        clearPress();
      }, { passive: false });

      counter.addEventListener("touchcancel", clearPress, { passive: true });

      // Sin menú contextual al mantener pulsado el contador.
      counter.addEventListener("contextmenu", e => e.preventDefault());

      // Bloquea el click sintético tras un long-press (solo en el contador).
      counter.addEventListener("click", e => {
        if (fired) { e.preventDefault(); e.stopPropagation(); fired = false; }
      }, true);
    }

    const counter = document.getElementById("visitor-counter");
    if (counter) bind(counter);
    else document.addEventListener("DOMContentLoaded", () => bind(document.getElementById("visitor-counter")));
  } else {
    // ── Escritorio: 4 pulsaciones ──
    document.addEventListener("click", e => {
      if (!e.target.closest("#visitor-counter")) return;
      clearTimeout(timer);
      clicks++;
      timer = setTimeout(reset, 4000);

      const remaining = NEEDED - clicks;
      if (remaining === 2)      showHint("⚡ quedan 2 más");
      else if (remaining === 1) showHint("⚡ queda 1 más");
      else if (remaining <= 0)  { reset(); clearTimeout(timer); openAdminGate(); }
    });
  }
})();

// Recuerda que ya se introdujo la contraseña en esta sesión del navegador,
// para no pedirla cada vez que se abre el panel.
const ADMIN_UNLOCK_KEY = "porra_admin_unlocked";
// Token de lectura de sugerencias (clave larga del Apps Script). Se guarda
// SOLO en este navegador (localStorage), nunca en el repo. Distinto del PIN
// para que, aunque alguien adivine el PIN de 6 cifras, no pueda leer la lista.
const FEEDBACK_TOKEN_KEY = "porra_fb_read_token";
function isAdminUnlocked() {
  try { return sessionStorage.getItem(ADMIN_UNLOCK_KEY) === "1"; }
  catch { return false; }
}
function markAdminUnlocked() {
  try { sessionStorage.setItem(ADMIN_UNLOCK_KEY, "1"); } catch { /* ignore */ }
}

function openAdminGate() {
  const modal = document.getElementById("admin-modal");
  if (!modal) return;
  // Si ya se desbloqueó en esta sesión, saltar directo al panel.
  if (isAdminUnlocked()) {
    _buildAdminPanel();
    modal.classList.remove("hidden");
    modal.classList.remove("adm-gate-mode");
    document.body.style.overflow = "hidden";
    return;
  }
  _renderAdminGate();
  modal.classList.remove("hidden");
  modal.classList.add("adm-gate-mode");
  document.body.style.overflow = "hidden";
  setTimeout(() => document.getElementById("adm-pass-input")?.focus(), 50);
}

function _renderAdminGate(error) {
  const body = document.getElementById("admin-modal-body");
  if (!body) return;
  body.innerHTML = `
    <div class="adm-gate">
      <div class="adm-gate-icon">🔒</div>
      <p class="adm-gate-text">Introduce el PIN de administrador</p>
      <form id="adm-pass-form" autocomplete="off">
        <input type="password" id="adm-pass-input" class="adm-pass-input"
          inputmode="numeric" autocomplete="off" placeholder="" aria-label="PIN" />
        <button type="submit" class="adm-pass-btn">Entrar</button>
      </form>
      ${error ? `<p class="adm-gate-error">${error}</p>` : ""}
    </div>`;
  setTimeout(() => document.getElementById("adm-pass-input")?.focus(), 80);
  const form = document.getElementById("adm-pass-form");
  form?.addEventListener("submit", async ev => {
    ev.preventDefault();
    const val = document.getElementById("adm-pass-input")?.value || "";
    const hash = await _sha256Hex(val);
    if (hash === ADMIN_PASS_HASH) {
      markAdminUnlocked();
      try { localStorage.setItem(FEEDBACK_TOKEN_KEY, val); } catch { /* ignore */ }
      document.getElementById("admin-modal")?.classList.remove("adm-gate-mode");
      _buildAdminPanel();
    } else {
      _renderAdminGate("PIN incorrecto");
      setTimeout(() => document.getElementById("adm-pass-input")?.focus(), 50);
    }
  });
}

function openAdminPanel() {
  // mantiene compatibilidad: abre directamente la puerta con contraseña
  openAdminGate();
}
function closeAdminPanel() {
  const modal = document.getElementById("admin-modal");
  if (modal) modal.classList.add("hidden");
  document.body.style.overflow = "";
}

/* ═══════════════════════════════════════════════════════════════
   GROUP MODAL
═══════════════════════════════════════════════════════════════ */
/* ═══════════════════════════════════════════════════════════════
   TEAM MODAL — todos los partidos de un equipo
═══════════════════════════════════════════════════════════════ */
function openTeamModal(teamName) {
  if (!D) return;

  // Buscar todos los partidos (cualquier fase) donde participa el equipo
  const matches = D.matches.filter(m =>
    m.home === teamName || m.away === teamName
  );
  if (!matches.length) return;

  const flag = matches.find(m => m.home === teamName)?.flag_home
            || matches.find(m => m.away === teamName)?.flag_away
            || "";

  // Separar jugados vs pendientes
  const played  = matches.filter(m => m.played);
  const pending = matches.filter(m => !m.played);

  // Calcular stats del equipo (partidos jugados + en juego, provisional)
  let pj = 0, pg = 0, pe = 0, pp = 0, gf = 0, gc = 0;
  matches.forEach(m => {
    const eff = _matchGoals(m);
    if (!eff) return;
    const isHome = m.home === teamName;
    const tf = isHome ? eff.gh : eff.ga, tc = isHome ? eff.ga : eff.gh;
    pj++; gf += tf; gc += tc;
    if (tf > tc) pg++;
    else if (tf < tc) pp++;
    else pe++;
  });

  const months = ["","ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
  const weekdays = ["dom","lun","mar","mié","jue","vie","sáb"];
  function fmtDate(d) {
    if (!d) return { short: "", full: "" };
    const [y,mo,dd] = d.split("-");
    const dt = new Date(+y, +mo - 1, +dd);
    const dow = weekdays[dt.getDay()];
    return { short: `${parseInt(dd)} ${months[+mo]}`, full: `${dow} ${parseInt(dd)} ${months[+mo]}` };
  }
  function phaseLabel(m) {
    return PHASE_LABELS[m.phase] || m.phase || "";
  }

  function matchRow(m) {
    const isHome = m.home === teamName;
    const opp = isHome ? m.away : m.home;
    const oppFlag = isHome ? (m.flag_away || "") : (m.flag_home || "");
    const played = m.played;
    const eff = _matchGoals(m);
    const date = fmtDate(m.date);

    let scoreHtml, resultCls = "";
    if (eff) {
      const tf = isHome ? eff.gh : eff.ga, tc = isHome ? eff.ga : eff.gh;
      if (tf > tc)      resultCls = "tm-win";
      else if (tf < tc) resultCls = "tm-loss";
      else              resultCls = "tm-draw";
      scoreHtml = eff.live ? `🔴 ${tf}–${tc}` : `${tf}–${tc}`;
      if (eff.live) resultCls += " tm-live";
    } else {
      scoreHtml = m.time_es ? m.time_es + " h" : "—";
      resultCls = "tm-pending";
    }

    const dataAttrs = m.date ? `data-date="${m.date}" data-match="${(m.name||"").replace(/"/g,"&quot;")}"` : "";
    return `
      <div class="grp-match-row ${played ? "grp-match-played" : ""} ${m.date ? "grp-match-link tm-row" : "tm-row"}" ${dataAttrs} title="${m.date ? "Ver partido completo" : ""}">
        <div class="grp-match-team" style="flex:1.2">${oppFlag} ${opp}</div>
        <div class="grp-match-score tm-score ${resultCls}">${scoreHtml}</div>
        <div class="tm-meta">
          ${date.full ? `<span class="tm-date-full">${date.full}</span>` : ""}
          <span class="tm-phase">${phaseLabel(m)}</span>
        </div>
      </div>`;
  }

  // ── Tabla de grupo ───────────────────────────────────────────
  const grpMatch = matches.find(m => m.phase === "groups" && m.id);
  const grpLetter = grpMatch ? grpMatch.id.charAt(0).toUpperCase() : null;
  let groupHtml = "";
  if (grpLetter) {
    const table = _computeGroupStanding(grpLetter);
    if (table.length) {
      const allThirds = _computeAllThirds();
      const thirdEntry = allThirds.find(t => t.group === grpLetter);
      const thirdRank = thirdEntry ? thirdEntry.rank : null;
      const rows = table.map((t, i) => {
        const isTeam = t.name === teamName;
        let qual = "";
        if (i < 2) qual = "grp-qual";
        else if (i === 2) qual = thirdRank !== null && thirdRank <= 8 ? "grp-third" : "grp-third grp-third-out";
        return `<tr class="${qual} ${isTeam ? "tm-grp-highlight" : ""}">
          <td>${t.flag} ${t.name}</td>
          <td>${t.pj}</td>
          <td>${t.pg}</td>
          <td>${t.pe}</td>
          <td>${t.pp}</td>
          <td>${t.gf}</td>
          <td>${t.gc}</td>
          <td>${t.gf - t.gc > 0 ? "+" : ""}${t.gf - t.gc}</td>
          <td class="grp-pts">${t.pts}</td>
        </tr>`;
      }).join("");
      const playedInGroup = D.matches.filter(m => m.phase === "groups" && m.id && m.id.charAt(0).toUpperCase() === grpLetter && m.played).length;
      const provisional = playedInGroup < 3 ? " <em style='color:#475569;font-size:.6rem'>(provisional)</em>" : "";
      const thirdQual = thirdRank !== null && thirdRank <= 8;
      const totalThirds = allThirds.length;
      const rankTxt = thirdRank !== null ? `N.º <strong>${thirdRank}</strong> de ${totalThirds} terceros` : "sin datos";
      const prov = playedInGroup < 3 ? " <em>(provisional)</em>" : "";
      const thirdsLink = `<button class="grp-thirds-link" onclick="event.stopPropagation();goToTeamsSubTab('thirds')" type="button">ver clasificación de terceros →</button>`;
      const tiedWith2nd = allThirds.find(t => t.group === grpLetter)?.tiedWithSecond;
      let thirdLegHtml = "";
      if (table[2]) {
        const teamNames = tiedWith2nd
          ? `<strong>${escapeHtml(table[2].name)}</strong> o <strong>${escapeHtml(tiedWith2nd.name)}</strong> 🎲`
          : `(${rankTxt})${prov}`;
        thirdLegHtml = thirdQual
          ? `<div class="grp-legend-item grp-legend-third-yes">🟡 3.º — <strong>clasificaría</strong>: ${teamNames} ${thirdsLink}</div>`
          : `<div class="grp-legend-item grp-legend-third-no">⬜ 3.º — <strong>no clasificaría</strong>: ${teamNames} ${thirdsLink}</div>`;
      }
      groupHtml = `
        <div>
          <div class="text-xs font-bold uppercase tracking-widest text-gray-500 mb-2">Grupo ${grpLetter}${provisional}</div>
          <div class="card overflow-hidden">
            <table class="grp-table">
              <thead><tr>
                <th style="width:40%">Equipo</th>
                <th title="PJ">PJ</th><th title="G">G</th><th title="E">E</th><th title="P">P</th>
                <th title="GF">GF</th><th title="GC">GC</th><th title="DIF">DIF</th><th title="PTS">PTS</th>
              </tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
          <div class="flex flex-col gap-0.5 mt-1.5">
            <div class="grp-legend-item grp-legend-qual">🟢 Top 2 — clasificados directamente</div>
            ${thirdLegHtml}
          </div>
        </div>`;
    }
  }

  const teamLive = matches.some(m => { const e = _matchGoals(m); return e && e.live; });
  const statsHtml = pj > 0 ? `
    <div class="tm-stats">
      <div class="tm-stat"><span class="tm-stat-val">${pj}</span><span class="tm-stat-lbl">PJ</span></div>
      <div class="tm-stat"><span class="tm-stat-val tm-win">${pg}</span><span class="tm-stat-lbl">G</span></div>
      <div class="tm-stat"><span class="tm-stat-val tm-draw">${pe}</span><span class="tm-stat-lbl">E</span></div>
      <div class="tm-stat"><span class="tm-stat-val tm-loss">${pp}</span><span class="tm-stat-lbl">P</span></div>
      <div class="tm-stat"><span class="tm-stat-val">${gf}</span><span class="tm-stat-lbl">GF</span></div>
      <div class="tm-stat"><span class="tm-stat-val">${gc}</span><span class="tm-stat-lbl">GC</span></div>
      <div class="tm-stat"><span class="tm-stat-val" style="color:${gf-gc>0?'var(--green)':gf-gc<0?'#F87171':'#94A3B8'}">${gf-gc>0?"+":""}${gf-gc}</span><span class="tm-stat-lbl">DIF</span></div>
    </div>${teamLive ? `<div class="tm-prov-note"><span class="world-prov-badge">🔴 PROVISIONAL</span> incluye el partido en juego</div>` : ""}` : "";

  // ── Cruce previsto en 16avos ─────────────────────────────────
  let r16Html = "";
  if (grpLetter) {
    const table = _computeGroupStanding(grpLetter);
    const teamPos = table.findIndex(t => t.name === teamName); // 0-based
    const allThirds = _computeAllThirds();
    const thirdEntry = allThirds.find(t => t.group === grpLetter);
    const thirdRank = thirdEntry ? thirdEntry.rank : null;

    // Slot del equipo según posición en el grupo
    // (puede ser "1X", "2X" o "3X" solo si clasificaría entre los 8 mejores terceros)
    let teamSlot = null;
    if (teamPos === 0) teamSlot = `1${grpLetter}`;
    else if (teamPos === 1) teamSlot = `2${grpLetter}`;
    else if (teamPos === 2 && thirdRank !== null && thirdRank <= 8) teamSlot = `3${grpLetter}`;

    if (teamSlot) {
      // Buscar el partido r16 que contiene este slot
      const r16Match = (D.matches || []).find(m =>
        m.phase === "r16" && m.date && m.date.startsWith("2026") &&
        (m.home === teamSlot || m.away === teamSlot ||
         // slot de tercero: "3ABCDF" incluye la letra del grupo
         (teamSlot.startsWith("3") && (
           (m.home.startsWith("3") && m.home.slice(1).includes(grpLetter)) ||
           (m.away.startsWith("3") && m.away.slice(1).includes(grpLetter))
         ))
        )
      );

      if (r16Match) {
        // Resolver el slot rival a nombre de equipo si es posible
        function resolveSlot(slot) {
          if (!slot) return { label: "Por definir", flag: "🛡", resolved: false };
          if (slot.startsWith("1") && slot.length === 2) {
            const g = slot[1].toUpperCase();
            const t = _computeGroupStanding(g)[0];
            return t ? { label: t.name, flag: t.flag, resolved: true }
                     : { label: `1.º Grupo ${g}`, flag: "", resolved: false };
          }
          if (slot.startsWith("2") && slot.length === 2) {
            const g = slot[1].toUpperCase();
            const t = _computeGroupStanding(g)[1];
            return t ? { label: t.name, flag: t.flag, resolved: true }
                     : { label: `2.º Grupo ${g}`, flag: "", resolved: false };
          }
          if (slot.startsWith("3")) {
            const thirds = _computeAllThirds();
            const grps = slot.slice(1).split("").map(c => c.toUpperCase());
            const candidates = thirds.filter(t => grps.includes(t.group));
            const qual = candidates.filter((_, i) => i < 2); // los 2 mejores de ese sub-grupo
            if (qual.length === 1) return { label: qual[0].name, flag: qual[0].flag, resolved: true };
            if (qual.length > 1) {
              const names = qual.map(t => `${t.flag} ${t.name}`).join(" o ");
              return { label: names, flag: "", resolved: false };
            }
            return { label: `Mejor 3.º (Grupos ${slot.slice(1)})`, flag: "", resolved: false };
          }
          return { label: slot, flag: "", resolved: false };
        }

        const isHome = r16Match.home === teamSlot ||
          (teamSlot.startsWith("3") && r16Match.home.startsWith("3") && r16Match.home.slice(1).includes(grpLetter));
        const rivalSlot = isHome ? r16Match.away : r16Match.home;
        const rival = resolveSlot(rivalSlot);
        const myPos = teamPos === 0 ? "1.º" : teamPos === 1 ? "2.º" : "3.º (mejor tercero)";

        const [,rmo,rdd] = (r16Match.date || "").split("-");
        const MONTHS = ["","ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
        const dateStr = rmo ? `${parseInt(rdd)} ${MONTHS[parseInt(rmo)]}` : "";
        const timeStr = r16Match.time_es || "";

        const totalGroupMatches = (D.matches || []).filter(m =>
          m.phase === "groups" && m.id && m.id.charAt(0).toUpperCase() === grpLetter).length;
        const playedGroupMatches = (D.matches || []).filter(m =>
          m.phase === "groups" && m.id && m.id.charAt(0).toUpperCase() === grpLetter && m.played).length;
        const isDefinitive = playedGroupMatches === totalGroupMatches;
        const provBadge = isDefinitive
          ? `<span class="tm-r16-confirmed">✓ confirmado</span>`
          : `<span class="tm-r16-prov">provisional</span>`;

        r16Html = `
          <div class="tm-r16-block">
            <div class="tm-r16-hd">⚔️ 16avos de final ${provBadge}</div>
            <div class="tm-r16-body">
              <div class="tm-r16-pos">${flag} <strong>${teamName}</strong> (${myPos} Grupo ${grpLetter}) <span class="tm-r16-vs">vs</span> ${rival.flag} <strong>${rival.label}</strong></div>
              ${dateStr || timeStr ? `<div class="tm-r16-date">${timeStr ? timeStr + " h · " : ""}${dateStr}</div>` : ""}
            </div>
          </div>`;
      }
    }
  }

  const playedHtml = played.length ? `
    <div>
      <div class="text-xs font-bold uppercase tracking-widest text-gray-500 mb-2">Jugados</div>
      <div class="flex flex-col gap-1.5">${played.map(m => matchRow(m)).join("")}</div>
    </div>` : "";

  const pendingHtml = pending.length ? `
    <div>
      <div class="text-xs font-bold uppercase tracking-widest text-gray-500 mb-2">Próximos</div>
      <div class="flex flex-col gap-1.5">${pending.map(m => matchRow(m)).join("")}</div>
    </div>` : "";

  document.getElementById("team-modal-title").innerHTML =
    `${flag} ${teamName}`;
  document.getElementById("team-modal-body").innerHTML =
    statsHtml + groupHtml + playedHtml + pendingHtml + r16Html;

  const modal = document.getElementById("team-modal");
  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeTeamModal() {
  document.getElementById("team-modal")?.classList.add("hidden");
  document.body.style.overflow = "";
}

/* ═══════════════════════════════════════════════════════════════
   GRUPO MODAL — helpers de clasificación (desempates FIFA 2026)
═══════════════════════════════════════════════════════════════ */

/* Goles "efectivos" de un partido para las clasificaciones del Mundial:
   - Jugado   → resultado final (goals_l / goals_v)
   - En juego → marcador provisional actual (live_goals_l / live_goals_v)
   Devuelve null si el partido aún no aporta datos. */
function _matchGoals(m) {
  if (m.played) return { gh: m.goals_l ?? 0, ga: m.goals_v ?? 0, live: false };
  if (m.live && m.live_goals_l != null && m.live_goals_v != null)
    return { gh: m.live_goals_l, ga: m.live_goals_v, live: true };
  return null;
}

/* ¿Hay algún partido del Mundial en juego que afecte a las clasificaciones? */
function _worldLiveActive() {
  return (D?.matches || []).some(m =>
    !m.played && m.live && m.live_goals_l != null && m.live_goals_v != null);
}

/* Banner "PROVISIONAL — incluye el marcador en directo" para las
   clasificaciones deportivas del Mundial. Vacío si no hay partidos en juego. */
function _worldProvBanner() {
  if (!_worldLiveActive()) return "";
  return `<div class="world-prov-banner"><span class="world-prov-badge">🔴 PROVISIONAL</span> Incluye el marcador de los partidos <strong>en juego</strong>. Se confirma al finalizar.</div>`;
}

/**
 * Calcula la tabla de un grupo con los desempates oficiales FIFA:
 * 1. Puntos  2. DIF global  3. GF global
 * 4. Puntos enfrentamiento directo (entre los empatados)
 * 5. DIF enfrentamiento directo  6. GF enfrentamiento directo
 * 7. Sorteo
 */
function _computeGroupStanding(grp) {
  if (!D) return [];
  grp = grp.toUpperCase();
  const gMatches = D.matches.filter(m =>
    m.phase === "groups" && m.id && m.id.charAt(0).toUpperCase() === grp
  );
  if (!gMatches.length) return [];

  const teams = {};
  gMatches.forEach(m => {
    [[m.home, m.flag_home], [m.away, m.flag_away]].forEach(([name, flag]) => {
      if (name && !teams[name])
        teams[name] = { name, flag: flag || "", pj: 0, pg: 0, pe: 0, pp: 0, gf: 0, gc: 0, pts: 0 };
    });
    const eff = _matchGoals(m);
    if (!eff) return;
    const gh = eff.gh, ga = eff.ga;
    const h = teams[m.home], a = teams[m.away];
    if (!h || !a) return;
    h.pj++; a.pj++;
    h.gf += gh; h.gc += ga;
    a.gf += ga; a.gc += gh;
    if (gh > ga)      { h.pg++; h.pts += 3; a.pp++; }
    else if (gh < ga) { a.pg++; a.pts += 3; h.pp++; }
    else              { h.pe++; h.pts++; a.pe++; a.pts++; }
  });

  const teamList = Object.values(teams);
  const anyMatchPlayed = gMatches.some(m => _matchGoals(m));

  // H2H stats entre un subconjunto de equipos (partidos jugados o en juego entre ellos)
  function h2hStats(names) {
    const s = {};
    names.forEach(n => { s[n] = { pts: 0, gf: 0, gc: 0 }; });
    gMatches.filter(m => names.includes(m.home) && names.includes(m.away) && _matchGoals(m))
      .forEach(m => {
        const eff = _matchGoals(m); const gh = eff.gh, ga = eff.ga;
        s[m.home].gf += gh; s[m.home].gc += ga;
        s[m.away].gf += ga; s[m.away].gc += gh;
        if (gh > ga)      s[m.home].pts += 3;
        else if (gh < ga) s[m.away].pts += 3;
        else              { s[m.home].pts++; s[m.away].pts++; }
      });
    return s;
  }

  // Comparador H2H entre un conjunto de nombres dado
  function cmpH2HFn(names) {
    const h = h2hStats(names);
    return (a, b) =>
      (h[b.name].pts - h[a.name].pts) ||
      ((h[b.name].gf - h[b.name].gc) - (h[a.name].gf - h[a.name].gc)) ||
      (h[b.name].gf - h[a.name].gf);
  }

  // Comparador DIF/GF global + fair play (tarjetas FIFA)
  function cmpOverallFn(a, b) {
    return ((b.gf - b.gc) - (a.gf - a.gc)) || (b.gf - a.gf);
    // Nota: fair play y ranking FIFA requieren datos externos no disponibles aquí
  }

  /**
   * Ordena un array de teams por desempates FIFA:
   *   1. H2H pts entre el conjunto → 2. H2H DIF → 3. H2H GF
   *   4. Re-aplica H2H en subconjunto aún igualado (si el subconjunto es distinto)
   *   5. DIF global → 6. GF global → 7. sorteo
   */
  function sortByFIFA(arr) {
    if (arr.length <= 1) { arr.forEach(t => { t.tieNote = null; }); return arr; }

    const names = arr.map(t => t.name);
    const cmpH2H = cmpH2HFn(names);

    arr.sort(cmpH2H);

    // Procesar subgrupos aún empatados tras H2H
    let k = 0;
    while (k < arr.length) {
      let l = k + 1;
      while (l < arr.length && cmpH2H(arr[k], arr[l]) === 0) l++;

      if (l - k > 1) {
        const sub = arr.slice(k, l);
        const subNames = sub.map(t => t.name);

        if (subNames.length < names.length) {
          // Subconjunto distinto → re-aplicar H2H sólo entre ellos
          const cmpH2H2 = cmpH2HFn(subNames);
          sub.sort(cmpH2H2);
          let m = 0;
          while (m < sub.length) {
            let n = m + 1;
            while (n < sub.length && cmpH2H2(sub[m], sub[n]) === 0) n++;
            if (n - m > 1) {
              // Tras re-aplicar H2H, aún empatados → DIF/GF global
              const sub2 = sub.slice(m, n);
              sub2.sort(cmpOverallFn);
              let p = 0;
              while (p < sub2.length) {
                let q = p + 1;
                while (q < sub2.length && cmpOverallFn(sub2[p], sub2[q]) === 0) q++;
                sub2.slice(p, q).forEach(t => {
                  t.tieNote = (q - p > 1 && anyMatchPlayed) ? "lots" : null;
                });
                p = q;
              }
              sub2.forEach((t, idx) => { sub[m + idx] = t; });
            } else {
              sub[m].tieNote = null;
            }
            m = n;
          }
        } else {
          // Mismo conjunto (H2H no ayuda) → DIF/GF global
          sub.sort(cmpOverallFn);
          let m = 0;
          while (m < sub.length) {
            let n = m + 1;
            while (n < sub.length && cmpOverallFn(sub[m], sub[n]) === 0) n++;
            sub.slice(m, n).forEach(t => {
              t.tieNote = (n - m > 1 && anyMatchPlayed) ? "lots" : null;
            });
            m = n;
          }
        }
        sub.forEach((t, idx) => { arr[k + idx] = t; });
      } else {
        arr[k].tieNote = null;
      }
      k = l;
    }
    return arr;
  }

  // 1.º paso: ordenar por puntos
  teamList.sort((a, b) => b.pts - a.pts);

  // 2.º paso: para cada grupo de equipos con los mismos puntos, aplicar desempates FIFA
  const result = [];
  let i = 0;
  while (i < teamList.length) {
    let j = i + 1;
    while (j < teamList.length && teamList[j].pts === teamList[i].pts) j++;
    result.push(...sortByFIFA(teamList.slice(i, j)));
    i = j;
  }
  return result;
}

/**
 * Devuelve los 12 terceros clasificados de cada grupo ordenados
 * por los criterios FIFA para comparar terceros (sin H2H entre grupos distintos):
 *   1. Puntos  2. DIF global  3. GF global
 *   4. Fair play (tarjetas) — no disponible  5. Ranking FIFA — no disponible
 * Cada entry lleva: .group (letra), .rank (1-12)
 */
function _computeAllThirds() {
  if (!D) return [];
  const grpLetters = [...new Set(
    D.matches.filter(m => m.phase === "groups" && m.id)
             .map(m => m.id.charAt(0).toUpperCase())
  )].sort();

  const thirds = grpLetters.map(g => {
    const s = _computeGroupStanding(g);
    if (s.length < 3) return null;
    const entry = { ...s[2], group: g };
    // Si el 2.º y el 3.º están empatados a sorteo, el tercero es indeterminado
    if (s[1].tieNote === "lots" && s[2].tieNote === "lots") {
      entry.tiedWithSecond = { name: s[1].name, flag: s[1].flag || "" };
    }
    return entry;
  }).filter(Boolean);

  // Criterios oficiales FIFA para ranking de terceros (reglamento art. 32):
  // 1) Pts  2) DIF global  3) GF global  4) Fair play  5) Ranking FIFA  6) Sorteo
  thirds.sort((a, b) =>
    (b.pts - a.pts) ||
    ((b.gf - b.gc) - (a.gf - a.gc)) ||
    (b.gf - a.gf)
  );

  thirds.forEach((t, idx) => { t.rank = idx + 1; });

  // Detectar empate en el corte 8/9: si el 8.º y el 9.º tienen los mismos stats → ambos provisionales
  if (thirds.length >= 9) {
    const t8 = thirds[7], t9 = thirds[8];
    const sameStats = t8.pts === t9.pts && (t8.gf - t8.gc) === (t9.gf - t9.gc) && t8.gf === t9.gf;
    if (sameStats) {
      // Extender el empate al grupo completo que comparta esos stats en el corte
      let lo = 7, hi = 8;
      while (lo > 0 && thirds[lo-1].pts === t8.pts && (thirds[lo-1].gf - thirds[lo-1].gc) === (t8.gf - t8.gc) && thirds[lo-1].gf === t8.gf) lo--;
      while (hi < thirds.length - 1 && thirds[hi+1].pts === t9.pts && (thirds[hi+1].gf - thirds[hi+1].gc) === (t9.gf - t9.gc) && thirds[hi+1].gf === t9.gf) hi++;
      for (let i = lo; i <= hi; i++) thirds[i].tieAtCutoff = true;
    }
  }

  return thirds;
}

/* ─────────────────────────────────────────────────────────────── */

function openGroupModal(grp) {
  if (!D) return;
  grp = grp.toUpperCase();
  const matches = D.matches.filter(m => m.phase === "groups" && m.id && m.id.charAt(0).toUpperCase() === grp);
  if (!matches.length) return;

  // ── Clasificación con desempates FIFA ────────────────────────
  const table = _computeGroupStanding(grp);

  // ── Rank del 3.º entre todos los grupos ──────────────────────
  const allThirds = _computeAllThirds();
  const third = table[2] || null;
  const thirdRankInfo = third
    ? allThirds.find(t => t.group === grp) || null
    : null;
  const thirdRank = thirdRankInfo ? thirdRankInfo.rank : null;
  const thirdQual = thirdRank !== null && thirdRank <= 8;
  const totalThirds = allThirds.length;

  // ── HTML tabla ───────────────────────────────────────────────
  // Mundial 2026: top-2 clasifican directamente; 8 mejores terceros también pasan

  // Leyenda dinámica del 3.º
  const thirdLegend = (() => {
    if (!third) return "";
    const rankTxt = thirdRank !== null
      ? `N.º&nbsp;<strong>${thirdRank}</strong> de ${totalThirds} terceros`
      : "sin datos suficientes aún";
    const playedInGroup = matches.filter(m => m.played).length;
    const provisionalNote = playedInGroup < 3 ? " <em>(provisional)</em>" : "";
    const thirdsLinkModal = `<button class="grp-thirds-link" onclick="event.stopPropagation();goToTeamsSubTab('thirds')" type="button">ver clasificación de terceros →</button>`;
    // Empate 2.º/3.º: mostrar "podría clasificar X o Y"
    const thirdEntry = allThirds.find(t => t.group === grp);
    const tiedWith = thirdEntry?.tiedWithSecond;
    if (tiedWith) {
      const teamNames = `<strong>${escapeHtml(third.name)}</strong> o <strong>${escapeHtml(tiedWith.name)}</strong> 🎲`;
      const txt = thirdQual
        ? `🟡 3.º — <strong>clasificaría</strong>: ${teamNames}${provisionalNote}`
        : `⬜ 3.º — <strong>no clasificaría</strong>: ${teamNames}${provisionalNote}`;
      return `<div class="grp-legend-item ${thirdQual ? "grp-legend-third-yes" : "grp-legend-third-no"}">
        ${txt} ${thirdsLinkModal}
        <span class="grp-tiebreaker-note">Empate 2.º/3.º — se decide por sorteo FIFA</span>
      </div>`;
    }
    if (thirdQual) {
      return `<div class="grp-legend-item grp-legend-third-yes">
        🟡 3.º — <strong>clasificaría</strong> (${rankTxt})${provisionalNote} ${thirdsLinkModal}
        <span class="grp-tiebreaker-note">Criterios 3.ºs: Pts → DIF → GF (sin H2H entre grupos)</span>
      </div>`;
    } else {
      return `<div class="grp-legend-item grp-legend-third-no">
        ⬜ 3.º — <strong>no clasificaría</strong> (${rankTxt})${provisionalNote} ${thirdsLinkModal}
        <span class="grp-tiebreaker-note">Criterios 3.ºs: Pts → DIF → GF (sin H2H entre grupos)</span>
      </div>`;
    }
  })();

  const tableHtml = `
    <div>
      <div class="text-xs font-bold uppercase tracking-widest text-gray-500 mb-2">Clasificación</div>
      <div class="card overflow-hidden">
        <table class="grp-table">
          <thead>
            <tr>
              <th style="width:40%">Equipo</th>
              <th title="Partidos jugados">PJ</th>
              <th title="Ganados">G</th>
              <th title="Empatados">E</th>
              <th title="Perdidos">P</th>
              <th title="Goles a favor">GF</th>
              <th title="Goles en contra">GC</th>
              <th title="Diferencia">DIF</th>
              <th title="Puntos">PTS</th>
            </tr>
          </thead>
          <tbody>
            ${table.map((t, i) => {
              let rowCls = "";
              if (i < 2) rowCls = "grp-qual";
              else if (i === 2) rowCls = thirdQual ? "grp-third" : "grp-third grp-third-out";
              const tieBadge = t.tieNote === "lots"
                ? `<span class="grp-tie-badge" title="Igualados en todos los criterios FIFA — posición decidida por sorteo">🎲 sorteo</span>`
                : "";
              return `
              <tr class="${rowCls}">
                <td>${t.flag} ${t.name}${tieBadge}</td>
                <td>${t.pj}</td>
                <td>${t.pg}</td>
                <td>${t.pe}</td>
                <td>${t.pp}</td>
                <td>${t.gf}</td>
                <td>${t.gc}</td>
                <td>${t.gf - t.gc > 0 ? "+" : ""}${t.gf - t.gc}</td>
                <td class="grp-pts">${t.pts}</td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
      <div class="flex flex-col gap-0.5 mt-1.5">
        <div class="grp-legend-item grp-legend-qual">🟢 Top 2 — clasificados directamente</div>
        ${thirdLegend}
        ${table.some(t => t.tieNote === "lots") ? `<div class="grp-legend-item" style="color:#94A3B8">🎲 <strong>sorteo</strong> — equipos totalmente igualados; posici\u00f3n provisional decidida por sorteo FIFA</div>` : ""}
      </div>
    </div>`;

  // ── HTML partidos (clickables → van al partido en la pestaña) ─
  const jornadas = [...new Set(matches.map(m => m.id))].sort();
  const matchesHtml = `
    <div>
      <div class="text-xs font-bold uppercase tracking-widest text-gray-500 mb-2">Partidos <span class="text-gray-700 normal-case font-normal">· pulsa para ver detalle del partido completo</span></div>
      <table class="tm-match-table">
        <tbody>
          ${jornadas.map(jid => {
            const jMatches = matches.filter(m => m.id === jid);
            return `
              <tr class="tm-match-jornada-row"><td colspan="4">Jornada ${jid.slice(1)}</td></tr>
              ${jMatches.map(m => {
                const played = m.played;
                const liveSc = !played && m.live && m.live_goals_l != null && m.live_goals_v != null;
                const gh = m.goals_l, ga = m.goals_v;
                const dateFmt = m.date ? (() => {
                  const [,mo,d] = m.date.split("-");
                  const months = ["","ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
                  return `${parseInt(d)} ${months[parseInt(mo)]}`;
                })() : "";
                const dataAttrs = m.date ? `data-date="${m.date}" data-match="${(m.name||"").replace(/"/g,"&quot;")}"` : "";
                const venueHtml = m.venue ? `<span class="tm-mt-venue"> · ${m.venue}</span>` : "";
                return `
                  <tr class="${played ? "tm-mt-played" : ""} ${m.date ? "grp-match-link" : ""}" ${dataAttrs} title="${m.date ? "Ver detalle del partido completo" : ""}">
                    <td class="tm-mt-home">${m.flag_home || ""} ${m.home}</td>
                    <td class="${played ? "tm-mt-score" : (liveSc ? "tm-mt-score tm-mt-live" : "tm-mt-score tm-mt-pending")}">${played ? `${gh}-${ga}` : (liveSc ? `🔴 ${m.live_goals_l}-${m.live_goals_v}` : (m.time_es || "—"))}</td>
                    <td class="tm-mt-away">${m.away} ${m.flag_away || ""}</td>
                    <td class="tm-mt-date">${dateFmt}${venueHtml}</td>
                  </tr>`;
              }).join("")}`;
          }).join("")}
        </tbody>
      </table>
    </div>`;

  // ── Montar y mostrar ─────────────────────────────────────────
  document.getElementById("grp-modal-title").innerHTML =
    `<span style="font-size:1.4rem">⚽</span>&nbsp; Grupo ${grp}`;
  const grpLive = matches.some(m => !m.played && m.live && m.live_goals_l != null && m.live_goals_v != null);
  document.getElementById("grp-modal-body").innerHTML = (grpLive ? _worldProvBanner() : "") + tableHtml + matchesHtml;
  const modal = document.getElementById("group-modal");
  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeGroupModal() {
  const modal = document.getElementById("group-modal");
  if (modal) modal.classList.add("hidden");
  document.body.style.overflow = "";
}
function filterApiLog(mode, btn) {
  document.querySelectorAll("#admin-modal .adm-api-filter")
    .forEach(b => b.classList.remove("active"));
  if (btn) btn.classList.add("active");
  document.querySelectorAll("#adm-api-list .adm-api-row").forEach(row => {
    const isUp = row.classList.contains("up");
    const show = mode === "all" || (mode === "up" && isUp) || (mode === "noup" && !isUp);
    row.style.display = show ? "" : "none";
  });
}
function _renderVisitsDay(dayKey) {
  const list = document.getElementById("adm-vis-list");
  if (!list) return;
  const buckets = (window._admVisitBuckets || []).filter(b => b.date === dayKey);
  if (!buckets.length) {
    list.innerHTML = `<div class="adm-empty">Sin visitas registradas este día</div>`;
    return;
  }
  // mapa hora -> visitas (puede haber varios tramos en la misma hora)
  const byHour = {};
  buckets.forEach(b => { byHour[b.hour] = (byHour[b.hour] || 0) + b.visits; });
  const hours = Object.keys(byHour).map(Number).sort((a, b) => a - b);
  const maxV = Math.max(1, ...hours.map(h => byHour[h]));
  const dayTotal = hours.reduce((s, h) => s + byHour[h], 0);

  const rows = hours.map(h => {
    const v = byHour[h];
    const pct = Math.round((v / maxV) * 100);
    const hh = String(h).padStart(2, "0");
    return `<div class="adm-vis-row">
      <span class="adm-vis-hour">${hh}:00</span>
      <span class="adm-vis-bar-wrap"><span class="adm-vis-bar" style="width:${pct}%"></span></span>
      <span class="adm-vis-num">${v}</span>
    </div>`;
  }).join("");

  list.innerHTML = `<div class="adm-vis-daytotal">${dayTotal} visita${dayTotal !== 1 ? "s" : ""} este día</div>${rows}`;
}
function filterVisitsDay(dayKey, btn) {
  document.querySelectorAll("#admin-modal .adm-vis-filter")
    .forEach(b => b.classList.remove("active"));
  if (btn) btn.classList.add("active");
  _renderVisitsDay(dayKey);
}
function goToMatchFromAdmin(isoDate, matchName) {
  closeAdminPanel();
  if (typeof goToMatchesDay === "function") {
    // pequeño retardo para que el modal termine de cerrarse antes de hacer scroll
    setTimeout(() => goToMatchesDay(isoDate, matchName), 60);
  }
}
function _copyAdminSummary(btn) {
  const data = D || {};
  const st = (data.standings || []).slice().sort((a, b) => (b.total || 0) - (a.total || 0));
  const leader = st[0];
  const last = st.length > 1 ? st[st.length - 1] : null;
  const playedMs = (data.matches || []).filter(m => m.played);
  const lastResults = playedMs.slice(-5).map(m => {
    const sc = (m.goals_l != null && m.goals_v != null)
      ? `${m.goals_l}-${m.goals_v}`
      : (m.result?.score || "—");
    return `${m.home || ""} ${sc} ${m.away || ""}`.trim();
  });
  const lines = ["🏆 Porra Mundial 2026 — resumen"];
  if (leader) lines.push(`👑 Líder: ${leader.name} (${leader.total} pts)`);
  if (last) lines.push(`🐢 Último: ${last.name} (${last.total} pts)`);
  lines.push(`⚽ Partidos jugados: ${playedMs.length}/${(data.matches || []).length}`);
  if (lastResults.length) {
    lines.push("📋 Últimos resultados:");
    lastResults.forEach(r => lines.push("  • " + r));
  }
  const visit = document.getElementById("visitor-count")?.textContent;
  if (visit && visit !== "—") lines.push(`👁 Visitas: ${visit}`);
  const txt = lines.join("\n");

  const done = ok => {
    if (!btn) return;
    const prev = btn.textContent;
    btn.textContent = ok ? "✓ Copiado" : "✗ Error";
    btn.classList.toggle("adm-copy-ok", ok);
    setTimeout(() => { btn.textContent = prev; btn.classList.remove("adm-copy-ok"); }, 1800);
  };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(txt).then(() => done(true)).catch(() => done(false));
  } else {
    try {
      const ta = document.createElement("textarea");
      ta.value = txt; document.body.appendChild(ta); ta.select();
      document.execCommand("copy"); document.body.removeChild(ta); done(true);
    } catch { done(false); }
  }
}
// close on backdrop click
document.addEventListener("click", e => {
  const modal = document.getElementById("admin-modal");
  if (modal && !modal.classList.contains("hidden") && e.target === modal) closeAdminPanel();
});

// group badge click → open group modal
document.addEventListener("click", e => {
  // team name click → open team modal
  const updMatchBtn = e.target.closest(".upd-match-link");
  if (updMatchBtn) {
    const date = updMatchBtn.dataset.date;
    const name = updMatchBtn.dataset.match;
    if (date) goToMatchesDay(date, name || null);
    return;
  }
  const teamBtn = e.target.closest(".team-name-btn");
  if (teamBtn) {
    e.stopPropagation();
    openTeamModal(teamBtn.dataset.team);
    return;
  }
  const badge = e.target.closest(".grp-badge-btn");
  if (badge) {
    e.stopPropagation();
    openGroupModal(badge.dataset.group);
    return;
  }
  // click on a match row inside the group modal → go to that match
  const matchLink = e.target.closest(".grp-match-link");
  if (matchLink) {
    const date = matchLink.dataset.date;
    const name = matchLink.dataset.match;
    if (date) {
      closeGroupModal();
      closeTeamModal();
      goToMatchesDay(date, name || null);
    }
    return;
  }
  // close modals on backdrop click
  const grpModal = document.getElementById("group-modal");
  if (grpModal && !grpModal.classList.contains("hidden") && e.target === grpModal) closeGroupModal();
  const teamModal = document.getElementById("team-modal");
  if (teamModal && !teamModal.classList.contains("hidden") && e.target === teamModal) closeTeamModal();
});

function _buildAdminPanel() {
  const body = document.getElementById("admin-modal-body");
  if (!body) return;

  const meta = D?.meta || {};
  const upd  = meta.update || {};
  const now  = new Date();

  function relTime(isoStr) {
    if (!isoStr) return "";
    const d = new Date(isoStr);
    if (isNaN(d)) return "";
    const min = Math.round((now - d) / 60000);
    if (min < 1)  return "hace menos de 1 min";
    if (min < 60) return `hace ${min} min`;
    const h = Math.floor(min / 60), m = min % 60;
    return `hace ${h}h${m ? " " + m + "min" : ""}`;
  }
  function futureTime(isoStr) {
    if (!isoStr) return "";
    const d = new Date(isoStr);
    if (isNaN(d)) return "";
    const min = Math.round((d - now) / 60000);
    if (min <= 0)  return "ahora mismo";
    if (min < 60)  return `en ${min} min`;
    const h = Math.floor(min / 60), m = min % 60;
    return `en ${h}h${m ? " " + m + "min" : ""}`;
  }

  const allMatches = D?.matches || [];
  const played     = allMatches.filter(m => m.played);
  const phaseLabel = { groups:"Grupos", r16:"16avos", r8:"Octavos", r4:"Cuartos", r2:"Semis", final:"Final", positions:"Pos." };

  const visitorCount = document.getElementById("visitor-count")?.textContent || "—";

  function _humanMin(min) {
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60), m = min % 60;
    return `${h}h${m ? " " + m + "min" : ""}`;
  }

  // ── Estado del sistema (semáforo) ──
  // Replica la lógica del guardián (should_update.py): la Action solo regenera
  // data.json cuando hay un partido recién terminado cuyo resultado todavía no
  // se ha capturado. Entre partidos no hace nada, así que NO está "retrasada".
  const sysStatus = (() => {
    const MIN_AFTER = 110;   // min tras el inicio: el resultado ya debería existir
    const MAX_AFTER = 360;   // 6 h: ventana en la que la Action sigue intentándolo

    function kickoffDate(m) {
      const d = (m.date || "").slice(0, 10);   // "2026-06-13"
      const t = m.time_es || "";
      if (d.length < 10 || !t.includes(":")) return null;
      const dt = new Date(`${d}T${t}:00`);     // hora España (zona del navegador admin)
      return isNaN(dt) ? null : dt;
    }

    // ¿Algún partido cuyo resultado ya debería estar capturado y no lo está?
    let pendingMin = null;   // min desde que debería haber terminado
    for (const m of allMatches) {
      if (m.played) continue;
      const ko = kickoffDate(m);
      if (!ko) continue;
      const elapsed = Math.round((now - ko) / 60000);
      if (elapsed >= MIN_AFTER && elapsed <= MAX_AFTER) {
        const over = elapsed - MIN_AFTER;
        if (pendingMin === null || over > pendingMin) pendingMin = over;
      }
    }

    if (pendingMin !== null) {
      if (pendingMin <= 30) return { level: "amber", text: `Resultado pendiente de captura · la Action se ejecuta en breve`, icon: "●" };
      return { level: "red", text: `Resultado sin capturar hace ${_humanMin(pendingMin)} · revisa la Action`, icon: "●" };
    }

    // Nada pendiente: buscar el próximo partido por jugar
    let nextKo = null;
    for (const m of allMatches) {
      if (m.played) continue;
      const ko = kickoffDate(m);
      if (!ko || ko <= now) continue;
      if (nextKo === null || ko < nextKo) nextKo = ko;
    }
    if (nextKo) return { level: "green", text: `Al día · sin partidos pendientes · próximo ${futureTime(nextKo.toISOString())}`, icon: "●" };
    return { level: "green", text: `Al día · sin partidos pendientes`, icon: "●" };
  })();

  // ── Alertas de datos raros ──
  const alerts = [];
  allMatches.forEach(m => {
    const hasResult = !!(m.result && m.result.score);
    const tag = `${m.home || "?"}-${m.away || "?"}`;
    if (m.played && !hasResult)
      alerts.push({ sev: "warn", text: `${tag}: jugado pero sin marcador`, name: m.name, date: m.date });
    if (hasResult && !m.played)
      alerts.push({ sev: "warn", text: `${tag}: tiene marcador pero no está marcado como jugado`, name: m.name, date: m.date });
    if (m.played && (Number(m.goals_l) < 0 || Number(m.goals_v) < 0))
      alerts.push({ sev: "err", text: `${tag}: marcador negativo (${m.goals_l}-${m.goals_v})`, name: m.name, date: m.date });
    if (m.played && (!m.flag_home || !m.flag_away))
      alerts.push({ sev: "warn", text: `${tag}: falta bandera`, name: m.name, date: m.date });
  });

  function alertRow(a) {
    const cls = a.sev === "err" ? "err" : a.sev === "info" ? "info" : "warn";
    const ic = a.sev === "err" ? "⛔" : a.sev === "info" ? "ℹ️" : "⚠️";
    const clickable = a.name && a.date;
    const safeName = (a.name || "").replace(/'/g, "\\'").replace(/"/g, "&quot;");
    const safeDate = (a.date || "").replace(/'/g, "\\'");
    const attrs = clickable
      ? `class="adm-alert ${cls} adm-alert-link" role="button" tabindex="0" onclick="goToMatchFromAdmin('${safeDate}','${safeName}')"`
      : `class="adm-alert ${cls}"`;
    return `<div ${attrs}><span class="adm-alert-ic">${ic}</span><span>${a.text}</span>${clickable ? ' <span class="adm-api-go">↗</span>' : ""}</div>`;
  }

  // ── Historial de cambios de resultados (a partir del log de la API) ──
  const resultHistory = [];
  (meta.api_log || []).forEach(e => {
    if (!e.updated || !Array.isArray(e.changes)) return;
    e.changes.forEach(ch => {
      if (ch && typeof ch === "object") {
        resultHistory.push({ when: `${e.date || ""} ${e.time || ""}`.trim(), label: ch.label || ch.name || "", name: ch.name, date: ch.date });
      } else if (typeof ch === "string") {
        resultHistory.push({ when: `${e.date || ""} ${e.time || ""}`.trim(), label: ch, name: null, date: null });
      }
    });
  });
  const resultHistoryTop = resultHistory.slice(0, 25);

  function histRow(h) {
    const clickable = h.name && h.date;
    const safeName = (h.name || "").replace(/'/g, "\\'").replace(/"/g, "&quot;");
    const safeDate = (h.date || "").replace(/'/g, "\\'");
    const label = clickable
      ? `<a class="adm-hist-label adm-api-link-match" role="button" tabindex="0" onclick="goToMatchFromAdmin('${safeDate}','${safeName}')">${h.label} <span class="adm-api-go">↗</span></a>`
      : `<span class="adm-hist-label">${h.label}</span>`;
    return `<div class="adm-hist-row"><span class="adm-hist-when">${h.when}</span>${label}</div>`;
  }


  const API_WINDOW_H = 15;
  const apiLogAll = meta.api_log || [];
  const apiCutoff = new Date(now.getTime() - API_WINDOW_H * 3600 * 1000);
  const apiLog = apiLogAll.filter(e => {
    const d = new Date(e.ts_iso);
    return !isNaN(d) && d >= apiCutoff;
  });
  const apiUpdated = apiLog.filter(e => e.updated).length;
  const apiNoUpd   = apiLog.length - apiUpdated;
  const triggerLabel = { schedule: "⏱ auto", workflow_dispatch: "▶️ manual", push: "⬆️ push" };

  function apiRow(e) {
    let changesHtml;
    if (e.updated) {
      const list = (e.changes || []).map(ch => {
        // Compatibilidad: las entradas antiguas eran strings; las nuevas son {label,name,date[,fields,old,new]}
        if (typeof ch === "string") return `<div class="adm-api-change-block"><span class="adm-api-changes">${ch}</span></div>`;
        const label = ch.label || `${ch.name || ""}`;
        const safeName = (ch.name || "").replace(/'/g, "\\'").replace(/"/g, "&quot;");
        const safeDate = (ch.date || "").replace(/'/g, "\\'");
        const matchLink = ch.name && ch.date
          ? `<a class="adm-api-changes adm-api-link-match" role="button" tabindex="0"
              onclick="goToMatchFromAdmin('${safeDate}','${safeName}')">${label} <span class="adm-api-go">↗</span></a>`
          : `<span class="adm-api-changes">${label}</span>`;

        // Detalles de qué cambió (fields/old/new, versiones nuevas del log)
        let detailHtml = "";
        if (ch.fields && ch.fields.length && ch.old && ch.new) {
          const parts = ch.fields.map(f => {
            const oval = ch.old[f] ?? "—";
            const nval = ch.new[f] ?? "—";
            return `<span class="adm-api-field-name">${f}:</span> <span class="adm-api-old-val">${oval}</span><span class="adm-api-arr"> → </span><span class="adm-api-new-val">${nval}</span>`;
          });
          detailHtml = `<span class="adm-api-detail">${parts.join(" · ")}</span>`;
        }

        return `<div class="adm-api-change-block">${matchLink}${detailHtml}</div>`;
      });
      changesHtml = list.join("") || `<div class="adm-api-change-block"><span class="adm-api-changes">actualizó datos</span></div>`;
    } else {
      changesHtml = `<span class="adm-api-nochange">sin cambios en marcadores</span>`;
    }
    return `<div class="adm-api-row ${e.updated ? "up" : "noup"}">
      <span class="adm-api-when">
        <strong>${e.time || ""}</strong>
        <span class="adm-api-date">${e.date || ""}</span>
      </span>
      <span class="adm-api-mid">${changesHtml}</span>
      <span class="adm-api-tags">
        <span class="adm-api-trigger">${triggerLabel[e.trigger] || e.trigger || ""}</span>
        <span class="adm-api-badge ${e.updated ? "yes" : "no"}">${e.updated ? "✓ actualizó" : "— sin update"}</span>
      </span>
    </div>`;
  }

  let apiLogBody;
  if (!apiLogAll.length) {
    apiLogBody = `<div class="adm-empty">Sin llamadas registradas todavía. El registro empieza tras el próximo partido.</div>`;
  } else if (!apiLog.length) {
    apiLogBody = `<div class="adm-empty">Sin llamadas a la API en las últimas 15 h<br><span class="adm-rel">(${apiLogAll.length} en el histórico)</span></div>`;
  } else {
    apiLogBody = apiLog.map(apiRow).join("");
  }

  // ── Visitas por hora (a partir de fotos horarias del contador) ──
  const visitsSnaps = (meta.visits_log || [])
    .map(s => ({ d: new Date(s.ts_iso), total: Number(s.total) }))
    .filter(s => !isNaN(s.d) && !isNaN(s.total))
    .sort((a, b) => a.d - b.d);

  // delta de cada foto respecto a la anterior = visitas en ese tramo
  const visitsBuckets = [];
  for (let i = 1; i < visitsSnaps.length; i++) {
    const prev = visitsSnaps[i - 1], cur = visitsSnaps[i];
    const delta = Math.max(0, cur.total - prev.total);
    const dayKey = `${cur.d.getFullYear()}-${String(cur.d.getMonth() + 1).padStart(2, "0")}-${String(cur.d.getDate()).padStart(2, "0")}`;
    visitsBuckets.push({ date: dayKey, hour: cur.d.getHours(), visits: delta, total: cur.total });
  }
  // días disponibles, del más reciente al más antiguo
  const visitDays = [...new Set(visitsBuckets.map(b => b.date))].sort().reverse();
  // guardamos los datos para que el filtro de día los use sin recalcular
  window._admVisitBuckets = visitsBuckets;

  // ── Visitas: hoy vs ayer + hora pico ──
  const _dayKeyOf = dt => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  const _sumDay = dk => visitsBuckets.filter(b => b.date === dk).reduce((s, b) => s + b.visits, 0);
  const _todayK = _dayKeyOf(new Date());
  const _yestDt = new Date(); _yestDt.setDate(_yestDt.getDate() - 1);
  const _yestK = _dayKeyOf(_yestDt);
  const visitsToday = _sumDay(_todayK);
  const visitsYest = _sumDay(_yestK);
  let visitsPeak = null;
  visitsBuckets.filter(b => b.date === _todayK).forEach(b => { if (!visitsPeak || b.visits > visitsPeak.visits) visitsPeak = b; });
  const visitsTrend = (() => {
    if (visitsYest <= 0) return visitsToday > 0 ? { cls: "up", txt: "▲ nuevo" } : { cls: "flat", txt: "—" };
    const diff = Math.round(((visitsToday - visitsYest) / visitsYest) * 100);
    if (diff > 0) return { cls: "up", txt: `▲ ${diff}%` };
    if (diff < 0) return { cls: "down", txt: `▼ ${Math.abs(diff)}%` };
    return { cls: "flat", txt: "= igual" };
  })();

  function visitsDayLabel(dayKey) {
    const [y, m, d] = dayKey.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const diff = Math.round((today - dt) / 86400000);
    if (diff === 0) return "Hoy";
    if (diff === 1) return "Ayer";
    return dt.toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" });
  }
  // expón el helper para el render del filtro
  window._admVisitsDayLabel = visitsDayLabel;

  const visitsFilterBtns = visitDays.map((dk, i) =>
    `<button class="adm-vis-filter${i === 0 ? " active" : ""}" onclick="filterVisitsDay('${dk}', this)">${visitsDayLabel(dk)}</button>`
  ).join("");

  let visitsBody;
  if (!visitsSnaps.length) {
    visitsBody = `<div class="adm-empty">Aún no hay fotos horarias. El workflow <code>snapshot-visits</code> se ejecuta cada hora en el minuto :05.</div>`;
  } else if (visitsBuckets.length < 1) {
    const lastSnap = visitsSnaps[visitsSnaps.length - 1];
    const lastTime = lastSnap.d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" });
    visitsBody = `<div class="adm-empty">Primera foto registrada a las ${lastTime} (total: ${lastSnap.total}). Se necesitan 2 fotos para calcular visitas por hora — disponible en la próxima ejecución (:05).</div>`;
  } else {
    visitsBody = `
      <div class="adm-vis-filters">${visitsFilterBtns}</div>
      <div class="adm-vis-list" id="adm-vis-list"></div>`;
  }

  // ── Construye el HTML de cada sub-pestaña ──────────────────────────────

  const htmlSistema = `
    <div class="adm-section">
      <div class="adm-section-title">📦 Datos y actualización</div>
      <div class="adm-grid">
        <div class="adm-cell">
          <div class="adm-label">JSON generado</div>
          <div class="adm-value">${meta.generated || "—"}</div>
        </div>
        <div class="adm-cell">
          <div class="adm-label">Última actualización <span class="adm-real-badge">datos reales</span></div>
          <div class="adm-value">${upd.last_updated_date || "—"} ${upd.last_updated_time || ""}
            ${relTime(upd.last_updated_iso) ? `<br><span class="adm-rel">${relTime(upd.last_updated_iso)}</span>` : ""}
          </div>
        </div>
        <div class="adm-cell">
          <div class="adm-label">Última comprobación API</div>
          <div class="adm-value">${upd.last_checked_date || upd.last_updated_date || "—"} ${upd.last_checked_time || upd.last_updated_time || ""}
            ${relTime(upd.last_checked_iso || upd.last_updated_iso) ? `<br><span class="adm-rel">${relTime(upd.last_checked_iso || upd.last_updated_iso)}</span>` : ""}
          </div>
        </div>
        <div class="adm-cell">
          <div class="adm-label">Próxima revisión</div>
          <div class="adm-value" id="adm-next-update">—</div>
        </div>
        <div class="adm-cell">
          <div class="adm-label">Cadencia</div>
          <div class="adm-value">${upd.schedule_label || "—"}</div>
        </div>
      </div>
    </div>
    <div class="adm-section">
      <div class="adm-section-title">🔗 Links rápidos</div>
      <div class="adm-links">
        <button type="button" class="adm-link adm-copy-btn" onclick="_copyAdminSummary(this)">📋 Copiar resumen</button>
        <a href="https://github.com/pCresp0/porra-mundial-nanos-2026" target="_blank" rel="noopener" class="adm-link">📁 Repo GitHub</a>
        <a href="https://github.com/pCresp0/porra-mundial-nanos-2026/actions" target="_blank" rel="noopener" class="adm-link">⚙️ Actions</a>
        <a href="https://worldcup26.ir/get/games" target="_blank" rel="noopener" class="adm-link">🌐 API Mundial</a>
        <a href="${IS_GH_PAGES ? "data.json" : "/api/data"}" target="_blank" rel="noopener" class="adm-link">📄 data.json</a>
      </div>
    </div>`;

  const htmlApi = `
    <div class="adm-section">
      <div class="adm-section-title">🚦 Estado del sistema</div>
      <div class="adm-status adm-status-${sysStatus.level}">
        <span class="adm-status-dot">${sysStatus.icon}</span>
        <span class="adm-status-text">${sysStatus.text}</span>
      </div>
    </div>
    <div class="adm-section">
      <div class="adm-section-title">
        ⚠️ Alertas de datos
        <span class="adm-badge ${alerts.length ? "adm-badge-warn" : ""}">${alerts.length}</span>
      </div>
      <div class="adm-alerts">
        ${alerts.length ? alerts.map(alertRow).join("") : '<div class="adm-empty">✓ Sin anomalías detectadas en los datos</div>'}
      </div>
    </div>
    <div class="adm-section">
      <div class="adm-section-title">
        📡 Llamadas a la API <span class="adm-badge">últimas 15 h</span>
      </div>
      <div class="adm-api-summary">
        <span class="adm-api-stat"><strong>${apiLog.length}</strong> llamadas</span>
        <span class="adm-api-stat up"><strong>${apiUpdated}</strong> actualizaron</span>
        <span class="adm-api-stat noup"><strong>${apiNoUpd}</strong> sin cambios</span>
      </div>
      <div class="adm-api-filters">
        <button class="adm-api-filter active" onclick="filterApiLog('all', this)">Todas</button>
        <button class="adm-api-filter" onclick="filterApiLog('up', this)">✓ Con actualización</button>
        <button class="adm-api-filter" onclick="filterApiLog('noup', this)">— Sin cambios</button>
      </div>
      <div class="adm-api-list" id="adm-api-list">
        ${apiLogBody}
      </div>
    </div>
    <div class="adm-section">
      <div class="adm-section-title">
        🕓 Historial de cambios
        <span class="adm-badge">${resultHistory.length}</span>
      </div>
      <div class="adm-hist-list">
        ${resultHistoryTop.length ? resultHistoryTop.map(histRow).join("") : '<div class="adm-empty">Sin cambios de resultados registrados todavía</div>'}
      </div>
    </div>`;

  const htmlPartidos = `
    <div class="adm-section">
      <div class="adm-section-title">
        📡 Partidos con resultado
        <span class="adm-badge">${played.length} / ${allMatches.length}</span>
      </div>
      <div class="adm-matches">
        ${played.length ? played.map(m => {
          const hasScore = m.goals_l != null && m.goals_v != null;
          const scoreStr = hasScore ? `${m.goals_l}-${m.goals_v}` : (m.result || "—");
          return `<div class="adm-match-row">
            <span class="adm-match-name">
              ${m.flag_home || ""}${m.home || ""} <strong>${scoreStr}</strong> ${m.away || ""}${m.flag_away || ""}
            </span>
            <span style="display:flex;gap:.4rem;align-items:center">
              <span class="adm-match-phase">${phaseLabel[m.phase] || m.phase || ""}</span>
              <span class="adm-match-updated ${hasScore ? "yes" : "no"}">${hasScore ? "✓ score" : "sin score"}</span>
            </span>
          </div>`;
        }).join("") : '<div class="adm-empty">Sin partidos jugados aún</div>'}
      </div>
    </div>`;

  const htmlAccesos = `
    <div class="adm-section">
      <div class="adm-section-title">👁 Visitas</div>
      <div class="adm-grid">
        <div class="adm-cell">
          <div class="adm-label">Total de visitas</div>
          <div class="adm-value adm-big">${visitorCount}</div>
        </div>
        <div class="adm-cell">
          <div class="adm-label">Plataforma</div>
          <div class="adm-value">page-views-api.ratneshc.com<br><span class="adm-rel">contador anónimo</span></div>
        </div>
        <div class="adm-cell">
          <div class="adm-label">Hoy <span class="adm-trend adm-trend-${visitsTrend.cls}">${visitsTrend.txt}</span></div>
          <div class="adm-value adm-big">${visitsToday}</div>
          ${visitsPeak ? `<div class="adm-rel">pico ${String(visitsPeak.hour).padStart(2, "0")}:00 (${visitsPeak.visits})</div>` : ""}
        </div>
        <div class="adm-cell">
          <div class="adm-label">Ayer</div>
          <div class="adm-value adm-big">${visitsYest}</div>
        </div>
      </div>
      <div class="adm-vis-head">
        <span class="adm-label">Visitas por hora</span>
      </div>
      ${visitsBody}
    </div>`;

  const htmlMensajes = `
    <div class="adm-section">
      <div class="adm-section-title">
        💬 Sugerencias y fallos
        <span class="adm-badge" id="adm-fb-badge"></span>
      </div>
      <div class="adm-fb-list" id="adm-fb-list">
        <div class="adm-empty">Cargando sugerencias…</div>
      </div>
    </div>`;

  // Guarda las pestañas en window para que _admSwitchTab pueda acceder
  window._admTabs = { api: htmlApi, accesos: htmlAccesos, partidos: htmlPartidos, mensajes: htmlMensajes, sistema: htmlSistema };
  window._admVisitDays = visitDays;

  // ── Estructura del panel con barra de sub-pestañas ─────────────────────
  body.innerHTML = `
    <nav class="adm-subnav" id="adm-subnav">
      <button class="adm-subnav-btn active" data-tab="api"      onclick="_admSwitchTab('api',this)">📡 API</button>
      <button class="adm-subnav-btn"        data-tab="accesos"  onclick="_admSwitchTab('accesos',this)">👁 Accesos</button>
      <button class="adm-subnav-btn"        data-tab="partidos" onclick="_admSwitchTab('partidos',this)">⚽ Partidos</button>
      <button class="adm-subnav-btn"        data-tab="mensajes" onclick="_admSwitchTab('mensajes',this)">💬 Mensajes</button>
      <button class="adm-subnav-btn"        data-tab="sistema"  onclick="_admSwitchTab('sistema',this)">⚙️ Sistema</button>
    </nav>
    <div class="adm-tab-content" id="adm-tab-content">
      ${htmlApi}
    </div>`;

  // Inicializa la pestaña API (filtros ya están en el HTML, nada extra)
  // pinta el día más reciente de visitas por hora cuando se cambie a Accesos
  // carga feedback solo cuando se abre esa pestaña
}

// ── Cambio de sub-pestaña del panel de admin ──────────────────────────────
function _admSwitchTab(tabKey, btn) {
  const nav     = document.getElementById("adm-subnav");
  const content = document.getElementById("adm-tab-content");
  if (!nav || !content || !window._admTabs) return;
  nav.querySelectorAll(".adm-subnav-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === tabKey));
  content.innerHTML = window._admTabs[tabKey] || "";
  // Inicialización específica por pestaña
  if (tabKey === "accesos") {
    const days = window._admVisitDays || [];
    if (days.length) _renderVisitsDay(days[0]);
  } else if (tabKey === "mensajes") {
    _loadAdminFeedback();
  }
}

// ── Sugerencias en el panel de admin (lee del Apps Script con el PIN) ──
function _fbEscape(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function _fbGetToken() {
  try { return localStorage.getItem(FEEDBACK_TOKEN_KEY) || ""; } catch { return ""; }
}

async function _loadAdminFeedback() {
  const list = document.getElementById("adm-fb-list");
  const badge = document.getElementById("adm-fb-badge");
  if (!list) return;

  if (!FEEDBACK_API) {
    list.innerHTML = `<div class="adm-empty">El sistema de sugerencias no está configurado todavía.<br><span class="adm-rel">Despliega <code>docs/feedback_apps_script.gs</code> y pega la URL en <code>FEEDBACK_API</code>.</span></div>`;
    return;
  }

  // Usa el PIN guardado al entrar al panel como clave de lectura.
  const token = _fbGetToken();
  if (!token) {
    list.innerHTML = `<div class="adm-empty">Cierra y vuelve a abrir el panel con tu PIN para cargar las sugerencias.</div>`;
    return;
  }

  list.innerHTML = `<div class="adm-empty">Cargando sugerencias…</div>`;
  try {
    const res = await fetch(`${FEEDBACK_API}?token=${encodeURIComponent(token)}`);
    const data = await res.json().catch(() => ({}));
    if (!data || data.ok !== true) {
      if (data?.error === "unauthorized") {
        list.innerHTML = `<div class="adm-empty">⚠️ El PIN no coincide con <code>READ_TOKEN</code> del Apps Script. Ponlos iguales para ver las sugerencias.</div>`;
      } else {
        list.innerHTML = `<div class="adm-empty">No se pudieron cargar las sugerencias.</div>`;
      }
      if (badge) badge.textContent = "";
      return;
    }
    const items = data.items || [];
    if (badge) badge.textContent = String(items.length);
    if (!items.length) {
      list.innerHTML = `<div class="adm-empty">Aún no hay sugerencias. Cuando alguien envíe una, aparecerá aquí.</div>`;
      return;
    }
    // Más recientes arriba
    const sorted = [...items].sort((a, b) => {
      const ta = new Date(a.ts).getTime() || 0;
      const tb = new Date(b.ts).getTime() || 0;
      return tb - ta;
    });
    const rows = sorted.map(it => {
      const d = new Date(it.ts);
      const when = isNaN(d) ? "" : d.toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
      const isBug = it.type === "Bug";
      return `<tr class="${isBug ? "bug" : "mejora"}">
        <td class="adm-fb-td-name">${_fbEscape(it.name)}</td>
        <td class="adm-fb-td-type">${isBug ? "🐛 Fallo" : "💡 Mejora"}</td>
        <td class="adm-fb-td-text">${_fbEscape(it.text)}</td>
        <td class="adm-fb-td-when">${when}</td>
      </tr>`;
    }).join("");
    list.innerHTML = `<div class="adm-fb-tablewrap"><table class="adm-fb-table">
      <thead><tr><th>Quién</th><th>Tipo</th><th>Descripción</th><th>Fecha</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  } catch {
    list.innerHTML = `<div class="adm-empty">No se pudieron cargar las sugerencias (sin conexión con el servidor de recogida).</div>`;
  }
}

async function initVisitorCounter() {
  const wrap = document.getElementById("visitor-counter");
  const countEl = document.getElementById("visitor-count");
  if (!wrap || !countEl) return;

  if (IS_GH_PAGES) {
    await fetch(`${VISITOR_API}/track?site=${encodeURIComponent(VISITOR_SITE)}&path=${encodeURIComponent(VISITOR_PATH)}`, {
      keepalive: true,
    }).catch(() => {});
  }

  try {
    const res = await fetch(
      `${VISITOR_API}/views?site=${encodeURIComponent(VISITOR_SITE)}&path=${encodeURIComponent(VISITOR_PATH)}`
    );
    if (!res.ok) throw new Error("views failed");
    const { views } = await res.json();
    countEl.textContent = Number(views).toLocaleString("es-ES");
    wrap.classList.remove("hidden");
  } catch {
    wrap.classList.add("hidden");
  }
}

initVisitorCounter();

/* ── Changelog modal ── */
(function () {
  const modal = document.getElementById("changelog-modal");
  if (!modal) return;

  function closeModal() {
    modal.classList.add("hidden");
    document.body.style.overflow = "";
  }
  function openModal() {
    modal.classList.remove("hidden");
    document.body.style.overflow = "hidden";
  }

  document.getElementById("changelog-open")?.addEventListener("click", openModal);
  document.getElementById("changelog-close")?.addEventListener("click", closeModal);
  modal.addEventListener("click", e => { if (e.target === modal) closeModal(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !modal.classList.contains("hidden")) closeModal(); });
})();

/* ── Feedback (sugerencias / bugs) → se guarda en el Apps Script, sin abrir correo ── */
(function () {
  const modal = document.getElementById("feedback-modal");
  if (!modal) return;

  const form   = document.getElementById("feedback-form");
  const nameEl = document.getElementById("fb-name");
  const textEl = document.getElementById("fb-text");
  const sendBtn = document.getElementById("feedback-send");
  const body    = modal.querySelector(".cl-body");

  function closeModal() {
    modal.classList.add("hidden");
    document.body.style.overflow = "";
  }
  function openModal() {
    // restaura el formulario por si quedó la pantalla de éxito de un envío previo
    const prevOk = modal.querySelector(".fb-success");
    if (prevOk) { prevOk.remove(); if (form) form.style.display = ""; }
    modal.classList.remove("hidden");
    document.body.style.overflow = "hidden";
    setTimeout(() => nameEl?.focus(), 180);
  }

  document.getElementById("feedback-open")?.addEventListener("click", openModal);
  document.getElementById("feedback-close")?.addEventListener("click", closeModal);
  document.getElementById("feedback-cancel")?.addEventListener("click", closeModal);
  modal.addEventListener("click", e => { if (e.target === modal) closeModal(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !modal.classList.contains("hidden")) closeModal(); });

  function showSuccess(type) {
    const isBug = type === "Bug";
    const tag = isBug ? "🐛 Fallo" : "💡 Mejora";
    const html = `
      <div class="fb-success">
        <div class="fb-success-check">✓</div>
        <div class="fb-success-title">${tag} enviado correctamente</div>
        <div class="fb-success-sub">¡Gracias! Le ha llegado a Pablo. Lo revisará en cuanto pueda.</div>
        <button type="button" class="fb-btn-send" id="fb-success-ok">Cerrar</button>
      </div>`;
    if (form) form.style.display = "none";
    body.insertAdjacentHTML("beforeend", html);
    const ok = document.getElementById("fb-success-ok");
    ok?.addEventListener("click", closeModal);
    setTimeout(() => ok?.focus(), 60);
  }

  function setSending(on) {
    if (!sendBtn) return;
    sendBtn.disabled = on;
    sendBtn.textContent = on ? "Enviando…" : "✉️ Enviar";
  }

  function showError(msg) {
    let el = modal.querySelector(".fb-error");
    if (!el) {
      el = document.createElement("p");
      el.className = "fb-error";
      form?.querySelector(".fb-actions")?.before(el);
    }
    el.textContent = msg;
  }

  form?.addEventListener("submit", async e => {
    e.preventDefault();
    const name = (nameEl?.value || "").trim();
    const text = (textEl?.value || "").trim();
    const type = form.querySelector('input[name="fb-type"]:checked')?.value || "Mejora";

    let ok = true;
    nameEl?.classList.remove("fb-err");
    textEl?.classList.remove("fb-err");
    if (!name) { nameEl?.classList.add("fb-err"); ok = false; }
    if (!text) { textEl?.classList.add("fb-err"); ok = false; }
    if (!ok) { (!name ? nameEl : textEl)?.focus(); return; }

    modal.querySelector(".fb-error")?.remove();

    if (!FEEDBACK_API) {
      showError("⚠️ El envío aún no está configurado. Inténtalo más tarde.");
      return;
    }

    setSending(true);
    try {
      // Content-Type text/plain evita el preflight CORS con Apps Script.
      const res = await fetch(FEEDBACK_API, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ name, type, text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!data || data.ok !== true) throw new Error(data?.error || "fail");
      showSuccess(type);
    } catch {
      showError("⚠️ No se pudo enviar ahora mismo. Revisa tu conexión e inténtalo de nuevo.");
    } finally {
      setSending(false);
    }
  });
})();

/* ── Music player ── */
(function () {
  const audio   = document.getElementById("music-audio");
  const btn     = document.getElementById("music-btn");
  const panel   = document.getElementById("music-panel");
  const playBtn = document.getElementById("music-play");
  const volEl   = document.getElementById("music-vol");
  const seekEl  = document.getElementById("music-seek");
  const curEl   = document.getElementById("music-cur");
  const durEl   = document.getElementById("music-dur");
  const closeEl = document.getElementById("music-close");
  if (!audio || !btn) return;

  audio.volume = 0.4;
  let seeking = false;

  function fmtTime(s) {
    if (!isFinite(s) || s < 0) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, "0")}`;
  }

  function syncSeekUI() {
    if (!audio.duration || seeking) return;
    seekEl.value = (audio.currentTime / audio.duration) * 100;
    curEl.textContent = fmtTime(audio.currentTime);
  }

  btn.addEventListener("click", () => panel.classList.toggle("hidden"));
  closeEl.addEventListener("click", () => panel.classList.add("hidden"));

  playBtn.addEventListener("click", () => {
    if (audio.paused) { audio.play().catch(() => {}); }
    else              { audio.pause(); }
  });

  audio.addEventListener("play", () => {
    playBtn.textContent = "⏸";
    btn.classList.add("playing");
    btn.title = "🎵 Reproduciendo — pulsa para abrir";
  });
  audio.addEventListener("pause", () => {
    playBtn.textContent = "▶";
    btn.classList.remove("playing");
    btn.title = "🎵 Línea de Cal — pulsa para abrir";
  });

  volEl.addEventListener("input", () => { audio.volume = parseFloat(volEl.value); });

  audio.addEventListener("loadedmetadata", () => {
    durEl.textContent = fmtTime(audio.duration);
  });
  audio.addEventListener("durationchange", () => {
    durEl.textContent = fmtTime(audio.duration);
  });
  audio.addEventListener("timeupdate", syncSeekUI);

  seekEl.addEventListener("input", () => {
    seeking = true;
    if (audio.duration) {
      audio.currentTime = (parseFloat(seekEl.value) / 100) * audio.duration;
      curEl.textContent = fmtTime(audio.currentTime);
    }
  });
  seekEl.addEventListener("change", () => { seeking = false; });
  seekEl.addEventListener("pointerup", () => { seeking = false; });
  seekEl.addEventListener("touchend", () => { seeking = false; });
})();

/* ═══════════════════════════════════════════════════════════════
   MODO DE LA WEB — porra vs invitado
   Se decide por el ENLACE con el que entras (no hay popup):
     · Enlace público  →  …/                       (modo invitado)
     · Enlace porra     →  …/?porra=1312            (modo porra)
   La elección se guarda por dispositivo en localStorage, así que
   un colega que entra una vez con su enlace no lo necesita después.
═══════════════════════════════════════════════════════════════ */
const APP_MODE_KEY = "nanos_app_mode";           // "porra" | "guest"
const PORRA_ACCESS_CODE = "1312";                // valor del parámetro ?porra=
const PORRA_ONLY_TABS = ["standings", "progression", "stats", "honor", "scoring", "bets"];

function _getStoredMode() {
  try { return localStorage.getItem(APP_MODE_KEY); } catch { return null; }
}
function _setStoredMode(mode) {
  try { localStorage.setItem(APP_MODE_KEY, mode); } catch { /* ignore */ }
}

function applyAppMode(mode) {
  const guest = mode === "guest";
  document.body.classList.toggle("mode-guest", guest);
  document.body.classList.toggle("mode-porra", !guest);

  // Título de cabecera adaptado al modo
  const title = document.getElementById("app-title");
  if (title) {
    title.innerHTML = guest
      ? `MUNDIAL <span style="color:var(--gold)">FIFA</span> 2026`
      : `PORRA <span style="color:var(--gold)">'LOS NANOS'</span> MUNDIAL 2026`;
  }

  // Si el invitado está en una pestaña exclusiva de la porra, llévalo a Partidos
  if (guest) {
    const active = document.querySelector(".tab-btn.active");
    if (active && PORRA_ONLY_TABS.includes(active.dataset.tab)) {
      document.querySelector('.tab-btn[data-tab="matches"]')?.click();
    }
  }
}

// Permite reabrir la elección desde la consola para pruebas: resetAppMode()
function resetAppMode() {
  try { localStorage.removeItem(APP_MODE_KEY); } catch { /* ignore */ }
  location.reload();
}

(function initAppMode() {
  const params = new URLSearchParams(location.search);
  let mode = _getStoredMode();
  let urlSetMode = false;

  // 1) El enlace manda sobre lo guardado (permite "ascender" a porra
  //    aunque el dispositivo entrase antes como invitado).
  if (params.has("porra")) {
    if ((params.get("porra") || "").trim() === PORRA_ACCESS_CODE) {
      mode = "porra"; _setStoredMode("porra"); urlSetMode = true;
    }
    // Si el código del enlace no es válido, se ignora (cae a invitado/guardado).
  } else if (params.has("publico") || params.has("invitado")) {
    mode = "guest"; _setStoredMode("guest"); urlSetMode = true;
  }

  // 2) Sin enlace especial y sin elección previa → público por defecto.
  if (!mode) { mode = "guest"; _setStoredMode("guest"); }

  applyAppMode(mode);

  // 3) Limpia el parámetro de la URL para no dejar el código a la vista
  //    ni propagarlo si alguien comparte la barra de direcciones.
  if (urlSetMode) {
    try {
      const url = new URL(location.href);
      ["porra", "publico", "invitado"].forEach(p => url.searchParams.delete(p));
      history.replaceState(null, "", url.pathname + url.search + url.hash);
    } catch { /* ignore */ }
  }
})();

loadData();


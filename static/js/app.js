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
let soloLeaderChart = null;
let _progWindow = 10; // last N matches to show in progression chart (0 = all)
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
  if (!flag || flag === "🏳️") return false;
  // Acepta tanto banderas de indicadores regionales (🇪🇸) como banderas con
  // secuencias de etiqueta (🏴󠁧󠁢󠁥󠁮󠁧󠁿 Inglaterra, 🏴󠁧󠁢󠁳󠁣󠁴󠁿 Escocia, etc.)
  const hasRegional = /\p{Regional_Indicator}/u.test(flag);
  const hasTagFlag  = /\u{1F3F4}/u.test(flag);   // 🏴 base de banderas con tags
  if (!hasRegional && !hasTagFlag) return false;
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
    if (e.key === "Escape" && !document.getElementById("player-modal")?.classList.contains("hidden")) {
      closePlayerModal();
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

/* ── FIFA World Ranking (12 junio 2026 — fuente: transfermarkt/FIFA) ── */
const FIFA_RANK = {
  // Top 10
  "Argentina":1,
  "España":2,"Francia":3,"Inglaterra":4,"Portugal":5,
  "Brasil":6,"Marruecos":7,"Países Bajos":8,"Holanda":8,"Bélgica":9,"Alemania":10,
  // 11-20
  "Croacia":11,"Colombia":13,"México":14,"Senegal":15,
  "Uruguay":16,"EE.UU.":17,"Estados Unidos":17,"Japón":18,"Suiza":19,"Irán":20,
  // 21-30
  "Dinamarca":21,"Turquía":22,"Ecuador":23,"Austria":24,"Corea del Sur":25,
  "Nigeria":26,"Australia":27,"Argelia":28,"Egipto":29,"Canadá":30,
  // 31-50
  "Noruega":31,"Costa de Marfil":33,"Panamá":34,
  "Suecia":38,"Paraguay":41,"Escocia":42,"Serbia":43,
  "Túnez":45,"R.D. Congo":46,"Congo DR":46,"RD Congo":46,"Grecia":48,
  "Venezuela":49,"Uzbekistán":50,
  // 51-70
  "Chile":51,"Perú":52,"Costa Rica":53,
  "Qatar":56,"Catar":56,"Iraq":57,"Irak":57,
  "Sudáfrica":60,"Arabia Saudita":61,"Arabia Saudí":61,"Jordania":63,
  "Bosnia y Herz.":64,"Bosnia y Herzegovina":64,"Bosnia":64,
  "Honduras":65,"Cabo Verde":67,"Jamaica":71,"Ghana":73,
  // 77+
  "Bolivia":77,"Curazao":82,"Haití":83,"Nueva Zelanda":85,
};

/* ── Técnicos / seleccionadores ── */
const COACHES = {
  "MEX":{"name":"Javier Aguirre",       "nat":"🇲🇽 México",       "since":"2023","note":"Experimentado. Dirigió a México en 2002 y 2010"},
  "RSA":{"name":"Hugo Broos",            "nat":"🇧🇪 Bélgica",      "since":"2021","note":"Revitalizó a Bafana Bafana tras años en el ostracismo"},
  "KOR":{"name":"Hong Myung-bo",         "nat":"🇰🇷 Corea del Sur","since":"2023","note":"Leyenda del fútbol coreano. Jugó el 4.º puesto de 2002"},
  "CZE":{"name":"Ivan Hašek",            "nat":"🇨🇿 Rep. Checa",   "since":"2024","note":"Ex capitán de la selección"},
  "CAN":{"name":"Jesse Marsch",          "nat":"🇺🇸 EE.UU.",       "since":"2023","note":"Primer seleccionador americano de Canadá"},
  "BIH":{"name":"Sergej Barbarez",       "nat":"🇧🇦 Bosnia",       "since":"2024","note":"Ex delantero internacional de Bosnia"},
  "QAT":{"name":"Marcello Lippi",        "nat":"🇮🇹 Italia",       "since":"2016","note":"Campeón del mundo con Italia en 2006"},
  "SUI":{"name":"Murat Yakin",           "nat":"🇨🇭 Suiza",        "since":"2021","note":"Ex internacional suizo. 3.ª fase de grupos seguida"},
  "BRA":{"name":"Dorival Júnior",        "nat":"🇧🇷 Brasil",       "since":"2024","note":"Campeón de la Copa Libertadores 2022 con Flamengo"},
  "MAR":{"name":"Walid Regragui",        "nat":"🇲🇦 Marruecos",    "since":"2022","note":"Llevó a Marruecos a semifinales en Qatar 2022"},
  "HAI":{"name":"Marc Collat",           "nat":"🇫🇷 Francia",      "since":"2023","note":"Técnico francés con amplia experiencia en África"},
  "SCO":{"name":"Steve Clarke",          "nat":"🏴󠁧󠁢󠁳󠁣󠁴󠁿 Escocia",     "since":"2019","note":"Primera Eurocopa en 25 años y primer Mundial en 28"},
  "USA":{"name":"Mauricio Pochettino",   "nat":"🇦🇷 Argentina",    "since":"2024","note":"Ex PSG, Tottenham y Chelsea"},
  "PRY":{"name":"Gustavo Alfaro",        "nat":"🇦🇷 Argentina",    "since":"2024","note":"Llevó a Ecuador al Mundial 2022"},
  "AUS":{"name":"Tony Popovic",          "nat":"🇦🇺 Australia",    "since":"2024","note":"Leyenda de los Socceroos como jugador"},
  "TUR":{"name":"Vincenzo Montella",     "nat":"🇮🇹 Italia",       "since":"2023","note":"Ex delantero. Dirigió la sorpresa turca en la Euro 2024"},
  "ALG":{"name":"Pepe",                  "nat":"🇵🇹 Portugal",     "since":"2023","note":"Leyenda del fútbol portugués al mando de Argelia"},
  "GER":{"name":"Julian Nagelsmann",     "nat":"🇩🇪 Alemania",     "since":"2023","note":"El técnico más joven en dirigir una Eurocopa"},
  "CIV":{"name":"Emerse Faé",            "nat":"🇨🇮 C. de Marfil", "since":"2024","note":"Llevó a Costa de Marfil al título de la Copa África 2023"},
  "ECU":{"name":"Sebastián Beccacece",   "nat":"🇦🇷 Argentina",    "since":"2024","note":"Excelente trabajo previo en Defensa y Justicia"},
  "NED":{"name":"Ronald Koeman",         "nat":"🇳🇱 P. Bajos",     "since":"2023","note":"Subcampeón del mundo como jugador en 1994"},
  "JPN":{"name":"Hajime Moriyasu",       "nat":"🇯🇵 Japón",        "since":"2018","note":"8 años al mando; campeón de Asia 2023"},
  "SWE":{"name":"Jon Dahl Tomasson",     "nat":"🇩🇰 Dinamarca",    "since":"2022","note":"Ex delantero; guía a Suecia a su primer Mundial desde 2018"},
  "TUN":{"name":"Faouzi Benzarti",       "nat":"🇹🇳 Túnez",        "since":"2024","note":"Veterano técnico tunecino con varias etapas en la selección"},
  "BEL":{"name":"Domenico Tedesco",      "nat":"🇩🇪 Alemania",     "since":"2023","note":"Fue el técnico del Leipzig en Champions"},
  "EGY":{"name":"Hossam Hassan",         "nat":"🇪🇬 Egipto",       "since":"2024","note":"Máximo goleador histórico de África como jugador"},
  "IRN":{"name":"Amir Ghalenoei",        "nat":"🇮🇷 Irán",         "since":"2023","note":"Primer iraní al frente de la selección en un Mundial"},
  "NZL":{"name":"Darren Bazeley",        "nat":"🇳🇿 N. Zelanda",   "since":"2023","note":"Ex lateral del Watford en la Premier League"},
  "ESP":{"name":"Luis de la Fuente",     "nat":"🇪🇸 España",       "since":"2022","note":"Campeón de la Eurocopa 2024 con España"},
  "CPV":{"name":"Pedro Brito «Bubista»", "nat":"🇨🇻 Cabo Verde",   "since":"2020","note":"Artífice del ascenso de Cabo Verde al top-60 FIFA"},
  "KSA":{"name":"Hervé Renard",          "nat":"🇫🇷 Francia",      "since":"2025","note":"Ganó la Copa África en 2 ocasiones con diferentes países"},
  "URU":{"name":"Marcelo Bielsa",        "nat":"🇦🇷 Argentina",    "since":"2023","note":"«El Loco». Filosofía de pressing total"},
  "FRA":{"name":"Didier Deschamps",      "nat":"🇫🇷 Francia",      "since":"2012","note":"Campeón del mundo 1998 (jugador) y 2018 (técnico)"},
  "SEN":{"name":"Aliou Cissé",           "nat":"🇸🇳 Senegal",      "since":"2015","note":"Llevó a Senegal al título de la CAN 2021"},
  "IRQ":{"name":"Jesús Casas",           "nat":"🇪🇸 España",       "since":"2023","note":"Ex técnico de la sub-21 española"},
  "NOR":{"name":"Ståle Solbakken",       "nat":"🇳🇴 Noruega",      "since":"2020","note":"Gestiona el proyecto Haaland con inteligencia"},
  "ARG":{"name":"Lionel Scaloni",        "nat":"🇦🇷 Argentina",    "since":"2018","note":"Campeón del mundo en Qatar 2022. La era dorada del fútbol argentino"},
  "DZA":{"name":"Vladimir Petković",     "nat":"🇧🇦 Bosnia",       "since":"2023","note":"Ex seleccionador de Suiza y de la Lazio"},
  "AUT":{"name":"Ralf Rangnick",         "nat":"🇩🇪 Alemania",     "since":"2022","note":"Padre del pressing moderno. Fundador del modelo RB"},
  "JOR":{"name":"Hussein Ammouta",       "nat":"🇲🇦 Marruecos",    "since":"2023","note":"Logró el histórico ascenso de Jordania al top-70 FIFA"},
  "POR":{"name":"Roberto Martínez",      "nat":"🇪🇸 España",       "since":"2023","note":"Dirigió a Bélgica durante 6 años. Ex seleccionador de la Roja Sub-21"},
  "COD":{"name":"Sébastien Desabre",     "nat":"🇫🇷 Francia",      "since":"2022","note":"Amplia experiencia en el fútbol africano"},
  "UZB":{"name":"Srecko Katanec",        "nat":"🇸🇮 Eslovenia",    "since":"2016","note":"Ex internacional yugoslavo; lleva a Uzbekistán a su primer Mundial"},
  "COL":{"name":"Néstor Lorenzo",        "nat":"🇦🇷 Argentina",    "since":"2022","note":"Discípulo de Bielsa. Llevó a Colombia invicta al Mundial"},
  "ENG":{"name":"Thomas Tuchel",         "nat":"🇩🇪 Alemania",     "since":"2024","note":"Campeón de la Champions con Chelsea. Favorito al título"},
  "HRV":{"name":"Zlatko Dalić",          "nat":"🇭🇷 Croacia",      "since":"2017","note":"Final en 2018, 3.º en 2022. El gran técnico croata"},
  "GHA":{"name":"Otto Addo",             "nat":"🇬🇭 Ghana",        "since":"2022","note":"Lleva una doble vida: técnico de Ghana y ojeador del Dortmund"},
  "PAN":{"name":"Thomas Christiansen",   "nat":"🇩🇰 Dinamarca",    "since":"2022","note":"Ex internacional danés. Ha mejorado el juego de Panamá"},
  "DEN":{"name":"Kasper Hjulmand",       "nat":"🇩🇰 Dinamarca",    "since":"2020","note":"Semifinalista de la Eurocopa 2020 de forma sorprendente"},
  "GRE":{"name":"Ivan Jovanović",        "nat":"🇷🇸 Serbia",       "since":"2023","note":"Guía a Grecia a su primera gran fase final en mucho tiempo"},
  "SRB":{"name":"Dragan Stojković",      "nat":"🇷🇸 Serbia",       "since":"2021","note":"Leyenda del fútbol serbio. El «Piksi»"},
  "NGA":{"name":"Eric Chelle",           "nat":"🇲🇱 Malí",         "since":"2024","note":"Ex técnico de Malí, nombrado para revitalizar a las Súper Águilas"},
  "CRC":{"name":"Claudio Vivas",         "nat":"🇦🇷 Argentina",    "since":"2023","note":"Pupilo de Bielsa con amplia trayectoria en CONCACAF"},
  "HON":{"name":"Reinaldo Rueda",        "nat":"🇨🇴 Colombia",     "since":"2024","note":"Dirigió a Colombia, Ecuador, Chile y Honduras"},
  "JAM":{"name":"Heimir Hallgrímsson",   "nat":"🇮🇸 Islandia",     "since":"2022","note":"Llevó a Islandia a la Eurocopa 2016; ahora con Jamaica"},
  "VEN":{"name":"Fernando Batista",      "nat":"🇦🇷 Argentina",    "since":"2022","note":"Ex técnico de la sub-20 argentina"},
  "CHI":{"name":"Ricardo Gareca",        "nat":"🇦🇷 Argentina",    "since":"2024","note":"Llevó a Perú a Rusia 2018. Ahora al frente de Chile"},
  "BOL":{"name":"Óscar Villegas",        "nat":"🇧🇴 Bolivia",      "since":"2023","note":"Primer boliviano en dirigir a Bolivia en una Copa del Mundo"},
  "PER":{"name":"Jorge Fossati",         "nat":"🇺🇾 Uruguay",      "since":"2024","note":"Veterano con amplia experiencia en Perú y la región"},
  "CUW":{"name":"Diego Vázquez",         "nat":"🇦🇷 Argentina",    "since":"2015","note":"Uno de los técnicos más longevos en la selección de Curazao"},
};

/* ── Key players per FIFA code ── */
const KEY_PLAYERS = {
  "ARG":[{"pos":"PO","name":"Juan Musso","club":"Atlético De Madrid","note":"4 int."},{"pos":"MC","name":"Marcos Senesi","club":"AFC Bournemouth","note":"3 int."},{"pos":"DF","name":"Nicolas Tagliafico","club":"Olympique Lyonnais","note":"76 int. · 1 gls"},{"pos":"DF","name":"Gonzalo Montiel","club":"CA River Plate","note":"39 int. · 2 gls"},{"pos":"MC","name":"Leandro Paredes","club":"CA Boca Juniors","note":"77 int. · 5 gls"},{"pos":"DF","name":"Lisandro Martinez","club":"Manchester United FC","note":"28 int. · 1 gls"},{"pos":"MC","name":"Rodrigo De Paul","club":"Inter Miami CF","note":"87 int. · 2 gls"},{"pos":"MC","name":"Valentin Barco","club":"RC Strasbourg","note":"4 int. · 2 gls"},{"pos":"DC","name":"Julian Alvarez","club":"Atlético De Madrid","note":"51 int. · 14 gls"},{"pos":"DC","name":"Lionel Messi","club":"Inter Miami CF","note":"199 int. · 117 gls"},{"pos":"MC","name":"Giovani Lo Celso","club":"Real Betis","note":"67 int. · 4 gls"},{"pos":"PO","name":"Geronimo Rulli","club":"Olympique Marseille","note":"8 int."},{"pos":"DF","name":"Cristian Romero","club":"Tottenham Hotspur FC","note":"51 int. · 3 gls"},{"pos":"MC","name":"Exequiel Palacios","club":"Bayer 04 Leverkusen","note":"40 int."},{"pos":"MC","name":"Nico Gonzalez","club":"Atlético De Madrid","note":"51 int. · 6 gls"},{"pos":"DC","name":"Thiago Almada","club":"Atlético De Madrid","note":"16 int. · 5 gls"},{"pos":"DC","name":"Giuliano Simeone","club":"Atlético De Madrid","note":"13 int. · 2 gls"},{"pos":"DC","name":"Nico Paz","club":"Como","note":"9 int. · 1 gls"},{"pos":"DF","name":"Nicolas Otamendi","club":"SL Benca","note":"132 int. · 8 gls"},{"pos":"MC","name":"Alexis Mac Allister","club":"Liverpool FC","note":"46 int. · 6 gls"},{"pos":"DC","name":"Jose Lopez","club":"SE Palmeiras","note":"5 int."},{"pos":"DC","name":"Lautaro Martinez","club":"FC Internazionale Milano","note":"77 int. · 37 gls"},{"pos":"PO","name":"Emiliano Martinez","club":"Aston Villa FC","note":"59 int."},{"pos":"MC","name":"Enzo Fernandez","club":"Chelsea FC","note":"42 int. · 6 gls"},{"pos":"DF","name":"Facundo Medina","club":"Olympique Marseille","note":"9 int."},{"pos":"DF","name":"Nahuel Molina","club":"Atlético De Madrid","note":"58 int. · 1 gls"}],
  "AUS":[{"pos":"PO","name":"Mathew Ryan","club":"Levante UD","note":"104 int."},{"pos":"DF","name":"Milos Degenek","club":"APOEL FC","note":"57 int. · 1 gls"},{"pos":"DF","name":"Alessandro Circati","club":"Parma","note":"14 int. · 1 gls"},{"pos":"DF","name":"Jacob Italiano","club":"Grazer AK","note":"6 int."},{"pos":"DF","name":"Jordan Bos","club":"Feyenoord Rotterdam","note":"28 int. · 4 gls"},{"pos":"DF","name":"Jason Geria","club":"Albirex Niigata","note":"15 int."},{"pos":"DC","name":"Mathew Leckie","club":"Melbourne City FC","note":"81 int. · 14 gls"},{"pos":"MC","name":"Connor Metcalfe","club":"FC St. Pauli","note":"37 int. · 2 gls"},{"pos":"DC","name":"Mohamed Toure","club":"Norwich City FC","note":"11 int. · 2 gls"},{"pos":"DC","name":"Ajdin Hrustic","club":"SC Heracles Almelo","note":"37 int. · 3 gls"},{"pos":"DC","name":"Awer Mabil","club":"CD Castellón","note":"38 int. · 10 gls"},{"pos":"PO","name":"Paul Izzo","club":"Randers FC","note":"4 int."},{"pos":"MC","name":"Aiden Oneill","club":"New York City FC","note":"32 int."},{"pos":"MC","name":"Cameron Devlin","club":"Heart Of Midlothian FC","note":"5 int."},{"pos":"DF","name":"Kai Trewin","club":"New York City FC","note":"6 int."},{"pos":"DF","name":"Aziz Behich","club":"Melbourne City FC","note":"85 int. · 3 gls"},{"pos":"DC","name":"Nestory Irankunda","club":"Watford FC","note":"16 int. · 6 gls"},{"pos":"PO","name":"Patrick Beach","club":"Melbourne City FC","note":"3 int."},{"pos":"DF","name":"Harry Souttar","club":"Leicester City FC","note":"39 int. · 11 gls"},{"pos":"DC","name":"Cristian Volpato","club":"US Sassuolo","note":"1 int."},{"pos":"DF","name":"Cameron Burgess","club":"Swansea City AFC","note":"28 int."},{"pos":"MC","name":"Jackson Irvine","club":"FC St. Pauli","note":"83 int. · 14 gls"},{"pos":"DC","name":"Nishan Velupillay","club":"Melbourne Victory FC","note":"8 int. · 3 gls"},{"pos":"MC","name":"Paul Okon-engstler","club":"Sydney FC","note":"7 int."},{"pos":"DF","name":"Lucas Herrington","club":"Colorado Rapids","note":"4 int."},{"pos":"DC","name":"Tete Yengi","club":"FC Machida Zelvia","note":"2 int. · 1 gls"}],
  "AUT":[{"pos":"PO","name":"Alexander Schlager","club":"FC Red Bull Salzburg","note":"26 int."},{"pos":"DF","name":"David Affengruber","club":"Elche CF","note":"1 int."},{"pos":"DF","name":"Kevin Danso","club":"Tottenham Hotspur FC","note":"32 int."},{"pos":"MC","name":"Xaver Schlager","club":"RB Leipzig","note":"51 int. · 4 gls"},{"pos":"DF","name":"Stefan Posch","club":"1. FSV Mainz 05","note":"52 int. · 5 gls"},{"pos":"MC","name":"Nicolas Seiwald","club":"RB Leipzig","note":"47 int. · 1 gls"},{"pos":"DC","name":"Marko Arnautovic","club":"FK Crvena Zvezda","note":"133 int. · 47 gls"},{"pos":"DF","name":"David Alaba","club":"Real Madrid C. F.","note":"113 int. · 15 gls"},{"pos":"MC","name":"Marcel Sabitzer","club":"Borussia Dortmund","note":"98 int. · 26 gls"},{"pos":"MC","name":"Florian Grillitsch","club":"SC Braga","note":"59 int. · 1 gls"},{"pos":"DC","name":"Michael Gregoritsch","club":"FC Augsburg","note":"75 int. · 24 gls"},{"pos":"PO","name":"Florian Wiegele","club":"FC Viktoria Plze ň","note":"1 int."},{"pos":"PO","name":"Patrick Pentz","club":"Brøndby IF","note":"18 int."},{"pos":"DC","name":"Sasa Kalajdzic","club":"LASK Linz","note":"22 int. · 4 gls"},{"pos":"DF","name":"Philipp Lienhart","club":"SC Freiburg","note":"41 int. · 3 gls"},{"pos":"DF","name":"Phillip Mwene","club":"1. FSV Mainz 05","note":"30 int."},{"pos":"MC","name":"Carney Chukwuemeka","club":"Borussia Dortmund","note":"3 int. · 1 gls"},{"pos":"MC","name":"Romano Schmid","club":"SV Werder Bremen","note":"34 int. · 3 gls"},{"pos":"MC","name":"Dejan Ljubicic","club":"FC Schalke 04","note":"9 int. · 1 gls"},{"pos":"MC","name":"Konrad Laimer","club":"FC Bayern München","note":"57 int. · 7 gls"},{"pos":"DC","name":"Patrick Wimmer","club":"VfL Wolfsburg","note":"30 int. · 1 gls"},{"pos":"MC","name":"Alexander Prass","club":"TSG Hoffenheim","note":"19 int."},{"pos":"DF","name":"Marco Friedl","club":"SV Werder Bremen","note":"11 int."},{"pos":"MC","name":"Paul Wanner","club":"PSV Eindhoven","note":"3 int."},{"pos":"DF","name":"Michael Svoboda","club":"Venezia FC","note":"4 int."},{"pos":"MC","name":"Alessandro Schoepf","club":"Wolfsberger AC","note":"35 int. · 6 gls"}],
  "BEL":[{"pos":"PO","name":"Thibaut Courtois","club":"Real Madrid C. F.","note":"109 int."},{"pos":"DF","name":"Zeno Debast","club":"Sporting CP","note":"26 int. · 1 gls"},{"pos":"DF","name":"Arthur Theate","club":"Eintracht Frankfurt","note":"33 int. · 1 gls"},{"pos":"DF","name":"Brandon Mechele","club":"Club Brugge","note":"9 int. · 1 gls"},{"pos":"DF","name":"Maxim De Cuyper","club":"Brighton & Hove Albion FC","note":"19 int. · 4 gls"},{"pos":"MC","name":"Axel Witsel","club":"Girona FC","note":"138 int. · 12 gls"},{"pos":"MC","name":"Kevin De Bruyne","club":"SSC Napoli","note":"119 int. · 37 gls"},{"pos":"MC","name":"Youri Tielemans","club":"Aston Villa FC","note":"85 int. · 13 gls"},{"pos":"DC","name":"Romelu Lukaku","club":"SSC Napoli","note":"126 int. · 90 gls"},{"pos":"DC","name":"Leandro Trossard","club":"Arsenal FC","note":"51 int. · 12 gls"},{"pos":"DC","name":"Jeremy Doku","club":"Manchester City FC","note":"43 int. · 7 gls"},{"pos":"PO","name":"Senne Lammens","club":"Manchester United FC","note":"2 int."},{"pos":"PO","name":"Mike Penders","club":"RC Strasbourg","note":"0 int."},{"pos":"DC","name":"Dodi Lukebakio","club":"SL Benca","note":"30 int. · 6 gls"},{"pos":"DF","name":"Thomas Meunier","club":"Lille OSC","note":"80 int. · 10 gls"},{"pos":"DF","name":"Koni De Winter","club":"AC Milan","note":"8 int."},{"pos":"DC","name":"Charles De Ketelaere","club":"Atalanta Bergamo","note":"30 int. · 6 gls"},{"pos":"DF","name":"Joaquin Seys","club":"Club Brugge","note":"5 int."},{"pos":"MC","name":"Diego Moreira","club":"RC Strasbourg","note":"3 int."},{"pos":"MC","name":"Hans Vanaken","club":"Club Brugge","note":"34 int. · 7 gls"},{"pos":"DF","name":"Timothy Castagne","club":"Fulham FC","note":"63 int. · 2 gls"},{"pos":"MC","name":"Alexis Saelemaekers","club":"AC Milan","note":"24 int. · 2 gls"},{"pos":"MC","name":"Nicolas Raskin","club":"Rangers FC","note":"13 int. · 2 gls"},{"pos":"MC","name":"Amadou Onana","club":"Aston Villa FC","note":"29 int. · 1 gls"},{"pos":"DF","name":"Nathan Ngoy","club":"Lille OSC","note":"4 int."},{"pos":"DC","name":"Matias Fernandez-pardo","club":"Lille OSC","note":"2 int."}],
  "BIH":[{"pos":"PO","name":"Nikola Vasilj","club":"FC St. Pauli","note":"27 int."},{"pos":"DF","name":"Nihad Mujakic","club":"Gaziantep FK","note":"12 int. · 1 gls"},{"pos":"DF","name":"Dennis Hadzikadunic","club":"UC Sampdoria","note":"32 int."},{"pos":"DF","name":"Tarik Muharemovic","club":"US Sassuolo","note":"15 int. · 1 gls"},{"pos":"DF","name":"Sead Kolasinac","club":"Atalanta Bergamo","note":"66 int."},{"pos":"MC","name":"Benjamin Tahirovic","club":"Brøndby IF","note":"29 int. · 2 gls"},{"pos":"DF","name":"Amar Dedic","club":"SL Benca","note":"29 int. · 1 gls"},{"pos":"MC","name":"Armin Gigovic","club":"BSC Young Boys","note":"21 int. · 1 gls"},{"pos":"DC","name":"Samed Bazdar","club":"Jagiellonia Bia ł ystok","note":"14 int. · 1 gls"},{"pos":"DC","name":"Ermedin Demirovic","club":"VfB Stuttgart","note":"41 int. · 4 gls"},{"pos":"DC","name":"Edin Dzeko","club":"FC Schalke 04","note":"148 int. · 73 gls"},{"pos":"PO","name":"Mladen Jurkas","club":"FK Borac Banja Luka","note":"0 int."},{"pos":"MC","name":"Ivan Basic","club":"FC Astana","note":"18 int."},{"pos":"MC","name":"Ivan Sunjic","club":"Pafos FC","note":"12 int."},{"pos":"MC","name":"Amar Memic","club":"FC Viktoria Plze ň","note":"14 int. · 1 gls"},{"pos":"MC","name":"Amir Hadziahmetovic","club":"Hull City FC","note":"36 int."},{"pos":"MC","name":"Dzenis Burnic","club":"Karlsruher SC","note":"21 int."},{"pos":"DF","name":"Nikola Katic","club":"FC Schalke 04","note":"18 int. · 2 gls"},{"pos":"DC","name":"Kerim Alajbegovic","club":"FC Red Bull Salzburg","note":"11 int. · 1 gls"},{"pos":"DC","name":"Esmir Bajraktarevic","club":"PSV Eindhoven","note":"17 int. · 1 gls"},{"pos":"DF","name":"Stjepan Radeljic","club":"HNK Rijeka","note":"5 int."},{"pos":"PO","name":"Martin Zlomislic","club":"HNK Rijeka","note":"3 int."},{"pos":"DC","name":"Haris Tabakovic","club":"Borussia Mönchengladbach","note":"10 int. · 4 gls"},{"pos":"DF","name":"Arjan Malic","club":"SK Sturm Graz","note":"8 int."},{"pos":"DC","name":"Jovo Lukic","club":"Universitatea Cluj","note":"4 int. · 1 gls"},{"pos":"MC","name":"Ermin Mahmic","club":"FC Slovan Liberec","note":"2 int."}],
  "BRA":[{"pos":"PO","name":"Alisson","club":"Liverpool FC","note":"79 int."},{"pos":"MC","name":"Ederson Silva","club":"Atalanta Bergamo","note":"3 int."},{"pos":"DF","name":"Gabriel Magalhaes","club":"Arsenal FC","note":"18 int. · 1 gls"},{"pos":"DF","name":"Marcos Marquinhos","club":"Paris Saint-Germain","note":"106 int. · 7 gls"},{"pos":"MC","name":"Carlos Casemiro","club":"Manchester United FC","note":"87 int. · 9 gls"},{"pos":"DF","name":"Alex","club":"CR Flamengo","note":"45 int. · 2 gls"},{"pos":"DC","name":"Vinicius","club":"Real Madrid C. F.","note":"50 int. · 10 gls"},{"pos":"MC","name":"Bruno","club":"Newcastle United FC","note":"44 int. · 3 gls"},{"pos":"DC","name":"Matheus Cunha","club":"Manchester United FC","note":"24 int. · 1 gls"},{"pos":"DC","name":"Neymar Jr","club":"Santos FC","note":"128 int. · 79 gls"},{"pos":"DC","name":"Raphael Raphinha","club":"FC Barcelona","note":"40 int. · 11 gls"},{"pos":"PO","name":"Weverton","club":"Grêmio FBPA","note":"11 int."},{"pos":"DF","name":"Danilo","club":"CR Flamengo","note":"71 int. · 1 gls"},{"pos":"DF","name":"Gleison Bremer","club":"Juventus FC","note":"8 int. · 1 gls"},{"pos":"DF","name":"Leonardo Leo","club":"CR Flamengo","note":"4 int."},{"pos":"DF","name":"Douglas Santos","club":"FC Zenit St. Petersburg","note":"8 int."},{"pos":"MC","name":"Fabio Fabinho","club":"Al Ittihad","note":"34 int."},{"pos":"MC","name":"Danilo Santos","club":"Botafogo","note":"5 int. · 2 gls"},{"pos":"DC","name":"Endrick","club":"Olympique Lyonnais","note":"17 int. · 4 gls"},{"pos":"MC","name":"Lucas Paqueta","club":"CR Flamengo","note":"64 int. · 13 gls"},{"pos":"DC","name":"Luiz","club":"FC Zenit St. Petersburg","note":"16 int. · 2 gls"},{"pos":"DC","name":"Gabriel","club":"Arsenal FC","note":"23 int. · 4 gls"},{"pos":"PO","name":"Ederson","club":"Fenerbahçe SK","note":"32 int."},{"pos":"DF","name":"Roger","club":"Al Ahli FC","note":"8 int."},{"pos":"DC","name":"Igor Thiago","club":"Brentford FC","note":"5 int. · 2 gls"},{"pos":"DC","name":"Rayan","club":"AFC Bournemouth","note":"2 int. · 1 gls"}],
  "CAN":[{"pos":"PO","name":"Dayne St. Clair","club":"Inter Miami CF","note":"20 int."},{"pos":"DF","name":"Alistair Johnston","club":"Celtic FC","note":"59 int. · 1 gls"},{"pos":"DF","name":"Al Jones","club":"Middlesbrough FC","note":"2 int."},{"pos":"DF","name":"Luc De Fougerolles","club":"FCV Dender EH","note":"14 int."},{"pos":"DF","name":"Joel Waterman","club":"Chicago Fire FC","note":"17 int."},{"pos":"MC","name":"Mathieu Choiniere","club":"LAFC","note":"24 int."},{"pos":"MC","name":"Stephen Eustaquio","club":"LAFC","note":"57 int. · 4 gls"},{"pos":"MC","name":"Ismael Kone","club":"US Sassuolo","note":"41 int. · 4 gls"},{"pos":"DC","name":"Cyle Larin","club":"Southampton FC","note":"91 int. · 31 gls"},{"pos":"DC","name":"Jonathan David","club":"Juventus FC","note":"78 int. · 39 gls"},{"pos":"MC","name":"Liam Millar","club":"Hull City FC","note":"42 int. · 1 gls"},{"pos":"DC","name":"Tani Oluwaseyi","club":"Villarreal CF","note":"25 int. · 2 gls"},{"pos":"DF","name":"Derek Cornelius","club":"Rangers FC","note":"45 int. · 1 gls"},{"pos":"MC","name":"Jacob Shaffelburg","club":"LAFC","note":"32 int. · 6 gls"},{"pos":"DF","name":"Moise Bombito","club":"OGC Nice","note":"20 int."},{"pos":"PO","name":"Maxime Crepeau","club":"Orlando City SC","note":"33 int."},{"pos":"DC","name":"Tajon Buchanan","club":"Villarreal CF","note":"61 int. · 8 gls"},{"pos":"PO","name":"Owen Goodman","club":"Barnsley","note":"0 int."},{"pos":"DF","name":"Alphonso Davies","club":"FC Bayern München","note":"58 int. · 15 gls"},{"pos":"DC","name":"Ali Ahmed","club":"Norwich City FC","note":"25 int. · 1 gls"},{"pos":"MC","name":"Jonathan Osorio","club":"Toronto FC","note":"92 int. · 10 gls"},{"pos":"DF","name":"Richie Laryea","club":"Toronto FC","note":"77 int. · 1 gls"},{"pos":"DF","name":"Niko Sigur","club":"HNK Hajduk Split","note":"19 int. · 2 gls"},{"pos":"DC","name":"Promise David","club":"Royale Union Saint-Gilloise","note":"11 int. · 3 gls"},{"pos":"MC","name":"Nathan Saliba","club":"RSC Anderlecht","note":"15 int. · 2 gls"},{"pos":"DC","name":"Jayden Nelson","club":"Austin FC","note":"15 int. · 3 gls"}],
  "CIV":[{"pos":"PO","name":"Yahia Fofana","club":"Çaykur Rizespor","note":"37 int."},{"pos":"DF","name":"Ousmane Diomande","club":"Sporting CP","note":"16 int. · 1 gls"},{"pos":"DF","name":"Ghislain Konan","club":"Gil Vicente FC","note":"55 int."},{"pos":"MC","name":"Jean Seri","club":"NK Maribor","note":"65 int. · 4 gls"},{"pos":"DF","name":"Wilfried Singo","club":"Galatasaray SK","note":"36 int. · 1 gls"},{"pos":"MC","name":"Seko Fofana","club":"FC Porto","note":"33 int. · 7 gls"},{"pos":"DF","name":"Odilon Kossounou","club":"Atalanta Bergamo","note":"37 int."},{"pos":"MC","name":"Franck Kessie","club":"Al Ahli FC","note":"105 int. · 15 gls"},{"pos":"DC","name":"Ange Bonny","club":"FC Internazionale Milano","note":"2 int."},{"pos":"DC","name":"Simon Adingra","club":"AS Monaco","note":"29 int. · 5 gls"},{"pos":"DC","name":"Yan Diomande","club":"RB Leipzig","note":"11 int. · 3 gls"},{"pos":"DC","name":"Elye Wahi","club":"OGC Nice","note":"3 int."},{"pos":"DF","name":"Christopher Operi","club":"Ba ş ak ş ehir FK","note":"12 int."},{"pos":"DC","name":"Oumar Diakite","club":"Cercle Brugge","note":"29 int. · 6 gls"},{"pos":"DC","name":"Amad Diallo","club":"Manchester United FC","note":"20 int. · 7 gls"},{"pos":"PO","name":"Mohamed Kone","club":"Sporting Charleroi","note":"0 int."},{"pos":"DF","name":"Guela Doue","club":"RC Strasbourg","note":"21 int. · 3 gls"},{"pos":"MC","name":"Ibrahim Sangare","club":"Nottingham Forest FC","note":"56 int. · 11 gls"},{"pos":"DC","name":"Nicolas Pepe","club":"Villarreal CF","note":"57 int. · 12 gls"},{"pos":"DF","name":"Emmanuel Agbadou","club":"Be ş ikta ş  JK","note":"22 int. · 2 gls"},{"pos":"DF","name":"Evan Ndicka","club":"AS Roma","note":"29 int."},{"pos":"DC","name":"Evann Guessand","club":"Crystal Palace FC","note":"21 int. · 4 gls"},{"pos":"PO","name":"Alban Lafont","club":"Panathinaikos FC","note":"4 int."},{"pos":"DC","name":"Bazoumana Toure","club":"TSG Hoffenheim","note":"7 int. · 2 gls"},{"pos":"MC","name":"Parfait Guiagon","club":"Sporting Charleroi","note":"5 int."},{"pos":"MC","name":"Christ Oulai","club":"Trabzonspor","note":"10 int."}],
  "COD":[{"pos":"PO","name":"Lionel Mpasi","club":"Le Havre AC","note":"28 int."},{"pos":"DF","name":"Aaron Wan-bissaka","club":"West Ham United FC","note":"12 int."},{"pos":"DF","name":"Steve Kapuadi","club":"Widzew Ł ód ź","note":"3 int."},{"pos":"DF","name":"Axel Tuanzebe","club":"Burnley FC","note":"13 int. · 1 gls"},{"pos":"DF","name":"Dylan Batubinsika","club":"AEL FC","note":"15 int. · 1 gls"},{"pos":"MC","name":"Ngalayel Mukau","club":"Lille OSC","note":"14 int."},{"pos":"MC","name":"Nathanael Mbuku","club":"Montpellier HSC","note":"19 int. · 2 gls"},{"pos":"MC","name":"Samuel Moutoussamy","club":"Atromitos FC","note":"58 int."},{"pos":"DC","name":"Brian Cipenga","club":"CD Castellón","note":"8 int."},{"pos":"MC","name":"Theo Bongonda","club":"FC Spartak Moscow","note":"38 int. · 7 gls"},{"pos":"DC","name":"Gael Kakuta","club":"AEL FC","note":"31 int. · 5 gls"},{"pos":"DF","name":"Joris Kayembe","club":"KRC Genk","note":"26 int. · 1 gls"},{"pos":"DC","name":"Meschack Elia","club":"Alanyaspor","note":"68 int. · 12 gls"},{"pos":"MC","name":"Noah Sadiki","club":"Sunderland AFC","note":"20 int."},{"pos":"MC","name":"Aaron Tshibola","club":"Kilmarnock FC","note":"17 int. · 1 gls"},{"pos":"PO","name":"Timothy Fayulu","club":"FC Noah","note":"3 int."},{"pos":"DC","name":"Cedric Bakambu","club":"Real Betis","note":"70 int. · 21 gls"},{"pos":"MC","name":"Charles Pickel","club":"RCD Espanyol","note":"34 int. · 1 gls"},{"pos":"DC","name":"Fiston Mayele","club":"Pyramids FC","note":"36 int. · 5 gls"},{"pos":"DC","name":"Yoane Wissa","club":"Newcastle United FC","note":"38 int. · 8 gls"},{"pos":"PO","name":"Matthieu Epolo","club":"Standard Liège","note":"1 int."},{"pos":"DF","name":"Chancel Mbemba","club":"Lille OSC","note":"109 int. · 7 gls"},{"pos":"DC","name":"Simon Banza","club":"Al Jazira","note":"15 int. · 2 gls"},{"pos":"DF","name":"Gedeon Kalulu","club":"Aris Limassol FC","note":"28 int."},{"pos":"MC","name":"Edo Kayembe","club":"Watford FC","note":"42 int. · 2 gls"},{"pos":"DF","name":"Arthur Masuaku","club":"RC Lens","note":"44 int. · 4 gls"}],
  "COL":[{"pos":"PO","name":"David Ospina","club":"Atlético Nacional","note":"130 int."},{"pos":"DF","name":"Daniel Munoz","club":"Crystal Palace FC","note":"46 int. · 3 gls"},{"pos":"DF","name":"Jhon Lucumi","club":"Bologna FC","note":"37 int. · 1 gls"},{"pos":"DF","name":"Santiago Arias","club":"CA Independiente","note":"68 int."},{"pos":"MC","name":"Kevin Castano","club":"CA River Plate","note":"25 int."},{"pos":"MC","name":"Richard Rios","club":"SL Benca","note":"32 int. · 2 gls"},{"pos":"DC","name":"Luis Diaz","club":"FC Bayern München","note":"74 int. · 22 gls"},{"pos":"MC","name":"Jorge Carrascal","club":"CR Flamengo","note":"25 int. · 2 gls"},{"pos":"DC","name":"Jhon Cordoba","club":"FC Krasnodar","note":"21 int. · 6 gls"},{"pos":"MC","name":"James Rodriguez","club":"Minnesota United FC","note":"126 int. · 31 gls"},{"pos":"MC","name":"Jhon Arias","club":"SE Palmeiras","note":"38 int. · 6 gls"},{"pos":"PO","name":"Camilo Vargas","club":"Atlas FC","note":"42 int."},{"pos":"DF","name":"Yerry Mina","club":"Cagliari","note":"54 int. · 8 gls"},{"pos":"DF","name":"Gustavo Puerta","club":"Racing Santander","note":"6 int. · 1 gls"},{"pos":"MC","name":"Juan Portilla","club":"Athletico Paranaense","note":"10 int."},{"pos":"MC","name":"Jefferson Lerma","club":"Crystal Palace FC","note":"65 int. · 5 gls"},{"pos":"DF","name":"Johan Mojica","club":"RCD Mallorca","note":"45 int. · 1 gls"},{"pos":"DF","name":"Willer Ditta","club":"CF Cruz Azul","note":"5 int."},{"pos":"DC","name":"Cucho Hernandez","club":"Real Betis","note":"9 int. · 2 gls"},{"pos":"MC","name":"Juan Quintero","club":"CA River Plate","note":"49 int. · 6 gls"},{"pos":"DC","name":"Jaminton Campaz","club":"CA Rosario Central","note":"10 int. · 1 gls"},{"pos":"DF","name":"Deiver Machado","club":"FC Nantes","note":"15 int."},{"pos":"DF","name":"Davinson Sanchez","club":"Galatasaray SK","note":"79 int. · 4 gls"},{"pos":"PO","name":"Alvaro Montero","club":"CA Vélez Sarseld","note":"12 int."},{"pos":"DC","name":"Luis Suarez","club":"Sporting CP","note":"12 int. · 5 gls"},{"pos":"DC","name":"Andres Gomez","club":"CR Vasco Da Gama","note":"8 int. · 2 gls"}],
  "CPV":[{"pos":"PO","name":"Josimar Vozinha","club":"GD Chaves","note":"90 int."},{"pos":"DF","name":"Ianique Stopira","club":"SCU Torreense","note":"61 int. · 4 gls"},{"pos":"DF","name":"Edilson Diney","club":"Al Bataeh Club","note":"32 int. · 2 gls"},{"pos":"DF","name":"Roberto Pico Lopes","club":"Shamrock Rovers FC","note":"45 int."},{"pos":"DF","name":"Logan Costa","club":"Villarreal CF","note":"28 int."},{"pos":"MC","name":"Kevin Pina","club":"FC Krasnodar","note":"31 int. · 3 gls"},{"pos":"MC","name":"Jovane","club":"CF Estrela Da Amadora","note":"29 int. · 3 gls"},{"pos":"MC","name":"Joao Paulo","club":"FC FCSB","note":"41 int. · 1 gls"},{"pos":"DC","name":"Gilson","club":"FC Akron Tolyatti","note":"21 int. · 6 gls"},{"pos":"MC","name":"Jamiro","club":"PEC Zwolle","note":"55 int. · 5 gls"},{"pos":"MC","name":"Garry","club":"Apollon Limassol","note":"61 int. · 10 gls"},{"pos":"PO","name":"Marcio","club":"PFC Montana","note":"11 int."},{"pos":"DF","name":"Sidny Lopes","club":"SL Benca","note":"11 int. · 3 gls"},{"pos":"MC","name":"Deroy Duarte","club":"PFC Ludogorets Razgrad","note":"33 int."},{"pos":"MC","name":"Laros Duarte","club":"Puskás Akadémia FC","note":"20 int. · 1 gls"},{"pos":"MC","name":"Jair Yannick","club":"SC Farense","note":"11 int. · 1 gls"},{"pos":"MC","name":"Willy","club":"AC Omonia","note":"38 int. · 3 gls"},{"pos":"MC","name":"Telmo","club":"Vitória SC","note":"16 int. · 1 gls"},{"pos":"DC","name":"Dailon Livramento","club":"Casa Pia AC","note":"22 int. · 7 gls"},{"pos":"DC","name":"Ryan","club":"I ğ dır FK","note":"98 int. · 22 gls"},{"pos":"MC","name":"Nuno Da Costa","club":"Ba ş ak ş ehir FK","note":"9 int. · 2 gls"},{"pos":"DF","name":"Steven","club":"Columbus Crew","note":"20 int."},{"pos":"PO","name":"Carlos Cj Dos Santos","club":"San Diego FC","note":"1 int."},{"pos":"DF","name":"Wagner Pina","club":"Trabzonspor","note":"14 int."},{"pos":"DF","name":"Kelvin","club":"SJK","note":"6 int. · 1 gls"},{"pos":"MC","name":"Helio Varela","club":"Maccabi Tel-Aviv FC","note":"21 int."}],
  "CUW":[{"pos":"PO","name":"Eloy Room","club":"Miami FC","note":"73 int."},{"pos":"DF","name":"Shurandy Sambo","club":"Sparta Rotterdam","note":"8 int."},{"pos":"DF","name":"Jurien Gaari","club":"Abha Club","note":"60 int. · 1 gls"},{"pos":"DF","name":"Roshon Van Eijma","club":"RKC Waalwijk","note":"28 int. · 1 gls"},{"pos":"DF","name":"Sherel Floranus","club":"PEC Zwolle","note":"28 int."},{"pos":"MC","name":"Godfried Roemeratoe","club":"RKC Waalwijk","note":"29 int. · 1 gls"},{"pos":"MC","name":"Juninho Bacuna","club":"FC Volendam","note":"51 int. · 14 gls"},{"pos":"MC","name":"Livano Comenencia","club":"FC Zürich","note":"21 int. · 3 gls"},{"pos":"DC","name":"Juergen Locadia","club":"Miami FC","note":"14 int. · 1 gls"},{"pos":"MC","name":"Leandro Bacuna","club":"I ğ dır FK","note":"73 int. · 16 gls"},{"pos":"DC","name":"Jeremy Antonisse","club":"AE Kisia FC","note":"28 int. · 4 gls"},{"pos":"DC","name":"Sontje Hansen","club":"Middlesbrough FC","note":"7 int. · 1 gls"},{"pos":"DC","name":"Tyrese Noslin","club":"SC Telstar","note":"7 int. · 1 gls"},{"pos":"DC","name":"Kenji Gorre","club":"Maccabi Haifa FC","note":"38 int. · 6 gls"},{"pos":"MC","name":"Arjany Martha","club":"Rotherham United FC","note":"9 int. · 2 gls"},{"pos":"DC","name":"Jearl Margaritha","club":"SK Beveren","note":"23 int. · 5 gls"},{"pos":"DC","name":"Brandley Kuwas","club":"FC Volendam","note":"36 int. · 2 gls"},{"pos":"DF","name":"Armando Obispo","club":"PSV Eindhoven","note":"7 int."},{"pos":"DC","name":"Gervane Kastaneer","club":"Terengganu FC","note":"30 int. · 9 gls"},{"pos":"DF","name":"Joshua Brenet","club":"Kayserispor","note":"18 int. · 2 gls"},{"pos":"MC","name":"Tahith Chong","club":"Sheeld United FC","note":"7 int. · 3 gls"},{"pos":"MC","name":"Kevin Felida","club":"FC Den Bosch","note":"19 int. · 1 gls"},{"pos":"DF","name":"Riechedly Bazoer","club":"Konyaspor","note":"6 int."},{"pos":"DF","name":"Deveron Fonville","club":"NEC Nijmegen","note":"3 int."},{"pos":"PO","name":"Tyrick Bodak","club":"SC Telstar","note":"4 int."},{"pos":"PO","name":"Trevor Doornbusch","club":"VVV Venlo","note":"8 int."}],
  "CZE":[{"pos":"PO","name":"Matej Kovar","club":"PSV Eindhoven","note":"21 int."},{"pos":"DF","name":"David Zima","club":"SK Slavia Praha","note":"25 int. · 1 gls"},{"pos":"DF","name":"Tomas Holes","club":"SK Slavia Praha","note":"41 int. · 2 gls"},{"pos":"DF","name":"Robin Hranac","club":"TSG Hoffenheim","note":"15 int. · 1 gls"},{"pos":"DF","name":"Vladimir Coufal","club":"TSG Hoffenheim","note":"63 int. · 2 gls"},{"pos":"DF","name":"StepanŠ Chaloupek","club":"SK Slavia Praha","note":"6 int."},{"pos":"DF","name":"Ladislav Krejci","club":"Wolverhampton Wanderers FC","note":"28 int. · 6 gls"},{"pos":"MC","name":"Vladimir Darida","club":"FC Hradec Králové","note":"79 int. · 8 gls"},{"pos":"DC","name":"Adam Hlozek","club":"TSG Hoffenheim","note":"44 int. · 5 gls"},{"pos":"DC","name":"Patrik Schick","club":"Bayer 04 Leverkusen","note":"54 int. · 26 gls"},{"pos":"DC","name":"Jan Kuchta","club":"AC Sparta Praha","note":"31 int. · 3 gls"},{"pos":"MC","name":"Lukas Cerv","club":"FC Viktoria Plze ň","note":"17 int. · 2 gls"},{"pos":"DC","name":"Mojmir Chytil","club":"SK Slavia Praha","note":"23 int. · 6 gls"},{"pos":"DF","name":"David Jurasek","club":"SK Slavia Praha","note":"18 int. · 1 gls"},{"pos":"DC","name":"Pavel Sulc","club":"Olympique Lyonnais","note":"22 int. · 5 gls"},{"pos":"PO","name":"Jindrich Stanek","club":"SK Slavia Praha","note":"14 int."},{"pos":"MC","name":"Lukas Provod","club":"SK Slavia Praha","note":"39 int. · 3 gls"},{"pos":"MC","name":"Michal Sadilek","club":"SK Slavia Praha","note":"36 int. · 1 gls"},{"pos":"DC","name":"Tomas Chory","club":"SK Slavia Praha","note":"23 int. · 7 gls"},{"pos":"DF","name":"Jaroslav Zeleny","club":"AC Sparta Praha","note":"24 int."},{"pos":"DF","name":"David Doudera","club":"SK Slavia Praha","note":"17 int. · 2 gls"},{"pos":"MC","name":"Tomas Soucek","club":"West Ham United FC","note":"91 int. · 17 gls"},{"pos":"PO","name":"Lukas Hornicek","club":"SC Braga","note":"1 int."},{"pos":"MC","name":"Alexandr Sojka","club":"FC Viktoria Plze ň","note":"3 int."},{"pos":"MC","name":"Hugo Sochurek","club":"AC Sparta Praha","note":"1 int."},{"pos":"DC","name":"Denis Visinsky","club":"FC Viktoria Plze ň","note":"2 int. · 1 gls"}],
  "DZA":[{"pos":"PO","name":"Melvin Mastil","club":"FC Stade Nyonnais","note":"2 int."},{"pos":"DF","name":"Aissa Mandi","club":"Lille OSC","note":"119 int. · 8 gls"},{"pos":"DF","name":"Achref Abada","club":"USM Alger","note":"10 int. · 1 gls"},{"pos":"DF","name":"Mohamed Tougai","club":"Espérance De Tunisie","note":"30 int. · 2 gls"},{"pos":"DF","name":"Zineddine Belaid","club":"JS Kabylie","note":"18 int. · 1 gls"},{"pos":"MC","name":"Ramiz Zerrouki","club":"FC Twente","note":"53 int. · 3 gls"},{"pos":"DC","name":"Riyad Mahrez","club":"Al Ahli FC","note":"116 int. · 38 gls"},{"pos":"MC","name":"Houssem Aouar","club":"Al Ittihad","note":"23 int. · 6 gls"},{"pos":"DC","name":"Amine Gouiri","club":"Olympique Marseille","note":"23 int. · 10 gls"},{"pos":"MC","name":"Fares Chaibi","club":"Eintracht Frankfurt","note":"31 int. · 3 gls"},{"pos":"DC","name":"Anis Hadj Moussa","club":"Feyenoord Rotterdam","note":"15 int. · 2 gls"},{"pos":"DC","name":"Nadhir Benbouali","club":"Györi ETO FC","note":"4 int. · 1 gls"},{"pos":"DF","name":"Jaouen Hadjam","club":"BSC Young Boys","note":"18 int. · 3 gls"},{"pos":"MC","name":"Hicham Boudaoui","club":"OGC Nice","note":"34 int."},{"pos":"DF","name":"Rayan Ait-nouri","club":"Manchester City FC","note":"30 int."},{"pos":"PO","name":"Oussama Benbot","club":"USM Alger","note":"3 int."},{"pos":"DF","name":"Ra Belghali","club":"Hellas Verona FC","note":"13 int. · 1 gls"},{"pos":"DC","name":"Mohamed Amoura","club":"VfL Wolfsburg","note":"47 int. · 19 gls"},{"pos":"MC","name":"Nabil Bentaleb","club":"Lille OSC","note":"60 int. · 6 gls"},{"pos":"DC","name":"Adil Boulbina","club":"Al Duhail SC","note":"11 int. · 5 gls"},{"pos":"DF","name":"Ramy Bensebaini","club":"Borussia Dortmund","note":"82 int. · 9 gls"},{"pos":"MC","name":"Ibrahim Maza","club":"Bayer 04 Leverkusen","note":"17 int. · 2 gls"},{"pos":"PO","name":"Luca Zidane","club":"Granada CF","note":"7 int."},{"pos":"MC","name":"Yassine Titraoui","club":"Sporting Charleroi","note":"5 int."},{"pos":"DC","name":"Fares Ghedjemis","club":"Frosinone","note":"1 int. · 1 gls"},{"pos":"DF","name":"Samir Chergui","club":"Paris FC","note":"5 int."}],
  "ECU":[{"pos":"PO","name":"Hernan Galindez","club":"CA Huracán","note":"36 int."},{"pos":"DF","name":"Felix Torres","club":"SC Internacional","note":"49 int. · 5 gls"},{"pos":"DF","name":"Piero Hincapie","club":"Arsenal FC","note":"53 int. · 2 gls"},{"pos":"DF","name":"Joel Ordonez","club":"Club Brugge","note":"18 int."},{"pos":"MC","name":"Jordy Alcivar","club":"Independiente Del Valle","note":"11 int. · 1 gls"},{"pos":"DF","name":"Willian Pacho","club":"Paris Saint-Germain","note":"35 int. · 2 gls"},{"pos":"DF","name":"Pervis Estupinan","club":"AC Milan","note":"54 int. · 5 gls"},{"pos":"MC","name":"Anthony Valencia","club":"Royal Antwerp FC","note":"3 int. · 1 gls"},{"pos":"DC","name":"John Yeboah","club":"Venezia FC","note":"23 int. · 3 gls"},{"pos":"MC","name":"Kendry Paez","club":"CA River Plate","note":"26 int. · 2 gls"},{"pos":"DC","name":"Kevin Rodriguez","club":"Royale Union Saint-Gilloise","note":"32 int. · 2 gls"},{"pos":"PO","name":"Moises Ramirez","club":"AE Kisia FC","note":"7 int."},{"pos":"DC","name":"Enner Valencia","club":"CF Pachuca","note":"106 int. · 49 gls"},{"pos":"MC","name":"Alan Minda","club":"Atlético Mineiro","note":"21 int. · 2 gls"},{"pos":"MC","name":"Pedro Vite","club":"Pumas UNAM","note":"18 int. · 1 gls"},{"pos":"DC","name":"Jordy Caicedo","club":"CA Huracán","note":"20 int. · 4 gls"},{"pos":"DF","name":"AngeloÁngelo Preciado","club":"Atlético Mineiro","note":"57 int."},{"pos":"MC","name":"Denil Castillo","club":"FC Midtjylland","note":"5 int."},{"pos":"DC","name":"Gonzalo Plata","club":"CR Flamengo","note":"51 int. · 8 gls"},{"pos":"DC","name":"Nilson Angulo","club":"Sunderland AFC","note":"15 int. · 2 gls"},{"pos":"MC","name":"Alan Franco","club":"Atlético Mineiro","note":"59 int. · 1 gls"},{"pos":"PO","name":"Gonzalo Valle","club":"LDU Quito","note":"4 int."},{"pos":"MC","name":"Moises Caicedo","club":"Chelsea FC","note":"62 int. · 3 gls"},{"pos":"DC","name":"Jeremy Arevalo","club":"VfB Stuttgart","note":"4 int."},{"pos":"DF","name":"Jackson Porozo","club":"Club Tijuana","note":"10 int. · 1 gls"},{"pos":"DF","name":"Yaimar Medina","club":"KRC Genk","note":"6 int."}],
  "EGY":[{"pos":"PO","name":"Mohamed Elshenawy","club":"Al Ahly FC","note":"77 int."},{"pos":"DF","name":"Yasser","club":"Al Ahly FC","note":"18 int. · 1 gls"},{"pos":"DF","name":"Mohamed Hany","club":"Al Ahly FC","note":"43 int."},{"pos":"DF","name":"Hossam Abdelmaguid","club":"Zamalek SC","note":"13 int."},{"pos":"DF","name":"Ramy Rabia","club":"Al Ain FC","note":"47 int. · 6 gls"},{"pos":"DF","name":"Mohamed","club":"OGC Nice","note":"36 int. · 3 gls"},{"pos":"DC","name":"Mahmoud Trezeguet","club":"Al Ahly FC","note":"96 int. · 23 gls"},{"pos":"MC","name":"Emam","club":"Al Ahly FC","note":"29 int."},{"pos":"DC","name":"Hamza","club":"FC Barcelona","note":"2 int."},{"pos":"DC","name":"Mohamed Salah","club":"Liverpool FC","note":"116 int. · 67 gls"},{"pos":"MC","name":"Mostafa Zico","club":"Pyramids FC","note":"2 int. · 2 gls"},{"pos":"DC","name":"Haissem Hassan","club":"Real Oviedo","note":"4 int."},{"pos":"DF","name":"Ahmed Fatouh","club":"Zamalek SC","note":"39 int. · 1 gls"},{"pos":"MC","name":"Hamdy Fathy","club":"Al Wakrah SC","note":"64 int. · 4 gls"},{"pos":"DF","name":"Karim Hafez","club":"Pyramids FC","note":"9 int."},{"pos":"PO","name":"Mahdy Soliman","club":"Zamalek SC","note":"0 int."},{"pos":"MC","name":"Mohanad Lashin","club":"Pyramids FC","note":"23 int."},{"pos":"MC","name":"Nabil","club":"Al Najmah SC","note":"12 int."},{"pos":"MC","name":"Marawan Attia","club":"Al Ahly FC","note":"35 int. · 1 gls"},{"pos":"DC","name":"Ibrahim","club":"FC Nordsjælland","note":"24 int. · 3 gls"},{"pos":"MC","name":"Mahmoud","club":"ZED FC","note":"15 int. · 1 gls"},{"pos":"DC","name":"Omar","club":"Manchester City FC","note":"50 int. · 11 gls"},{"pos":"PO","name":"Mostafa","club":"Al Ahly FC","note":"10 int."},{"pos":"DF","name":"Tarek Alaa","club":"ZED FC","note":"3 int."},{"pos":"DC","name":"Ahmed Zizo","club":"Al Ahly FC","note":"64 int. · 5 gls"},{"pos":"PO","name":"Mohamed Alaa","club":"El Gouna FC","note":"0 int."}],
  "ENG":[{"pos":"PO","name":"Jordan Pickford","club":"Everton FC","note":"84 int."},{"pos":"DF","name":"Ezri Konsa","club":"Aston Villa FC","note":"20 int. · 1 gls"},{"pos":"DF","name":"Nico Oreilly","club":"Manchester City FC","note":"5 int."},{"pos":"MC","name":"Declan Rice","club":"Arsenal FC","note":"73 int. · 7 gls"},{"pos":"DF","name":"John Stones","club":"Manchester City FC","note":"89 int. · 3 gls"},{"pos":"DF","name":"Marc Guehi","club":"Manchester City FC","note":"29 int. · 1 gls"},{"pos":"DC","name":"Bukayo Saka","club":"Arsenal FC","note":"49 int. · 14 gls"},{"pos":"MC","name":"Elliot Anderson","club":"Nottingham Forest FC","note":"9 int."},{"pos":"DC","name":"Harry Kane","club":"FC Bayern München","note":"114 int. · 79 gls"},{"pos":"MC","name":"Jude Bellingham","club":"Real Madrid C. F.","note":"48 int. · 6 gls"},{"pos":"DC","name":"Marcus Rashford","club":"FC Barcelona","note":"72 int. · 18 gls"},{"pos":"DF","name":"Tino Livramento","club":"Newcastle United FC","note":"6 int."},{"pos":"PO","name":"Dean Henderson","club":"Crystal Palace FC","note":"4 int."},{"pos":"MC","name":"Jordan Henderson","club":"Brentford FC","note":"91 int. · 3 gls"},{"pos":"DF","name":"Dan Burn","club":"Newcastle United FC","note":"8 int."},{"pos":"MC","name":"Kobbie Mainoo","club":"Manchester United FC","note":"14 int."},{"pos":"MC","name":"Morgan Rogers","club":"Aston Villa FC","note":"15 int. · 1 gls"},{"pos":"DC","name":"Anthony Gordon","club":"Newcastle United FC","note":"19 int. · 3 gls"},{"pos":"DC","name":"Ollie Watkins","club":"Aston Villa FC","note":"22 int. · 7 gls"},{"pos":"DC","name":"Noni Madueke","club":"Arsenal FC","note":"11 int. · 1 gls"},{"pos":"MC","name":"Eberechi Eze","club":"Arsenal FC","note":"17 int. · 3 gls"},{"pos":"DC","name":"Ivan Toney","club":"Al Ahli FC","note":"8 int. · 1 gls"},{"pos":"PO","name":"James Trafford","club":"Manchester City FC","note":"2 int."},{"pos":"DF","name":"Reece James","club":"Chelsea FC","note":"24 int. · 1 gls"},{"pos":"DF","name":"Djed Spence","club":"Tottenham Hotspur FC","note":"6 int."},{"pos":"DF","name":"Jarell Quansah","club":"Bayer 04 Leverkusen","note":"3 int."}],
  "ESP":[{"pos":"PO","name":"David Raya","club":"Arsenal FC","note":"13 int."},{"pos":"DF","name":"Marc Pubill","club":"Atlético De Madrid","note":"2 int."},{"pos":"DF","name":"Alex Grimaldo","club":"Bayer 04 Leverkusen","note":"14 int."},{"pos":"DF","name":"Eric Garcia","club":"FC Barcelona","note":"21 int."},{"pos":"DF","name":"Marcos Llorente","club":"Atlético De Madrid","note":"24 int."},{"pos":"MC","name":"Mikel Merino","club":"Arsenal FC","note":"43 int. · 10 gls"},{"pos":"DC","name":"Ferran Torres","club":"FC Barcelona","note":"57 int. · 24 gls"},{"pos":"MC","name":"Fabian Ruiz","club":"Paris Saint-Germain","note":"42 int. · 6 gls"},{"pos":"MC","name":"Pablo Gavi","club":"FC Barcelona","note":"30 int. · 5 gls"},{"pos":"DC","name":"Dani Olmo","club":"FC Barcelona","note":"50 int. · 12 gls"},{"pos":"DC","name":"Yeremy Pino","club":"Crystal Palace FC","note":"23 int. · 4 gls"},{"pos":"DF","name":"Pedro Porro","club":"Tottenham Hotspur FC","note":"18 int."},{"pos":"PO","name":"Joan Garcia","club":"FC Barcelona","note":"2 int."},{"pos":"DF","name":"Aymeric Laporte","club":"Athletic Club","note":"46 int. · 2 gls"},{"pos":"MC","name":"Alex Baena","club":"Atlético De Madrid","note":"17 int. · 2 gls"},{"pos":"MC","name":"Rodrigo Rodri","club":"Manchester City FC","note":"62 int. · 4 gls"},{"pos":"DC","name":"Nico Williams","club":"Athletic Club","note":"30 int. · 6 gls"},{"pos":"MC","name":"Martin Zubimendi","club":"Arsenal FC","note":"26 int. · 3 gls"},{"pos":"DC","name":"Lamine Yamal","club":"FC Barcelona","note":"25 int. · 6 gls"},{"pos":"MC","name":"Pedro Pedri","club":"FC Barcelona","note":"41 int. · 6 gls"},{"pos":"DC","name":"Mikel Oyarzabal","club":"Real Sociedad","note":"53 int. · 25 gls"},{"pos":"DF","name":"Pau Cubarsi","club":"FC Barcelona","note":"12 int."},{"pos":"PO","name":"Unai Simon","club":"Athletic Club","note":"58 int."},{"pos":"DF","name":"Marc Cucurella","club":"Chelsea FC","note":"24 int. · 1 gls"},{"pos":"DC","name":"Victor Munoz","club":"CA Osasuna","note":"2 int. · 1 gls"},{"pos":"DC","name":"Borja Iglesias","club":"RC Celta Vigo","note":"8 int."}],
  "FRA":[{"pos":"PO","name":"Brice Samba","club":"Stade Rennais FC","note":"4 int."},{"pos":"DF","name":"Malo Gusto","club":"Chelsea FC","note":"11 int."},{"pos":"DF","name":"Lucas Digne","club":"Aston Villa FC","note":"58 int."},{"pos":"DF","name":"Dayot Upamecano","club":"FC Bayern München","note":"38 int. · 2 gls"},{"pos":"DF","name":"Jules Kounde","club":"FC Barcelona","note":"48 int."},{"pos":"MC","name":"Manu Kone","club":"AS Roma","note":"14 int."},{"pos":"DC","name":"Ousmane Dembele","club":"Paris Saint-Germain","note":"59 int. · 7 gls"},{"pos":"MC","name":"Aurelien Tchouameni","club":"Real Madrid C. F.","note":"46 int. · 3 gls"},{"pos":"DC","name":"Marcus Thuram","club":"FC Internazionale Milano","note":"34 int. · 3 gls"},{"pos":"DC","name":"Kylian Mbappe","club":"Real Madrid C. F.","note":"98 int. · 56 gls"},{"pos":"DC","name":"Michael Olise","club":"FC Bayern München","note":"17 int. · 7 gls"},{"pos":"DC","name":"Bradley Barcola","club":"Paris Saint-Germain","note":"20 int. · 3 gls"},{"pos":"MC","name":"Ngolo Kante","club":"Fenerbahçe SK","note":"69 int. · 2 gls"},{"pos":"MC","name":"Adrien Rabiot","club":"AC Milan","note":"59 int. · 7 gls"},{"pos":"DF","name":"Ibrahima Konate","club":"Liverpool FC","note":"28 int."},{"pos":"PO","name":"Mike Maignan","club":"AC Milan","note":"40 int."},{"pos":"DF","name":"William Saliba","club":"Arsenal FC","note":"32 int."},{"pos":"MC","name":"Warren Zaire-emery","club":"Paris Saint-Germain","note":"11 int. · 1 gls"},{"pos":"DF","name":"Theo Hernandez","club":"Al Hilal SC","note":"44 int. · 2 gls"},{"pos":"DC","name":"Desire Doue","club":"Paris Saint-Germain","note":"7 int. · 2 gls"},{"pos":"DF","name":"Lucas Hernandez","club":"Paris Saint-Germain","note":"42 int."},{"pos":"DC","name":"Jean Mateta","club":"Crystal Palace FC","note":"4 int. · 2 gls"},{"pos":"PO","name":"Robin Risser","club":"RC Lens","note":"0 int."},{"pos":"MC","name":"Rayan Cherki","club":"Manchester City FC","note":"7 int. · 2 gls"},{"pos":"MC","name":"Maghnes Akliouche","club":"AS Monaco","note":"9 int. · 1 gls"},{"pos":"DF","name":"Maxence Lacroix","club":"Crystal Palace FC","note":"4 int."}],
  "GER":[{"pos":"PO","name":"Manuel Neuer","club":"FC Bayern München","note":"125 int."},{"pos":"DF","name":"Antonio Ruediger","club":"Real Madrid C. F.","note":"83 int. · 3 gls"},{"pos":"DF","name":"Waldemar Anton","club":"Borussia Dortmund","note":"14 int."},{"pos":"DF","name":"Jonathan Tah","club":"FC Bayern München","note":"48 int. · 1 gls"},{"pos":"MC","name":"Aleksandar Pavlovic","club":"FC Bayern München","note":"12 int. · 1 gls"},{"pos":"DF","name":"Joshua Kimmich","club":"FC Bayern München","note":"111 int. · 10 gls"},{"pos":"DC","name":"Kai Havertz","club":"Arsenal FC","note":"59 int. · 24 gls"},{"pos":"MC","name":"Leon Goretzka","club":"FC Bayern München","note":"71 int. · 15 gls"},{"pos":"MC","name":"Jamie Leweling","club":"VfB Stuttgart","note":"5 int. · 1 gls"},{"pos":"MC","name":"Jamal Musiala","club":"FC Bayern München","note":"43 int. · 10 gls"},{"pos":"DC","name":"Nick Woltemade","club":"Newcastle United FC","note":"11 int. · 4 gls"},{"pos":"PO","name":"Oliver Baumann","club":"TSG Hoffenheim","note":"13 int."},{"pos":"MC","name":"Pascal Gross","club":"Brighton & Hove Albion FC","note":"18 int. · 1 gls"},{"pos":"DC","name":"Maximilian Beier","club":"Borussia Dortmund","note":"9 int."},{"pos":"DF","name":"Nico Schlotterbeck","club":"Borussia Dortmund","note":"28 int. · 1 gls"},{"pos":"MC","name":"Angelo Stiller","club":"VfB Stuttgart","note":"8 int."},{"pos":"MC","name":"Florian Wirtz","club":"Liverpool FC","note":"42 int. · 11 gls"},{"pos":"DF","name":"Nathaniel Brown","club":"Eintracht Frankfurt","note":"6 int. · 1 gls"},{"pos":"MC","name":"Leroy Sane","club":"Galatasaray SK","note":"77 int. · 17 gls"},{"pos":"MC","name":"Nadiem Amiri","club":"1. FSV Mainz 05","note":"11 int. · 1 gls"},{"pos":"PO","name":"Alexander Nuebel","club":"VfB Stuttgart","note":"3 int."},{"pos":"DF","name":"David Raum","club":"RB Leipzig","note":"38 int. · 1 gls"},{"pos":"MC","name":"Felix Nmecha","club":"Borussia Dortmund","note":"9 int. · 2 gls"},{"pos":"DF","name":"Malick Thiaw","club":"Newcastle United FC","note":"5 int."},{"pos":"MC","name":"Assan Ouedraogo","club":"RB Leipzig","note":"1 int. · 1 gls"},{"pos":"DC","name":"Deniz Undav","club":"VfB Stuttgart","note":"10 int. · 7 gls"}],
  "GHA":[{"pos":"PO","name":"Lawrence Zigi","club":"FC St. Gallen","note":"30 int."},{"pos":"DF","name":"Alidu Seidu","club":"Stade Rennais FC","note":"24 int. · 1 gls"},{"pos":"MC","name":"Caleb Yirenkyi","club":"FC Nordsjælland","note":"11 int. · 1 gls"},{"pos":"DF","name":"Jonas Adjetey","club":"VfL Wolfsburg","note":"10 int."},{"pos":"MC","name":"Thomas Partey","club":"Villarreal CF","note":"59 int. · 16 gls"},{"pos":"DF","name":"Abdul Mumin","club":"Rayo Vallecano","note":"5 int."},{"pos":"DC","name":"Abdul Fatawu","club":"Leicester City FC","note":"28 int. · 3 gls"},{"pos":"MC","name":"Kwasi Sibo","club":"Real Oviedo","note":"8 int."},{"pos":"DC","name":"Jordan Ayew","club":"Leicester City FC","note":"120 int. · 34 gls"},{"pos":"DC","name":"Brandon Thomas-asante","club":"Coventry City FC","note":"8 int. · 1 gls"},{"pos":"MC","name":"Antoine Semenyo","club":"Manchester City FC","note":"34 int. · 3 gls"},{"pos":"PO","name":"Joseph Anang","club":"St Patrick's Athletic FC","note":"1 int."},{"pos":"DC","name":"Christopher Bonsu Baah","club":"Al Qadsiah FC","note":"9 int."},{"pos":"DF","name":"Gideon Mensah","club":"AJ Auxerre","note":"40 int."},{"pos":"MC","name":"Elisha Owusu","club":"AJ Auxerre","note":"20 int."},{"pos":"PO","name":"Benjamin Asare","club":"Hearts Of Oak SC","note":"13 int."},{"pos":"DF","name":"Baba Rahman","club":"PAOK Saloniki","note":"53 int. · 1 gls"},{"pos":"DF","name":"Jerome Opoku","club":"Ba ş ak ş ehir FK","note":"11 int. · 1 gls"},{"pos":"DC","name":"Inaki Williams","club":"Athletic Club","note":"26 int. · 2 gls"},{"pos":"MC","name":"Augustine Boakye","club":"AS Saint-Etienne","note":"0 int."},{"pos":"DF","name":"Kojo Oppong","club":"OGC Nice","note":"4 int."},{"pos":"DC","name":"Kamaldeen Sulemana","club":"Atalanta Bergamo","note":"28 int. · 1 gls"},{"pos":"DF","name":"Derrick Luckassen","club":"Pafos FC","note":"1 int."},{"pos":"DC","name":"Ernest Nuamah","club":"Olympique Lyonnais","note":"19 int. · 4 gls"},{"pos":"DC","name":"Prince Adu","club":"FC Viktoria Plze ň","note":"5 int."},{"pos":"DF","name":"Marvin Senaya","club":"AJ Auxerre","note":"2 int."}],
  "HAI":[{"pos":"PO","name":"Johny Placide","club":"SC Bastia","note":"84 int."},{"pos":"DF","name":"Carlens Arcus","club":"Angers SCO","note":"57 int. · 1 gls"},{"pos":"DF","name":"Keeto Thermoncy","club":"BSC Young Boys","note":"1 int."},{"pos":"DF","name":"Ricardo Ade","club":"LDU Quito","note":"62 int. · 2 gls"},{"pos":"DF","name":"Hannes Delcroix","club":"FC Lugano","note":"8 int."},{"pos":"MC","name":"Carl Sainte","club":"El Paso Locomotive FC","note":"26 int."},{"pos":"DC","name":"Derrick Etienne","club":"Toronto FC","note":"50 int. · 8 gls"},{"pos":"DF","name":"Martin Experience","club":"AS Nancy","note":"22 int."},{"pos":"DC","name":"Duckens Nazon","club":"Esteghlal Tehran FC","note":"83 int. · 44 gls"},{"pos":"MC","name":"Jean Bellegarde","club":"Wolverhampton Wanderers FC","note":"11 int."},{"pos":"DC","name":"Louicius Deedson","club":"FC Dallas","note":"33 int. · 10 gls"},{"pos":"PO","name":"Alexandre Pierre","club":"FC Sochaux-Montbéliard","note":"17 int."},{"pos":"DF","name":"Markhus Lacroix","club":"Colorado Springs Switchbacks FC","note":"16 int. · 3 gls"},{"pos":"DF","name":"Garven Metusala","club":"Colorado Springs Switchbacks FC","note":"15 int."},{"pos":"DC","name":"Ruben Providence","club":"Almere City FC","note":"16 int. · 3 gls"},{"pos":"DC","name":"Lenny Joseph","club":"Ferencvárosi TC","note":"3 int. · 1 gls"},{"pos":"MC","name":"Danley Jean Jacques","club":"Philadelphia Union","note":"32 int. · 6 gls"},{"pos":"DC","name":"Wilson Isidor","club":"Sunderland AFC","note":"5 int. · 2 gls"},{"pos":"DC","name":"Yassin Fortune","club":"FC Vizela","note":"5 int."},{"pos":"DC","name":"Frantzdy Pierrot","club":"Çaykur Rizespor","note":"54 int. · 34 gls"},{"pos":"DC","name":"Josue Casimir","club":"AJ Auxerre","note":"8 int."},{"pos":"DF","name":"Jean Duverne","club":"KAA Gent","note":"17 int. · 1 gls"},{"pos":"PO","name":"Josue Duverger","club":"FC Cosmos Koblenz","note":"7 int."},{"pos":"DF","name":"Wilguens Paugain","club":"SV Zulte Waregem","note":"8 int."},{"pos":"MC","name":"Dominique Simon","club":"FC Tatran Pre š ov","note":"2 int."},{"pos":"MC","name":"Woodensky Pierre","club":"Violette AC","note":"1 int."}],
  "HRV":[{"pos":"PO","name":"Dominik Livakovic","club":"GNK Dinamo Zagreb","note":"75 int."},{"pos":"DF","name":"Josip Stanisic","club":"FC Bayern München","note":"31 int."},{"pos":"DF","name":"Marin Pongracic","club":"ACF Fiorentina","note":"20 int."},{"pos":"DF","name":"Josko Gvardiol","club":"Manchester City FC","note":"48 int. · 4 gls"},{"pos":"DF","name":"Duje Caleta-car","club":"Real Sociedad","note":"38 int. · 1 gls"},{"pos":"DF","name":"Josip Sutalo","club":"AFC Ajax","note":"33 int."},{"pos":"MC","name":"Nikola Moro","club":"Bologna FC","note":"10 int."},{"pos":"MC","name":"Mateo Kovacic","club":"Manchester City FC","note":"113 int. · 5 gls"},{"pos":"DC","name":"Andrej Kramaric","club":"TSG Hoffenheim","note":"116 int. · 36 gls"},{"pos":"MC","name":"Luka Modric","club":"AC Milan","note":"198 int. · 29 gls"},{"pos":"DC","name":"Ante Budimir","club":"CA Osasuna","note":"38 int. · 6 gls"},{"pos":"PO","name":"Ivor Pandur","club":"Hull City FC","note":"0 int."},{"pos":"MC","name":"Nikola Vlasic","club":"Torino FC","note":"63 int. · 10 gls"},{"pos":"DC","name":"Ivan Perisic","club":"PSV Eindhoven","note":"154 int. · 38 gls"},{"pos":"MC","name":"Mario Pasalic","club":"Atalanta Bergamo","note":"85 int. · 12 gls"},{"pos":"MC","name":"Martin Baturina","club":"Como","note":"19 int. · 1 gls"},{"pos":"MC","name":"Petar Sucic","club":"FC Internazionale Milano","note":"17 int. · 1 gls"},{"pos":"DF","name":"Kristijan Jakic","club":"FC Augsburg","note":"17 int. · 2 gls"},{"pos":"MC","name":"Toni Fruk","club":"HNK Rijeka","note":"7 int. · 1 gls"},{"pos":"DC","name":"Igor Matanovic","club":"SC Freiburg","note":"9 int. · 2 gls"},{"pos":"MC","name":"Luka Sucic","club":"Real Sociedad","note":"21 int. · 1 gls"},{"pos":"DF","name":"Luka Vuskovic","club":"Hamburger SV","note":"5 int. · 1 gls"},{"pos":"PO","name":"Dominik Kotarski","club":"FC København","note":"4 int."},{"pos":"DC","name":"Marco Pasalic","club":"Orlando City SC","note":"15 int. · 1 gls"},{"pos":"DF","name":"Martin Erlic","club":"FC Midtjylland","note":"13 int. · 1 gls"},{"pos":"DC","name":"Petar Musa","club":"FC Dallas","note":"11 int. · 1 gls"}],
  "IRN":[{"pos":"PO","name":"Alireza Beiranvand","club":"Tractor Sazi Tabriz FC","note":"87 int."},{"pos":"DF","name":"Saleh Hardani","club":"Esteghlal Tehran FC","note":"18 int. · 1 gls"},{"pos":"DF","name":"Ehsan Hajisafi","club":"Sepahan SC","note":"146 int. · 7 gls"},{"pos":"DF","name":"Shoja Khalilzadeh","club":"Tractor Sazi Tabriz FC","note":"58 int. · 2 gls"},{"pos":"DF","name":"Milad Mohammadi","club":"Persepolis FC","note":"77 int. · 1 gls"},{"pos":"MC","name":"Saeid Ezatolahi","club":"Shabab Al Ahli Club","note":"84 int. · 2 gls"},{"pos":"MC","name":"Alireza Jahanbakhsh","club":"FCV Dender EH","note":"99 int. · 17 gls"},{"pos":"MC","name":"Mohammad Mohebbi","club":"FC Rostov","note":"37 int. · 13 gls"},{"pos":"DC","name":"Mehdi Taremi","club":"Olympiacos FC","note":"106 int. · 59 gls"},{"pos":"DC","name":"Mehdi Ghayedi","club":"Al Nasr SC","note":"30 int. · 10 gls"},{"pos":"DC","name":"Ali Alipour","club":"Persepolis FC","note":"14 int. · 1 gls"},{"pos":"PO","name":"Payam Niazmand","club":"Persepolis FC","note":"15 int."},{"pos":"DF","name":"Hossein Kanani","club":"Persepolis FC","note":"65 int. · 6 gls"},{"pos":"MC","name":"Saman Ghoddos","club":"Al Ittihad Kalba SCC","note":"68 int. · 3 gls"},{"pos":"MC","name":"Roozbeh Cheshmi","club":"Esteghlal Tehran FC","note":"41 int. · 3 gls"},{"pos":"MC","name":"Mehdi Torabi","club":"Tractor Sazi Tabriz FC","note":"52 int. · 7 gls"},{"pos":"DF","name":"Arya Yousefi","club":"Sepahan SC","note":"14 int. · 1 gls"},{"pos":"DC","name":"Amirhossein Hosseinzadeh","club":"Tractor Sazi Tabriz FC","note":"18 int. · 5 gls"},{"pos":"DF","name":"Ali Nemati","club":"Foolad Khuzestan FC","note":"18 int."},{"pos":"DC","name":"Shahriyar Moghanloo","club":"Al Ittihad Kalba SCC","note":"21 int. · 2 gls"},{"pos":"MC","name":"Mohammad Ghorbani","club":"Al Wahda SC","note":"16 int."},{"pos":"PO","name":"Hossein Hosseini","club":"Sepahan SC","note":"14 int."},{"pos":"DF","name":"Ramin Rezaeian","club":"Foolad Khuzestan FC","note":"74 int. · 8 gls"},{"pos":"DC","name":"Dennis Dargahi","club":"Standard Liège","note":"0 int."},{"pos":"DF","name":"Danial Iri","club":"Malavan Anzali FC","note":"0 int."},{"pos":"MC","name":"Amirmohammad Razaghinia","club":"Esteghlal Tehran FC","note":"4 int."}],
  "IRQ":[{"pos":"PO","name":"Fahad Talib","club":"Al Talaba SC","note":"21 int."},{"pos":"DF","name":"Rebin Sulaka","club":"Port FC","note":"56 int. · 1 gls"},{"pos":"DF","name":"Hussein","club":"Pogo ń  Szczecin","note":"27 int. · 1 gls"},{"pos":"DF","name":"Zaid","club":"Pakhtakor Tashkent FK","note":"28 int. · 1 gls"},{"pos":"DF","name":"Akam Hashim","club":"Al Zawra'a SC","note":"14 int. · 1 gls"},{"pos":"DF","name":"Munaf Younus","club":"Al Shorta SC","note":"34 int. · 1 gls"},{"pos":"MC","name":"Youssef Amyn","club":"AEK Larnaca FC","note":"27 int. · 2 gls"},{"pos":"MC","name":"Ibrahim Bayesh","club":"Al Dhafra SCC","note":"76 int. · 8 gls"},{"pos":"DC","name":"Ali Alhamadi","club":"Luton Town FC","note":"20 int. · 5 gls"},{"pos":"DC","name":"Mohanad Ali","club":"Dibba FC","note":"72 int. · 26 gls"},{"pos":"DC","name":"Ahmed","club":"Nashville SC","note":"3 int."},{"pos":"PO","name":"Jalal Hassan","club":"Al Zawra'a SC","note":"104 int."},{"pos":"DC","name":"Ali Yousif","club":"Al Talaba SC","note":"7 int. · 1 gls"},{"pos":"MC","name":"Zidane","club":"FC Utrecht","note":"25 int. · 2 gls"},{"pos":"DF","name":"Ahmed Maknazi","club":"Al Karma SC","note":"7 int."},{"pos":"MC","name":"Amir Alammari","club":"KS Cracovia","note":"51 int. · 3 gls"},{"pos":"DC","name":"Ali Jasim","club":"Al Najmah SC","note":"36 int. · 2 gls"},{"pos":"DC","name":"Aymen","club":"Al Karma SC","note":"95 int. · 33 gls"},{"pos":"MC","name":"Kevin Yakob","club":"Aarhus GF","note":"9 int."},{"pos":"MC","name":"Aimar","club":"Sarpsborg 08 FF","note":"7 int."},{"pos":"DC","name":"Marko Farji","club":"Venezia FC","note":"12 int."},{"pos":"PO","name":"Ahmed","club":"Al Shorta SC","note":"16 int."},{"pos":"DF","name":"Merchas","club":"FC Viktoria Plze ň","note":"31 int. · 1 gls"},{"pos":"MC","name":"Zaid Ismael","club":"Al Talaba SC","note":"6 int."},{"pos":"DF","name":"Mustafa","club":"Al Shorta SC","note":"17 int."},{"pos":"DF","name":"Frans","club":"Persib Bandung","note":"28 int."}],
  "JOR":[{"pos":"PO","name":"Yazeed Abulaila","club":"Al Hussein SC","note":"76 int."},{"pos":"DF","name":"Mohammad","club":"Al Karma SC","note":"56 int. · 1 gls"},{"pos":"DF","name":"Abdallah Nasib","club":"Al Zawra'a SC","note":"65 int. · 2 gls"},{"pos":"DF","name":"Husam Abudahab","club":"Al Faisaly SC","note":"17 int."},{"pos":"DF","name":"Yazan Alarab","club":"FC Seoul","note":"80 int. · 3 gls"},{"pos":"MC","name":"Amer Jamous","club":"Al Zawra'a SC","note":"19 int. · 1 gls"},{"pos":"DC","name":"Mohammad","club":"Raja Casablanca","note":"40 int. · 5 gls"},{"pos":"MC","name":"Noor Alrawabdeh","club":"Selangor FC","note":"68 int. · 3 gls"},{"pos":"DC","name":"Ali Olwan","club":"Al Sailiya SC","note":"66 int. · 29 gls"},{"pos":"DC","name":"Mousa Altamari","club":"Stade Rennais FC","note":"92 int. · 24 gls"},{"pos":"DC","name":"Odeh Fakhoury","club":"Pyramids FC","note":"10 int. · 1 gls"},{"pos":"PO","name":"Noureddin Nour Baniateyah","club":"Al Faisaly SC","note":"5 int."},{"pos":"DC","name":"Mahmoud Almardi","club":"Al Hussein SC","note":"87 int. · 8 gls"},{"pos":"MC","name":"Raja Rajaei Ayed","club":"Al Hussein SC","note":"73 int."},{"pos":"MC","name":"Ibrahim","club":"Al Karma SC","note":"57 int. · 3 gls"},{"pos":"DF","name":"Mohammad Abualnadi","club":"Selangor FC","note":"18 int."},{"pos":"DF","name":"Saleem","club":"Al Hussein SC","note":"12 int."},{"pos":"MC","name":"Mohammad","club":"Al Hussein SC","note":"0 int."},{"pos":"DF","name":"Sa Saed","club":"Al Hussein SC","note":"21 int. · 2 gls"},{"pos":"MC","name":"Mohannad Abutaha","club":"Al-Quwa Al-Jawiya","note":"30 int. · 1 gls"},{"pos":"MC","name":"Nizar Alrashdan","club":"Qatar SC","note":"47 int. · 4 gls"},{"pos":"PO","name":"Abdallah Alfakhori","club":"Al Wahdat SC","note":"16 int."},{"pos":"DF","name":"Ehsan Haddad","club":"Al Hussein SC","note":"90 int. · 2 gls"},{"pos":"DC","name":"Ali Azaizeh","club":"Al Shabab FC","note":"4 int."},{"pos":"MC","name":"Mohammad Aldaoud","club":"Al Wahdat SC","note":"13 int. · 1 gls"},{"pos":"DF","name":"Anas Badawi","club":"Al Faisaly SC","note":"1 int."}],
  "JPN":[{"pos":"PO","name":"Zion Suzuki","club":"Parma","note":"26 int."},{"pos":"DF","name":"Yukinari Sugawara","club":"SV Werder Bremen","note":"23 int. · 2 gls"},{"pos":"DF","name":"Shogo Taniguchi","club":"Sint-Truiden VV","note":"40 int. · 1 gls"},{"pos":"DF","name":"Kou Itakura","club":"AFC Ajax","note":"41 int. · 3 gls"},{"pos":"DF","name":"Yuto Nagatomo","club":"FC Tokyo","note":"145 int. · 4 gls"},{"pos":"DC","name":"Shuto Machino","club":"Borussia Mönchengladbach","note":"14 int. · 5 gls"},{"pos":"MC","name":"Ao Tanaka","club":"Leeds United FC","note":"38 int. · 8 gls"},{"pos":"MC","name":"Takefusa Kubo","club":"Real Sociedad","note":"50 int. · 7 gls"},{"pos":"DC","name":"Keisuke Goto","club":"Sint-Truiden VV","note":"4 int."},{"pos":"MC","name":"Ritsu Doan","club":"Eintracht Frankfurt","note":"67 int. · 11 gls"},{"pos":"MC","name":"Daizen Maeda","club":"Celtic FC","note":"29 int. · 5 gls"},{"pos":"PO","name":"Keisuke Osako","club":"Sanfrecce Hiroshima","note":"11 int."},{"pos":"MC","name":"Keito Nakamura","club":"Stade Reims","note":"27 int. · 12 gls"},{"pos":"MC","name":"Junya Ito","club":"KRC Genk","note":"70 int. · 15 gls"},{"pos":"MC","name":"Daichi Kamada","club":"Crystal Palace FC","note":"50 int. · 13 gls"},{"pos":"DF","name":"Tsuyoshi Watanabe","club":"Feyenoord Rotterdam","note":"13 int."},{"pos":"MC","name":"Yuito Suzuki","club":"SC Freiburg","note":"6 int."},{"pos":"DC","name":"Ayase Ueda","club":"Feyenoord Rotterdam","note":"41 int. · 16 gls"},{"pos":"DC","name":"Koki Ogawa","club":"NEC Nijmegen","note":"16 int. · 11 gls"},{"pos":"DF","name":"Ayumu Seko","club":"Le Havre AC","note":"14 int."},{"pos":"DF","name":"Hiroki Ito","club":"FC Bayern München","note":"26 int. · 1 gls"},{"pos":"DF","name":"Takehiro Tomiyasu","club":"AFC Ajax","note":"44 int. · 1 gls"},{"pos":"PO","name":"Tomoki Hayakawa","club":"Kashima Antlers","note":"4 int."},{"pos":"MC","name":"Kaishu Sano","club":"1. FSV Mainz 05","note":"15 int."},{"pos":"DF","name":"Junnosuke Suzuki","club":"FC København","note":"6 int."},{"pos":"DC","name":"Kento Shiogai","club":"VfL Wolfsburg","note":"3 int."}],
  "KOR":[{"pos":"PO","name":"Seunggyu Kim","club":"FC Tokyo","note":"87 int."},{"pos":"DF","name":"Hanbeom Lee","club":"FC Midtjylland","note":"9 int."},{"pos":"MC","name":"Gihyuk Lee","club":"Gangwon FC","note":"4 int."},{"pos":"DF","name":"Minjae Kim","club":"FC Bayern München","note":"80 int. · 4 gls"},{"pos":"DF","name":"Taehyeon Kim","club":"Kashima Antlers","note":"7 int."},{"pos":"MC","name":"Inbeom Hwang","club":"Feyenoord Rotterdam","note":"74 int. · 7 gls"},{"pos":"DC","name":"Heungmin Son","club":"LAFC","note":"145 int. · 56 gls"},{"pos":"MC","name":"Seungho Paik","club":"Birmingham City FC","note":"28 int. · 3 gls"},{"pos":"DC","name":"Guesung Cho","club":"FC Midtjylland","note":"44 int. · 12 gls"},{"pos":"MC","name":"Jaesung Lee","club":"1. FSV Mainz 05","note":"106 int. · 15 gls"},{"pos":"MC","name":"Heechan Hwang","club":"Wolverhampton Wanderers FC","note":"80 int. · 17 gls"},{"pos":"PO","name":"Bumkeun Song","club":"Jeonbuk Hyundai Motors FC","note":"3 int."},{"pos":"DF","name":"Taeseok Lee","club":"FK Austria Wien","note":"16 int. · 1 gls"},{"pos":"DF","name":"Wije Cho","club":"Jeonbuk Hyundai Motors FC","note":"1 int."},{"pos":"DF","name":"Moonhwan Kim","club":"Daejeon Hana Citizen FC","note":"36 int."},{"pos":"DF","name":"Jinseob Park","club":"Zhejiang FC","note":"15 int. · 1 gls"},{"pos":"MC","name":"Junho Bae","club":"Stoke City FC","note":"13 int. · 2 gls"},{"pos":"DC","name":"Hyeongyu Oh","club":"Be ş ikta ş  JK","note":"28 int. · 7 gls"},{"pos":"MC","name":"Kangin Lee","club":"Paris Saint-Germain","note":"48 int. · 10 gls"},{"pos":"MC","name":"Hyunjun Yang","club":"Celtic FC","note":"9 int."},{"pos":"PO","name":"Hyeonwoo Jo","club":"Ulsan HD","note":"48 int."},{"pos":"DF","name":"Youngwoo Seol","club":"FK Crvena Zvezda","note":"35 int."},{"pos":"DF","name":"Jens Castrop","club":"Borussia Mönchengladbach","note":"7 int."},{"pos":"MC","name":"Jingyu Kim","club":"Jeonbuk Hyundai Motors FC","note":"23 int. · 3 gls"},{"pos":"MC","name":"Jisung Eom","club":"Swansea City AFC","note":"10 int. · 2 gls"},{"pos":"MC","name":"Donggyeong Lee","club":"Ulsan HD","note":"18 int. · 4 gls"}],
  "KSA":[{"pos":"PO","name":"Nawaf Alaqidi","club":"Al Nassr FC","note":"24 int."},{"pos":"DF","name":"Ali Majrashi","club":"Al Ahli FC","note":"21 int."},{"pos":"DF","name":"Ali Lajami","club":"Al Hilal SC","note":"24 int. · 1 gls"},{"pos":"DF","name":"Abdulelah Alamri","club":"Al Nassr FC","note":"44 int. · 1 gls"},{"pos":"DF","name":"Hassan","club":"Al Hilal SC","note":"54 int. · 1 gls"},{"pos":"MC","name":"Nasser Aldawsari","club":"Al Hilal SC","note":"47 int. · 1 gls"},{"pos":"MC","name":"Musab Aljuwayr","club":"Al Qadsiah FC","note":"37 int. · 6 gls"},{"pos":"DC","name":"Aiman Yahya","club":"Al Nassr FC","note":"26 int."},{"pos":"DC","name":"Feras","club":"Al Ahli FC","note":"72 int. · 16 gls"},{"pos":"DC","name":"Salem Aldawsari","club":"Al Hilal SC","note":"111 int. · 27 gls"},{"pos":"DC","name":"Saleh","club":"Al Ittihad","note":"59 int. · 17 gls"},{"pos":"DF","name":"Saud Abdulhamid","club":"RC Lens","note":"55 int. · 1 gls"},{"pos":"DF","name":"Nawaf Bu Washl","club":"Al Nassr FC","note":"27 int."},{"pos":"DF","name":"Hassan","club":"Al Ittihad","note":"21 int. · 2 gls"},{"pos":"MC","name":"Abdullah Alkhaibari","club":"Al Nassr FC","note":"42 int."},{"pos":"MC","name":"Ziyad Aljohani","club":"Al Ahli FC","note":"12 int."},{"pos":"DC","name":"Khalid Alghannam","club":"Al Ettifaq FC","note":"7 int."},{"pos":"MC","name":"Ala Alhajji","club":"Neom SC","note":"3 int."},{"pos":"DC","name":"Abdullah Alhamddan","club":"Al Nassr FC","note":"52 int. · 13 gls"},{"pos":"DC","name":"Sultan Mandash","club":"Al Hilal SC","note":"7 int. · 2 gls"},{"pos":"PO","name":"Mohammed Alowais","club":"Al Ula Saudi FC","note":"65 int."},{"pos":"PO","name":"Ahmed","club":"Al Qadsiah FC","note":"9 int."},{"pos":"MC","name":"Mohamed","club":"Al Hilal SC","note":"79 int. · 8 gls"},{"pos":"DF","name":"Moteb Alharbi","club":"Al Hilal SC","note":"13 int."},{"pos":"DF","name":"Jehad Thikri","club":"Al Qadsiah FC","note":"8 int."},{"pos":"DF","name":"Mohammed Abu Alshamat","club":"Al Qadsiah FC","note":"8 int."}],
  "MAR":[{"pos":"PO","name":"Yassine Bounou","club":"Al Hilal SC","note":"91 int."},{"pos":"DF","name":"Achraf Hakimi","club":"Paris Saint-Germain","note":"97 int. · 11 gls"},{"pos":"DF","name":"Noussair Mazraoui","club":"Manchester United FC","note":"46 int. · 2 gls"},{"pos":"MC","name":"Sofyan Amrabat","club":"Real Betis","note":"75 int."},{"pos":"DF","name":"Marwane Saadane","club":"Al Fateh SC","note":"17 int. · 1 gls"},{"pos":"MC","name":"Ayyoub Bouaddi","club":"Lille OSC","note":"4 int."},{"pos":"MC","name":"Chemsdine Talbi","club":"Sunderland AFC","note":"6 int."},{"pos":"MC","name":"Azzedine Ounahi","club":"Girona FC","note":"50 int. · 9 gls"},{"pos":"DC","name":"Sou Rahimi","club":"Al Ain FC","note":"38 int. · 12 gls"},{"pos":"DC","name":"Brahim Diaz","club":"Real Madrid C. F.","note":"27 int. · 15 gls"},{"pos":"MC","name":"Ismael Saibari","club":"PSV Eindhoven","note":"31 int. · 10 gls"},{"pos":"PO","name":"Munir El Kajoui","club":"RS Berkane","note":"52 int."},{"pos":"DF","name":"Zakaria El Ouahdi","club":"KRC Genk","note":"3 int."},{"pos":"DF","name":"Issa Diop","club":"Fulham FC","note":"5 int."},{"pos":"MC","name":"Samir El Mourabet","club":"RC Strasbourg","note":"5 int."},{"pos":"MC","name":"Gessime Yassine","club":"RC Strasbourg","note":"4 int."},{"pos":"DC","name":"Amine Sbai","club":"Angers SCO","note":"2 int."},{"pos":"DF","name":"Chadi Riad","club":"Crystal Palace FC","note":"7 int. · 1 gls"},{"pos":"DF","name":"Youssef Belammari","club":"Al Ahly FC","note":"18 int."},{"pos":"DC","name":"Ayoub El Kaabi","club":"Olympiacos FC","note":"71 int. · 36 gls"},{"pos":"DC","name":"Ayoube Amaimouni","club":"Eintracht Frankfurt","note":"3 int."},{"pos":"PO","name":"Ahmed Tagnaouti","club":"ASFAR","note":"3 int."},{"pos":"MC","name":"Bilal El Khannouss","club":"VfB Stuttgart","note":"38 int. · 3 gls"},{"pos":"MC","name":"Neil El Aynaoui","club":"AS Roma","note":"17 int. · 2 gls"},{"pos":"DF","name":"Redouane Halhal","club":"KV Mechelen","note":"3 int."},{"pos":"DF","name":"Anass Salah Eddine","club":"PSV Eindhoven","note":"10 int."}],
  "MEX":[{"pos":"PO","name":"Raul Rangel","club":"CD Guadalajara","note":"15 int."},{"pos":"DF","name":"Jorge Sanchez","club":"PAOK Saloniki","note":"59 int. · 3 gls"},{"pos":"DF","name":"Cesar Montes","club":"FC Lokomotiv Moscow","note":"69 int. · 4 gls"},{"pos":"DF","name":"Edson Alvarez","club":"Fenerbahçe SK","note":"100 int. · 7 gls"},{"pos":"DF","name":"Johan Vasquez","club":"Genoa CFC","note":"47 int. · 3 gls"},{"pos":"MC","name":"Erik Lira","club":"CF Cruz Azul","note":"26 int."},{"pos":"MC","name":"Luis Romo","club":"CD Guadalajara","note":"62 int. · 4 gls"},{"pos":"MC","name":"Alvaro Fidalgo","club":"Real Betis","note":"5 int."},{"pos":"DC","name":"Raul Jimenez","club":"Fulham FC","note":"127 int. · 46 gls"},{"pos":"DC","name":"Alexis Vega","club":"Deportivo Toluca FC","note":"53 int. · 7 gls"},{"pos":"DC","name":"Santiago Gimenez","club":"AC Milan","note":"47 int. · 6 gls"},{"pos":"PO","name":"Carlos Acevedo","club":"Club Santos Laguna","note":"7 int."},{"pos":"PO","name":"Guillermo Ochoa","club":"AEL Limassol","note":"153 int."},{"pos":"DC","name":"Armando Gonzalez","club":"CD Guadalajara","note":"8 int. · 1 gls"},{"pos":"DF","name":"Israel Reyes","club":"Club América","note":"35 int. · 2 gls"},{"pos":"DC","name":"Julian Quinones","club":"Al Qadsiah FC","note":"23 int. · 3 gls"},{"pos":"MC","name":"Orbelin Pineda","club":"AEK Athens","note":"92 int. · 12 gls"},{"pos":"MC","name":"Obed Vargas","club":"Atlético De Madrid","note":"6 int."},{"pos":"MC","name":"Gilberto Mora","club":"Club Tijuana","note":"9 int."},{"pos":"DF","name":"Mateo Chavez","club":"AZ Alkmaar","note":"10 int."},{"pos":"DC","name":"Cesar Huerta","club":"RSC Anderlecht","note":"26 int. · 3 gls"},{"pos":"DC","name":"Guillermo Martinez","club":"Pumas UNAM","note":"12 int. · 3 gls"},{"pos":"DF","name":"Jesus Gallardo","club":"Deportivo Toluca FC","note":"123 int. · 3 gls"},{"pos":"MC","name":"Luis Chavez","club":"FC Dynamo Moscow","note":"46 int. · 5 gls"},{"pos":"DC","name":"Roberto Alvarado","club":"CD Guadalajara","note":"69 int. · 6 gls"},{"pos":"MC","name":"Brian Gutierrez","club":"CD Guadalajara","note":"8 int. · 2 gls"}],
  "NED":[{"pos":"PO","name":"Bart Verbruggen","club":"Brighton & Hove Albion FC","note":"30 int."},{"pos":"DF","name":"Lutsharel Geertruida","club":"Sunderland AFC","note":"21 int."},{"pos":"MC","name":"Marten De Roon","club":"Atalanta Bergamo","note":"43 int. · 1 gls"},{"pos":"DF","name":"Virgil Van Dijk","club":"Liverpool FC","note":"93 int. · 13 gls"},{"pos":"DF","name":"Nathan Ake","club":"Manchester City FC","note":"60 int. · 5 gls"},{"pos":"DF","name":"Jan Van Hecke","club":"Brighton & Hove Albion FC","note":"13 int."},{"pos":"MC","name":"Justin Kluivert","club":"AFC Bournemouth","note":"12 int."},{"pos":"MC","name":"Ryan Gravenberch","club":"Liverpool FC","note":"28 int. · 1 gls"},{"pos":"DC","name":"Wout Weghorst","club":"AFC Ajax","note":"52 int. · 14 gls"},{"pos":"DC","name":"Memphis Depay","club":"SC Corinthians","note":"110 int. · 55 gls"},{"pos":"DC","name":"Cody Gakpo","club":"Liverpool FC","note":"51 int. · 21 gls"},{"pos":"DF","name":"Mats Wieffer","club":"Brighton & Hove Albion FC","note":"15 int. · 1 gls"},{"pos":"PO","name":"Robin Roefs","club":"Sunderland AFC","note":"1 int."},{"pos":"MC","name":"Tijjani Reijnders","club":"Manchester City FC","note":"33 int. · 7 gls"},{"pos":"DF","name":"Micky Van De Ven","club":"Tottenham Hotspur FC","note":"22 int. · 1 gls"},{"pos":"MC","name":"Guus Til","club":"PSV Eindhoven","note":"7 int. · 1 gls"},{"pos":"DC","name":"Noa Lang","club":"Galatasaray SK","note":"15 int. · 3 gls"},{"pos":"DC","name":"Donyell Malen","club":"AS Roma","note":"54 int. · 13 gls"},{"pos":"DC","name":"Brian Brobbey","club":"Sunderland AFC","note":"13 int. · 1 gls"},{"pos":"MC","name":"Teun Koopmeiners","club":"Juventus FC","note":"29 int. · 3 gls"},{"pos":"MC","name":"Frenkie De Jong","club":"FC Barcelona","note":"67 int. · 2 gls"},{"pos":"DF","name":"Denzel Dumfries","club":"FC Internazionale Milano","note":"73 int. · 11 gls"},{"pos":"PO","name":"Mark Flekken","club":"Bayer 04 Leverkusen","note":"12 int."},{"pos":"DC","name":"Crysencio Summerville","club":"West Ham United FC","note":"3 int. · 1 gls"},{"pos":"DF","name":"Jorrel Hato","club":"Chelsea FC","note":"8 int."},{"pos":"MC","name":"Quinten Timber","club":"Olympique Marseille","note":"12 int. · 1 gls"}],
  "NOR":[{"pos":"PO","name":"Orjan Nyland","club":"Sevilla FC","note":"71 int."},{"pos":"MC","name":"Morten Thorsby","club":"US Cremonese","note":"31 int."},{"pos":"DF","name":"Kristoffer Ajer","club":"Brentford FC","note":"52 int. · 2 gls"},{"pos":"DF","name":"Leo Ostigard","club":"Genoa CFC","note":"38 int. · 1 gls"},{"pos":"DF","name":"David Moller Wolfe","club":"Wolverhampton Wanderers FC","note":"22 int. · 1 gls"},{"pos":"MC","name":"Patrick Berg","club":"FK Bodø/Glimt","note":"43 int."},{"pos":"DC","name":"Alexander Sorloth","club":"Atlético De Madrid","note":"72 int. · 26 gls"},{"pos":"MC","name":"Sander Berge","club":"Fulham FC","note":"66 int. · 1 gls"},{"pos":"DC","name":"Erling Haaland","club":"Manchester City FC","note":"50 int. · 55 gls"},{"pos":"MC","name":"Martin Odegaard","club":"Arsenal FC","note":"68 int. · 5 gls"},{"pos":"DC","name":"Jorgen Strand Larsen","club":"Crystal Palace FC","note":"28 int. · 6 gls"},{"pos":"PO","name":"Sander Tangvik","club":"Hamburger SV","note":"0 int."},{"pos":"PO","name":"Egil Selvik","club":"Watford FC","note":"7 int."},{"pos":"MC","name":"Fredrik Aursnes","club":"SL Benca","note":"22 int. · 1 gls"},{"pos":"DF","name":"Fredrik Bjorkan","club":"FK Bodø/Glimt","note":"21 int. · 1 gls"},{"pos":"DF","name":"Marcus Holmgren Pedersen","club":"Torino FC","note":"32 int."},{"pos":"DF","name":"Torbjorn Heggem","club":"Bologna FC","note":"15 int."},{"pos":"MC","name":"Kristian Thorstvedt","club":"US Sassuolo","note":"37 int. · 4 gls"},{"pos":"MC","name":"Thelo Aasgaard","club":"Rangers FC","note":"8 int. · 5 gls"},{"pos":"DC","name":"Antonio Nusa","club":"RB Leipzig","note":"24 int. · 8 gls"},{"pos":"MC","name":"Andreas Schjelderup","club":"SL Benca","note":"12 int. · 1 gls"},{"pos":"MC","name":"Oscar Bobb","club":"Fulham FC","note":"20 int. · 2 gls"},{"pos":"MC","name":"Jens Hauge","club":"FK Bodø/Glimt","note":"15 int. · 1 gls"},{"pos":"DF","name":"Sondre Langas","club":"Derby County FC","note":"3 int."},{"pos":"DF","name":"Henrik Falchener","club":"Viking Stavanger","note":"1 int."},{"pos":"DC","name":"Julian Ryerson","club":"Borussia Dortmund","note":"43 int. · 1 gls"}],
  "NZL":[{"pos":"PO","name":"Max Crocombe","club":"Millwall FC","note":"24 int."},{"pos":"DF","name":"Tim Payne","club":"Wellington Phoenix FC","note":"52 int. · 3 gls"},{"pos":"DF","name":"Francis De Vries","club":"Auckland FC","note":"20 int. · 1 gls"},{"pos":"DF","name":"Tyler Bindon","club":"Sheeld United FC","note":"25 int. · 2 gls"},{"pos":"DF","name":"Michael Boxall","club":"Minnesota United FC","note":"64 int. · 1 gls"},{"pos":"MC","name":"Joe Bell","club":"Viking Stavanger","note":"32 int. · 1 gls"},{"pos":"DC","name":"Logan Rogerson","club":"Auckland FC","note":"18 int. · 2 gls"},{"pos":"MC","name":"Marko Stamenic","club":"Swansea City AFC","note":"40 int. · 3 gls"},{"pos":"DC","name":"Chris Wood","club":"Nottingham Forest FC","note":"90 int. · 45 gls"},{"pos":"MC","name":"Sarpreet Singh","club":"Wellington Phoenix FC","note":"28 int. · 3 gls"},{"pos":"MC","name":"Elijah Just","club":"Motherwell FC","note":"44 int. · 9 gls"},{"pos":"PO","name":"Alex Paulsen","club":"Lechia Gda ń sk","note":"8 int."},{"pos":"DF","name":"Liberato Cacace","club":"Wrexham AFC","note":"37 int. · 1 gls"},{"pos":"MC","name":"Alex Rufer","club":"Wellington Phoenix FC","note":"26 int."},{"pos":"DF","name":"Nando Pijnaker","club":"Auckland FC","note":"26 int."},{"pos":"DF","name":"Finn Surman","club":"Portland Timbers","note":"19 int. · 2 gls"},{"pos":"DC","name":"Kosta Barbarouses","club":"WS Wanderers FC","note":"76 int. · 10 gls"},{"pos":"DC","name":"Ben Waine","club":"Port Vale FC","note":"31 int. · 9 gls"},{"pos":"MC","name":"Ben Old","club":"AS Saint-Etienne","note":"24 int. · 2 gls"},{"pos":"MC","name":"Mc","club":"Silkeborg IF","note":"33 int. · 5 gls"},{"pos":"DC","name":"Jesse Randall","club":"Auckland FC","note":"11 int. · 2 gls"},{"pos":"PO","name":"Michael Woud","club":"Auckland FC","note":"7 int."},{"pos":"MC","name":"Ryan Thomas","club":"PEC Zwolle","note":"25 int. · 3 gls"},{"pos":"DF","name":"Callan Elliot","club":"Auckland FC","note":"11 int."},{"pos":"MC","name":"Lachlan Bayliss","club":"Newcastle United Jets FC","note":"4 int."},{"pos":"DF","name":"Tommy Smith","club":"Braintree Town FC","note":"57 int. · 2 gls"}],
  "PAN":[{"pos":"PO","name":"Luis Mejia","club":"Club Nacional","note":"56 int."},{"pos":"DF","name":"Cesar Blackman","club":"Š K Slovan Bratislava","note":"40 int. · 3 gls"},{"pos":"DF","name":"Jose Cordoba","club":"Norwich City FC","note":"32 int. · 1 gls"},{"pos":"DF","name":"Fidel Escobar","club":"Deportivo Saprissa","note":"99 int. · 4 gls"},{"pos":"DF","name":"Edgardo Farina","club":"FC Pari Nizhny Novgorod","note":"18 int."},{"pos":"MC","name":"Cristian Martinez","club":"Hapoel Kiryat Shmona FC","note":"67 int. · 2 gls"},{"pos":"MC","name":"Jose Rodriguez","club":"FC Juárez","note":"70 int. · 8 gls"},{"pos":"MC","name":"Adalberto Carrasquilla","club":"Pumas UNAM","note":"73 int. · 3 gls"},{"pos":"DC","name":"Tomas Rodriguez","club":"Deportivo Saprissa","note":"13 int. · 4 gls"},{"pos":"MC","name":"Ismael Diaz","club":"Club León","note":"56 int. · 17 gls"},{"pos":"MC","name":"Edgar Barcenas","club":"Mazatlán FC","note":"104 int. · 10 gls"},{"pos":"PO","name":"Cesar Samudio","club":"CD Marathón","note":"5 int."},{"pos":"DF","name":"Jiovany Ramos","club":"Puerto Cabello CF","note":"23 int. · 2 gls"},{"pos":"DF","name":"Carlos Harvey","club":"Minnesota United FC","note":"28 int. · 3 gls"},{"pos":"DF","name":"Eric Davis","club":"CD Plaza Amador","note":"107 int. · 9 gls"},{"pos":"DF","name":"Andres Andrade","club":"LASK Linz","note":"50 int. · 1 gls"},{"pos":"DC","name":"Jose Fajardo","club":"CD Universidad Católica","note":"69 int. · 17 gls"},{"pos":"DC","name":"Cecilio Waterman","club":"CD Universidad De Concepción","note":"55 int. · 15 gls"},{"pos":"MC","name":"Alberto Quintero","club":"CD Plaza Amador","note":"141 int. · 7 gls"},{"pos":"MC","name":"Anibal Godoy","club":"San Diego FC","note":"159 int. · 4 gls"},{"pos":"MC","name":"Cesar Yanis","club":"CD Cobresal","note":"55 int. · 5 gls"},{"pos":"PO","name":"Orlando Mosquera","club":"Al Fayha FC","note":"49 int."},{"pos":"DF","name":"Amir Murillo","club":"Be ş ikta ş  JK","note":"93 int. · 9 gls"},{"pos":"DC","name":"Azarias Londono","club":"CD Universidad Católica","note":"12 int. · 1 gls"},{"pos":"DF","name":"Roderick Miller","club":"Turan Tovuz","note":"49 int. · 2 gls"},{"pos":"DF","name":"Jorge Gutierrez","club":"Deportivo La Guaira","note":"18 int."}],
  "POR":[{"pos":"PO","name":"Diogo Costa","club":"FC Porto","note":"43 int."},{"pos":"DF","name":"Nelson","club":"Fenerbahçe SK","note":"50 int."},{"pos":"DF","name":"Ruben Dias","club":"Manchester City FC","note":"76 int. · 3 gls"},{"pos":"DF","name":"Tomas Araujo","club":"SL Benca","note":"5 int."},{"pos":"DF","name":"José Diogo Dalot","club":"Manchester United FC","note":"35 int. · 3 gls"},{"pos":"MC","name":"Matheus","club":"Manchester City FC","note":"20 int. · 2 gls"},{"pos":"DC","name":"Cristiano","club":"Al Nassr FC","note":"228 int. · 143 gls"},{"pos":"MC","name":"Bruno","club":"Manchester United FC","note":"89 int. · 29 gls"},{"pos":"DC","name":"Goncalo","club":"Paris Saint-Germain","note":"25 int. · 10 gls"},{"pos":"MC","name":"Bernardo Silva","club":"Manchester City FC","note":"109 int. · 14 gls"},{"pos":"DC","name":"Joao Felix","club":"Al Nassr FC","note":"54 int. · 12 gls"},{"pos":"PO","name":"Jose Sa","club":"Wolverhampton Wanderers FC","note":"5 int."},{"pos":"DF","name":"Renato","club":"Villarreal CF","note":"13 int. · 1 gls"},{"pos":"DF","name":"Goncalo Inacio","club":"Sporting CP","note":"22 int. · 2 gls"},{"pos":"MC","name":"Joao","club":"Paris Saint-Germain","note":"22 int. · 3 gls"},{"pos":"DC","name":"Francisco Trincao","club":"Sporting CP","note":"18 int. · 3 gls"},{"pos":"DC","name":"Rafael Leao","club":"AC Milan","note":"44 int. · 5 gls"},{"pos":"DC","name":"Pedro Neto","club":"Chelsea FC","note":"25 int. · 3 gls"},{"pos":"DC","name":"Goncalo","club":"Real Sociedad","note":"35 int. · 8 gls"},{"pos":"DF","name":"Joao Cancelo","club":"FC Barcelona","note":"68 int. · 12 gls"},{"pos":"MC","name":"Ruben","club":"Al Hilal SC","note":"67 int. · 1 gls"},{"pos":"PO","name":"Rui Silva","club":"Sporting CP","note":"3 int."},{"pos":"MC","name":"Vitor Vitinha","club":"Paris Saint-Germain","note":"38 int."},{"pos":"DF","name":"Samuel Samu Costa","club":"RCD Mallorca","note":"6 int."},{"pos":"DF","name":"Nuno","club":"Paris Saint-Germain","note":"44 int. · 1 gls"},{"pos":"DC","name":"Francisco Conceicao","club":"Juventus FC","note":"17 int. · 4 gls"}],
  "PRY":[{"pos":"PO","name":"Gatito Fernandez","club":"Cerro Porteño","note":"30 int."},{"pos":"DF","name":"Gustavo Velazquez","club":"Cerro Porteño","note":"14 int. · 1 gls"},{"pos":"DF","name":"Omar Alderete","club":"Sunderland AFC","note":"37 int. · 3 gls"},{"pos":"DF","name":"Juan Caceres","club":"FC Dynamo Moscow","note":"18 int."},{"pos":"DF","name":"Fabian Balbuena","club":"Grêmio FBPA","note":"47 int. · 2 gls"},{"pos":"DF","name":"Junior Alonso","club":"Atlético Mineiro","note":"72 int. · 3 gls"},{"pos":"MC","name":"Ramon Sosa","club":"SE Palmeiras","note":"30 int. · 1 gls"},{"pos":"MC","name":"Diego Gomez","club":"Brighton & Hove Albion FC","note":"25 int. · 3 gls"},{"pos":"DC","name":"Antonio Sanabria","club":"US Cremonese","note":"49 int. · 7 gls"},{"pos":"MC","name":"Miguel Almiron","club":"Atlanta United FC","note":"77 int. · 10 gls"},{"pos":"MC","name":"Mauricio","club":"SE Palmeiras","note":"4 int. · 1 gls"},{"pos":"PO","name":"Orlando Gill","club":"CA San Lorenzo","note":"7 int."},{"pos":"DF","name":"Jose Canale","club":"CA Lanús","note":"2 int."},{"pos":"MC","name":"Andres Cubas","club":"Vancouver Whitecaps FC","note":"34 int."},{"pos":"DF","name":"Gustavo Gomez","club":"SE Palmeiras","note":"90 int. · 4 gls"},{"pos":"MC","name":"Damian Bobadilla","club":"São Paulo FC","note":"20 int. · 1 gls"},{"pos":"DC","name":"Alejandro Romero Gamarra","club":"Al Ain FC","note":"35 int. · 6 gls"},{"pos":"DC","name":"Alex Arce","club":"CS Independiente Rivadavia","note":"16 int. · 1 gls"},{"pos":"DC","name":"Julio Enciso","club":"RC Strasbourg","note":"33 int. · 4 gls"},{"pos":"MC","name":"Braian Ojeda","club":"Orlando City SC","note":"17 int."},{"pos":"DC","name":"Gabriel Avalos","club":"CA Independiente","note":"23 int. · 2 gls"},{"pos":"PO","name":"Gaston Olveira","club":"Club Olimpia","note":"1 int."},{"pos":"MC","name":"Matias Galarza","club":"Atlanta United FC","note":"15 int. · 3 gls"},{"pos":"MC","name":"Gustavo Caballero","club":"Portsmouth FC","note":"2 int. · 1 gls"},{"pos":"DC","name":"Isidro Pitta","club":"Red Bull Bragantino","note":"5 int."},{"pos":"DF","name":"Alexandro Maidana","club":"CA Talleres","note":"2 int. · 1 gls"}],
  "QAT":[{"pos":"PO","name":"Mahmoud Abunada","club":"Al Rayyan SC","note":"7 int."},{"pos":"DF","name":"Pedro","club":"Al Sadd SC","note":"112 int. · 4 gls"},{"pos":"DF","name":"Lucas","club":"Al Wakrah SC","note":"28 int. · 2 gls"},{"pos":"DF","name":"Gueye Issa Laye","club":"Al Arabi SC","note":"5 int."},{"pos":"DF","name":"Jassem","club":"Al Rayyan SC","note":"38 int. · 1 gls"},{"pos":"MC","name":"Abdelaziz Abdulaziz Hatem","club":"Al Rayyan SC","note":"132 int. · 11 gls"},{"pos":"DC","name":"Ahmed","club":"Al Rayyan SC","note":"78 int. · 10 gls"},{"pos":"DC","name":"Edmilson","club":"Al Duhail SC","note":"17 int."},{"pos":"DC","name":"Mohammed Muntari","club":"Al Gharafa SC","note":"74 int. · 17 gls"},{"pos":"DC","name":"Hasan Hassan Alhaydos","club":"Al Sadd SC","note":"190 int. · 39 gls"},{"pos":"DC","name":"Akram","club":"Al Sadd SC","note":"137 int. · 40 gls"},{"pos":"MC","name":"Karim Boudiaf","club":"Al Duhail SC","note":"129 int. · 6 gls"},{"pos":"DF","name":"Ayoub Aloui","club":"Al Gharafa SC","note":"8 int."},{"pos":"DF","name":"Homam","club":"Cultural Leonesa","note":"77 int. · 3 gls"},{"pos":"DC","name":"Yusuf Abdurisag","club":"Al Wakrah SC","note":"45 int. · 3 gls"},{"pos":"DF","name":"Boualem","club":"Al Sadd SC","note":"129 int. · 21 gls"},{"pos":"MC","name":"Ahmed","club":"Al Gharafa SC","note":"15 int. · 1 gls"},{"pos":"DF","name":"Sultan","club":"Al Duhail SC","note":"20 int."},{"pos":"DC","name":"Almoez","club":"Al Duhail SC","note":"128 int. · 58 gls"},{"pos":"MC","name":"Ahmed Fathy","club":"Al Arabi SC","note":"55 int."},{"pos":"PO","name":"Salah Zakaria","club":"Al Duhail SC","note":"10 int."},{"pos":"PO","name":"Meshaal Barsham","club":"Al Sadd SC","note":"60 int."},{"pos":"MC","name":"Assim Madibo","club":"Al Wakrah SC","note":"65 int."},{"pos":"DC","name":"Tahsin","club":"Al Duhail SC","note":"5 int."},{"pos":"DF","name":"Alhashmi","club":"Al Arabi SC","note":"10 int."},{"pos":"DC","name":"Mohamed Manai","club":"Al Shamal SC","note":"12 int."}],
  "RSA":[{"pos":"PO","name":"Ronwen Williams","club":"Mamelodi Sundowns FC","note":"65 int."},{"pos":"DF","name":"Thabang Matuludi","club":"Polokwane City FC","note":"3 int."},{"pos":"DF","name":"Khulumani Ndamane","club":"Mamelodi Sundowns FC","note":"5 int."},{"pos":"MC","name":"Teboho Mokoena","club":"Mamelodi Sundowns FC","note":"58 int. · 9 gls"},{"pos":"MC","name":"Thalente Mbatha","club":"Orlando Pirates FC","note":"17 int. · 3 gls"},{"pos":"DF","name":"Aubrey Modiba","club":"Mamelodi Sundowns FC","note":"49 int. · 3 gls"},{"pos":"DC","name":"Oswin Appollis","club":"Orlando Pirates FC","note":"28 int. · 8 gls"},{"pos":"DC","name":"Tshepang Moremi","club":"Orlando Pirates FC","note":"10 int. · 1 gls"},{"pos":"DC","name":"Lyle Foster","club":"Burnley FC","note":"32 int. · 10 gls"},{"pos":"DC","name":"Relebohile Mofokeng","club":"Orlando Pirates FC","note":"14 int. · 1 gls"},{"pos":"MC","name":"Themba Zwane","club":"Mamelodi Sundowns FC","note":"56 int. · 12 gls"},{"pos":"DC","name":"Thapelo Maseko","club":"AEL Limassol","note":"8 int. · 1 gls"},{"pos":"MC","name":"Sphephelo Sithole","club":"CD Tondela","note":"30 int. · 1 gls"},{"pos":"DF","name":"Mbekezeli Mbokazi","club":"Chicago Fire FC","note":"11 int. · 1 gls"},{"pos":"DC","name":"Iqraam Rayners","club":"Mamelodi Sundowns FC","note":"21 int. · 5 gls"},{"pos":"PO","name":"Sipho Chaine","club":"Orlando Pirates FC","note":"4 int."},{"pos":"DC","name":"Evidence Makgopa","club":"Orlando Pirates FC","note":"28 int. · 6 gls"},{"pos":"DF","name":"Samukele Kabini","club":"Molde FK","note":"6 int."},{"pos":"DF","name":"Nkosinathi Sibisi","club":"Orlando Pirates FC","note":"22 int."},{"pos":"DF","name":"Khuliso Mudau","club":"Mamelodi Sundowns FC","note":"35 int. · 1 gls"},{"pos":"DF","name":"Ime Okon","club":"Hannover 96","note":"9 int. · 1 gls"},{"pos":"PO","name":"Ricardo Goss","club":"Siwelele FC","note":"7 int."},{"pos":"MC","name":"Jayden Adams","club":"Mamelodi Sundowns FC","note":"9 int. · 2 gls"},{"pos":"DF","name":"Olwethu Makhanya","club":"Philadelphia Union","note":"1 int."},{"pos":"DC","name":"Kamogelo Sebelebele","club":"Orlando Pirates FC","note":"9 int. · 1 gls"},{"pos":"DF","name":"Bradley Cross","club":"Kaizer Chiefs FC","note":"1 int."}],
  "SCO":[{"pos":"PO","name":"Angus Gunn","club":"Nottingham Forest FC","note":"23 int."},{"pos":"DF","name":"Aaron Hickey","club":"Brentford FC","note":"22 int."},{"pos":"DF","name":"Andy Robertson","club":"Liverpool FC","note":"95 int. · 4 gls"},{"pos":"MC","name":"Mc","club":"SSC Napoli","note":"71 int. · 15 gls"},{"pos":"DF","name":"Grant Hanley","club":"Hibernian FC","note":"69 int. · 2 gls"},{"pos":"DF","name":"Kieran Tierney","club":"Celtic FC","note":"56 int. · 2 gls"},{"pos":"MC","name":"Mc","club":"Aston Villa FC","note":"87 int. · 21 gls"},{"pos":"MC","name":"Tyler Fletcher","club":"Manchester United FC","note":"2 int."},{"pos":"DC","name":"Lyndon Dykes","club":"Charlton Athletic FC","note":"52 int. · 10 gls"},{"pos":"DC","name":"Che Adams","club":"Torino FC","note":"48 int. · 13 gls"},{"pos":"MC","name":"Ryan Christie","club":"AFC Bournemouth","note":"69 int. · 10 gls"},{"pos":"PO","name":"Liam Kelly","club":"Rangers FC","note":"3 int."},{"pos":"DF","name":"Jack Hendry","club":"Al Ettifaq FC","note":"39 int. · 3 gls"},{"pos":"DC","name":"Ross Stewart","club":"Southampton FC","note":"3 int."},{"pos":"DF","name":"John Souttar","club":"Rangers FC","note":"24 int. · 2 gls"},{"pos":"DF","name":"Dominic Hyam","club":"Wrexham AFC","note":"4 int."},{"pos":"DC","name":"Ben Gannon-doak","club":"AFC Bournemouth","note":"15 int. · 1 gls"},{"pos":"DC","name":"George Hirst","club":"Ipswich Town FC","note":"10 int. · 1 gls"},{"pos":"MC","name":"Lewis Ferguson","club":"Bologna FC","note":"25 int. · 1 gls"},{"pos":"DC","name":"Lawrence Shankland","club":"Heart Of Midlothian FC","note":"21 int. · 7 gls"},{"pos":"PO","name":"Craig Gordon","club":"Heart Of Midlothian FC","note":"84 int."},{"pos":"DF","name":"Nathan Patterson","club":"Everton FC","note":"27 int. · 1 gls"},{"pos":"MC","name":"Mc","club":"Norwich City FC","note":"59 int. · 3 gls"},{"pos":"DF","name":"Anthony Ralston","club":"Celtic FC","note":"27 int. · 1 gls"},{"pos":"DC","name":"Findlay Curtis","club":"Kilmarnock FC","note":"4 int. · 1 gls"},{"pos":"DF","name":"Mc","club":"GNK Dinamo Zagreb","note":"50 int. · 1 gls"}],
  "SEN":[{"pos":"PO","name":"Yehvann Diouf","club":"OGC Nice","note":"2 int."},{"pos":"DF","name":"Mamadou Sarr","club":"Chelsea FC","note":"8 int."},{"pos":"DF","name":"Kalidou Koulibaly","club":"Al Hilal SC","note":"104 int. · 2 gls"},{"pos":"DF","name":"Abdoulaye Seck","club":"Maccabi Haifa FC","note":"23 int. · 4 gls"},{"pos":"MC","name":"Idrissa Gueye","club":"Everton FC","note":"136 int. · 7 gls"},{"pos":"MC","name":"Pathe Ciss","club":"Rayo Vallecano","note":"31 int."},{"pos":"DC","name":"Assane Diao","club":"Como","note":"5 int."},{"pos":"MC","name":"Lamine Camara","club":"AS Monaco","note":"45 int. · 7 gls"},{"pos":"DC","name":"Bamba Dieng","club":"FC Lorient","note":"23 int. · 2 gls"},{"pos":"DC","name":"Sadio Mane","club":"Al Nassr FC","note":"130 int. · 54 gls"},{"pos":"DC","name":"Nicolas Jackson","club":"FC Bayern München","note":"34 int. · 8 gls"},{"pos":"DC","name":"Cherif Ndiaye","club":"Samsunspor","note":"19 int. · 4 gls"},{"pos":"DC","name":"Iliman Ndiaye","club":"Everton FC","note":"41 int. · 4 gls"},{"pos":"DF","name":"Ismail Jakobs","club":"Galatasaray SK","note":"31 int."},{"pos":"DF","name":"Krepin Diatta","club":"AS Monaco","note":"62 int. · 2 gls"},{"pos":"PO","name":"Edouard Mendy","club":"Al Ahli FC","note":"58 int."},{"pos":"MC","name":"Pape Sarr","club":"Tottenham Hotspur FC","note":"41 int. · 4 gls"},{"pos":"DC","name":"Ismaila Sarr","club":"Crystal Palace FC","note":"84 int. · 19 gls"},{"pos":"DF","name":"Moussa Niakhate","club":"Olympique Lyonnais","note":"32 int."},{"pos":"DC","name":"Ibrahim Mbaye","club":"Paris Saint-Germain","note":"11 int. · 3 gls"},{"pos":"MC","name":"Habib Diarra","club":"Sunderland AFC","note":"21 int. · 4 gls"},{"pos":"MC","name":"Bara Ndiaye","club":"FC Bayern München","note":"1 int."},{"pos":"PO","name":"Mory Diaw","club":"Le Havre AC","note":"5 int."},{"pos":"DF","name":"Antoine Mendy","club":"OGC Nice","note":"7 int."},{"pos":"DF","name":"El Diouf","club":"West Ham United FC","note":"20 int. · 1 gls"},{"pos":"MC","name":"Pape Gueye","club":"Villarreal CF","note":"42 int. · 6 gls"}],
  "SUI":[{"pos":"PO","name":"Gregor Kobel","club":"Borussia Dortmund","note":"22 int."},{"pos":"DF","name":"Miro Muheim","club":"Hamburger SV","note":"11 int."},{"pos":"DF","name":"Silvan Widmer","club":"1. FSV Mainz 05","note":"60 int. · 5 gls"},{"pos":"DF","name":"Nico Elvedi","club":"Borussia Mönchengladbach","note":"68 int. · 3 gls"},{"pos":"DF","name":"Manuel Akanji","club":"FC Internazionale Milano","note":"82 int. · 4 gls"},{"pos":"MC","name":"Denis Zakaria","club":"AS Monaco","note":"66 int. · 3 gls"},{"pos":"DC","name":"Breel Embolo","club":"Stade Rennais FC","note":"87 int. · 25 gls"},{"pos":"MC","name":"Remo Freuler","club":"Bologna FC","note":"89 int. · 11 gls"},{"pos":"MC","name":"Johan Manzambi","club":"SC Freiburg","note":"13 int. · 3 gls"},{"pos":"MC","name":"Granit Xhaka","club":"Sunderland AFC","note":"147 int. · 17 gls"},{"pos":"DC","name":"Dan Ndoye","club":"Nottingham Forest FC","note":"32 int. · 8 gls"},{"pos":"PO","name":"Yvon Mvogo","club":"FC Lorient","note":"13 int."},{"pos":"DF","name":"Ricardo Rodriguez","club":"Real Betis","note":"139 int. · 9 gls"},{"pos":"MC","name":"Ardon Jashari","club":"AC Milan","note":"9 int."},{"pos":"MC","name":"Djibril Sow","club":"Sevilla FC","note":"52 int."},{"pos":"DC","name":"Christian Fassnacht","club":"BSC Young Boys","note":"23 int. · 5 gls"},{"pos":"DC","name":"Ruben Vargas","club":"Sevilla FC","note":"62 int. · 11 gls"},{"pos":"DF","name":"Eray Coemert","club":"Valencia CF","note":"22 int."},{"pos":"DC","name":"Noah Okafor","club":"Leeds United FC","note":"25 int. · 2 gls"},{"pos":"MC","name":"Michel Aebischer","club":"Pisa SC","note":"41 int. · 2 gls"},{"pos":"PO","name":"Marvin Keller","club":"BSC Young Boys","note":"1 int."},{"pos":"MC","name":"Fabian Rieder","club":"FC Augsburg","note":"29 int. · 1 gls"},{"pos":"DC","name":"Zeki Amdouni","club":"Burnley FC","note":"30 int. · 11 gls"},{"pos":"DF","name":"Aurele Amenda","club":"Eintracht Frankfurt","note":"7 int."},{"pos":"DF","name":"Luca Jaquez","club":"VfB Stuttgart","note":"3 int."},{"pos":"DC","name":"Cedric Itten","club":"Fortuna Düsseldorf","note":"15 int. · 5 gls"}],
  "SWE":[{"pos":"PO","name":"Jacob Widell Zetterstrom","club":"Derby County FC","note":"3 int."},{"pos":"DF","name":"Gustaf Lagerbielke","club":"SC Braga","note":"12 int. · 2 gls"},{"pos":"DF","name":"Victor Lindelof","club":"Aston Villa FC","note":"77 int. · 3 gls"},{"pos":"DF","name":"Isak Hien","club":"Atalanta Bergamo","note":"30 int."},{"pos":"DF","name":"Gabriel Gudmundsson","club":"Leeds United FC","note":"25 int."},{"pos":"DF","name":"Herman Johansson","club":"FC Dallas","note":"3 int."},{"pos":"MC","name":"Lucas Bergvall","club":"Tottenham Hotspur FC","note":"11 int."},{"pos":"DF","name":"Daniel Svensson","club":"Borussia Dortmund","note":"14 int."},{"pos":"DC","name":"Alexander Isak","club":"Liverpool FC","note":"59 int. · 18 gls"},{"pos":"MC","name":"Benjamin Nygren","club":"Celtic FC","note":"12 int. · 3 gls"},{"pos":"DC","name":"Anthony Elanga","club":"Newcastle United FC","note":"31 int. · 6 gls"},{"pos":"PO","name":"Viktor Johansson","club":"Stoke City FC","note":"12 int."},{"pos":"MC","name":"Ken Sema","club":"Pafos FC","note":"32 int. · 5 gls"},{"pos":"DF","name":"Hjalmar Ekdal","club":"Burnley FC","note":"13 int."},{"pos":"DF","name":"Carl Starfelt","club":"RC Celta Vigo","note":"18 int."},{"pos":"MC","name":"Jesper Karlstrom","club":"Udinese","note":"25 int."},{"pos":"DC","name":"Viktor Gyokeres","club":"Arsenal FC","note":"34 int. · 21 gls"},{"pos":"MC","name":"Yasin Ayari","club":"Brighton & Hove Albion FC","note":"22 int. · 5 gls"},{"pos":"MC","name":"Mattias Svanberg","club":"VfL Wolfsburg","note":"41 int. · 3 gls"},{"pos":"DF","name":"Eric Smith","club":"FC St. Pauli","note":"2 int."},{"pos":"DF","name":"Alexander Bernhardsson","club":"Holstein Kiel","note":"12 int."},{"pos":"MC","name":"Besfort Zeneli","club":"Royale Union Saint-Gilloise","note":"8 int."},{"pos":"PO","name":"Kristoffer Nordfeldt","club":"AIK Stockholm","note":"22 int."},{"pos":"DF","name":"Elliot Stroud","club":"Mjällby AIF","note":"2 int."},{"pos":"DC","name":"Gustaf Nilsson","club":"Club Brugge","note":"9 int. · 4 gls"},{"pos":"DC","name":"Taha Ali","club":"Malmö FF","note":"2 int."}],
  "TUN":[{"pos":"PO","name":"Mouhib Chamakh","club":"Club Africain","note":"4 int."},{"pos":"DF","name":"Ali Abdi","club":"OGC Nice","note":"47 int. · 7 gls"},{"pos":"DF","name":"Montassar Talbi","club":"FC Lorient","note":"65 int. · 4 gls"},{"pos":"DF","name":"Omar Rekik","club":"NK Maribor","note":"7 int. · 1 gls"},{"pos":"DF","name":"Adam Arous","club":"Kasımpa ş a SK","note":"2 int."},{"pos":"DF","name":"Dylan Bronn","club":"Servette FC","note":"52 int. · 2 gls"},{"pos":"DC","name":"Elias Achouri","club":"FC København","note":"31 int. · 5 gls"},{"pos":"DC","name":"Elias Saad","club":"Hannover 96","note":"16 int. · 3 gls"},{"pos":"DC","name":"Hazem Mastouri","club":"FC Dynamo Makhachkala","note":"19 int. · 4 gls"},{"pos":"MC","name":"Hannibal Mejbri","club":"Burnley FC","note":"46 int. · 1 gls"},{"pos":"MC","name":"Ismael Gharbi","club":"FC Augsburg","note":"18 int. · 2 gls"},{"pos":"DF","name":"Mortadha Ben Ouanes","club":"Kasımpa ş a SK","note":"18 int."},{"pos":"MC","name":"Rani Khedira","club":"1. FC Union Berlin","note":"4 int."},{"pos":"MC","name":"Khalil Ayari","club":"Paris Saint-Germain","note":"4 int."},{"pos":"MC","name":"Mohamed Hadj Mahmoud","club":"FC Lugano","note":"10 int."},{"pos":"PO","name":"Aymen Dahmen","club":"CS Sfaxien","note":"37 int."},{"pos":"MC","name":"Ellyes Skhiri","club":"Eintracht Frankfurt","note":"84 int. · 4 gls"},{"pos":"DC","name":"Rayan Elloumi","club":"Vancouver Whitecaps FC","note":"4 int."},{"pos":"DC","name":"Firas Chaouat","club":"Club Africain","note":"31 int. · 6 gls"},{"pos":"DF","name":"Yan Valery","club":"BSC Young Boys","note":"23 int."},{"pos":"DF","name":"Mohamed Ben Hmida","club":"Espérance De Tunisie","note":"14 int."},{"pos":"PO","name":"Sabri Ben Hessen","club":"Étoile Du Sahel","note":"1 int."},{"pos":"DF","name":"Moutaz Neffati","club":"IFK Norrköping FK","note":"5 int."},{"pos":"DF","name":"Raed Chikhaoui","club":"US Monastir","note":"0 int."},{"pos":"MC","name":"Anis Slimane","club":"Norwich City FC","note":"41 int. · 4 gls"},{"pos":"MC","name":"Sebastian Tounekti","club":"Celtic FC","note":"13 int. · 1 gls"}],
  "TUR":[{"pos":"PO","name":"Mert Gunok","club":"Fenerbahçe SK","note":"37 int."},{"pos":"DF","name":"Zeki Celik","club":"AS Roma","note":"62 int. · 3 gls"},{"pos":"DF","name":"Merih Demiral","club":"Al Ahli FC","note":"64 int. · 6 gls"},{"pos":"DF","name":"CaglarÇa Soyuncu","club":"Fenerbahçe SK","note":"60 int. · 2 gls"},{"pos":"MC","name":"Salih Ozcan","club":"Borussia Dortmund","note":"31 int. · 1 gls"},{"pos":"MC","name":"Orkun Kokcu","club":"Be ş ikta ş  JK","note":"51 int. · 4 gls"},{"pos":"DC","name":"Kerem Akturkoglu","club":"Fenerbahçe SK","note":"53 int. · 15 gls"},{"pos":"DC","name":"Arda Guler","club":"Real Madrid C. F.","note":"31 int. · 6 gls"},{"pos":"DC","name":"Deniz Gul","club":"FC Porto","note":"9 int. · 2 gls"},{"pos":"MC","name":"Hakan Calhanoglu","club":"FC Internazionale Milano","note":"107 int. · 22 gls"},{"pos":"DC","name":"Kenan Yildiz","club":"Juventus FC","note":"29 int. · 5 gls"},{"pos":"PO","name":"Altay Bayindir","club":"Manchester United FC","note":"12 int."},{"pos":"DF","name":"Eren Elmali","club":"Galatasaray SK","note":"23 int."},{"pos":"DF","name":"Abdulkerim Bardakci","club":"Galatasaray SK","note":"28 int. · 2 gls"},{"pos":"DF","name":"Ozan Kabak","club":"TSG Hoffenheim","note":"30 int. · 2 gls"},{"pos":"MC","name":"Ismailİsma Yuksek","club":"Fenerbahçe SK","note":"33 int. · 1 gls"},{"pos":"DC","name":"Irfan Kahveci","club":"Kasımpa ş a SK","note":"47 int. · 6 gls"},{"pos":"DF","name":"Mert Muldur","club":"Fenerbahçe SK","note":"46 int. · 3 gls"},{"pos":"DC","name":"Yunus Akgun","club":"Galatasaray SK","note":"20 int. · 4 gls"},{"pos":"DF","name":"Ferdi Kadioglu","club":"Brighton & Hove Albion FC","note":"31 int. · 2 gls"},{"pos":"DC","name":"Baris Yilmaz","club":"Galatasaray SK","note":"36 int. · 4 gls"},{"pos":"MC","name":"Kaan Ayhan","club":"Galatasaray SK","note":"73 int. · 5 gls"},{"pos":"PO","name":"Ugurcan Cakir","club":"Galatasaray SK","note":"40 int."},{"pos":"DC","name":"Oguz Aydin","club":"Fenerbahçe SK","note":"11 int."},{"pos":"DF","name":"Samet Akaydin","club":"Çaykur Rizespor","note":"19 int. · 1 gls"},{"pos":"DC","name":"Can Uzun","club":"Eintracht Frankfurt","note":"6 int. · 1 gls"}],
  "URU":[{"pos":"PO","name":"Sergio Rochet","club":"SC Internacional","note":"35 int."},{"pos":"DF","name":"Jose Gimenez","club":"Atlético De Madrid","note":"99 int. · 8 gls"},{"pos":"DF","name":"Sebastian Caceres","club":"Club América","note":"23 int."},{"pos":"DF","name":"Ronald Araujo","club":"FC Barcelona","note":"27 int. · 1 gls"},{"pos":"MC","name":"Manuel Ugarte","club":"Manchester United FC","note":"35 int. · 1 gls"},{"pos":"MC","name":"Rodrigo Bentancur","club":"Tottenham Hotspur FC","note":"73 int. · 3 gls"},{"pos":"MC","name":"Nicolas De La Cruz","club":"CR Flamengo","note":"34 int. · 5 gls"},{"pos":"MC","name":"Federico Valverde","club":"Real Madrid C. F.","note":"73 int. · 9 gls"},{"pos":"DC","name":"Darwin Nunez","club":"Al Hilal SC","note":"38 int. · 13 gls"},{"pos":"MC","name":"Giorgian De Arrascaeta","club":"CR Flamengo","note":"59 int. · 13 gls"},{"pos":"DC","name":"Facundo Pellistri","club":"Panathinaikos FC","note":"39 int. · 2 gls"},{"pos":"PO","name":"Santiago Mele","club":"CF Monterrey","note":"8 int."},{"pos":"DF","name":"Guillermo Varela","club":"CR Flamengo","note":"27 int."},{"pos":"MC","name":"Agustin Canobbio","club":"Fluminense FC","note":"14 int. · 1 gls"},{"pos":"MC","name":"Emiliano Martinez","club":"SE Palmeiras","note":"10 int."},{"pos":"DF","name":"Mathias Olivera","club":"SSC Napoli","note":"35 int. · 2 gls"},{"pos":"DF","name":"Matias Vina","club":"CA River Plate","note":"43 int. · 1 gls"},{"pos":"DC","name":"Brian Rodriguez","club":"Club América","note":"33 int. · 4 gls"},{"pos":"DC","name":"Rodrigo Aguirre","club":"Tigres UANL","note":"10 int. · 3 gls"},{"pos":"MC","name":"Maxi Araujo","club":"Sporting CP","note":"28 int. · 3 gls"},{"pos":"DC","name":"Federico Vinas","club":"Real Oviedo","note":"11 int. · 2 gls"},{"pos":"MC","name":"Joaquin Piquerez","club":"SE Palmeiras","note":"19 int."},{"pos":"PO","name":"Fernando Muslera","club":"Estudiantes LP","note":"134 int."},{"pos":"DF","name":"Santiago Bueno","club":"Wolverhampton Wanderers FC","note":"8 int."},{"pos":"MC","name":"Juan Sanabria","club":"Real Salt Lake","note":"5 int. · 1 gls"},{"pos":"MC","name":"Rodrigo Zalazar","club":"SC Braga","note":"7 int. · 2 gls"}],
  "USA":[{"pos":"PO","name":"Matt Turner","club":"New England Revolution","note":"54 int."},{"pos":"DF","name":"Sergino Dest","club":"PSV Eindhoven","note":"40 int. · 3 gls"},{"pos":"DF","name":"Chris Richards","club":"Crystal Palace FC","note":"37 int. · 3 gls"},{"pos":"MC","name":"Tyler Adams","club":"AFC Bournemouth","note":"55 int. · 2 gls"},{"pos":"DF","name":"Antonee Robinson","club":"Fulham FC","note":"55 int. · 5 gls"},{"pos":"DF","name":"Auston Trusty","club":"Celtic FC","note":"8 int."},{"pos":"MC","name":"Giovanni Reyna","club":"Borussia Mönchengladbach","note":"39 int. · 10 gls"},{"pos":"MC","name":"Mc","club":"Juventus FC","note":"67 int. · 12 gls"},{"pos":"DC","name":"Ricardo Pepi","club":"PSV Eindhoven","note":"38 int. · 13 gls"},{"pos":"DC","name":"Christian Pulisic","club":"AC Milan","note":"87 int. · 33 gls"},{"pos":"DC","name":"Brenden Aaronson","club":"Leeds United FC","note":"58 int. · 9 gls"},{"pos":"DF","name":"Miles Robinson","club":"FC Cincinnatti","note":"40 int. · 3 gls"},{"pos":"DF","name":"Tim Ream","club":"Charlotte FC","note":"83 int. · 1 gls"},{"pos":"MC","name":"Sebastian Berhalter","club":"Vancouver Whitecaps FC","note":"14 int. · 1 gls"},{"pos":"MC","name":"Cristian Roldan","club":"Seattle Sounders FC","note":"47 int."},{"pos":"DF","name":"Alex Freeman","club":"Villarreal CF","note":"18 int. · 2 gls"},{"pos":"MC","name":"Malik Tillman","club":"Bayer 04 Leverkusen","note":"31 int. · 3 gls"},{"pos":"DF","name":"Max Arfsten","club":"Columbus Crew","note":"20 int. · 1 gls"},{"pos":"DC","name":"Haji Wright","club":"Coventry City FC","note":"20 int. · 7 gls"},{"pos":"DC","name":"Folarin Balogun","club":"AS Monaco","note":"28 int. · 11 gls"},{"pos":"DC","name":"Timothy Weah","club":"Olympique Marseille","note":"52 int. · 7 gls"},{"pos":"DF","name":"Mc","club":"Toulouse FC","note":"29 int."},{"pos":"DF","name":"Joe Scally","club":"Borussia Mönchengladbach","note":"26 int."},{"pos":"PO","name":"Matt Freese","club":"New York City FC","note":"16 int."},{"pos":"PO","name":"Chris Brady","club":"Chicago Fire FC","note":"1 int."},{"pos":"DC","name":"Alex Zendejas","club":"Club América","note":"14 int. · 2 gls"}],
  "UZB":[{"pos":"PO","name":"Utkir Yusupov","club":"PFC Navbahor Namangan","note":"45 int."},{"pos":"DF","name":"Abdukodir Khusanov","club":"Manchester City FC","note":"27 int."},{"pos":"DF","name":"Khojiakbar Alijonov","club":"Pakhtakor Tashkent FK","note":"52 int. · 3 gls"},{"pos":"DF","name":"Farrukh Sayfiev","club":"FK Neftchi Farg'ona","note":"71 int. · 1 gls"},{"pos":"DF","name":"Rustam Ashurmatov","club":"Esteghlal Tehran FC","note":"51 int. · 1 gls"},{"pos":"MC","name":"Akmal Mozgovoy","club":"Pakhtakor Tashkent FK","note":"25 int. · 1 gls"},{"pos":"MC","name":"Otabek Shukurov","club":"Baniyas Club","note":"90 int. · 10 gls"},{"pos":"MC","name":"Jamshid Iskanderov","club":"FK Neftchi Farg'ona","note":"46 int. · 4 gls"},{"pos":"MC","name":"Odiljon Xamrobekov","club":"Tractor Sazi Tabriz FC","note":"76 int. · 1 gls"},{"pos":"MC","name":"Jaloliddin Masharipov","club":"Esteghlal Tehran FC","note":"75 int. · 14 gls"},{"pos":"MC","name":"Oston Urunov","club":"Persepolis FC","note":"45 int. · 10 gls"},{"pos":"PO","name":"Abduvohid Nematov","club":"Nasaf Qarshi FC","note":"15 int."},{"pos":"DF","name":"Sherzod Nasrullaev","club":"Pakhtakor Tashkent FK","note":"40 int. · 2 gls"},{"pos":"DC","name":"Eldor Shomurodov","club":"Ba ş ak ş ehir FK","note":"93 int. · 44 gls"},{"pos":"DF","name":"Umar Eshmurodov","club":"Nasaf Qarshi FC","note":"40 int."},{"pos":"PO","name":"Botirali Ergashev","club":"FK Neftchi Farg'ona","note":"5 int."},{"pos":"MC","name":"Dostonbek Khamdamov","club":"Pakhtakor Tashkent FK","note":"37 int. · 5 gls"},{"pos":"DF","name":"Abdulla Abdullaev","club":"Dibba FC","note":"29 int."},{"pos":"MC","name":"Azizjon Ganiev","club":"Al Bataeh Club","note":"24 int."},{"pos":"DC","name":"Azizbek Amonov","club":"FK Dinamo Samarkand","note":"13 int. · 2 gls"},{"pos":"DC","name":"Igor Sergeev","club":"Persepolis FC","note":"85 int. · 25 gls"},{"pos":"MC","name":"Abbosbek Fayzullaev","club":"Ba ş ak ş ehir FK","note":"32 int. · 8 gls"},{"pos":"MC","name":"Sherzod Esanov","club":"FK Buxoro","note":"1 int."},{"pos":"DF","name":"Behruzjon Karimov","club":"Surkhon FK","note":"2 int."},{"pos":"DF","name":"Avazbek Ulmasaliyev","club":"OKMK FK","note":"0 int."},{"pos":"DF","name":"Jakhongir Urozov","club":"FK Dinamo Samarkand","note":"4 int. · 1 gls"}],
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
      // Si el modal de jugador está abierto, refresca solo las stats en vivo
      _refreshOpenPlayerModal();
      // Toast automático: notifica al usuario que los datos se han actualizado
      _showUpdateToast();
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
  renderScenarios();
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
        const rawMin = calcLiveMinute(m); const min = rawMin ? ` · ${liveMinuteLabel(rawMin)}` : "";
        const label = `${fh} ${ch} ${sc} ${ca} ${fa}${min}`.replace(/\s+/g, " ").trim();
        const safeDate = escapeHtml(m.date || "");
        const safeName = escapeHtml((m.name || "").replace(/'/g, "\\'"));
        return `<button class="upd-live-match-btn" onclick="goToMatchesDay('${safeDate}','${safeName}')" title="Ir al partido">${label}</button>`;
      });
      const lead = liveMatches.length > 1 ? "Partidos en juego" : "Partido en juego";
      lineEl.innerHTML = `<span class="upd-live-dot"></span><strong class="upd-live-lead">${lead}:</strong> ${parts.join(" <span class='upd-live-sep'>·</span> ")} <span class="upd-live-prov">· clasificación provisional</span>`;
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

/* ── Auto-poll: refresca data.json sin recargar la página.
   Antes solo se activaba 20 min antes del partido o con live=true en caché;
   si abrías la web por la mañana no se enteraba de nada. Ahora cubre toda la
   ventana del partido y sigue consultando hasta que llegue el resultado final. ── */
let _livePollTimer = null;
const LIVE_POLL_MS = 60_000;       // 60 s: en directo o resultado pendiente
const MATCHDAY_POLL_MS = 5 * 60_000; // 5 min: hay partidos hoy sin cerrar
const MATCH_POLL_BEFORE_MS = 45 * 60_000;  // 45 min antes del pitido
const MATCH_POLL_AFTER_MS  = 210 * 60_000; // 3,5 h después (API lenta)
const RESULT_PENDING_MS    = 95 * 60_000;  // tras ~90'+margen, esperar resultado

function _matchKickoffMs(m) {
  if (!m?.date || !m?.time_es) return null;
  try {
    return new Date(`${m.date}T${m.time_es}:00`).getTime();
  } catch { return null; }
}

function _isInMatchPollWindow() {
  if (!D) return false;
  const nowMs = Date.now();
  return (D.matches || []).some(m => {
    if (m.played) return false;
    const ko = _matchKickoffMs(m);
    if (ko == null) return false;
    const elapsed = nowMs - ko;
    return elapsed >= -MATCH_POLL_BEFORE_MS && elapsed <= MATCH_POLL_AFTER_MS;
  });
}

function _hasPendingResult() {
  if (!D) return false;
  const nowMs = Date.now();
  return (D.matches || []).some(m => {
    if (m.played) return false;
    const ko = _matchKickoffMs(m);
    if (ko == null) return false;
    const elapsed = nowMs - ko;
    return elapsed >= RESULT_PENDING_MS && elapsed <= 8 * 60 * 60_000;
  });
}

function _hasUnfinishedMatchToday() {
  if (!D) return false;
  const today = todaySpainISO();
  return (D.matches || []).some(m => m.date === today && !m.played);
}

function _shouldPollNow() {
  if (!D) return false;
  const hasLive = D.meta?.live?.active === true ||
                  (D.matches || []).some(m => m.live && !m.played);
  return hasLive || _isInMatchPollWindow() || _hasPendingResult();
}

function _pollIntervalMs() {
  if (_shouldPollNow()) return LIVE_POLL_MS;
  if (_hasUnfinishedMatchToday()) return MATCHDAY_POLL_MS;
  return 0;
}

function _updateLiveBadge(active) {
  const el = document.getElementById("upd-live-poll-badge");
  if (!el) return;
  el.classList.toggle("hidden", !active);
}

/* ── Toast de actualización automática ── */
let _toastTimer = null;

function _showUpdateToast(msg) {
  const el = document.getElementById("upd-toast");
  if (!el) return;
  el.textContent = msg || "⚡ Datos actualizados";
  el.classList.remove("hidden", "upd-toast-hide");
  el.classList.add("upd-toast-show");
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    el.classList.add("upd-toast-hide");
    setTimeout(() => { el.classList.add("hidden"); el.classList.remove("upd-toast-show", "upd-toast-hide"); }, 400);
  }, 3500);
}

/* ── Botón manual: fuerza recarga sin caché y re-render siempre ── */
async function _manualRefresh() {
  const btn = document.getElementById("upd-refresh-btn");
  if (btn) { btn.disabled = true; btn.textContent = "⏳ Cargando…"; }
  // Resetea la firma para forzar re-render aunque los datos no hayan cambiado
  _lastDataSig = null;
  await loadData(true);
  if (btn) { btn.disabled = false; btn.textContent = "🔄 Actualizar"; }
  _showUpdateToast("✅ Datos al día");
}

function startLivePoll() {
  if (_livePollTimer) { clearInterval(_livePollTimer); _livePollTimer = null; }

  const interval = _pollIntervalMs();
  if (!interval) { _updateLiveBadge(false); return; }

  _updateLiveBadge(_shouldPollNow());

  _livePollTimer = setInterval(async () => {
    await loadData(true);
    tickBanner();
    const next = _pollIntervalMs();
    if (!next) {
      clearInterval(_livePollTimer);
      _livePollTimer = null;
      _updateLiveBadge(false);
      return;
    }
    if (next !== interval) {
      // Cambia de 60 s (directo) a 5 min (día de partido) o viceversa
      startLivePoll();
    }
  }, interval);
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
    ? [...D.standings].sort((a, b) => (b.total_live || 0) - (a.total_live || 0) || (a.pos || 0) - (b.pos || 0))
    : D.standings;
  const totOf = p => liveActive ? (p.total_live != null ? p.total_live : p.total) : p.total;
  const provTag = p => {
    if (!liveActive) return "";
    if (p.live_points > 0) return `<div class="podium-prov">+${_fmtPts(p.live_points)} en juego</div>`;
    return `<div class="podium-prov" style="visibility:hidden">+0 en juego</div>`;
  };
  const top3 = ranked.slice(0, 3);
  const _posChg = p => {
    if (liveActive) return (p.pos || 0) - (p.live_pos || p.pos || 0);
    return p.pos_change || 0;
  };
  const anyChange = true;  // siempre mostrar indicadores ▲▼=
  const order  = [{ idx: 1, cls: "podium-2nd", medal: "🥈" },
                  { idx: 0, cls: "podium-1st", medal: "🥇" },
                  { idx: 2, cls: "podium-3rd", medal: "🥉" }];

  container.innerHTML = order.map(({ idx, cls, medal }) => {
    const p = top3[idx];
    if (!p) return "";
    const rankLbl = idx === 0 ? "1º" : idx === 1 ? "2º" : "3º";
    const chg = _posChg(p);
    const chgHtml = chg > 0
      ? `<span class="st-pos-up" style="font-size:1.1rem">▲${chg}</span>`
      : chg < 0
        ? `<span class="st-pos-down" style="font-size:1.1rem">▼${Math.abs(chg)}</span>`
        : anyChange ? `<span class="st-pos-eq" style="font-size:1.2rem">=</span>` : "";
    return `
      <div class="podium-col ${cls}${liveActive ? " podium-prov-col" : ""}">
        <div class="podium-player">
          <div class="text-3xl mb-1">${medal}</div>
          <div class="bebas text-2xl tracking-wide" style="color:${p.color}">${p.name} ${chgHtml}</div>
          <div class="podium-score bebas" style="color:${p.color};font-size:1.1rem;opacity:.85">${_fmtPts(totOf(p))} pts${liveActive ? " <span class='prov-tag'>prov.</span>" : ""}</div>
          ${provTag(p)}
        </div>
        <div class="podium-block" aria-label="${rankLbl} puesto">${rankLbl}</div>
      </div>`;
  }).join("");

  const rest = ranked.slice(3);
  restEl.innerHTML = rest.map((p, i) => {
    const chg = _posChg(p);
    const chgHtml = chg > 0
      ? `<span class="st-pos-up" title="Subió ${chg}">▲${chg}</span>`
      : chg < 0
        ? `<span class="st-pos-down" title="Bajó ${Math.abs(chg)}">▼${Math.abs(chg)}</span>`
        : anyChange ? `<span class="st-pos-eq" title="Se mantuvo">=</span>` : "";
    return `
    <div class="card p-3 flex items-center justify-between" style="border-left:3px solid ${p.color}">
      <div>
        <span class="text-xs text-gray-500 font-bold">#${liveActive ? (i + 4) : p.pos}</span>
        <span class="font-bold text-white ml-2">${p.name}</span>${chgHtml}
        ${(liveActive && p.live_points > 0) ? `<span class="rest-prov">+${_fmtPts(p.live_points)} en juego</span>` : ""}
      </div>
      <span class="bebas text-xl rest-pts-block" style="color:${p.color}">${_fmtPts(totOf(p))} <span style="font-size:.75em;opacity:.7">PTS</span>${liveActive ? " <span class='prov-tag'>prov.</span>" : ""}</span>
    </div>`;
  }).join("");
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
    ? `<div class="lsb-matches">${liveMatches.map((m, i) => {
        const safeDate = escapeHtml(m.date || "");
        const safeName = escapeHtml((m.name || "").replace(/'/g, "\\'"));
        return `<button class="lsb-match lsb-match-btn" onclick="goToMatchesDay('${safeDate}','${safeName}')" title="Ir al partido"><span class="live-dot"></span>${names[i]}</button>`;
      }).join("")}</div>`
    : "";
  el.innerHTML = `
    <div class="lsb-head"><span class="lsb-badge">🔴 PROVISIONAL</span>
      <span class="lsb-text">La clasificación incluye los puntos de los partidos <strong>en juego</strong>. Se confirmará al finalizar.</span>
    </div>${list}`;
  el.classList.remove("hidden");
}

function calcLiveMinute(m) {
  // Only return a minute if the API provides a real value (numeric, HT, FT…).
  // "live" means the API doesn't know the minute — we don't estimate it because
  // stoppage time, halftime break (~15 min) and hydration pauses make any
  // wall-clock calculation unreliable by 15-20 minutes.
  const raw = (m.live_minute || "").trim().toLowerCase();
  if (raw && raw !== "live") return m.live_minute;
  return "";
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
    const minute = calcLiveMinute(m);
    const minLabel = minute ? liveMinuteLabel(minute) : "EN JUEGO";
    scoreHtml = `<div class="match-score-big match-score-live">${m.live_goals_l} - ${m.live_goals_v}</div>
      <div class="live-minute-pill"><span class="live-ball">⚽</span> ${minLabel} · EN DIRECTO</div>`;
  } else if (isLive) {
    // Partido en curso pero sin datos de goles aún → mostrar 0-0 provisional
    const liveGoalL = m.live_goals_l ?? 0;
    const liveGoalV = m.live_goals_v ?? 0;
    const minute = calcLiveMinute(m);
    const minLabel = minute ? liveMinuteLabel(minute) : "EN JUEGO";
    scoreHtml = `<div class="match-score-big match-score-live">${liveGoalL} - ${liveGoalV}</div>
      <div class="live-minute-pill"><span class="live-ball">⚽</span> ${minLabel} · EN DIRECTO</div>`;
  } else if (m.time_es) {
    const isNext = _nextMatchId && (m.id === _nextMatchId || m.name === _nextMatchId);
    const calBtnHtml = m.date ? (() => {
      const sn = (m.name || m.id || "").replace(/'/g, "\\'");
      return `<button class="cal-add-btn cal-add-inline" onclick="event.stopPropagation();_showCalPickerForMatch('${sn}',this)" title="Añadir al calendario">📅 Añadir</button>`;
    })() : "";
    if (isNext) {
      scoreHtml = `<div style="margin-top:.4rem;font-size:1.1rem;font-weight:700;color:#64748B;letter-spacing:.03em">${m.time_es}<span style="font-size:.7rem;font-weight:400;margin-left:.3rem;opacity:.7">h</span></div>
        <div id="match-countdown" style="font-family:'Courier New',monospace;font-size:1.2rem;font-weight:900;color:var(--gold);letter-spacing:.06em;margin-top:.3rem">--:--</div>
        ${calBtnHtml ? `<div style="margin-top:.4rem">${calBtnHtml}</div>` : ""}`;
    } else {
      scoreHtml = `<div style="margin-top:.4rem;font-size:1.1rem;font-weight:700;color:#64748B;letter-spacing:.03em">${m.time_es}<span style="font-size:.7rem;font-weight:400;margin-left:.3rem;opacity:.7">h</span></div>
        ${calBtnHtml ? `<div style="margin-top:.4rem">${calBtnHtml}</div>` : ""}`;
    }
  } else {
    scoreHtml = `<div style="margin-top:.4rem;font-size:.85rem;color:#334155;font-weight:600;letter-spacing:.06em;text-transform:uppercase">vs</div>`;
  }
  const rankH = FIFA_RANK[home] ? `FIFA #${FIFA_RANK[home]}` : "";
  const rankA = FIFA_RANK[away] ? `FIFA #${FIFA_RANK[away]}` : "";
  const badgeH = rankH ? `<div class="match-rank-inner home"><span class="match-fifa-rank">${rankH}</span></div>` : "";
  const badgeA = rankA ? `<div class="match-rank-inner away"><span class="match-fifa-rank">${rankA}</span></div>` : "";

  const isPlaceholderTeam = v => !v || /^\d|^Win|^Los|^[A-Z]\d|^[A-Z]{1,2}\d/.test(v) || v.includes("FINAL") || v.includes("puesto");
  const isProv = isPlaceholderTeam(m.home) || isPlaceholderTeam(m.away);
  const provHtml = isProv && !m.played ? `<div class="text-xs font-bold text-orange-500 mb-1 flex items-center justify-center gap-1" style="letter-spacing: 0.05em;"><span style="font-size:14px">⚠️</span> PARTIDO PROVISIONAL</div>` : "";

  return `
    <div class="match-header-center">
      ${provHtml}
      <div class="match-teams-block">
        <div class="match-side-home">
          <div class="match-name-row">
            <span class="match-flag">${fh}</span>
            <span class="match-team-name team-name-btn" data-team="${home.replace(/"/g,'&quot;')}" title="Ver partidos de ${home}">${home}</span>
          </div>
          ${badgeH}
        </div>
        <div class="match-vs-wrap"><span class="match-vs">vs</span></div>
        <div class="match-side-away">
          <div class="match-name-row">
            <span class="match-team-name team-name-btn" data-team="${away.replace(/"/g,'&quot;')}" title="Ver partidos de ${away}">${away}</span>
            <span class="match-flag">${fa}</span>
          </div>
          ${badgeA}
        </div>
      </div>
      ${scoreHtml}
      ${matchScorersHtml(m)}
    </div>`;
}

/* ── Diccionario de transliteración árabe/persa → latín ──────────────────────
   Cubre los jugadores de EGY, KSA, IRN, MAR, TUN, IRQ conocidos en la
   convocatoria oficial FIFA 2026. Se usa en matchScorersHtml para mostrar
   los nombres en caracteres latinos cuando la API los devuelve en árabe/persa.
─────────────────────────────────────────────────────────────────────────────*/
const ARABIC_NAMES = {
  // ── Egipto (EGY) ──
  "محمد هانى":           "Mohamed Hany",
  "محمد هانی":           "Mohamed Hany",
  "امام آشور":           "Emam Ashour",
  "إمام عاشور":          "Emam Ashour",
  "محمد صلاح":           "Mohamed Salah",
  "مصطفى محمد":          "Mostafa Mohamed",
  "مصطفى زيزو":          "Mostafa Zico",
  "محمود تريزيجيه":      "Mahmoud Trezeguet",
  "حمزة المرسي":         "Hamza El Masry",
  "أحمد فتوح":           "Ahmed Fatouh",
  "أحمد زيزو":           "Ahmed Zizo",
  "حمدي فتحي":           "Hamdy Fathy",
  "كريم حافظ":           "Karim Hafez",
  "مروان عطية":          "Marawan Attia",
  "إبراهيم عادل":        "Ibrahim Adel",
  "نبيل إيمان":          "Nabil Eman",
  "محمد علاء":           "Mohamed Alaa",
  "رامي ربيعة":          "Ramy Rabia",
  "هيثم حسن":            "Haissem Hassan",
  "محمود سليمان":        "Mahdy Soliman",
  "محمد بن حمدا":        "Mohamed Ben Hamda",
  "مهند لشين":           "Mohanad Lashin",
  "حسام عبد المجيد":     "Hossam Abdelmaguid",
  "طارق علاء":           "Tarek Alaa",
  "عمر مرموش":           "Omar Marmoush",
  "ياسر إبراهيم":        "Yasser Ibrahim",
  "محمد الشناوي":        "Mohamed Elshenawy",

  // ── Arabia Saudita (KSA) ──
  "ناصر الدوسري":        "Nasser Aldawsari",
  "سالم الدوسري":        "Salem Aldawsari",
  "محمد قاسم":           "Mohamed Qassem",
  "عبدالله الحمدان":     "Abdullah Alhamddan",
  "عبدالإله العمري":     "Abdulelah Alamri",
  "عبدالله العمري":      "Abdallh Alamri",
  "عبدالله الكهيبري":    "Abdullah Alkhaibari",
  "نواف البقيق":         "Nawaf Bu Washl",
  "نواف العقيدي":        "Nawaf Alaqidi",
  "علي الحازم":          "Ali Alhazmn",
  "علي المجرشي":         "Ali Majrashi",
  "فراس البريكان":       "Feras Albrikan",
  "عائض مدخلي":         "Aiman Yahya",
  "أيمن يحيى":          "Aiman Yahya",
  "عصام العويس":         "Mohammed Alowais",
  "سعود عبد الحميد":     "Saud Abdulhamid",
  "مصعب الجويعر":        "Musab Aljuwayr",
  "صالح الشهري":         "Saleh Alshehri",
  "حسن":                 "Hassan",
  "زياد الجوهني":        "Ziyad Aljohani",
  "خالد الغنام":         "Khalid Alghannam",
  "علاء الحاجي":         "Ala Alhajji",
  "سلطان منداش":         "Sultan Mandash",
  "أحمد":                "Ahmed",
  "محمد":                "Mohammed",
  "متعب الهارب":         "Moteb Alharbi",
  "جهاد ذكري":           "Jehad Thikri",
  "محمد أبو الشامات":    "Mohammed Abu Alshamat",

  // ── Irán (IRN) ──
  "مهدی طارمی":          "Mehdi Taremi",
  "مهدی تارمی":          "Mehdi Taremi",
  "علیرضا بیرانوند":     "Alireza Beiranvand",
  "احسان حاجی صفی":     "Ehsan Hajisafi",
  "سعید عزت اللهی":     "Saeid Ezatolahi",
  "علیرضا جهانبخش":     "Alireza Jahanbakhsh",
  "محمد محبی":           "Mohammad Mohebbi",
  "مهدی غایدی":         "Mehdi Ghayedi",
  "سامان قدوس":          "Saman Ghoddos",
  "روزبه چشمی":         "Roozbeh Cheshmi",
  "مهدی ترابی":         "Mehdi Torabi",
  "شجاع خلیل زاده":     "Shoja Khalilzadeh",
  "میلاد محمدی":        "Milad Mohammadi",
  "علی علی پور":        "Ali Alipour",
  "پیام نیازمند":       "Payam Niazmand",
  "حسین کنعانی":        "Hossein Kanani",
  "آریا یوسفی":         "Arya Yousefi",
  "امیرحسین حسین زاده": "Amirhossein Hosseinzadeh",
  "علی نعمتی":          "Ali Nemati",
  "شهریار مقانلو":      "Shahriyar Moghanloo",
  "محمد قربانی":        "Mohammad Ghorbani",
  "حسین حسینی":        "Hossein Hosseini",
  "رامین رضاییان":      "Ramin Rezaeian",
  "صالح هردانی":        "Saleh Hardani",

  // ── Marruecos (MAR) ──
  "ياسين بونو":          "Yassine Bounou",
  "أشرف حكيمي":          "Achraf Hakimi",
  "نصير مزراوي":         "Noussair Mazraoui",
  "صفيان أمرابط":        "Sofyan Amrabat",
  "براهيم دياز":         "Brahim Diaz",
  "أيوب بوادي":          "Ayyoub Bouaddi",
  "عزالدين أوناحي":      "Azzedine Ounahi",
  "أيوب العقابي":        "Ayoub El Kaabi",
  "بلال الخنوس":         "Bilal El Khannouss",
  "زكريا الواهدي":       "Zakaria El Ouahdi",
  "إسماعيل الصيبري":     "Ismael Saibari",
  "نيل الطبيب":          "Neil El Aynaoui",
  "أنس صلاح الدين":      "Anass Salah Eddine",
  "ردوان هلال":          "Redouane Halhal",

  // ── Túnez (TUN) ──
  "إلياس سعد":           "Elias Saad",
  "إلياس عشوري":         "Elias Achouri",
  "حازم مستوري":         "Hazem Mastouri",
  "حنيبال مجبري":        "Hannibal Mejbri",
  "إسماعيل غربي":        "Ismael Gharbi",
  "رني حديرة":           "Rani Khedira",
  "إليس سخيري":          "Ellyes Skhiri",
  "أيمن الدهماني":       "Aymen Dahmen",
  "محمد بن حمدة":        "Mohamed Hadj Mahmoud",
  "أنيس سليمان":         "Anis Slimane",
  "فيراس شاوات":         "Firas Chaouat",

  // ── Irak (IRQ) ──
  "أيمن":                "Aymen",
  "جلال حسن":            "Jalal Hassan",
  "علي يوسف":            "Ali Yousif",
  "أحمد مكنزي":          "Ahmed Maknazi",
  "أمير العماري":        "Amir Alammari",
  "علي جاسم":            "Ali Jasim",
  "مناف يونس":           "Munaf Younus",
  "يوسف أمين":           "Youssef Amyn",
  "إبراهيم بييش":        "Ibrahim Bayesh",
  "علي الحمادي":         "Ali Alhamadi",
  "مهند علي":            "Mohanad Ali",
  "زيدان":               "Zidane",
  "ريبين سولاكا":        "Rebin Sulaka",
  "زيد إسماعيل":        "Zaid Ismael",
};

/** Traduce un nombre árabe/persa si existe en el diccionario, si no lo deja como está */
function _translateArabicName(name) {
  return ARABIC_NAMES[name] || ARABIC_NAMES[name.trim()] || name;
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
    // Traducir nombre árabe/persa si hay entrada en el diccionario
    const playerName = _translateArabicName(s.player || "");
    const isArabic = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/.test(playerName);
    const dirAttr = isArabic ? ' dir="rtl"' : '';
    const nameClass = "ms-name player-link-btn" + (isOG ? " ms-og" : "") + (isArabic ? " ms-name-ar" : "");
    const name  = `<button class="${nameClass}"${dirAttr} data-player="${escapeHtml(playerName)}">${escapeHtml(playerName)}${ogTag}${penTag}</button>`;
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
  // Botón añadir al calendario — eliminado de aqui, ahora va junto a la hora en matchTeamsHtml
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
  const anyTblChange = true;  // siempre mostrar indicadores ▲▼=
  tbody.innerHTML = rows.map(r => {
    const medal = r.pos <= 3 ? MEDAL[r.pos - 1] + " " : "";
    const provBadge = (liveActive && r.live_points > 0)
      ? ` <span class="prov-tag">prov.</span>` : "";
    const chg = r.pos_change;
    const chgHtml = chg > 0
      ? `<span class="st-pos-up" title="Subió ${chg}">▲${chg}</span>`
      : chg < 0
        ? `<span class="st-pos-down" title="Bajó ${Math.abs(chg)}">▼${Math.abs(chg)}</span>`
        : anyTblChange ? `<span class="st-pos-eq" title="Se mantuvo">=</span>` : "";
    return `<tr${liveActive ? ' class="st-prov-row"' : ""}>
      <td class="font-bold" style="color:${r.color}">${r.pos}</td>
      <td class="text-left font-semibold text-white">${medal}${r.name} ${chgHtml}</td>
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
      pos_change: liveActive ? ((+p.pos || 0) - (+p.live_pos || +p.pos || 0)) : (p.pos_change || 0),
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

  // Apply window filter: show last _progWindow matches (0 = all)
  const totalPlayed = cutIdx + 1;
  const winStart = (_progWindow > 0 && _progWindow < totalPlayed) ? totalPlayed - _progWindow : 0;

  const labels = allFlagLabels.slice(winStart, cutIdx + 1);
  const dates  = allDates.slice(winStart, cutIdx + 1);
  const titles = allTitles.slice(winStart, cutIdx + 1);

  // ── Window selector UI ────────────────────────────────────
  const WIN_OPTS = [5, 10, 15, 0]; // 0 = Todos
  const winRow = document.getElementById("prog-window-row");
  if (winRow) {
    winRow.innerHTML = WIN_OPTS.map(w => {
      const lbl    = w === 0 ? "Todos" : String(w);
      const active = (w === _progWindow) || (w === 0 && _progWindow === 0);
      return `<button class="prog-win-btn${active ? " prog-win-active" : ""}" data-win="${w}">${lbl}</button>`;
    }).join("");
    winRow.querySelectorAll(".prog-win-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        _progWindow = +btn.dataset.win;
        renderProgression();
      });
    });
  }

  // Different dash patterns so overlapping lines (tied players) are always distinguishable
  const DASHES = [[], [8,4], [4,4], [12,4,4,4], [5,2,2,2], [2,2]];
  const POINT_STYLES = ["circle","triangle","rect","rectRot","star","cross"];

  const datasets = players.map((name, idx) => ({
    label: name,
    data:  ((prog.players && prog.players[name]) || []).slice(winStart, cutIdx + 1),
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

  // ── Live banner for progression ──
  const liveActive = _liveStandingsActive();
  const progLiveBanner = document.getElementById("prog-live-banner");
  if (progLiveBanner) {
    if (liveActive) {
      const liveMs = (D.matches || []).filter(m => !m.played && m.live);
      const liveLinks = liveMs.map(m => {
        const safeDate = escapeHtml(m.date || "");
        const safeName = escapeHtml((m.name || "").replace(/'/g, "\\'"));
        const label = `${m.flag_home || ""} ${m.home || ""} - ${m.away || ""} ${m.flag_away || ""}`.trim();
        return `<button class="upd-live-match-btn" onclick="goToMatchesDay('${safeDate}','${safeName}')" title="Ir al partido" style="font-size:.78rem">${label}</button>`;
      });
      const matchWord = liveMs.length !== 1 ? "partidos" : "partido";
      progLiveBanner.innerHTML = `<span class="standings-prov-badge">🔴 PROVISIONAL</span> Hay ${liveMs.length} ${matchWord} en juego (${liveLinks.join(", ")}). Los datos incluyen puntos provisionales.`;
      progLiveBanner.classList.remove("hidden");
    } else {
      progLiveBanner.innerHTML = "";
      progLiveBanner.classList.add("hidden");
    }
  }

  // If live, add a provisional point at the end of each dataset
  if (liveActive) {
    const provLabel = "🔴 En juego";
    labels.push(provLabel);
    datasets.forEach(ds => {
      const lastVal = ds.data.length > 0 ? ds.data[ds.data.length - 1] : 0;
      const player = D.standings.find(s => s.name === ds.label);
      const lp = player ? (+player.live_points || 0) : 0;
      ds.data.push(lastVal + lp);
    });
    // Style provisional segment with dashes
    datasets.forEach(ds => {
      const origLen = ds.data.length - 1;
      ds.segment = {
        borderDash: ctx => ctx.p1DataIndex >= origLen - 1 ? [5, 4] : ds.borderDash,
      };
      // Make last point distinctive
      ds.pointBackgroundColor = ds.data.map((_, i) =>
        i === ds.data.length - 1 ? (ds.borderColor + "88") : ds.borderColor
      );
    });
  }

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
              const absIdx = winStart + i; // map sliced index back to full array
              const dayPts = prog.day_points?.[items[0].dataset.label]?.[absIdx];
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
    const lp = liveActive ? (+p.live_points || 0) : 0;
    const liveLine = lp > 0
      ? `<div class="text-xs font-bold" style="color:#FCA5A5">+${_fmtPts(lp)} en juego <span class="prov-tag">prov.</span></div>`
      : "";
    return `
      <div class="card p-4" style="border-color:${p.color}44">
        <div class="pstat-head mb-3">
          <div class="pstat-bar" style="background:${p.color}"></div>
          <div>
            <div class="font-extrabold text-white text-lg uppercase">${p.name}</div>
            <div class="text-xs text-gray-400">#${p.pos}</div>
          </div>
        </div>
        <div class="text-center">
          <div class="bebas text-3xl" style="color:${p.color}">${liveActive ? last + lp : last}</div>
          <div class="text-xs text-gray-500 mb-1">${liveActive ? "acumulado (prov.)" : "acumulado"}</div>
          <div class="prog-deltas mb-2">
            <div class="text-xs font-bold" style="${deltaCls(matchDelta)}">+${matchDelta} último partido</div>
            <div class="text-xs font-bold" style="${deltaCls(dayDelta)}">+${dayFmt} último día</div>
            ${liveLine}
          </div>
          <div class="score-bar-wrap mb-2">
            <div class="score-bar" style="background:${p.color};width:${pct}%"></div>
          </div>
          <div class="text-xs text-gray-400">~${avg} pts/partido</div>
        </div>
      </div>`;
  }).join("");

  renderForma(prog, cutIdx);
}

function renderForma(prog, cutIdx) {
  const el = document.getElementById("prog-forma");
  if (!el || !D) return;

  // ordenar por clasificación actual (pos ascendente)
  const standings = D.standings || [];
  const players = standings.length
    ? [...standings].sort((a, b) => (a.pos ?? 99) - (b.pos ?? 99)).map(s => s.name)
    : D.meta.players;
  const colors  = D.meta.colors;
  const maxPerMatch = +(D.scoring_rules?.max_per_group_match || 6);
  const allDayPts = prog.day_points || {};
  const allLabels = (prog.labels  || []).slice(0, cutIdx + 1);
  const allTitles = (prog.titles  || []).slice(0, cutIdx + 1);

  const N = 6;
  const startIdx = Math.max(0, cutIdx + 1 - N);
  const last5Labels = allLabels.slice(startIdx);
  const last5Titles = allTitles.slice(startIdx);
  const shown = last5Labels.length;
  if (shown === 0) { el.innerHTML = ""; return; }

  function _formaInfo(pts) {
    if (!pts.length) return { icon: "—", text: "Sin datos", col: "#64748B" };
    const last = pts.at(-1);
    let streak = 0;
    for (let i = pts.length - 1; i >= 0; i--) { if (pts[i] > 0) streak++; else break; }
    const sum3 = pts.slice(-3).reduce((a, b) => a + b, 0);
    if (streak >= 4)       return { icon: "🔥", text: `Racha de ${streak}`, col: "#F5C518" };
    if (last >= maxPerMatch) return { icon: "🥇", text: "¡Exacto!", col: "#F5C518" };
    if (last >= 3 && streak >= 2) return { icon: "🔥", text: `Racha ${streak}`, col: "#22C55E" };
    if (last >= 3)         return { icon: "📈", text: "Última buena", col: "#22C55E" };
    if (last >= 1)         return { icon: "✅", text: "Puntuó el último", col: "#84CC16" };
    if (sum3 === 0)        return { icon: "❄️", text: "En blanco", col: "#94A3B8" };
    return { icon: "📉", text: "Irregular", col: "#F59E0B" };
  }

  function _dotStyle(pts) {
    if (pts >= maxPerMatch) return { bg: "#F5C51828", border: "#F5C518", text: "#F5C518" };
    if (pts >= 3)           return { bg: "#22C55E28", border: "#22C55E", text: "#22C55E" };
    if (pts >= 1)           return { bg: "#F59E0B28", border: "#F59E0B", text: "#F59E0B" };
    return                         { bg: "#EF444418", border: "#EF444455", text: "#EF4444" };
  }

  function _sparkSvg(pts, color) {
    const n = pts.length; if (n === 0) return "";
    const W=100, H=42, pL=5, pR=5, pT=9, pB=5;
    const iW = W-pL-pR, iH = H-pT-pB;
    const xs = pts.map((_, i) => pL + (n === 1 ? iW/2 : (i/(n-1))*iW));
    const ys = pts.map(v  => pT + iH - (Math.min(+v,maxPerMatch)/maxPerMatch)*iH);
    const path = xs.map((x,i) => `${i===0?"M":"L"}${x.toFixed(1)} ${ys[i].toFixed(1)}`).join(" ");
    const fill = `${path} L${xs.at(-1).toFixed(1)} ${pT+iH} L${pL} ${pT+iH} Z`;
    const dots = xs.map((x,i) => {
      const c = pts[i] > 0 ? color : "#EF4444";
      const r = pts[i] >= maxPerMatch ? 4.5 : pts[i] > 0 ? 3.5 : 3;
      return `<circle cx="${x.toFixed(1)}" cy="${ys[i].toFixed(1)}" r="${r}" fill="${c}" stroke="#0F172A" stroke-width="1.5"/>`;
    }).join("");
    return `<svg viewBox="0 0 ${W} ${H}" fill="none" xmlns="http://www.w3.org/2000/svg" class="forma-spark-svg">
      <path d="${fill}" fill="${color}28"/>
      <path d="${path}" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      ${dots}
    </svg>`;
  }

  const cards = players.map(name => {
    const color   = colors[name];
    const stand   = standings.find(s => s.name === name) || {};
    const allPts  = (allDayPts[name] || []).slice(0, cutIdx + 1);
    const last5   = allPts.slice(startIdx);
    const _fLA    = _liveStandingsActive();
    const lp      = _fLA ? (+stand.live_points || 0) : 0;
    const sum5    = last5.reduce((a, b) => a + b, 0) + lp;
    const formaArr = _fLA ? [...last5, lp] : last5;
    const forma   = _formaInfo(formaArr);
    const spark   = _sparkSvg(formaArr, color);

    let dotsHtml = last5.map((pts, i) => {
      const dc    = _dotStyle(pts);
      const title = escapeHtml(last5Titles[i] || "");
      const lbl   = escapeHtml(last5Labels[i] || "");
      const ptsStr = pts > 0 ? (pts % 1 === 0 ? String(pts) : pts.toFixed(1)) : "0";
      return `<div class="forma-dot-wrap" title="${title}">
        <div class="forma-dot" style="background:${dc.bg};border-color:${dc.border};color:${dc.text}">${ptsStr}</div>
        <div class="forma-dot-lbl">${lbl}</div>
      </div>`;
    }).join("");

    // Dot provisional si hay partido en curso
    if (_fLA) {
      const dc = _dotStyle(lp);
      const ptsStr = lp % 1 === 0 ? String(lp) : lp.toFixed(1);
      dotsHtml += `<div class="forma-dot-wrap" title="En juego (provisional)">
        <div class="forma-dot forma-dot-prov" style="background:${dc.bg};border-color:${dc.border};color:${dc.text}">${ptsStr}</div>
        <div class="forma-dot-lbl" style="color:#FCA5A5">🔴</div>
      </div>`;
    }

    // heat bar: sum5 / (shown * maxPerMatch)
    const shownTotal = _fLA ? shown + 1 : shown;
    const heatPct = Math.round((sum5 / (shownTotal * maxPerMatch)) * 100);

    return `<div class="forma-card" style="--fcolor:${color}">
      <div class="forma-card-head">
        <div class="forma-name-row">
          <div class="forma-color-dot" style="background:${color}"></div>
          <span class="forma-name">${escapeHtml(name)}</span>
        </div>
        <div class="forma-meta">#${stand.pos ?? "—"} · <span class="bebas" style="color:${color};font-size:.95rem">${_fLA ? (stand.total || 0) + lp : (stand.total ?? 0)}</span> pts${_fLA ? " <span class='prov-tag'>prov.</span>" : " total"}</div>
      </div>
      <div class="forma-heat-wrap" title="Rendimiento: ${heatPct}% de puntos posibles en últimos ${shown}">
        <div class="forma-heat-bar" style="width:${heatPct}%;background:${color}"></div>
      </div>
      <div class="forma-spark">${spark}</div>
      <div class="forma-dots-row">${dotsHtml}</div>
      <div class="forma-footer">
        <span class="forma-badge" style="color:${forma.col}">${forma.icon} ${forma.text}</span>
        <span class="forma-sum" title="Puntos en últimos ${shown} partidos">+${sum5} pts</span>
      </div>
    </div>`;
  }).join("");

  const formaLiveActive = _liveStandingsActive();
  let formaLiveBanner = "";
  if (formaLiveActive) {
    const fLiveMs = (D.matches || []).filter(m => !m.played && m.live);
    const fLiveLinks = fLiveMs.map(m => {
      const safeDate = escapeHtml(m.date || "");
      const safeName = escapeHtml((m.name || "").replace(/'/g, "\\'"));
      const label = `${m.flag_home || ""} ${m.home || ""} - ${m.away || ""} ${m.flag_away || ""}`.trim();
      return `<button class="upd-live-match-btn" onclick="goToMatchesDay('${safeDate}','${safeName}')" title="Ir al partido" style="font-size:.78rem">${label}</button>`;
    });
    formaLiveBanner = `<div class="live-standings-banner mb-3" style="font-size:.78rem;padding:.35rem .7rem"><span class="standings-prov-badge">🔴 PROVISIONAL</span> Incluye puntos del partido en juego (${fLiveLinks.join(", ")})</div>`;
  }

  el.innerHTML = `
    <div class="flex items-center gap-3 mb-1 flex-wrap">
      <h3 class="font-bold text-white text-lg">🌡️ Termómetro de forma</h3>
      <span class="text-xs text-gray-500 font-semibold uppercase tracking-wide">Últimos ${shown} partido${shown !== 1 ? 's' : ''}</span>
    </div>
    ${formaLiveBanner}
    <p class="text-sm text-gray-400 mb-4">
      Rendimiento reciente de cada jugador partido a partido.
      <span class="forma-legend-item" style="color:#F5C518">⬤ exacto (${maxPerMatch}p)</span>
      <span class="forma-legend-item" style="color:#22C55E">⬤ ≥3p</span>
      <span class="forma-legend-item" style="color:#F59E0B">⬤ 1-2p</span>
      <span class="forma-legend-item" style="color:#EF4444">⬤ 0p</span>
    </p>
    <div class="forma-grid">${cards}</div>`;
}

/* ─── MATCHES ─── */
function renderMatches(phase, week) {
  const list = document.getElementById("matches-list");
  
  // Solo mostrar fases que representen partidos reales de fútbol (excluyendo predicciones de posiciones/clasificados)
  const isRealMatch = m => m.phase !== "positions" && m.phase !== "q16" && m.date && m.date.startsWith("2026-");
  
  let filtered = phase === "all" 
    ? D.matches.filter(isRealMatch) 
    : D.matches.filter(m => m.phase === phase && isRealMatch(m));

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

/* ═══════════════════════════════════════════════════════════════
   ADD TO CALENDAR (ICS / Google Calendar)
   Genera ficheros .ics client-side, sin dependencias.
   Timezone: Europe/Madrid (CEST verano UTC+2, CET invierno UTC+1).
   Compatible con: iOS Calendario, Android Google Calendar,
   Outlook, Apple Calendar, Thunderbird y todos los navegadores.
═══════════════════════════════════════════════════════════════ */

// VTIMEZONE block para Europe/Madrid — necesario para RFC 5545 completo
const _ICS_VTIMEZONE = [
  "BEGIN:VTIMEZONE",
  "TZID:Europe/Madrid",
  "BEGIN:STANDARD",
  "DTSTART:19701025T030000",
  "RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10",
  "TZOFFSETFROM:+0200",
  "TZOFFSETTO:+0100",
  "TZNAME:CET",
  "END:STANDARD",
  "BEGIN:DAYLIGHT",
  "DTSTART:19700329T020000",
  "RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3",
  "TZOFFSETFROM:+0100",
  "TZOFFSETTO:+0200",
  "TZNAME:CEST",
  "END:DAYLIGHT",
  "END:VTIMEZONE",
].join("\r\n");

// "2026-06-15" + "19:00" → "20260615T190000"
function _icsLocalDt(dateStr, timeStr) {
  return dateStr.replace(/-/g, "") + "T" + (timeStr || "00:00").replace(":", "") + "00";
}

// Genera el bloque VEVENT de un partido (2 h de duración)
function _icsEvent(m) {
  const date = (m.date || "").slice(0, 10);
  const time = m.time_es || "00:00";
  if (!date || date.length < 10) return "";
  const [hh, mm] = time.split(":").map(Number);
  const endHH = String(hh + 2).padStart(2, "0");
  const endTime = `${endHH}:${String(mm).padStart(2, "0")}`;
  const dtStart = _icsLocalDt(date, time);
  const dtEnd   = _icsLocalDt(date, endTime);
  const home = m.home || "Local";
  const away = m.away || "Visitante";
  const phase = PHASE_LABELS[m.phase] || m.phase || "Mundial 2026";
  const uid = `match-${(m.id || m.name || date).replace(/[^a-z0-9]/gi, "-")}@porra-nanos-2026`;
  const isPlaceholderTeam = v => !v || /^\d|^Win|^Los|^[A-Z]\d|^[A-Z]{1,2}\d/.test(v) || v.includes("FINAL") || v.includes("puesto");
  const isProv = isPlaceholderTeam(m.home) || isPlaceholderTeam(m.away);
  const provText = isProv ? " (PROVISIONAL)" : "";
  const summary = `${(m.flag_home || "")}${home} vs ${(m.flag_away || "")}${away}${provText}`;
  const desc = `Mundial FIFA 2026 · ${phase}\\nHora España: ${time}h\\nPorra «Los Nanos»`;
  return [
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTART;TZID=Europe/Madrid:${dtStart}`,
    `DTEND;TZID=Europe/Madrid:${dtEnd}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${desc}`,
    `LOCATION:${m.city ? `${m.city}, ${m.country || ""}` : "Mundial 2026"}`,
    "END:VEVENT",
  ].join("\r\n");
}

// Genera el ICS completo para un array de partidos
function _generateIcs(matches) {
  const events = matches.map(_icsEvent).filter(Boolean).join("\r\n");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Porra Los Nanos//Mundial 2026//ES",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Mundial 2026 – Porra Los Nanos",
    "X-WR-TIMEZONE:Europe/Madrid",
    _ICS_VTIMEZONE,
    events,
    "END:VCALENDAR",
  ].join("\r\n");
}

// Descarga el ICS o lo abre en nueva pestaña (fallback iOS Safari)
function _downloadIcs(icsText, filename) {
  const blob = new Blob([icsText], { type: "text/calendar;charset=utf-8" });
  const url  = URL.createObjectURL(blob);
  // iOS Safari no admite el atributo download en blobs — abre en nueva pestaña
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  if (isIos) {
    window.open(url, "_blank");
  } else {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// URL de Google Calendar para un partido (alternativa online)
function _googleCalUrl(m) {
  const date = (m.date || "").slice(0, 10);
  const time = m.time_es || "00:00";
  if (!date) return "";
  const [hh, mm] = time.split(":").map(Number);
  // Google Calendar usa UTC; CEST = UTC+2 en verano
  const startUtcH = hh - 2;
  const start = date.replace(/-/g, "") + "T" + String(startUtcH < 0 ? startUtcH + 24 : startUtcH).padStart(2, "0") + String(mm).padStart(2, "0") + "00Z";
  const endUtcH = startUtcH + 2;
  const end   = date.replace(/-/g, "") + "T" + String(endUtcH).padStart(2, "0") + String(mm).padStart(2, "0") + "00Z";
  const home = m.home || "Local";
  const away = m.away || "Visitante";
  const text = encodeURIComponent(`${(m.flag_home||"")}${home} vs ${(m.flag_away||"")}${away} · Mundial 2026`);
  const details = encodeURIComponent(`Porra «Los Nanos» · Hora España: ${time}h`);
  const loc = encodeURIComponent(m.city ? `${m.city}, ${m.country || ""}` : "Mundial 2026");
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${text}&dates=${start}/${end}&details=${details}&location=${loc}`;
}

// Botón individual de añadir al calendario (partido sin jugar)
function addMatchToCalendar(matchName) {
  const m = (D.matches || []).find(x => x.name === matchName || x.id === matchName);
  if (!m) return;
  _downloadIcs(_generateIcs([m]), `partido-${(m.id || matchName).replace(/\s+/g, "-").toLowerCase()}.ics`);
}

// Todos los partidos pendientes
function addAllMatchesToCalendar() {
  const pending = (D.matches || []).filter(m => !m.played && m.date && m.date.startsWith("2026-") && m.time_es);
  if (!pending.length) { alert("No hay partidos pendientes."); return; }
  _downloadIcs(_generateIcs(pending), "mundial-2026-pendientes.ics");
}

/* ── Popover selector de calendario ── */
let _calPickerEl = null;

function _hideCalPicker() {
  if (_calPickerEl) {
    _calPickerEl.remove();
    _calPickerEl = null;
    document.removeEventListener("click", _calPickerOutside);
    document.removeEventListener("keydown", _calPickerKey);
  }
}
function _calPickerOutside(e) {
  if (_calPickerEl && !_calPickerEl.contains(e.target)) _hideCalPicker();
}
function _calPickerKey(e) {
  if (e.key === "Escape") _hideCalPicker();
}

// matches: array de partidos; filename: nombre del .ics; btnEl: botón que lo dispara
function _showCalPicker(matches, filename, btnEl) {
  _hideCalPicker();
  const isSingle = matches.length === 1;
  const gcUrl = isSingle ? _googleCalUrl(matches[0]) : null;

  const picker = document.createElement("div");
  picker.className = "cal-picker";
  picker.innerHTML = `
    <div class="cal-picker-title">Añadir al calendario</div>
    <button class="cal-picker-opt" id="_cpGoogle">
      <span class="cal-picker-icon">&#x1F4C6;</span>
      <span>Google Calendar</span>
    </button>
    <button class="cal-picker-opt" id="_cpApple">
      <span class="cal-picker-icon">&#x1F34E;</span>
      <span>Apple / Otros (ICS)</span>
    </button>
  `;
  document.body.appendChild(picker);
  _calPickerEl = picker;

  // Posicionar cerca del botón; en móvil se centra horizontalmente
  const rect = btnEl.getBoundingClientRect();
  const pw = 220, ph = 130;
  const isMobileVp = window.innerWidth <= 480;
  if (isMobileVp) {
    picker.style.left = "50%";
    picker.style.transform = "translateX(-50%)";
    // arriba o abajo del botón
    let top = rect.bottom + 6;
    if (top + ph > window.innerHeight - 8) top = rect.top - ph - 6;
    if (top < 8) top = 8;
    picker.style.top = top + "px";
  } else {
    let left = rect.left;
    let top  = rect.bottom + 6;
    if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
    if (left < 8) left = 8;
    if (top + ph > window.innerHeight - 8) top = rect.top - ph - 6;
    picker.style.left = left + "px";
    picker.style.top  = top  + "px";
  }

  // Google Calendar
  picker.querySelector("#_cpGoogle").addEventListener("click", () => {
    if (gcUrl) {
      window.open(gcUrl, "_blank", "noopener");
    } else {
      // Múltiples partidos: descarga ICS e indica cómo importar
      _downloadIcs(_generateIcs(matches), filename);
      setTimeout(() => alert("¿Cómo importar en Google Calendar?\n\n1. Abre Google Calendar en PC\n2. Ajustes (⚙️) → Importar\n3. Selecciona el archivo .ics recién descargado"), 400);
    }
    _hideCalPicker();
  });

  // Apple / ICS
  picker.querySelector("#_cpApple").addEventListener("click", () => {
    _downloadIcs(_generateIcs(matches), filename);
    _hideCalPicker();
  });

  setTimeout(() => {
    document.addEventListener("click", _calPickerOutside);
    document.addEventListener("keydown", _calPickerKey);
  }, 10);
}

function _showCalPickerForMatch(matchName, btnEl) {
  const m = (D.matches || []).find(x => x.name === matchName || x.id === matchName);
  if (!m) return;
  _showCalPicker([m], `partido-${(m.id || matchName).replace(/\s+/g, "-").toLowerCase()}.ics`, btnEl);
}

function _showCalPickerForAll(btnEl) {
  const pending = (D.matches || []).filter(m =>
    !m.played && m.date && m.date.startsWith("2026-") && m.time_es
  );
  if (!pending.length) { alert("No hay partidos pendientes con fecha definida."); return; }
  _showCalPicker(pending, "mundial-2026-pendientes.ics", btnEl);
}

function renderMatchCard(m, players, colors) {
  const isLiveMatch = !m.played && ((m.live === true) || (_liveMatchIds && _liveMatchIds.has(m.name)));
  const hasLiveScoreCard = !m.played && m.live && m.live_goals_l != null && m.live_goals_v != null;
  const playedClass = m.played ? "played" : "";
  const liveClass = isLiveMatch ? " live-match" : "";
  const isNextMatch = !m.played && !isLiveMatch && _nextMatchId && (m.id === _nextMatchId || m.name === _nextMatchId);

  const playerCards = players.map(name => {
    const pd = m.predictions?.[name];
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
        ${isNextMatch ? `<div class="card-corner-tag"><span class="text-xs font-bold next-match-tag">⏱ Próximo partido</span></div>` : (m.played ? `<div class="card-corner-tag"><span class="text-xs font-bold finished-tag">✓ Finalizado</span></div>` : "<div class=\"card-corner-tag\"></div>")}
        <div class="card-corner-center">${m.highlights_video_id ? `<button class="match-hl-btn" onclick="openHighlightsModal('${escapeHtml(m.highlights_video_id)}',event)" title="Ver resumen del partido">🎬 Ver resumen</button>` : ""}</div>
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

/* ── Highlights video modal ─────────────────────────────────────────── */
function openHighlightsModal(videoId, evt) {
  if (evt) { evt.stopPropagation(); evt.preventDefault(); }
  document.getElementById('hl-video-modal')?.remove();
  document.getElementById('hl-modal-box')?.remove();

  const vid   = escapeHtml(videoId);
  const ytUrl = `https://www.youtube.com/watch?v=${vid}`;
  const vw    = window.innerWidth;
  const boxW  = Math.min(860, vw - 32);

  // Backdrop
  const overlay = document.createElement('div');
  overlay.id = 'hl-video-modal';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:99998;background:rgba(0,0,0,.88);pointer-events:auto;';
  overlay.addEventListener('click', () => closeHighlightsModal());

  // Modal box — transform centering, reliable across all viewports & scroll positions
  const box = document.createElement('div');
  box.id = 'hl-modal-box';
  box.className = 'hl-modal-box';
  box.style.cssText = `position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:${boxW}px;z-index:99999;border-radius:12px;overflow:hidden;background:var(--card);border:1px solid var(--border);box-shadow:0 24px 80px rgba(0,0,0,.8);`;
  box.innerHTML = `
    <div class="hl-modal-header">
      <span class="hl-modal-title">🎬 Resumen oficial &nbsp;<span class="hl-dazn-badge">DAZN</span></span>
      <div style="display:flex;align-items:center;gap:.5rem;flex-shrink:0;">
        <a href="${escapeHtml(ytUrl)}" target="_blank" rel="noopener noreferrer"
           onclick="event.stopPropagation()" title="Ver en YouTube"
           style="display:inline-flex;align-items:center;gap:.3rem;color:#94A3B8;font-size:.72rem;font-weight:600;text-decoration:none;padding:.2rem .5rem;border-radius:6px;border:1px solid rgba(148,163,184,.25);white-space:nowrap;">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M10 6v2H5v11h11v-5h2v6a1 1 0 01-1 1H4a1 1 0 01-1-1V7a1 1 0 011-1h6zm11-3v8h-2V6.413l-7.793 7.794-1.414-1.414L17.585 5H13V3h8z"/></svg>
          YouTube
        </a>
        <button class="hl-modal-close" onclick="closeHighlightsModal()" aria-label="Cerrar">✕</button>
      </div>
    </div>
    <div style="position:relative;width:100%;padding-top:56.25%;background:#000;overflow:hidden;border-radius:0 0 12px 12px;">
      <iframe
        id="hl-modal-iframe"
        src="https://www.youtube-nocookie.com/embed/${vid}?rel=0&modestbranding=1&playsinline=1&enablejsapi=1&origin=${encodeURIComponent(location.origin)}"
        style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;display:block;pointer-events:auto;"
        allow="autoplay; accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
        allowfullscreen
        playsinline
        webkit-playsinline
        loading="eager"
        title="Resumen partido">
      </iframe>
    </div>`;

  document.addEventListener('keydown', function _hlEsc(e) {
    if (e.key === 'Escape') { closeHighlightsModal(); document.removeEventListener('keydown', _hlEsc); }
  });
  document.body.appendChild(overlay);
  document.body.appendChild(box);
  document.body.style.overflow = 'hidden';
}

function closeHighlightsModal() {
  const iframe = document.getElementById('hl-modal-iframe');
  if (iframe) iframe.src = '';
  document.getElementById('hl-modal-box')?.remove();
  document.getElementById('hl-video-modal')?.remove();
  if (!document.getElementById('match-detail-drawer')?.classList.contains('open')) {
    document.body.style.overflow = '';
  }
}

function _openStadiumLightbox(wrap) {
  const src     = wrap.dataset.src;
  const caption = wrap.dataset.caption || "";
  if (!src) return;
  const lb = document.createElement("div");
  lb.id = "stadium-lightbox";
  lb.innerHTML = `<img src="${escapeHtml(src)}" alt="${escapeHtml(caption)}">${caption ? `<div id="stadium-lightbox-caption">${escapeHtml(caption)}</div>` : ""}`;
  lb.addEventListener("click", () => lb.remove());
  document.addEventListener("keydown", function esc(e) {
    if (e.key === "Escape") { lb.remove(); document.removeEventListener("keydown", esc); }
  });
  document.body.appendChild(lb);
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
      html += `<div class="stadium-photo-wrap" onclick="_openStadiumLightbox(this)" data-src="${escapeHtml(wikiImg)}" data-caption="${escapeHtml(m.stadium || '')}">
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

/* ─── STATS helpers: tabla paginada ─── */
const _matchTableState = {};

function _buildMatchRowHtml(row, globalIndex, MAX_PTS) {
  const MEDAL = ["🥇", "🥈", "🥉"];
  const ptColor = pts => pts >= 5 ? "#22C55E" : pts >= 3 ? "#EAB308" : pts >= 1 ? "#F97316" : "#374151";
  const { m, byPlayer, totalPts } = row;
  const pct    = Math.round(totalPts / MAX_PTS * 100);
  const medal  = globalIndex < 3 ? MEDAL[globalIndex] : `${globalIndex + 1}`;
  const score  = m.goals_l != null
    ? `<span class="font-bold" style="color:var(--gold)">${m.goals_l}–${m.goals_v}</span>`
    : "";
  const playerCells = byPlayer.map(p =>
    `<td class="text-center font-bold" style="color:${ptColor(p.pts)}">${p.pts}</td>`
  ).join("");
  const evenBg = globalIndex % 2 === 1 ? "background:rgba(255,255,255,.02)" : "";
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
}

function _initMatchTable(containerId, matchRows, title, subtitle, MAX_PTS, playerCols, step) {
  step = step || 5;
  const allRowHtml = matchRows.map((row, i) => _buildMatchRowHtml(row, i, MAX_PTS));
  _matchTableState[containerId] = { rowHtml: allRowHtml, shown: step, step };
  const el = document.getElementById(containerId);
  if (!el) return;
  const firstHtml  = allRowHtml.slice(0, step).join("");
  const remaining  = allRowHtml.length - step;
  const moreBtnHtml = remaining > 0
    ? `<div id="${containerId}-more" class="px-4 py-3 border-t text-center" style="border-color:var(--border)">
        <button class="ver-mas-btn" onclick="loadMoreMatchRows('${containerId}')">Ver ${Math.min(step, remaining)} más ↓</button>
       </div>`
    : "";
  el.innerHTML = `
    <div class="card overflow-hidden mb-4">
      <div class="px-6 py-4 border-b" style="border-color:var(--border)">
        <h2 class="text-lg font-bold text-white">${title}</h2>
        <p class="text-xs text-gray-400 mt-1">${subtitle}</p>
      </div>
      <div class="overflow-x-auto">
        <table class="pred-table w-full">
          <thead><tr><th>#</th><th class="text-left">Partido</th><th>Pts totales</th>${playerCols}</tr></thead>
          <tbody id="${containerId}-tbody">${firstHtml}</tbody>
        </table>
      </div>
      ${moreBtnHtml}
    </div>`;
}

function loadMoreMatchRows(containerId) {
  const state = _matchTableState[containerId];
  if (!state) return;
  const { rowHtml, step } = state;
  const prevShown = state.shown;
  const newShown  = Math.min(prevShown + step, rowHtml.length);
  state.shown = newShown;
  const tbody = document.getElementById(containerId + "-tbody");
  if (tbody) tbody.insertAdjacentHTML("beforeend", rowHtml.slice(prevShown, newShown).join(""));
  const moreDiv = document.getElementById(containerId + "-more");
  if (moreDiv) {
    const remaining = rowHtml.length - newShown;
    if (remaining <= 0) {
      moreDiv.remove();
    } else {
      const btn = moreDiv.querySelector("button");
      if (btn) btn.textContent = `Ver ${Math.min(step, remaining)} más ↓`;
    }
  }
}

/* ─── STATS ─── */
/** Veces que cada jugador ha sido 1.º en solitario tras un partido de grupos. */
function computeSoloLeaderStats(players, prog) {
  const counts = Object.fromEntries(players.map(n => [n, 0]));
  const nMatches = (prog?.labels || []).length;
  if (!nMatches) {
    return players.map(name => ({ name, solo: 0, total: 0, pct: 0 }));
  }
  for (let i = 0; i < nMatches; i++) {
    const rows = players.map(name => {
      const raw = (prog.players?.[name] || [])[i];
      const pts = typeof raw === "number" ? raw : parseFloat(raw) || 0;
      return { name, pts };
    });
    const max = Math.max(...rows.map(r => r.pts));
    const leaders = rows.filter(r => r.pts === max);
    if (leaders.length === 1) counts[leaders[0].name]++;
  }
  return players.map(name => ({
    name,
    solo: counts[name],
    total: nMatches,
    pct: Math.round(counts[name] / nMatches * 100),
  }));
}

function renderStats() {
  const players = D.meta.players;
  const colors  = D.meta.colors;

  const groupMatches = D.matches
    .filter(m => m.phase === "groups" && m.played)
    .sort((a, b) => {
      const da = `${a.date||""}T${(a.time_es||"00:00")}`;
      const db = `${b.date||""}T${(b.time_es||"00:00")}`;
      return da < db ? -1 : da > db ? 1 : 0;
    });
  const playedAll    = D.matches.filter(m => m.played);

  // ── per-player breakdown (groups) ──────────────────────────────────────
  const perPlayer = players.map(name => {
    let exact = 0, diff = 0, sign = 0, miss = 0, best = 0, streak = 0, curStreak = 0, bestDay = 0;
    groupMatches.forEach(m => {
      const pd = m.predictions?.[name];
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
    const last4pts = groupMatches.slice(-4).reduce((s, m) => s + (m.predictions[name]?.score ?? 0), 0);
    return { name, exact, diff, sign, miss, hits, total, pct, avg, best, last4pts, streak: liveStreak, maxStreak: streak };
  });

  // Ordenar según clasificación general
  const standOrder = D.standings.map(s => s.name);
  perPlayer.sort((a, b) => standOrder.indexOf(a.name) - standOrder.indexOf(b.name));

  // ── HERO numbers ───────────────────────────────────────────────────────
  const heroEl = document.getElementById("stats-hero");
  const totalExacts = perPlayer.reduce((s, p) => s + p.exact, 0);
  const bestPlayer  = [...perPlayer].sort((a,b) => b.pct - a.pct)[0];
  const bestPct     = bestPlayer?.pct ?? -1;
  const bestPlayers = perPlayer.filter(p => p.pct === bestPct);
  const streakKing  = [...perPlayer].sort((a,b) => b.streak - a.streak)[0];
  const streakKings = streakKing ? perPlayer.filter(p => p.streak === streakKing.streak) : [];
  const topExact    = [...perPlayer].sort((a,b) => b.exact - a.exact)[0];
  const bestSub     = bestPlayers.length > 1 ? bestPlayers.map(p => p.name).join(" · ") + " (empate)" : (bestPlayer?.name || "");
  heroEl.innerHTML = [
    { icon: "⚽", val: groupMatches.length, label: "Partidos jugados (grupos)", sub: (() => { const tot = D.matches.filter(m=>m.phase==="groups").length; const pct = tot > 0 ? Math.round(groupMatches.length / tot * 100) : 0; return `de ${tot} totales · ${pct}% completado`; })(),
      info: "Número de partidos de la <strong>fase de grupos</strong> que ya se han jugado y puntuado, sobre el total de partidos de grupos del Mundial." },
    { icon: "🎯", val: totalExacts, label: "Marcadores exactos clavados", sub: `${perPlayer.reduce((s,p)=>s+p.miss,0)} predicciones falladas (0 pts) · suma de los ${players.length} jugadores`,
      info: "Número total de <strong>marcadores exactos clavados</strong> (resultado idéntico = 6 pts) entre todos los jugadores en la fase de grupos. Cada partido cuenta una vez por jugador, así que este número suma los aciertos de todos los participantes. Debajo: cuántas predicciones se quedaron a <strong>0 puntos</strong> (ni 1X2, ni diferencia, ni exacto), también sumando a todos los jugadores." },
    { icon: "📈", val: bestPlayer ? `${bestPlayer.pct}%` : "—", label: "Mayor tasa de acierto", sub: bestSub,
      info: "Jugador con mayor <strong>tasa de acierto</strong>: porcentaje de partidos de grupos en los que ha sumado al menos 1 punto (acertó el 1X2, la diferencia o el resultado exacto)." },
    { icon: streakKing?.streak > 0 ? "🔥" : "🤦", val: streakKing ? `${streakKing.streak}` : "—", label: "Racha activa más larga", sub: streakKing?.streak > 0 ? `${streakKings.map(p=>p.name).join(" · ")} · ${streakKing.streak} en racha${streakKings.length > 1 ? " (empate)" : ""}` : "Nadie acertó en el último partido",
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
          // % encima de la barra
          ctx.save();
          ctx.fillStyle = "#CBD5E1";
          ctx.font = "bold 11px sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "bottom";
          ctx.fillText(val + "%", bar.x, bar.y - 4);
          ctx.restore();
          // aciertos/total dentro de la barra
          const hr = sortedHR[i];
          if (hr && bar.base - bar.y > 36) {
            ctx.save();
            ctx.fillStyle = "#FFFFFF";
            ctx.font = "bold 12px sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            ctx.fillText(`${hr.hits}/${hr.total}`, bar.x, bar.y + 20);
            ctx.restore();
          }
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

  // ── Líder en solitario (ordenado de mayor a menor) ─────────────────────
  if (soloLeaderChart) soloLeaderChart.destroy();
  const soloStats = computeSoloLeaderStats(players, D.progression);
  const sortedSL = [...soloStats].sort((a, b) => b.solo - a.solo || b.pct - a.pct);
  const slCount = document.getElementById("sl-count");
  if (slCount) {
    const n = groupMatches.length;
    slCount.textContent = `(${n} partido${n !== 1 ? "s" : ""})`;
  }
  const soloCanvas = document.getElementById("soloLeaderChart");
  if (soloCanvas) {
    soloLeaderChart = new Chart(soloCanvas.getContext("2d"), {
      type: "bar",
      data: {
        labels: sortedSL.map(s => s.name),
        datasets: [{
          label: "Veces líder único",
          data: sortedSL.map(s => s.pct),
          backgroundColor: sortedSL.map(s => colors[s.name] + "99"),
          borderColor: sortedSL.map(s => colors[s.name]),
          borderWidth: 2, borderRadius: 6,
        }],
      },
      plugins: [{
        id: "soloLeaderLabels",
        afterDatasetsDraw(chart) {
          const { ctx, data } = chart;
          chart.getDatasetMeta(0).data.forEach((bar, i) => {
            const val = data.datasets[0].data[i];
            if (val == null) return;
            const sl = sortedSL[i];
            ctx.save();
            ctx.fillStyle = "#CBD5E1";
            ctx.font = "bold 11px sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "bottom";
            ctx.fillText(val + "%", bar.x, bar.y - 4);
            ctx.restore();
            if (sl && bar.base - bar.y > 36) {
              ctx.save();
              ctx.fillStyle = "#FFFFFF";
              ctx.font = "bold 12px sans-serif";
              ctx.textAlign = "center";
              ctx.textBaseline = "top";
              ctx.fillText(`${sl.solo}/${sl.total}`, bar.x, bar.y + 20);
              ctx.restore();
            }
          });
        },
      }],
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: i => {
                const sl = sortedSL[i.dataIndex];
                return ` ${sl.solo} vez${sl.solo !== 1 ? "es" : ""} (${sl.pct}% de ${sl.total} partidos)`;
              },
            },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            suggestedMax: Math.max(...sortedSL.map(s => s.pct), 1) + 8,
            display: false,
          },
          x: { grid: { display: false }, ticks: { color: "#94A3B8", font: { weight: "bold" } } },
        },
        layout: { padding: { top: 24 } },
      },
    });
  }

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

  // ── 5 mayores diferencias (1º vs 2º) ───────────────────────────────────
  const topDiffsBody = document.getElementById("top-diffs-table-body");
  if (topDiffsBody) {
    const prog = D.progression;
    const playersList = D.meta.players;
    const colors = D.meta.colors;
    const nMatches = (prog?.labels || []).length;
    
    const diffs = [];
    for (let k = 0; k < nMatches; k++) {
      const scores = playersList.map(name => {
        const raw = (prog.players?.[name] || [])[k];
        const pts = typeof raw === "number" ? raw : parseFloat(raw) || 0;
        return { name, pts };
      });
      // Ordenar por puntos desc
      scores.sort((a, b) => b.pts - a.pts);
      
      const p1 = scores[0];
      const p2 = scores[1];
      const diff = p1.pts - p2.pts;
      
      const firsts = scores.filter(x => x.pts === p1.pts).map(x => x.name);
      const seconds = scores.filter(x => x.pts === p2.pts).map(x => x.name);
      
      diffs.push({
        matchIdx: k,
        title: prog.titles[k] || `Partido ${k+1}`,
        diff: parseFloat(diff.toFixed(1)),
        p1: p1.name,
        p1Score: p1.pts,
        p2: p2.name,
        p2Score: p2.pts,
        firsts,
        seconds
      });
    }
    
    // Ordenar por diferencia desc, y si empatan, por partido más reciente (matchIdx desc)
    const sortedDiffs = [...diffs].sort((a, b) => b.diff - a.diff || b.matchIdx - a.matchIdx);
    
    const top5 = sortedDiffs.slice(0, 5);
    
    if (top5.length === 0) {
      topDiffsBody.innerHTML = `<tr><td colspan="3" class="text-center text-gray-500 py-4 italic">No hay datos disponibles</td></tr>`;
    } else {
      topDiffsBody.innerHTML = top5.map((d, i) => {
        const diffStr = `<span class="font-bold text-yellow-400">+${d.diff}</span>`;
        const c1 = colors[d.p1] || "#94A3B8";
        const c2 = colors[d.p2] || "#94A3B8";
        
        let playersHtml = "";
        if (d.firsts.length > 1) {
          const namesStr = d.firsts.map(name => `<span style="color:${colors[name]}">${escapeHtml(name)}</span>`).join(" = ");
          playersHtml = `<div class="flex items-center gap-1.5 flex-wrap"><span class="text-xs text-gray-500">Empate 1º (${d.p1Score} pts):</span> ${namesStr}</div>`;
        } else {
          const leaderName = `<span class="font-bold" style="color:${c1}">${escapeHtml(d.p1)} (${d.p1Score} pts)</span>`;
          let secondsStr = "";
          if (d.seconds.length > 1) {
            const secNames = d.seconds.map(name => `<span style="color:${colors[name]}">${escapeHtml(name)}</span>`).join("/");
            secondsStr = `${secNames} (${d.p2Score} pts)`;
          } else {
            secondsStr = `<span style="color:${c2}">${escapeHtml(d.p2)} (${d.p2Score} pts)</span>`;
          }
          playersHtml = `<div class="truncate">${leaderName} <span class="text-gray-500">vs</span> ${secondsStr}</div>`;
        }
        
        const evenBg = i % 2 === 1 ? "background:rgba(255,255,255,.02)" : "";
        return `
          <tr style="${evenBg}">
            <td class="text-center font-bold px-3 py-2">${diffStr}</td>
            <td class="px-3 py-2">
              <div class="text-gray-200 font-semibold text-xs truncate max-w-[200px]" title="${escapeHtml(d.title)}">${escapeHtml(d.title)}</div>
            </td>
            <td class="px-3 py-2 text-xs">${playersHtml}</td>
          </tr>
        `;
      }).join("");
    }
  }

  // ── 3 mayores diferencias (1º vs último) ───────────────────────────────
  const topLastDiffsBody = document.getElementById("top-last-diffs-table-body");
  if (topLastDiffsBody) {
    const prog = D.progression;
    const playersList = D.meta.players;
    const colors = D.meta.colors;
    const nMatches = (prog?.labels || []).length;
    
    const lastDiffs = [];
    for (let k = 0; k < nMatches; k++) {
      const scores = playersList.map(name => {
        const raw = (prog.players?.[name] || [])[k];
        const pts = typeof raw === "number" ? raw : parseFloat(raw) || 0;
        return { name, pts };
      });
      // Ordenar por puntos desc
      scores.sort((a, b) => b.pts - a.pts);
      
      const p1 = scores[0];
      const pLast = scores[scores.length - 1];
      const diff = p1.pts - pLast.pts;
      
      const firsts = scores.filter(x => x.pts === p1.pts).map(x => x.name);
      const lasts = scores.filter(x => x.pts === pLast.pts).map(x => x.name);
      
      lastDiffs.push({
        matchIdx: k,
        title: prog.titles[k] || `Partido ${k+1}`,
        diff: parseFloat(diff.toFixed(1)),
        p1: p1.name,
        p1Score: p1.pts,
        pLast: pLast.name,
        pLastScore: pLast.pts,
        firsts,
        lasts
      });
    }
    
    // Ordenar por diferencia desc, y si empatan, por partido más reciente (matchIdx desc)
    const sortedLastDiffs = [...lastDiffs].sort((a, b) => b.diff - a.diff || b.matchIdx - a.matchIdx);
    
    const top5 = sortedLastDiffs.slice(0, 5);
    
    if (top5.length === 0) {
      topLastDiffsBody.innerHTML = `<tr><td colspan="3" class="text-center text-gray-500 py-4 italic">No hay datos disponibles</td></tr>`;
    } else {
      topLastDiffsBody.innerHTML = top5.map((d, i) => {
        const diffStr = `<span class="font-bold text-yellow-400">+${d.diff}</span>`;
        const c1 = colors[d.p1] || "#94A3B8";
        const cLast = colors[d.pLast] || "#94A3B8";
        
        let playersHtml = "";
        const leaderName = d.firsts.length > 1 
          ? d.firsts.map(name => `<span style="color:${colors[name]}">${escapeHtml(name)}</span>`).join("=") 
          : `<span class="font-bold" style="color:${c1}">${escapeHtml(d.p1)}</span>`;
        
        const lastNames = d.lasts.length > 1
          ? d.lasts.map(name => `<span style="color:${colors[name]}">${escapeHtml(name)}</span>`).join("/")
          : `<span style="color:${cLast}">${escapeHtml(d.pLast)}</span>`;
          
        playersHtml = `<div class="truncate">${leaderName} (${d.p1Score} pts) <span class="text-gray-500">vs</span> ${lastNames} (${d.pLastScore} pts)</div>`;
        
        const evenBg = i % 2 === 1 ? "background:rgba(255,255,255,.02)" : "";
        return `
          <tr style="${evenBg}">
            <td class="text-center font-bold px-3 py-2">${diffStr}</td>
            <td class="px-3 py-2">
              <div class="text-gray-200 font-semibold text-xs truncate max-w-[200px]" title="${escapeHtml(d.title)}">${escapeHtml(d.title)}</div>
            </td>
            <td class="px-3 py-2 text-xs">${playersHtml}</td>
          </tr>
        `;
      }).join("");
    }
  }

  // ── Cambios de liderato ────────────────────────────────────────────────
  const leadershipBody = document.getElementById("leadership-changes-table-body");
  if (leadershipBody) {
    const prog = D.progression;
    const playersList = D.meta.players;
    const colors = D.meta.colors;
    const nMatches = (prog?.labels || []).length;

    let currentLeader = null;
    const changes = [];

    for (let k = 0; k < nMatches; k++) {
      const scores = playersList.map(name => {
        const raw = (prog.players?.[name] || [])[k];
        const pts = typeof raw === "number" ? raw : parseFloat(raw) || 0;
        return { name, pts };
      });
      scores.sort((a, b) => b.pts - a.pts);
      const topPts = scores[0].pts;
      const soloLeaders = scores.filter(x => x.pts === topPts);
      const newLeader = soloLeaders.length === 1 ? soloLeaders[0].name : null;

      if (newLeader && newLeader !== currentLeader) {
        changes.push({
          matchIdx: k,
          title: prog.titles[k] || `Partido ${k + 1}`,
          newLeader,
          prevLeader: currentLeader,
          pts: topPts
        });
        currentLeader = newLeader;
      }
    }

    if (changes.length === 0) {
      leadershipBody.innerHTML = `<tr><td colspan="5" class="text-center text-gray-500 py-4 italic">No ha habido cambios de liderato aún</td></tr>`;
    } else {
      // Mostrar más reciente primero
      const reversed = [...changes].reverse();
      const PREVIEW = 5;
      let expanded = false;

      const renderRows = (list) => list.map((c, i) => {
        const evenBg = i % 2 === 1 ? "background:rgba(255,255,255,.02)" : "";
        const colorNew = colors[c.newLeader] || "#94A3B8";
        const colorPrev = c.prevLeader ? (colors[c.prevLeader] || "#94A3B8") : null;
        // Corona al más reciente (primer elemento del array reversed)
        const crownEmoji = i === 0 ? " 👑" : "";
        const prevHtml = c.prevLeader
          ? `<span class="font-semibold" style="color:${colorPrev}">${escapeHtml(c.prevLeader)}</span>`
          : `<span class="text-gray-500 italic">— (inicio)</span>`;
        // Número de cambio (orden cronológico original)
        const changeNum = changes.length - i;
        return `
          <tr style="${evenBg}">
            <td class="text-center font-bold px-3 py-2 text-gray-400">${changeNum}</td>
            <td class="px-3 py-2">
              <div class="text-gray-200 font-semibold text-xs truncate max-w-[220px]" title="${escapeHtml(c.title)}">${escapeHtml(c.title)}</div>
            </td>
            <td class="px-3 py-2 text-xs">
              <span class="font-bold" style="color:${colorNew}">${escapeHtml(c.newLeader)}${crownEmoji}</span>
            </td>
            <td class="px-3 py-2 text-xs">${prevHtml}</td>
            <td class="text-center px-3 py-2 text-xs font-bold text-yellow-400">${c.pts} pts</td>
          </tr>
        `;
      }).join("");

      leadershipBody.innerHTML = renderRows(reversed.slice(0, PREVIEW));

      // Botón expandir solo si hay más de PREVIEW cambios
      const toggleBtn = document.getElementById("leadership-toggle-btn");
      if (toggleBtn) {
        if (reversed.length <= PREVIEW) {
          toggleBtn.style.display = "none";
        } else {
          toggleBtn.style.display = "";
          toggleBtn.textContent = `Ver todos (${reversed.length})`;
          toggleBtn.onclick = () => {
            expanded = !expanded;
            leadershipBody.innerHTML = renderRows(expanded ? reversed : reversed.slice(0, PREVIEW));
            toggleBtn.textContent = expanded ? "Ver menos" : `Ver todos (${reversed.length})`;
          };
        }
      }
    }
  }

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
      "• <strong>pts (últ. 4)</strong>: suma de puntos en los últimos 4 partidos de grupos.<br>" +
      "• <strong>Últimos partidos</strong>: cada cuadro es un partido reciente (ver leyenda).",
      "left"
    );
  }

  const playersEl = document.getElementById("stats-players");
  playersEl.innerHTML = D.standings.map(p => {
    const pp = perPlayer.find(x => x.name === p.name) || {};
    const last10 = groupMatches.slice(-16);
    // En grupos solo existen 4 resultados: 0 (falló 1X2), 2 (acertó 1X2),
    // 3 (1X2 + diferencia) y 6 (exacto). Un color distinto por estado real.
    const scoreColor = (sc) => sc >= 6 ? "#22C55E"   // exacto
                             : sc >= 3 ? "#FACC15"   // 1X2 + diferencia
                             : sc >= 2 ? "#F97316"   // solo 1X2
                             :           "#374151";  // falló
    const scoreTip = (sc) => sc >= 6 ? "resultado exacto"
                           : sc >= 3 ? "1X2 + diferencia"
                           : sc >= 2 ? "acertó 1X2"
                           :           "falló el 1X2";
    const lastBar = last10.length ? `
      <div class="pstat-dir-row">
        <span class="pstat-dir-lbl">antiguo ›</span>
        <div class="pstat-squares">${last10.map(m => {
          const sc = m.predictions[p.name]?.score ?? 0;
          const col = scoreColor(sc);
          const lbl = `${m.name}: ${sc} pts (${scoreTip(sc)})`;
          return `<div title="${lbl.replace(/"/g,"&quot;")}" style="width:13px;height:20px;border-radius:3px;background:${col};flex-shrink:0"></div>`;
        }).join("")}<span class="pstat-dir-lbl pstat-dir-end">‹ reciente</span></div>
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
            <div class="pstat-num" style="color:${p.color}">${pp.last4pts ?? 0}</div>
            <div class="pstat-lbl">pts (últ. 4)</div>
          </div>
        </div>

        <div class="pstat-last-head">
          <span>Últimos ${last10.length || 16} partidos (grupos)</span>
        </div>
        ${lastBar}
        <div class="pstat-legend">
          <span><i style="background:#22C55E"></i> Exacto (6)</span>
          <span><i style="background:#FACC15"></i> 1X2 + dif. (3)</span>
          <span><i style="background:#F97316"></i> Solo 1X2 (2)</span>
          <span><i style="background:#374151"></i> Fallo (0)</span>
        </div>
      </div>`;
  }).join("");

  // ── Ranking de partidos más / menos acertados ───────────────────────
  if (playedAll.length) {
    const players2 = D.meta.players;
    const colors2  = D.meta.colors;
    const MAX_PTS  = players2.length * 6;

    const matchRows = playedAll.map(m => {
      const byPlayer = players2.map(name => ({
        name,
        pts: m.predictions?.[name]?.score ?? 0,
      }));
      const totalPts = byPlayer.reduce((s, p) => s + p.pts, 0);
      return { m, byPlayer, totalPts };
    });

    const playerCols2 = players2.map(name =>
      `<th class="text-center" style="color:${colors2[name] || '#94A3B8'}">${name}</th>`
    ).join("");

    // Más acertados (desc)
    const topRows  = [...matchRows].sort((a, b) => b.totalPts - a.totalPts);
    _initMatchTable(
      "stats-top-matches",
      topRows,
      "🏆 Partidos más acertados",
      `Puntos totales sumados entre todos los participantes. Máximo ${MAX_PTS} pts (${players2.length} jugadores × 6 pts). Solo partidos ya jugados.`,
      MAX_PTS, playerCols2, 5
    );

    // Menos acertados (asc)
    const worstRows = [...matchRows].sort((a, b) => a.totalPts - b.totalPts);
    _initMatchTable(
      "stats-worst-matches",
      worstRows,
      "📉 Partidos menos acertados",
      `Los partidos donde la porra acertó menos (menos puntos totales entre todos). Solo partidos ya jugados.`,
      MAX_PTS, playerCols2, 5
    );
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
let calView = "day"; // "day" | "week" | "month" — por defecto el día de hoy
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
  const looksPlaceholder = v => !v || /^\d|^Win|^Los|^[A-Z]\d|^[A-Z]{1,2}\d/.test(v) || v.includes("FINAL") || v.includes("puesto");
  const isProv = looksPlaceholder(m.home) || looksPlaceholder(m.away);
  const fh = (m.flag_home && !looksPlaceholder(m.home)) ? m.flag_home : "🏳";
  const fa = (m.flag_away && !looksPlaceholder(m.away)) ? m.flag_away : "🏳";
  const home = m.home || "—";
  const away = m.away || "—";
  const time = m.time_es || "--:--";
  const mid = m.played
    ? `<span class="cal-row-score">${(m.result && m.result.score) || (`${m.goals_l ?? ""}-${m.goals_v ?? ""}`)}</span>`
    : `<span class="cal-row-vs">vs</span>`;
  const nm = (m.name || "").replace(/'/g, "\\'").replace(/"/g, "&quot;");
  
  let phaseBadge = "";
  if (isProv && m.phase !== "groups") {
    const lbl = PHASE_LABELS[m.phase] || m.phase || "";
    phaseBadge = `<span class="text-[10px] font-bold text-orange-500 bg-orange-500/10 px-1.5 py-0.5 rounded ml-2 whitespace-nowrap" title="Partido Provisional">⚠️ ${lbl}</span>`;
  }
  
  const tv = tvBadgesHtml(m);
  const calBtn = (!m.played && m.date && m.time_es) ? (() => {
    const safeName = (m.name || m.id || "").replace(/'/g, "\\'");
    return `<button class="cal-add-btn cal-add-compact" onclick="event.stopPropagation();_showCalPickerForMatch('${safeName}',this)" title="Añadir al calendario">📅</button>`;
  })() : "";
  return `<div class="cal-row" onclick="goToMatchesDay('${iso}','${nm}')">
      <span class="cal-row-time">${time}</span>
      <span class="cal-row-home">${fh} ${home}</span>
      ${mid}
      <span class="cal-row-away">${away} ${fa} ${phaseBadge}</span>
      <span class="cal-row-actions" onclick="event.stopPropagation()">${tv}${calBtn}</span>
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
   TAB: ESCENARIOS — ¿Qué necesito para ganar?
═══════════════════════════════════════════════════════════════ */
let _sceSelectedPlayer = null;
let _sceBattleFilter   = "all"; // "all" | "sign_diff" | "score_diff"

function renderScenarios() {
  const el = document.getElementById("scenarios-container");
  if (!el || !D) return;

  const players = D.meta?.players || [];
  const colors  = D.meta?.colors  || {};

  const standings = [...D.standings].sort((a, b) => b.total - a.total || (a.pos || 0) - (b.pos || 0));
  const leader    = standings[0];
  const maxPerMatch = +(D.scoring_rules?.max_per_group_match || 6);

  const remainingGroups = D.matches
    .filter(m => m.phase === "groups" && !m.played)
    .sort((a, b) => {
      const da = `${a.date || ""}T${a.time_es || "00:00"}`;
      const db = `${b.date || ""}T${b.time_es || "00:00"}`;
      return da < db ? -1 : da > db ? 1 : 0;
    });

  const totalRem         = remainingGroups.length;
  const maxGroupPtsTotal = totalRem * maxPerMatch;

  const pData = standings.map(p => {
    const remWithPred = remainingGroups.filter(m => {
      const pred = m.predictions?.[p.name]?.pred;
      return pred && (pred.score || pred.sign);
    }).length;
    const maxReachable = p.total + remWithPred * maxPerMatch;
    const gap          = leader.total - p.total;
    const isLeader     = p.name === leader.name;
    let diffLabel, diffColor;
    if (isLeader) {
      const second = standings[1];
      const lead   = second ? (p.total - second.total) : p.total;
      diffLabel = second ? `+${lead} sobre el 2º` : "Sin rival";
      diffColor = "var(--gold)";
    } else if (maxReachable < leader.total) {
      diffLabel = "Imposible (grupos)";
      diffColor = "#EF4444";
    } else {
      const ptsNeed = totalRem > 0 ? gap / totalRem : Infinity;
      if (ptsNeed < 0.5)    { diffLabel = "Muy accesible"; diffColor = "#22C55E"; }
      else if (ptsNeed < 2) { diffLabel = "Posible";       diffColor = "#F59E0B"; }
      else                  { diffLabel = "Complicado";     diffColor = "#EF4444"; }
    }
    return { ...p, remWithPred, maxReachable, gap, isLeader, diffLabel, diffColor };
  });

  // ── Hero ──────────────────────────────────────────────────
  const heroHtml = `
    <div class="card p-5 mb-5">
      <div class="flex items-center gap-3 flex-wrap mb-2">
        <span class="text-2xl">🎯</span>
        <h2 class="font-bold text-white text-xl">¿Qué necesito para ganar?</h2>
      </div>
      <p class="text-sm text-gray-400 mb-4">
        Análisis de escenarios en la <strong class="text-gray-300">fase de grupos</strong>.
        Quedan <strong class="text-gray-300">${totalRem} partidos</strong> con hasta
        <strong class="text-gray-300">${maxGroupPtsTotal} pts</strong> en juego.
      </p>
      <div class="sce-hero-stats">
        <div class="sce-hero-stat">
          <div class="sce-hero-stat-val">${totalRem}</div>
          <div class="sce-hero-stat-lbl">Partidos restantes</div>
        </div>
        <div class="sce-hero-stat">
          <div class="sce-hero-stat-val">${maxPerMatch}</div>
          <div class="sce-hero-stat-lbl">Pts máx/partido</div>
        </div>
        <div class="sce-hero-stat">
          <div class="sce-hero-stat-val" style="color:${leader.color}">${leader.name}</div>
          <div class="sce-hero-stat-lbl">Líder actual</div>
        </div>
        <div class="sce-hero-stat">
          <div class="sce-hero-stat-val" style="color:var(--gold)">${leader.total}</div>
          <div class="sce-hero-stat-lbl">Pts del líder</div>
        </div>
      </div>
    </div>`;

  // ── Tabla de escenarios ────────────────────────────────────
  const tableRows = pData.map((p, i) => {
    const gapHtml = p.isLeader
      ? `<span style="color:var(--gold);font-weight:700">👑 Líder</span>`
      : `<span style="color:#EF4444;font-weight:700">-${p.gap} pts</span>`;
    const maxPct = p.maxReachable > 0 ? Math.round((p.total / p.maxReachable) * 100) : 0;
    const isSelected = _sceSelectedPlayer === p.name;
    return `
      <tr class="sce-tr${isSelected ? " sce-tr-selected" : ""}" data-player="${escapeHtml(p.name)}" style="cursor:pointer" title="Seleccionar ${escapeHtml(p.name)}">
        <td class="sce-td"><span class="sce-pos-badge">${i + 1}</span></td>
        <td class="sce-td">
          <div class="flex items-center gap-2">
            <div class="sce-player-dot" style="background:${p.color}"></div>
            <span class="font-bold text-white">${escapeHtml(p.name)}</span>
            ${isSelected ? `<span class="sce-yo-badge">YO</span>` : ""}
          </div>
        </td>
        <td class="sce-td sce-td-num">
          <span class="bebas text-xl font-extrabold" style="color:${p.color}">${p.total}</span>
        </td>
        <td class="sce-td sce-td-num">${gapHtml}</td>
        <td class="sce-td sce-td-num sce-hide-sm">
          <span class="text-gray-300">${p.remWithPred}</span>
          <span class="text-gray-500 text-xs"> part.</span>
        </td>
        <td class="sce-td sce-hide-sm">
          <div class="sce-max-wrap">
            <span class="font-bold text-gray-200 text-sm">${p.maxReachable}</span>
            <div class="sce-max-bar-bg">
              <div class="sce-max-bar-fill" style="width:${maxPct}%;background:${p.color}"></div>
            </div>
          </div>
        </td>
        <td class="sce-td">
          <span class="sce-diff-badge" style="color:${p.diffColor}">${p.diffLabel}</span>
        </td>
      </tr>`;
  }).join("");

  // ── Selector de jugador ───────────────────────────────────
  const selectorPills = pData.map(p => {
    const active = _sceSelectedPlayer === p.name;
    return `<button class="sce-pill${active ? " sce-pill-active" : ""}" data-pill="${escapeHtml(p.name)}"
      style="${active ? `background:${p.color};border-color:${p.color};color:#0F172A` : `border-color:${p.color}44;color:${p.color}`}">
      <span class="sce-pill-dot" style="background:${p.color}"></span>
      ${escapeHtml(p.name)}
      ${active ? `<span class="sce-pill-yo">YO</span>` : ""}
    </button>`;
  }).join("");

  const selectorHtml = `
    <div class="card p-4 mb-5">
      <div class="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">🙋 ¿Quién eres tú?</div>
      <div class="sce-pill-row">${selectorPills}</div>
      ${_sceSelectedPlayer ? `<div class="text-xs text-gray-600 mt-2">Pulsa de nuevo para deseleccionar</div>` : `<div class="text-xs text-gray-500 mt-2">Selecciona tu nombre para ver tu análisis personalizado</div>`}
    </div>`;

  const tableHtml = `
    ${selectorHtml}
    <div class="card overflow-hidden mb-5">
      <div class="overflow-x-auto">
        <table class="sce-table w-full" id="sce-main-table">
          <thead>
            <tr>
              <th class="sce-th">#</th>
              <th class="sce-th">Jugador</th>
              <th class="sce-th sce-td-num">Pts</th>
              <th class="sce-th sce-td-num">Al líder</th>
              <th class="sce-th sce-td-num sce-hide-sm">Restantes</th>
              <th class="sce-th sce-hide-sm">Máx. alcanzable</th>
              <th class="sce-th">Situación</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
      <div class="px-4 py-2 text-xs text-gray-600" style="border-top:1px solid var(--border)">
        * Máx. alcanzable: puntos actuales + partidos de grupos restantes con predicción × ${maxPerMatch} pts. No incluye eliminatorias ni posiciones.
      </div>
    </div>`;

  // ── Personal ──────────────────────────────────────────────
  const personalHtml = `<div id="sce-personal" class="mb-5"></div>`;

  // ── Próximas predicciones ──────────────────────────────────
  const upcoming = remainingGroups.slice(0, 6);
  const upcomingHtml = upcoming.length === 0 ? "" : `
    <div class="flex items-center gap-2 mb-1 mt-6">
      <h3 class="font-bold text-white text-lg">⏭️ Próximas predicciones</h3>
    </div>
    <p class="text-sm text-gray-400 mb-4">Lo que cada jugador ha predicho para los próximos partidos. ¡Comprueba dónde ganas o pierdes terreno!</p>
    <div class="sce-upcoming-grid">
      ${upcoming.map(m => {
        const dateStr = m.date
          ? new Date(m.date + "T12:00:00").toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" })
          : "";
        const timeStr = m.time_es || "";
        const predsHtml = players.map(name => {
          const pred  = m.predictions?.[name]?.pred;
          const score = pred?.score || "—";
          const color = colors[name] || "#888";
          return `
            <div class="sce-pred-row">
              <div class="sce-pred-dot" style="background:${color}"></div>
              <span class="sce-pred-name">${escapeHtml(name)}</span>
              <span class="sce-pred-score">${escapeHtml(score)}</span>
            </div>`;
        }).join("");
        return `
          <div class="card p-4">
            <div class="sce-match-hd">
              <span class="sce-match-name">${escapeHtml(m.home || "")} — ${escapeHtml(m.away || "")}</span>
              <span class="sce-match-time">${escapeHtml(dateStr)}${timeStr ? " · " + escapeHtml(timeStr) : ""}</span>
            </div>
            <div class="sce-preds">${predsHtml}</div>
          </div>`;
      }).join("")}
    </div>`;

  el.innerHTML = heroHtml + tableHtml + personalHtml + upcomingHtml;

  // ── Wire pill clicks ─────────────────────────────────────
  el.querySelectorAll(".sce-pill[data-pill]").forEach(pill => {
    pill.addEventListener("click", () => {
      const name = pill.dataset.pill;
      _sceSelectedPlayer = _sceSelectedPlayer === name ? null : name;
      renderScenarios();
      if (_sceSelectedPlayer) {
        setTimeout(() => {
          document.getElementById("sce-personal")?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 60);
      }
    });
  });

  // ── Wire table row clicks ─────────────────────────────────
  el.querySelectorAll("#sce-main-table tbody tr[data-player]").forEach(row => {
    row.addEventListener("click", () => {
      const name = row.dataset.player;
      _sceSelectedPlayer = _sceSelectedPlayer === name ? null : name;
      renderScenarios();
      if (_sceSelectedPlayer) {
        setTimeout(() => {
          document.getElementById("sce-personal")?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 60);
      }
    });
  });

  // ── Render personal if selection exists ──────────────────
  if (_sceSelectedPlayer) _renderScePersonal(standings, leader, maxPerMatch, remainingGroups, colors);
}

function _renderScePersonal(standings, leader, maxPerMatch, remainingGroups, colors) {
  const el = document.getElementById("sce-personal");
  if (!el || !_sceSelectedPlayer) return;

  const me    = standings.find(s => s.name === _sceSelectedPlayer);
  if (!me) return;
  const isLeader = me.name === leader.name;
  const rival    = isLeader ? standings[1] : leader;
  const gap      = Math.abs(me.total - (rival?.total ?? 0));
  const myColor  = colors[me.name]  || "#888";
  const rivColor = rival ? (colors[rival.name] || "#888") : "#888";

  const SIGN_LABEL = { "1": "Local", "X": "Empate", "2": "Visitante" };
  const SIGN_ICON  = { "1": "🏠", "X": "🤝", "2": "✈️" };

  // classify each remaining match
  const battles = [], neutrals = [], noPred = [];

  for (const m of remainingGroups) {
    const myP  = m.predictions?.[me.name]?.pred;
    const rivP = rival ? m.predictions?.[rival.name]?.pred : null;

    const myScore  = myP?.score  || null;
    const rivScore = rivP?.score || null;
    const mySign   = myScore ? _signFromScore(myScore) : (myP?.sign || null);
    const rivSign  = rivScore ? _signFromScore(rivScore) : (rivP?.sign || null);

    if (!myScore && !mySign) { noPred.push(m); continue; }
    if (!rival || (!rivScore && !rivSign)) { neutrals.push({ m, myScore, rivScore: null, mySign, rivSign: null, type: "no_rival_pred" }); continue; }

    if (mySign !== rivSign) {
      battles.push({ m, myScore, rivScore, mySign, rivSign, type: "sign_diff" });
    } else if (myScore !== rivScore) {
      battles.push({ m, myScore, rivScore, mySign, rivSign, type: "score_diff" });
    } else {
      neutrals.push({ m, myScore, rivScore, mySign, rivSign, type: "same" });
    }
  }

  // Sort battles by date/time ascending (soonest first)
  battles.sort((a, b) => {
    const da = `${a.m.date || ""}T${a.m.time_es || "00:00"}`;
    const db = `${b.m.date || ""}T${b.m.time_es || "00:00"}`;
    if (da < db) return -1;
    if (da > db) return 1;
    // secondary: sign_diff (higher impact) first within same slot
    if (a.type === "sign_diff" && b.type !== "sign_diff") return -1;
    if (b.type === "sign_diff" && a.type !== "sign_diff") return 1;
    return 0;
  });

  const battleCount  = battles.length;
  const neutralCount = neutrals.filter(n => n.type === "same").length;
  const signBattles  = battles.filter(b => b.type === "sign_diff").length;
  const scoreBattles = battles.filter(b => b.type === "score_diff").length;

  // max possible net gain in sign battles = signBattles * maxPerMatch (you get max, rival gets 0)
  // max possible net gain in score battles = scoreBattles * 3 (rough: diff/exact differ)
  const maxNetGain = signBattles * maxPerMatch + scoreBattles * 3;

  // ── Personal hero ─────────────────────────────────────────
  let situationHtml;
  if (isLeader) {
    const lead = rival ? gap : me.total;
    situationHtml = `<div class="sce-pers-sit" style="color:var(--gold)">👑 Eres el líder · +${lead} sobre ${rival?.name || "todos"}</div>`;
  } else if (me.total + battleCount * maxPerMatch < (rival?.total ?? 0)) {
    situationHtml = `<div class="sce-pers-sit" style="color:#EF4444">⚠️ Matemáticamente muy difícil en grupos · necesitas ${gap} pts de ventaja neta</div>`;
  } else {
    const needed  = gap;
    situationHtml = `<div class="sce-pers-sit" style="color:#F59E0B">Necesitas sacar <strong>${needed} pts</strong> de ventaja neta al líder en los ${battleCount} partido${battleCount !== 1 ? "s" : ""} que os diferencian</div>`;
  }

  const heroCard = `
    <div class="card p-5 mb-4" style="border-color:${myColor}44;border-top:3px solid ${myColor}">
      <div class="sce-pers-head">
        <div class="flex items-center gap-3">
          <div style="width:14px;height:14px;border-radius:50%;background:${myColor};flex-shrink:0"></div>
          <span class="font-extrabold text-white text-lg uppercase">${escapeHtml(me.name)}</span>
          <span class="bebas text-2xl" style="color:${myColor}">${me.total} pts</span>
        </div>
        ${rival ? `<div class="sce-pers-vs">
          <span class="text-xs text-gray-500">vs</span>
          <div style="width:10px;height:10px;border-radius:50%;background:${rivColor}"></div>
          <span class="font-bold text-gray-300">${escapeHtml(rival.name)}</span>
          <span class="bebas text-xl" style="color:${rivColor}">${rival.total}</span>
        </div>` : ""}
      </div>
      ${situationHtml}
      <div class="sce-pers-stats">
        <div class="sce-pers-stat">
          <div class="sce-pers-stat-val" style="color:${isLeader ? "var(--gold)" : "#EF4444"}">${isLeader ? "+" : "-"}${gap}</div>
          <div class="sce-pers-stat-lbl">${isLeader ? "de ventaja" : "de desventaja"}</div>
        </div>
        <div class="sce-pers-stat">
          <div class="sce-pers-stat-val" style="color:#EF4444">${signBattles}</div>
          <div class="sce-pers-stat-lbl">batallas de signo</div>
        </div>
        <div class="sce-pers-stat">
          <div class="sce-pers-stat-val" style="color:#F59E0B">${scoreBattles}</div>
          <div class="sce-pers-stat-lbl">batallas de marcador</div>
        </div>
        <div class="sce-pers-stat">
          <div class="sce-pers-stat-val" style="color:#22C55E">${neutralCount}</div>
          <div class="sce-pers-stat-lbl">partidos neutros</div>
        </div>
      </div>
      ${!isLeader && maxNetGain > 0 ? `<div class="text-xs text-gray-500 mt-3">Máxima ventaja neta posible en tus batallas: <strong class="text-gray-300">+${maxNetGain} pts</strong></div>` : ""}
    </div>`;

  // ── Battle cards ─────────────────────────────────────────
  // ── Battle filter + cards ──────────────────────────────────
  const BATTLE_FILTERS = [
    { key: "all",        label: "Todas",            count: battleCount },
    { key: "sign_diff",  label: "⚡ Signo opuesto",  count: signBattles  },
    { key: "score_diff", label: "🎯 Mismo signo",    count: scoreBattles },
  ];

  const filteredBattles = _sceBattleFilter === "all"
    ? battles
    : battles.filter(b => b.type === _sceBattleFilter);

  const battleCards = filteredBattles.slice(0, 20).map(b => {
    const { m, myScore, rivScore, mySign, rivSign, type } = b;
    const dateStr = m.date
      ? new Date(m.date + "T12:00:00").toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" })
      : "";
    const timeStr = m.time_es || "";

    const isBigBattle = type === "sign_diff";
    const borderCol   = isBigBattle ? "#EF4444" : "#F59E0B";

    const mySignLbl   = mySign  ? SIGN_LABEL[mySign]  : "—";
    const rivSignLbl  = rivSign ? SIGN_LABEL[rivSign]  : "—";
    const mySignIcon  = mySign  ? SIGN_ICON[mySign]   : "❓";
    const rivSignIcon = rivSign ? SIGN_ICON[rivSign]  : "❓";

    const outcomeHtml = isBigBattle
      ? `<div class="sce-battle-outcome" style="color:#EF4444">⚡ Signo opuesto — partido clave</div>`
      : `<div class="sce-battle-outcome" style="color:#F59E0B">🎯 Mismo signo, marcadores distintos</div>`;

    return `
      <div class="sce-battle-card" style="border-color:${borderCol}44;border-left:3px solid ${borderCol}">
        <div class="sce-battle-hd">
          <span class="sce-battle-match">${escapeHtml(m.home || "")} — ${escapeHtml(m.away || "")}</span>
          <span class="sce-battle-time">${escapeHtml(dateStr)}${timeStr ? " · " + escapeHtml(timeStr) : ""}</span>
        </div>
        ${outcomeHtml}
        <div class="sce-battle-preds">
          <div class="sce-battle-pred sce-battle-pred-me" style="border-color:${myColor}33;background:${myColor}0a">
            <div class="sce-battle-pred-who" style="color:${myColor}">🙋 ${escapeHtml(me.name)}</div>
            <div class="sce-battle-pred-score">${escapeHtml(myScore || "—")}</div>
            <div class="sce-battle-pred-sign" style="color:${myColor}">${mySignIcon} ${escapeHtml(mySignLbl)}</div>
          </div>
          <div class="sce-battle-sep">VS</div>
          <div class="sce-battle-pred sce-battle-pred-riv" style="border-color:${rivColor}33;background:${rivColor}0a">
            <div class="sce-battle-pred-who" style="color:${rivColor}">👑 ${escapeHtml(rival?.name || "")}</div>
            <div class="sce-battle-pred-score">${escapeHtml(rivScore || "—")}</div>
            <div class="sce-battle-pred-sign" style="color:${rivColor}">${rivSignIcon} ${escapeHtml(rivSignLbl)}</div>
          </div>
        </div>
      </div>`;
  }).join("");

  const filterPillsHtml = BATTLE_FILTERS
    .filter(f => f.key === "all" || f.count > 0)
    .map(f => {
      const active     = f.key === _sceBattleFilter;
      const accentCol  = f.key === "sign_diff" ? "#EF4444" : f.key === "score_diff" ? "#F59E0B" : null;
      const styleAttr  = active && accentCol
        ? `style="background:${accentCol};border-color:${accentCol};color:#fff"`
        : accentCol
          ? `style="border-color:${accentCol}88;color:${accentCol}"`
          : "";
      return `<button class="sce-bfilt-btn${active ? " sce-bfilt-active" : ""}" data-bfilt="${f.key}" ${styleAttr}>${f.label}<span class="sce-bfilt-count">${f.count}</span></button>`;
    }).join("");

  const battlesSection = battleCount === 0 ? `
    <div class="card p-5 text-center text-gray-500 mb-4">
      ${isLeader ? "👑 Tienes las mismas predicciones que tu rival en todos los partidos restantes." : "✅ No hay batallas directas — tus predicciones coinciden con las del líder en todos los partidos restantes."}
    </div>` : `
    <div class="flex items-center gap-2 mb-2 flex-wrap">
      <h4 class="font-bold text-white">⚡ Tus batallas contra ${escapeHtml(rival?.name || "")}</h4>
      <span class="text-xs text-gray-500">${battleCount} partido${battleCount !== 1 ? "s" : ""} donde diferís</span>
    </div>
    <div class="sce-bfilt-row">${filterPillsHtml}</div>
    <div class="sce-battle-grid">${battleCards || `<div class="sce-bfilt-empty">No hay batallas de este tipo.</div>`}</div>`;

  el.innerHTML = `
    <div style="scroll-margin-top:4rem">
      <div class="flex items-center gap-3 mb-3 flex-wrap">
        <h3 class="font-bold text-white text-lg">🙋 Mi análisis personal</h3>
        <button class="sce-close-btn" id="sce-close-btn" title="Cerrar análisis personal">✕ Cerrar</button>
      </div>
      ${heroCard}
      ${battlesSection}
    </div>`;

  el.querySelector("#sce-close-btn")?.addEventListener("click", () => {
    _sceSelectedPlayer = null;
    renderScenarios();
  });
  el.querySelectorAll(".sce-bfilt-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      _sceBattleFilter = btn.dataset.bfilt;
      _renderScePersonal(standings, leader, maxPerMatch, remainingGroups, colors);
    });
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
      <td class="tsc-name"><button class="tsc-player player-link-btn" data-player="${escapeHtml(s.name)}">${escapeHtml(s.name)}</button></td>
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

  // ── Indicador rendimiento vs. ranking FIFA ──────────────────
  function fifaPerf(name, tablePos) {
    const rank = FIFA_RANK[name];
    if (!rank) return { rankCell: `<span class="tlg-fifa-na">—</span>`, perfCell: `<span class="tlg-fifa-na">—</span>` };
    const delta = rank - tablePos; // + = mejor de lo esperado, - = peor
    const rankCell = `<span class="tlg-fifa-rank-num">#${rank}</span>`;
    let icon, color, label, cls;
    if      (delta >= 15)  { icon = "🔥"; color = "#22C55E"; label = `+${delta}`; cls = "tlg-perf-fire"; }
    else if (delta >= 8)   { icon = "▲";  color = "#4ADE80"; label = `+${delta}`; cls = "tlg-perf-good"; }
    else if (delta >= 3)   { icon = "↑";  color = "#86EFAC"; label = `+${delta}`; cls = "tlg-perf-ok";   }
    else if (delta >= -2)  { icon = "≈";  color = "#475569"; label = "";          cls = "tlg-perf-eq";   }
    else if (delta >= -7)  { icon = "↓";  color = "#FCA5A5"; label = `${delta}`; cls = "tlg-perf-bad";  }
    else if (delta >= -14) { icon = "▼";  color = "#F87171"; label = `${delta}`; cls = "tlg-perf-poor"; }
    else                   { icon = "💔"; color = "#EF4444"; label = `${delta}`; cls = "tlg-perf-dis";  }
    const title = `FIFA #${rank} · Posición actual: ${tablePos} · ${delta > 0 ? "Rinde +" + delta + " posiciones sobre su ranking" : delta < 0 ? "Rinde " + delta + " posiciones bajo su ranking" : "Rinde según su ranking"}`;
    const perfCell = `<span class="tlg-perf ${cls}" style="color:${color}" title="${title}">${icon}${label ? `<span class="tlg-perf-val"> ${label}</span>` : ""}</span>`;
    return { rankCell, perfCell };
  }

  const rows = list.map((t, i) => {
    const difStr = t.dif > 0 ? `+${t.dif}` : `${t.dif}`;
    const difCls = t.dif > 0 ? "tms-pos-num" : t.dif < 0 ? "tms-neg" : "";
    const { rankCell, perfCell } = fifaPerf(t.name, i + 1);
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
      <td class="tlg-td-fifa">${rankCell}</td>
      <td class="tlg-td-perf">${perfCell}</td>
    </tr>`;
  }).join("");

  return `${_worldProvBanner()}<div class="card overflow-hidden">
    <div class="px-5 py-4 border-b" style="border-color:var(--border)">
      <p class="text-xs text-gray-400 mt-0.5">Todos los partidos contabilizados (${counted.length}). Pts → DIF → GF.</p>
    </div>
    <div class="tlg-perf-legend">
      <span class="tlg-leg-item"><span style="color:#22C55E">🔥▲↑</span> Mejor de lo esperado por FIFA</span>
      <span class="tlg-leg-sep">·</span>
      <span class="tlg-leg-item"><span style="color:#475569">≈</span> Según lo esperado</span>
      <span class="tlg-leg-sep">·</span>
      <span class="tlg-leg-item"><span style="color:#EF4444">↓▼💔</span> Peor de lo esperado</span>
    </div>
    <div class="overflow-x-auto">
      <table class="tm-league-table tlg-general">
        <thead><tr>
          <th class="tlg-pos">#</th>
          <th class="tlg-team text-left">Equipo</th>
          <th title="PJ">PJ</th><th title="Ganados">G</th><th title="Empatados">E</th>
          <th title="Perdidos">P</th><th title="GF">GF</th><th title="GC">GC</th>
          <th title="DIF">DIF</th><th title="Puntos" class="tlg-pts">PTS</th>
          <th class="tlg-td-fifa" title="Ranking FIFA actual">FIFA</th>
          <th class="tlg-td-perf" title="Rendimiento vs. ranking FIFA esperado">Rend.</th>
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
                <td class="tsc-name"><button class="tsc-player player-link-btn" data-player="${escapeHtml(s.name)}">${escapeHtml(s.name)}</button></td>
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
  const isRealMatch = m => m.phase !== "positions" && m.phase !== "q16" && m.date && m.date.startsWith("2026-");
  (D.matches || []).filter(isRealMatch).forEach(m => {
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

/* ═══════════════════════════════════════════════════════════════
   TOP TABLE — Los 30 partidos más top por ranking FIFA combinado
═══════════════════════════════════════════════════════════════ */
let _tptFilter = "all"; // "all" | "played" | "pending" | "proximos"

function renderTopTable() {
  const container = document.getElementById("toptable-container");
  if (!container || !D) return;

  const TOP_N = 30;
  const todayISO    = new Date().toISOString().slice(0, 10);
  const tomorrowISO = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

  // Build list with combined FIFA rank (lower = more top)
  const matches = D.matches
    .filter(m => m.home && m.away)
    .map(m => {
      const rHome = FIFA_RANK[m.home] ?? 999;
      const rAway = FIFA_RANK[m.away] ?? 999;
      return { m, rHome, rAway, combined: rHome + rAway };
    })
    .sort((a, b) => a.combined - b.combined)
    .slice(0, TOP_N);

  const playedCount  = matches.filter(({ m }) => m.played).length;
  const pendingCount = matches.filter(({ m }) => !m.played && !m.live).length;

  const PHASE_LABEL = {
    groups: "Grupos", r16: "16avos", r4: "Octavos", r2: "Cuartos",
    r34: "Semifinales", r34_final: "Final / 3.º-4.º"
  };

  function buildRows(list) {
    return list.map(({ m, rHome, rAway, combined, rank }) => {
      const phase  = PHASE_LABEL[m.phase] || m.phase || "";
      const flagH  = m.flag_home || "";
      const flagA  = m.flag_away || "";
      const isToday    = !m.played && !m.live && m.date === todayISO;
      const isTomorrow = !m.played && !m.live && m.date === tomorrowISO;

      // Result / status
      let resultHtml;
      if (m.live) {
        const tptMin = calcLiveMinute(m);
        resultHtml = `<span class="tpt-live">EN VIVO${tptMin ? " " + liveMinuteLabel(tptMin) : ""}</span>`;
      } else if (m.played && m.result?.score) {
        resultHtml = `<span class="tpt-score">${escapeHtml(m.result.score)}</span>`;
      } else if (isToday) {
        resultHtml = `<span class="tpt-date tpt-date-hoy"><span class="tpt-hoy-label">HOY</span>${m.time_es ? escapeHtml(m.time_es) : ""}</span>`;
      } else if (isTomorrow) {
        resultHtml = `<span class="tpt-date tpt-date-manana"><span class="tpt-manana-label">MAÑANA</span>${m.time_es ? escapeHtml(m.time_es) : ""}</span>`;
      } else {
        const dateShort = m.date
          ? new Date(m.date + "T12:00:00").toLocaleDateString("es-ES", { day: "numeric", month: "short" })
          : "";
        resultHtml = `<span class="tpt-date">${escapeHtml(dateShort)}${m.time_es ? " · " + escapeHtml(m.time_es) : ""}</span>`;
      }

      // TV badges (same style as matches tab)
      const tvHtml = tvBadgesHtml(m);

      // Phase badge
      const phaseBadge = `<span class="tpt-phase">${escapeHtml(phase)}</span>`;

      // Finalizado chip (top-left overlay on the rank badge)
      const finBadge = m.played && !m.live
        ? `<span class="tpt-fin-badge" title="Partido finalizado">✓</span>` : "";

      // Rank badge color
      const rankCls = rank <= 5 ? "tpt-rank-gold" : rank <= 10 ? "tpt-rank-green" : rank <= 20 ? "tpt-rank-amber" : "tpt-rank-muted";

      return `
        <div class="tpt-row${m.played ? " tpt-played" : ""}${m.live ? " tpt-live-row" : ""}${isToday ? " tpt-row-hoy" : ""}${isTomorrow ? " tpt-row-manana" : ""}"
             role="button" tabindex="0"
             onclick="goToMatchesDay('${escapeHtml(m.date || "")}','${escapeHtml(m.name || "")}')"
             title="Ver partido en la pestaña Partidos">
          <div class="tpt-rank-wrap">
            <div class="tpt-rank ${rankCls}">#${rank}</div>
            ${finBadge}
          </div>
          <div class="tpt-teams">
            <div class="tpt-team tpt-team-home">
              <span class="tpt-flag">${flagH}</span>
              <span class="tpt-name-block">
                <span class="tpt-name">${escapeHtml(m.home || "")}</span>
                <span class="tpt-fifa-rank">#${rHome === 999 ? "—" : rHome}</span>
              </span>
            </div>
            <div class="tpt-vs">
              ${resultHtml}
            </div>
            <div class="tpt-team tpt-team-away">
              <span class="tpt-name-block">
                <span class="tpt-name">${escapeHtml(m.away || "")}</span>
                <span class="tpt-fifa-rank">#${rAway === 999 ? "—" : rAway}</span>
              </span>
              <span class="tpt-flag">${flagA}</span>
            </div>
          </div>
          <div class="tpt-meta">
            ${phaseBadge}
            <div class="tpt-tv-row">${tvHtml}</div>
            <span class="tpt-combined" title="Suma ranking FIFA: ${rHome} + ${rAway}">#${combined} FIFA</span>
            <span class="tpt-go">↗</span>
          </div>
        </div>`;
    }).join("");
  }

  // Add rank to each item before filtering
  const ranked = matches.map((item, idx) => ({ ...item, rank: idx + 1 }));

  // Próximos: pending sorted by date+time asc, up to 10
  const proximosList = ranked
    .filter(({ m }) => !m.played && !m.live)
    .sort((a, b) => {
      const da = (a.m.date || "9999") + "T" + (a.m.time_es || "23:59");
      const db = (b.m.date || "9999") + "T" + (b.m.time_es || "23:59");
      return da.localeCompare(db);
    })
    .slice(0, 10);

  const filtered = _tptFilter === "played"   ? ranked.filter(({ m }) => m.played)
                 : _tptFilter === "pending"  ? ranked.filter(({ m }) => !m.played && !m.live)
                 : _tptFilter === "proximos" ? proximosList
                 : ranked;

  const TPT_FILTERS = [
    { key: "all",      label: "Todos",           count: TOP_N                          },
    { key: "proximos", label: "📅 Próximos",      count: proximosList.length            },
    { key: "played",   label: "✅ Finalizados",   count: playedCount                    },
    { key: "pending",  label: "⏳ Pendientes",    count: pendingCount                   },
  ];

  const filterPills = TPT_FILTERS.map(f => {
    const active = f.key === _tptFilter;
    return `<button class="tpt-filt-btn${active ? " tpt-filt-active" : ""}" data-tptf="${f.key}">${f.label}<span class="tpt-filt-count">${f.count}</span></button>`;
  }).join("");

  container.innerHTML = `
    <div class="card p-5 mb-4">
      <div class="flex flex-col gap-1 mb-1">
        <h2 class="text-lg font-bold text-white">🔥 Top ${TOP_N} partidos del Mundial</h2>
        <p class="text-sm text-gray-400">Clasificados por suma del ranking FIFA — menor suma, mayor calidad del duelo. Pulsa cualquier partido para verlo en detalle.</p>
      </div>
      <div class="flex gap-4 flex-wrap mt-2 mb-3">
        <span class="tpt-legend tpt-rank-gold">Top 5</span>
        <span class="tpt-legend tpt-rank-green">Top 10</span>
        <span class="tpt-legend tpt-rank-amber">Top 20</span>
      </div>
      <div class="tpt-filt-row">${filterPills}</div>
    </div>
    <div class="tpt-list">${buildRows(filtered)}</div>`;

  container.querySelectorAll(".tpt-filt-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      _tptFilter = btn.dataset.tptf;
      renderTopTable();
    });
  });
}

function goToMatchesDay(isoDate, matchName) {
  // 1. Switch to matches tab MANUALLY (avoid the click handler's scroll-to-today)
  document.querySelectorAll(".tab-btn").forEach(b =>
    b.classList.toggle("active", b.dataset.tab === "matches"));
  ["matches","calendar","standings","progression","stats","scenarios","toptable","honor","bracket","teams","bets","scoring","info","h2h"].forEach(t => {
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
  currentWeek = "all";
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
    ["matches","calendar","standings","progression","stats","scenarios","honor","bracket","teams","bets","scoring","info","h2h"].forEach(t => {
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
    ["matches","calendar","standings","progression","stats","scenarios","toptable","honor","bracket","teams","bets","scoring","info","h2h"].forEach(t => {
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
    if (tab === "scenarios" && D) renderScenarios();
    if (tab === "toptable" && D) renderTopTable();
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
function _squadSort(key, dir) {
  const modal = document.getElementById("team-modal");
  if (!modal || !modal._tmPanels) return;
  // Reobtener fifaCode del título actual para reconstruir el HTML
  const titleEl = document.getElementById("team-modal-title");
  if (!titleEl) return;
  // El nombre del equipo está guardado en modal._tmTeamName
  const teamName = modal._tmTeamName;
  if (!teamName) return;
  const fifaCode = TEAM_TO_FIFA[teamName] || "";
  const players = KEY_PLAYERS[fifaCode] || [];
  if (!players.length) return;

  const POS_ORDER = { PO: 0, DF: 1, MC: 2, DC: 3 };
  const POS_LABEL = { PO: "🧤 Porteros", DF: "🛡️ Defensas", MC: "⚙️ Mediocampistas", DC: "⚡ Delanteros" };
  const POS_COLOR = { PO: "#F59E0B", DF: "#3B82F6", MC: "#22C55E", DC: "#EF4444" };

  function parseStat(p) {
    const m = (p.note || "").match(/(\d+)\s*int\.(?:\s*·\s*(\d+)\s*gls)?/);
    return { caps: m ? parseInt(m[1]) : 0, goals: m ? parseInt(m[2] || "0") : 0 };
  }

  let sorted = players.map(p => ({ ...p, ...parseStat(p) }));
  sorted = sorted.slice().sort((a, b) => {
    const av = key === "name" ? a.name : (a[key] ?? 0);
    const bv = key === "name" ? b.name : (b[key] ?? 0);
    if (typeof av === "string") return dir === "asc" ? av.localeCompare(bv, "es") : bv.localeCompare(av, "es");
    return dir === "asc" ? av - bv : bv - av;
  });

  const groups = { PO: [], DF: [], MC: [], DC: [] };
  sorted.forEach(p => { (groups[p.pos] || groups["DC"]).push(p); });

  const thSortClass = (k) => {
    if (k !== key) return "sq-th-sort";
    return `sq-th-sort sq-th-active sq-th-${dir}`;
  };
  const sortAttr = (k) => {
    const newDir = (k === key && dir === "desc") ? "asc" : "desc";
    return `onclick="_squadSort('${k}','${newDir}')"`;
  };

  const sections = Object.keys(groups).filter(pos => groups[pos].length).map(pos => {
    const rows = groups[pos].map((p, i) => `
      <tr>
        <td class="sq-num">${i + 1}</td>
        <td class="sq-name"><button class="player-link-btn" data-player="${escapeHtml(p.name)}">${escapeHtml(p.name)}</button></td>
        <td class="sq-club">${escapeHtml(p.club)}</td>
        <td class="sq-caps">${p.caps || "—"}</td>
        <td class="sq-goals">${p.goals > 0 ? `<span class="sq-goals-val">${p.goals}</span>` : `<span style="color:#374151">—</span>`}</td>
      </tr>`).join("");
    return `
      <div class="sq-pos-section">
        <div class="sq-pos-hd" style="border-left-color:${POS_COLOR[pos]};color:${POS_COLOR[pos]}">${POS_LABEL[pos]}</div>
        <div class="sq-table-wrap">
          <table class="sq-table">
            <thead><tr>
              <th class="sq-num"></th>
              <th class="sq-name-th ${thSortClass("name")}" ${sortAttr("name")}>Jugador${key==="name" ? (dir==="asc"?" ↑":" ↓") : ""}</th>
              <th class="sq-club-th">Club</th>
              <th class="sq-caps-th ${thSortClass("caps")}" ${sortAttr("caps")}>Int.${key==="caps" ? (dir==="asc"?" ↑":" ↓") : ""}</th>
              <th class="sq-goals-th ${thSortClass("goals")}" ${sortAttr("goals")}>Gls.${key==="goals" ? (dir==="asc"?" ↑":" ↓") : ""}</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
  }).join("");

  const newSquad = `<div class="sq-container" data-sort-key="${key}" data-sort-dir="${dir}">${sections}</div>
  <div class="tm-squad-note">📋 Convocatoria oficial FIFA · Copa del Mundo 2026 · Pulsa Int./Gls. para ordenar</div>`;

  modal._tmPanels.squad = newSquad;
  // Si la pestaña activa es 'squad', actualizar el DOM
  const activeSubtab = document.querySelector(".tm-subtab.active");
  if (activeSubtab && activeSubtab.dataset.subtab === "squad") {
    document.getElementById("team-modal-body").innerHTML = newSquad;
  }
}

// ── Modal de Jugador ──────────────────────────────────────────────────────
const _plrCache = {};  // {name: playerData|null}

const _NAT_ES = {
  "Algeria":{"es":"Argelia","flag":"🇩🇿"},"Angola":{"es":"Angola","flag":"🇦🇴"},
  "Argentina":{"es":"Argentina","flag":"🇦🇷"},"Australia":{"es":"Australia","flag":"🇦🇺"},
  "Austria":{"es":"Austria","flag":"🇦🇹"},"Belgium":{"es":"Bélgica","flag":"🇧🇪"},
  "Bolivia":{"es":"Bolivia","flag":"🇧🇴"},"Brazil":{"es":"Brasil","flag":"🇧🇷"},
  "Cameroon":{"es":"Camerún","flag":"🇨🇲"},"Canada":{"es":"Canadá","flag":"🇨🇦"},
  "Chile":{"es":"Chile","flag":"🇨🇱"},"China":{"es":"China","flag":"🇨🇳"},
  "Colombia":{"es":"Colombia","flag":"🇨🇴"},"Costa Rica":{"es":"Costa Rica","flag":"🇨🇷"},
  "Croatia":{"es":"Croacia","flag":"🇭🇷"},"Czech Republic":{"es":"República Checa","flag":"🇨🇿"},
  "Denmark":{"es":"Dinamarca","flag":"🇩🇰"},"Ecuador":{"es":"Ecuador","flag":"🇪🇨"},
  "Egypt":{"es":"Egipto","flag":"🇪🇬"},"England":{"es":"Inglaterra","flag":"🏴󠁧󠁢󠁥󠁮󠁧󠁿"},
  "France":{"es":"Francia","flag":"🇫🇷"},"Germany":{"es":"Alemania","flag":"🇩🇪"},
  "Ghana":{"es":"Ghana","flag":"🇬🇭"},"Greece":{"es":"Grecia","flag":"🇬🇷"},
  "Honduras":{"es":"Honduras","flag":"🇭🇳"},"Hungary":{"es":"Hungría","flag":"🇭🇺"},
  "Indonesia":{"es":"Indonesia","flag":"🇮🇩"},"Iran":{"es":"Irán","flag":"🇮🇷"},
  "Iraq":{"es":"Iraq","flag":"🇮🇶"},"Israel":{"es":"Israel","flag":"🇮🇱"},
  "Italy":{"es":"Italia","flag":"🇮🇹"},"Ivory Coast":{"es":"Costa de Marfil","flag":"🇨🇮"},
  "Jamaica":{"es":"Jamaica","flag":"🇯🇲"},"Japan":{"es":"Japón","flag":"🇯🇵"},
  "Mexico":{"es":"México","flag":"🇲🇽"},"Morocco":{"es":"Marruecos","flag":"🇲🇦"},
  "Netherlands":{"es":"Países Bajos","flag":"🇳🇱"},"New Zealand":{"es":"Nueva Zelanda","flag":"🇳🇿"},
  "Nigeria":{"es":"Nigeria","flag":"🇳🇬"},"Norway":{"es":"Noruega","flag":"🇳🇴"},
  "Panama":{"es":"Panamá","flag":"🇵🇦"},"Paraguay":{"es":"Paraguay","flag":"🇵🇾"},
  "Peru":{"es":"Perú","flag":"🇵🇪"},"Poland":{"es":"Polonia","flag":"🇵🇱"},
  "Portugal":{"es":"Portugal","flag":"🇵🇹"},"Qatar":{"es":"Catar","flag":"🇶🇦"},
  "Romania":{"es":"Rumanía","flag":"🇷🇴"},"Saudi Arabia":{"es":"Arabia Saudí","flag":"🇸🇦"},
  "Scotland":{"es":"Escocia","flag":"🏴󠁧󠁢󠁳󠁣󠁴󠁿"},"Senegal":{"es":"Senegal","flag":"🇸🇳"},
  "Serbia":{"es":"Serbia","flag":"🇷🇸"},"Slovakia":{"es":"Eslovaquia","flag":"🇸🇰"},
  "Slovenia":{"es":"Eslovenia","flag":"🇸🇮"},"South Africa":{"es":"Sudáfrica","flag":"🇿🇦"},
  "South Korea":{"es":"Corea del Sur","flag":"🇰🇷"},"Spain":{"es":"España","flag":"🇪🇸"},
  "Sweden":{"es":"Suecia","flag":"🇸🇪"},"Switzerland":{"es":"Suiza","flag":"🇨🇭"},
  "Tunisia":{"es":"Túnez","flag":"🇹🇳"},"Turkey":{"es":"Turquía","flag":"🇹🇷"},
  "Ukraine":{"es":"Ucrania","flag":"🇺🇦"},"United States":{"es":"Estados Unidos","flag":"🇺🇸"},
  "Uruguay":{"es":"Uruguay","flag":"🇺🇾"},"Uzbekistan":{"es":"Uzbekistán","flag":"🇺🇿"},
  "Venezuela":{"es":"Venezuela","flag":"🇻🇪"},"Wales":{"es":"Gales","flag":"🏴󠁧󠁢󠁷󠁬󠁳󠁿"},
  "Kenya":{"es":"Kenia","flag":"🇰🇪"},"Tanzania":{"es":"Tanzania","flag":"🇹🇿"},
  "Congo DR":{"es":"Congo RD","flag":"🇨🇩"},"United Arab Emirates":{"es":"Emiratos Árabes Unidos","flag":"🇦🇪"},
};

function _getPlayerWorldCupStats(playerName) {
  let goals = 0, pens = 0, matchSet = new Set(), liveGoals = 0;
  (D.matches || []).forEach(m => {
    // Goles confirmados
    if (m.played) {
      (m.scorers || []).forEach(s => {
        if (!s.own_goal && s.player === playerName) {
          goals++;
          if (s.penalty) pens++;
          matchSet.add(m.name);
        }
      });
    }
    // Goles en vivo (partido en curso)
    if (m.live) {
      (m.live_scorers || []).forEach(s => {
        if (!s.own_goal && s.player === playerName) {
          liveGoals++;
          matchSet.add(m.name);
        }
      });
    }
  });
  return { goals, pens, liveGoals, matches: matchSet.size };
}

async function _fetchPlayerData(name) {
  if (name in _plrCache) return _plrCache[name];
  try {
    const q = encodeURIComponent(name);
    const r = await fetch(`https://www.thesportsdb.com/api/v1/json/3/searchplayers.php?p=${q}`);
    const j = await r.json();
    const hit = (j.player || []).find(p => p.strSport === "Soccer");
    if (!hit) { _plrCache[name] = null; return null; }
    // Lookup completo por ID para obtener altura, salario, etc.
    const r2 = await fetch(`https://www.thesportsdb.com/api/v1/json/3/lookupplayer.php?id=${hit.idPlayer}`);
    const j2 = await r2.json();
    const full = (j2.players || [])[0] || hit;
    _plrCache[name] = full;
    return full;
  } catch(e) {
    _plrCache[name] = null;
    return null;
  }
}

function _calcAge(dateBorn) {
  if (!dateBorn) return null;
  const b = new Date(dateBorn);
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return age;
}

function _renderPlayerModal(playerName, apiData) {
  const wc = _getPlayerWorldCupStats(playerName);
  const body = document.getElementById("player-modal-body");
  const title = document.getElementById("player-modal-title");

  const p = apiData;
  const displayName = p ? (p.strPlayer || playerName) : playerName;
  title.textContent = displayName;

  if (!p) {
    body.innerHTML = `
      <div class="plr-wc-goals">
        <div class="plr-wc-icon">⚽</div>
        <div class="plr-wc-text">
          <div class="plr-wc-title">Goles en este Mundial</div>
          <div class="plr-wc-val">${wc.goals}${wc.liveGoals > 0 ? ` <span style="color:#EF4444;font-size:.85rem">+${wc.liveGoals}🔴</span>` : ""}${wc.pens > 0 ? ` <span style="font-size:.8rem;color:#A78BFA">(${wc.pens}P)</span>` : ""}</div>
          <div class="plr-wc-sub">${wc.matches} partido${wc.matches !== 1 ? "s" : ""}</div>
        </div>
      </div>
      <p class="text-xs text-center" style="color:#475569">Sin datos adicionales disponibles para este jugador.</p>`;
    return;
  }

  const age = _calcAge(p.dateBorn);
  const photo = p.strCutout || p.strRender || p.strThumb;
  const photoHtml = photo
    ? `<img class="plr-photo" src="${escapeHtml(photo)}" alt="${escapeHtml(displayName)}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
      + `<div class="plr-photo-placeholder" style="display:none">👤</div>`
    : `<div class="plr-photo-placeholder">👤</div>`;

  const _POS_ES = {
    "Goalkeeper":"Portero","Defender":"Defensa","Centre-Back":"Defensa central",
    "Left-Back":"Lateral izquierdo","Right-Back":"Lateral derecho",
    "Midfielder":"Centrocampista","Defensive Midfielder":"Mediocampista defensivo",
    "Central Midfielder":"Mediocampista central","Attacking Midfielder":"Mediapunta",
    "Left Midfielder":"Extremo izquierdo","Right Midfielder":"Extremo derecho",
    "Forward":"Delantero","Centre-Forward":"Delantero centro","Striker":"Delantero",
    "Left Winger":"Extremo izquierdo","Right Winger":"Extremo derecho","Winger":"Extremo",
  };
  const pos = p.strPosition || "";
  const posEs = _POS_ES[pos] || pos;
  const nat = p.strNationality || "";
  const natInfo = nat ? (_NAT_ES[nat] || null) : null;
  const natDisplay = nat ? `${natInfo ? natInfo.flag : "🌍"} ${natInfo ? natInfo.es : nat}` : "";
  const club = p.strTeam || "";
  const number = p.strNumber ? `#${p.strNumber}` : "";
  const height = p.strHeight ? p.strHeight.replace(/ \/ .+/, "") : "";
  // Peso: extrae kg si viene "(74 kg)", si no convierte lbs → kg
  const weightRaw = p.strWeight || "";
  const weightKg = (() => {
    const kg = weightRaw.match(/\((\d+)\s*kg\)/i);
    if (kg) return `${kg[1]} kg`;
    const lbs = weightRaw.match(/(\d+)\s*lb/i);
    if (lbs) return `${Math.round(parseInt(lbs[1]) / 2.205)} kg`;
    return weightRaw;
  })();
  const side = p.strSide ? (p.strSide === "Left" ? "Zurdo" : p.strSide === "Right" ? "Diestro" : "Ambidiestro") : "";
  const wage  = p.strWage || "";
  const signing = p.strSigning || "";
  const bioEs = p.strDescriptionES || "";
  const bioEn = p.strDescriptionEN || "";
  const bio = bioEs || bioEn;
  const bioLang = bioEs ? "" : (bioEn ? " (EN)" : "");
  const shortBio = bio.length > 400 ? bio.slice(0, 400).replace(/\s+\S+$/, "") + "…" : bio;

  const details = [];
  if (club) details.push({ lbl: "Club", val: `${club}${number ? " · " + number : ""}` });
  if (posEs) details.push({ lbl: "Posición", val: posEs });
  if (age)  details.push({ lbl: "Edad", val: `${age} años` });
  if (height) details.push({ lbl: "Altura", val: height });
  if (side) details.push({ lbl: "Pie", val: side });
  if (weightKg) details.push({ lbl: "Peso", val: weightKg });
  if (signing) details.push({ lbl: "Fichaje", val: signing });
  if (wage)    details.push({ lbl: "Salario sem.", val: wage });

  const detailsHtml = details.map(d =>
    `<div class="plr-detail"><div class="plr-detail-lbl">${escapeHtml(d.lbl)}</div><div class="plr-detail-val">${escapeHtml(d.val)}</div></div>`
  ).join("");

  body.innerHTML = `
    <div class="plr-hero">
      ${photoHtml}
      <div class="plr-info">
        <div class="plr-name">${escapeHtml(displayName)}</div>
        ${natDisplay ? `<div class="plr-nat">${escapeHtml(natDisplay)}</div>` : ""}
        <div class="plr-stats">${_playerStatsHtml(wc)}</div>
      </div>
    </div>
    ${details.length ? `<div class="plr-details">${detailsHtml}</div>` : ""}
    ${shortBio ? `<div class="plr-bio">${escapeHtml(shortBio)}${bioLang ? `<span style="color:#475569;font-size:.65rem;margin-left:.4rem">${bioLang}</span>` : ""}</div>` : ""}`;
}

function _refreshOpenPlayerModal() {
  const modal = document.getElementById("player-modal");
  if (!modal || modal.classList.contains("hidden")) return;
  const name = modal._currentPlayerName;
  if (!name) return;
  // Solo refresca las stats (no vuelve a llamar a la API)
  const wc = _getPlayerWorldCupStats(name);
  const statsEl = modal.querySelector(".plr-stats");
  if (!statsEl) return;
  statsEl.innerHTML = _playerStatsHtml(wc);
}

function _playerStatsHtml(wc) {
  const liveTag = wc.liveGoals > 0
    ? `<div class="plr-stat" style="border-color:rgba(239,68,68,.4);background:rgba(239,68,68,.1)">
         <span class="plr-stat-val" style="color:#EF4444">${wc.liveGoals}</span>
         <span class="plr-stat-lbl" style="color:#F87171">En vivo 🔴</span>
       </div>`
    : "";
  const pens = wc.pens > 0
    ? `<div class="plr-stat"><span class="plr-stat-val">${wc.pens}</span><span class="plr-stat-lbl">Penaltis</span></div>`
    : "";
  return `
    <div class="plr-stat"><span class="plr-stat-val">${wc.goals}</span><span class="plr-stat-lbl">Goles MUN</span></div>
    ${liveTag}${pens}
    <div class="plr-stat"><span class="plr-stat-val">${wc.matches}</span><span class="plr-stat-lbl">Partidos</span></div>`;
}

async function openPlayerModal(playerName) {
  if (!playerName) return;
  const modal = document.getElementById("player-modal");
  const body  = document.getElementById("player-modal-body");
  const title = document.getElementById("player-modal-title");
  modal._currentPlayerName = playerName;
  title.textContent = playerName;
  body.innerHTML = `<div class="plr-loading"><div class="plr-spin">⏳</div><br>Buscando datos…</div>`;
  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";

  const data = await _fetchPlayerData(playerName);
  // Check modal still open (user may have closed it)
  if (modal.classList.contains("hidden")) return;
  _renderPlayerModal(playerName, data);
}

function closePlayerModal() {
  const modal = document.getElementById("player-modal");
  if (modal) { modal.classList.add("hidden"); modal._currentPlayerName = null; }
  document.body.style.overflow = "";
}
// ─────────────────────────────────────────────────────────────────────────────

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

  // ── Plantilla (lista por posición, ordenable) ──────────────
  const fifaCode = TEAM_TO_FIFA[teamName] || "";
  const players  = KEY_PLAYERS[fifaCode] || [];

  function _buildSquadHtml(sortKey, sortDir) {
    if (!players.length) return `<div class="tm-empty-panel">Sin datos de plantilla disponibles</div>`;

    const POS_ORDER = { PO: 0, DF: 1, MC: 2, DC: 3 };
    const POS_LABEL = { PO: "🧤 Porteros", DF: "🛡️ Defensas", MC: "⚙️ Mediocampistas", DC: "⚡ Delanteros" };
    const POS_COLOR = { PO: "#F59E0B", DF: "#3B82F6", MC: "#22C55E", DC: "#EF4444" };

    // Parsear "caps" de note: "104 int. · 0 gls" → caps=104, goals=0
    function parseStat(p) {
      const m = (p.note || "").match(/(\d+)\s*int\.(?:\s*·\s*(\d+)\s*gls)?/);
      return { caps: m ? parseInt(m[1]) : 0, goals: m ? parseInt(m[2] || "0") : 0 };
    }

    let sorted = players.map(p => ({ ...p, ...parseStat(p) }));
    if (sortKey) {
      sorted = sorted.slice().sort((a, b) => {
        const av = sortKey === "name" ? a.name : (a[sortKey] ?? 0);
        const bv = sortKey === "name" ? b.name : (b[sortKey] ?? 0);
        if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv, "es") : bv.localeCompare(av, "es");
        return sortDir === "asc" ? av - bv : bv - av;
      });
    }

    const groups = { PO: [], DF: [], MC: [], DC: [] };
    sorted.forEach(p => { (groups[p.pos] || groups["DC"]).push(p); });

    const thSortClass = (k) => {
      if (k !== sortKey) return "sq-th-sort";
      return `sq-th-sort sq-th-active sq-th-${sortDir}`;
    };
    const sortAttr = (k) => {
      const newDir = (k === sortKey && sortDir === "desc") ? "asc" : "desc";
      return `onclick="_squadSort('${k}','${newDir}')"`;
    };

    const sections = Object.keys(groups).filter(pos => groups[pos].length).map(pos => {
      const rows = groups[pos].map((p, i) => `
        <tr>
          <td class="sq-num">${i + 1}</td>
          <td class="sq-name"><button class="player-link-btn" data-player="${escapeHtml(p.name)}">${escapeHtml(p.name)}</button></td>
          <td class="sq-club">${escapeHtml(p.club)}</td>
          <td class="sq-caps">${p.caps || "—"}</td>
          <td class="sq-goals">${p.goals > 0 ? `<span class="sq-goals-val">${p.goals}</span>` : `<span style="color:#374151">—</span>`}</td>
        </tr>`).join("");
      return `
        <div class="sq-pos-section">
          <div class="sq-pos-hd" style="border-left-color:${POS_COLOR[pos]};color:${POS_COLOR[pos]}">${POS_LABEL[pos]}</div>
          <div class="sq-table-wrap">
            <table class="sq-table">
              <thead><tr>
                <th class="sq-num"></th>
                <th class="sq-name-th ${thSortClass("name")}" ${sortAttr("name")}>Jugador${sortKey==="name" ? (sortDir==="asc"?" ↑":" ↓") : ""}</th>
                <th class="sq-club-th">Club</th>
                <th class="sq-caps-th ${thSortClass("caps")}" ${sortAttr("caps")}>Int.${sortKey==="caps" ? (sortDir==="asc"?" ↑":" ↓") : ""}</th>
                <th class="sq-goals-th ${thSortClass("goals")}" ${sortAttr("goals")}>Gls.${sortKey==="goals" ? (sortDir==="asc"?" ↑":" ↓") : ""}</th>
              </tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>`;
    }).join("");

    return `<div class="sq-container" data-sort-key="${sortKey || ""}" data-sort-dir="${sortDir || ""}">${sections}</div>
    <div class="tm-squad-note">📋 Convocatoria oficial FIFA · Copa del Mundo 2026 · Pulsa Int./Gls. para ordenar</div>`;
  }

  const squadHtml = _buildSquadHtml("", "desc");

  // ── Técnico / seleccionador ──────────────────────────────────
  const coach = COACHES[fifaCode];
  const coachHtml = coach ? `
    <div class="tm-coach-card">
      <div class="tm-coach-avatar">🧑‍💼</div>
      <div class="tm-coach-info">
        <div class="tm-coach-name">${coach.name}</div>
        <div class="tm-coach-nat">${coach.nat}</div>
        <div class="tm-coach-since">Seleccionador desde ${coach.since}</div>
        ${coach.note ? `<div class="tm-coach-note">${coach.note}</div>` : ""}
      </div>
    </div>` :
    `<div class="tm-empty-panel">Sin datos del técnico disponibles</div>`;

  // Guardar paneles para el sistema de subpestañas
  const matchesContent = statsHtml + groupHtml + playedHtml + pendingHtml + r16Html;
  document.getElementById("team-modal-title").innerHTML = `${flag} ${teamName}`;

  // Reset subpestañas a "Partidos" por defecto
  document.querySelectorAll(".tm-subtab").forEach(b => b.classList.remove("active"));
  document.querySelector('.tm-subtab[data-subtab="matches"]')?.classList.add("active");
  document.getElementById("team-modal-body").innerHTML = matchesContent;

  // Guardar los tres paneles en el modal para poder cambiar sin recomputar
  const modal = document.getElementById("team-modal");
  modal._tmPanels = { matches: matchesContent, squad: squadHtml, coach: coachHtml };
  modal._tmTeamName = teamName;
  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function switchTeamSubtab(subtab) {
  const modal = document.getElementById("team-modal");
  if (!modal || !modal._tmPanels) return;
  document.getElementById("team-modal-body").innerHTML = modal._tmPanels[subtab] || "";
  document.querySelectorAll(".tm-subtab").forEach(b =>
    b.classList.toggle("active", b.dataset.subtab === subtab));
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
        <div class="overflow-x-auto">
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
      </div>
      <div class="flex flex-col gap-0.5 mt-1.5">
        <div class="grp-legend-item grp-legend-qual">🟢 Top 2 — clasificados directamente</div>
        ${thirdLegend}
        ${table.some(t => t.tieNote === "lots") ? `<div class="grp-legend-item" style="color:#94A3B8">🎲 <strong>sorteo</strong> — equipos totalmente igualados; posici\u00f3n provisional decidida por sorteo FIFA</div>` : ""}
      </div>
    </div>`;

  // ── HTML partidos: una subtabla por jornada ───────────────────
  const jornadas = [...new Set(matches.map(m => m.id))].sort();
  const matchesHtml = `
    <div>
      <div class="text-xs font-bold uppercase tracking-widest text-gray-500 mb-2">Partidos <span class="text-gray-700 normal-case font-normal">· pulsa para ver detalle del partido completo</span></div>
      <div class="grp-jornadas">
        ${jornadas.map(jid => {
          const jMatches = matches.filter(m => m.id === jid);
          return `
            <div class="card overflow-hidden grp-jornada-block">
              <div class="grp-jornada-hd">Jornada ${jid.slice(1)}</div>
              <table class="tm-match-table">
                <tbody>
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
                    return `
                      <tr class="${played ? "tm-mt-played" : ""} ${m.date ? "grp-match-link" : ""}" ${dataAttrs} title="${m.date ? "Ver detalle del partido completo" : ""}">
                        <td class="tm-mt-home">${m.flag_home || ""} ${m.home}</td>
                        <td class="${played ? "tm-mt-score" : (liveSc ? "tm-mt-score tm-mt-live" : "tm-mt-score tm-mt-pending")}">${played ? `${gh}–${ga}` : (liveSc ? `🔴 ${m.live_goals_l}-${m.live_goals_v}` : (m.time_es || "—"))}</td>
                        <td class="tm-mt-away">${m.away} ${m.flag_away || ""}</td>
                        <td class="tm-mt-date">${dateFmt}</td>
                      </tr>`;
                  }).join("")}
                </tbody>
              </table>
            </div>`;
        }).join("")}
      </div>
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
  const st = (data.standings || []).slice().sort((a, b) => (b.total || 0) - (a.total || 0) || (a.pos || 0) - (b.pos || 0));
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
  const playerBtn = e.target.closest(".player-link-btn");
  if (playerBtn && playerBtn.dataset.player) {
    e.stopPropagation();
    openPlayerModal(playerBtn.dataset.player);
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
  const playerModal = document.getElementById("player-modal");
  if (playerModal && !playerModal.classList.contains("hidden") && e.target === playerModal) closePlayerModal();
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


  const API_WINDOW_H = 48;
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
    apiLogBody = `<div class="adm-empty">Sin llamadas a la API en las últimas 48 h<br><span class="adm-rel">(${apiLogAll.length} en el histórico)</span></div>`;
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
        📡 Llamadas a la API <span class="adm-badge">últimas 48 h</span>
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
        ${played.length ? [...played].sort((a, b) =>
          `${b.date || ""} ${b.time_es || ""}`.localeCompare(`${a.date || ""} ${a.time_es || ""}`)
        ).map(m => {
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

  // Botón cambio de modo
  const btn = document.getElementById("mode-switch-btn");
  if (btn) {
    if (guest) {
      btn.textContent = "🏆 Ir a la Porra";
      btn.className = "mode-switch-btn to-porra";
    } else {
      btn.textContent = "🌍 Solo el Mundial";
      btn.className = "mode-switch-btn to-public";
    }
  }

  // Si el invitado está en una pestaña exclusiva de la porra, llévalo a Partidos
  if (guest) {
    const active = document.querySelector(".tab-btn.active");
    if (active && PORRA_ONLY_TABS.includes(active.dataset.tab)) {
      document.querySelector('.tab-btn[data-tab="matches"]')?.click();
    }
  }
}

function toggleAppMode() {
  const newMode = document.body.classList.contains("mode-porra") ? "guest" : "porra";
  _setStoredMode(newMode);
  applyAppMode(newMode);
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

  // 2) Sin enlace especial y sin elección previa → porra por defecto.
  if (!mode) { mode = "porra"; _setStoredMode("porra"); }

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


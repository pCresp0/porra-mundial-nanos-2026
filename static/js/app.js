/* ═══════════════════════════════════════════════════════════════
   GLOBAL STATE
═══════════════════════════════════════════════════════════════ */
let D = null;  // full data
const IS_GH_PAGES = location.hostname.endsWith("github.io");
const DATA_URL = IS_GH_PAGES ? "data.json" : "/api/data";
const VISITOR_API = "https://page-views-api.ratneshc.com/api/v1";
const VISITOR_SITE = "porra-mundial-nanos-2026";
const VISITOR_PATH = "/porra-mundial-nanos-2026";
let progressionChart = null;
let hitRateChart = null;
let phaseChart = null;
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

function todaySpainISO() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Madrid" });
}

function addDaysISO(iso, n) {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
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
  selectedTeamFilter = team;
  const input = document.getElementById("team-search-input");
  const clearBtn = document.getElementById("team-search-clear");
  if (input) input.value = `${team.flag} ${team.name}`;
  if (clearBtn) clearBtn.classList.remove("hidden");
  hideTeamSuggestions();
  resetMatchesDayWindow();
  scrollMatchesToToday = false;
  renderMatches(currentPhase, currentWeek);
}

function clearTeamFilter() {
  selectedTeamFilter = null;
  const input = document.getElementById("team-search-input");
  const clearBtn = document.getElementById("team-search-clear");
  if (input) input.value = "";
  if (clearBtn) clearBtn.classList.add("hidden");
  hideTeamSuggestions();
  resetMatchesDayWindow();
  scrollMatchesToToday = true;
  renderMatches(currentPhase, currentWeek);
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
    blurTimer = setTimeout(hideTeamSuggestions, 160);
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

function scrollToTodayInMatches() {
  const today = todaySpainISO();
  const sections = [...document.querySelectorAll("[data-day-date]")];
  if (!sections.length) return;

  let target = document.getElementById(`day-${today}`);
  if (!target) {
    const dated = sections
      .map(el => ({ el, d: el.dataset.dayDate }))
      .filter(x => x.d && x.d !== "sin-fecha")
      .sort((a, b) => a.d.localeCompare(b.d));
    target = dated.find(x => x.d >= today)?.el
          || [...dated].reverse().find(x => x.d < today)?.el
          || sections[0];
  }
  if (target) {
    const navH = document.querySelector("nav")?.offsetHeight || 0;
    const top  = target.getBoundingClientRect().top + window.scrollY - navH - 16;
    window.scrollTo({ top, behavior: "smooth" });
  }
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
      const newSig = JSON.stringify(json.standings) + JSON.stringify(json.progression);
      if (newSig === _lastDataSig) return;
      _lastDataSig = newSig;
      const scrollY = window.scrollY;
      D = json;
      render();
      window.scrollTo({ top: scrollY, behavior: "instant" });
      return;
    }

    D = json;
    _lastDataSig = JSON.stringify(json.standings) + JSON.stringify(json.progression);
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
  renderPodium();
  renderStandingsTable();
  renderPlayerStrengths();
  renderWeekFilter();
  initCountdown();
  renderMatches(currentPhase, currentWeek);
  renderCalendar();
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

/** Última y próxima ejecución cada 30 min (:00 o :30) según hora España. */
function naturalHourSlots() {
  const { h, m } = spainHourMinute();
  const lastMin = m < 30 ? 0 : 30;
  const last = `${String(h).padStart(2, "0")}:${String(lastMin).padStart(2, "0")}`;
  let nextH = h, nextMin;
  if (m < 30) { nextMin = 30; }
  else { nextMin = 0; nextH = (h + 1) % 24; }
  const next = `${String(nextH).padStart(2, "0")}:${String(nextMin).padStart(2, "0")}`;
  const mins = m < 30 ? 30 - m : 60 - m;
  return { last, next, mins };
}

let _countdownTimer = null;

function tickBanner() {
  const upd = D?.meta?.update || {};
  const lastEl = document.getElementById("upd-last");
  const minsEl = document.getElementById("upd-mins");
  const nextEl = document.getElementById("upd-next");

  // "Actualizada a las" → solo cuando hay datos reales (last_updated del JSON).
  // Si no hay datos cargados todavía, cae al cálculo local como fallback.
  if (lastEl) {
    lastEl.textContent = upd.last_updated_time || naturalHourSlots().last;
  }

  // "Próxima actualización" y el countdown siempre se calculan en tiempo real.
  const { next, mins } = naturalHourSlots();
  if (nextEl) nextEl.textContent = upd.next_update_time || next;
  if (minsEl) minsEl.textContent = String(mins);
}

function startCountdown() {
  tickBanner();
  if (_countdownTimer) clearInterval(_countdownTimer);
  _countdownTimer = setInterval(tickBanner, 30000);
}

function renderMeta() {
  const upd = D?.meta?.update;
  const banner = document.getElementById("update-banner");

  if (banner) banner.classList.remove("hidden");

  startCountdown();

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
  const top3 = D.standings.slice(0, 3);
  const order  = [{ idx: 1, cls: "podium-2nd", medal: "🥈" },
                  { idx: 0, cls: "podium-1st", medal: "🥇" },
                  { idx: 2, cls: "podium-3rd", medal: "🥉" }];

  container.innerHTML = order.map(({ idx, cls, medal }) => {
    const p = top3[idx];
    if (!p) return "";
    const rankLbl = idx === 0 ? "1º" : idx === 1 ? "2º" : "3º";
    return `
      <div class="podium-col ${cls}">
        <div class="podium-player">
          <div class="text-3xl mb-1">${medal}</div>
          <div class="bebas text-2xl tracking-wide" style="color:${p.color}">${p.name}</div>
          <div class="podium-score bebas" style="color:${p.color};font-size:1.1rem;opacity:.85">${p.total} pts</div>
        </div>
        <div class="podium-block" aria-label="${rankLbl} puesto">${rankLbl}</div>
      </div>`;
  }).join("");

  const rest = D.standings.slice(3);
  restEl.innerHTML = rest.map(p => `
    <div class="card p-3 flex items-center justify-between" style="border-left:3px solid ${p.color}">
      <div>
        <span class="text-xs text-gray-500 font-bold">#${p.pos}</span>
        <span class="font-bold text-white ml-2">${p.name}</span>
      </div>
      <span class="bebas text-xl" style="color:${p.color}">${p.total}</span>
    </div>`).join("");
}

function matchTeamsHtml(m) {
  const home = m.home || (m.name.includes("-") ? m.name.split("-")[0].trim() : m.name);
  const away = m.away || (m.name.includes("-") ? m.name.split("-").slice(1).join("-").trim() : "");
  const fh = m.flag_home || "🏳️";
  const fa = m.flag_away || "🏳️";
  const isLive = _liveMatchIds && _liveMatchIds.has(m.name);
  let scoreHtml;
  if (m.played && m.result) {
    scoreHtml = `<div class="match-score-big">${m.result.score.replace("-", " - ")}</div>`;
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
        <span class="match-team-name">${home}</span>
        <span class="match-vs">vs</span>
        <span class="match-team-name">${away}</span>
        <span class="match-flag">${fa}</span>
      </div>
      ${scoreHtml}
      ${matchScorersHtml(m)}
    </div>`;
}

function matchScorersHtml(m) {
  if (!m.played || !Array.isArray(m.scorers) || !m.scorers.length) return "";

  function fmtMinute(raw) {
    // "45'+5'" → <span>45'</span><span class="ms-extra">+5'</span>
    // "90'+8'" → same pattern
    // "31'"    → just the minute
    if (!raw) return "";
    const et = raw.match(/^(\d+)'\+(\d+)'$/);
    if (et) return `${et[1]}'<span class="ms-extra">+${et[2]}'</span>`;
    return escapeHtml(raw);
  }

  function fmtLine(s) {
    const isOG = s.own_goal;
    const icon = isOG ? '<span class="ms-og-icon">⚽</span>' : "⚽";
    const name = `<span class="ms-name${isOG ? " ms-og" : ""}">${escapeHtml(s.player)}${isOG ? ' <span class="ms-og-tag">PP</span>' : ""}</span>`;
    const min  = s.minute ? `<span class="ms-min">${fmtMinute(s.minute)}</span>` : "";
    return `<div class="ms-line">${icon} ${name}${min}</div>`;
  }

  const homeS = m.scorers.filter(s => s.team === "home");
  const awayS = m.scorers.filter(s => s.team === "away");
  if (!homeS.length && !awayS.length) return "";
  const col = (arr, align) => `<div class="ms-col" style="text-align:${align}">${arr.map(fmtLine).join("")}</div>`;
  return `<div class="match-scorers">${col(homeS, "right")}<div class="ms-sep"></div>${col(awayS, "left")}</div>`;
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
  if (m.tv === "both") {
    parts.push(tvBadgeLink("dazn", "DAZN") + tvBadgeLink("tve", "TVE"));
  } else if (m.tv === "tve") {
    parts.push(tvBadgeLink("tve", "TVE"));
  } else if (m.tv === "dazn") {
    parts.push(tvBadgeLink("dazn", "DAZN"));
  }
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
  tbody.innerHTML = rows.map(r => {
    const medal = r.pos <= 3 ? MEDAL[r.pos - 1] + " " : "";
    return `<tr>
      <td class="font-bold" style="color:${r.color}">${r.pos}</td>
      <td class="text-left font-semibold text-white">${medal}${r.name}</td>
      <td class="font-extrabold text-lg" style="color:${r.color}">${fmt(r.total)}</td>
      <td>${fmt(r.groups)}</td>
      <td>${fmt(r.s1x2)}</td>
      <td>${fmt(r.sdiff)}</td>
      <td>${fmt(r.sexact)}</td>
      <td>${fmt(r.positions)}</td>
    </tr>`;
  }).join("");
  _syncStandingsSortIndicators();
}

/* Desglose de puntos por motivo (1X2 / diferencia / exacto) a partir de
   los partidos de grupos jugados, más los datos de la clasificación. */
function _standingsRows() {
  const gm = (D.matches || []).filter(m => m.phase === "groups" && m.played);
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
    return {
      pos: p.pos, name: p.name, color: p.color,
      total: +p.total || 0, groups: +p.groups || 0,
      positions: +p.positions || 0,
      s1x2, sdiff, sexact,
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

  // Mini leaderboards — only skills with activity, top 3 each
  const activeSkills = (ps.skills || []).filter(sk => {
    const rows = ps.rankings[sk.key] || [];
    return rows.some(r => r.value > 0);
  });
  rankEl.innerHTML = activeSkills.map(sk => {
    const rows = (ps.rankings[sk.key] || []).filter(r => r.value > 0).slice(0, 3);
    if (!rows.length) return "";
    const pillClass = r => r.rank === 1 ? "rank-pill-1" : r.rank === 2 ? "rank-pill-2" : "rank-pill-3";
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

  // Auto-select the current week on first render
  if (currentWeek === "all" && weeks.length) {
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

/* ─── PROGRESSION CHART (por partido) ─── */
function renderProgression() {
  const players = D.meta.players;
  const colors  = D.meta.colors;
  const prog    = D.progression;
  const allLabels = prog.labels || [];
  const allDates  = prog.dates  || [];
  const allTitles = prog.titles || [];

  // Cut to today — no future data
  const todayStr = todaySpainISO();
  let cutIdx = allDates.length - 1;
  for (let i = 0; i < allDates.length; i++) {
    if (allDates[i] > todayStr) { cutIdx = i - 1; break; }
  }
  cutIdx = Math.max(0, cutIdx);
  const labels = allLabels.slice(0, cutIdx + 1);
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
          ticks: { color: "#475569", font: { size: 10 }, maxRotation: 60, minRotation: 45 }
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
  cardsEl.innerHTML = D.standings.map(p => {
    const series = prog.players?.[p.name] || [];
    const last   = series.at(-1) || 0;
    const prev   = series.length > 1 ? series.at(-2) : 0;
    const todayDelta = prog.day_points?.[p.name]?.at(-1) || 0;
    const pct  = Math.round((last / maxTotal) * 100);
    const matchesPl = p.played || 0;
    const avg = matchesPl > 0 ? (p.groups / matchesPl).toFixed(1) : "—";
    return `
      <div class="card p-4 text-center">
        <div class="text-xs text-gray-400 uppercase font-bold tracking-wider mb-2">${p.name}</div>
        <div class="bebas text-3xl" style="color:${p.color}">${last}</div>
        <div class="text-xs text-gray-500 mb-1">acumulado</div>
        ${todayDelta > 0 ? `<div class="text-xs font-bold mb-2" style="color:var(--green)">+${todayDelta} último partido</div>` : `<div class="mb-2"></div>`}
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
  const visibleStart = addDaysISO(today, -1 - matchesDaysBefore);
  const visibleEnd   = addDaysISO(today,  1 + matchesDaysAfter);

  const dayISO = key => {
    const iso = byDay[key][0]?.date;
    return iso && iso.length >= 10 ? iso : null;
  };

  const datedKeys = dayKeys.filter(k => k !== NO_DATE);
  const filterDates = datedKeys.map(dayISO).filter(Boolean);
  const todayInFilter = filterDates.length
    ? today >= filterDates[0] && today <= filterDates[filterDates.length - 1]
    : false;

  let visibleDayKeys, hiddenBefore, hiddenAfter;
  if (teamMode) {
    visibleDayKeys = datedKeys;
    hiddenBefore = [];
    hiddenAfter  = [];
  } else if (todayInFilter) {
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
    ? `<div class="team-filter-banner">Mostrando <strong>${selectedTeamFilter.flag} ${selectedTeamFilter.name}</strong> · ${filtered.length} partido${filtered.length !== 1 ? "s" : ""}</div>`
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
  const isLiveMatch = !m.played && _liveMatchIds && _liveMatchIds.has(m.name);
  const playedClass = m.played ? "played" : "";
  const liveClass = isLiveMatch ? " live-match" : "";
  const isNextMatch = !m.played && !isLiveMatch && _nextMatchId && (m.id === _nextMatchId || m.name === _nextMatchId);

  const playerCards = players.map(name => {
    const pd = m.predictions[name];
    if (!pd || !pd.pred) {
      return `<div class="player-pred-card opacity-40">
        <div class="pname" style="color:${colors[name]}">${name}</div>
        <span class="text-xs text-gray-600">—</span>
      </div>`;
    }
    let badgeClass = "badge-pending";
    if (m.played) {
      if (pd.score > 0) {
        const isExact = m.result && pd.pred.score === m.result.score;
        badgeClass = isExact ? "badge-exact" : "badge-sign";
      } else {
        badgeClass = "badge-miss";
      }
    }
    const predTxt = pd.pred.score || pd.pred.sign;

    let brkHtml = "";
    if (m.played && pd.breakdown && pd.breakdown.reasons.length) {
      const shortReason = r => r
        .replace("1X2 correcto", "1X2 ✓")
        .replace("1X2 incorrecto", "1X2 ✗")
        .replace("Diferencia de goles no acertada", "Dif. goles ✗")
        .replace("Diferencia de goles acertada", "Dif. goles ✓")
        .replace(/Diferencia.*?\(/, "Dif. (")
        .replace("Resultado exacto", "Exacto ✓")
        .replace("Resultado no exacto", "Exacto ✗")
        .replace(/(\d+)\.\d+/g, "$1");
      brkHtml = `<div class="mt-1 flex flex-wrap justify-center gap-0.5">
        ${pd.breakdown.reasons.map(r =>
          `<span class="brk-chip ${r.includes('incorrecto')||r.includes('no acertada')?'miss':'ok'}">${shortReason(r)}</span>`
        ).join("")}
      </div>`;
    } else if (m.played && pd.score === 0) {
      brkHtml = `<div class="mt-1"><span class="brk-chip miss">0 pts</span></div>`;
    }

    return `<div class="player-pred-card">
      <div class="pname" style="color:${colors[name]}">${name}</div>
      <span class="${badgeClass} px-2 py-0.5 rounded text-xs font-mono">${predTxt}</span>
      ${m.played ? `<div class="text-base font-extrabold mt-1" style="color:${pd.score > 0 ? colors[name] : '#EF4444'}">${pd.score > 0 ? "+"+pd.score : "✗"}</div>` : ""}
      ${brkHtml}
    </div>`;
  }).join("");

  return `
    <div class="card match-row ${playedClass}${liveClass}${isNextMatch ? " next-match" : ""} p-4 mb-2" data-match-name="${(m.name||"").replace(/"/g,"&quot;")}">
      ${isNextMatch ? `<div class="card-corner-tag"><span class="text-xs font-bold next-match-tag">⏱ Próximo partido</span></div>` : (m.played ? `<div class="card-corner-tag"><span class="text-xs font-bold finished-tag">✓ Finalizado</span></div>` : "")}
      ${matchTeamsHtml(m)}
      ${matchMetaHtml(m)}
      <div class="flex items-center gap-2 flex-wrap mb-3 justify-center">
        <span class="text-xs px-2 py-0.5 rounded font-bold uppercase tracking-wide"
              style="background:var(--card2);color:#94A3B8">${PHASE_LABELS[m.phase] || m.phase}</span>
        ${isLiveMatch ? `<span class="text-xs font-bold live-tag"><span class="live-ball">⚽</span> En Curso</span>` : ""}
        ${(!m.played && !isLiveMatch) ? `<span class="text-xs text-gray-600">⏳ Pendiente</span>` : ""}
      </div>
      <div class="match-players-grid">${playerCards}</div>
    </div>`;
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
      html += `<div class="venue-stat"><div class="venue-stat-label">Área metro</div><div class="venue-stat-value">${m.city_pop}</div></div>`;
    }
    html += `</div>`;

    if (m.venue_fact) {
      html += `<div class="venue-fact-text">💡 ${m.venue_fact}</div>`;
    }
    html += `</div>`;
  }

  // ── Scorers (from live API) ───────────────────────────────────────────────
  if (m.played || game?.finished === "TRUE") {
    const homeScorers = parseScorers(game?.home_scorers);
    const awayScorers = parseScorers(game?.away_scorers);
    const homeFlag = m.flag_home || "🏳️";
    const awayFlag = m.flag_away || "🏳️";
    const home = m.home || "Local";
    const away = m.away || "Visitante";

    html += `<div class="panel-section">
      <div class="panel-section-title">⚽ Goleadores</div>`;

    if (!homeScorers.length && !awayScorers.length) {
      html += `<p class="no-scorers">Sin datos de goleadores disponibles</p>`;
    } else {
      const renderScorerRow = (flag, teamName, scorers) => {
        const names = scorers.length
          ? scorers.map(s => {
              const match = s.match(/^(.*?)\s+(\d+['+]?)$/);
              const name = match ? match[1] : s;
              const time = match ? match[2] : "";
              return `<span class="scorer-name">${escapeHtml(name)}</span>${time ? `<span class="scorer-time">${escapeHtml(time)}</span>` : ""}`;
            }).join(" · ")
          : `<span class="no-scorers">Sin goles</span>`;
        return `<div class="scorer-team-row">
          <span class="scorer-flag">${flag}</span>
          <div class="scorer-list"><span style="color:#64748B;font-size:.7rem">${teamName}:</span> ${names}</div>
        </div>`;
      };
      html += renderScorerRow(homeFlag, home, homeScorers);
      html += renderScorerRow(awayFlag, away, awayScorers);
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

// Close panel on Escape key
document.addEventListener("keydown", e => {
  if (e.key === "Escape") closeMatchDetail();
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
        ? `<div class="honor-consensus mt-2">💬 Apuesta del grupo: <strong class="text-gray-200">${h.consensus}</strong> (${h.consensus_count}/${h.filled_count})</div>`
        : "";

      const rows = (h.predictions_list || []).map(p => {
        const icon = h.resolved ? (p.correct ? "✓" : "✗") : "·";
        const iconColor = h.resolved ? (p.correct ? "var(--green)" : "var(--red)") : "#64748B";
        return `<div class="honor-pred-row">
          <span class="font-bold truncate" style="color:${p.color}">${p.name}</span>
          <span class="text-gray-200 truncate text-right">${p.pred}</span>
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

/* ─── TREND FORECAST ─── */
function renderTrendForecast() {
  const el = document.getElementById("trend-forecast");
  if (!el || !D) return;

  const colors = D.meta.colors;
  const players = D.meta.players;
  const standings = D.standings;
  const prog = D.progression || {};
  const dayPts = prog.day_points || {};
  const series = prog.players || {};

  const groupMatches = D.matches.filter(m => m.phase === "groups");
  const played = groupMatches.filter(m => m.played).length;
  const totalGroup = groupMatches.length;
  const remaining = Math.max(totalGroup - played, 0);

  const currentLeader = standings[0];

  // Mejor ritmo reciente (último día con puntos)
  let hotStreak = { name: null, pts: -1, color: "#888" };
  players.forEach(name => {
    const daily = dayPts[name] || [];
    const last = daily.length ? daily[daily.length - 1] : 0;
    if (last > hotStreak.pts) hotStreak = { name, pts: last, color: colors[name] };
  });

  // Proyección: ritmo en fase de grupos × partidos restantes + puntos fuera de grupos
  const projections = players.map(name => {
    const st = standings.find(s => s.name === name) || {};
    const groupsPts = st.groups || 0;
    const nonGroups = (st.total || 0) - groupsPts;
    const avgPerMatch = played > 0 ? groupsPts / played : 0;

    // Tendencia: pendiente de la curva acumulada (pts/día)
    const s = series[name] || [];
    let slope = 0;
    if (s.length >= 2) slope = (s[s.length - 1] - s[s.length - 2]);
    else if (s.length === 1) slope = s[0];

    const projGroups = groupsPts + avgPerMatch * remaining;
    const projTotal = nonGroups + projGroups;
    return { name, color: colors[name], pos: st.pos, total: st.total || 0,
             avgPerMatch, projTotal: Math.round(projTotal * 10) / 10, slope };
  });

  projections.sort((a, b) => b.projTotal - a.projTotal);
  const trendPick = projections[0];
  const differentPick = trendPick && currentLeader && trendPick.name !== currentLeader.name;

  const note = played < 3
    ? "Con pocos partidos jugados, la proyección es orientativa y cambiará mucho."
    : "Proyección basada en la media de puntos por partido en fase de grupos.";

  el.innerHTML = `
    <div class="flex items-center gap-2 mb-1">
      <h3 class="font-bold text-white text-lg">🔮 Pronóstico por tendencia</h3>
      ${infoTip("Estimación <strong>orientativa</strong>, no oficial. Calcula la media de puntos por partido de cada jugador en la fase de grupos y la proyecta sobre los partidos que faltan, sumando los puntos ya logrados fuera de grupos. Cuantos más partidos se jueguen, más fiable será.", "left")}
    </div>
    <p class="text-xs text-gray-400 mb-4">${note}</p>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
      <div class="forecast-pick">
        <div>
          <div class="text-xs text-gray-500 uppercase font-bold mb-1">Líder actual</div>
          <div class="font-extrabold text-white text-lg uppercase" style="color:${currentLeader?.color}">${currentLeader?.name || "—"}</div>
          <div class="text-sm text-gray-400">${currentLeader?.total || 0} pts · #${currentLeader?.pos || "—"}</div>
        </div>
      </div>
      <div class="forecast-pick">
        <div>
          <div class="text-xs text-gray-500 uppercase font-bold mb-1">Mejor ritmo (último partido)</div>
          <div class="font-extrabold text-lg uppercase" style="color:${hotStreak.color}">${hotStreak.name || "—"}</div>
          <div class="text-sm text-gray-400">${hotStreak.pts > 0 ? "+" + hotStreak.pts + " pts en su último partido" : "Sin puntos en el último"}</div>
        </div>
      </div>
      <div class="forecast-pick" style="border:1px solid rgba(245,197,24,.3)">
        <div>
          <div class="text-xs uppercase font-bold mb-1" style="color:var(--gold)">Proyección al cierre de grupos</div>
          <div class="font-extrabold text-lg uppercase" style="color:${trendPick?.color}">${trendPick?.name || "—"}</div>
          <div class="text-sm text-gray-400">~${trendPick?.projTotal || 0} pts totales estimados</div>
        </div>
      </div>
    </div>
    ${differentPick ? `<p class="text-sm text-gray-300">
      <strong style="color:var(--gold)">Ojo:</strong> ${currentLeader.name} lidera ahora, pero si ${trendPick.name} mantiene su ritmo
      (~${trendPick.avgPerMatch.toFixed(1)} pts/partido), podría acabar por delante en la fase de grupos.
    </p>` : played > 0 ? `<p class="text-sm text-gray-400">
      ${currentLeader?.name} lidera y, con el ritmo actual, sigue favorito en la proyección de grupos.
    </p>` : `<p class="text-sm text-gray-400">Aún no hay partidos jugados para proyectar tendencias.</p>`}
    <div class="mt-4 pt-3 border-t" style="border-color:var(--border)">
      <p class="text-xs text-gray-500 uppercase font-bold mb-2">Ranking proyectado (fase de grupos)</p>
      <div class="flex flex-wrap gap-2">
        ${projections.map((p, i) => `
          <span class="text-xs px-2 py-1 rounded font-bold" style="background:${p.color}22;color:${p.color};border:1px solid ${p.color}44">
            ${i + 1}. ${p.name} ~${p.projTotal}pts
          </span>`).join("")}
      </div>
    </div>`;
}

/* ─── STATS ─── */
function renderStats() {
  renderTrendForecast();
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
  const streakKing  = [...perPlayer].sort((a,b) => b.streak - a.streak)[0];
  const topExact    = [...perPlayer].sort((a,b) => b.exact - a.exact)[0];
  heroEl.innerHTML = [
    { icon: "⚽", val: groupMatches.length, label: "Partidos jugados (grupos)", sub: `de ${D.matches.filter(m=>m.phase==="groups").length} totales`,
      info: "Número de partidos de la <strong>fase de grupos</strong> que ya se han jugado y puntuado, sobre el total de partidos de grupos del Mundial." },
    { icon: "🎯", val: totalExacts, label: "Exactos en el grupo", sub: `${perPlayer.reduce((s,p)=>s+p.miss,0)} partidos a 0 pts`,
      info: "Suma de <strong>resultados exactos</strong> (signo + diferencia + marcador clavado, 6 pts) acertados entre todos los jugadores en fase de grupos. Debajo, cuántas veces alguien se quedó a 0 puntos." },
    { icon: "📈", val: bestPlayer ? `${bestPlayer.pct}%` : "—", label: "Mayor tasa de acierto", sub: bestPlayer?.name || "",
      info: "Jugador con mayor <strong>tasa de acierto</strong>: porcentaje de partidos de grupos en los que ha sumado al menos 1 punto (acertó el 1X2, la diferencia o el resultado exacto)." },
    { icon: "🔥", val: streakKing ? `${streakKing.streak}` : "—", label: "Racha activa más larga", sub: streakKing ? `${streakKing.name} · ${streakKing.streak} en racha` : "",
      info: "<strong>Racha activa</strong>: partidos seguidos puntuando (≥1 pt) contando desde el último partido hacia atrás. Se muestra quién tiene la racha viva más larga ahora mismo." },
  ].map(h => `
    <div class="card p-4 text-center" style="position:relative">
      <div class="stat-info-corner">${infoTip(h.info, "right")}</div>
      <div class="text-2xl mb-1">${h.icon}</div>
      <div class="bebas text-3xl text-yellow-400">${h.val}</div>
      <div class="text-xs font-bold text-gray-300 mt-1">${h.label}</div>
      <div class="text-xs text-gray-600 mt-0.5">${h.sub}</div>
    </div>`).join("");

  // ── Tasa de acierto ────────────────────────────────────────────────────
  if (hitRateChart) hitRateChart.destroy();
  hitRateChart = new Chart(document.getElementById("hitRateChart").getContext("2d"), {
    type: "bar",
    data: {
      labels: perPlayer.map(h => h.name),
      datasets: [{
        label: "% Acierto",
        data: perPlayer.map(h => h.pct),
        backgroundColor: players.map(n => colors[n] + "99"),
        borderColor: players.map(n => colors[n]),
        borderWidth: 2, borderRadius: 6,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: i => ` ${i.parsed.y}% (${perPlayer[i.dataIndex].hits}/${perPlayer[i.dataIndex].total})` } } },
      scales: {
        y: { beginAtZero: true, max: 100, grid: { color: "rgba(255,255,255,.05)" }, ticks: { color: "#475569", callback: v => v + "%" } },
        x: { grid: { display: false }, ticks: { color: "#94A3B8", font: { weight: "bold" } } }
      }
    }
  });

  // ── Distribución por fase ──────────────────────────────────────────────
  if (phaseChart) phaseChart.destroy();
  const phases   = ["groups","positions","q16","r16","r8","r4","r2","r34_final","honor"];
  const phLabels = phases.map(p => PHASE_LABELS[p] || p);
  phaseChart = new Chart(document.getElementById("phaseChart").getContext("2d"), {
    type: "bar",
    data: {
      labels: phLabels,
      datasets: D.standings.map(p => ({
        label: p.name,
        data: phases.map(ph => p[ph] || 0),
        backgroundColor: p.color + "88",
        borderColor: p.color,
        borderWidth: 1.5, borderRadius: 4,
      }))
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: "#94A3B8", font: { size: 10 } } }, tooltip: { mode: "index" } },
      scales: {
        x: { stacked: false, grid: { display: false }, ticks: { color: "#64748B", font: { size: 8 }, maxRotation: 35 } },
        y: { grid: { color: "rgba(255,255,255,.05)" }, ticks: { color: "#475569" } }
      }
    }
  });

  // ── Desglose de aciertos ───────────────────────────────────────────────
  if (breakdownChart) breakdownChart.destroy();
  breakdownChart = new Chart(document.getElementById("breakdownChart").getContext("2d"), {
    type: "bar",
    data: {
      labels: perPlayer.map(p => p.name),
      datasets: [
        { label: "🟢 Exacto",     data: perPlayer.map(p => p.exact), backgroundColor: "rgba(34,197,94,.75)",  borderColor: "#22C55E", borderWidth: 1.5, borderRadius: 4 },
        { label: "🔵 1X2 + Dif.", data: perPlayer.map(p => p.diff),  backgroundColor: "rgba(59,130,246,.65)", borderColor: "#3B82F6", borderWidth: 1.5, borderRadius: 4 },
        { label: "🟡 Solo 1X2",   data: perPlayer.map(p => p.sign),  backgroundColor: "rgba(245,197,24,.65)", borderColor: "#F5C518", borderWidth: 1.5, borderRadius: 4 },
        { label: "🔴 0 pts",      data: perPlayer.map(p => p.miss),  backgroundColor: "rgba(239,68,68,.45)",  borderColor: "#EF4444", borderWidth: 1.5, borderRadius: 4 },
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
  document.addEventListener("click", e => {
    const btn = e.target.closest(".info-btn");
    // Cierra los demás tips abiertos
    document.querySelectorAll(".info-wrap.open").forEach(w => {
      if (!btn || w !== btn.closest(".info-wrap")) w.classList.remove("open");
    });
    if (btn) {
      e.stopPropagation();
      btn.closest(".info-wrap")?.classList.toggle("open");
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

  // Detect live: started within last MATCH_DURATION_MS and not yet marked played
  _liveMatchIds = new Set(
    withTs
      .filter(x => !x.m.played && x.ts <= now && (now - x.ts) < MATCH_DURATION_MS)
      .map(x => x.m.name)
  );

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
function renderCalendar() {
  const container = document.getElementById("cal-container");
  if (!container || !D) return;

  const today = todaySpainISO(); // "YYYY-MM-DD"

  // Index matches by ISO date
  const byDate = {};
  (D.matches || []).forEach(m => {
    if (!m.date || m.date.length < 10) return;
    const d = m.date.slice(0, 10);
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(m);
  });

  const months = [
    { year: 2026, month: 6, label: "Junio 2026" },
    { year: 2026, month: 7, label: "Julio 2026" },
  ].filter(({ year, month }) => {
    // Mostrar solo el mes en curso (según la fecha de España): durante junio se
    // ve el de junio y, al pasar a julio, cambia solo al de julio. Si la fecha
    // queda fuera de junio/julio 2026, se muestran todos como respaldo.
    const [ty, tm] = today.split("-").map(Number);
    const inRange = (ty === 2026 && (tm === 6 || tm === 7));
    return inRange ? (year === ty && month === tm) : true;
  });

  const DAYS_ES = ["L","M","X","J","V","S","D"];
  const WEEKENDS = [5, 6]; // índices sábado/domingo (0=Lunes)

  container.innerHTML = months.map(({ year, month, label }) => {
    const daysInMonth = new Date(year, month, 0).getDate();
    // weekday of day 1: 0=Sun..6=Sat → convert to Mon-based index
    const firstWd = new Date(year, month - 1, 1).getDay(); // 0=Sun
    const startOffset = (firstWd + 6) % 7; // Mon=0

    const weekdayHeader = DAYS_ES.map((d, i) =>
      `<div class="cal-weekday${WEEKENDS.includes(i) ? " weekend" : ""}">${d}</div>`
    ).join("");

    // Find the first day of the month that has a match, to skip leading empty rows
    const firstMatchDay = (() => {
      for (let d = 1; d <= daysInMonth; d++) {
        const iso = `${year}-${String(month).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
        if (byDate[iso]?.length) return d;
      }
      return 1;
    })();
    // Recalculate offset from the week that contains firstMatchDay
    const firstMatchWd = new Date(year, month - 1, firstMatchDay).getDay();
    const firstMatchOffset = (firstMatchWd + 6) % 7; // Mon=0
    // startDay is the Monday of the week containing firstMatchDay
    const startDay = firstMatchDay - firstMatchOffset;

    let cells = Array(Math.max(0, firstMatchOffset)).fill(`<div class="cal-day empty"></div>`);

    for (let day = startDay; day <= daysInMonth; day++) {
      if (day < 1) { cells.push(`<div class="cal-day empty"></div>`); continue; }
      const iso = `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
      const matches = byDate[iso] || [];
      const isToday = iso === today;
      const hasMath = matches.length > 0;

      let cls = "cal-day";
      if (!hasMath) cls += " no-match";
      else cls += " has-match";
      if (isToday) cls += " is-today";

      const matchChip = m => {
        const fh = m.flag_home || "";
        const fa = m.flag_away || "";
        const ch = TEAM_TO_FIFA[m.home] || (m.home || "").slice(0,3).toUpperCase();
        const ca = TEAM_TO_FIFA[m.away] || (m.away || "").slice(0,3).toUpperCase();
        // Skip knockout placeholder teams (not yet determined)
        const looksLikePlaceholder = v => !v || /^\d|^Win|^Los|^[A-Z]\d|^[A-Z]{1,2}\d/.test(v);
        const homeOk = fh && !looksLikePlaceholder(m.home);
        const awayOk = fa && !looksLikePlaceholder(m.away);
        const nm = (m.name || "").replace(/'/g, "\\'").replace(/"/g, "&quot;");
        const chipClick = `onclick="event.stopPropagation();goToMatchesDay('${iso}','${nm}')"`;
        if (!homeOk && !awayOk) return `<div class="cal-chip" ${chipClick}>⚽</div>`;
        return `<div class="cal-chip cal-chip-match" ${chipClick}>${homeOk ? fh : "🏳"}<span class="cal-chip-code">${ch}</span><span class="cal-chip-sep">–</span><span class="cal-chip-code">${ca}</span>${awayOk ? fa : "🏳"}</div>`;
      };
      const chips = matches.map(matchChip).join("");

      const clickAttr = hasMath ? `onclick="goToMatchesDay('${iso}')" title="${matches.map(m=>(m.home||"")+" - "+(m.away||"")).join(" · ")}"` : "";

      cells.push(`<div class="${cls}" ${clickAttr}><div class="cal-day-num">${day}</div>${chips}</div>`);
    }

    return `
      <div class="cal-month">
        <div class="cal-month-title">${label}</div>
        <div class="cal-weekdays">${weekdayHeader}</div>
        <div class="cal-days">${cells.join("")}</div>
      </div>`;
  }).join("");
}

function goToMatchesDay(isoDate, matchName) {
  // 1. Switch to matches tab MANUALLY (avoid the click handler's scroll-to-today)
  document.querySelectorAll(".tab-btn").forEach(b =>
    b.classList.toggle("active", b.dataset.tab === "matches"));
  ["matches","calendar","standings","progression","stats","honor","scoring","info"].forEach(t => {
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
    ["matches","calendar","standings","progression","stats","honor","scoring","info"].forEach(t => {
      document.getElementById("tab-"+t).classList.toggle("hidden", t !== tab);
    });
    document.dispatchEvent(new CustomEvent("tabChanged"));
    window.scrollTo({ top: 0, behavior: "instant" });
    if (tab === "matches") scrollMatchesToToday = true;
    if (tab === "progression" && D) renderProgression();
    if (tab === "stats" && D) renderStats();
    if (tab === "matches" && D) renderMatches(currentPhase, currentWeek);
    if (tab === "scoring" && D) renderScoring();
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
    document.body.style.overflow = "hidden";
    return;
  }
  _renderAdminGate();
  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  setTimeout(() => document.getElementById("adm-pass-input")?.focus(), 50);
}

function _renderAdminGate(error) {
  const body = document.getElementById("admin-modal-body");
  if (!body) return;
  body.innerHTML = `
    <div class="adm-gate">
      <div class="adm-gate-icon">🔒</div>
      <p class="adm-gate-text">Introduce la contraseña de administrador</p>
      <form id="adm-pass-form" autocomplete="off">
        <input type="password" id="adm-pass-input" class="adm-pass-input"
          inputmode="numeric" autocomplete="off" placeholder="••••••" aria-label="Contraseña" />
        <button type="submit" class="adm-pass-btn">Entrar</button>
      </form>
      ${error ? `<p class="adm-gate-error">${error}</p>` : ""}
    </div>`;
  const form = document.getElementById("adm-pass-form");
  form?.addEventListener("submit", async ev => {
    ev.preventDefault();
    const val = document.getElementById("adm-pass-input")?.value || "";
    const hash = await _sha256Hex(val);
    if (hash === ADMIN_PASS_HASH) {
      markAdminUnlocked();
      _buildAdminPanel();
    } else {
      _renderAdminGate("Contraseña incorrecta");
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
  const sysStatus = (() => {
    const nextIso = upd.next_update_iso;
    if (!nextIso) return { level: "gray", text: "Sin datos de programación", icon: "○" };
    const nd = new Date(nextIso);
    if (isNaN(nd)) return { level: "gray", text: "Programación no válida", icon: "○" };
    const overdue = Math.round((now - nd) / 60000); // >0 = retrasada
    if (overdue <= 0) return { level: "green", text: `Al día · próxima ${futureTime(nextIso)}`, icon: "●" };
    if (overdue <= 30) return { level: "amber", text: `Prevista hace ${_humanMin(overdue)} · debería llegar pronto`, icon: "●" };
    return { level: "red", text: `Retrasada hace ${_humanMin(overdue)} · revisa la Action`, icon: "●" };
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
  if (visitsBuckets.length < 1) {
    visitsBody = `<div class="adm-empty">Aún no hay fotos horarias. Empezará a registrarse en la próxima hora en punto.</div>`;
  } else {
    visitsBody = `
      <div class="adm-vis-filters">${visitsFilterBtns}</div>
      <div class="adm-vis-list" id="adm-vis-list"></div>`;
  }

  body.innerHTML = `

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
          <div class="adm-label">Próxima actualización</div>
          <div class="adm-value">${upd.next_update_time || "—"}
            ${futureTime(upd.next_update_iso) ? `<br><span class="adm-rel">${futureTime(upd.next_update_iso)}</span>` : ""}
          </div>
        </div>
        <div class="adm-cell">
          <div class="adm-label">Cadencia</div>
          <div class="adm-value">${upd.schedule_label || "—"}</div>
        </div>
      </div>
    </div>

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
        🕓 Historial de cambios de resultados
        <span class="adm-badge">${resultHistory.length}</span>
      </div>
      <div class="adm-hist-list">
        ${resultHistoryTop.length ? resultHistoryTop.map(histRow).join("") : '<div class="adm-empty">Sin cambios de resultados registrados todavía</div>'}
      </div>
    </div>

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
    </div>

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
    </div>

    <div class="adm-section">
      <div class="adm-section-title">🔗 Links rápidos</div>
      <div class="adm-links">
        <button type="button" class="adm-link adm-copy-btn" onclick="_copyAdminSummary(this)">📋 Copiar resumen</button>
        <a href="https://github.com/pCresp0/porra-mundial-nanos-2026" target="_blank" rel="noopener" class="adm-link">📁 Repo GitHub</a>
        <a href="https://github.com/pCresp0/porra-mundial-nanos-2026/actions" target="_blank" rel="noopener" class="adm-link">⚙️ GitHub Actions</a>
        <a href="https://worldcup26.ir/get/games" target="_blank" rel="noopener" class="adm-link">🌐 API del Mundial</a>
        <a href="${IS_GH_PAGES ? "data.json" : "/api/data"}" target="_blank" rel="noopener" class="adm-link">📄 data.json</a>
      </div>
    </div>
  `;

  // pinta el día más reciente de visitas por hora
  if (visitDays.length) _renderVisitsDay(visitDays[0]);
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

loadData();

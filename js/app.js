// RailPulse - Core Interactive SaaS Engine
// ViaMobilidade Linhas 8 & 9 Analytics

let state = {
  data: null,
  activeTab: 'overview',
  yearFilter: 'all',
  dayTypeFilter: 'all', // 'all', 'Útil', 'FIN'
  selectedStations: new Set(['VOL', 'PIN', 'OSA', 'BFU', 'BRU', 'SAM']),
  chartType: 'line', // 'line', 'bar', 'radar', 'heatmap'
  metricType: 'passengers', // 'passengers', 'revenue'
  aggregation: 'monthly', // 'daily', 'weekly', 'monthly'
  searchQuery: '',
  simulator: {
    fare: 4.40,
    demandDelta: 0,
    inflation: 0
  },
  l8Avg: {
    years: new Set(['2022', '2023', '2024', '2025', '2026']),
    months: new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
    ds: new Set(['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom']),
    td: new Set(['Útil', 'FIN']),
    scope: 'l8', // 'l8', 'l9', 'both', 'compare'
    dimension: 'stations', // 'stations', 'months', 'ds'
    chartType: 'bar' // 'bar', 'horizontalBar', 'line', 'doughnut'
  },
  studioFilters: {
    year: 'all',
    month: 'all',
    dayType: 'all',
    dayOfWeek: 'all',
    dayOfMonth: 'all'
  }
};

// Caches de memoização para filtros globais e de análise
var _memoOverviewFilterKey = null;
var _memoOverviewFilterResult = null;
var _memoStudioFilterKey = null;
var _memoStudioFilterResult = null;

let chartInstances = {
  overview: null,
  l8Averages: null,
  studio: null,
  scatter: null,
  simulator: null
};

// Colors palette for multi-series
const PALETTE = [
  '#10b981', '#38bdf8', '#fbbf24', '#f43f5e', '#a855f7',
  '#06b6d4', '#4ade80', '#fb923c', '#e879f9', '#60a5fa',
  '#34d399', '#22d3ee', '#facc15', '#f87171', '#c084fc'
];

async function initAll() {
  initTabs();
  initGlobalFilters();
  initFileUpload();
  initLiveClock();
  await loadInitialData();
  if (window.lucide) lucide.createIcons();
}

function initLiveClock() {
  function update() {
    const el = document.getElementById('cco-live-clock');
    if (!el) return;
    const now = new Date();
    const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    el.innerText = `${timeStr} BRT`;
  }
  update();
  setInterval(update, 1000);
}

// -------------------------------------------------------------
// ESTAÇÃO FERROVIÁRIA & NAVEGAÇÃO DOS TRENS (VIAMOBILIDADE L8 & L9)
// Adaptado de menu_saas_viamobilidade_linhas_8_e_9.html
// -------------------------------------------------------------

/**
 * Dispara o efeito de faísca elétrica no pantógrafo ao movimentar o trem
 */
window.triggerPantographSpark = function(trackElement) {
  if (!trackElement) return;
  trackElement.classList.remove('sparking');
  void trackElement.offsetWidth; // Reflow para reiniciar animação CSS
  trackElement.classList.add('sparking');
  setTimeout(() => {
    trackElement.classList.remove('sparking');
  }, 900);
};

/**
 * Abre ou fecha o trem clicado com Semáforo, Faísca no Pantógrafo e Física de Frenagem
 */
/**
 * Abre ou fecha o trem clicado com Semáforo, Faísca no Pantógrafo e Sincronização
 */
window.toggleTrain = function(trackId) {
  const line = trackId === 'track-l8' ? 'l8' : (trackId === 'track-l9' ? 'l9' : 'both');
  quickFilterLineScope(line);
};

/**
 * Recolhe ambos os trens para dentro do túnel e reseta para a Rede Completa
 */
window.closeAllTrains = function() {
  document.querySelectorAll('.train-track').forEach(track => {
    if (track.classList.contains('active')) {
      track.classList.remove('active');
      track.classList.add('reversing');
      triggerPantographSpark(track);
    }
  });

  state.activeLineScope = 'both';
  if (state.l8Avg) state.l8Avg.scope = 'both';

  // Desativa botões específicos de linha
  ['station-btn-l8', 'station-btn-l9', 'station-btn-both'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('active');
  });

  const statusEl = document.getElementById('station-status');
  if (statusEl) {
    statusEl.textContent = 'SINAIS VERMELHOS • COMPOSIÇÕES RECOLHIDAS NO TÚNEL • REDE COMPLETA NO MAPA';
    statusEl.style.color = '#f43f5e';
  }

  // Reseta mapa para todos
  if (typeof setMapFilter === 'function') {
    setMapFilter('all', { fromTrain: true });
  }

  syncKPICardsHighlight('both');
  if (typeof renderL8AveragesChart === 'function') {
    renderL8AveragesChart();
  }
};

/**
 * Atualiza o indicador de status da Gestão de Arrecadação no topo da estação
 */
window.updateStationStatusText = function() {
  const statusEl = document.getElementById('station-status');
  if (!statusEl) return;
  const scope = (state.activeLineScope || 'both').toLowerCase();

  if (scope === 'l8') {
    statusEl.textContent = '🟢 OPERAÇÃO ATIVA LINHA 8 • PLATAFORMA DIAMANTE SINCRONIZADA COM O MAPA';
    statusEl.style.color = '#fbbf24';
  } else if (scope === 'l9') {
    statusEl.textContent = '🟢 OPERAÇÃO ATIVA LINHA 9 • PLATAFORMA ESMERALDA SINCRONIZADA COM O MAPA';
    statusEl.style.color = '#34d399';
  } else {
    statusEl.textContent = '🟣 REDE INTEGRADA • LINHAS 8 E 9 SINCRONIZADAS COM O MAPA';
    statusEl.style.color = '#c084fc';
  }
};

/**
 * Abre as portas do vagão clicado, acende a luz interna, atualiza o LED Matrix e executa ação no SaaS
 */
window.selectStationWagon = function(event, linePrefix, actionKey) {
  if (event) event.stopPropagation();

  // Aciona a linha do vagão clicado
  quickFilterLineScope(linePrefix);

  const targetTrack = document.getElementById(`track-${linePrefix}`);
  if (targetTrack) {
    triggerPantographSpark(targetTrack);
  }

  // Fecha portas dos outros vagões e abre as deste vagão selecionado
  document.querySelectorAll('.wagon-item').forEach(btn => {
    btn.classList.remove('selected-menu');
  });
  if (event && event.currentTarget) {
    event.currentTarget.classList.add('selected-menu');
  }

  // Atualiza letreiro LED Matrix da cabine
  const ledEl = document.getElementById(`led-text-${linePrefix}`);
  if (ledEl) {
    const isL8 = (linePrefix === 'l8');
    if (actionKey === 'overview') {
      ledEl.textContent = isL8 ? 'L8 • VISÃO GERAL • J.PRESTES' : 'L9 • VISÃO GERAL • PINHEIROS';
    } else if (actionKey === 'media') {
      ledEl.textContent = isL8 ? 'L8 • MÉDIA & DIAMANTE 3D • OSASCO' : 'L9 • MÉDIA DIÁRIA • BERRINI';
    } else if (actionKey === 'studio') {
      ledEl.textContent = isL8 ? 'L8 • ANÁLISE DE ESTAÇÕES • BARUERI' : 'L9 • ANÁLISE COMPARADORA • MORUMBI';
    } else if (actionKey === 'export') {
      ledEl.textContent = isL8 ? 'L8 • EXPORTAR RELATÓRIO • ITAPEVI' : 'L9 • EXPORTAR RELATÓRIO • VARGINHA';
    }
  }

  if (actionKey === 'overview') {
    const tabBtn = document.querySelector('.nav-tab-btn[data-tab="overview"]');
    if (tabBtn) tabBtn.click();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else if (actionKey === 'media') {
    const tabBtn = document.querySelector('.nav-tab-btn[data-tab="overview"]');
    if (tabBtn) tabBtn.click();
    setTimeout(() => {
      const el = document.getElementById('l8-averages-chart-card') || document.querySelector('.diamond-section');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 120);
  } else if (actionKey === 'studio') {
    const tabBtn = document.querySelector('.nav-tab-btn[data-tab="studio"]');
    if (tabBtn) tabBtn.click();
  } else if (actionKey === 'export') {
    if (typeof downloadAverageExcel === 'function') {
      downloadAverageExcel();
    }
  }
};

/**
 * Destaca visualmente os cards de KPI (Overview e Mapa) com transições semânticas
 */
function syncKPICardsHighlight(scope) {
  const norm = (scope || 'both').toLowerCase();
  const ovTotal = document.getElementById('overview-kpi-total');
  const ovL8 = document.getElementById('overview-kpi-l8');
  const ovL9 = document.getElementById('overview-kpi-l9');
  const mapTotal = document.getElementById('map-kpi-card-total');
  const mapL8 = document.getElementById('map-kpi-card-l8');
  const mapL9 = document.getElementById('map-kpi-card-l9');

  const lineCards = [ovL8, ovL9, mapL8, mapL9].filter(Boolean);
  lineCards.forEach(c => {
    c.classList.remove('line-active-l8', 'line-active-l9', 'line-dimmed');
  });

  if (norm === 'l8') {
    if (ovL8) ovL8.classList.add('line-active-l8');
    if (mapL8) mapL8.classList.add('line-active-l8');
    if (ovL9) ovL9.classList.add('line-dimmed');
    if (mapL9) mapL9.classList.add('line-dimmed');
  } else if (norm === 'l9') {
    if (ovL9) ovL9.classList.add('line-active-l9');
    if (mapL9) mapL9.classList.add('line-active-l9');
    if (ovL8) ovL8.classList.add('line-dimmed');
    if (mapL8) mapL8.classList.add('line-dimmed');
  }
}

// -------------------------------------------------------------
// FILTRO RÁPIDO DE CORREDOR / LINHA: TRENS ⇄ MAPA ⇄ KPIS
// (ui-ux-designer & frontend-developer)
// -------------------------------------------------------------
window.quickFilterLineScope = function(scope, options = {}) {
  const normScope = (scope || 'both').toLowerCase();
  state.activeLineScope = normScope;
  if (!state.l8Avg) state.l8Avg = {};
  state.l8Avg.scope = normScope;

  const scopeSelect = document.getElementById('avg-scope-select');
  if (scopeSelect) {
    scopeSelect.value = (normScope === 'l8' || normScope === 'l9') ? normScope : 'both';
  }

  // 1. Manobra de Trens & Efeitos de Plataforma
  const track8 = document.getElementById('track-l8');
  const track9 = document.getElementById('track-l9');

  if (normScope === 'l8') {
    if (track8 && !track8.classList.contains('active')) {
      track8.classList.remove('reversing');
      track8.classList.add('active');
      triggerPantographSpark(track8);
    }
    if (track9 && track9.classList.contains('active')) {
      track9.classList.remove('active');
      track9.classList.add('reversing');
      triggerPantographSpark(track9);
    }
  } else if (normScope === 'l9') {
    if (track9 && !track9.classList.contains('active')) {
      track9.classList.remove('reversing');
      track9.classList.add('active');
      triggerPantographSpark(track9);
    }
    if (track8 && track8.classList.contains('active')) {
      track8.classList.remove('active');
      track8.classList.add('reversing');
      triggerPantographSpark(track8);
    }
  } else if (normScope === 'both') {
    if (track8) { track8.classList.remove('reversing'); track8.classList.add('active'); }
    if (track9) { track9.classList.remove('reversing'); track9.classList.add('active'); }
  }

  // 2. Botões da Barra Superior da Estação
  const b8 = document.getElementById('station-btn-l8');
  const b9 = document.getElementById('station-btn-l9');
  const bBoth = document.getElementById('station-btn-both');
  if (b8) b8.classList.toggle('active', normScope === 'l8');
  if (b9) b9.classList.toggle('active', normScope === 'l9');
  if (bBoth) bBoth.classList.toggle('active', normScope === 'both');

  // 3. Status da Estação & LED Matrix da Cabine
  updateStationStatusText();
  const led8 = document.getElementById('led-text-l8');
  const led9 = document.getElementById('led-text-l9');
  if (normScope === 'l8' && led8) {
    led8.textContent = 'L8 • DIAMANTE EM OPERAÇÃO • MAPA SINCRONIZADO';
  } else if (normScope === 'l9' && led9) {
    led9.textContent = 'L9 • ESMERALDA EM OPERAÇÃO • MAPA SINCRONIZADO';
  } else if (normScope === 'both') {
    if (led8) led8.textContent = 'L8 • DESTINO: DIAMANTE • J.PRESTES';
    if (led9) led9.textContent = 'L9 • DESTINO: ESMERALDA • MENDES';
  }

  // 4. Sincronização Direta com o Mapa Vetorial
  if (!options.fromMap && typeof window.setMapFilter === 'function') {
    const mapFilterTarget = normScope === 'l8' ? 'L8' : (normScope === 'l9' ? 'L9' : 'all');
    window.setMapFilter(mapFilterTarget, { fromTrain: true });
  }

  // 5. Ajuste inteligente da estação selecionada para o traçado ativo
  if (normScope === 'l8') {
    const curSt = stationsCatalog[currentSelectedStationId];
    if (curSt && !curSt.lines.includes('L8')) {
      selectStationOnMap('osasco');
    }
  } else if (normScope === 'l9') {
    const curSt = stationsCatalog[currentSelectedStationId];
    if (curSt && !curSt.lines.includes('L9')) {
      selectStationOnMap('pinheiros');
    }
  }

  // 6. Destaque Visual nos Cards de KPI
  syncKPICardsHighlight(normScope);

  // 7. Atualiza Gráfico de Médias
  if (typeof renderL8AveragesChart === 'function') {
    renderL8AveragesChart();
  }
};

// Load Data (Local JS or fetch)
async function loadInitialData() {
  if (window.RAIL_INITIAL_DATA) {
    state.data = window.RAIL_INITIAL_DATA;
  } else {
    try {
      const resp = await fetch('data/rail_data.json');
      state.data = await resp.json();
    } catch (e) {
      console.error('Error fetching data.json:', e);
    }
  }

  if (state.data) {
    if (window.AnalyticsCache && state.data.daily) {
      window.AnalyticsCache.initIndex(state.data.daily);
    }
    renderApp();
  }
}

function renderApp() {
  init3DDiamond();
  initL8AveragesControls();
  renderOverviewTab();
  initStationStudio();
  renderStudioChart();
  renderStudioTable();
  if (window.lucide) {
    lucide.createIcons();
  }
}


// -------------------------------------------------------------
// TAB SYSTEM
// -------------------------------------------------------------
function initTabs() {
  document.querySelectorAll('.nav-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabTarget = btn.getAttribute('data-tab');
      document.querySelectorAll('.nav-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      
      btn.classList.add('active');
      const pane = document.getElementById(`tab-${tabTarget}`);
      if (pane) pane.classList.add('active');
      state.activeTab = tabTarget;

      // Resize or render charts on tab switch
      setTimeout(() => {
        if (tabTarget === 'overview') {
          if (chartInstances.overview) chartInstances.overview.resize();
          if (chartInstances.l8Averages) chartInstances.l8Averages.resize();
          if (window.diamond3D && window.diamond3D.resize) window.diamond3D.resize();
        }
        if (tabTarget === 'studio' && chartInstances.studio) chartInstances.studio.resize();
      }, 50);
    });
  });
}

// -------------------------------------------------------------
// GLOBAL FILTERS
// -------------------------------------------------------------
function initGlobalFilters() {
  // Os filtros agora estão 100% integrados às barras de controle de cada gráfico
}

function updateFilteredViews() {
  renderOverviewTab();
  renderStudioChart();
  renderStudioTable();
}

// Filtra registros consolidados para os KPIs e gráficos de tendência (Memoizado)
function getFilteredRecords() {
  if (!state.data || !state.data.daily) return [];
  
  const yearsKey = state.l8Avg && state.l8Avg.years ? Array.from(state.l8Avg.years).sort().join(',') : 'all';
  const monthsKey = state.l8Avg && state.l8Avg.months ? Array.from(state.l8Avg.months).sort().join(',') : 'all';
  const tdKey = state.l8Avg && state.l8Avg.td ? Array.from(state.l8Avg.td).sort().join(',') : 'all';
  const currentKey = `${yearsKey}|${monthsKey}|${tdKey}`;

  if (currentKey === _memoOverviewFilterKey && _memoOverviewFilterResult) {
    return _memoOverviewFilterResult;
  }

  const res = state.data.daily.filter(r => {
    if (state.l8Avg && state.l8Avg.years && state.l8Avg.years.size > 0) {
      if (!state.l8Avg.years.has(r.y.toString())) return false;
    }
    if (state.l8Avg && state.l8Avg.months && state.l8Avg.months.size > 0) {
      if (!state.l8Avg.months.has(r.m)) return false;
    }
    if (state.l8Avg && state.l8Avg.td && state.l8Avg.td.size > 0) {
      if (!state.l8Avg.td.has(r.td)) return false;
    }
    return true;
  });

  _memoOverviewFilterKey = currentKey;
  _memoOverviewFilterResult = res;
  return res;
}

// Filtra registros diários especificamente para a Aba Análise (Memoizado)
function getStudioFilteredRecords() {
  if (!state.data || !state.data.daily) return [];
  const sf = state.studioFilters || {
    year: 'all',
    month: 'all',
    dayType: 'all',
    dayOfWeek: 'all',
    dayOfMonth: 'all'
  };

  const currentKey = `${sf.year}|${sf.month}|${sf.dayType}|${sf.dayOfWeek}|${sf.dayOfMonth}`;
  if (currentKey === _memoStudioFilterKey && _memoStudioFilterResult) {
    return _memoStudioFilterResult;
  }

  const res = state.data.daily.filter(r => {
    if (sf.year && sf.year !== 'all' && r.y.toString() !== sf.year.toString()) {
      return false;
    }
    if (sf.month && sf.month !== 'all' && r.m.toString() !== sf.month.toString()) {
      return false;
    }
    if (sf.dayType && sf.dayType !== 'all' && r.td !== sf.dayType) {
      return false;
    }
    if (sf.dayOfWeek && sf.dayOfWeek !== 'all' && r.ds !== sf.dayOfWeek) {
      return false;
    }
    if (sf.dayOfMonth && sf.dayOfMonth !== 'all') {
      const parts = r.d.split('-');
      const dNum = parseInt(parts[2], 10);
      if (dNum.toString() !== sf.dayOfMonth.toString()) {
        return false;
      }
    }
    return true;
  });

  _memoStudioFilterKey = currentKey;
  _memoStudioFilterResult = res;
  return res;
}

// -------------------------------------------------------------
// TAB 1: OVERVIEW, 3D DIAMOND & AVERAGE CHART
// -------------------------------------------------------------
function renderOverviewTab() {
  const records = getFilteredRecords();
  if (!records.length) return;

  let totalPass = 0;
  let totalRev = 0;
  let l8Pass = 0;
  let l9Pass = 0;

  records.forEach(r => {
    totalPass += r.tot_e;
    totalRev += r.tot_r;
    l8Pass += r.l8_e;
    l9Pass += r.l9_e;
  });

  const daysCount = records.length;
  const avgPass = Math.round(totalPass / daysCount);
  const avgRev = Math.round(totalRev / daysCount);
  const avgL8 = Math.round(l8Pass / daysCount);
  const avgL9 = Math.round(l9Pass / daysCount);

  // Update KPI Cards
  const elTotal = document.getElementById('kpi-total-pass');
  if (elTotal) elTotal.innerText = formatNumber(avgPass) + ' / dia';
  const elTotalSub = document.getElementById('kpi-total-sub');
  if (elTotalSub) elTotalSub.innerText = `${formatNumber(totalPass)} no período filtrado (${daysCount} dias)`;

  const elRev = document.getElementById('kpi-total-rev');
  if (elRev) elRev.innerText = 'R$ ' + formatCurrency(avgRev) + ' / dia';
  const elRevSub = document.getElementById('kpi-rev-sub');
  if (elRevSub) elRevSub.innerText = `R$ ${formatCurrency(totalRev)} acumulado no período`;

  const elL8 = document.getElementById('kpi-l8-pass');
  if (elL8) elL8.innerText = formatNumber(avgL8) + ' / dia';
  const elL8Sub = document.getElementById('kpi-l8-sub');
  if (elL8Sub) elL8Sub.innerText = `Linha 8: ${formatNumber(l8Pass)} passageiros (${Math.round((l8Pass/totalPass)*100)}%)`;

  const elL9 = document.getElementById('kpi-l9-pass');
  if (elL9) elL9.innerText = formatNumber(avgL9) + ' / dia';
  const elL9Sub = document.getElementById('kpi-l9-sub');
  if (elL9Sub) elL9Sub.innerText = `Linha 9: ${formatNumber(l9Pass)} passageiros (${Math.round((l9Pass/totalPass)*100)}%)`;

  // Calcular tendências YoY e MoM para os cartões de KPI da Visão Geral
  let yoyPass = null, yoyRev = null, yoyL8 = null, yoyL9 = null;
  let momPass = null, momRev = null, momL8 = null, momL9 = null;

  if (state.data && state.data.daily) {
    const selectedYears = state.l8Avg && state.l8Avg.years && state.l8Avg.years.size === 1
      ? Array.from(state.l8Avg.years)[0]
      : '2024';
    const numYear = parseInt(selectedYears, 10);
    const prevYearStr = (numYear - 1).toString();

    // Registros do ano anterior com mesmos filtros de meses e tipo de dia
    const prevYearRecords = state.data.daily.filter(r => {
      if (r.y.toString() !== prevYearStr) return false;
      if (state.l8Avg && state.l8Avg.months && state.l8Avg.months.size > 0) {
        if (!state.l8Avg.months.has(r.m)) return false;
      }
      if (state.l8Avg && state.l8Avg.td && state.l8Avg.td.size > 0) {
        if (!state.l8Avg.td.has(r.td)) return false;
      }
      return true;
    });

    if (prevYearRecords.length > 0) {
      let pyPass = 0, pyRev = 0, pyL8 = 0, pyL9 = 0;
      prevYearRecords.forEach(r => {
        pyPass += r.tot_e;
        pyRev += r.tot_r;
        pyL8 += r.l8_e;
        pyL9 += r.l9_e;
      });
      const pyDays = prevYearRecords.length;
      const curAvgPass = totalPass / daysCount;
      const pyAvgPass = pyPass / pyDays;
      if (pyAvgPass > 0) yoyPass = ((curAvgPass - pyAvgPass) / pyAvgPass) * 100;

      const curAvgRev = totalRev / daysCount;
      const pyAvgRev = pyRev / pyDays;
      if (pyAvgRev > 0) yoyRev = ((curAvgRev - pyAvgRev) / pyAvgRev) * 100;

      const curAvgL8 = l8Pass / daysCount;
      const pyAvgL8 = pyL8 / pyDays;
      if (pyAvgL8 > 0) yoyL8 = ((curAvgL8 - pyAvgL8) / pyAvgL8) * 100;

      const curAvgL9 = l9Pass / daysCount;
      const pyAvgL9 = pyL9 / pyDays;
      if (pyAvgL9 > 0) yoyL9 = ((curAvgL9 - pyAvgL9) / pyAvgL9) * 100;
    }

    // MoM: Último mês vs penúltimo mês dentro dos registros filtrados
    const monthAgg = {};
    records.forEach(r => {
      const ym = r.d.substring(0, 7);
      if (!monthAgg[ym]) monthAgg[ym] = { pass: 0, rev: 0, l8: 0, l9: 0, count: 0 };
      monthAgg[ym].pass += r.tot_e;
      monthAgg[ym].rev += r.tot_r;
      monthAgg[ym].l8 += r.l8_e;
      monthAgg[ym].l9 += r.l9_e;
      monthAgg[ym].count += 1;
    });
    const sortedYMs = Object.keys(monthAgg).sort();
    if (sortedYMs.length >= 2) {
      const lastYM = sortedYMs[sortedYMs.length - 1];
      const prevYM = sortedYMs[sortedYMs.length - 2];
      const m1 = monthAgg[lastYM];
      const m0 = monthAgg[prevYM];
      if (m0.count > 0 && m1.count > 0) {
        const avgPass1 = m1.pass / m1.count, avgPass0 = m0.pass / m0.count;
        if (avgPass0 > 0) momPass = ((avgPass1 - avgPass0) / avgPass0) * 100;

        const avgRev1 = m1.rev / m1.count, avgRev0 = m0.rev / m0.count;
        if (avgRev0 > 0) momRev = ((avgRev1 - avgRev0) / avgRev0) * 100;

        const avgL8_1 = m1.l8 / m1.count, avgL8_0 = m0.l8 / m0.count;
        if (avgL8_0 > 0) momL8 = ((avgL8_1 - avgL8_0) / avgL8_0) * 100;

        const avgL9_1 = m1.l9 / m1.count, avgL9_0 = m0.l9 / m0.count;
        if (avgL9_0 > 0) momL9 = ((avgL9_1 - avgL9_0) / avgL9_0) * 100;
      }
    }
  }

  const ovTrendTot = document.getElementById('overview-trend-total');
  if (ovTrendTot) ovTrendTot.innerHTML = `${formatTrendBadge(yoyPass, 'YoY')} ${formatTrendBadge(momPass, 'MoM')}`;

  const ovTrendRev = document.getElementById('overview-trend-rev');
  if (ovTrendRev) ovTrendRev.innerHTML = `${formatTrendBadge(yoyRev, 'YoY')} ${formatTrendBadge(momRev, 'MoM')}`;

  const ovTrendL8 = document.getElementById('overview-trend-l8');
  if (ovTrendL8) ovTrendL8.innerHTML = `${formatTrendBadge(yoyL8, 'YoY')} ${formatTrendBadge(momL8, 'MoM')}`;

  const ovTrendL9 = document.getElementById('overview-trend-l9');
  if (ovTrendL9) ovTrendL9.innerHTML = `${formatTrendBadge(yoyL9, 'YoY')} ${formatTrendBadge(momL9, 'MoM')}`;

  renderL8AveragesChart();
  renderOverviewTrendChart(records);
  initInteractiveRailMap();
  renderTopStationsOverview(records);
}


// Overview Monthly Trend Chart
function renderOverviewTrendChart(records) {
  const ctx = document.getElementById('overview-trend-chart');
  if (!ctx) return;

  // Aggregate by YearMonth
  const monthMap = {};
  records.forEach(r => {
    const ym = r.d.substring(0, 7);
    if (!monthMap[ym]) {
      monthMap[ym] = { ym, l8: 0, l9: 0, tot: 0, rev: 0, count: 0 };
    }
    monthMap[ym].l8 += r.l8_e;
    monthMap[ym].l9 += r.l9_e;
    monthMap[ym].tot += r.tot_e;
    monthMap[ym].rev += r.tot_r;
    monthMap[ym].count += 1;
  });

  const labels = Object.keys(monthMap).sort();
  const l8DailyAvg = labels.map(k => Math.round(monthMap[k].l8 / monthMap[k].count));
  const l9DailyAvg = labels.map(k => Math.round(monthMap[k].l9 / monthMap[k].count));
  const totDailyAvg = labels.map(k => Math.round(monthMap[k].tot / monthMap[k].count));

  if (chartInstances.overview) {
    chartInstances.overview.destroy();
  }

  chartInstances.overview = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Total Linhas 8 e 9 (Média/Dia)',
          data: totDailyAvg,
          borderColor: '#f8fafc',
          backgroundColor: 'rgba(255, 255, 255, 0.05)',
          borderWidth: 2,
          pointRadius: 2,
          pointHoverRadius: 5,
          tension: 0.3,
          fill: true
        },
        {
          label: 'Linha 8 - Diamante',
          data: l8DailyAvg,
          borderColor: '#38bdf8',
          backgroundColor: 'rgba(56, 189, 248, 0.1)',
          borderWidth: 2,
          pointRadius: 2,
          tension: 0.3,
          fill: false
        },
        {
          label: 'Linha 9 - Esmeralda',
          data: l9DailyAvg,
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
          borderWidth: 2,
          pointRadius: 2,
          tension: 0.3,
          fill: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: '#94a3b8', font: { family: 'Inter', size: 12 } }
        },
        tooltip: {
          backgroundColor: '#111827',
          borderColor: '#334155',
          borderWidth: 1,
          titleColor: '#fff',
          bodyColor: '#cbd5e1',
          padding: 10,
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${ctx.raw.toLocaleString('pt-BR')} pass/dia`
          }
        }
      },
      scales: {
        x: {
          ticks: { color: '#64748b', maxTicksLimit: 14 },
          grid: { color: 'rgba(255, 255, 255, 0.04)' }
        },
        y: {
          ticks: {
            color: '#64748b',
            callback: (v) => `${(v/1000).toFixed(0)}k`
          },
          grid: { color: 'rgba(255, 255, 255, 0.04)' }
        }
      }
    }
  });
}

window.filterMenuOptions = function(inputEl, menuId) {
  const menu = document.getElementById(menuId);
  if (!menu || !inputEl) return;
  const q = (inputEl.value || '').toLowerCase().trim();
  menu.querySelectorAll('.multiselect-item').forEach(item => {
    const text = item.textContent.toLowerCase();
    item.style.display = text.includes(q) ? '' : 'none';
  });
};

// =========================================================================
// MAPA VETORIAL INTERATIVO DE FLUXO & GESTÃO DE ARRECADAÇÃO (LINHAS 8 E 9)
// Adaptado de mapa_interativo_fluxo_de_passageiros_viamobilidade_linhas_8_e_9.html
// Integração dinâmica com dados consolidados da ViaMobilidade (state.data.daily)
// =========================================================================

const COLOR_L8_DIAMANTE = '#9E9E93';
const COLOR_L9_ESMERALDA = '#00A88F';

const mapMonthNamesFull = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

const mapMonthNamesShort = [
  'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
  'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'
];

// Mapeamento dos IDs do mapa para os códigos de 3 letras da base de dados
const stationCodeMap = window.stationCodeMap = {
  'amador-bueno': 'ABU',
  'santa-rita': 'SRT',
  'itapevi': 'IPV',
  'eng-cardoso': 'ECD',
  'sagrado-coracao': 'SCO',
  'jandira': 'JDI',
  'jardim-silveira': 'JSI',
  'jardim-belval': 'JBE',
  'barueri': 'BRU',
  'antonio-joao': 'AJO',
  'santa-terezinha': 'STE',
  'carapicuiba': 'CPB',
  'gen-miguel-costa': 'GMC',
  'quitauna': 'QTU',
  'cmdte-sampaio': 'CSA',
  'osasco': 'OSA',
  'pres-altino': 'PAL',
  'imp-leopoldina': 'ILE',
  'domingos-moraes': 'DMO',
  'lapa': 'LAB',
  'barra-funda': 'BFU',
  'julio-prestes': 'JPR',
  'ceasa': 'CEA',
  'villa-lobos': 'JAG',
  'cid-universitaria': 'USP',
  'pinheiros': 'PIN',
  'hebraica-reboucas': 'HBR',
  'cidade-jardim': 'CJD',
  'vila-olimpia': 'VOL',
  'berrini': 'BRR',
  'morumbi': 'MRB',
  'granja-julieta': 'GJT',
  'joao-dias': 'JOD',
  'santo-amaro': 'SAM',
  'socorro': 'SOC',
  'jurubatuba': 'JUR',
  'autodromo': 'AUT',
  'primavera-interlagos': 'INT',
  'grajau': 'GRA',
  'mendes-vila-natal': 'MED',
  'varginha': 'VGA'
};

// Catálogo das 41 estações com posições SVG e metadados
const stationsCatalog = window.stationsCatalog = {
  // LINHA 8 - DIAMANTE
  'amador-bueno': {
    id: 'amador-bueno', name: 'Amador Bueno', lines: ['L8'], city: 'Itapevi', km: 'Km 42,4',
    transfers: ['Extensão Operacional Linha 8'], x: 42, y: 78, labelPos: 'top'
  },
  'santa-rita': {
    id: 'santa-rita', name: 'Santa Rita', lines: ['L8'], city: 'Itapevi', km: 'Km 39,8',
    transfers: ['Extensão Operacional Linha 8'], x: 82, y: 78, labelPos: 'bottom'
  },
  'itapevi': {
    id: 'itapevi', name: 'Itapevi', lines: ['L8'], city: 'Itapevi', km: 'Km 36,1',
    transfers: ['Terminal Rodoviário Itapevi', 'Conexão Extensão Amador Bueno'], x: 122, y: 78, labelPos: 'top', isTransfer: true
  },
  'eng-cardoso': {
    id: 'eng-cardoso', name: 'Engenheiro Cardoso', lines: ['L8'], city: 'Itapevi', km: 'Km 34,2',
    transfers: [], x: 158, y: 78, labelPos: 'bottom'
  },
  'sagrado-coracao': {
    id: 'sagrado-coracao', name: 'Sagrado Coração', lines: ['L8'], city: 'Jandira', km: 'Km 31,9',
    transfers: [], x: 192, y: 92, labelPos: 'top'
  },
  'jandira': {
    id: 'jandira', name: 'Jandira', lines: ['L8'], city: 'Jandira', km: 'Km 29,7',
    transfers: ['Terminal Municipal de Jandira'], x: 224, y: 112, labelPos: 'bottom'
  },
  'jardim-silveira': {
    id: 'jardim-silveira', name: 'Jardim Silveira', lines: ['L8'], city: 'Barueri', km: 'Km 27,8',
    transfers: ['Terminal Jardim Silveira'], x: 254, y: 132, labelPos: 'top'
  },
  'jardim-belval': {
    id: 'jardim-belval', name: 'Jardim Belval', lines: ['L8'], city: 'Barueri', km: 'Km 26,1',
    transfers: [], x: 282, y: 150, labelPos: 'bottom'
  },
  'barueri': {
    id: 'barueri', name: 'Barueri', lines: ['L8'], city: 'Barueri', km: 'Km 24,0',
    transfers: ['Terminal Rodoferroviário Gualberto Tolaine'], x: 312, y: 164, labelPos: 'top'
  },
  'antonio-joao': {
    id: 'antonio-joao', name: 'Antonio João', lines: ['L8'], city: 'Barueri', km: 'Km 21,9',
    transfers: ['Acesso Parque Shopping Barueri / Alphaville'], x: 340, y: 164, labelPos: 'bottom'
  },
  'santa-terezinha': {
    id: 'santa-terezinha', name: 'Santa Terezinha', lines: ['L8'], city: 'Carapicuíba', km: 'Km 20,6',
    transfers: [], x: 367, y: 164, labelPos: 'top'
  },
  'carapicuiba': {
    id: 'carapicuiba', name: 'Carapicuíba', lines: ['L8'], city: 'Carapicuíba', km: 'Km 19,2',
    transfers: ['Terminal Metropolitano Carapicuíba (EMTU)'], x: 394, y: 164, labelPos: 'bottom'
  },
  'gen-miguel-costa': {
    id: 'gen-miguel-costa', name: 'Gen. Miguel Costa', lines: ['L8'], city: 'Carapicuíba', km: 'Km 17,5',
    transfers: ['Terminal Urbano Km 21'], x: 420, y: 164, labelPos: 'top'
  },
  'quitauna': {
    id: 'quitauna', name: 'Quitaúna', lines: ['L8'], city: 'Osasco', km: 'Km 16,2',
    transfers: [], x: 444, y: 164, labelPos: 'bottom'
  },
  'cmdte-sampaio': {
    id: 'cmdte-sampaio', name: 'Comandante Sampaio', lines: ['L8'], city: 'Osasco', km: 'Km 14,9',
    transfers: [], x: 468, y: 164, labelPos: 'top'
  },

  // INTEGRAÇÃO L8 & L9
  'osasco': {
    id: 'osasco', name: 'Osasco', lines: ['L8', 'L9'], city: 'Osasco', km: 'Km 13,3',
    transfers: ['Integração Livre Linha 8 - Diamante ⇄ Linha 9 - Esmeralda', 'Terminal Largo de Osasco'],
    x: 495, y: 164, labelPos: 'bottom', isTransfer: true
  },
  'pres-altino': {
    id: 'pres-altino', name: 'Presidente Altino', lines: ['L8', 'L9'], city: 'Osasco', km: 'Km 11,6',
    transfers: ['Integração Livre Linha 8 - Diamante ⇄ Linha 9 - Esmeralda', 'Pátio Central ViaMobilidade'],
    x: 540, y: 164, labelPos: 'top', isTransfer: true
  },

  // CONTINUAÇÃO LINHA 8
  'imp-leopoldina': {
    id: 'imp-leopoldina', name: 'Imperatriz Leopoldina', lines: ['L8'], city: 'São Paulo', km: 'Km 9,7',
    transfers: ['Acesso Vila Leopoldina'], x: 615, y: 132, labelPos: 'top'
  },
  'domingos-moraes': {
    id: 'domingos-moraes', name: 'Domingos de Moraes', lines: ['L8'], city: 'São Paulo', km: 'Km 7,4',
    transfers: [], x: 690, y: 112, labelPos: 'bottom'
  },
  'lapa': {
    id: 'lapa', name: 'Lapa', lines: ['L8'], city: 'São Paulo', km: 'Km 6,2',
    transfers: ['Terminal Lapa SPTrans'], x: 770, y: 98, labelPos: 'top'
  },
  'barra-funda': {
    id: 'barra-funda', name: 'Palmeiras-Barra Funda', lines: ['L8'], city: 'São Paulo', km: 'Km 3,1',
    transfers: ['Linha 3 - Vermelha (Metrô)', 'Linha 7 - Rubi (TIC Trens)', 'Expresso Aeroporto (L13)', 'Rodoviária Barra Funda'],
    x: 865, y: 98, labelPos: 'top', isTransfer: true
  },
  'julio-prestes': {
    id: 'julio-prestes', name: 'Júlio Prestes', lines: ['L8'], city: 'São Paulo', km: 'Km 0,0',
    transfers: ['Sala São Paulo', 'Conexão Estação da Luz'], x: 965, y: 98, labelPos: 'top', isTransfer: true
  },

  // LINHA 9 - ESMERALDA
  'ceasa': {
    id: 'ceasa', name: 'Ceasa', lines: ['L9'], city: 'São Paulo', km: 'Km 13,1',
    transfers: ['CEAGESP Entreposto Central'], x: 562, y: 205, labelPos: 'left'
  },
  'villa-lobos': {
    id: 'villa-lobos', name: 'Villa-Lobos-Jaguaré', lines: ['L9'], city: 'São Paulo', km: 'Km 14,5',
    transfers: ['Parque Estadual Villa-Lobos'], x: 576, y: 242, labelPos: 'left'
  },
  'cid-universitaria': {
    id: 'cid-universitaria', name: 'Cidade Universitária', lines: ['L9'], city: 'São Paulo', km: 'Km 16,8',
    transfers: ['USP - Cidade Universitária / Butantã'], x: 598, y: 274, labelPos: 'left'
  },
  'pinheiros': {
    id: 'pinheiros', name: 'Pinheiros', lines: ['L9'], city: 'São Paulo', km: 'Km 18,3',
    transfers: ['Linha 4 - Amarela (ViaQuatro)', 'Terminal Pinheiros SPTrans'],
    x: 632, y: 304, labelPos: 'right', isTransfer: true
  },
  'hebraica-reboucas': {
    id: 'hebraica-reboucas', name: 'Hebraica-Rebouças', lines: ['L9'], city: 'São Paulo', km: 'Km 19,7',
    transfers: ['Shopping Eldorado / Faria Lima'], x: 654, y: 332, labelPos: 'right'
  },
  'cidade-jardim': {
    id: 'cidade-jardim', name: 'Cidade Jardim', lines: ['L9'], city: 'São Paulo', km: 'Km 21,2',
    transfers: ['Parque do Povo / Itaim Bibi'], x: 654, y: 360, labelPos: 'right'
  },
  'vila-olimpia': {
    id: 'vila-olimpia', name: 'Vila Olímpia', lines: ['L9'], city: 'São Paulo', km: 'Km 22,4',
    transfers: ['Eixo Empresarial Vila Olímpia / JK'], x: 654, y: 388, labelPos: 'right'
  },
  'berrini': {
    id: 'berrini', name: 'Berrini', lines: ['L9'], city: 'São Paulo', km: 'Km 23,8',
    transfers: ['Corredor Eng. Luís Carlos Berrini'], x: 654, y: 416, labelPos: 'right'
  },
  'morumbi': {
    id: 'morumbi', name: 'Morumbi', lines: ['L9'], city: 'São Paulo', km: 'Km 25,2',
    transfers: ['Futura Linha 17 - Ouro (Monotrilho)', 'MorumbiShopping / Rochaverá'],
    x: 654, y: 444, labelPos: 'right', isTransfer: true
  },
  'granja-julieta': {
    id: 'granja-julieta', name: 'Granja Julieta', lines: ['L9'], city: 'São Paulo', km: 'Km 26,6',
    transfers: ['Polo Empresarial Chácara Santo Antônio'], x: 654, y: 472, labelPos: 'right'
  },
  'joao-dias': {
    id: 'joao-dias', name: 'João Dias', lines: ['L9'], city: 'São Paulo', km: 'Km 27,9',
    transfers: ['Acesso Ponte João Dias'], x: 654, y: 500, labelPos: 'right'
  },
  'santo-amaro': {
    id: 'santo-amaro', name: 'Santo Amaro', lines: ['L9'], city: 'São Paulo', km: 'Km 29,4',
    transfers: ['Linha 5 - Lilás (ViaMobilidade)', 'Terminal Guido Caloi SPTrans'],
    x: 654, y: 528, labelPos: 'right', isTransfer: true
  },
  'socorro': {
    id: 'socorro', name: 'Socorro', lines: ['L9'], city: 'São Paulo', km: 'Km 31,0',
    transfers: ['Largo do Socorro'], x: 668, y: 556, labelPos: 'left'
  },
  'jurubatuba': {
    id: 'jurubatuba', name: 'Jurubatuba', lines: ['L9'], city: 'São Paulo', km: 'Km 32,8',
    transfers: ['Shopping SP Market'], x: 695, y: 580, labelPos: 'left'
  },
  'autodromo': {
    id: 'autodromo', name: 'Autódromo', lines: ['L9'], city: 'São Paulo', km: 'Km 35,6',
    transfers: ['Autódromo de Interlagos (F1 / Lollapalooza / The Town)'], x: 735, y: 602, labelPos: 'bottom'
  },
  'primavera-interlagos': {
    id: 'primavera-interlagos', name: 'Primavera-Interlagos', lines: ['L9'], city: 'São Paulo', km: 'Km 37,5',
    transfers: [], x: 785, y: 618, labelPos: 'top'
  },
  'grajau': {
    id: 'grajau', name: 'Grajaú', lines: ['L9'], city: 'São Paulo', km: 'Km 39,4',
    transfers: ['Terminal Grajaú SPTrans'], x: 840, y: 628, labelPos: 'bottom', isTransfer: true
  },
  'mendes-vila-natal': {
    id: 'mendes-vila-natal', name: 'Bruno Covas / Mendes-Vila Natal', lines: ['L9'], city: 'São Paulo', km: 'Km 41,8',
    transfers: ['Terminal Urbano Vila Natal'], x: 910, y: 628, labelPos: 'top'
  },
  'varginha': {
    id: 'varginha', name: 'Varginha', lines: ['L9'], city: 'São Paulo', km: 'Km 44,2',
    transfers: ['Terminal Varginha (Extremo Sul)'], x: 985, y: 628, labelPos: 'bottom', isTransfer: true
  }
};

const line8Sequence = [
  'amador-bueno', 'santa-rita', 'itapevi', 'eng-cardoso', 'sagrado-coracao',
  'jandira', 'jardim-silveira', 'jardim-belval', 'barueri', 'antonio-joao',
  'santa-terezinha', 'carapicuiba', 'gen-miguel-costa', 'quitauna', 'cmdte-sampaio',
  'osasco', 'pres-altino', 'imp-leopoldina', 'domingos-moraes', 'lapa',
  'barra-funda', 'julio-prestes'
];

const line9Sequence = [
  'osasco', 'pres-altino', 'ceasa', 'villa-lobos', 'cid-universitaria',
  'pinheiros', 'hebraica-reboucas', 'cidade-jardim', 'vila-olimpia', 'berrini',
  'morumbi', 'granja-julieta', 'joao-dias', 'santo-amaro', 'socorro',
  'jurubatuba', 'autodromo', 'primavera-interlagos', 'grajau', 'mendes-vila-natal',
  'varginha'
];

let currentSelectedStationId = 'pinheiros';
let currentMapFilter = 'all';
let showHeatmapBubbles = true;

let mapZoom = 1;
let mapPanX = 0;
let mapPanY = 0;
let isDraggingMap = false;
let dragStartX = 0;
let dragStartY = 0;
let mapPanZoomInitialized = false;

function formatNumberBR(num) {
  return Math.round(num || 0).toLocaleString('pt-BR');
}

function formatCompactBR(num) {
  num = num || 0;
  if (num >= 1000000) {
    return (num / 1000000).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' mi';
  }
  if (num >= 1000) {
    return Math.round(num / 1000).toLocaleString('pt-BR') + ' mil';
  }
  return formatNumberBR(num);
}

function getSelectedMapPeriodLabel() {
  const yearSelect = document.getElementById('map-filter-year');
  const monthSelect = document.getElementById('map-filter-month');
  const yearStr = yearSelect ? yearSelect.value : '2024';
  const monthVal = monthSelect ? monthSelect.value : 'all';

  if (monthVal === 'all') {
    return `Acumulado Anual / ${yearStr}`;
  }
  return `${mapMonthNamesFull[parseInt(monthVal, 10)]} / ${yearStr}`;
}

// Formata Badge de Tendência com Cores Semânticas (kpi-dashboard-design & data-storytelling)
function formatTrendBadge(pct, label = '') {
  if (pct === null || pct === undefined || isNaN(pct)) {
    return `<span class="trend-badge trend-neutral">-- ${label}</span>`;
  }
  const isUp = pct > 0.05;
  const isDown = pct < -0.05;
  const sign = pct > 0 ? '▲ +' : (pct < 0 ? '▼ ' : '● ');
  const cssClass = isUp ? 'trend-up' : (isDown ? 'trend-down' : 'trend-neutral');
  return `<span class="trend-badge ${cssClass}">${sign}${Math.abs(pct).toFixed(1).replace('.', ',')}% ${label}</span>`;
}

// Focaliza a estação de pico de evento e sincroniza o período no mapa
window.focusEventStation = function(stationId, targetYear, targetMonth) {
  let id = stationId;
  if (!stationsCatalog[id]) {
    for (const [key, code] of Object.entries(stationCodeMap)) {
      if (code.toLowerCase() === stationId.toLowerCase() || key.toLowerCase() === stationId.toLowerCase()) {
        id = key;
        break;
      }
    }
  }

  const yearSelect = document.getElementById('map-filter-year');
  const monthSelect = document.getElementById('map-filter-month');
  if (yearSelect && targetYear) {
    yearSelect.value = targetYear.toString();
  }
  if (monthSelect && targetMonth) {
    monthSelect.value = (targetMonth - 1).toString();
  }

  if (window.handleMapPeriodFilterChange) {
    window.handleMapPeriodFilterChange();
  }

  if (window.selectStationOnMap && stationsCatalog[id]) {
    window.selectStationOnMap(id);
  }

  const mapEl = document.getElementById('map-viewport');
  if (mapEl) {
    mapEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
};

// Calcula estatísticas de fluxo e arrecadação de uma estação a partir do AnalyticsCache O(1)
function getStationAnalytics(stationId, yearStr = '2024', monthVal = 'all') {
  if (window.AnalyticsCache) {
    return window.AnalyticsCache.getStationAnalytics(stationId, yearStr, monthVal);
  }
  return {
    total: 0,
    payingPassengers: 0,
    payingShare: 0.81,
    grossRevenue: 0,
    channels: { topBU: 0.63, qrCode: 0.16, nfc: 0.05, free: 0.16 },
    dailyWeekday: 0,
    weekendAvg: 0,
    peakHour: 0,
    yoyPercent: 0,
    momPercent: null
  };
}

function buildPolylinePoints(sequence, yOffset = 0) {
  return sequence.map(stId => {
    const s = stationsCatalog[stId];
    if (!s) return '0,0';
    const offset = (stId === 'osasco' || stId === 'pres-altino') ? yOffset : 0;
    return `${s.x},${s.y + offset}`;
  }).join(' ');
}

// Renderiza o mapa SVG interativo
function renderInteractiveMap() {
  const tracksLayer = document.getElementById('svg-tracks-layer');
  const stationsLayer = document.getElementById('svg-stations-layer');
  if (!tracksLayer || !stationsLayer || !state.data) return;

  const l8Points = buildPolylinePoints(line8Sequence, -4);
  const l9Points = buildPolylinePoints(line9Sequence, 4);

  tracksLayer.innerHTML = `
    <!-- Linha 8 - Diamante (#9E9E93) -->
    <polyline id="svg-line-L8" class="track-line" points="${l8Points}" 
      fill="none" stroke="${COLOR_L8_DIAMANTE}" stroke-width="7.5" stroke-linecap="round" stroke-linejoin="round" filter="url(#glow-l8)" />

    <!-- Linha 9 - Esmeralda (#00A88F) -->
    <polyline id="svg-line-L9" class="track-line" points="${l9Points}" 
      fill="none" stroke="${COLOR_L9_ESMERALDA}" stroke-width="7.5" stroke-linecap="round" stroke-linejoin="round" filter="url(#glow-l9)" />
  `;

  const yearSelect = document.getElementById('map-filter-year');
  const monthSelect = document.getElementById('map-filter-month');
  const yearStr = yearSelect ? yearSelect.value : '2024';
  const monthVal = monthSelect ? monthSelect.value : 'all';

  let stationsHtml = '';
  Object.values(stationsCatalog).forEach(st => {
    const isDual = st.lines.length === 2;
    const strokeColor = st.lines[0] === 'L8' ? COLOR_L8_DIAMANTE : COLOR_L9_ESMERALDA;
    const radius = st.isTransfer ? 7 : 5.5;

    let textX = st.x;
    let textY = st.y - 13;
    let anchor = 'middle';
    let rotation = '';

    if (st.labelPos === 'top') {
      textY = st.y - 13;
      if (st.x < 480 && st.lines.includes('L8')) {
        rotation = `transform="rotate(-34 ${st.x} ${st.y - 11})"`;
        anchor = 'start';
      }
    } else if (st.labelPos === 'bottom') {
      textY = st.y + 21;
      if (st.x < 480 && st.lines.includes('L8')) {
        rotation = `transform="rotate(34 ${st.x} ${st.y + 15})"`;
        anchor = 'start';
      }
    } else if (st.labelPos === 'right') {
      textX = st.x + 15;
      textY = st.y + 3.5;
      anchor = 'start';
    } else if (st.labelPos === 'left') {
      textX = st.x - 15;
      textY = st.y + 3.5;
      anchor = 'end';
    }

    const isSelected = st.id === currentSelectedStationId;
    const selectedClass = isSelected ? 'selected-station' : '';
    const stats = getStationAnalytics(st.id, yearStr, monthVal);

    stationsHtml += `
      <g class="station-node ${selectedClass}" id="st-node-${st.id}" data-lines="${st.lines.join(',')}" data-transfer="${!!st.isTransfer}" 
        onclick="selectStationOnMap('${st.id}')"
        onmouseenter="showStationHoverCard(event, '${st.id}')"
        onmousemove="moveStationHoverCard(event)"
        onmouseleave="hideStationHoverCard()">
        ${isSelected ? `<circle cx="${st.x}" cy="${st.y}" r="14" fill="none" stroke="#facc15" stroke-width="2.5" class="selected-pulse-ring" />` : ''}
        ${isDual ? `
          <circle cx="${st.x}" cy="${st.y - 4}" r="5.5" fill="#050912" stroke="${COLOR_L8_DIAMANTE}" stroke-width="3" class="station-circle" />
          <circle cx="${st.x}" cy="${st.y + 4}" r="5.5" fill="#050912" stroke="${COLOR_L9_ESMERALDA}" stroke-width="3" class="station-circle" />
        ` : `
          <circle cx="${st.x}" cy="${st.y}" r="${radius}" fill="#050912" stroke="${strokeColor}" stroke-width="${st.isTransfer ? 3.4 : 2.6}" class="station-circle" />
        `}
        <text x="${textX}" y="${textY}" text-anchor="${anchor}" ${rotation}
          fill="${isSelected ? '#fde047' : (st.isTransfer ? '#ffffff' : '#cbd5e1')}" 
          font-size="${st.isTransfer ? '10.5' : '9.5'}" 
          font-weight="${isSelected || st.isTransfer ? '800' : '600'}">
          ${st.name}
        </text>
      </g>
    `;
  });

  stationsLayer.innerHTML = stationsHtml;
  renderHeatmapBubbles();
  applyCurrentFilterClasses();
}

// Desenha os halos de demanda proporcionais
function renderHeatmapBubbles() {
  const heatmapLayer = document.getElementById('svg-heatmap-layer');
  if (!heatmapLayer) return;

  if (!showHeatmapBubbles) {
    heatmapLayer.innerHTML = '';
    return;
  }

  const yearSelect = document.getElementById('map-filter-year');
  const monthSelect = document.getElementById('map-filter-month');
  const yearStr = yearSelect ? yearSelect.value : '2024';
  const monthVal = monthSelect ? monthSelect.value : 'all';

  let maxTotal = 1;
  Object.keys(stationsCatalog).forEach(stId => {
    const val = getStationAnalytics(stId, yearStr, monthVal).total;
    if (val > maxTotal) maxTotal = val;
  });

  let bubblesHtml = '';
  Object.values(stationsCatalog).forEach(st => {
    if (currentMapFilter === 'L8' && !st.lines.includes('L8')) return;
    if (currentMapFilter === 'L9' && !st.lines.includes('L9')) return;
    if (currentMapFilter === 'transfer' && !st.isTransfer) return;

    const val = getStationAnalytics(st.id, yearStr, monthVal).total;
    const ratio = Math.sqrt(val / maxTotal);
    const radius = 8 + ratio * 22;
    const bubbleColor = st.lines.includes('L9') ? COLOR_L9_ESMERALDA : COLOR_L8_DIAMANTE;

    bubblesHtml += `
      <circle cx="${st.x}" cy="${st.y}" r="${radius.toFixed(1)}" 
        fill="${bubbleColor}" fill-opacity="0.16" 
        stroke="${bubbleColor}" stroke-opacity="0.38" stroke-width="1"
        pointer-events="none" />
    `;
  });

  heatmapLayer.innerHTML = bubblesHtml;
}

window.toggleHeatmapBubbles = function() {
  showHeatmapBubbles = !showHeatmapBubbles;
  const btn = document.getElementById('btn-heatmap-bubbles');
  if (btn) {
    if (showHeatmapBubbles) {
      btn.style.background = 'rgba(250, 204, 21, 0.15)';
      btn.style.color = '#fde047';
      btn.style.border = '1px solid rgba(250, 204, 21, 0.35)';
      btn.innerHTML = '<i data-lucide="flame" style="width: 14px; height: 14px;"></i><span>Halos de Demanda: ON</span>';
    } else {
      btn.style.background = '#050912';
      btn.style.color = 'var(--text-muted)';
      btn.style.border = '1px solid rgba(255, 255, 255, 0.1)';
      btn.innerHTML = '<i data-lucide="flame" style="width: 14px; height: 14px;"></i><span>Halos de Demanda: OFF</span>';
    }
  }
  renderHeatmapBubbles();
  if (window.lucide) lucide.createIcons();
};

window.handleMapPeriodFilterChange = function() {
  const periodLabel = getSelectedMapPeriodLabel();
  const cornerPeriodEl = document.getElementById('map-corner-period');
  if (cornerPeriodEl) cornerPeriodEl.textContent = periodLabel.toUpperCase();

  updateNetworkKPIs();
  renderInteractiveMap();
  selectStationOnMap(currentSelectedStationId);
  renderTop10Ranking();
};

function updateNetworkKPIs() {
  if (!state.data || !state.data.daily) return;
  const yearSelect = document.getElementById('map-filter-year');
  const monthSelect = document.getElementById('map-filter-month');
  const yearStr = yearSelect ? yearSelect.value : '2024';
  const monthVal = monthSelect ? monthSelect.value : 'all';
  const periodLabel = getSelectedMapPeriodLabel();

  const records = state.data.daily.filter(r => {
    if (yearStr !== 'all' && r.y.toString() !== yearStr.toString()) return false;
    if (monthVal !== 'all') {
      const targetMonth = parseInt(monthVal, 10) + 1;
      if (r.m !== targetMonth) return false;
    }
    return true;
  });

  let totalL8 = 0, totalL9 = 0, revL8 = 0, revL9 = 0;
  records.forEach(r => {
    totalL8 += (r.l8_e || 0);
    totalL9 += (r.l9_e || 0);
    revL8 += (r.l8_r || 0);
    revL9 += (r.l9_r || 0);
  });

  const totalNetwork = totalL8 + totalL9;
  const totalRevenue = revL8 + revL9;
  const shareL8 = totalNetwork > 0 ? ((totalL8 / totalNetwork) * 100).toFixed(1).replace('.', ',') : '0,0';
  const shareL9 = totalNetwork > 0 ? ((totalL9 / totalNetwork) * 100).toFixed(1).replace('.', ',') : '0,0';

  const kpiPeriodEl = document.getElementById('kpi-period-label');
  if (kpiPeriodEl) kpiPeriodEl.textContent = `Giro Total Rede (${periodLabel})`;

  const kpiTotNetEl = document.getElementById('kpi-total-network');
  if (kpiTotNetEl) kpiTotNetEl.textContent = formatNumberBR(totalNetwork);

  const kpiRevNetEl = document.getElementById('kpi-network-revenue');
  if (kpiRevNetEl) kpiRevNetEl.textContent = `Arrecadação Bruta: R$ ${formatNumberBR(totalRevenue)}`;

  const kpiL8El = document.getElementById('kpi-total-l8');
  if (kpiL8El) kpiL8El.textContent = formatNumberBR(totalL8);

  const kpiL9El = document.getElementById('kpi-total-l9');
  if (kpiL9El) kpiL9El.textContent = formatNumberBR(totalL9);

  const netStats = window.AnalyticsCache 
    ? window.AnalyticsCache.getNetworkKPIs(yearStr, monthVal)
    : null;

  if (netStats) {
    const kpiPeriodEl = document.getElementById('kpi-period-label');
    if (kpiPeriodEl) kpiPeriodEl.textContent = `Giro Total Rede (${periodLabel})`;

    const kpiTotNetEl = document.getElementById('kpi-total-network');
    if (kpiTotNetEl) kpiTotNetEl.textContent = formatNumberBR(netStats.totalNetwork);

    const kpiRevNetEl = document.getElementById('kpi-network-revenue');
    if (kpiRevNetEl) kpiRevNetEl.textContent = `Arrecadação Bruta: R$ ${formatNumberBR(netStats.totalRevenue)}`;

    const kpiL8El = document.getElementById('kpi-total-l8');
    if (kpiL8El) kpiL8El.textContent = formatNumberBR(netStats.totalL8);

    const kpiL9El = document.getElementById('kpi-total-l9');
    if (kpiL9El) kpiL9El.textContent = formatNumberBR(netStats.totalL9);

    const kpiShareL8El = document.getElementById('kpi-share-l8');
    if (kpiShareL8El) kpiShareL8El.textContent = `R$ ${formatCompactBR(netStats.revL8)} • ${netStats.shareL8}% da rede`;

    const kpiShareL9El = document.getElementById('kpi-share-l9');
    if (kpiShareL9El) kpiShareL9El.textContent = `R$ ${formatCompactBR(netStats.revL9)} • ${netStats.shareL9}% da rede`;

    const mapTrendTot = document.getElementById('map-trend-total');
    if (mapTrendTot) mapTrendTot.innerHTML = `${formatTrendBadge(netStats.yoyNet, 'YoY')} ${formatTrendBadge(netStats.momNet, 'MoM')}`;

    const mapTrendL8 = document.getElementById('map-trend-l8');
    if (mapTrendL8) mapTrendL8.innerHTML = `${formatTrendBadge(netStats.yoyL8, 'YoY')} ${formatTrendBadge(netStats.momL8, 'MoM')}`;

    const mapTrendL9 = document.getElementById('map-trend-l9');
    if (mapTrendL9) mapTrendL9.innerHTML = `${formatTrendBadge(netStats.yoyL9, 'YoY')} ${formatTrendBadge(netStats.momL9, 'MoM')}`;
  }
}

window.selectStationOnMap = function(stationId) {
  const st = stationsCatalog[stationId];
  if (!st || !state.data) return;

  currentSelectedStationId = stationId;

  const yearSelect = document.getElementById('map-filter-year');
  const monthSelect = document.getElementById('map-filter-month');
  const yearStr = yearSelect ? yearSelect.value : '2024';
  const monthVal = monthSelect ? monthSelect.value : 'all';
  const periodLabel = getSelectedMapPeriodLabel();

  // Re-renderiza nós para atualizar o anel de pulso
  renderInteractiveMap();

  const stats = getStationAnalytics(stationId, yearStr, monthVal);

  const primaryLine = st.lines.includes('L9') && !st.lines.includes('L8') ? 'L9' : st.lines[0];
  const ranks = window.AnalyticsCache 
    ? window.AnalyticsCache.getStationRanks(stationId, yearStr, monthVal)
    : { lineRank: 1, globalRank: 1 };
  const rankPosition = ranks.lineRank;

  const netStats = window.AnalyticsCache ? window.AnalyticsCache.getNetworkKPIs(yearStr, monthVal) : null;
  const lineTotalPax = netStats ? (primaryLine === 'L8' ? netStats.totalL8 : netStats.totalL9) : stats.total;
  const stationShareInLine = lineTotalPax > 0 ? ((stats.total / lineTotalPax) * 100).toFixed(1).replace('.', ',') : '0,0';

  const stationThemeColor = primaryLine === 'L8' ? COLOR_L8_DIAMANTE : COLOR_L9_ESMERALDA;
  const accentBarEl = document.getElementById('st-accent-bar');
  if (accentBarEl) accentBarEl.style.backgroundColor = stationThemeColor;

  const badgesEl = document.getElementById('st-detail-badges');
  if (badgesEl) {
    badgesEl.innerHTML = st.lines.map(line => {
      if (line === 'L8') {
        return `<span style="padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 800; color: #04070e; background-color: ${COLOR_L8_DIAMANTE};">LINHA 8 - DIAMANTE</span>`;
      }
      return `<span style="padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 800; color: #04070e; background-color: ${COLOR_L9_ESMERALDA};">LINHA 9 - ESMERALDA</span>`;
    }).join('');
  }

  const nameEl = document.getElementById('st-detail-name');
  if (nameEl) nameEl.textContent = st.name;

  const cityEl = document.getElementById('st-detail-city');
  if (cityEl) {
    cityEl.innerHTML = `
      <i data-lucide="map-pin" style="width: 13px; height: 13px; color: ${stationThemeColor};"></i>
      <span>Município: <strong>${st.city}</strong> • ${st.km}</span>
    `;
  }

  const rankEl = document.getElementById('st-detail-rank');
  if (rankEl) rankEl.textContent = `#${rankPosition} na Linha ${primaryLine.replace('L', '')}`;

  const periodTitleEl = document.getElementById('st-passengers-period-title');
  if (periodTitleEl) periodTitleEl.textContent = `Passageiros (Giro) • ${periodLabel}`;

  const passTotalEl = document.getElementById('st-passengers-total');
  if (passTotalEl) passTotalEl.textContent = formatNumberBR(stats.total);

  const revTotalEl = document.getElementById('st-revenue-total');
  if (revTotalEl) revTotalEl.textContent = `R$ ${formatNumberBR(stats.grossRevenue)}`;

  const yoySign = stats.yoyPercent >= 0 ? '+' : '';
  const yoyEl = document.getElementById('st-passengers-yoy');
  if (yoyEl) yoyEl.textContent = `${yoySign}${stats.yoyPercent.toFixed(1).replace('.', ',')}% YoY`;

  const trendsEl = document.getElementById('st-passengers-trends');
  if (trendsEl) {
    const yoyBadge = formatTrendBadge(stats.yoyPercent, 'YoY');
    const momBadge = formatTrendBadge(stats.momPercent, 'MoM');
    trendsEl.innerHTML = `${yoyBadge} ${momBadge}`;
  }

  const lineFullName = primaryLine === 'L8' ? 'Linha 8 - Diamante' : 'Linha 9 - Esmeralda';
  const shareEl = document.getElementById('st-passengers-share');
  if (shareEl) {
    shareEl.innerHTML = `
      Representa <strong style="color: #fff;">${stationShareInLine}%</strong> do fluxo de passageiros da <strong>${lineFullName}</strong>.
    `;
  }

  const dailyAvgEl = document.getElementById('st-daily-avg');
  if (dailyAvgEl) dailyAvgEl.textContent = formatNumberBR(stats.dailyWeekday);

  const weekendAvgEl = document.getElementById('st-paying-pax');
  if (weekendAvgEl) weekendAvgEl.textContent = formatNumberBR(stats.weekendAvg);

  const peakHourEl = document.getElementById('st-peak-hour');
  if (peakHourEl) peakHourEl.textContent = `${formatNumberBR(stats.peakHour)}/h`;

  const kpiSelNameEl = document.getElementById('kpi-selected-station-name');
  if (kpiSelNameEl) kpiSelNameEl.textContent = `${st.name} (${st.lines.join('/')})`;

  const kpiSelPaxEl = document.getElementById('kpi-selected-station-pax');
  if (kpiSelPaxEl) kpiSelPaxEl.textContent = `${formatNumberBR(stats.total)} giros • R$ ${formatCompactBR(stats.grossRevenue)}`;

  // Canais de Arrecadação na Catraca
  const channelsEl = document.getElementById('st-payment-channels');
  if (channelsEl) {
    const channelList = [
      { key: 'topBU', label: 'Cartão TOP / Bilhete Único', color: stationThemeColor, share: 0.63 },
      { key: 'qrCode', label: 'QR Code Digital / Carteiras', color: '#38bdf8', share: 0.16 },
      { key: 'nfc', label: 'Aproximação NFC (Débito/Crédito)', color: '#a855f7', share: 0.05 },
      { key: 'free', label: 'Gratuidades / Integração Livre', color: '#64748b', share: 0.16 }
    ];

    channelsEl.innerHTML = channelList.map(ch => {
      const paxVolume = Math.round(stats.total * ch.share);
      const pctFormatted = (ch.share * 100).toFixed(1).replace('.', ',');

      return `
        <div style="display: flex; flex-direction: column; gap: 3px;">
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px;">
            <span style="color: #cbd5e1;">${ch.label}</span>
            <span class="font-mono-tech" style="color: #fff; font-weight: 700;">
              ${formatNumberBR(paxVolume)} <span style="color: var(--text-muted); font-weight: 400;">(${pctFormatted}%)</span>
            </span>
          </div>
          <div style="width: 100%; height: 5px; background: #0f172a; border-radius: 9999px; overflow: hidden;">
            <div style="height: 100%; width: ${(ch.share * 100).toFixed(1)}%; background-color: ${ch.color}; border-radius: 9999px;"></div>
          </div>
        </div>
      `;
    }).join('');
  }

  // Parque de Arrecadação
  const equipGridEl = document.getElementById('st-equipment-grid');
  if (equipGridEl) {
    const isLargeStation = ['pinheiros', 'barra-funda', 'osasco', 'santo-amaro', 'itapevi', 'grajau'].includes(stationId);
    const gates = isLargeStation ? 28 : (stats.dailyWeekday > 35000 ? 18 : 10);
    const nfc = isLargeStation ? 12 : 6;
    const atms = isLargeStation ? 8 : 4;

    equipGridEl.innerHTML = `
      <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(255,255,255,0.06); border-radius: var(--radius-sm); padding: 0.4rem;">
        <span style="font-size: 10px; color: var(--text-muted); display: block;">Bloqueios</span>
        <strong class="font-mono-tech" style="font-size: 12px; font-weight: 800; color: #fff;">${gates}/${gates}</strong>
      </div>
      <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(255,255,255,0.06); border-radius: var(--radius-sm); padding: 0.4rem;">
        <span style="font-size: 10px; color: var(--text-muted); display: block;">Catracas NFC</span>
        <strong class="font-mono-tech" style="font-size: 12px; font-weight: 800; color: #38bdf8;">${nfc} unid.</strong>
      </div>
      <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(255,255,255,0.06); border-radius: var(--radius-sm); padding: 0.4rem;">
        <span style="font-size: 10px; color: var(--text-muted); display: block;">ATMs Recarga</span>
        <strong class="font-mono-tech" style="font-size: 12px; font-weight: 800; color: #facc15;">${atms} term.</strong>
      </div>
    `;
  }

  // Renderiza o gráfico de barras dos 12 meses
  renderStationMonthlyChart(stationId, yearStr, monthVal, stationThemeColor);

  if (window.lucide) lucide.createIcons();
};

function renderStationMonthlyChart(stationId, yearStr, selectedMonthVal, barColor) {
  const st = stationsCatalog[stationId];
  const code = stationCodeMap[stationId];
  if (!st || !code || !state.data || !state.data.daily) return;

  const titleEl = document.getElementById('chart-station-title');
  if (titleEl) {
    titleEl.innerHTML = `<i data-lucide="bar-chart-2" style="width: 14px; height: 14px; color: #00A88F;"></i> Sazonalidade • ${st.name}`;
  }

  const badgeEl = document.getElementById('chart-year-badge');
  if (badgeEl) badgeEl.textContent = yearStr;

  const monthlyValues = [];
  let maxVal = 1;

  for (let m = 1; m <= 12; m++) {
    const mRecords = state.data.daily.filter(r => r.y.toString() === yearStr.toString() && r.m === m);
    const mTotal = mRecords.reduce((acc, r) => acc + (r.st[code] || 0), 0);
    monthlyValues.push(mTotal);
    if (mTotal > maxVal) maxVal = mTotal;
  }

  const container = document.getElementById('monthly-chart-bars');
  if (!container) return;

  container.innerHTML = monthlyValues.map((val, idx) => {
    const heightPct = Math.max(16, Math.round((val / maxVal) * 100));
    const isCurrentSelectedMonth = selectedMonthVal !== 'all' && parseInt(selectedMonthVal, 10) === idx;
    const bgStyle = isCurrentSelectedMonth
      ? 'background-color: #facc15; box-shadow: 0 0 10px rgba(250, 204, 21, 0.7);'
      : `background-color: ${barColor}; opacity: ${selectedMonthVal === 'all' ? '0.85' : '0.45'};`;

    return `
      <div onclick="selectSpecificMonthFromChart(${idx})" class="station-season-bar" title="${mapMonthNamesFull[idx]}/${yearStr}: ${formatNumberBR(val)} passageiros">
        <div style="width: 100%; border-radius: 3px 3px 0 0; transition: all 0.2s; height: ${heightPct}%; ${bgStyle}"></div>
        <span class="font-mono-tech" style="font-size: 9px; margin-top: 4px; ${isCurrentSelectedMonth ? 'color: #fde047; font-weight: 800;' : 'color: var(--text-muted);'}">
          ${mapMonthNamesShort[idx]}
        </span>
      </div>
    `;
  }).join('');
}

window.selectSpecificMonthFromChart = function(monthIdx) {
  const monthSelect = document.getElementById('map-filter-month');
  if (monthSelect) {
    monthSelect.value = String(monthIdx);
    handleMapPeriodFilterChange();
  }
};

function renderTop10Ranking() {
  if (!state.data) return;
  const yearSelect = document.getElementById('map-filter-year');
  const monthSelect = document.getElementById('map-filter-month');
  const yearStr = yearSelect ? yearSelect.value : '2024';
  const monthVal = monthSelect ? monthSelect.value : 'all';
  const periodLabel = getSelectedMapPeriodLabel();

  const subtitleEl = document.getElementById('ranking-period-subtitle');
  if (subtitleEl) subtitleEl.textContent = `Período: ${periodLabel} • Clique em uma estação para inspecionar no mapa`;

  const filteredStations = Object.values(stationsCatalog).filter(st => {
    if (currentMapFilter === 'L8') return st.lines.includes('L8');
    if (currentMapFilter === 'L9') return st.lines.includes('L9');
    if (currentMapFilter === 'transfer') return !!st.isTransfer;
    return true;
  });

  const ranked = filteredStations
    .map(st => ({
      station: st,
      stats: getStationAnalytics(st.id, yearStr, monthVal)
    }))
    .sort((a, b) => b.stats.total - a.stats.total)
    .slice(0, 10);

  const maxRankPax = ranked.length > 0 ? ranked[0].stats.total : 1;
  const grid = document.getElementById('top-stations-grid');
  if (!grid) return;

  grid.innerHTML = ranked.map((item, idx) => {
    const st = item.station;
    const isL9 = st.lines.includes('L9') && !st.lines.includes('L8');
    const lineColor = isL9 ? COLOR_L9_ESMERALDA : COLOR_L8_DIAMANTE;
    const pctWidth = Math.round((item.stats.total / maxRankPax) * 100);
    const isSelected = st.id === currentSelectedStationId;

    return `
      <div onclick="selectStationOnMap('${st.id}')" 
        class="ranking-station-card ${isSelected ? 'selected-card' : ''}">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span class="font-mono-tech" style="font-size: 11px; font-weight: 800; padding: 2px 6px; border-radius: 4px; background: #0f172a; color: #facc15; border: 1px solid rgba(255,255,255,0.1);">
            #${idx + 1}
          </span>
          <span class="font-mono-tech" style="font-size: 10px; font-weight: 800; padding: 2px 6px; border-radius: 4px; color: #04070e; background-color: ${lineColor};">
            ${st.lines.join(' / ')}
          </span>
        </div>
        <div>
          <h4 style="font-size: 13px; font-weight: 800; color: #fff; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${st.name}</h4>
          <p class="font-mono-tech" style="font-size: 12px; font-weight: 700; color: #cbd5e1; margin: 3px 0 0 0;">
            ${formatNumberBR(item.stats.total)} <span style="font-size: 10px; color: var(--text-muted); font-weight: 400;">giros</span>
          </p>
          <span class="font-mono-tech" style="font-size: 10px; color: #10b981; font-weight: 600; display: block; margin-top: 2px;">
            R$ ${formatCompactBR(item.stats.grossRevenue)}
          </span>
        </div>
        <div style="width: 100%; height: 5px; background: #0f172a; border-radius: 9999px; overflow: hidden; margin-top: 4px;">
          <div style="height: 100%; width: ${pctWidth}%; background-color: ${lineColor}; border-radius: 9999px;"></div>
        </div>
      </div>
    `;
  }).join('');
}

window.setMapFilter = function(filterType, options = {}) {
  currentMapFilter = filterType;

  ['all', 'L8', 'L9', 'transfer'].forEach(key => {
    const btn = document.getElementById(`filter-${key}`);
    if (btn) {
      if (key === filterType) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    }
  });

  applyCurrentFilterClasses();
  renderHeatmapBubbles();
  renderTop10Ranking();

  // Sincronização bi-direcional para o Menu dos Trens e Cards de KPI
  if (!options.fromTrain && typeof window.quickFilterLineScope === 'function') {
    const targetScope = filterType === 'L8' ? 'l8' : (filterType === 'L9' ? 'l9' : 'both');
    window.quickFilterLineScope(targetScope, { fromMap: true });
  }
};

function applyCurrentFilterClasses() {
  const line8El = document.getElementById('svg-line-L8');
  const line9El = document.getElementById('svg-line-L9');

  if (line8El) {
    line8El.classList.toggle('dimmed', currentMapFilter === 'L9');
    line8El.classList.toggle('active-line-glow', currentMapFilter === 'L8');
  }
  if (line9El) {
    line9El.classList.toggle('dimmed', currentMapFilter === 'L8');
    line9El.classList.toggle('active-line-glow', currentMapFilter === 'L9');
  }

  document.querySelectorAll('.station-node').forEach(node => {
    const lines = node.getAttribute('data-lines') || '';
    const isTransfer = node.getAttribute('data-transfer') === 'true';

    let visible = true;
    if (currentMapFilter === 'L8') visible = lines.includes('L8');
    if (currentMapFilter === 'L9') visible = lines.includes('L9');
    if (currentMapFilter === 'transfer') visible = isTransfer;

    node.classList.toggle('dimmed', !visible);
  });
}

window.handleMapStationSearch = function(query) {
  const clean = (query || '').trim().toLowerCase();
  if (!clean) {
    applyCurrentFilterClasses();
    return;
  }

  let firstMatchId = null;
  document.querySelectorAll('.station-node').forEach(node => {
    const stId = node.id.replace('st-node-', '');
    const st = stationsCatalog[stId];
    if (!st) return;
    const match = st.name.toLowerCase().includes(clean) || st.city.toLowerCase().includes(clean);
    node.classList.toggle('dimmed', !match);
    if (match && !firstMatchId) firstMatchId = stId;
  });

  if (firstMatchId) {
    selectStationOnMap(firstMatchId);
  }
};

window.exportArrecadacaoCSV = function() {
  const yearSelect = document.getElementById('map-filter-year');
  const monthSelect = document.getElementById('map-filter-month');
  const yearStr = yearSelect ? yearSelect.value : '2024';
  const monthVal = monthSelect ? monthSelect.value : 'all';
  const periodLabel = getSelectedMapPeriodLabel();

  const rows = [
    ['Estacao', 'Linhas', 'Municipio', 'Periodo', 'Passageiros_Giro_Catraca', 'Media_Dia_Util', 'Media_Fim_Semana', 'Pico_Horario', 'Receita_Bruta_Estimada_BRL']
  ];

  Object.values(stationsCatalog).forEach(st => {
    const stats = getStationAnalytics(st.id, yearStr, monthVal);
    rows.push([
      `"${st.name}"`,
      `"${st.lines.join('/')}"`,
      `"${st.city}"`,
      `"${periodLabel}"`,
      stats.total,
      stats.dailyWeekday,
      stats.weekendAvg,
      stats.peakHour,
      stats.grossRevenue
    ]);
  });

  const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + rows.map(e => e.join(';')).join('\n');
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `gestao_arrecadacao_L8_L9_${yearStr}_${monthVal}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

window.zoomMap = function(factor) {
  if (window.MapEngine) {
    window.MapEngine.setZoom(window.MapEngine.zoom * factor);
  }
};

window.resetMapView = function() {
  if (window.MapEngine) {
    window.MapEngine.resetView();
  }
};

function setupMapPanAndZoom() {
  if (window.MapEngine) {
    window.MapEngine.init();
  }
}

// =========================================================================
// TOOLTIPS FLUTUANTES (HOVER CARDS) DAS 41 ESTAÇÕES
// Delegado ao MapEngine e AnalyticsCache (60 FPS via requestAnimationFrame)
// =========================================================================
window.showStationHoverCard = function(e, stationId) {
  if (window.MapEngine) {
    window.MapEngine.showHoverCard(e, stationId);
  }
};

window.moveStationHoverCard = function(e) {
  if (window.MapEngine) {
    window.MapEngine.moveHoverCard(e);
  }
};

window.hideStationHoverCard = function() {
  if (window.MapEngine) {
    window.MapEngine.hideHoverCard();
  }
};

function initInteractiveRailMap() {
  if (!state.data) return;
  updateNetworkKPIs();
  renderInteractiveMap();
  selectStationOnMap(currentSelectedStationId || 'pinheiros');
  renderTop10Ranking();
  setupMapPanAndZoom();
  if (window.lucide) {
    lucide.createIcons();
  }
}

// Top 10 Stations Table in Overview
function renderTopStationsOverview(records) {
  const container = document.getElementById('overview-top-stations');
  if (!container || !state.data) return;

  const stationTotals = {};
  records.forEach(r => {
    for (let code in r.st) {
      stationTotals[code] = (stationTotals[code] || 0) + r.st[code];
    }
  });

  const sorted = state.data.stations.map(s => ({
    ...s,
    currentTotal: stationTotals[s.code] || 0,
    currentAvg: Math.round((stationTotals[s.code] || 0) / records.length)
  })).sort((a, b) => b.currentTotal - a.currentTotal);

  let html = `
    <table class="data-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Estação</th>
          <th>Linha</th>
          <th>Média Diária</th>
          <th>Total Período</th>
          <th>Ação</th>
        </tr>
      </thead>
      <tbody>
  `;

  sorted.slice(0, 8).forEach((st, idx) => {
    const isL8 = st.line === 'L8';
    const badgeClass = isL8 ? 'badge-l8' : 'badge-l9';
    html += `
      <tr>
        <td style="color: var(--text-subtle); font-weight: 700;">${idx + 1}</td>
        <td style="font-weight: 600;">${st.name}</td>
        <td><span class="kpi-badge ${badgeClass}">${st.line}</span></td>
        <td style="font-weight: 700;">${st.currentAvg.toLocaleString('pt-BR')} pass/dia</td>
        <td style="color: var(--text-muted);">${formatNumber(st.currentTotal)}</td>
        <td>
          <button class="chip-btn" onclick="quickSelectStation('${st.code}', true)">Analisar Estação</button>
        </td>
      </tr>
    `;
  });

  html += `</tbody></table>`;
  container.innerHTML = html;
}

// -------------------------------------------------------------
// TAB 2: ANÁLISE COMPARATIVA DE ESTAÇÕES
// -------------------------------------------------------------
function initStationStudio() {
  renderStationTree();
  initPresetButtons();
  initChartControls();
  initStudioFilterControls();
  initSearchStation();
}

function initStudioFilterControls() {
  const yearSelect = document.getElementById('studio-filter-year');
  const monthSelect = document.getElementById('studio-filter-month');
  const dayTypeSelect = document.getElementById('studio-filter-daytype');
  const dayOfWeekSelect = document.getElementById('studio-filter-dayofweek');
  const dayOfMonthSelect = document.getElementById('studio-filter-dayofmonth');
  const resetBtn = document.getElementById('studio-filters-reset-btn');

  if (yearSelect) {
    yearSelect.addEventListener('change', (e) => {
      state.studioFilters.year = e.target.value;
      renderStudioChart();
      renderStudioTable();
    });
  }

  if (monthSelect) {
    monthSelect.addEventListener('change', (e) => {
      state.studioFilters.month = e.target.value;
      renderStudioChart();
      renderStudioTable();
    });
  }

  if (dayTypeSelect) {
    dayTypeSelect.addEventListener('change', (e) => {
      state.studioFilters.dayType = e.target.value;
      renderStudioChart();
      renderStudioTable();
    });
  }

  if (dayOfWeekSelect) {
    dayOfWeekSelect.addEventListener('change', (e) => {
      state.studioFilters.dayOfWeek = e.target.value;
      renderStudioChart();
      renderStudioTable();
    });
  }

  if (dayOfMonthSelect) {
    dayOfMonthSelect.addEventListener('change', (e) => {
      state.studioFilters.dayOfMonth = e.target.value;
      renderStudioChart();
      renderStudioTable();
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      state.studioFilters = {
        year: 'all',
        month: 'all',
        dayType: 'all',
        dayOfWeek: 'all',
        dayOfMonth: 'all'
      };
      if (yearSelect) yearSelect.value = 'all';
      if (monthSelect) monthSelect.value = 'all';
      if (dayTypeSelect) dayTypeSelect.value = 'all';
      if (dayOfWeekSelect) dayOfWeekSelect.value = 'all';
      if (dayOfMonthSelect) dayOfMonthSelect.value = 'all';
      renderStudioChart();
      renderStudioTable();
    });
  }
}

function renderStationTree() {
  const treeContainer = document.getElementById('stations-tree-list');
  if (!treeContainer || !state.data) return;

  const l8Stations = state.data.stations.filter(s => s.line === 'L8');
  const l9Stations = state.data.stations.filter(s => s.line === 'L9');

  let html = `
    <div class="line-group">
      <div class="line-group-header" style="color: var(--line-9-emerald);">
        <span>Linha 9 - Esmeralda (${l9Stations.length})</span>
        <button class="chip-btn" onclick="toggleLineSelection('L9')">Todos L9</button>
      </div>
  `;

  l9Stations.forEach(s => {
    if (state.searchQuery && !s.name.toLowerCase().includes(state.searchQuery.toLowerCase()) && !s.code.toLowerCase().includes(state.searchQuery.toLowerCase())) {
      return;
    }
    const isChecked = state.selectedStations.has(s.code);
    html += `
      <label class="station-item">
        <span class="station-item-label">
          <input type="checkbox" ${isChecked ? 'checked' : ''} onchange="toggleStation('${s.code}')">
          <span>${s.name}</span>
        </span>
        <span class="station-vol-mini">${formatNumber(s.avg_util)}/dia</span>
      </label>
    `;
  });

  html += `
    </div>
    <div class="line-group" style="margin-top: 1rem;">
      <div class="line-group-header" style="color: var(--line-8-cyan);">
        <span>Linha 8 - Diamante (${l8Stations.length})</span>
        <button class="chip-btn" onclick="toggleLineSelection('L8')">Todos L8</button>
      </div>
  `;

  l8Stations.forEach(s => {
    if (state.searchQuery && !s.name.toLowerCase().includes(state.searchQuery.toLowerCase()) && !s.code.toLowerCase().includes(state.searchQuery.toLowerCase())) {
      return;
    }
    const isChecked = state.selectedStations.has(s.code);
    html += `
      <label class="station-item l8">
        <span class="station-item-label">
          <input type="checkbox" ${isChecked ? 'checked' : ''} onchange="toggleStation('${s.code}')">
          <span>${s.name}</span>
        </span>
        <span class="station-vol-mini">${formatNumber(s.avg_util)}/dia</span>
      </label>
    `;
  });

  html += `</div>`;
  treeContainer.innerHTML = html;

  const countBadge = document.getElementById('selected-count-badge');
  if (countBadge) countBadge.innerText = `${state.selectedStations.size} de 44 selecionadas`;
}

function initSearchStation() {
  const searchInput = document.getElementById('station-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      renderStationTree();
    });
  }
}

function initPresetButtons() {
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const preset = btn.getAttribute('data-preset');
      applyPreset(preset);
    });
  });
}

function applyPreset(preset) {
  state.selectedStations.clear();
  if (preset === 'top5') {
    state.selectedStations = new Set(['VOL', 'PIN', 'OSA', 'BFU', 'BRU']);
  } else if (preset === 'corporate') {
    state.selectedStations = new Set(['VOL', 'PIN', 'BRR', 'CJD', 'MRB']);
  } else if (preset === 'hubs') {
    state.selectedStations = new Set(['OSA', 'PAL', 'BFU', 'PIN', 'SAM']);
  } else if (preset === 'extremo_l8') {
    state.selectedStations = new Set(['ABU', 'ABT', 'SRT', 'IPV', 'JDI']);
  } else if (preset === 'all') {
    state.data.stations.forEach(s => state.selectedStations.add(s.code));
  } else if (preset === 'clear') {
    state.selectedStations.clear();
  }

  renderStationTree();
  renderStudioChart();
  renderStudioTable();
}

function toggleStation(code) {
  if (state.selectedStations.has(code)) {
    state.selectedStations.delete(code);
  } else {
    state.selectedStations.add(code);
  }
  const countBadge = document.getElementById('selected-count-badge');
  if (countBadge) countBadge.innerText = `${state.selectedStations.size} de 44 selecionadas`;

  renderStudioChart();
  renderStudioTable();
}

function toggleLineSelection(line) {
  const lineStations = state.data.stations.filter(s => s.line === line);
  const allSelected = lineStations.every(s => state.selectedStations.has(s.code));
  lineStations.forEach(s => {
    if (allSelected) {
      state.selectedStations.delete(s.code);
    } else {
      state.selectedStations.add(s.code);
    }
  });
  renderStationTree();
  renderStudioChart();
  renderStudioTable();
}

function quickSelectStation(code, navigateToStudio = false) {
  state.selectedStations.clear();
  state.selectedStations.add(code);
  renderStationTree();
  renderStudioChart();
  renderStudioTable();

  if (navigateToStudio) {
    const studioTabBtn = document.querySelector('.nav-tab-btn[data-tab="studio"]');
    if (studioTabBtn) studioTabBtn.click();
  }
}

// Chart controls: type, metric, aggregation
function initChartControls() {
  document.querySelectorAll('.chart-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.chart-type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.chartType = btn.getAttribute('data-type');
      renderStudioChart();
    });
  });

  document.querySelectorAll('.metric-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.metric-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.metricType = btn.getAttribute('data-metric');
      renderStudioChart();
    });
  });

  document.querySelectorAll('.agg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.agg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.aggregation = btn.getAttribute('data-agg');
      renderStudioChart();
    });
  });
}

// Render Studio Chart.js dynamically
function renderStudioChart() {
  const canvas = document.getElementById('studio-canvas-chart');
  const heatmapContainer = document.getElementById('studio-heatmap-container');
  if (!canvas || !state.data) return;

  const records = getStudioFilteredRecords();
  const selectedList = state.data.stations.filter(s => state.selectedStations.has(s.code));

  // Atualiza badge de contagem de registros filtrados
  const countBadge = document.getElementById('studio-filtered-count-badge');
  if (countBadge) {
    countBadge.innerText = `${records.length.toLocaleString('pt-BR')} registros filtrados • ${selectedList.length} est.`;
  }

  // Se o tipo for HEATMAP: usa o container seguro sem destruir o canvas
  if (state.chartType === 'heatmap') {
    if (chartInstances.studio) {
      chartInstances.studio.destroy();
      chartInstances.studio = null;
    }
    canvas.style.display = 'none';
    if (heatmapContainer) {
      heatmapContainer.style.display = 'block';
      renderHeatmapView(records, selectedList, heatmapContainer);
    }
    return;
  }

  // Formatos normais (Linha, Barra, Radar): oculta heatmap e reexibe canvas
  if (heatmapContainer) {
    heatmapContainer.style.display = 'none';
  }
  canvas.style.display = 'block';

  if (selectedList.length === 0 || records.length === 0) {
    if (chartInstances.studio) {
      chartInstances.studio.destroy();
      chartInstances.studio = null;
    }
    return;
  }

  const ctx = canvas.getContext('2d');

  // If chart type is RADAR: Compare station profiles across Days of the Week
  if (state.chartType === 'radar') {
    renderRadarChart(ctx, records, selectedList);
    return;
  }

  // Aggregate time series
  // Options: 'daily', 'weekly', 'monthly'
  let timeBuckets = {};

  records.forEach(r => {
    let bucketKey = r.d.substring(0, 7); // monthly default
    if (state.aggregation === 'daily') {
      bucketKey = r.d;
    } else if (state.aggregation === 'weekly') {
      // Group by year-week approx
      const dt = new Date(r.d);
      const oneJan = new Date(dt.getFullYear(), 0, 1);
      const numberOfDays = Math.floor((dt - oneJan) / (24 * 60 * 60 * 1000));
      const weekNumber = Math.ceil((dt.getDay() + 1 + numberOfDays) / 7);
      bucketKey = `${r.y}-W${weekNumber < 10 ? '0' + weekNumber : weekNumber}`;
    }

    if (!timeBuckets[bucketKey]) {
      timeBuckets[bucketKey] = { key: bucketKey, count: 0, stations: {} };
      selectedList.forEach(s => timeBuckets[bucketKey].stations[s.code] = 0);
    }

    timeBuckets[bucketKey].count += 1;
    selectedList.forEach(s => {
      timeBuckets[bucketKey].stations[s.code] += (r.st[s.code] || 0);
    });
  });

  const sortedBucketKeys = Object.keys(timeBuckets).sort();

  // Default LINE or BAR
  const datasets = selectedList.map((s, idx) => {
    const color = PALETTE[idx % PALETTE.length];
    const data = sortedBucketKeys.map(k => {
      const bucket = timeBuckets[k];
      const sum = bucket.stations[s.code] || 0;
      // If metric is revenue, multiply by average ticket ~ R$ 4.40 or line ratio
      if (state.metricType === 'revenue') {
        return Math.round(sum * 2.5); // estimated per-station share
      }
      return state.aggregation === 'daily' ? sum : Math.round(sum / (bucket.count || 1));
    });

    return {
      label: s.name,
      data,
      borderColor: color,
      backgroundColor: state.chartType === 'bar' ? color + '88' : color + '22',
      borderWidth: 2,
      fill: state.chartType === 'line' ? false : true,
      tension: 0.3,
      pointRadius: state.aggregation === 'daily' ? 0 : 3
    };
  });

  if (chartInstances.studio) chartInstances.studio.destroy();

  chartInstances.studio = new Chart(ctx, {
    type: state.chartType === 'bar' ? 'bar' : 'line',
    data: {
      labels: sortedBucketKeys,
      datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top',
          labels: { color: '#cbd5e1', font: { family: 'Inter', size: 11 } }
        },
        tooltip: {
          backgroundColor: '#0f172a',
          borderColor: '#334155',
          borderWidth: 1,
          callbacks: {
            label: (ctx) => {
              const val = ctx.raw.toLocaleString('pt-BR');
              return `${ctx.dataset.label}: ${val} ${state.metricType === 'revenue' ? 'R$' : 'pass/dia'}`;
            }
          }
        }
      },
      scales: {
        x: {
          ticks: { color: '#64748b', maxTicksLimit: 14 },
          grid: { color: 'rgba(255, 255, 255, 0.04)' }
        },
        y: {
          ticks: {
            color: '#64748b',
            callback: (v) => `${(v/1000).toFixed(0)}k`
          },
          grid: { color: 'rgba(255, 255, 255, 0.04)' }
        }
      }
    }
  });
}

// Special Radar Chart
function renderRadarChart(ctx, records, selectedList) {
  const daysOfWeek = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];
  const dayLabels = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];

  const datasets = selectedList.slice(0, 6).map((s, idx) => {
    const color = PALETTE[idx % PALETTE.length];
    const data = daysOfWeek.map(ds => {
      const subset = records.filter(r => r.ds === ds);
      const sum = subset.reduce((acc, r) => acc + (r.st[s.code] || 0), 0);
      return subset.length ? Math.round(sum / subset.length) : 0;
    });

    return {
      label: s.name,
      data,
      borderColor: color,
      backgroundColor: color + '33',
      borderWidth: 2,
      pointRadius: 3
    };
  });

  if (chartInstances.studio) chartInstances.studio.destroy();

  chartInstances.studio = new Chart(ctx, {
    type: 'radar',
    data: {
      labels: dayLabels,
      datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#cbd5e1' } }
      },
      scales: {
        r: {
          grid: { color: 'rgba(255, 255, 255, 0.08)' },
          angleLines: { color: 'rgba(255, 255, 255, 0.08)' },
          pointLabels: { color: '#94a3b8', font: { family: 'Plus Jakarta Sans', size: 11 } },
          ticks: { backdropColor: 'transparent', color: '#64748b' }
        }
      }
    }
  });
}

// Heatmap View (Day of Week vs Stations) - Não destrói mais o canvas
function renderHeatmapView(records, selectedList, targetContainer) {
  const container = targetContainer || document.getElementById('studio-heatmap-container');
  if (!container) return;

  if (!selectedList.length) {
    container.innerHTML = `
      <div style="padding: 3rem 1rem; text-align: center; color: var(--text-muted);">
        <span class="material-symbols-outlined" style="font-size: 2.2rem; opacity: 0.5;">check_box_outline_blank</span>
        <p style="margin-top: 0.5rem; font-size: 0.88rem;">Nenhuma estação selecionada. Escolha as estações no menu à esquerda.</p>
      </div>`;
    return;
  }

  if (!records.length) {
    container.innerHTML = `
      <div style="padding: 3rem 1rem; text-align: center; color: var(--text-muted);">
        <span class="material-symbols-outlined" style="font-size: 2.2rem; opacity: 0.5;">filter_alt_off</span>
        <p style="margin-top: 0.5rem; font-size: 0.88rem;">Nenhum dado encontrado para os filtros de Ano, Mês e Dia selecionados.</p>
      </div>`;
    return;
  }

  const daysOfWeek = [
    { code: 'seg', label: 'Segunda-feira' },
    { code: 'ter', label: 'Terça-feira' },
    { code: 'qua', label: 'Quarta-feira' },
    { code: 'qui', label: 'Quinta-feira' },
    { code: 'sex', label: 'Sexta-feira' },
    { code: 'sáb', label: 'Sábado' },
    { code: 'dom', label: 'Domingo' }
  ];

  let matrix = {};
  let globalMax = 1;

  selectedList.forEach(s => {
    matrix[s.code] = {};
    daysOfWeek.forEach(d => {
      const subset = records.filter(r => r.ds === d.code);
      const sum = subset.reduce((acc, r) => acc + (r.st[s.code] || 0), 0);
      const avg = subset.length ? Math.round(sum / subset.length) : 0;
      matrix[s.code][d.code] = avg;
      if (avg > globalMax) globalMax = avg;
    });
  });

  let html = `
    <div style="padding: 1rem; overflow-x: auto; max-height: 430px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; flex-wrap: wrap; gap: 0.5rem;">
        <h4 style="font-size: 0.85rem; color: #94a3b8; display: flex; align-items: center; gap: 0.4rem;">
          <span class="material-symbols-outlined" style="color: #10b981; font-size: 1.1rem;">grid_on</span>
          Mapa de Calor: Média de Passageiros por Dia da Semana (${records.length} dias analisados)
        </h4>
        <span style="font-size: 0.72rem; color: var(--text-subtle);">
          Escala de cor baseada no pico máximo registrado (${globalMax.toLocaleString('pt-BR')} pass/dia)
        </span>
      </div>
      <table class="data-table" style="text-align: center; border-collapse: separate; border-spacing: 2px;">
        <thead>
          <tr>
            <th style="text-align: left; position: sticky; left: 0; background: #0f172a; z-index: 2;">Estação</th>
            ${daysOfWeek.map(d => `<th>${d.label}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
  `;

  selectedList.forEach(s => {
    html += `
      <tr>
        <td style="text-align: left; font-weight: 600; position: sticky; left: 0; background: #0f172a; z-index: 1;">
          <span class="kpi-badge ${s.line === 'L8' ? 'badge-l8' : 'badge-l9'}">${s.line}</span>
          ${s.name}
        </td>
    `;
    daysOfWeek.forEach(d => {
      const val = matrix[s.code][d.code] || 0;
      const pct = Math.min(1, val / globalMax);
      const bg = s.line === 'L8' 
        ? `rgba(56, 189, 248, ${0.12 + pct * 0.75})` 
        : `rgba(16, 185, 129, ${0.12 + pct * 0.75})`;
      html += `
        <td style="background: ${bg}; color: #fff; font-weight: 600; border-radius: 4px; padding: 0.6rem;" title="${s.name} (${d.label}): ${val.toLocaleString('pt-BR')} pass/dia">
          ${val > 0 ? (val/1000).toFixed(1) + 'k' : '-'}
        </td>
      `;
    });
    html += `</tr>`;
  });

  html += `</tbody></table></div>`;
  container.innerHTML = html;
}

// Station Studio Comparison Table
function renderStudioTable() {
  const container = document.getElementById('studio-comparison-table-wrapper');
  if (!container || !state.data) return;

  const records = getStudioFilteredRecords();
  const selectedList = state.data.stations.filter(s => state.selectedStations.has(s.code));

  if (!selectedList.length) {
    container.innerHTML = `<p style="padding: 1.5rem; color: var(--text-subtle);">Nenhuma estação selecionada. Escolha as estações na barra lateral para comparar.</p>`;
    return;
  }

  // Calculate stats for each selected station in filtered period
  const utilSubset = records.filter(r => r.td === 'Útil');
  const finSubset = records.filter(r => r.td === 'FIN');

  let rows = selectedList.map(s => {
    const total = records.reduce((acc, r) => acc + (r.st[s.code] || 0), 0);
    const avgUtil = utilSubset.length ? Math.round(utilSubset.reduce((acc, r) => acc + (r.st[s.code] || 0), 0) / utilSubset.length) : 0;
    const avgFin = finSubset.length ? Math.round(finSubset.reduce((acc, r) => acc + (r.st[s.code] || 0), 0) / finSubset.length) : 0;
    const dropPct = avgUtil > 0 ? Math.round(((avgFin - avgUtil) / avgUtil) * 1000) / 10 : 0;
    const estRev = Math.round(total * 2.5);

    let profile = 'Residencial / Pendular';
    if (dropPct < -60) profile = 'Corporativo (Faria Lima / Berrini)';
    else if (['OSA', 'PAL', 'BFU', 'PIN', 'SAM'].includes(s.code)) profile = 'Hub de Integração Metrô/CPTM';
    else if (s.code === 'AUT' || s.code === 'INT') profile = 'Polo de Eventos / Autódromo';

    return { ...s, total, avgUtil, avgFin, dropPct, estRev, profile };
  });

  // Sort by volume descending
  rows.sort((a, b) => b.total - a.total);

  let html = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Estação</th>
          <th>Linha</th>
          <th>Volume Total</th>
          <th>Média Dia Útil</th>
          <th>Média Fim de Semana</th>
          <th>Queda FDS (%)</th>
          <th>Receita Estimada (R$)</th>
          <th>Perfil Operacional</th>
        </tr>
      </thead>
      <tbody>
  `;

  rows.forEach(r => {
    const dropColor = r.dropPct < -50 ? '#ef4444' : '#fbbf24';
    html += `
      <tr>
        <td style="font-weight: 600;">${r.name}</td>
        <td><span class="kpi-badge ${r.line === 'L8' ? 'badge-l8' : 'badge-l9'}">${r.line}</span></td>
        <td style="font-weight: 700;">${r.total.toLocaleString('pt-BR')}</td>
        <td>${r.avgUtil.toLocaleString('pt-BR')} pass/dia</td>
        <td style="color: var(--text-muted);">${r.avgFin.toLocaleString('pt-BR')} pass/dia</td>
        <td style="color: ${dropColor}; font-weight: 700;">${r.dropPct}%</td>
        <td style="color: #fbbf24;">R$ ${r.estRev.toLocaleString('pt-BR')}</td>
        <td><span class="kpi-badge" style="background: rgba(255,255,255,0.05); color: #cbd5e1;">${r.profile}</span></td>
      </tr>
    `;
  });

  html += `</tbody></table>`;
  container.innerHTML = html;
}

// -------------------------------------------------------------
// TAB 3: INSIDERS & ANOMALY DETECTION
// -------------------------------------------------------------
function renderInsidersTab() {
  const records = getFilteredRecords();
  if (!records.length || !state.data) return;

  renderScatterPlot(records);
}

// Scatter Plot (Volume x Revenue)
function renderScatterPlot(records) {
  const ctx = document.getElementById('scatter-chart-canvas');
  if (!ctx || !state.data) return;

  const stationTotals = {};
  records.forEach(r => {
    for (let code in r.st) {
      stationTotals[code] = (stationTotals[code] || 0) + r.st[code];
    }
  });

  const daysCount = records.length;
  const pointsL8 = [];
  const pointsL9 = [];

  state.data.stations.forEach(s => {
    const totalVol = stationTotals[s.code] || 0;
    const avgDailyVol = Math.round(totalVol / daysCount);
    const estDailyRev = Math.round(avgDailyVol * 2.5);

    const pt = { x: avgDailyVol, y: estDailyRev, name: s.name, line: s.line };
    if (s.line === 'L8') pointsL8.push(pt);
    else pointsL9.push(pt);
  });

  if (chartInstances.scatter) chartInstances.scatter.destroy();

  chartInstances.scatter = new Chart(ctx, {
    type: 'scatter',
    data: {
      datasets: [
        {
          label: 'Linha 8 - Diamante',
          data: pointsL8,
          backgroundColor: '#38bdf8',
          borderColor: '#0284c7',
          pointRadius: 6,
          pointHoverRadius: 9
        },
        {
          label: 'Linha 9 - Esmeralda',
          data: pointsL9,
          backgroundColor: '#10b981',
          borderColor: '#059669',
          pointRadius: 6,
          pointHoverRadius: 9
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#cbd5e1' } },
        tooltip: {
          backgroundColor: '#0f172a',
          borderColor: '#334155',
          callbacks: {
            label: (ctx) => {
              const pt = ctx.raw;
              return `${pt.name} (${pt.line}): ${pt.x.toLocaleString('pt-BR')} pass/dia • R$ ${pt.y.toLocaleString('pt-BR')}/dia`;
            }
          }
        }
      },
      scales: {
        x: {
          title: { display: true, text: 'Volume Médio Diário (Passageiros)', color: '#94a3b8' },
          ticks: { color: '#64748b' },
          grid: { color: 'rgba(255, 255, 255, 0.04)' }
        },
        y: {
          title: { display: true, text: 'Receita Estimada Diária (R$)', color: '#94a3b8' },
          ticks: { color: '#64748b' },
          grid: { color: 'rgba(255, 255, 255, 0.04)' }
        }
      }
    }
  });
}

// -------------------------------------------------------------
// TAB 4: SIMULATOR (WHAT-IF)
// -------------------------------------------------------------
function renderSimulator() {
  const fareSlider = document.getElementById('sim-fare-slider');
  const demandSlider = document.getElementById('sim-demand-slider');
  const fareValTag = document.getElementById('sim-fare-val');
  const demandValTag = document.getElementById('sim-demand-val');

  if (fareSlider) {
    fareSlider.addEventListener('input', (e) => {
      state.simulator.fare = parseFloat(e.target.value);
      if (fareValTag) fareValTag.innerText = `R$ ${state.simulator.fare.toFixed(2)}`;
      updateSimulatorResults();
    });
  }

  if (demandSlider) {
    demandSlider.addEventListener('input', (e) => {
      state.simulator.demandDelta = parseInt(e.target.value);
      const sign = state.simulator.demandDelta > 0 ? '+' : '';
      if (demandValTag) demandValTag.innerText = `${sign}${state.simulator.demandDelta}%`;
      updateSimulatorResults();
    });
  }

  updateSimulatorResults();
}

function updateSimulatorResults() {
  if (!state.data || !state.data.summary) return;

  const currentAnnualPassengers = state.data.summary.avg_daily_passengers * 365;
  const currentAnnualRevenue = state.data.summary.avg_daily_revenue * 365;

  const newDemandMultiplier = 1 + (state.simulator.demandDelta / 100);
  const simulatedPassengers = currentAnnualPassengers * newDemandMultiplier;
  
  // Calculate simulated revenue based on fare proportion
  const simulatedRevenue = currentAnnualRevenue * (state.simulator.fare / 4.40) * newDemandMultiplier;
  const deltaRevenue = simulatedRevenue - currentAnnualRevenue;

  const elSimRev = document.getElementById('sim-result-rev');
  if (elSimRev) elSimRev.innerText = `R$ ${formatCurrency(simulatedRevenue)}`;

  const elSimDelta = document.getElementById('sim-result-delta');
  if (elSimDelta) {
    const sign = deltaRevenue >= 0 ? '+' : '';
    elSimDelta.innerText = `${sign}R$ ${formatCurrency(deltaRevenue)} (${sign}${((deltaRevenue/currentAnnualRevenue)*100).toFixed(1)}%)`;
    elSimDelta.style.color = deltaRevenue >= 0 ? '#10b981' : '#ef4444';
  }

  renderSimulatorChart(currentAnnualRevenue, simulatedRevenue);
}

function renderSimulatorChart(currentRev, simRev) {
  const ctx = document.getElementById('simulator-chart-canvas');
  if (!ctx) return;

  const years = ['2022', '2023', '2024', '2025', '2026'];
  const baseline = years.map(y => Math.round(currentRev));
  const projected = years.map(y => Math.round(simRev));

  if (chartInstances.simulator) chartInstances.simulator.destroy();

  chartInstances.simulator = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: years,
      datasets: [
        {
          label: 'Receita Atual Contratual',
          data: baseline,
          backgroundColor: 'rgba(56, 189, 248, 0.4)',
          borderColor: '#38bdf8',
          borderWidth: 1
        },
        {
          label: 'Cenário Simulado (Tarifa / Demanda)',
          data: projected,
          backgroundColor: 'rgba(16, 185, 129, 0.6)',
          borderColor: '#10b981',
          borderWidth: 1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#cbd5e1' } }
      },
      scales: {
        x: { ticks: { color: '#64748b' }, grid: { color: 'rgba(255, 255, 255, 0.04)' } },
        y: {
          ticks: {
            color: '#64748b',
            callback: (v) => `R$ ${(v/1000000).toFixed(0)}M`
          },
          grid: { color: 'rgba(255, 255, 255, 0.04)' }
        }
      }
    }
  });
}

// -------------------------------------------------------------
// DYNAMIC FILE UPLOAD (SheetJS)
// -------------------------------------------------------------
function initFileUpload() {
  const fileInput = document.getElementById('xlsx-upload-input');
  if (!fileInput) return;

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonRows = XLSX.utils.sheet_to_json(worksheet);

        alert(`Arquivo XLSX lido com sucesso! (${jsonRows.length} linhas importadas)`);
        // Recalculate metrics if needed
      } catch (err) {
        alert('Erro ao processar arquivo XLSX: ' + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

// Helper formatting functions
function formatNumber(n) {
  if (n === null || n === undefined) return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return n.toLocaleString('pt-BR');
}

function formatCurrency(n) {
  if (n === null || n === undefined) return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + ' Milhões';
  if (n >= 1000) return (n / 1000).toFixed(1) + ' Mil';
  return n.toLocaleString('pt-BR');
}

// -------------------------------------------------------------
// 3D DIAMOND INTERACTIVE EXPERIENCE (THREE.JS)
// -------------------------------------------------------------
function init3DDiamond() {
  if (typeof THREE === 'undefined') {
    console.warn('Three.js not loaded');
    return;
  }

  const canvas = document.getElementById('diamond-3d-canvas');
  const box = document.getElementById('diamond-3d-box');
  if (!canvas || !box) return;

  const width = box.clientWidth || 340;
  const height = box.clientHeight || 380;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
  camera.position.set(0, 0, 7.5);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: 'high-performance'
  });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  // Diamond Gem Group
  const gemGroup = new THREE.Group();
  scene.add(gemGroup);

  // Octahedron Diamond Geometry (scaled vertically for gem proportion)
  const diamondGeom = new THREE.OctahedronGeometry(2.1, 0);
  diamondGeom.scale(1.1, 1.45, 1.1);

  // Physical Glass/Diamond Material with Refraction & Cyan Glow
  const diamondMat = new THREE.MeshPhysicalMaterial({
    color: 0x38bdf8,
    emissive: 0x0284c7,
    emissiveIntensity: 0.35,
    roughness: 0.1,
    metalness: 0.15,
    transmission: 0.75,
    ior: 1.85,
    transparent: true,
    opacity: 0.85,
    flatShading: true
  });

  const diamondMesh = new THREE.Mesh(diamondGeom, diamondMat);
  gemGroup.add(diamondMesh);

  // Wireframe faceted edges for crystal definition
  const edgesGeom = new THREE.EdgesGeometry(diamondGeom);
  const edgesMat = new THREE.LineBasicMaterial({
    color: 0xe0f2fe,
    linewidth: 2,
    transparent: true,
    opacity: 0.95
  });
  const edgesWire = new THREE.LineSegments(edgesGeom, edgesMat);
  gemGroup.add(edgesWire);

  // 23 Orbiting Station Nodes (representing Line 8 Diamante stations)
  const stationsGroup = new THREE.Group();
  const ringRadius = 3.2;
  const stationSphereGeom = new THREE.SphereGeometry(0.08, 12, 12);
  const stationSphereMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });

  for (let i = 0; i < 23; i++) {
    const angle = (i / 23) * Math.PI * 2;
    const sphere = new THREE.Mesh(stationSphereGeom, stationSphereMat);
    sphere.position.set(Math.cos(angle) * ringRadius, Math.sin(angle) * 0.4, Math.sin(angle) * ringRadius);
    stationsGroup.add(sphere);
  }
  stationsGroup.rotation.x = Math.PI / 6;
  gemGroup.add(stationsGroup);

  // Floating Star Particle Field
  const starsCount = 100;
  const starsGeom = new THREE.BufferGeometry();
  const starCoords = new Float32Array(starsCount * 3);
  for (let i = 0; i < starsCount * 3; i += 3) {
    starCoords[i] = (Math.random() - 0.5) * 16;
    starCoords[i+1] = (Math.random() - 0.5) * 16;
    starCoords[i+2] = (Math.random() - 0.5) * 12;
  }
  starsGeom.setAttribute('position', new THREE.BufferAttribute(starCoords, 3));
  const starsMat = new THREE.PointsMaterial({
    color: 0x38bdf8,
    size: 0.08,
    transparent: true,
    opacity: 0.6
  });
  const starField = new THREE.Points(starsGeom, starsMat);
  scene.add(starField);

  // Lights
  const ambientLight = new THREE.AmbientLight(0x0f172a, 1.5);
  scene.add(ambientLight);

  const dirLight1 = new THREE.DirectionalLight(0x38bdf8, 2.5);
  dirLight1.position.set(5, 8, 5);
  scene.add(dirLight1);

  const dirLight2 = new THREE.DirectionalLight(0xe0f2fe, 1.8);
  dirLight2.position.set(-5, -5, 3);
  scene.add(dirLight2);

  const pointLight = new THREE.PointLight(0xffffff, 1.5, 8);
  pointLight.position.set(0, 0, 0);
  scene.add(pointLight);

  // Interactive mouse/touch tracking
  let isDragging = false;
  let prevMouseX = 0;
  let prevMouseY = 0;
  let mouseTiltX = 0;
  let mouseTiltY = 0;
  let rotationVelocityX = 0;
  let rotationVelocityY = 0.008;

  box.addEventListener('pointerdown', (e) => {
    isDragging = true;
    prevMouseX = e.clientX;
    prevMouseY = e.clientY;
  });

  window.addEventListener('pointerup', () => {
    isDragging = false;
  });

  box.addEventListener('pointermove', (e) => {
    const rect = box.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    mouseTiltX = y * 0.3;
    mouseTiltY = x * 0.3;

    if (isDragging) {
      const deltaX = e.clientX - prevMouseX;
      const deltaY = e.clientY - prevMouseY;
      gemGroup.rotation.y += deltaX * 0.01;
      gemGroup.rotation.x += deltaY * 0.01;
      rotationVelocityY = deltaX * 0.003;
      rotationVelocityX = deltaY * 0.003;
      prevMouseX = e.clientX;
      prevMouseY = e.clientY;
    }
  });

  // Click burst interaction
  box.addEventListener('click', () => {
    pointLight.intensity = 4.0;
    rotationVelocityY += 0.03;
    setTimeout(() => { pointLight.intensity = 1.5; }, 400);
  });

  // Outer Telemetry Orbit Rings (Linha 8 Cyan loop & Linha 9 Emerald loop)
  const ringGeoL8 = new THREE.TorusGeometry(3.0, 0.02, 16, 90);
  const ringMatL8 = new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.55 });
  const ringL8 = new THREE.Mesh(ringGeoL8, ringMatL8);
  ringL8.rotation.x = Math.PI / 2.3;
  gemGroup.add(ringL8);

  const ringGeoL9 = new THREE.TorusGeometry(3.25, 0.02, 16, 90);
  const ringMatL9 = new THREE.MeshBasicMaterial({ color: 0x10b981, transparent: true, opacity: 0.55 });
  const ringL9 = new THREE.Mesh(ringGeoL9, ringMatL9);
  ringL9.rotation.x = -Math.PI / 2.7;
  ringL9.rotation.y = Math.PI / 6;
  gemGroup.add(ringL9);

  // Orbiting Signal Beacon Satellites
  const beaconGeom = new THREE.SphereGeometry(0.12, 16, 16);
  const beaconL8 = new THREE.Mesh(beaconGeom, new THREE.MeshBasicMaterial({ color: 0x38bdf8 }));
  const beaconL9 = new THREE.Mesh(beaconGeom, new THREE.MeshBasicMaterial({ color: 0x34d399 }));
  gemGroup.add(beaconL8);
  gemGroup.add(beaconL9);

  // Animation Loop
  function animate() {
    requestAnimationFrame(animate);

    const t = performance.now() * 0.0015;
    beaconL8.position.set(Math.cos(t) * 3.0, Math.sin(t) * 0.45, Math.sin(t) * 3.0);
    beaconL9.position.set(Math.cos(-t * 0.8) * 3.25, Math.sin(-t * 0.8) * 0.55, Math.sin(-t * 0.8) * 3.25);

    if (!isDragging) {
      gemGroup.rotation.y += rotationVelocityY;
      gemGroup.rotation.x += rotationVelocityX;
      rotationVelocityY = rotationVelocityY * 0.98 + 0.005 * 0.02;
      rotationVelocityX *= 0.95;

      gemGroup.rotation.x += (mouseTiltX - gemGroup.rotation.x) * 0.02;
    }

    stationsGroup.rotation.y -= 0.012;
    starField.rotation.y += 0.001;

    renderer.render(scene, camera);
  }
  animate();

  // Resize handler
  function handleResize() {
    const newW = box.clientWidth;
    const newH = box.clientHeight;
    if (newW && newH) {
      camera.aspect = newW / newH;
      camera.updateProjectionMatrix();
      renderer.setSize(newW, newH);
    }
  }

  window.addEventListener('resize', handleResize);
  window.diamond3D = { resize: handleResize };
}

// -------------------------------------------------------------
// -------------------------------------------------------------
// AVERAGE CHART CONTROLS & RENDERER (MULTI-SELECT MENUS)
// -------------------------------------------------------------
function initL8AveragesControls() {
  // Dropdown toggle behavior
  const dropdownPairs = [
    { btn: 'btn-avg-years', menu: 'menu-avg-years' },
    { btn: 'btn-avg-months', menu: 'menu-avg-months' },
    { btn: 'btn-avg-ds', menu: 'menu-avg-ds' },
    { btn: 'btn-avg-td', menu: 'menu-avg-td' }
  ];

  dropdownPairs.forEach(({ btn, menu }) => {
    const btnEl = document.getElementById(btn);
    const menuEl = document.getElementById(menu);
    if (!btnEl || !menuEl) return;

    btnEl.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = menuEl.classList.contains('show');
      closeAllAvgMenus();
      if (!isOpen) {
        menuEl.classList.add('show');
        btnEl.classList.add('open');
      }
    });

    menuEl.addEventListener('click', (e) => {
      e.stopPropagation(); // prevent closing when clicking inside
    });
  });

  document.addEventListener('click', closeAllAvgMenus);

  // Checkbox listeners for Anos
  document.querySelectorAll('.cb-avg-year').forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.checked) {
        state.l8Avg.years.add(cb.value);
      } else {
        state.l8Avg.years.delete(cb.value);
      }
      updateAvgBadges();
      renderL8AveragesChart();
    });
  });

  // Checkbox listeners for Meses
  document.querySelectorAll('.cb-avg-month').forEach(cb => {
    cb.addEventListener('change', () => {
      const val = parseInt(cb.value);
      if (cb.checked) {
        state.l8Avg.months.add(val);
      } else {
        state.l8Avg.months.delete(val);
      }
      updateAvgBadges();
      renderL8AveragesChart();
    });
  });

  // Checkbox listeners for Dias da Semana (DS)
  document.querySelectorAll('.cb-avg-ds').forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.checked) {
        state.l8Avg.ds.add(cb.value);
      } else {
        state.l8Avg.ds.delete(cb.value);
      }
      updateAvgBadges();
      renderL8AveragesChart();
    });
  });

  // Checkbox listeners for Tipo de Dia (TD)
  document.querySelectorAll('.cb-avg-td').forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.checked) {
        state.l8Avg.td.add(cb.value);
      } else {
        state.l8Avg.td.delete(cb.value);
      }
      updateAvgBadges();
      renderL8AveragesChart();
    });
  });

  // Escopo selector (Linha 8, Linha 9, Ambas, Comparativo)
  const scopeSelect = document.getElementById('avg-scope-select');
  if (scopeSelect) {
    scopeSelect.addEventListener('change', (e) => {
      state.l8Avg.scope = e.target.value;
      renderL8AveragesChart();
    });
  }

  // Dimension / Eixo selector (Estações vs Mês a Mês vs Dias da Semana)
  const dimSelect = document.getElementById('avg-dimension-select');
  if (dimSelect) {
    dimSelect.addEventListener('change', (e) => {
      state.l8Avg.dimension = e.target.value;
      renderL8AveragesChart();
    });
  }

  // Chart Type selector (Barras Verticais, Barras Horizontais, Linha, Rosca, Pizza)
  const chartTypeSelect = document.getElementById('avg-chart-type-select');
  if (chartTypeSelect) {
    chartTypeSelect.addEventListener('change', (e) => {
      state.l8Avg.chartType = e.target.value;
      renderL8AveragesChart();
    });
  }

  // Download buttons
  const btnPng = document.getElementById('btn-download-avg-png');
  if (btnPng) btnPng.addEventListener('click', downloadAveragePNG);

  const btnExcel = document.getElementById('btn-download-avg-excel');
  if (btnExcel) btnExcel.addEventListener('click', downloadAverageExcel);
}

function closeAllAvgMenus() {
  document.querySelectorAll('.multiselect-menu').forEach(m => m.classList.remove('show'));
  document.querySelectorAll('.multiselect-btn').forEach(b => b.classList.remove('open'));
}

function updateAvgBadges() {
  const badgeYears = document.getElementById('badge-avg-years');
  if (badgeYears) badgeYears.innerText = state.l8Avg.years.size;

  const badgeMonths = document.getElementById('badge-avg-months');
  if (badgeMonths) badgeMonths.innerText = state.l8Avg.months.size;

  const badgeDs = document.getElementById('badge-avg-ds');
  if (badgeDs) badgeDs.innerText = state.l8Avg.ds.size;

  const badgeTd = document.getElementById('badge-avg-td');
  if (badgeTd) badgeTd.innerText = state.l8Avg.td.size;
}

// Global Quick Action Functions
window.setAllAvgYears = function(checked) {
  state.l8Avg.years.clear();
  document.querySelectorAll('.cb-avg-year').forEach(cb => {
    cb.checked = checked;
    if (checked) state.l8Avg.years.add(cb.value);
  });
  updateAvgBadges();
  renderL8AveragesChart();
};

window.setAllAvgMonths = function(checked) {
  state.l8Avg.months.clear();
  document.querySelectorAll('.cb-avg-month').forEach(cb => {
    cb.checked = checked;
    if (checked) state.l8Avg.months.add(parseInt(cb.value));
  });
  updateAvgBadges();
  renderL8AveragesChart();
};

window.setAllAvgDS = function(checked) {
  state.l8Avg.ds.clear();
  document.querySelectorAll('.cb-avg-ds').forEach(cb => {
    cb.checked = checked;
    if (checked) state.l8Avg.ds.add(cb.value);
  });
  updateAvgBadges();
  renderL8AveragesChart();
};

window.setAllAvgTD = function(checked) {
  state.l8Avg.td.clear();
  document.querySelectorAll('.cb-avg-td').forEach(cb => {
    cb.checked = checked;
    if (checked) state.l8Avg.td.add(cb.value);
  });
  updateAvgBadges();
  renderL8AveragesChart();
};

// Fast Search Filter inside Menus
window.filterMenuOptions = function(inputEl, menuId) {
  const query = (inputEl.value || '').toLowerCase().trim();
  const menu = document.getElementById(menuId);
  if (!menu) return;
  menu.querySelectorAll('.multiselect-item').forEach(item => {
    const text = item.innerText.toLowerCase();
    item.style.display = text.includes(query) ? 'flex' : 'none';
  });
};

// Quick action: Semester filter for months
window.setAvgMonthsSemester = function(sem) {
  state.l8Avg.months.clear();
  const target = sem === 1 ? [1, 2, 3, 4, 5, 6] : [7, 8, 9, 10, 11, 12];
  document.querySelectorAll('.cb-avg-month').forEach(cb => {
    const val = parseInt(cb.value);
    const checked = target.includes(val);
    cb.checked = checked;
    if (checked) state.l8Avg.months.add(val);
  });
  updateAvgBadges();
  renderL8AveragesChart();
};

// Quick action: Workdays (Seg-Sex)
window.setAvgDSWorkdays = function() {
  state.l8Avg.ds.clear();
  const workdays = ['seg', 'ter', 'qua', 'qui', 'sex'];
  document.querySelectorAll('.cb-avg-ds').forEach(cb => {
    const checked = workdays.includes(cb.value);
    cb.checked = checked;
    if (checked) state.l8Avg.ds.add(cb.value);
  });
  updateAvgBadges();
  renderL8AveragesChart();
};

// Quick action: Weekend (Sáb-Dom)
window.setAvgDSWeekend = function() {
  state.l8Avg.ds.clear();
  const weekend = ['sáb', 'dom'];
  document.querySelectorAll('.cb-avg-ds').forEach(cb => {
    const checked = weekend.includes(cb.value);
    cb.checked = checked;
    if (checked) state.l8Avg.ds.add(cb.value);
  });
  updateAvgBadges();
  renderL8AveragesChart();
};

// Quick action: Recent years (2024-2026)
window.setAvgRecentYears = function() {
  state.l8Avg.years.clear();
  const recent = ['2024', '2025', '2026'];
  document.querySelectorAll('.cb-avg-year').forEach(cb => {
    const checked = recent.includes(cb.value);
    cb.checked = checked;
    if (checked) state.l8Avg.years.add(cb.value);
  });
  updateAvgBadges();
  renderL8AveragesChart();
};

// Quick action: Only Útil or Only FIN
window.setAvgTDOnly = function(targetVal) {
  state.l8Avg.td.clear();
  document.querySelectorAll('.cb-avg-td').forEach(cb => {
    const checked = cb.value === targetVal;
    cb.checked = checked;
    if (checked) state.l8Avg.td.add(cb.value);
  });
  updateAvgBadges();
  renderL8AveragesChart();
};

const MONTH_NAMES_MAP = {
  1: 'Janeiro',
  2: 'Fevereiro',
  3: 'Março',
  4: 'Abril',
  5: 'Maio',
  6: 'Junho',
  7: 'Julho',
  8: 'Agosto',
  9: 'Setembro',
  10: 'Outubro',
  11: 'Novembro',
  12: 'Dezembro'
};

const DS_LABEL_MAP = {
  'seg': 'Segunda-feira',
  'ter': 'Terça-feira',
  'qua': 'Quarta-feira',
  'qui': 'Quinta-feira',
  'sex': 'Sexta-feira',
  'sáb': 'Sábado',
  'dom': 'Domingo'
};

// Plugin customizado do Chart.js para renderizar o valor exato acima de cada ponto ("bolinha") em gráficos de linha
const chartPointLabelsPlugin = {
  id: 'chartPointLabels',
  afterDatasetsDraw(chart) {
    if (chart.config.type !== 'line') return;
    const { ctx } = chart;

    chart.data.datasets.forEach((dataset, datasetIdx) => {
      const meta = chart.getDatasetMeta(datasetIdx);
      if (meta.hidden || !meta.data) return;

      const totalPoints = meta.data.length;
      if (totalPoints > 42) return; // Se houver pontos em excesso, evita poluição visual

      meta.data.forEach((element, i) => {
        const rawVal = dataset.data[i];
        if (rawVal === null || rawVal === undefined || isNaN(rawVal)) return;

        const props = element.getProps(['x', 'y'], true);
        const x = props.x;
        const y = props.y;
        if (x === undefined || y === undefined) return;

        let labelText = '';
        if (totalPoints > 16) {
          if (rawVal >= 1000000) {
            labelText = (rawVal / 1000000).toFixed(1).replace('.', ',') + 'M';
          } else if (rawVal >= 1000) {
            labelText = Math.round(rawVal / 1000) + 'k';
          } else {
            labelText = rawVal.toString();
          }
        } else {
          if (rawVal >= 1000000) {
            labelText = (rawVal / 1000000).toFixed(2).replace('.', ',') + 'M';
          } else {
            labelText = Number(rawVal).toLocaleString('pt-BR');
          }
        }

        ctx.save();
        ctx.font = '700 10.5px Inter, -apple-system, sans-serif';
        const textMetrics = ctx.measureText(labelText);
        const textWidth = textMetrics.width;
        const pillH = 16;
        const padX = 5;
        const pillW = textWidth + padX * 2;
        const pillX = x - pillW / 2;
        const pillY = y - 11 - pillH;

        // Pílula translúcida escura com borda na cor da série
        ctx.fillStyle = 'rgba(11, 17, 30, 0.92)';
        ctx.strokeStyle = dataset.borderColor || '#38bdf8';
        ctx.lineWidth = 1;

        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(pillX, pillY, pillW, pillH, 4);
        } else {
          ctx.rect(pillX, pillY, pillW, pillH);
        }
        ctx.fill();
        ctx.stroke();

        // Texto em destaque centralizado acima da bolinha
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(labelText, x, pillY + pillH / 2);

        ctx.restore();
      });
    });
  }
};

// Render Average Chart with multi-select filters, dimension switching and chart type selection
function renderL8AveragesChart() {
  window.renderL8AveragesChart = renderL8AveragesChart;
  window.state = state;
  const ctx = document.getElementById('l8-averages-chart');
  if (!ctx || !state.data) return;

  // Filter records based on active multi-selected options
  const filtered = state.data.daily.filter(r => {
    if (!state.l8Avg.years.has(r.y.toString())) return false;
    if (!state.l8Avg.months.has(r.m)) return false;
    if (!state.l8Avg.ds.has(r.ds)) return false;
    if (!state.l8Avg.td.has(r.td)) return false;
    return true;
  });

  const daysCount = filtered.length;

  let chartLabels = [];
  let chartData = [];
  let backgroundColors = [];
  let borderColors = [];
  let exportRows = [];

  const dim = state.l8Avg.dimension || 'stations';
  const chartType = state.l8Avg.chartType || 'bar';

  if (daysCount === 0) {
    chartLabels = ['Nenhum dia na seleção'];
    chartData = [0];
    backgroundColors = ['rgba(239, 68, 68, 0.4)'];
    borderColors = ['#ef4444'];
    exportRows = [];
  } else if (dim === 'months') {
    // ========================================================
    // DIMENSION: MÊS A MÊS (Jan a Dez)
    // ========================================================
    const activeMonths = Array.from(state.l8Avg.months).sort((a, b) => a - b);
    
    activeMonths.forEach((m, idx) => {
      const mRecs = filtered.filter(r => r.m === m);
      const mDays = mRecs.length;
      let total = 0;
      let lineLabel = 'Linha 8 - Diamante';

      if (state.l8Avg.scope === 'l8') {
        total = mRecs.reduce((acc, r) => acc + (r.l8_e || 0), 0);
        lineLabel = 'Linha 8 - Diamante';
      } else if (state.l8Avg.scope === 'l9') {
        total = mRecs.reduce((acc, r) => acc + (r.l9_e || 0), 0);
        lineLabel = 'Linha 9 - Esmeralda';
      } else if (state.l8Avg.scope === 'both') {
        total = mRecs.reduce((acc, r) => acc + (r.l8_e || 0) + (r.l9_e || 0), 0);
        lineLabel = 'Linhas 8 e 9 (Consolidado)';
      } else if (state.l8Avg.scope === 'compare') {
        // Total Linhas 8 + 9
        total = mRecs.reduce((acc, r) => acc + (r.l8_e || 0) + (r.l9_e || 0), 0);
        lineLabel = 'Linha 8 + Linha 9';
      }

      const avg = mDays > 0 ? Math.round(total / mDays) : 0;
      const mName = MONTH_NAMES_MAP[m] || `Mês ${m}`;

      chartLabels.push(mName);
      chartData.push(avg);

      // Color scheme based on scope or multi-color for pie/doughnut
      if (chartType === 'doughnut' || chartType === 'pie') {
        backgroundColors.push(PALETTE[idx % PALETTE.length]);
        borderColors.push(PALETTE[idx % PALETTE.length]);
      } else if (state.l8Avg.scope === 'l8') {
        backgroundColors.push('rgba(56, 189, 248, 0.75)');
        borderColors.push('#38bdf8');
      } else if (state.l8Avg.scope === 'l9') {
        backgroundColors.push('rgba(16, 185, 129, 0.75)');
        borderColors.push('#10b981');
      } else {
        backgroundColors.push('rgba(168, 85, 247, 0.75)');
        borderColors.push('#a855f7');
      }

      exportRows.push({
        name: mName,
        monthNum: m,
        lineLabel,
        line: state.l8Avg.scope.toUpperCase(),
        avg,
        total,
        daysCount: mDays
      });
    });

  } else if (dim === 'ds') {
    // ========================================================
    // DIMENSION: DIAS DA SEMANA (Seg a Dom)
    // ========================================================
    const dsOrder = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];
    const activeDs = dsOrder.filter(d => state.l8Avg.ds.has(d));

    activeDs.forEach((dKey, idx) => {
      const dRecs = filtered.filter(r => r.ds === dKey);
      const dDays = dRecs.length;
      let total = 0;
      let lineLabel = 'Linha 8 - Diamante';

      if (state.l8Avg.scope === 'l8') {
        total = dRecs.reduce((acc, r) => acc + (r.l8_e || 0), 0);
        lineLabel = 'Linha 8 - Diamante';
      } else if (state.l8Avg.scope === 'l9') {
        total = dRecs.reduce((acc, r) => acc + (r.l9_e || 0), 0);
        lineLabel = 'Linha 9 - Esmeralda';
      } else if (state.l8Avg.scope === 'both') {
        total = dRecs.reduce((acc, r) => acc + (r.l8_e || 0) + (r.l9_e || 0), 0);
        lineLabel = 'Linhas 8 e 9 (Consolidado)';
      } else if (state.l8Avg.scope === 'compare') {
        total = dRecs.reduce((acc, r) => acc + (r.l8_e || 0) + (r.l9_e || 0), 0);
        lineLabel = 'Linha 8 + Linha 9';
      }

      const avg = dDays > 0 ? Math.round(total / dDays) : 0;
      const dLabel = DS_LABEL_MAP[dKey] || dKey;

      chartLabels.push(dLabel);
      chartData.push(avg);

      if (chartType === 'doughnut' || chartType === 'pie') {
        backgroundColors.push(PALETTE[idx % PALETTE.length]);
        borderColors.push(PALETTE[idx % PALETTE.length]);
      } else if (state.l8Avg.scope === 'l8') {
        backgroundColors.push('rgba(56, 189, 248, 0.75)');
        borderColors.push('#38bdf8');
      } else if (state.l8Avg.scope === 'l9') {
        backgroundColors.push('rgba(16, 185, 129, 0.75)');
        borderColors.push('#10b981');
      } else {
        backgroundColors.push('rgba(251, 191, 36, 0.75)');
        borderColors.push('#fbbf24');
      }

      exportRows.push({
        name: dLabel,
        dsKey: dKey,
        lineLabel,
        line: state.l8Avg.scope.toUpperCase(),
        avg,
        total,
        daysCount: dDays
      });
    });

  } else {
    // ========================================================
    // DIMENSION: ESTAÇÕES (Padrão)
    // ========================================================
    if (state.l8Avg.scope === 'compare') {
      // Linha 8 vs Linha 9 totals
      let l8Total = filtered.reduce((acc, r) => acc + r.l8_e, 0);
      let l9Total = filtered.reduce((acc, r) => acc + r.l9_e, 0);
      const avgL8 = Math.round(l8Total / daysCount);
      const avgL9 = Math.round(l9Total / daysCount);

      chartLabels = ['Linha 8 - Diamante', 'Linha 9 - Esmeralda'];
      chartData = [avgL8, avgL9];
      backgroundColors = ['rgba(56, 189, 248, 0.75)', 'rgba(16, 185, 129, 0.75)'];
      borderColors = ['#38bdf8', '#10b981'];

      exportRows = [
        { name: 'Linha 8 - Diamante', line: 'L8', avg: avgL8, total: l8Total, daysCount },
        { name: 'Linha 9 - Esmeralda', line: 'L9', avg: avgL9, total: l9Total, daysCount }
      ];
    } else {
      // Station level based on selected scope: Linha 8, Linha 9, or Both
      let stationsToEvaluate = state.data.stations;
      if (state.l8Avg.scope === 'l8') {
        stationsToEvaluate = state.data.stations.filter(s => s.line === 'L8');
      } else if (state.l8Avg.scope === 'l9') {
        stationsToEvaluate = state.data.stations.filter(s => s.line === 'L9');
      } else if (state.l8Avg.scope === 'both') {
        stationsToEvaluate = state.data.stations; // All 44 stations together!
      }

      const evaluated = stationsToEvaluate.map(s => {
        const total = filtered.reduce((acc, r) => acc + (r.st[s.code] || 0), 0);
        const avg = Math.round(total / daysCount);
        return {
          code: s.code,
          name: s.name,
          line: s.line,
          avg,
          total,
          daysCount
        };
      });

      evaluated.sort((a, b) => b.avg - a.avg);

      chartLabels = evaluated.map(s => s.name);
      chartData = evaluated.map(s => s.avg);

      if (chartType === 'doughnut' || chartType === 'pie') {
        backgroundColors = evaluated.map((_, i) => PALETTE[i % PALETTE.length]);
        borderColors = evaluated.map((_, i) => PALETTE[i % PALETTE.length]);
      } else {
        backgroundColors = evaluated.map(s => s.line === 'L8' ? 'rgba(56, 189, 248, 0.75)' : 'rgba(16, 185, 129, 0.75)');
        borderColors = evaluated.map(s => s.line === 'L8' ? '#38bdf8' : '#10b981');
      }

      exportRows = evaluated;
    }
  }

  // Cache current export rows for Excel / PNG
  state.currentAvgExportRows = exportRows;
  state.currentAvgDaysCount = daysCount;

  if (chartInstances.l8Averages) {
    chartInstances.l8Averages.destroy();
  }

  // Determine Chart.js configuration based on chosen chart type
  let effectiveType = 'bar';
  let indexAxis = 'x';
  let isRadial = false;
  let datasetConfig = {
    label: `Média Diária (${daysCount.toLocaleString('pt-BR')} dias filtrados)`,
    data: chartData,
    backgroundColor: backgroundColors,
    borderColor: borderColors,
    borderWidth: 1.5,
    borderRadius: chartType === 'horizontalBar' || chartType === 'bar' ? 4 : 0
  };

  if (chartType === 'horizontalBar') {
    effectiveType = 'bar';
    indexAxis = 'y';
  } else if (chartType === 'line') {
    effectiveType = 'line';
    datasetConfig.fill = true;
    datasetConfig.tension = 0.35;
    datasetConfig.pointRadius = 5.5;
    datasetConfig.pointHoverRadius = 8.5;
    datasetConfig.pointBackgroundColor = state.l8Avg.scope === 'l9' ? '#10b981' : (state.l8Avg.scope === 'l8' ? '#38bdf8' : '#a855f7');
    datasetConfig.pointBorderColor = '#0b111e';
    datasetConfig.pointBorderWidth = 2;
    datasetConfig.backgroundColor = state.l8Avg.scope === 'l9' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(56, 189, 248, 0.2)';
    datasetConfig.borderColor = state.l8Avg.scope === 'l9' ? '#10b981' : '#38bdf8';
  } else if (chartType === 'doughnut') {
    effectiveType = 'doughnut';
    isRadial = true;
  } else if (chartType === 'pie') {
    effectiveType = 'pie';
    isRadial = true;
  }

  let chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    layout: {
      padding: {
        top: effectiveType === 'line' ? 28 : 8,
        left: 10,
        right: 10,
        bottom: 4
      }
    },
    plugins: {
      legend: {
        display: isRadial || state.l8Avg.scope === 'compare',
        position: isRadial ? 'right' : 'top',
        labels: {
          color: '#cbd5e1',
          font: { family: 'Inter', size: isRadial ? 10 : 11 },
          boxWidth: 12
        }
      },
      tooltip: {
        backgroundColor: '#0f172a',
        borderColor: '#38bdf8',
        borderWidth: 1,
        padding: 10,
        callbacks: {
          title: (items) => items[0].label,
          label: (ctx) => `Média: ${Number(ctx.raw).toLocaleString('pt-BR')} passageiros/dia`,
          afterLabel: (ctx) => {
            const row = exportRows[ctx.dataIndex];
            return row ? `Total Acumulado: ${Number(row.total).toLocaleString('pt-BR')} passageiros (${row.daysCount.toLocaleString('pt-BR')} dias)` : '';
          }
        }
      }
    }
  };

  if (!isRadial) {
    if (indexAxis === 'y') {
      // Horizontal Bars: values on X axis, labels on Y axis
      chartOptions.indexAxis = 'y';
      chartOptions.scales = {
        x: {
          ticks: {
            color: '#94a3b8',
            callback: (v) => v.toLocaleString('pt-BR')
          },
          grid: { color: 'rgba(255, 255, 255, 0.04)' }
        },
        y: {
          ticks: {
            color: '#cbd5e1',
            font: { size: chartLabels.length > 25 ? 9 : 10 }
          },
          grid: { color: 'rgba(255, 255, 255, 0.04)' }
        }
      };
    } else {
      // Vertical Bars or Line: values on Y axis, labels on X axis
      chartOptions.indexAxis = 'x';
      chartOptions.scales = {
        x: {
          ticks: {
            color: '#94a3b8',
            maxRotation: 45,
            minRotation: 20,
            font: { size: chartLabels.length > 25 ? 9 : 10 }
          },
          grid: { color: 'rgba(255, 255, 255, 0.04)' }
        },
        y: {
          grace: effectiveType === 'line' ? '15%' : '5%',
          ticks: {
            color: '#64748b',
            callback: (v) => v.toLocaleString('pt-BR')
          },
          grid: { color: 'rgba(255, 255, 255, 0.04)' }
        }
      };
    }
  }

  chartInstances.l8Averages = new Chart(ctx, {
    type: effectiveType,
    data: {
      labels: chartLabels,
      datasets: [datasetConfig]
    },
    options: chartOptions,
    plugins: [chartPointLabelsPlugin]
  });
}

// Download Average Chart as Genuine PNG Image
function downloadAveragePNG() {
  const canvas = document.getElementById('l8-averages-chart');
  if (!canvas) {
    alert('Gráfico não disponível para download.');
    return;
  }

  const yearsStr = Array.from(state.l8Avg.years).sort().join('_') || 'anos';
  const dim = state.l8Avg.dimension || 'estacoes';
  const scope = state.l8Avg.scope || 'l8';
  const fileName = `Grafico_Medias_ViaMobilidade_${dim.toUpperCase()}_${scope.toUpperCase()}_${yearsStr}.png`;

  // Modern browsers: convert canvas to blob and trigger download via attached anchor
  if (canvas.toBlob) {
    canvas.toBlob((blob) => {
      if (!blob) {
        alert('Falha ao gerar arquivo de imagem PNG.');
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 1000);
    }, 'image/png');
  } else {
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => document.body.removeChild(a), 1000);
  }
}

// Download Average Chart Data as Genuine Native Microsoft Excel (.xlsx)
function downloadAverageExcel() {
  const rows = state.currentAvgExportRows;
  if (!rows || !rows.length) {
    alert('Nenhum dado na seleção atual para exportar.');
    return;
  }

  if (typeof XLSX === 'undefined') {
    alert('Biblioteca XLSX ainda não carregada no navegador.');
    return;
  }

  const yearsStr = Array.from(state.l8Avg.years).sort().join(', ');
  const monthsStr = Array.from(state.l8Avg.months).sort((a,b)=>a-b).join(', ');
  const dsStr = Array.from(state.l8Avg.ds).join(', ');
  const tdStr = Array.from(state.l8Avg.td).join(', ');

  let excelRows = [];
  let colDefs = [];
  const dim = state.l8Avg.dimension || 'stations';

  if (dim === 'months') {
    excelRows = rows.map((r, index) => ({
      'Mês': r.name,
      'Escopo / Linha': r.lineLabel || (r.line === 'L8' ? 'Linha 8 - Diamante' : (r.line === 'L9' ? 'Linha 9 - Esmeralda' : 'Linhas 8 e 9')),
      'Média Diária (Passageiros/dia)': r.avg,
      'Volume Total de Passageiros no Mês': r.total,
      'Dias no Mês Filtrados': r.daysCount,
      'Anos Selecionados': yearsStr,
      'Dias da Semana': dsStr,
      'Tipo de Dia (TD)': tdStr
    }));

    colDefs = [
      { wch: 18 }, // Mês
      { wch: 28 }, // Escopo
      { wch: 30 }, // Média Diária
      { wch: 34 }, // Volume Total
      { wch: 24 }, // Dias no Mês
      { wch: 22 }, // Anos
      { wch: 30 }, // Dias da Semana
      { wch: 20 }  // TD
    ];
  } else if (dim === 'ds') {
    excelRows = rows.map((r, index) => ({
      'Dia da Semana': r.name,
      'Escopo / Linha': r.lineLabel || (r.line === 'L8' ? 'Linha 8 - Diamante' : (r.line === 'L9' ? 'Linha 9 - Esmeralda' : 'Linhas 8 e 9')),
      'Média Diária (Passageiros/dia)': r.avg,
      'Volume Total de Passageiros': r.total,
      'Ocorrências do Dia': r.daysCount,
      'Anos Selecionados': yearsStr,
      'Meses Selecionados': monthsStr,
      'Tipo de Dia (TD)': tdStr
    }));

    colDefs = [
      { wch: 20 }, // Dia
      { wch: 28 }, // Escopo
      { wch: 30 }, // Média Diária
      { wch: 34 }, // Volume Total
      { wch: 24 }, // Ocorrências
      { wch: 22 }, // Anos
      { wch: 24 }, // Meses
      { wch: 20 }  // TD
    ];
  } else {
    // stations
    excelRows = rows.map((r, index) => ({
      'Posição': index + 1,
      'Estação': r.name,
      'Linha': r.line === 'L8' ? 'Linha 8 - Diamante' : (r.line === 'L9' ? 'Linha 9 - Esmeralda' : r.line),
      'Média Diária (Passageiros)': r.avg,
      'Volume Total de Passageiros': r.total,
      'Total de Dias na Amostra': r.daysCount,
      'Anos Selecionados': yearsStr,
      'Meses Selecionados': monthsStr,
      'Dias da Semana': dsStr,
      'Tipo de Dia (TD)': tdStr
    }));

    colDefs = [
      { wch: 10 }, // Posição
      { wch: 32 }, // Estação
      { wch: 24 }, // Linha
      { wch: 28 }, // Média Diária
      { wch: 30 }, // Volume Total
      { wch: 24 }, // Total de Dias
      { wch: 22 }, // Anos
      { wch: 24 }, // Meses
      { wch: 32 }, // Dias da Semana
      { wch: 22 }  // Tipo de Dia
    ];
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(excelRows);
  ws['!cols'] = colDefs;

  const sheetTitle = dim === 'months' ? 'Médias Mensais' : (dim === 'ds' ? 'Médias por Dia da Semana' : 'Médias Operacionais');
  XLSX.utils.book_append_sheet(wb, ws, sheetTitle);

  const fileName = `Medias_ViaMobilidade_${dim.toUpperCase()}_${state.l8Avg.scope.toUpperCase()}.xlsx`;

  // Write genuine binary array and create native Blob with accurate MIME type for Microsoft Excel
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;charset=UTF-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 1000);
}

// Inicialização segura do painel após todos os catálogos, mapas e caches estarem carregados
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAll);
} else {
  initAll();
}

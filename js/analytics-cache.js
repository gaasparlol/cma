/**
 * RailPulse • Analytics Cache & Memoization Engine
 * (application-performance-performance-optimization, modern-javascript-patterns & code-refactoring-refactor-clean)
 * 
 * Pre-indexes the 1,678 days of historical telemetry and 41 stations into O(1) lookup tables.
 * Eliminates redundant loops, ensuring instant filter switching and 60 FPS map telemetry.
 */

(function(window) {
  'use strict';

  class AnalyticsCacheEngine {
    constructor() {
      this.initialized = false;
      this.rawRecords = [];
      
      // Índices dimensionais
      this.byYear = new Map();
      this.byYearMonth = new Map();
      this.byYearMonthTd = new Map();
      
      // Caches memoizados de alta performance
      this.stationStatsCache = new Map();
      this.rankingsCache = new Map();
      this.networkStatsCache = new Map();
      this.filteredRecordsCache = new Map();
      this.studioRecordsCache = new Map();
      
      // Top 10 rankings pré-calculados
      this.top10Cache = new Map();
    }

    /**
     * Limpa todos os caches (chamado ao subir um novo XLSX)
     */
    clear() {
      this.initialized = false;
      this.rawRecords = [];
      this.byYear.clear();
      this.byYearMonth.clear();
      this.byYearMonthTd.clear();
      this.stationStatsCache.clear();
      this.rankingsCache.clear();
      this.networkStatsCache.clear();
      this.filteredRecordsCache.clear();
      this.studioRecordsCache.clear();
      this.top10Cache.clear();
    }

    /**
     * Indexa os 1.678 dias de histórico no carregamento inicial
     * O(N) executado uma única vez
     */
    initIndex(dailyRecords) {
      if (!Array.isArray(dailyRecords) || dailyRecords.length === 0) return;
      this.clear();
      this.rawRecords = dailyRecords;

      for (let i = 0, len = dailyRecords.length; i < len; i++) {
        const r = dailyRecords[i];
        const y = r.y;
        const ym = `${r.y}-${r.m}`;
        const ymtd = `${r.y}-${r.m}-${r.td}`;

        // Agrupamento por ano
        let yearArr = this.byYear.get(y);
        if (!yearArr) {
          yearArr = [];
          this.byYear.set(y, yearArr);
        }
        yearArr.push(r);

        // Agrupamento por ano e mês
        let ymArr = this.byYearMonth.get(ym);
        if (!ymArr) {
          ymArr = [];
          this.byYearMonth.set(ym, ymArr);
        }
        ymArr.push(r);

        // Agrupamento por ano, mês e tipo de dia (Útil / FIN)
        let ymtdArr = this.byYearMonthTd.get(ymtd);
        if (!ymtdArr) {
          ymtdArr = [];
          this.byYearMonthTd.set(ymtd, ymtdArr);
        }
        ymtdArr.push(r);
      }

      this.initialized = true;
    }

    /**
     * Retorna os registros filtrados para Ano e Mês em O(1) usando os índices
     */
    getRecordsForPeriod(yearStr, monthVal) {
      if (!this.initialized) {
        const daily = (window.state && window.state.data && window.state.data.daily) || (window.RAIL_INITIAL_DATA && window.RAIL_INITIAL_DATA.daily);
        if (daily) this.initIndex(daily);
      }

      if (yearStr === 'all' && monthVal === 'all') {
        return this.rawRecords;
      }

      if (yearStr !== 'all' && monthVal === 'all') {
        const y = parseInt(yearStr, 10);
        return this.byYear.get(y) || [];
      }

      if (yearStr !== 'all' && monthVal !== 'all') {
        const y = parseInt(yearStr, 10);
        const m = parseInt(monthVal, 10) + 1;
        return this.byYearMonth.get(`${y}-${m}`) || [];
      }

      // Se ano for 'all' mas mês for específico
      const targetMonth = parseInt(monthVal, 10) + 1;
      const key = `all-${targetMonth}`;
      if (this.filteredRecordsCache.has(key)) {
        return this.filteredRecordsCache.get(key);
      }
      const filtered = this.rawRecords.filter(r => r.m === targetMonth);
      this.filteredRecordsCache.set(key, filtered);
      return filtered;
    }

    /**
     * Retorna estatísticas completas de uma estação com memoização O(1)
     */
    getStationAnalytics(stationId, yearStr = '2024', monthVal = 'all') {
      const codeMap = window.stationCodeMap || {};
      let code = codeMap[stationId];
      if (!code && stationId) {
        const upper = stationId.toUpperCase();
        if (Object.values(codeMap).includes(upper)) {
          code = upper;
        }
      }
      if (!code) {
        return this._getEmptyStationStats();
      }

      const cacheKey = `${stationId}:${yearStr}:${monthVal}`;
      if (this.stationStatsCache.has(cacheKey)) {
        return this.stationStatsCache.get(cacheKey);
      }

      const records = this.getRecordsForPeriod(yearStr, monthVal);
      if (!records || records.length === 0) {
        const empty = this._getEmptyStationStats();
        this.stationStatsCache.set(cacheKey, empty);
        return empty;
      }

      let total = 0;
      let utilSum = 0;
      let utilCount = 0;
      let finSum = 0;
      let finCount = 0;

      for (let i = 0, len = records.length; i < len; i++) {
        const r = records[i];
        const val = r.st ? (r.st[code] || 0) : 0;
        total += val;
        if (r.td === 'Útil') {
          utilSum += val;
          utilCount++;
        } else if (r.td === 'FIN') {
          finSum += val;
          finCount++;
        }
      }

      const dailyWeekday = utilCount ? Math.round(utilSum / utilCount) : 0;
      const weekendAvg = finCount ? Math.round(finSum / finCount) : 0;
      const peakHour = Math.round(dailyWeekday * 0.148);
      const grossRevenue = Math.round(total * 2.5);
      const payingPassengers = Math.round(total * 0.82);

      // Cálculo memoizado de YoY
      let yoyPercent = 0;
      if (yearStr !== 'all') {
        const prevYear = (parseInt(yearStr, 10) - 1).toString();
        const prevRecords = this.getRecordsForPeriod(prevYear, monthVal);
        let prevTotal = 0;
        for (let i = 0, len = prevRecords.length; i < len; i++) {
          prevTotal += (prevRecords[i].st && prevRecords[i].st[code]) || 0;
        }
        if (prevTotal > 0) {
          yoyPercent = ((total - prevTotal) / prevTotal) * 100;
        }
      }

      // Cálculo memoizado de MoM
      let momPercent = null;
      if (yearStr !== 'all') {
        const curYear = parseInt(yearStr, 10);
        const curMonth = monthVal !== 'all' ? (parseInt(monthVal, 10) + 1) : 12;
        let prevMYear = curYear;
        let prevMMonth = curMonth - 1;
        if (prevMMonth === 0) {
          prevMMonth = 12;
          prevMYear = curYear - 1;
        }
        const prevRecords = this.byYearMonth.get(`${prevMYear}-${prevMMonth}`) || [];
        let prevMonthTotal = 0;
        for (let i = 0, len = prevRecords.length; i < len; i++) {
          prevMonthTotal += (prevRecords[i].st && prevRecords[i].st[code]) || 0;
        }

        let curMonthTotal = total;
        if (monthVal === 'all') {
          const curMonthRecords = this.byYearMonth.get(`${curYear}-${curMonth}`) || [];
          curMonthTotal = 0;
          for (let i = 0, len = curMonthRecords.length; i < len; i++) {
            curMonthTotal += (curMonthRecords[i].st && curMonthRecords[i].st[code]) || 0;
          }
        }

        if (prevMonthTotal > 0 && curMonthTotal > 0) {
          momPercent = ((curMonthTotal - prevMonthTotal) / prevMonthTotal) * 100;
        }
      }

      const result = {
        total,
        payingPassengers,
        payingShare: 0.82,
        grossRevenue,
        channels: {
          topBU: 0.63,
          qrCode: 0.16,
          nfc: 0.05,
          free: 0.16
        },
        dailyWeekday,
        weekendAvg,
        peakHour,
        yoyPercent,
        momPercent
      };

      this.stationStatsCache.set(cacheKey, result);
      return result;
    }

    /**
     * Retorna a classificação da estação na linha e na rede em O(1)
     */
    getStationRanks(stationId, yearStr = '2024', monthVal = 'all') {
      const rankKey = `${yearStr}:${monthVal}`;
      if (!this.rankingsCache.has(rankKey)) {
        this._buildRankingsForPeriod(yearStr, monthVal);
      }
      const rankings = this.rankingsCache.get(rankKey);
      return {
        lineRank: (rankings && rankings.byLine.get(stationId)) || 1,
        globalRank: (rankings && rankings.global.get(stationId)) || 1
      };
    }

    /**
     * Pré-calcula a ordenação das 41 estações uma única vez por período
     */
    _buildRankingsForPeriod(yearStr, monthVal) {
      const stations = window.stationsCatalog || {};
      const stationIds = Object.keys(stations);
      const totals = [];

      for (let i = 0, len = stationIds.length; i < len; i++) {
        const id = stationIds[i];
        const stats = this.getStationAnalytics(id, yearStr, monthVal);
        totals.push({
          id,
          total: stats.total,
          lines: stations[id].lines || []
        });
      }

      // Ordenação Global
      totals.sort((a, b) => b.total - a.total);
      const globalMap = new Map();
      for (let i = 0; i < totals.length; i++) {
        globalMap.set(totals[i].id, i + 1);
      }

      // Ordenação por Linha
      const lineMap = new Map();
      const l8Stations = totals.filter(item => item.lines.includes('L8'));
      l8Stations.sort((a, b) => b.total - a.total);
      for (let i = 0; i < l8Stations.length; i++) {
        lineMap.set(l8Stations[i].id, i + 1);
      }

      const l9Stations = totals.filter(item => item.lines.includes('L9') && !item.lines.includes('L8'));
      l9Stations.sort((a, b) => b.total - a.total);
      for (let i = 0; i < l9Stations.length; i++) {
        lineMap.set(l9Stations[i].id, i + 1);
      }

      const rankKey = `${yearStr}:${monthVal}`;
      this.rankingsCache.set(rankKey, {
        global: globalMap,
        byLine: lineMap
      });
    }

    /**
     * Retorna os KPIs consolidados da rede (Total, L8, L9, Receita, YoY, MoM) em O(1)
     */
    getNetworkKPIs(yearStr = '2024', monthVal = 'all') {
      const cacheKey = `${yearStr}:${monthVal}`;
      if (this.networkStatsCache.has(cacheKey)) {
        return this.networkStatsCache.get(cacheKey);
      }

      const records = this.getRecordsForPeriod(yearStr, monthVal);
      let totalL8 = 0, totalL9 = 0, revL8 = 0, revL9 = 0;

      for (let i = 0, len = records.length; i < len; i++) {
        const r = records[i];
        totalL8 += (r.l8_e || 0);
        totalL9 += (r.l9_e || 0);
        revL8 += (r.l8_r || 0);
        revL9 += (r.l9_r || 0);
      }

      const totalNetwork = totalL8 + totalL9;
      const totalRevenue = revL8 + revL9;
      const shareL8 = totalNetwork > 0 ? ((totalL8 / totalNetwork) * 100).toFixed(1).replace('.', ',') : '0,0';
      const shareL9 = totalNetwork > 0 ? ((totalL9 / totalNetwork) * 100).toFixed(1).replace('.', ',') : '0,0';

      // YoY
      let yoyNet = null, yoyL8 = null, yoyL9 = null;
      if (yearStr !== 'all') {
        const prevYear = (parseInt(yearStr, 10) - 1).toString();
        const prevRecords = this.getRecordsForPeriod(prevYear, monthVal);
        let pyL8 = 0, pyL9 = 0;
        for (let i = 0, len = prevRecords.length; i < len; i++) {
          pyL8 += (prevRecords[i].l8_e || 0);
          pyL9 += (prevRecords[i].l9_e || 0);
        }
        const pyNet = pyL8 + pyL9;
        if (pyNet > 0) yoyNet = ((totalNetwork - pyNet) / pyNet) * 100;
        if (pyL8 > 0) yoyL8 = ((totalL8 - pyL8) / pyL8) * 100;
        if (pyL9 > 0) yoyL9 = ((totalL9 - pyL9) / pyL9) * 100;
      }

      // MoM
      let momNet = null, momL8 = null, momL9 = null;
      if (yearStr !== 'all') {
        const curYear = parseInt(yearStr, 10);
        const curMonth = monthVal !== 'all' ? (parseInt(monthVal, 10) + 1) : 12;
        let prevMYear = curYear;
        let prevMMonth = curMonth - 1;
        if (prevMMonth === 0) {
          prevMMonth = 12;
          prevMYear = curYear - 1;
        }
        const prevMonthRecords = this.byYearMonth.get(`${prevMYear}-${prevMMonth}`) || [];
        let pmL8 = 0, pmL9 = 0;
        for (let i = 0, len = prevMonthRecords.length; i < len; i++) {
          pmL8 += (prevMonthRecords[i].l8_e || 0);
          pmL9 += (prevMonthRecords[i].l9_e || 0);
        }
        const pmNet = pmL8 + pmL9;

        let curMonthL8 = totalL8, curMonthL9 = totalL9;
        if (monthVal === 'all') {
          const curMRecs = this.byYearMonth.get(`${curYear}-${curMonth}`) || [];
          curMonthL8 = 0; curMonthL9 = 0;
          for (let i = 0, len = curMRecs.length; i < len; i++) {
            curMonthL8 += (curMRecs[i].l8_e || 0);
            curMonthL9 += (curMRecs[i].l9_e || 0);
          }
        }
        const curMNet = curMonthL8 + curMonthL9;
        if (pmNet > 0 && curMNet > 0) momNet = ((curMNet - pmNet) / pmNet) * 100;
        if (pmL8 > 0 && curMonthL8 > 0) momL8 = ((curMonthL8 - pmL8) / pmL8) * 100;
        if (pmL9 > 0 && curMonthL9 > 0) momL9 = ((curMonthL9 - pmL9) / pmL9) * 100;
      }

      const result = {
        totalNetwork,
        totalRevenue,
        totalL8,
        totalL9,
        revL8,
        revL9,
        shareL8,
        shareL9,
        yoyNet,
        yoyL8,
        yoyL9,
        momNet,
        momL8,
        momL9
      };

      this.networkStatsCache.set(cacheKey, result);
      return result;
    }

    _getEmptyStationStats() {
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
  }

  // Exporta instância Singleton global
  window.AnalyticsCache = new AnalyticsCacheEngine();

})(window);

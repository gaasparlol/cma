/**
 * RailPulse • 60 FPS Vector Map Engine
 * (application-performance-performance-optimization & modern-javascript-patterns)
 * 
 * Hardware-accelerated Pan/Zoom & Hover Card controller using requestAnimationFrame.
 * Eliminates layout thrashing, layout shifts, and redundant DOM queries.
 */

(function(window) {
  'use strict';

  class VectorMapEngine {
    constructor() {
      this.zoom = 1;
      this.panX = 0;
      this.panY = 0;
      this.isDragging = false;
      this.dragStartX = 0;
      this.dragStartY = 0;
      
      this.rafPanId = null;
      this.rafHoverId = null;
      
      this.hoverMouseX = 0;
      this.hoverMouseY = 0;
      this.cachedViewportRect = null;
      this.initialized = false;
      
      this.minZoom = 0.75;
      this.maxZoom = 2.8;
    }

    init() {
      if (this.initialized) return;
      const viewport = document.getElementById('map-viewport');
      const group = document.getElementById('svg-pan-zoom-group');
      if (!viewport || !group) return;

      // Armazena dimensões para não recalcular a cada mousemove
      this.updateViewportRect();
      window.addEventListener('resize', () => this.updateViewportRect(), { passive: true });

      // Pan com Mouse / Touch
      viewport.addEventListener('mousedown', (e) => {
        if (e.target.closest('.station-node') || e.target.closest('button')) return;
        this.isDragging = true;
        this.dragStartX = e.clientX - this.panX;
        this.dragStartY = e.clientY - this.panY;
        group.style.willChange = 'transform';
        viewport.style.cursor = 'grabbing';
      });

      window.addEventListener('mousemove', (e) => {
        if (!this.isDragging) return;
        this.panX = e.clientX - this.dragStartX;
        this.panY = e.clientY - this.dragStartY;
        this.schedulePanZoomRender();
      }, { passive: true });

      window.addEventListener('mouseup', () => {
        if (this.isDragging) {
          this.isDragging = false;
          if (group) group.style.willChange = 'auto';
          if (viewport) viewport.style.cursor = 'grab';
        }
      });

      // Zoom com Wheel (Scroll do mouse suave com RAF)
      viewport.addEventListener('wheel', (e) => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.12 : 0.89;
        this.setZoom(this.zoom * factor);
      }, { passive: false });

      this.initialized = true;
    }

    updateViewportRect() {
      const viewport = document.getElementById('map-viewport');
      if (viewport) {
        this.cachedViewportRect = viewport.getBoundingClientRect();
      }
    }

    setZoom(newZoom) {
      this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, newZoom));
      this.schedulePanZoomRender();
    }

    resetView() {
      this.zoom = 1;
      this.panX = 0;
      this.panY = 0;
      this.schedulePanZoomRender();
    }

    /**
     * Renderiza o Pan e Zoom sincronizado com o refresh rate do display (60+ FPS)
     */
    schedulePanZoomRender() {
      if (this.rafPanId) return;
      this.rafPanId = requestAnimationFrame(() => {
        this.rafPanId = null;
        const group = document.getElementById('svg-pan-zoom-group');
        if (group) {
          group.setAttribute('transform', `translate(${this.panX.toFixed(1)}, ${this.panY.toFixed(1)}) scale(${this.zoom.toFixed(3)})`);
        }
      });
    }

    /**
     * Exibe o Hover Card instantaneamente usando os dados pré-calculados do AnalyticsCache
     */
    showHoverCard(e, stationId) {
      const card = document.getElementById('map-station-hover-card');
      const st = window.stationsCatalog ? window.stationsCatalog[stationId] : null;
      if (!card || !st) return;

      const yearSelect = document.getElementById('map-filter-year');
      const monthSelect = document.getElementById('map-filter-month');
      const yearStr = yearSelect ? yearSelect.value : '2024';
      const monthVal = monthSelect ? monthSelect.value : 'all';

      // Consulta O(1) sem recalcular nenhum array
      const stats = window.AnalyticsCache 
        ? window.AnalyticsCache.getStationAnalytics(stationId, yearStr, monthVal)
        : window.getStationAnalytics(stationId, yearStr, monthVal);

      const ranks = window.AnalyticsCache 
        ? window.AnalyticsCache.getStationRanks(stationId, yearStr, monthVal)
        : { lineRank: 1, globalRank: 1 };

      const isDual = st.lines.length === 2;
      const primaryLine = st.lines.includes('L9') && !st.lines.includes('L8') ? 'L9' : st.lines[0];
      const lineColor = isDual 
        ? 'linear-gradient(90deg, #9E9E93 0%, #00A88F 100%)' 
        : (primaryLine === 'L8' ? '#9E9E93' : '#00A88F');

      const badgesHtml = st.lines.map(line => {
        const isL8 = line === 'L8';
        const bg = isL8 ? '#9E9E93' : '#00A88F';
        const txt = isL8 ? 'L8 DIAMANTE' : 'L9 ESMERALDA';
        return `<span style="padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: 800; color: #04070e; background-color: ${bg};">${txt}</span>`;
      }).join('');

      const transferBadge = st.isTransfer 
        ? `<span style="padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: 800; color: #facc15; background: rgba(250, 204, 21, 0.15); border: 1px solid rgba(250, 204, 21, 0.3);">BALDEAÇÃO</span>` 
        : '';

      card.innerHTML = `
        <div class="station-hover-card-accent" style="background: ${lineColor};"></div>
        <div class="station-hover-card-body">
          <div class="station-hover-title-row">
            <div>
              <h4 class="station-hover-name">${st.name}</h4>
              <div class="station-hover-city">${st.city} • ${st.km}</div>
            </div>
            <div class="station-hover-badges">
              ${badgesHtml}
              ${transferBadge}
            </div>
          </div>

          <div class="station-hover-metrics-grid">
            <div class="station-hover-metric-item">
              <span class="station-hover-metric-label">Média Dia Útil</span>
              <span class="station-hover-metric-value" style="color: #38bdf8;">${window.formatNumberBR(stats.dailyWeekday)} <span style="font-size: 9px; color: var(--text-muted); font-weight: 400;">pax/dia</span></span>
            </div>
            <div class="station-hover-metric-item">
              <span class="station-hover-metric-label">Receita Estimada</span>
              <span class="station-hover-metric-value" style="color: #34d399;">R$ ${window.formatCompactBR(stats.grossRevenue)}</span>
            </div>
          </div>

          <div class="station-hover-footer">
            <div style="display: flex; align-items: center; gap: 0.4rem;">
              <span class="station-hover-rank-badge">#${ranks.lineRank} na ${primaryLine}</span>
              <span style="font-size: 10px; color: var(--text-muted);">#${ranks.globalRank} na Rede Geral</span>
            </div>
            <span style="font-size: 10px; color: #fbbf24; font-weight: 600; display: flex; align-items: center; gap: 2px;">
              Auditar &rarr;
            </span>
          </div>
        </div>
      `;

      this.updateViewportRect();
      this.moveHoverCard(e);
      card.style.opacity = '1';
      card.style.transform = 'scale(1)';
    }

    /**
     * Move o Hover Card utilizando requestAnimationFrame para garantir 60 FPS
     */
    moveHoverCard(e) {
      this.hoverMouseX = e.clientX;
      this.hoverMouseY = e.clientY;

      if (this.rafHoverId) return;
      this.rafHoverId = requestAnimationFrame(() => {
        this.rafHoverId = null;
        const card = document.getElementById('map-station-hover-card');
        if (!card) return;

        if (!this.cachedViewportRect) {
          this.updateViewportRect();
        }
        const vRect = this.cachedViewportRect || { left: 0, top: 0, width: 1000, height: 600 };

        const mouseX = this.hoverMouseX - vRect.left;
        const mouseY = this.hoverMouseY - vRect.top;

        const cardW = 275;
        const cardH = 150;

        let left = mouseX + 16;
        let top = mouseY + 12;

        if (left + cardW > vRect.width - 15) {
          left = mouseX - cardW - 16;
        }
        if (top + cardH > vRect.height - 15) {
          top = mouseY - cardH - 12;
        }
        if (left < 10) left = 10;
        if (top < 10) top = 10;

        card.style.left = `${Math.round(left)}px`;
        card.style.top = `${Math.round(top)}px`;
      });
    }

    hideHoverCard() {
      const card = document.getElementById('map-station-hover-card');
      if (card) {
        card.style.opacity = '0';
        card.style.transform = 'scale(0.96)';
      }
    }
  }

  // Exporta instância global
  window.MapEngine = new VectorMapEngine();

})(window);

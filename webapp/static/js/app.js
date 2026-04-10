/**
 * SheetPreprocessor Review Webapp — Main App
 */

// Global helper to access Alpine data from x-html onclick handlers
window._alpine = function() {
  const el = document.querySelector('[x-data]');
  return el?._x_dataStack?.[0];
};
window._alpineToggle = function(key) {
  const data = window._alpine();
  if (data) {
    data.expandedCols[key] = !data.expandedCols[key];
    // Force reactivity by reassigning
    data.expandedCols = { ...data.expandedCols };
  }
};

function app() {
  return {
    view: 'dashboard',
    currentSheet: null,
    manifest: null,
    relationships: null,
    sheetStats: {},    // cache: { sheetName: statsObj }
    sheetConfigs: {},  // cache: { sheetName: configObj }
    loading: false,
    relTab: 'table',   // 'table' | 'graph'
    outlierFilter: 'pending', // 'all' | 'pending' | 'decided'
    outlierSheetFilter: 'all',
    issuesSheetFilter: 'all',
    expandedCols: {},  // { "sheet::col": true }

    async init() {
      this.loading = true;
      try {
        const rawManifest = await this.fetchJson('/api/manifest');
        // Normalize manifest: ensure sheets[].name exists
        if (rawManifest.sheets) {
          rawManifest.sheets = rawManifest.sheets.map(s => ({
            ...s,
            name: s.name || s.sheet,
          }));
        }
        rawManifest.outlier_groups_pending = rawManifest.outlier_groups_pending ?? rawManifest.total_outlier_groups_pending ?? 0;
        rawManifest.escalation_count = rawManifest.escalation_count ?? rawManifest.total_escalations_pending ?? 0;
        rawManifest.issues_pending = rawManifest.issues_pending ?? rawManifest.total_issues_pending ?? 0;
        rawManifest.source_file = rawManifest.source_file || '';
        this.manifest = rawManifest;

        const rawRel = await this.fetchJson('/api/relationships');
        // Normalize relationships
        this.relationships = this.normalizeRelationships(rawRel);
      } catch (e) {
        console.error('Failed to load initial data:', e);
      }
      this.loading = false;

      // Handle hash navigation
      window.addEventListener('hashchange', () => this.handleHash());
      this.handleHash();
    },

    handleHash() {
      const hash = location.hash.slice(1) || '/';
      if (hash.startsWith('/sheet/')) {
        const name = decodeURIComponent(hash.slice(7));
        this.navigate('sheet', name);
      } else if (hash === '/relationships') {
        this.navigate('relationships');
      } else if (hash === '/outliers') {
        this.navigate('outliers');
      } else if (hash === '/issues') {
        this.navigate('issues');
      } else {
        this.navigate('dashboard');
      }
    },

    async navigate(view, sheetName) {
      this.view = view;
      if (view === 'sheet' && sheetName) {
        this.currentSheet = sheetName;
        location.hash = `/sheet/${encodeURIComponent(sheetName)}`;
        await this.loadSheetData(sheetName);
      } else if (view === 'relationships') {
        location.hash = '/relationships';
      } else if (view === 'outliers') {
        location.hash = '/outliers';
        // Preload all sheet configs for outlier view
        await this.loadAllConfigs();
      } else if (view === 'issues') {
        location.hash = '/issues';
        // Preload all sheet configs for issues view
        await this.loadAllConfigs();
      } else {
        location.hash = '/';
      }
    },

    async loadSheetData(name) {
      if (!this.sheetStats[name]) {
        this.loading = true;
        try {
          const [stats, config] = await Promise.all([
            this.fetchJson(`/api/sheet/${encodeURIComponent(name)}/stats`),
            this.fetchJson(`/api/sheet/${encodeURIComponent(name)}/config`)
          ]);
          this.sheetStats[name] = stats;
          this.sheetConfigs[name] = config;
        } catch (e) {
          console.error(`Failed to load ${name}:`, e);
        }
        this.loading = false;
      }
    },

    async loadAllConfigs() {
      if (!this.manifest) return;
      // Check if all sheets already cached — skip loading if so
      const needsLoad = this.manifest.sheets.some(s => !this.sheetStats[s.name]);
      if (!needsLoad) return;
      this.loading = true;
      const promises = this.manifest.sheets.map(async s => {
        if (!this.sheetStats[s.name]) {
          try {
            const [stats, config] = await Promise.all([
              this.fetchJson(`/api/sheet/${encodeURIComponent(s.name)}/stats`),
              this.fetchJson(`/api/sheet/${encodeURIComponent(s.name)}/config`)
            ]);
            this.sheetStats[s.name] = stats;
            this.sheetConfigs[s.name] = config;
          } catch (e) {
            console.error(`Failed to load ${s.name}:`, e);
          }
        }
      });
      await Promise.all(promises);
      this.loading = false;
    },

    async fetchJson(url) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
      return res.json();
    },

    async postJson(url, data) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },

    kindClass(kind) {
      if (!kind) return '';
      if (kind.includes('repeated')) return 'repeated';
      if (kind.includes('timeseries')) return 'timeseries';
      if (kind.includes('snapshot')) return 'snapshot';
      if (kind.includes('lookup')) return 'lookup';
      if (kind.includes('id_list')) return 'idlist';
      return '';
    },

    fmt(n, decimals = 0) {
      if (n == null) return '—';
      if (typeof n !== 'number') return String(n);
      if (decimals === 0) return n.toLocaleString();
      return n.toFixed(decimals);
    },

    pct(n) {
      if (n == null) return '—';
      return (n * 100).toFixed(1) + '%';
    },

    toggleExpand(key) {
      this.expandedCols[key] = !this.expandedCols[key];
    },

    isExpanded(key) {
      return !!this.expandedCols[key];
    },

    normalizeRelationships(raw) {
      // Normalize sheet_keys → sheets with full info from manifest
      const sheets = {};
      const sheetKeys = raw.sheet_keys || raw.sheets || {};
      for (const [name, info] of Object.entries(sheetKeys)) {
        const manifestSheet = this.manifest?.sheets?.find(s => s.name === name) || {};
        sheets[name] = {
          kind: manifestSheet.kind || info.kind || '',
          n_rows: manifestSheet.n_rows || info.n_rows || 0,
          n_unique: info.n_unique || manifestSheet.n_unique || 0,
          entity_key: info.entity_key || manifestSheet.entity_key || '',
          keys: { [info.entity_key || '患者id']: { role: info.role || 'primary', unique: info.unique, n_unique: info.n_unique } }
        };
      }
      // Normalize edges: sheets: [a, b] → a, b; join_key → key
      const edges = (raw.edges || []).map(e => ({
        a: e.a || (e.sheets && e.sheets[0]) || '',
        b: e.b || (e.sheets && e.sheets[1]) || '',
        key: e.key || e.join_key || '',
        intersection: e.intersection || 0,
        coverage: e.coverage || 0,
        type: e.type || '—'
      }));
      // Normalize join_keys
      const joinKeys = raw.join_keys || [{ key: raw.join_key || '患者id', sheet_count: Object.keys(sheets).length }];
      return { sheets, edges, join_keys: joinKeys };
    },

    // Computed: total pending across all types
    get totalPending() {
      if (!this.manifest) return 0;
      return (this.manifest.outlier_groups_pending || 0)
           + (this.manifest.issues_pending || 0);
    },

    // View renderers — defined in separate files
    renderDashboard() { return window.renderDashboard?.(this) || ''; },
    renderSheetDetail(_trigger) { return window.renderSheetDetail?.(this, _trigger) || ''; },
    renderRelationships() { return window.renderRelationships?.(this) || ''; },
    renderOutlierReview() { return window.renderOutlierReview?.(this) || ''; },
    renderIssues() { return window.renderIssues?.(this) || ''; },
  };
}

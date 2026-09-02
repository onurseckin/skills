export function buildHtmlDocument(styles: string, clientScript: string): string {
  return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Test Coverage & Runtime Dashboard - @onurseckin/skills</title>
  <style>
${styles}
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <div class="brand-icon">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
        </svg>
      </div>
      <div class="brand-text">Skills Test Suite & Performance</div>
      <span id="header-badge" class="badge"></span>
    </div>
    <div style="font-size: 0.8rem; color: var(--text-dim); font-family: 'SF Mono', Menlo, Monaco, Consolas, monospace;" id="header-timestamp"></div>
  </header>

  <div class="container">
    <!-- Static Offline Loading Indicator (Hidden immediately once JS initializes) -->
    <div id="dashboard-loader" class="dashboard-loader">
      <div class="loader-spinner"></div>
      <div class="loader-text">Loading Test Coverage & Telemetry...</div>
    </div>
    <!-- 5 Master KPI Summary Cards -->
    <div class="metrics-grid">
      <div class="metric-card">
        <div class="metric-info">
          <div class="metric-title">Lines Coverage</div>
          <div class="metric-value" id="val-lines">0%</div>
          <div class="metric-sub" id="sub-lines">0 / 0 lines</div>
        </div>
        <div class="radial-gauge" id="gauge-lines"></div>
      </div>

      <div class="metric-card">
        <div class="metric-info">
          <div class="metric-title">Functions Coverage</div>
          <div class="metric-value" id="val-funcs">0%</div>
          <div class="metric-sub" id="sub-funcs">0 / 0 funcs</div>
        </div>
        <div class="radial-gauge" id="gauge-funcs"></div>
      </div>

      <div class="metric-card">
        <div class="metric-info">
          <div class="metric-title">Production Files Tested</div>
          <div class="metric-value" id="val-files">0</div>
          <div class="metric-sub">Across Source Code</div>
        </div>
        <div class="radial-gauge" id="gauge-files"></div>
      </div>

      <div class="metric-card">
        <div class="metric-info">
          <div class="metric-title">Unit Test Files Run</div>
          <div class="metric-value" id="val-tests">0</div>
          <div class="metric-sub" id="sub-tests">0ms total duration</div>
        </div>
        <div class="radial-gauge" id="gauge-tests"></div>
      </div>

      <div class="metric-card">
        <div class="metric-info">
          <div class="metric-title">Deficit Clusters</div>
          <div class="metric-value" id="val-deficits">0</div>
          <div class="metric-sub" id="sub-deficits">0 uncovered lines</div>
        </div>
        <div class="radial-gauge" id="gauge-deficits"></div>
      </div>
    </div>

    <!-- Master View: Controls Bar + Unified Table -->
    <div id="master-view">
      <div class="controls-bar">
        <div class="view-mode-group">
          <button class="view-mode-btn active" id="btn-view-tree" onclick="setViewMode('tree')">Folder Tree</button>
          <button class="view-mode-btn" id="btn-view-flat" onclick="setViewMode('flat')">Flat File List</button>
        </div>
        <div class="filters-group">
          <button class="filter-btn active" id="filter-all" onclick="setMasterFilter('all')">All</button>
          <button class="filter-btn" id="filter-miss" onclick="setMasterFilter('miss')">Needs Coverage (&lt;100%)</button>
          <button class="filter-btn" id="filter-deficits" onclick="setMasterFilter('deficits')">Deficits Only</button>
          <button class="filter-btn" id="filter-slow" onclick="setMasterFilter('slow')">Slow (P50/P90)</button>
          <button class="filter-btn" id="filter-perfect" onclick="setMasterFilter('perfect')">100% Perfect</button>
        </div>
        <div class="search-wrapper">
          <input type="text" id="master-search-box" class="search-input" placeholder="Search path, test, or deficit..." oninput="onMasterSearch(this.value)" />
        </div>
      </div>

      <div class="tree-actions-bar" id="tree-actions-bar">
        <button class="tree-action-btn" onclick="expandAllFolders()">Expand All</button>
        <button class="tree-action-btn" onclick="collapseAllFolders()">Collapse All</button>
        <span style="font-size: 0.8rem; color: var(--text-dim); margin-left: auto;" id="table-summary-text"></span>
      </div>

      <div class="table-responsive" id="master-table-container"></div>
    </div>

    <!-- In-Place Code Viewer (Shown when a file is selected) -->
    <div id="code-viewer-container" style="display: none;"></div>
  </div>

  <script>
${clientScript}
  </script>
</body>
</html>`;
}

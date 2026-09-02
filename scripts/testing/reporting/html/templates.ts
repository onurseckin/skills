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
    <div style="display: flex; align-items: center; gap: 1rem;">
      <div style="font-size: 0.8rem; color: var(--text-dim); font-family: 'SF Mono', Menlo, Monaco, Consolas, monospace;" id="header-timestamp"></div>
    </div>
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
          <div class="metric-sub" id="sub-lines">0 / 0 lines</div>
        </div>
        <div class="metric-progress-track"><div id="kpi-fill-lines" class="metric-progress-fill"></div><span id="kpi-val-lines" class="metric-progress-text">0%</span></div>
      </div>

      <div class="metric-card">
        <div class="metric-info">
          <div class="metric-title">Functions Coverage</div>
          <div class="metric-sub" id="sub-funcs">0 / 0 funcs</div>
        </div>
        <div class="metric-progress-track"><div id="kpi-fill-funcs" class="metric-progress-fill"></div><span id="kpi-val-funcs" class="metric-progress-text">0%</span></div>
      </div>

      <div class="metric-card">
        <div class="metric-info">
          <div class="metric-title">Production Files Tested</div>
          <div class="metric-value" id="val-files">0</div>
          <div class="metric-sub">Across Source Code</div>
        </div>
      </div>

      <div class="metric-card">
        <div class="metric-info">
          <div class="metric-title">Unit Test Files Run</div>
          <div class="metric-value" id="val-tests">0</div>
          <div class="metric-sub" id="sub-tests">0ms total duration</div>
        </div>
      </div>

      <div class="metric-card">
        <div class="metric-info">
          <div class="metric-title">Deficit Clusters</div>
          <div class="metric-value" id="val-deficits">0</div>
          <div class="metric-sub" id="sub-deficits">0 uncovered lines</div>
          <span style="display:none;" id="val-def-uncovered">0</span>
          <span style="display:none;" id="sub-def-uncovered">0</span>
          <span style="display:none;" id="val-def-clusters">0</span>
          <span style="display:none;" id="sub-def-clusters">0</span>
          <span style="display:none;" id="val-rt-total">0</span>
          <span style="display:none;" id="val-rt-p50">0</span>
        </div>
      </div>
    </div>

    <!-- Dedicated Deficit Overview: 4 Deficit Category KPI Cards -->
    <div class="deficit-kpi-grid">
      <div class="deficit-kpi-card" onclick="setDeficitCategoryFilter('error-handling')" style="cursor: pointer;" title="Filter Error Handling Deficits">
        <div class="kpi-header">
          <span class="kpi-title">Error Handling</span>
          <span class="badge badge-cat-error-handling">Catch & Throw</span>
        </div>
        <div class="kpi-value" id="val-def-error">0</div>
        <div class="kpi-sub" id="sub-def-error">Catch & throw paths</div>
      </div>

      <div class="deficit-kpi-card" onclick="setDeficitCategoryFilter('branching')" style="cursor: pointer;" title="Filter Branching Deficits">
        <div class="kpi-header">
          <span class="kpi-title">Branching</span>
          <span class="badge badge-cat-branching">Guards & Switches</span>
        </div>
        <div class="kpi-value" id="val-def-branching">0</div>
        <div class="kpi-sub" id="sub-def-branching">Guards & switches</div>
      </div>

      <div class="deficit-kpi-card" onclick="setDeficitCategoryFilter('initialization')" style="cursor: pointer;" title="Filter Initialization Deficits">
        <div class="kpi-header">
          <span class="kpi-title">Initialization</span>
          <span class="badge badge-cat-initialization">Setup & Defaults</span>
        </div>
        <div class="kpi-value" id="val-def-init">0</div>
        <div class="kpi-sub" id="sub-def-init">Setup & constructors</div>
      </div>

      <div class="deficit-kpi-card" onclick="setDeficitCategoryFilter('unexercised-logic')" style="cursor: pointer;" title="Filter Unexercised Logic Deficits">
        <div class="kpi-header">
          <span class="kpi-title">Unexercised Logic</span>
          <span class="badge badge-cat-unexercised-logic">Routines & Bodies</span>
        </div>
        <div class="kpi-value" id="val-def-logic">0</div>
        <div class="kpi-sub" id="sub-def-logic">Routines & algorithms</div>
      </div>
    </div>

    <!-- Master View: Controls Bar + Unified Table -->
    <div id="master-view">
      <div class="controls-bar">
        <div class="view-mode-group">
          <button class="view-mode-btn active" id="btn-view-tree" onclick="setViewMode('tree')">Folder Tree</button>
          <button class="view-mode-btn" id="btn-view-flat" onclick="setViewMode('flat')">Flat File List</button>
          <button class="view-mode-btn" id="btn-view-deficits" onclick="setViewMode('deficits')">Deficit Clusters</button>
        </div>
        <div class="filters-group">
          <button class="filter-btn active" id="filter-all" onclick="setMasterFilter('all')">All</button>
          <button class="filter-btn" id="filter-miss" onclick="setMasterFilter('miss')">Needs Coverage (&lt;100%)</button>
          <button class="filter-btn" id="filter-deficits" onclick="setMasterFilter('deficits')">Deficits Only</button>
          <button class="filter-btn filter-def-btn" id="filter-def-error-handling" onclick="setDeficitCategoryFilter('error-handling')">Error Handling</button>
          <button class="filter-btn filter-def-btn" id="filter-def-branching" onclick="setDeficitCategoryFilter('branching')">Branching</button>
          <button class="filter-btn filter-def-btn" id="filter-def-initialization" onclick="setDeficitCategoryFilter('initialization')">Initialization</button>
          <button class="filter-btn filter-def-btn" id="filter-def-unexercised-logic" onclick="setDeficitCategoryFilter('unexercised-logic')">Unexercised Logic</button>
          <button class="filter-btn" id="filter-slow" onclick="setMasterFilter('slow')">Slow (P50/P90)</button>
          <button class="filter-btn" id="filter-perfect" onclick="setMasterFilter('perfect')">100% Perfect</button>
        </div>
        <div class="search-wrapper">
          <input type="text" id="master-search-box" class="search-input" placeholder="Search path, test, or deficit..." oninput="onMasterSearch(this.value)" />
          <button class="reset-btn" id="btn-reset-filters" onclick="resetMasterFilters()" title="Reset all filters and restore hierarchical tree view">Reset Filters</button>
          <input type="hidden" id="deficit-search-box" />
          <input type="hidden" id="unified-search-box" />
          <input type="hidden" id="runtime-search-box" />
          <input type="hidden" id="search-box" />
        </div>
      </div>

      <div class="tree-actions-bar" id="tree-actions-bar">
        <button class="tree-action-btn" id="btn-expand-all" onclick="expandAllFolders()">Expand All</button>
        <button class="tree-action-btn" id="btn-collapse-all" onclick="collapseAllFolders()">Collapse All</button>
        <span style="font-size: 0.8rem; color: var(--text-dim); margin-left: auto;" id="table-summary-text"></span>
      </div>

      <div class="table-responsive" id="master-table-container"></div>
      <div id="deficits-section" style="display: none;"><div id="deficits-content-view"></div></div>
      <div id="runtime-section" style="display: none;"><div id="runtime-content-view"></div></div>
      <span style="display:none;" id="tab-coverage"></span>
      <span style="display:none;" id="tab-runtime"></span>
      <span style="display:none;" id="tab-unified"></span>
      <span style="display:none;" id="tab-deficits"></span>
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

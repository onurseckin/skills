export function buildHtmlDocument(styles: string, clientScript: string): string {
  return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Test Coverage & Runtime Dashboard - @onurseckin/skills</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
${styles}
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <div class="brand-icon">⚡</div>
      <div class="brand-text">Skills Test Suite & Performance</div>
      <span id="header-badge" class="badge"></span>
    </div>
    <div style="font-size: 0.8rem; color: var(--text-dim); font-family: 'JetBrains Mono', monospace;" id="header-timestamp"></div>
  </header>

  <div class="container">
    <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border-subtle); margin-bottom: 1.5rem; flex-wrap: wrap; gap: 0.75rem;">
      <div class="tab-bar" style="border-bottom: none; margin-bottom: 0; padding-bottom: 0;">
        <button class="tab-btn active" id="tab-coverage" onclick="switchTab('coverage')">📊 Coverage Matrix</button>
        <button class="tab-btn" id="tab-runtime" onclick="switchTab('runtime')">⚡ Test Runtime Ranking</button>
        <button class="tab-btn" id="tab-unified" onclick="switchTab('unified')">🌳 Unified Hierarchy</button>
        <button class="tab-btn" id="tab-deficits" onclick="switchTab('deficits')">🎯 Deficit Clustering</button>
      </div>
      <div class="density-switch-group">
        <button id="btn-density-comfortable" class="density-btn active" onclick="setDensity('comfortable')">Comfortable</button>
        <button id="btn-density-compact" class="density-btn" onclick="setDensity('compact')">Compact</button>
      </div>
    </div>

    <!-- Tab 1: Coverage Matrix View -->
    <div id="coverage-section">
      <div class="metrics-grid">
        <div class="metric-card">
          <div class="metric-info">
            <div class="metric-title">Lines Coverage</div>
            <div class="metric-value" id="val-lines"></div>
            <div class="metric-sub" id="sub-lines"></div>
          </div>
          <div class="radial-gauge" id="gauge-lines"></div>
        </div>
        <div class="metric-card">
          <div class="metric-info">
            <div class="metric-title">Statements Coverage</div>
            <div class="metric-value" id="val-statements"></div>
            <div class="metric-sub" id="sub-statements"></div>
          </div>
          <div class="radial-gauge" id="gauge-statements"></div>
        </div>
        <div class="metric-card">
          <div class="metric-info">
            <div class="metric-title">Functions Coverage</div>
            <div class="metric-value" id="val-funcs"></div>
            <div class="metric-sub" id="sub-funcs"></div>
          </div>
          <div class="radial-gauge" id="gauge-funcs"></div>
        </div>
        <div class="metric-card">
          <div class="metric-info">
            <div class="metric-title">Total Source Files</div>
            <div class="metric-value" id="val-files"></div>
            <div class="metric-sub">Across Repository</div>
          </div>
          <div class="radial-gauge" id="gauge-files"></div>
        </div>
      </div>

      <div class="controls-bar">
        <div class="breadcrumbs" id="breadcrumbs"></div>
        <div class="filters-group">
          <button class="filter-btn active" id="filter-all" onclick="setFilter('all')">All</button>
          <button class="filter-btn" id="filter-miss" onclick="setFilter('miss')">Needs Coverage</button>
          <button class="filter-btn" id="filter-perfect" onclick="setFilter('perfect')">100% Perfect</button>
          <input type="text" id="search-box" class="search-input" placeholder="🔍 Filter path..." />
        </div>
      </div>

      <div class="table-responsive" id="content-view"></div>
    </div>

    <!-- Tab 2: Test Runtime Ranking View -->
    <div id="runtime-section" style="display: none;">
      <div class="runtime-kpi-grid">
        <div class="runtime-kpi-card">
          <div class="kpi-header"><span class="kpi-title">Total Duration</span><span class="kpi-icon">⏱️</span></div>
          <div class="kpi-value" id="val-rt-total">0ms</div>
          <div class="kpi-sub" id="sub-rt-total">Across 0 files</div>
        </div>
        <div class="runtime-kpi-card">
          <div class="kpi-header"><span class="kpi-title">Avg / Median Latency</span><span class="kpi-icon">⚡</span></div>
          <div class="kpi-value" id="val-rt-avg">0ms</div>
          <div class="kpi-sub" id="sub-rt-avg">Median: 0ms</div>
        </div>
        <div class="runtime-kpi-card">
          <div class="kpi-header"><span class="kpi-title">Top 50% Concentration</span><span class="kpi-icon">🎯</span></div>
          <div class="kpi-value" id="val-rt-p50">0 files</div>
          <div class="kpi-sub" id="sub-rt-p50">Accounts for 50% runtime</div>
        </div>
        <div class="runtime-kpi-card">
          <div class="kpi-header"><span class="kpi-title">Top 90% Concentration</span><span class="kpi-icon">📈</span></div>
          <div class="kpi-value" id="val-rt-p90">0 files</div>
          <div class="kpi-sub" id="sub-rt-p90">Accounts for 90% runtime</div>
        </div>
        <div class="runtime-kpi-card">
          <div class="kpi-header"><span class="kpi-title">Slowest Test File</span><span class="kpi-icon">🚨</span></div>
          <div class="kpi-value" id="val-rt-slowest">0ms</div>
          <div class="kpi-sub" id="sub-rt-slowest">None</div>
        </div>
      </div>

      <div class="controls-bar">
        <div style="font-size: 0.9rem; font-weight: 700; color: var(--text-main);">
          ⚡ Test Execution Duration Ranking
        </div>
        <div class="filters-group">
          <input type="text" id="runtime-search-box" class="search-input" placeholder="🔍 Filter test file..." />
        </div>
      </div>

      <div class="table-responsive" id="runtime-content-view"></div>
    </div>

    <!-- Tab 3: Unified Hierarchy & Metrics View -->
    <div id="unified-section" style="display: none;">
      <div class="unified-kpi-grid">
        <div class="unified-kpi-card">
          <div class="kpi-header"><span class="kpi-title">Codebase Line Coverage</span><span class="kpi-icon">🛡️</span></div>
          <div class="kpi-value" id="val-uni-health">100%</div>
          <div class="kpi-sub" id="sub-uni-health">Overall Health</div>
        </div>
        <div class="unified-kpi-card">
          <div class="kpi-header"><span class="kpi-title">Total Test Duration</span><span class="kpi-icon">⏱️</span></div>
          <div class="kpi-value" id="val-uni-duration">0ms</div>
          <div class="kpi-sub" id="sub-uni-duration">Across suite</div>
        </div>
        <div class="unified-kpi-card">
          <div class="kpi-header"><span class="kpi-title">Pareto Hotspots (P50/P90)</span><span class="kpi-icon">🎯</span></div>
          <div class="kpi-value" id="val-uni-pareto">0 / 0</div>
          <div class="kpi-sub" id="sub-uni-pareto">Latency files</div>
        </div>
        <div class="unified-kpi-card">
          <div class="kpi-header"><span class="kpi-title">Suite Test Status</span><span class="kpi-icon">🚦</span></div>
          <div class="kpi-value" id="val-uni-status">100% Passing</div>
          <div class="kpi-sub" id="sub-uni-status">All passing</div>
        </div>
      </div>

      <div class="controls-bar">
        <div class="tree-actions-group">
          <button class="tree-action-btn" onclick="expandAllFolders()">📂 Expand All</button>
          <button class="tree-action-btn" onclick="collapseAllFolders()">📁 Collapse All</button>
        </div>
        <div class="filters-group">
          <button class="filter-btn filter-uni-btn active" id="filter-uni-all" onclick="setUnifiedFilter('all')">All</button>
          <button class="filter-btn filter-uni-btn" id="filter-uni-miss" onclick="setUnifiedFilter('miss')">Needs Coverage</button>
          <button class="filter-btn filter-uni-btn" id="filter-uni-slow" onclick="setUnifiedFilter('slow')">Slow (P50/P90)</button>
          <button class="filter-btn filter-uni-btn" id="filter-uni-failing" onclick="setUnifiedFilter('failing')">Failing</button>
          <button class="filter-btn filter-uni-btn" id="filter-uni-perfect" onclick="setUnifiedFilter('perfect')">100% Perfect</button>
          <input type="text" id="unified-search-box" class="search-input" placeholder="🔍 Search path or test..." />
        </div>
      </div>

      <div id="unified-content-view"></div>
    </div>

    <!-- Tab 4: Deficit Clustering View -->
    <div id="deficits-section" style="display: none;">
      <div class="deficit-kpi-grid">
        <div class="deficit-kpi-card">
          <div class="kpi-header"><span class="kpi-title">Uncovered Lines</span><span class="kpi-icon">⚠️</span></div>
          <div class="kpi-value" id="val-def-uncovered">0</div>
          <div class="kpi-sub" id="sub-def-uncovered">Total deficit</div>
        </div>
        <div class="deficit-kpi-card">
          <div class="kpi-header"><span class="kpi-title">Risk Clusters</span><span class="kpi-icon">🎯</span></div>
          <div class="kpi-value" id="val-def-clusters">0</div>
          <div class="kpi-sub" id="sub-def-clusters">Contiguous blocks</div>
        </div>
        <div class="deficit-kpi-card">
          <div class="kpi-header"><span class="kpi-title">🛡️ Error Handling</span><span class="kpi-icon">🛡️</span></div>
          <div class="kpi-value" id="val-def-error">0</div>
          <div class="kpi-sub" id="sub-def-error">Catch & throw paths</div>
        </div>
        <div class="deficit-kpi-card">
          <div class="kpi-header"><span class="kpi-title">🔀 Branching</span><span class="kpi-icon">🔀</span></div>
          <div class="kpi-value" id="val-def-branching">0</div>
          <div class="kpi-sub" id="sub-def-branching">Guards & switches</div>
        </div>
        <div class="deficit-kpi-card">
          <div class="kpi-header"><span class="kpi-title">⚙️ Initialization</span><span class="kpi-icon">⚙️</span></div>
          <div class="kpi-value" id="val-def-init">0</div>
          <div class="kpi-sub" id="sub-def-init">Setup & constructors</div>
        </div>
        <div class="deficit-kpi-card">
          <div class="kpi-header"><span class="kpi-title">🧩 Unexercised Logic</span><span class="kpi-icon">🧩</span></div>
          <div class="kpi-value" id="val-def-logic">0</div>
          <div class="kpi-sub" id="sub-def-logic">Routines & bodies</div>
        </div>
      </div>

      <div class="controls-bar">
        <div class="filters-group">
          <button class="filter-btn filter-def-btn active" id="filter-def-all" onclick="setDeficitCategoryFilter('all')">All</button>
          <button class="filter-btn filter-def-btn" id="filter-def-error-handling" onclick="setDeficitCategoryFilter('error-handling')">🛡️ Error Handling</button>
          <button class="filter-btn filter-def-btn" id="filter-def-branching" onclick="setDeficitCategoryFilter('branching')">🔀 Branching</button>
          <button class="filter-btn filter-def-btn" id="filter-def-initialization" onclick="setDeficitCategoryFilter('initialization')">⚙️ Initialization</button>
          <button class="filter-btn filter-def-btn" id="filter-def-unexercised-logic" onclick="setDeficitCategoryFilter('unexercised-logic')">🧩 Unexercised Logic</button>
        </div>
        <input type="text" id="deficit-search-box" class="search-input" placeholder="🔍 Search cluster by file/path..." />
      </div>

      <div id="deficits-content-view"></div>
    </div>
  </div>

  <script>
${clientScript}
  </script>
</body>
</html>`;
}

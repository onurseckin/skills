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
    <div class="tab-bar">
      <button class="tab-btn active" id="tab-coverage" onclick="switchTab('coverage')">📊 Coverage Matrix</button>
      <button class="tab-btn" id="tab-runtime" onclick="switchTab('runtime')">⚡ Test Runtime Ranking</button>
    </div>

    <!-- Coverage Matrix View -->
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

      <div id="content-view"></div>
    </div>

    <!-- Test Runtime Ranking View -->
    <div id="runtime-section" style="display: none;">
      <!-- Smart Pareto KPI Cards -->
      <div class="runtime-kpi-grid">
        <div class="runtime-kpi-card">
          <div class="kpi-header">
            <span class="kpi-title">Total Duration</span>
            <span class="kpi-icon">⏱️</span>
          </div>
          <div class="kpi-value" id="val-rt-total">0ms</div>
          <div class="kpi-sub" id="sub-rt-total">Across 0 files</div>
        </div>
        <div class="runtime-kpi-card">
          <div class="kpi-header">
            <span class="kpi-title">Avg / Median Latency</span>
            <span class="kpi-icon">⚡</span>
          </div>
          <div class="kpi-value" id="val-rt-avg">0ms</div>
          <div class="kpi-sub" id="sub-rt-avg">Median: 0ms</div>
        </div>
        <div class="runtime-kpi-card">
          <div class="kpi-header">
            <span class="kpi-title">Top 50% Concentration</span>
            <span class="kpi-icon">🎯</span>
          </div>
          <div class="kpi-value" id="val-rt-p50">0 files</div>
          <div class="kpi-sub" id="sub-rt-p50">Accounts for 50% runtime</div>
        </div>
        <div class="runtime-kpi-card">
          <div class="kpi-header">
            <span class="kpi-title">Top 90% Concentration</span>
            <span class="kpi-icon">📈</span>
          </div>
          <div class="kpi-value" id="val-rt-p90">0 files</div>
          <div class="kpi-sub" id="sub-rt-p90">Accounts for 90% runtime</div>
        </div>
        <div class="runtime-kpi-card">
          <div class="kpi-header">
            <span class="kpi-title">Slowest Test File</span>
            <span class="kpi-icon">🚨</span>
          </div>
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

      <div id="runtime-content-view"></div>
    </div>
  </div>

  <script>
${clientScript}
  </script>
</body>
</html>`;
}

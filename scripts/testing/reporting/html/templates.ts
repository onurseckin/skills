export function buildHtmlDocument(styles: string, clientScript: string): string {
  return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Test Coverage Dashboard - @onurseckin/skills</title>
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
      <div class="brand-text">Skills Test Coverage</div>
      <span id="header-badge" class="badge"></span>
    </div>
    <div style="font-size: 0.8rem; color: var(--text-dim); font-family: 'JetBrains Mono', monospace;" id="header-timestamp"></div>
  </header>

  <div class="container">
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
          <div class="metric-title">Total Files</div>
          <div class="metric-value" id="val-files"></div>
          <div class="metric-sub">Across All Units</div>
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

  <script>
${clientScript}
  </script>
</body>
</html>`;
}

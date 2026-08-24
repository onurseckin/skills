/**
 * Modern Interactive HTML Coverage Dashboard Generator
 * Produces a rich, self-contained interactive web application in coverage/index.html
 * with folder drill-down, search, breadcrumbs, and line-by-line source view.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { CoverageSummary, FileCoverageMetric } from "./coverage-generator.ts";

export interface FileDetailData {
  readonly path: string;
  readonly linesPct: number;
  readonly funcsPct: number;
  readonly branchesPct: number;
  readonly linesCovered: number;
  readonly linesTotal: number;
  readonly uncoveredLines: readonly number[];
  readonly sourceLines?: readonly { no: number; code: string; hits?: number }[];
}

export function generateInteractiveHtml(
  fileMap: Map<string, FileCoverageMetric>,
  summary: CoverageSummary,
  repoRoot: string = process.cwd(),
): string {
  const root = resolve(repoRoot);
  const total = summary.total ?? {
    lines: { total: 0, covered: 0, skipped: 0, pct: 100 },
    statements: { total: 0, covered: 0, skipped: 0, pct: 100 },
    functions: { total: 0, covered: 0, skipped: 0, pct: 100 },
    branches: { total: 0, covered: 0, skipped: 0, pct: 100 },
  };

  const filesArray: FileDetailData[] = [];

  for (const [relPath, metric] of fileMap.entries()) {
    const fullPath = join(root, relPath);
    let sourceLines: { no: number; code: string; hits?: number }[] | undefined;

    if (existsSync(fullPath)) {
      try {
        const rawContent = readFileSync(fullPath, "utf-8");
        const rawLines = rawContent.split("\n");
        const uncoveredSet = new Set(metric.uncoveredLines);

        sourceLines = rawLines.map((lineText, idx) => {
          const lineNo = idx + 1;
          const isUncovered = uncoveredSet.has(lineNo);
          const isCovered = !isUncovered && lineText.trim().length > 0;
          return {
            no: lineNo,
            code: lineText,
            hits: isUncovered ? 0 : isCovered ? 1 : undefined,
          };
        });
      } catch {
        sourceLines = undefined;
      }
    }

    filesArray.push({
      path: relPath,
      linesPct: metric.lines.pct,
      funcsPct: metric.functions.pct,
      branchesPct: metric.branches.pct,
      linesCovered: metric.lines.covered,
      linesTotal: metric.lines.total,
      uncoveredLines: metric.uncoveredLines,
      sourceLines,
    });
  }

  const payloadJson = JSON.stringify({
    generatedAt: new Date().toISOString(),
    total,
    files: filesArray,
  }).replace(/<\/script>/gi, "<\\/script>");

  return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Test Coverage Dashboard - @onurseckin/skills</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-primary: #090d16;
      --bg-secondary: #111827;
      --bg-tertiary: #1f2937;
      --border-color: #374151;
      --text-primary: #f9fafb;
      --text-secondary: #9ca3af;
      --text-muted: #6b7280;
      --accent-green: #10b981;
      --accent-yellow: #f59e0b;
      --accent-red: #ef4444;
      --accent-blue: #3b82f6;
      --line-hit-bg: rgba(16, 185, 129, 0.12);
      --line-miss-bg: rgba(239, 68, 68, 0.18);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
      background-color: var(--bg-primary);
      color: var(--text-primary);
      line-height: 1.5;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    header {
      background-color: var(--bg-secondary);
      border-bottom: 1px solid var(--border-color);
      padding: 1rem 1.5rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      position: sticky;
      top: 0;
      z-index: 50;
    }
    .header-title {
      font-size: 1.25rem;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .badge {
      font-size: 0.75rem;
      padding: 0.2rem 0.5rem;
      border-radius: 9999px;
      font-weight: 600;
    }
    .badge-green { background: rgba(16, 185, 129, 0.2); color: #34d399; }
    .badge-yellow { background: rgba(245, 158, 11, 0.2); color: #fbbf24; }
    .badge-red { background: rgba(239, 68, 68, 0.2); color: #f87171; }
    .container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 1.5rem;
      width: 100%;
      flex: 1;
    }
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 1rem;
      margin-bottom: 1.5rem;
    }
    .card {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 0.75rem;
      padding: 1.25rem;
    }
    .card-title {
      font-size: 0.85rem;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-weight: 600;
      margin-bottom: 0.5rem;
    }
    .card-value {
      font-size: 2rem;
      font-weight: 700;
      display: flex;
      align-items: baseline;
      gap: 0.5rem;
    }
    .card-sub {
      font-size: 0.85rem;
      color: var(--text-muted);
      margin-top: 0.25rem;
    }
    .progress-bar-bg {
      background: var(--bg-tertiary);
      border-radius: 9999px;
      height: 6px;
      margin-top: 0.75rem;
      overflow: hidden;
    }
    .progress-bar-fill {
      height: 100%;
      border-radius: 9999px;
      transition: width 0.3s ease;
    }
    .nav-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      margin-bottom: 1rem;
      flex-wrap: wrap;
    }
    .breadcrumbs {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.9rem;
      font-family: 'JetBrains Mono', monospace;
    }
    .crumb-link {
      color: var(--accent-blue);
      cursor: pointer;
      text-decoration: none;
    }
    .crumb-link:hover { text-decoration: underline; }
    .search-input {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 0.5rem;
      padding: 0.5rem 1rem;
      color: var(--text-primary);
      font-size: 0.9rem;
      width: 320px;
    }
    .search-input:focus { outline: 2px solid var(--accent-blue); }
    table {
      width: 100%;
      border-collapse: collapse;
      background: var(--bg-secondary);
      border-radius: 0.75rem;
      overflow: hidden;
      border: 1px solid var(--border-color);
    }
    th, td {
      padding: 0.85rem 1rem;
      text-align: left;
      border-bottom: 1px solid var(--border-color);
    }
    th {
      background: var(--bg-tertiary);
      font-size: 0.8rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-secondary);
    }
    tr:hover td { background: rgba(255, 255, 255, 0.02); }
    .file-name {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.85rem;
      color: var(--text-primary);
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .file-name:hover { color: var(--accent-blue); }
    .code-viewer {
      background: #0d1117;
      border: 1px solid var(--border-color);
      border-radius: 0.75rem;
      overflow-x: auto;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.85rem;
    }
    .code-line {
      display: flex;
      line-height: 1.6;
    }
    .code-line.hit { background: var(--line-hit-bg); }
    .code-line.miss { background: var(--line-miss-bg); }
    .line-no {
      width: 60px;
      padding: 0 0.75rem;
      text-align: right;
      color: var(--text-muted);
      user-select: none;
      border-right: 1px solid var(--border-color);
      background: rgba(0, 0, 0, 0.2);
    }
    .line-hits {
      width: 60px;
      padding: 0 0.5rem;
      text-align: right;
      font-size: 0.75rem;
      user-select: none;
      border-right: 1px solid var(--border-color);
    }
    .line-text {
      padding: 0 1rem;
      white-space: pre;
      flex: 1;
    }
    .btn {
      background: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      color: var(--text-primary);
      padding: 0.4rem 0.8rem;
      border-radius: 0.375rem;
      font-size: 0.85rem;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
    }
    .btn:hover { background: var(--border-color); }
  </style>
</head>
<body>
  <header>
    <div class="header-title">
      <span>🛡️ @onurseckin/skills Coverage Dashboard</span>
      <span id="header-badge" class="badge"></span>
    </div>
    <div style="font-size: 0.85rem; color: var(--text-secondary);" id="header-timestamp"></div>
  </header>

  <div class="container">
    <div class="metrics-grid">
      <div class="card">
        <div class="card-title">Statements & Lines</div>
        <div class="card-value" id="val-lines"></div>
        <div class="card-sub" id="sub-lines"></div>
        <div class="progress-bar-bg"><div class="progress-bar-fill" id="bar-lines"></div></div>
      </div>
      <div class="card">
        <div class="card-title">Functions</div>
        <div class="card-value" id="val-funcs"></div>
        <div class="card-sub" id="sub-funcs"></div>
        <div class="progress-bar-bg"><div class="progress-bar-fill" id="bar-funcs"></div></div>
      </div>
      <div class="card">
        <div class="card-title">Branches</div>
        <div class="card-value" id="val-branches"></div>
        <div class="card-sub" id="sub-branches"></div>
        <div class="progress-bar-bg"><div class="progress-bar-fill" id="bar-branches"></div></div>
      </div>
      <div class="card">
        <div class="card-title">Total Files</div>
        <div class="card-value" id="val-files"></div>
        <div class="card-sub">All TypeScript units</div>
        <div class="progress-bar-bg"><div class="progress-bar-fill" style="width: 100%; background: var(--accent-blue)"></div></div>
      </div>
    </div>

    <div class="nav-bar">
      <div class="breadcrumbs" id="breadcrumbs"></div>
      <input type="text" id="search-box" class="search-input" placeholder="🔍 Search files & folders..." />
    </div>

    <div id="content-view"></div>
  </div>

  <script>
    const DATA = ${payloadJson};
    let currentPath = "";
    let currentFile = null;
    let searchQuery = "";

    function colorForPct(pct) {
      if (pct >= 100) return "var(--accent-green)";
      if (pct >= 80) return "var(--accent-yellow)";
      return "var(--accent-red)";
    }

    function badgeClass(pct) {
      if (pct >= 100) return "badge-green";
      if (pct >= 80) return "badge-yellow";
      return "badge-red";
    }

    function initMetrics() {
      const t = DATA.total;
      document.getElementById("header-timestamp").textContent = "Generated: " + new Date(DATA.generatedAt).toLocaleString();
      
      const linesPct = t.lines.pct;
      const headerBadge = document.getElementById("header-badge");
      headerBadge.textContent = linesPct + "% Coverage";
      headerBadge.className = "badge " + badgeClass(linesPct);

      document.getElementById("val-lines").textContent = t.lines.pct + "%";
      document.getElementById("sub-lines").textContent = t.lines.covered + " / " + t.lines.total + " lines";
      const barLines = document.getElementById("bar-lines");
      barLines.style.width = Math.min(100, t.lines.pct) + "%";
      barLines.style.background = colorForPct(t.lines.pct);

      document.getElementById("val-funcs").textContent = t.functions.pct + "%";
      document.getElementById("sub-funcs").textContent = t.functions.covered + " / " + t.functions.total + " funcs";
      const barFuncs = document.getElementById("bar-funcs");
      barFuncs.style.width = Math.min(100, t.functions.pct) + "%";
      barFuncs.style.background = colorForPct(t.functions.pct);

      document.getElementById("val-branches").textContent = t.branches.pct + "%";
      document.getElementById("sub-branches").textContent = t.branches.covered + " / " + t.branches.total + " branches";
      const barBranches = document.getElementById("bar-branches");
      barBranches.style.width = Math.min(100, t.branches.pct) + "%";
      barBranches.style.background = colorForPct(t.branches.pct);

      document.getElementById("val-files").textContent = DATA.files.length;
    }

    function renderBreadcrumbs() {
      const el = document.getElementById("breadcrumbs");
      el.innerHTML = "";

      const rootCrumb = document.createElement("span");
      rootCrumb.className = "crumb-link";
      rootCrumb.textContent = "root";
      rootCrumb.onclick = () => { currentPath = ""; currentFile = null; render(); };
      el.appendChild(rootCrumb);

      if (currentPath || currentFile) {
        const segments = (currentFile ? currentFile.path : currentPath).split("/").filter(Boolean);
        let accumulated = "";
        segments.forEach((seg, idx) => {
          const sep = document.createElement("span");
          sep.textContent = " / ";
          sep.style.color = "var(--text-muted)";
          el.appendChild(sep);

          accumulated += (accumulated ? "/" : "") + seg;
          const isLast = idx === segments.length - 1;

          if (isLast && currentFile) {
            const leaf = document.createElement("span");
            leaf.textContent = seg;
            leaf.style.fontWeight = "600";
            leaf.style.color = "var(--text-primary)";
            el.appendChild(leaf);
          } else {
            const link = document.createElement("span");
            link.className = "crumb-link";
            link.textContent = seg;
            const target = accumulated;
            link.onclick = () => { currentPath = target; currentFile = null; render(); };
            el.appendChild(link);
          }
        });
      }
    }

    function renderFolderView() {
      const filtered = DATA.files.filter(f => {
        if (searchQuery) return f.path.toLowerCase().includes(searchQuery.toLowerCase());
        if (!currentPath) return true;
        return f.path.startsWith(currentPath + "/");
      });

      // Group into direct folders & files
      const itemsMap = new Map();
      filtered.forEach(f => {
        const relative = currentPath ? f.path.slice(currentPath.length + 1) : f.path;
        const slashIdx = relative.indexOf("/");
        if (slashIdx === -1) {
          itemsMap.set(relative, { type: "file", file: f });
        } else {
          const folderName = relative.slice(0, slashIdx);
          if (!itemsMap.has(folderName)) {
            itemsMap.set(folderName, { type: "folder", name: folderName, files: [] });
          }
          itemsMap.get(folderName).files.push(f);
        }
      });

      let html = '<table><thead><tr><th>Name</th><th>Line Coverage</th><th>Func Coverage</th><th>Branch Coverage</th><th>Uncovered</th></tr></thead><tbody>';

      const sortedKeys = Array.from(itemsMap.keys()).sort((a, b) => {
        const itemA = itemsMap.get(a);
        const itemB = itemsMap.get(b);
        if (itemA.type !== itemB.type) return itemA.type === "folder" ? -1 : 1;
        return a.localeCompare(b);
      });

      sortedKeys.forEach(key => {
        const item = itemsMap.get(key);
        if (item.type === "folder") {
          let totalLines = 0, coveredLines = 0, totalFuncs = 0, coveredFuncs = 0;
          item.files.forEach(f => {
            totalLines += f.linesTotal;
            coveredLines += f.linesCovered;
          });
          const pct = totalLines > 0 ? Math.round((coveredLines / totalLines) * 10000) / 100 : 100;
          const targetFolder = currentPath ? currentPath + "/" + item.name : item.name;

          html += '<tr onclick="openFolder(\\'' + targetFolder + '\\')" style="cursor: pointer;">';
          html += '<td><div class="file-name">📁 ' + item.name + ' <span class="badge" style="background: var(--bg-tertiary); font-size: 0.7rem;">' + item.files.length + ' files</span></div></td>';
          html += '<td><span class="badge ' + badgeClass(pct) + '">' + pct + '%</span> (' + coveredLines + '/' + totalLines + ')</td>';
          html += '<td>-</td><td>-</td><td>-</td></tr>';
        } else {
          const f = item.file;
          const uncov = f.uncoveredLines.length > 0 ? f.uncoveredLines.slice(0, 5).join(", ") + (f.uncoveredLines.length > 5 ? "..." : "") : "None (100%)";
          html += '<tr onclick="openFile(\\'' + f.path + '\\')" style="cursor: pointer;">';
          html += '<td><div class="file-name">📄 ' + key + '</div></td>';
          html += '<td><span class="badge ' + badgeClass(f.linesPct) + '">' + f.linesPct + '%</span> (' + f.linesCovered + '/' + f.linesTotal + ')</td>';
          html += '<td>' + f.funcsPct + '%</td><td>' + f.branchesPct + '%</td><td style="color: var(--text-muted); font-family: monospace; font-size: 0.8rem;">' + uncov + '</td></tr>';
        }
      });

      html += '</tbody></table>';
      document.getElementById("content-view").innerHTML = html;
    }

    function renderFileView() {
      if (!currentFile) return;
      const f = currentFile;
      let html = '<div style="margin-bottom: 1rem; display: flex; gap: 0.5rem; align-items: center;">';
      html += '<button class="btn" onclick="goBack()">&larr; Back to Files</button>';
      if (f.uncoveredLines.length > 0) {
        html += '<button class="btn" onclick="jumpToFirstMiss()" style="border-color: var(--accent-red); color: #f87171;">Jump to First Miss (L' + f.uncoveredLines[0] + ')</button>';
      }
      html += '</div>';

      if (!f.sourceLines) {
        html += '<div class="card">Source code preview unavailable for this file.</div>';
      } else {
        html += '<div class="code-viewer">';
        f.sourceLines.forEach(line => {
          const isMiss = line.hits === 0;
          const isHit = line.hits && line.hits > 0;
          const cls = isMiss ? "miss" : isHit ? "hit" : "";
          const hitsText = isMiss ? "0x" : isHit ? line.hits + "x" : "";
          const hitsColor = isMiss ? "var(--accent-red)" : "var(--accent-green)";

          html += '<div class="code-line ' + cls + '" id="line-' + line.no + '">';
          html += '<div class="line-no">' + line.no + '</div>';
          html += '<div class="line-hits" style="color:' + hitsColor + '">' + hitsText + '</div>';
          html += '<div class="line-text">' + escapeHtml(line.code) + '</div>';
          html += '</div>';
        });
        html += '</div>';
      }

      document.getElementById("content-view").innerHTML = html;
    }

    function escapeHtml(str) {
      return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    function openFolder(folder) {
      currentPath = folder;
      currentFile = null;
      render();
    }

    function openFile(path) {
      const f = DATA.files.find(item => item.path === path);
      if (f) {
        currentFile = f;
        render();
      }
    }

    function goBack() {
      currentFile = null;
      render();
    }

    function jumpToFirstMiss() {
      if (currentFile && currentFile.uncoveredLines.length > 0) {
        const el = document.getElementById("line-" + currentFile.uncoveredLines[0]);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }

    function render() {
      renderBreadcrumbs();
      if (currentFile) {
        renderFileView();
      } else {
        renderFolderView();
      }
    }

    document.getElementById("search-box").addEventListener("input", (e) => {
      searchQuery = e.target.value.trim();
      currentFile = null;
      render();
    });

    initMetrics();
    render();
  </script>
</body>
</html>`;
}

export function writeInteractiveHtml(
  fileMap: Map<string, FileCoverageMetric>,
  summary: CoverageSummary,
  repoRoot: string = process.cwd(),
  coverageDirName: string = "coverage",
): string {
  const root = resolve(repoRoot);
  const outPath = join(root, coverageDirName, "index.html");
  const html = generateInteractiveHtml(fileMap, summary, root);
  writeFileSync(outPath, html, "utf-8");
  return outPath;
}

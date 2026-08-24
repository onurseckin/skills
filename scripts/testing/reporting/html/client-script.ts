/**
 * Coverage Dashboard Client-Side Interactive Script Generator
 * Generates browser-side JavaScript for folder drilldowns, file search, filters,
 * breadcrumbs, sortable metrics tables, code viewer, and line jumping.
 */
export function getClientScript(payloadJson: string): string {
  return `
    const DATA = ${payloadJson};
    let currentPath = "";
    let currentFile = null;
    let searchQuery = "";
    let statusFilter = "all";
    let sortColumn = "name";
    let sortAsc = true;

    function colorForPct(pct) {
      if (pct >= 100) return "var(--status-pass)";
      if (pct >= 80) return "var(--status-warn)";
      return "var(--status-fail)";
    }

    function badgeClass(pct) {
      if (pct >= 100) return "badge-pass";
      if (pct >= 80) return "badge-warn";
      return "badge-fail";
    }

    function createGaugeSvg(pct, color) {
      const radius = 28;
      const circumference = 2 * Math.PI * radius;
      const offset = circumference - (Math.min(100, Math.max(0, pct)) / 100) * circumference;
      return '<svg><circle class="gauge-bg" cx="34" cy="34" r="' + radius + '"></circle><circle class="gauge-fill" cx="34" cy="34" r="' + radius + '" style="stroke:' + color + '; stroke-dasharray:' + circumference + '; stroke-dashoffset:' + offset + '"></circle></svg>';
    }

    function initMetrics() {
      const t = DATA.total;
      document.getElementById("header-timestamp").textContent = new Date(DATA.generatedAt).toLocaleString();
      
      const linesPct = t.lines.pct;
      const headerBadge = document.getElementById("header-badge");
      headerBadge.textContent = linesPct + "% Line Coverage";
      headerBadge.className = "badge " + badgeClass(linesPct);

      document.getElementById("val-lines").textContent = t.lines.pct + "%";
      document.getElementById("sub-lines").textContent = t.lines.covered + " / " + t.lines.total + " lines";
      document.getElementById("gauge-lines").innerHTML = createGaugeSvg(t.lines.pct, colorForPct(t.lines.pct));

      document.getElementById("val-statements").textContent = t.statements.pct + "%";
      document.getElementById("sub-statements").textContent = t.statements.covered + " / " + t.statements.total + " stmts";
      document.getElementById("gauge-statements").innerHTML = createGaugeSvg(t.statements.pct, colorForPct(t.statements.pct));

      document.getElementById("val-funcs").textContent = t.functions.pct + "%";
      document.getElementById("sub-funcs").textContent = t.functions.covered + " / " + t.functions.total + " funcs";
      document.getElementById("gauge-funcs").innerHTML = createGaugeSvg(t.functions.pct, colorForPct(t.functions.pct));

      document.getElementById("val-files").textContent = DATA.files.length;
      document.getElementById("gauge-files").innerHTML = createGaugeSvg(100, "var(--brand-accent)");
    }

    function setFilter(f) {
      statusFilter = f;
      document.querySelectorAll(".filter-btn").forEach(btn => btn.classList.remove("active"));
      document.getElementById("filter-" + f).classList.add("active");
      currentFile = null;
      render();
    }

    function renderBreadcrumbs() {
      const el = document.getElementById("breadcrumbs");
      el.innerHTML = "";

      const rootCrumb = document.createElement("span");
      rootCrumb.className = "crumb-chip" + (!currentPath && !currentFile ? " crumb-active" : "");
      rootCrumb.textContent = "📦 root";
      rootCrumb.onclick = () => { currentPath = ""; currentFile = null; render(); };
      el.appendChild(rootCrumb);

      if (currentPath || currentFile) {
        const segments = (currentFile ? currentFile.path : currentPath).split("/").filter(Boolean);
        let accumulated = "";
        segments.forEach((seg, idx) => {
          const sep = document.createElement("span");
          sep.textContent = "/";
          sep.style.color = "var(--text-dim)";
          el.appendChild(sep);

          accumulated += (accumulated ? "/" : "") + seg;
          const isLast = idx === segments.length - 1;

          if (isLast && currentFile) {
            const leaf = document.createElement("span");
            leaf.textContent = seg;
            leaf.className = "crumb-chip crumb-active";
            el.appendChild(leaf);
          } else {
            const link = document.createElement("span");
            link.className = "crumb-chip" + (isLast && !currentFile ? " crumb-active" : "");
            link.textContent = seg;
            const target = accumulated;
            link.onclick = () => { currentPath = target; currentFile = null; render(); };
            el.appendChild(link);
          }
        });
      }
    }

    function renderFolderView() {
      let filtered = DATA.files.filter(f => {
        if (searchQuery && !f.path.toLowerCase().includes(searchQuery.toLowerCase())) return false;
        if (statusFilter === "miss" && f.linesPct >= 100) return false;
        if (statusFilter === "perfect" && f.linesPct < 100) return false;
        if (!currentPath) return true;
        return f.path.startsWith(currentPath + "/");
      });

      const itemsMap = new Map();
      filtered.forEach(f => {
        const relative = currentPath ? f.path.slice(currentPath.length + 1) : f.path;
        const slashIdx = relative.indexOf("/");
        if (slashIdx === -1) {
          itemsMap.set(relative, { type: "file", name: relative, file: f });
        } else {
          const folderName = relative.slice(0, slashIdx);
          if (!itemsMap.has(folderName)) {
            itemsMap.set(folderName, { type: "folder", name: folderName, files: [] });
          }
          itemsMap.get(folderName).files.push(f);
        }
      });

      let html = '<table><thead><tr>';
      html += '<th onclick="setSort(\\'name\\')">Name ' + (sortColumn === 'name' ? (sortAsc ? '▲' : '▼') : '') + '</th>';
      html += '<th onclick="setSort(\\'lines\\')">Lines ' + (sortColumn === 'lines' ? (sortAsc ? '▲' : '▼') : '') + '</th>';
      html += '<th onclick="setSort(\\'statements\\')">Statements ' + (sortColumn === 'statements' ? (sortAsc ? '▲' : '▼') : '') + '</th>';
      html += '<th onclick="setSort(\\'funcs\\')">Functions ' + (sortColumn === 'funcs' ? (sortAsc ? '▲' : '▼') : '') + '</th>';
      html += '<th>Uncovered Lines</th>';
      html += '</tr></thead><tbody>';

      const items = Array.from(itemsMap.values());
      items.sort((a, b) => {
        if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
        let valA = a.name, valB = b.name;
        if (sortColumn === "lines") {
          valA = a.type === "file" ? a.file.linesPct : getFolderLinesPct(a);
          valB = b.type === "file" ? b.file.linesPct : getFolderLinesPct(b);
        } else if (sortColumn === "statements") {
          valA = a.type === "file" ? a.file.statementsPct : getFolderLinesPct(a);
          valB = b.type === "file" ? b.file.statementsPct : getFolderLinesPct(b);
        } else if (sortColumn === "funcs") {
          valA = a.type === "file" ? a.file.funcsPct : getFolderFuncsPct(a);
          valB = b.type === "file" ? b.file.funcsPct : getFolderFuncsPct(b);
        }
        if (valA < valB) return sortAsc ? -1 : 1;
        if (valA > valB) return sortAsc ? 1 : -1;
        return a.name.localeCompare(b.name);
      });

      items.forEach(item => {
        if (item.type === "folder") {
          let totalLines = 0, coveredLines = 0, totalFuncs = 0, coveredFuncs = 0;
          let totalStmts = 0, coveredStmts = 0;
          item.files.forEach(f => {
            totalLines += f.linesTotal;
            coveredLines += f.linesCovered;
            totalStmts += f.statementsTotal;
            coveredStmts += f.statementsCovered;
            totalFuncs += f.funcsTotal;
            coveredFuncs += f.funcsCovered;
          });
          const linePct = totalLines > 0 ? Math.round((coveredLines / totalLines) * 10000) / 100 : 100;
          const stmtPct = totalStmts > 0 ? Math.round((coveredStmts / totalStmts) * 10000) / 100 : 100;
          const fnPct = totalFuncs > 0 ? Math.round((coveredFuncs / totalFuncs) * 10000) / 100 : 100;
          const targetFolder = currentPath ? currentPath + "/" + item.name : item.name;

          html += '<tr onclick="openFolder(\\'' + targetFolder + '\\')" style="cursor: pointer;">';
          html += '<td><div class="item-name">📁 <strong>' + item.name + '</strong> <span class="badge badge-neutral">' + item.files.length + ' files</span></div></td>';
          html += '<td><span class="badge ' + badgeClass(linePct) + '">' + linePct + '%</span> (' + coveredLines + '/' + totalLines + ')<div class="mini-progress"><div class="mini-progress-fill" style="width:' + linePct + '%; background:' + colorForPct(linePct) + '"></div></div></td>';
          html += '<td><span class="badge ' + badgeClass(stmtPct) + '">' + stmtPct + '%</span> (' + coveredStmts + '/' + totalStmts + ')</td>';
          html += '<td><span class="badge ' + badgeClass(fnPct) + '">' + fnPct + '%</span> (' + coveredFuncs + '/' + totalFuncs + ')</td>';
          html += '<td><span style="color: var(--text-dim); font-size: 0.8rem;">' + (item.files.filter(f => f.linesPct < 100).length) + ' files missing 100%</span></td>';
          html += '</tr>';
        } else {
          const f = item.file;
          const uncov = f.uncoveredLines.length > 0 
            ? f.uncoveredLines.slice(0, 6).join(", ") + (f.uncoveredLines.length > 6 ? ' (+' + (f.uncoveredLines.length - 6) + ')' : '')
            : '<span style="color: var(--status-pass); font-weight: 600;">None (100%)</span>';

          html += '<tr onclick="openFile(\\'' + f.path + '\\')" style="cursor: pointer;">';
          html += '<td><div class="item-name">📄 ' + item.name + '</div></td>';
          html += '<td><span class="badge ' + badgeClass(f.linesPct) + '">' + f.linesPct + '%</span> (' + f.linesCovered + '/' + f.linesTotal + ')<div class="mini-progress"><div class="mini-progress-fill" style="width:' + f.linesPct + '%; background:' + colorForPct(f.linesPct) + '"></div></div></td>';
          html += '<td><span class="badge ' + badgeClass(f.statementsPct) + '">' + f.statementsPct + '%</span> (' + f.statementsCovered + '/' + f.statementsTotal + ')</td>';
          html += '<td><span class="badge ' + badgeClass(f.funcsPct) + '">' + f.funcsPct + '%</span> (' + f.funcsCovered + '/' + f.funcsTotal + ')</td>';
          html += '<td style="font-family: \\'JetBrains Mono\\', monospace; font-size: 0.8rem; color: #f87171;">' + uncov + '</td>';
          html += '</tr>';
        }
      });

      html += '</tbody></table>';
      document.getElementById("content-view").innerHTML = html;
    }

    function getFolderLinesPct(folder) {
      let t = 0, c = 0;
      folder.files.forEach(f => { t += f.linesTotal; c += f.linesCovered; });
      return t > 0 ? (c / t) * 100 : 100;
    }
    function getFolderFuncsPct(folder) {
      let t = 0, c = 0;
      folder.files.forEach(f => { t += f.funcsTotal; c += f.funcsCovered; });
      return t > 0 ? (c / t) * 100 : 100;
    }

    function setSort(col) {
      if (sortColumn === col) {
        sortAsc = !sortAsc;
      } else {
        sortColumn = col;
        sortAsc = true;
      }
      render();
    }

    function renderFileView() {
      if (!currentFile) return;
      const f = currentFile;
      let html = '<div class="file-viewer-header">';
      html += '<div style="display: flex; gap: 0.75rem; align-items: center;">';
      html += '<button class="btn" onclick="goBack()">&larr; Back to Tree</button>';
      html += '<div style="font-family: \\'JetBrains Mono\\', monospace; font-weight: 600;">' + f.path + '</div>';
      html += '</div>';
      html += '<div style="display: flex; gap: 0.5rem; align-items: center;">';
      html += '<span class="badge ' + badgeClass(f.linesPct) + '">Lines: ' + f.linesPct + '%</span>';
      html += '<span class="badge ' + badgeClass(f.statementsPct) + '">Statements: ' + f.statementsPct + '%</span>';
      html += '<span class="badge ' + badgeClass(f.funcsPct) + '">Funcs: ' + f.funcsPct + '%</span>';
      html += '<button class="btn" onclick="copyPath(\\'' + f.path + '\\')">📋 Copy</button>';
      html += '</div>';
      html += '</div>';

      if (f.uncoveredLines.length > 0) {
        html += '<div class="missed-chips-bar">';
        html += '<span style="font-size: 0.8rem; font-weight: 700; color: #f87171;">⚠️ ' + f.uncoveredLines.length + ' UNCOVERED LINES:</span>';
        f.uncoveredLines.forEach(lineNo => {
          html += '<button class="miss-chip" onclick="jumpToLine(' + lineNo + ')">L' + lineNo + '</button>';
        });
        html += '</div>';
      }

      if (!f.sourceLines) {
        html += '<div class="metric-card">Source code content is not available on disk.</div>';
      } else {
        html += '<div class="code-container">';
        f.sourceLines.forEach(line => {
          const isExec = line.isExecutable;
          const isMiss = isExec && line.hits === 0;
          const isHit = isExec && line.hits && line.hits > 0;
          const cls = isMiss ? "miss" : isHit ? "hit" : "neutral";
          const hitsText = isMiss ? "0x" : isHit ? line.hits + "x" : "";
          const hitsColor = isMiss ? "var(--status-fail)" : "var(--status-pass)";

          html += '<div class="code-line ' + cls + '" id="line-' + line.no + '">';
          html += '<div class="line-num">' + line.no + '</div>';
          html += '<div class="line-hits" style="color:' + hitsColor + '">' + hitsText + '</div>';
          html += '<div class="line-content">' + escapeHtml(line.code) + '</div>';
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

    function jumpToLine(lineNo) {
      const el = document.getElementById("line-" + lineNo);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.style.outline = "2px solid var(--status-fail)";
        setTimeout(() => { el.style.outline = "none"; }, 1800);
      }
    }

    function copyPath(p) {
      navigator.clipboard.writeText(p);
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
  `.trim();
}

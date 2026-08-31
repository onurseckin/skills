export function getClientScriptHelpers(): string {
  return `
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
      html += '<div style="font-family: \\'JetBrains Mono\\', monospace; font-weight: 600;">' + escapeHtml(f.path) + '</div>';
      html += '</div>';
      html += '<div style="display: flex; gap: 0.5rem; align-items: center;">';
      html += '<span class="badge ' + badgeClass(f.linesPct) + '">Lines: ' + f.linesPct + '%</span>';
      html += '<span class="badge ' + badgeClass(f.statementsPct) + '">Statements: ' + f.statementsPct + '%</span>';
      html += '<span class="badge ' + badgeClass(f.funcsPct) + '">Funcs: ' + f.funcsPct + '%</span>';
      html += '<button class="btn" onclick="copyPath(\\'' + escapeHtml(f.path) + '\\')">📋 Copy</button>';
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

      const cView = document.getElementById("content-view");
      if (cView) cView.innerHTML = html;
    }

    function escapeHtml(str) {
      if (typeof str !== "string") return "";
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
      if (navigator && navigator.clipboard) {
        navigator.clipboard.writeText(p);
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

    const searchEl = document.getElementById("search-box");
    if (searchEl) {
      searchEl.addEventListener("input", (e) => {
        searchQuery = e.target.value.trim();
        currentFile = null;
        render();
      });
    }

    const rtSearchEl = document.getElementById("runtime-search-box");
    if (rtSearchEl) {
      rtSearchEl.addEventListener("input", (e) => {
        runtimeSearch = e.target.value.trim();
        runtimePage = 1;
        renderRuntimeView();
      });
    }

    initMetrics();
    render();
  `;
}

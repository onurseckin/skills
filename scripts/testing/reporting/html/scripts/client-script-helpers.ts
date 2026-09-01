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
      html += '<div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">';
      html += '<span class="badge ' + badgeClass(f.linesPct) + '">Lines: ' + f.linesPct + '%</span>';
      html += '<span class="badge ' + badgeClass(f.statementsPct) + '">Statements: ' + f.statementsPct + '%</span>';
      html += '<span class="badge ' + badgeClass(f.funcsPct) + '">Funcs: ' + f.funcsPct + '%</span>';
      if (f.testFile) {
        const durText = f.testDurationMs !== undefined ? f.testDurationMs + 'ms' : 'Telemetry';
        html += '<a href="#runtime?file=' + encodeURIComponent(f.testFile) + '" class="badge badge-neutral" style="text-decoration: none; cursor: pointer;" title="View test runtime ranking">Test: ' + durText + '</a>';
      }
      html += '<button class="btn" data-path="' + escapeHtml(f.path) + '" onclick="copyPath(this.dataset.path)">Copy</button>';
      html += '</div>';
      html += '</div>';

      if (f.uncoveredLines.length > 0) {
        html += '<div class="missed-chips-bar">';
        html += '<span style="font-size: 0.8rem; font-weight: 700; color: #f87171;">' + f.uncoveredLines.length + ' UNCOVERED LINES:</span>';
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
          html += '<div class="line-num" data-path="' + escapeHtml(f.path) + '" data-line="' + line.no + '" onclick="selectLine(this.dataset.path, parseInt(this.dataset.line, 10))" style="cursor: pointer;" title="Click to copy link to Line ' + line.no + '">' + line.no + '</div>';
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
      updateHash(folder ? '#coverage/' + folder : '#coverage');
      render();
    }

    function openFile(path, lineNo) {
      const f = DATA.files.find(item => item.path === path);
      if (f) {
        currentFile = f;
        const hash = '#coverage/' + path + (lineNo ? ':L' + lineNo : '');
        updateHash(hash);
        if (activeTab !== "coverage") {
          switchTab("coverage");
        } else {
          render();
        }
        if (lineNo) {
          setTimeout(() => jumpToLine(lineNo), 50);
        }
      }
    }

    function goBack() {
      currentFile = null;
      updateHash(currentPath ? '#coverage/' + currentPath : '#coverage');
      render();
    }

    function jumpToLine(lineNo) {
      if (currentFile) {
        updateHash('#coverage/' + currentFile.path + ':L' + lineNo);
      }
      const el = document.getElementById("line-" + lineNo);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.style.outline = "2px solid var(--status-fail)";
        el.style.backgroundColor = "rgba(239, 68, 68, 0.15)";
        setTimeout(() => {
          el.style.outline = "none";
          el.style.backgroundColor = "";
        }, 2000);
      }
    }

    function selectLine(path, lineNo) {
      const hash = '#coverage/' + path + ':L' + lineNo;
      updateHash(hash);
      jumpToLine(lineNo);
      if (navigator && navigator.clipboard) {
        const fullUrl = window.location.origin + window.location.pathname + hash;
        navigator.clipboard.writeText(fullUrl);
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
        updateHash(searchQuery ? "#coverage?search=" + encodeURIComponent(searchQuery) : "#coverage");
        render();
      });
    }

    const rtSearchEl = document.getElementById("runtime-search-box");
    if (rtSearchEl) {
      rtSearchEl.addEventListener("input", (e) => {
        runtimeSearch = e.target.value.trim();
        runtimePage = 1;
        updateHash(runtimeSearch ? "#runtime?search=" + encodeURIComponent(runtimeSearch) : "#runtime");
        renderRuntimeView();
      });
    }

    const uniSearchEl = document.getElementById("unified-search-box");
    if (uniSearchEl) {
      uniSearchEl.addEventListener("input", (e) => {
        unifiedSearch = e.target.value.trim();
        updateHash(unifiedSearch ? "#unified?search=" + encodeURIComponent(unifiedSearch) : "#unified");
        renderUnifiedView();
      });
    }

    const defSearchEl = document.getElementById("deficit-search-box");
    if (defSearchEl) {
      defSearchEl.addEventListener("input", (e) => {
        deficitSearch = e.target.value.trim();
        deficitPage = 1;
        const qs = [];
        if (deficitCategoryFilter !== "all") qs.push("category=" + encodeURIComponent(deficitCategoryFilter));
        if (deficitSearch) qs.push("search=" + encodeURIComponent(deficitSearch));
        updateHash(qs.length > 0 ? "#deficits?" + qs.join("&") : "#deficits");
        renderDeficitView();
      });
    }
  `;
}

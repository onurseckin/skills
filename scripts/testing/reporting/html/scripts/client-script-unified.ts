export function getClientScriptUnified(): string {
  return `
    let currentDensity = "comfortable";
    let expandedFolders = new Set(["", "root", "scripts", "src", "tests"]);
    let unifiedSortCol = "path";
    let unifiedSortAsc = true;
    let unifiedFilter = "all";
    let unifiedSearch = "";

    function setDensity(mode) {
      currentDensity = mode;
      document.body.className = "density-" + mode;
      document.querySelectorAll(".density-btn").forEach(b => b.classList.remove("active"));
      const btn = document.getElementById("btn-density-" + mode);
      if (btn) btn.classList.add("active");
    }

    function initUnifiedMetrics() {
      if (!DATA.tree) return;
      const t = DATA.total;
      const r = DATA.runtime;

      const valHealth = document.getElementById("val-uni-health");
      const subHealth = document.getElementById("sub-uni-health");
      if (valHealth) valHealth.textContent = t.lines.pct + "%";
      if (subHealth) subHealth.textContent = "Stmts " + t.statements.pct + "% | Funcs " + t.functions.pct + "%";

      const valDur = document.getElementById("val-uni-duration");
      const subDur = document.getElementById("sub-uni-duration");
      if (valDur) valDur.textContent = r ? r.totalDurationMs + "ms" : "N/A";
      if (subDur) subDur.textContent = r ? r.totalFiles + " test files executed" : "No telemetry";

      const valPareto = document.getElementById("val-uni-pareto");
      const subPareto = document.getElementById("sub-uni-pareto");
      if (valPareto) valPareto.textContent = r ? r.pareto50.fileCount + " / " + r.pareto90.fileCount : "N/A";
      if (subPareto) subPareto.textContent = r ? "P50 (50% time) / P90 (90% time)" : "No telemetry";

      const valStatus = document.getElementById("val-uni-status");
      const subStatus = document.getElementById("sub-uni-status");
      let failCount = 0, passCount = 0;
      if (r && r.files) {
        r.files.forEach(f => { if (f.passed === false) failCount++; else passCount++; });
      }
      if (valStatus) valStatus.textContent = failCount > 0 ? failCount + " Failing" : "100% Passing";
      if (subStatus) subStatus.textContent = passCount + " passed" + (failCount > 0 ? ", " + failCount + " failed" : "");
    }

    function toggleUnifiedFolder(path) {
      if (expandedFolders.has(path)) {
        expandedFolders.delete(path);
      } else {
        expandedFolders.add(path);
      }
      renderUnifiedView();
    }

    function expandAllFolders() {
      function collect(n) {
        if (n.type === "dir") {
          expandedFolders.add(n.path);
          if (n.children) n.children.forEach(collect);
        }
      }
      if (DATA.tree) collect(DATA.tree);
      renderUnifiedView();
    }

    function collapseAllFolders() {
      expandedFolders.clear();
      expandedFolders.add("");
      expandedFolders.add("root");
      renderUnifiedView();
    }

    function setUnifiedFilter(f) {
      unifiedFilter = f;
      document.querySelectorAll(".filter-uni-btn").forEach(b => b.classList.remove("active"));
      const btn = document.getElementById("filter-uni-" + f);
      if (btn) btn.classList.add("active");
      updateHash(f === "all" ? "#unified" : "#unified?filter=" + f);
      renderUnifiedView();
    }

    function setUnifiedSort(col) {
      if (unifiedSortCol === col) {
        unifiedSortAsc = !unifiedSortAsc;
      } else {
        unifiedSortCol = col;
        unifiedSortAsc = col === "path" || col === "name";
      }
      renderUnifiedView();
    }

    function nodeMatchesFilter(n) {
      if (unifiedFilter === "miss") return n.lines.pct < 100;
      if (unifiedFilter === "perfect") return n.lines.pct >= 100;
      if (unifiedFilter === "slow") return n.paretoClass === "p50" || n.paretoClass === "p90";
      if (unifiedFilter === "failing") return n.testPassed === false;
      return true;
    }

    function nodeMatchesSearch(n) {
      if (!unifiedSearch) return true;
      const q = unifiedSearch.toLowerCase();
      if (n.name.toLowerCase().includes(q) || n.path.toLowerCase().includes(q)) return true;
      if (n.testFile && n.testFile.toLowerCase().includes(q)) return true;
      return false;
    }

    function nodeHasMatchingDescendants(n) {
      if (nodeMatchesFilter(n) && nodeMatchesSearch(n)) return true;
      if (n.children) {
        for (let i = 0; i < n.children.length; i++) {
          if (nodeHasMatchingDescendants(n.children[i])) return true;
        }
      }
      return false;
    }

    function sortUnifiedChildren(children) {
      return [...children].sort((a, b) => {
        if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
        let vA = a.name, vB = b.name;
        if (unifiedSortCol === "lines") { vA = a.lines.pct; vB = b.lines.pct; }
        else if (unifiedSortCol === "statements") { vA = a.statements.pct; vB = b.statements.pct; }
        else if (unifiedSortCol === "funcs") { vA = a.functions.pct; vB = b.functions.pct; }
        else if (unifiedSortCol === "duration") { vA = a.testDurationMs || 0; vB = b.testDurationMs || 0; }
        if (typeof vA === "number" && typeof vB === "number") {
          return unifiedSortAsc ? vA - vB : vB - vA;
        }
        return unifiedSortAsc ? String(vA).localeCompare(String(vB)) : String(vB).localeCompare(String(vA));
      });
    }

    function renderUnifiedNodeRow(n, depth) {
      if (!nodeHasMatchingDescendants(n)) return "";

      const isDir = n.type === "dir";
      const isExpanded = expandedFolders.has(n.path) || (unifiedSearch !== "" || unifiedFilter !== "all");
      let html = '<tr class="tree-row ' + (isDir ? 'tree-row-dir' : 'tree-row-file') + '">';

      // Name column with tree depth and expander
      html += '<td><div class="tree-cell-name">';
      for (let i = 0; i < depth; i++) {
        html += '<span class="tree-indent-space"></span>';
      }

      if (isDir) {
        const arrow = isExpanded ? '&#9660;' : '&#9654;';
        html += '<span class="tree-expander" data-path="' + escapeHtml(n.path) + '" onclick="event.stopPropagation(); toggleUnifiedFolder(this.dataset.path)">' + arrow + '</span>';
        html += '<span data-path="' + escapeHtml(n.path) + '" onclick="toggleUnifiedFolder(this.dataset.path)" style="cursor:pointer; font-weight: 600;">' + escapeHtml(n.name) + '</span>';
        if (n.children) {
          html += ' <span class="badge badge-neutral" style="font-size: 0.7rem; margin-left: 4px;">' + n.children.length + '</span>';
        }
      } else {
        html += '<span class="tree-expander-leaf"></span>';
        html += '<span data-path="' + escapeHtml(n.path) + '" onclick="openFile(this.dataset.path)" style="cursor:pointer; color: var(--text-main);">' + escapeHtml(n.name) + '</span>';
      }
      html += '</div></td>';

      // Lines Coverage
      html += '<td><span class="badge ' + badgeClass(n.lines.pct) + '">' + n.lines.pct + '%</span> (' + n.lines.covered + '/' + n.lines.total + ')<div class="mini-progress"><div class="mini-progress-fill" style="width:' + n.lines.pct + '%; background:' + colorForPct(n.lines.pct) + '"></div></div></td>';
      // Statements Coverage
      html += '<td><span class="badge ' + badgeClass(n.statements.pct) + '">' + n.statements.pct + '%</span> (' + n.statements.covered + '/' + n.statements.total + ')</td>';
      // Functions Coverage
      html += '<td><span class="badge ' + badgeClass(n.functions.pct) + '">' + n.functions.pct + '%</span> (' + n.functions.covered + '/' + n.functions.total + ')</td>';

      // Test Latency & Pareto Badge
      html += '<td><div class="test-telemetry-cell">';
      if (n.testDurationMs !== undefined) {
        const roundedDur = Math.round(n.testDurationMs * 100) / 100;
        if (n.testFile) {
          html += '<a href="#runtime?file=' + encodeURIComponent(n.testFile) + '" style="text-decoration: none; font-family: monospace; font-weight: 700; color: var(--text-main);" title="Jump to runtime ranking">' + roundedDur + 'ms</a>';
        } else {
          html += '<span style="font-family: monospace; font-weight: 700; color: var(--text-main);">' + roundedDur + 'ms</span>';
        }
        if (n.paretoClass === "p50") {
          html += '<span class="badge badge-p50" title="Top 50% Latency Hotspot">P50</span>';
        } else if (n.paretoClass === "p90") {
          html += '<span class="badge badge-p90" title="Top 90% Latency Hotspot">P90</span>';
        } else if (n.paretoClass === "normal") {
          html += '<span class="badge badge-pnormal">Fast</span>';
        }
      } else {
        html += '<span style="color: var(--text-dim);">-</span>';
      }
      html += '</div></td>';

      // Test Status
      html += '<td>';
      if (n.testPassed === false) {
        html += '<span class="badge badge-fail">FAIL</span>';
      } else if (n.testPassed === true) {
        html += '<span class="badge badge-pass">PASS</span>';
      } else {
        html += '<span style="color: var(--text-dim);">-</span>';
      }
      html += '</td>';

      // Uncovered Lines
      html += '<td>';
      if (!isDir) {
        if (n.uncoveredLines.length > 0) {
          const preview = n.uncoveredLines.slice(0, 4).join(", ") + (n.uncoveredLines.length > 4 ? ' (+' + (n.uncoveredLines.length - 4) + ')' : '');
          html += '<span style="font-family: \\'JetBrains Mono\\', monospace; font-size: 0.78rem; color: #f87171;">' + preview + '</span>';
        } else {
          html += '<span style="color: var(--status-pass); font-weight: 600; font-size: 0.78rem;">100% Perfect</span>';
        }
      } else {
        html += '<span style="color: var(--text-dim); font-size: 0.78rem;">-</span>';
      }
      html += '</td>';

      html += '</tr>';

      // Render children if directory and expanded
      if (isDir && isExpanded && n.children) {
        const sorted = sortUnifiedChildren(n.children);
        sorted.forEach(child => {
          html += renderUnifiedNodeRow(child, depth + 1);
        });
      }

      return html;
    }

    function renderUnifiedView() {
      if (!DATA.tree) return;
      initUnifiedMetrics();

      let html = '<div class="tree-table-wrapper"><table class="unified-tree-table"><thead><tr>';
      html += '<th data-sort="path" onclick="setUnifiedSort(this.dataset.sort)">Hierarchy Path ' + (unifiedSortCol === 'path' ? (unifiedSortAsc ? '▲' : '▼') : '') + '</th>';
      html += '<th data-sort="lines" onclick="setUnifiedSort(this.dataset.sort)">Lines ' + (unifiedSortCol === 'lines' ? (unifiedSortAsc ? '▲' : '▼') : '') + '</th>';
      html += '<th data-sort="statements" onclick="setUnifiedSort(this.dataset.sort)">Statements ' + (unifiedSortCol === 'statements' ? (unifiedSortAsc ? '▲' : '▼') : '') + '</th>';
      html += '<th data-sort="funcs" onclick="setUnifiedSort(this.dataset.sort)">Functions ' + (unifiedSortCol === 'funcs' ? (unifiedSortAsc ? '▲' : '▼') : '') + '</th>';
      html += '<th data-sort="duration" onclick="setUnifiedSort(this.dataset.sort)">Duration & Hotspot ' + (unifiedSortCol === 'duration' ? (unifiedSortAsc ? '▲' : '▼') : '') + '</th>';
      html += '<th>Status</th>';
      html += '<th>Uncovered Lines</th>';
      html += '</tr></thead><tbody>';

      if (DATA.tree.children && DATA.tree.children.length > 0) {
        const sortedRoots = sortUnifiedChildren(DATA.tree.children);
        sortedRoots.forEach(c => {
          html += renderUnifiedNodeRow(c, 0);
        });
      } else {
        html += '<tr><td colspan="7" style="text-align: center; color: var(--text-dim); padding: 2rem;">No files or hierarchy nodes available.</td></tr>';
      }

      html += '</tbody></table></div>';

      const uniView = document.getElementById("unified-content-view");
      if (uniView) uniView.innerHTML = html;
    }
  `;
}

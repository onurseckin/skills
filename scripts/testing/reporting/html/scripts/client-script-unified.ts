export function getClientScriptUnified(): string {
  return `
    function nodeMatchesFilter(n) {
      if (masterFilter === "miss") return n.lines.pct < 100;
      if (masterFilter === "deficits") return n.uncoveredLines && n.uncoveredLines.length > 0;
      if (masterFilter === "slow") return n.paretoClass === "p50" || n.paretoClass === "p90";
      if (masterFilter === "perfect") return n.lines.pct >= 100;
      return true;
    }

    function nodeMatchesSearch(n) {
      if (!masterSearch) return true;
      const q = masterSearch;
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
        if (sortCol === "lines") { vA = a.lines.pct; vB = b.lines.pct; }
        else if (sortCol === "funcs") { vA = a.functions.pct; vB = b.functions.pct; }
        else if (sortCol === "duration") { vA = a.testDurationMs || 0; vB = b.testDurationMs || 0; }
        else if (sortCol === "deficits") { vA = a.uncoveredLines ? a.uncoveredLines.length : 0; vB = b.uncoveredLines ? b.uncoveredLines.length : 0; }
        if (typeof vA === "number" && typeof vB === "number") {
          return sortAsc ? vA - vB : vB - vA;
        }
        return sortAsc ? String(vA).localeCompare(String(vB)) : String(vB).localeCompare(String(vA));
      });
    }

    function renderTreeNodeRow(n, depth) {
      if (!nodeHasMatchingDescendants(n)) return "";

      const isDir = n.type === "dir";
      const isExpanded = expandedFolders.has(n.path) || (masterSearch !== "" || masterFilter !== "all");
      let html = '<tr class="tree-row ' + (isDir ? 'tree-row-dir' : 'tree-row-file') + '">';

      // Path Column
      html += '<td><div class="tree-cell-name">';
      for (let i = 0; i < depth; i++) {
        html += '<span class="tree-indent-space"></span>';
      }

      if (isDir) {
        const arrow = isExpanded ? '&#9660;' : '&#9654;';
        html += '<span class="tree-expander" data-path="' + escapeHtml(n.path) + '" onclick="event.stopPropagation(); toggleFolder(this.dataset.path)">' + arrow + '</span>';
        html += '<span data-path="' + escapeHtml(n.path) + '" onclick="toggleFolder(this.dataset.path)" style="cursor:pointer; font-weight: 600; color: var(--text-main);">' + escapeHtml(n.name) + '</span>';
        if (n.children) {
          html += ' <span class="badge badge-neutral" style="font-size: 0.7rem; margin-left: 4px;">' + n.children.length + ' files</span>';
        }
      } else {
        html += '<span class="tree-expander-leaf"></span>';
        html += '<span data-path="' + escapeHtml(n.path) + '" onclick="openFile(this.dataset.path)" style="cursor:pointer; color: var(--text-main); font-family: monospace; font-weight: 500;" onmouseover="this.style.textDecoration=\\'underline\\'" onmouseout="this.style.textDecoration=\\'none\\'">' + escapeHtml(n.name) + '</span>';
      }
      html += '</div></td>';

      // Lines Coverage
      html += '<td><span class="badge ' + badgeClass(n.lines.pct) + '">' + n.lines.pct + '%</span> <span style="font-size: 0.8rem; color: var(--text-dim);">(' + n.lines.covered + '/' + n.lines.total + ')</span><div class="mini-progress"><div class="mini-progress-fill" style="width:' + n.lines.pct + '%; background:' + colorForPct(n.lines.pct) + '"></div></div></td>';
      
      // Functions Coverage
      html += '<td><span class="badge ' + badgeClass(n.functions.pct) + '">' + n.functions.pct + '%</span> <span style="font-size: 0.8rem; color: var(--text-dim);">(' + n.functions.covered + '/' + n.functions.total + ')</span></td>';

      // Test Latency & Pareto Badge
      html += '<td><div class="test-telemetry-cell">';
      if (n.testDurationMs !== undefined) {
        const roundedDur = Math.round(n.testDurationMs * 100) / 100;
        html += '<span style="font-family: monospace; font-weight: 700; color: var(--text-main);">' + roundedDur + 'ms</span>';
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

      // Deficits & Misses
      html += '<td>';
      if (!isDir) {
        const missCount = n.lines.total - n.lines.covered;
        if (missCount > 0) {
          html += '<span style="font-family: monospace; color: var(--status-fail); font-weight: 700; font-size: 0.82rem;">' + missCount + ' missed</span>';
        } else {
          html += '<span style="color: var(--status-pass); font-weight: 600; font-size: 0.8rem;">100% Perfect</span>';
        }
      } else {
        const missCount = n.lines.total - n.lines.covered;
        html += '<span style="color: var(--text-dim); font-size: 0.8rem;">' + (missCount > 0 ? missCount + ' missed lines' : 'All covered') + '</span>';
      }
      html += '</td>';

      // Action
      html += '<td>';
      if (!isDir) {
        html += '<button class="tree-action-btn" data-path="' + escapeHtml(n.path) + '" onclick="openFile(this.dataset.path)" style="cursor: pointer;">Inspect</button>';
      } else {
        html += '<span style="color: var(--text-dim); font-size: 0.75rem;">-</span>';
      }
      html += '</td>';

      html += '</tr>';

      if (isDir && isExpanded && n.children) {
        const sorted = sortUnifiedChildren(n.children);
        sorted.forEach(child => {
          html += renderTreeNodeRow(child, depth + 1);
        });
      }

      return html;
    }

    function renderFlatFiles() {
      let filtered = DATA.files.filter(f => {
        if (masterSearch && !f.path.toLowerCase().includes(masterSearch) && !(f.testFile && f.testFile.toLowerCase().includes(masterSearch))) return false;
        if (masterFilter === "miss" && f.linesPct >= 100) return false;
        if (masterFilter === "deficits" && (!f.uncoveredLines || f.uncoveredLines.length === 0)) return false;
        if (masterFilter === "slow" && f.paretoClass !== "p50" && f.paretoClass !== "p90") return false;
        if (masterFilter === "perfect" && f.linesPct < 100) return false;
        return true;
      });

      filtered.sort((a, b) => {
        let vA = a.path, vB = b.path;
        if (sortCol === "lines") { vA = a.linesPct; vB = b.linesPct; }
        else if (sortCol === "funcs") { vA = a.funcsPct; vB = b.funcsPct; }
        else if (sortCol === "duration") { vA = a.testDurationMs || 0; vB = b.testDurationMs || 0; }
        else if (sortCol === "deficits") { vA = a.uncoveredLines ? a.uncoveredLines.length : 0; vB = b.uncoveredLines ? b.uncoveredLines.length : 0; }
        if (typeof vA === "number" && typeof vB === "number") {
          return sortAsc ? vA - vB : vB - vA;
        }
        return sortAsc ? String(vA).localeCompare(String(vB)) : String(vB).localeCompare(String(vA));
      });

      let html = "";
      filtered.forEach(f => {
        html += '<tr class="tree-row tree-row-file">';
        html += '<td><div class="tree-cell-name"><span data-path="' + escapeHtml(f.path) + '" onclick="openFile(this.dataset.path)" style="cursor:pointer; color: var(--text-main); font-family: monospace; font-weight: 500;" onmouseover="this.style.textDecoration=\\'underline\\'" onmouseout="this.style.textDecoration=\\'none\\'">' + escapeHtml(f.path) + '</span></div></td>';
        html += '<td><span class="badge ' + badgeClass(f.linesPct) + '">' + f.linesPct + '%</span> <span style="font-size: 0.8rem; color: var(--text-dim);">(' + f.linesCovered + '/' + f.linesTotal + ')</span><div class="mini-progress"><div class="mini-progress-fill" style="width:' + f.linesPct + '%; background:' + colorForPct(f.linesPct) + '"></div></div></td>';
        html += '<td><span class="badge ' + badgeClass(f.funcsPct) + '">' + f.funcsPct + '%</span> <span style="font-size: 0.8rem; color: var(--text-dim);">(' + f.funcsCovered + '/' + f.funcsTotal + ')</span></td>';
        html += '<td><div class="test-telemetry-cell">';
        if (f.testDurationMs !== undefined) {
          const rounded = Math.round(f.testDurationMs * 100) / 100;
          html += '<span style="font-family: monospace; font-weight: 700; color: var(--text-main);">' + rounded + 'ms</span>';
          if (f.paretoClass === "p50") html += '<span class="badge badge-p50">P50</span>';
          else if (f.paretoClass === "p90") html += '<span class="badge badge-p90">P90</span>';
          else if (f.paretoClass === "normal") html += '<span class="badge badge-pnormal">Fast</span>';
        } else {
          html += '<span style="color: var(--text-dim);">-</span>';
        }
        html += '</div></td>';
        html += '<td>';
        const miss = f.linesTotal - f.linesCovered;
        if (miss > 0) {
          html += '<span style="font-family: monospace; color: var(--status-fail); font-weight: 700; font-size: 0.82rem;">' + miss + ' missed</span>';
        } else {
          html += '<span style="color: var(--status-pass); font-weight: 600; font-size: 0.8rem;">100% Perfect</span>';
        }
        html += '</td>';
        html += '<td><button class="tree-action-btn" data-path="' + escapeHtml(f.path) + '" onclick="openFile(this.dataset.path)" style="cursor: pointer;">Inspect</button></td>';
        html += '</tr>';
      });

      if (filtered.length === 0) {
        html += '<tr><td colspan="6" style="text-align: center; color: var(--text-dim); padding: 2rem;">No production files matched the selected criteria.</td></tr>';
      }

      return html;
    }

    function renderMasterTable() {
      const container = document.getElementById("master-table-container");
      if (!container) return;

      let html = '<table class="unified-tree-table"><thead><tr>';
      html += '<th data-sort="path" onclick="setMasterSort(this.dataset.sort)">' + (viewMode === "tree" ? "Hierarchy Path" : "Production File Path") + ' ' + (sortCol === 'path' ? (sortAsc ? '▲' : '▼') : '') + '</th>';
      html += '<th data-sort="lines" onclick="setMasterSort(this.dataset.sort)">Lines Coverage ' + (sortCol === 'lines' ? (sortAsc ? '▲' : '▼') : '') + '</th>';
      html += '<th data-sort="funcs" onclick="setMasterSort(this.dataset.sort)">Functions Coverage ' + (sortCol === 'funcs' ? (sortAsc ? '▲' : '▼') : '') + '</th>';
      html += '<th data-sort="duration" onclick="setMasterSort(this.dataset.sort)">Runtime Duration ' + (sortCol === 'duration' ? (sortAsc ? '▲' : '▼') : '') + '</th>';
      html += '<th data-sort="deficits" onclick="setMasterSort(this.dataset.sort)">Deficits & Misses ' + (sortCol === 'deficits' ? (sortAsc ? '▲' : '▼') : '') + '</th>';
      html += '<th style="width: 100px;">Action</th>';
      html += '</tr></thead><tbody>';

      if (viewMode === "tree") {
        if (DATA.tree && DATA.tree.children && DATA.tree.children.length > 0) {
          const sortedRoots = sortUnifiedChildren(DATA.tree.children);
          sortedRoots.forEach(c => {
            html += renderTreeNodeRow(c, 0);
          });
        } else {
          html += '<tr><td colspan="6" style="text-align: center; color: var(--text-dim); padding: 2rem;">No hierarchy tree available.</td></tr>';
        }
      } else {
        html += renderFlatFiles();
      }

      html += '</tbody></table>';
      container.innerHTML = html;

      const summaryText = document.getElementById("table-summary-text");
      if (summaryText) {
        summaryText.textContent = "Displaying " + DATA.files.length + " production files (" + (DATA.runtime ? DATA.runtime.totalFiles : 1864) + " unit tests)";
      }
    }
  `;
}

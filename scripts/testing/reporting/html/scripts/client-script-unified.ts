import { getClientScriptDeficits } from "./client-script-deficits.ts";

export function getClientScriptUnified(): string {
  return `
    function nodeMatchesFilter(n) {
      if (masterFilter === "miss") return (n.lines ? n.lines.pct < 100 : (n.linesPct !== undefined ? n.linesPct < 100 : true));
      if (masterFilter === "deficits") {
        const miss = n.lines ? (n.lines.total - n.lines.covered) : (n.linesTotal ? (n.linesTotal - n.linesCovered) : 0);
        return (n.uncoveredLines && n.uncoveredLines.length > 0) || miss > 0 || (n.deficitCount && n.deficitCount > 0);
      }
      if (masterFilter === "error-handling" || masterFilter === "branching" || masterFilter === "initialization" || masterFilter === "unexercised-logic") {
        return (n.deficitCategories && n.deficitCategories.includes(masterFilter));
      }
      if (masterFilter === "slow") return n.paretoClass === "p50" || n.paretoClass === "p90";
      if (masterFilter === "perfect") return (n.lines ? n.lines.pct >= 100 : (n.linesPct !== undefined ? n.linesPct >= 100 : true));
      return true;
    }

    function nodeMatchesSearch(n) {
      if (!masterSearch) return true;
      const q = masterSearch;
      if (n.name && n.name.toLowerCase().includes(q)) return true;
      if (n.path && n.path.toLowerCase().includes(q)) return true;
      if (n.testFile && n.testFile.toLowerCase().includes(q)) return true;
      if (n.deficitCategories && n.deficitCategories.some(c => c.toLowerCase().includes(q))) return true;
      if (n.deficitClusters && n.deficitClusters.some(c => (c.categoryReason && c.categoryReason.toLowerCase().includes(q)) || (c.sampleCodeSnippet && c.sampleCodeSnippet.toLowerCase().includes(q)))) return true;
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

    function getNodeMetricVal(n, col) {
      if (col === "lines") return n.lines ? n.lines.pct : (n.linesPct !== undefined ? n.linesPct : 0);
      if (col === "funcs") return n.functions ? n.functions.pct : (n.funcsPct !== undefined ? n.funcsPct : 0);
      if (col === "duration") return n.testDurationMs || 0;
      if (col === "deficits") {
        if (n.maxRepoGainPct !== undefined && n.maxRepoGainPct > 0) return n.maxRepoGainPct;
        if (n.deficitCount !== undefined && n.deficitCount > 0) return n.deficitCount;
        if (n.uncoveredLines && n.uncoveredLines.length > 0) return n.uncoveredLines.length;
        if (n.lines) return n.lines.total - n.lines.covered;
        if (n.linesTotal !== undefined && n.linesCovered !== undefined) return n.linesTotal - n.linesCovered;
        return 0;
      }
      return n.path || n.name || "";
    }

    function sortUnifiedItems(items) {
      return [...items].sort((a, b) => {
        let vA = getNodeMetricVal(a, sortCol);
        let vB = getNodeMetricVal(b, sortCol);
        if (typeof vA === "number" && typeof vB === "number") {
          if (vA !== vB) return sortAsc ? vA - vB : vB - vA;
          return (a.path || a.name || "").localeCompare(b.path || b.name || "");
        }
        return sortAsc ? String(vA).localeCompare(String(vB)) : String(vB).localeCompare(String(vA));
      });
    }

    function renderCoverageBar(pct, covered, total, unit) {
      const safePct = typeof pct === "number" ? pct : 0;
      const covFormatted = (covered || 0).toLocaleString();
      const totFormatted = (total || 0).toLocaleString();
      const fillCls = safePct >= 100 ? "cov-bar-fill-pass" : safePct >= 80 ? "cov-bar-fill-warn" : "cov-bar-fill-fail";
      const clamped = Math.min(100, Math.max(0, safePct));
      return '<div class="cov-bar-cell">' +
        '<div class="cov-bar-counts">' + covFormatted + ' / ' + totFormatted + ' ' + unit + '</div>' +
        '<div class="cov-bar-track">' +
          '<div class="cov-bar-fill ' + fillCls + '" style="width:' + clamped + '%;"></div>' +
          '<span class="cov-bar-text">' + safePct + '%</span>' +
        '</div>' +
      '</div>';
    }

    function renderTableRow(item, isDir, indent) {
      let html = '<tr class="tree-row ' + (isDir ? 'tree-row-dir' : 'tree-row-file') + '">';
      html += '<td><div class="tree-cell-name">';
      for (let i = 0; i < (indent || 0); i++) html += '<span class="tree-indent-space"></span>';
      if (isDir) {
        if (indent !== undefined) {
          const isExp = expandedFolders.has(item.path);
          html += '<span class="tree-expander" data-path="' + escapeHtml(item.path) + '" onclick="event.stopPropagation(); toggleFolder(this.dataset.path)">' + (isExp ? '&#9660;' : '&#9654;') + '</span>';
        } else {
          html += '<span style="color: var(--text-dim); margin-right: 4px;">📁</span>';
        }
        const clickFn = indent !== undefined ? 'toggleFolder(this.dataset.path)' : 'void(0)';
        html += '<span data-path="' + escapeHtml(item.path) + '" onclick="' + clickFn + '" style="cursor:pointer; font-weight: 600; color: var(--text-main); font-family: monospace;">' + escapeHtml(indent !== undefined ? item.name : item.path) + '</span>';
        if (item.children) html += ' <span class="badge badge-neutral" style="font-size: 0.7rem; margin-left: 4px;">' + item.children.length + ' items</span>';
      } else {
        if (indent !== undefined) html += '<span class="tree-expander-leaf"></span>';
        else html += '<span style="color: var(--text-dim); margin-right: 4px;">📄</span>';
        const displayName = indent !== undefined ? item.name : item.path;
        html += '<span data-path="' + escapeHtml(item.path) + '" onclick="openFile(this.dataset.path)" style="cursor:pointer; color: var(--text-main); font-family: monospace; font-weight: 500;" onmouseover="this.style.textDecoration=\\'underline\\'" onmouseout="this.style.textDecoration=\\'none\\'">' + escapeHtml(displayName) + '</span>';
      }
      html += '</div></td>';

      const lPct = item.lines ? item.lines.pct : (item.linesPct !== undefined ? item.linesPct : 0);
      const lCov = item.lines ? item.lines.covered : (item.linesCovered || 0);
      const lTot = item.lines ? item.lines.total : (item.linesTotal || 0);
      const fPct = item.functions ? item.functions.pct : (item.funcsPct !== undefined ? item.funcsPct : 0);
      const fCov = item.functions ? item.functions.covered : (item.funcsCovered || 0);
      const fTot = item.functions ? item.functions.total : (item.funcsTotal || 0);
      html += '<td>' + renderCoverageBar(lPct, lCov, lTot, 'lines') + '</td>';
      html += '<td>' + renderCoverageBar(fPct, fCov, fTot, 'funcs') + '</td>';

      html += '<td><div class="test-telemetry-cell">';
      if (item.testDurationMs !== undefined) {
        html += '<span style="font-family: monospace; font-weight: 700; color: var(--text-main);">' + (Math.round(item.testDurationMs * 100) / 100) + 'ms</span>';
        if (item.paretoClass === "p50") html += '<span class="badge badge-p50" title="Top 50% Latency Hotspot">P50</span>';
        else if (item.paretoClass === "p90") html += '<span class="badge badge-p90" title="Top 90% Latency Hotspot">P90</span>';
        else if (item.paretoClass === "normal") html += '<span class="badge badge-pnormal">Fast</span>';
      } else {
        html += '<span style="color: var(--text-dim);">-</span>';
      }
      html += '</div></td>';

      html += '<td>' + renderDeficitCell(item) + '</td>';
      html += '<td>' + (!isDir ? '<button class="tree-action-btn" data-path="' + escapeHtml(item.path) + '" onclick="openFile(this.dataset.path)" style="cursor: pointer;">Inspect</button>' : '<span style="color: var(--text-dim); font-size: 0.75rem;">Folder</span>') + '</td>';
      html += '</tr>';
      return html;
    }

    function renderTreeNodeRow(n, depth) {
      if (!nodeHasMatchingDescendants(n)) return "";
      const isDir = n.type === "dir";
      let html = renderTableRow(n, isDir, depth);
      if (isDir && expandedFolders.has(n.path) && n.children) {
        sortUnifiedItems(n.children).forEach(child => {
          html += renderTreeNodeRow(child, depth + 1);
        });
      }
      return html;
    }

    function collectMatchingNodes(node, outList) {
      if (!node) return;
      if (node.path && nodeMatchesFilter(node) && nodeMatchesSearch(node)) {
        outList.push(node);
      }
      if (node.children) {
        for (let i = 0; i < node.children.length; i++) {
          collectMatchingNodes(node.children[i], outList);
        }
      }
    }

    function renderRankedTreeNodes() {
      const matching = [];
      if (DATA.tree) collectMatchingNodes(DATA.tree, matching);
      const sorted = sortUnifiedItems(matching);
      if (sorted.length === 0) {
        return '<tr><td colspan="6" style="text-align: center; color: var(--text-dim); padding: 2.5rem;">No files or folders matched the active filter.</td></tr>';
      }
      return sorted.map(n => renderTableRow(n, n.type === "dir", undefined)).join("");
    }

    function renderFlatFiles() {
      const filtered = DATA.files.filter(f => {
        if (masterSearch && !f.path.toLowerCase().includes(masterSearch) && !(f.testFile && f.testFile.toLowerCase().includes(masterSearch))) return false;
        if (masterFilter === "miss" && f.linesPct >= 100) return false;
        if (masterFilter === "deficits" && (!f.uncoveredLines || f.uncoveredLines.length === 0) && (f.linesTotal - f.linesCovered <= 0)) return false;
        if ((masterFilter === "error-handling" || masterFilter === "branching" || masterFilter === "initialization" || masterFilter === "unexercised-logic") && (!f.deficitCategories || !f.deficitCategories.includes(masterFilter))) return false;
        if (masterFilter === "slow" && f.paretoClass !== "p50" && f.paretoClass !== "p90") return false;
        if (masterFilter === "perfect" && f.linesPct < 100) return false;
        return true;
      });
      const sorted = sortUnifiedItems(filtered);
      if (sorted.length === 0) {
        return '<tr><td colspan="6" style="text-align: center; color: var(--text-dim); padding: 2.5rem;">No production files matched the selected criteria.</td></tr>';
      }
      return sorted.map(f => renderTableRow(f, false, undefined)).join("");
    }

    function renderMasterTable() {
      const container = document.getElementById("master-table-container");
      if (!container) return;

      if (viewMode === "deficits") {
        const treeBar = document.getElementById("tree-actions-bar");
        if (treeBar) treeBar.style.display = "none";
        container.innerHTML = renderDeficitView();
        const summaryText = document.getElementById("table-summary-text");
        if (summaryText) {
          const cCount = (DATA.deficits && DATA.deficits.clusters) ? DATA.deficits.clusters.length : 0;
          summaryText.textContent = "Displaying " + cCount + " prioritized deficit clusters";
        }
        return;
      }

      const isFilterActive = (masterFilter !== "all" || masterSearch !== "");
      const treeBar = document.getElementById("tree-actions-bar");
      if (treeBar) {
        treeBar.style.display = (viewMode === "tree" && !isFilterActive) ? "flex" : "none";
      }

      let html = '<table class="unified-tree-table"><thead><tr>';
      const pathColTitle = (viewMode === "tree" && !isFilterActive) ? "Hierarchy Path" : (viewMode === "tree" ? "Ranked Item Path" : "Production File Path");
      html += '<th data-sort="path" onclick="setMasterSort(this.dataset.sort)">' + pathColTitle + ' ' + (sortCol === 'path' ? (sortAsc ? '▲' : '▼') : '') + '</th>';
      html += '<th data-sort="lines" onclick="setMasterSort(this.dataset.sort)">Lines Coverage ' + (sortCol === 'lines' ? (sortAsc ? '▲' : '▼') : '') + '</th>';
      html += '<th data-sort="funcs" onclick="setMasterSort(this.dataset.sort)">Functions Coverage ' + (sortCol === 'funcs' ? (sortAsc ? '▲' : '▼') : '') + '</th>';
      html += '<th data-sort="duration" onclick="setMasterSort(this.dataset.sort)">Runtime Duration ' + (sortCol === 'duration' ? (sortAsc ? '▲' : '▼') : '') + '</th>';
      html += '<th data-sort="deficits" onclick="setMasterSort(this.dataset.sort)">Deficits & Misses ' + (sortCol === 'deficits' ? (sortAsc ? '▲' : '▼') : '') + '</th>';
      html += '<th style="width: 100px;">Action</th>';
      html += '</tr></thead><tbody>';

      if (viewMode === "tree") {
        if (isFilterActive) {
          html += renderRankedTreeNodes();
        } else {
          if (DATA.tree && DATA.tree.children && DATA.tree.children.length > 0) {
            const sortedRoots = sortUnifiedItems(DATA.tree.children);
            sortedRoots.forEach(c => {
              html += renderTreeNodeRow(c, 0);
            });
          } else {
            html += '<tr><td colspan="6" style="text-align: center; color: var(--text-dim); padding: 2rem;">No hierarchy tree available.</td></tr>';
          }
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

    ${getClientScriptDeficits()}
  `;
}

import { getClientScriptDeficits } from "./client-script-deficits.ts";

export function getClientScriptUnified(): string {
  return `
    function nodeMatchesFilter(n) {
      const lPct = n.lines ? n.lines.pct : (n.linesPct !== undefined ? n.linesPct : 0);
      const lTot = n.lines ? n.lines.total : (n.linesTotal !== undefined ? n.linesTotal : 0);
      const lCov = n.lines ? n.lines.covered : (n.linesCovered !== undefined ? n.linesCovered : 0);
      const miss = lTot - lCov;
      const dCount = n.deficitCount !== undefined ? n.deficitCount : (n.deficitClusters ? n.deficitClusters.length : 0);
      const pClass = n.paretoClass;
      if (masterFilter === "miss") return lPct < 100;
      if (masterFilter === "deficits") return (n.uncoveredLines && n.uncoveredLines.length > 0) || miss > 0 || dCount > 0;
      if (masterFilter === "error-handling" || masterFilter === "branching" || masterFilter === "initialization" || masterFilter === "unexercised-logic") {
        return Boolean(n.deficitCategories && n.deficitCategories.includes(masterFilter));
      }
      if (masterFilter === "slow") return pClass === "p50" || pClass === "p90";
      if (masterFilter === "perfect") return lPct >= 100;
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
      if (col === "duration") return typeof n.testDurationMs === "number" ? n.testDurationMs : -1;
      if (col === "deficits") {
        const dCount = n.deficitCount !== undefined ? n.deficitCount : (n.deficitClusters ? n.deficitClusters.length : 0);
        if (dCount > 0) return dCount;
        if (n.maxRepoGainPct !== undefined && n.maxRepoGainPct > 0) return n.maxRepoGainPct;
        if (n.uncoveredLines && n.uncoveredLines.length > 0) return n.uncoveredLines.length;
        const lTot = n.lines ? n.lines.total : (n.linesTotal !== undefined ? n.linesTotal : 0);
        const lCov = n.lines ? n.lines.covered : (n.linesCovered !== undefined ? n.linesCovered : 0);
        return Math.max(0, lTot - lCov);
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
        const strA = String(vA || "");
        const strB = String(vB || "");
        return sortAsc ? strA.localeCompare(strB) : strB.localeCompare(strA);
      });
    }

    function renderCoverageBar(pct, covered, total, unit) {
      const safePct = typeof pct === "number" ? pct : 0;
      const fillCls = safePct >= 100 ? "cov-bar-fill-pass" : safePct >= 80 ? "cov-bar-fill-warn" : "cov-bar-fill-fail";
      const clamped = Math.min(100, Math.max(0, safePct));
      return '<div class="cov-bar-cell">' +
        '<div class="cov-bar-counts">' + (covered || 0).toLocaleString() + ' / ' + (total || 0).toLocaleString() + ' ' + unit + '</div>' +
        '<div class="cov-bar-track"><div class="cov-bar-fill ' + fillCls + '" style="width:' + clamped + '%;"></div><span class="cov-bar-text">' + safePct + '%</span></div>' +
      '</div>';
    }

    function renderTableRow(node, isDir, indent) {
      const rowClick = isDir ? 'toggleFolderRow(\\'' + escapeJs(node.path) + '\\', event)' : 'openCodeViewer(\\'' + escapeJs(node.path) + '\\', event)';
      let html = '<tr class="tree-row ' + (isDir ? 'tree-row-dir' : 'tree-row-file') + '" onclick="' + rowClick + '" style="cursor: pointer;">';
      html += '<td><div class="tree-cell-name">';
      for (let i = 0; i < (indent || 0); i++) html += '<span class="tree-indent-space"></span>';
      if (isDir) {
        if (indent !== undefined) {
          const isExp = expandedFolders.has(node.path);
          html += '<span class="tree-expander" data-path="' + escapeHtml(node.path) + '" onclick="event.stopPropagation(); toggleFolderRow(\\'' + escapeJs(node.path) + '\\', event)">' + (isExp ? '&#9660;' : '&#9654;') + '</span>';
        } else {
          html += '<span style="color: var(--text-dim); margin-right: 4px;">📁</span>';
        }
        const clickFn = indent !== undefined ? 'event.stopPropagation(); toggleFolderRow(\\'' + escapeJs(node.path) + '\\', event)' : 'void(0)';
        html += '<span data-path="' + escapeHtml(node.path) + '" onclick="' + clickFn + '" style="cursor:pointer; font-weight: 600; color: var(--text-main); font-family: monospace;">' + escapeHtml(indent !== undefined ? node.name : node.path) + '</span>';
        if (node.children) html += ' <span class="badge badge-neutral" style="font-size: 0.7rem; margin-left: 4px;">' + node.children.length + ' items</span>';
      } else {
        if (indent !== undefined) html += '<span class="tree-expander-leaf"></span>';
        else html += '<span style="color: var(--text-dim); margin-right: 4px;">📄</span>';
        const displayName = indent !== undefined ? node.name : node.path;
        html += '<span data-path="' + escapeHtml(node.path) + '" onclick="event.stopPropagation(); openCodeViewer(\\'' + escapeJs(node.path) + '\\', event)" style="cursor:pointer; color: var(--text-main); font-family: monospace; font-weight: 500;" onmouseover="this.style.textDecoration=\\'underline\\'" onmouseout="this.style.textDecoration=\\'none\\'">' + escapeHtml(displayName) + '</span>';
      }
      html += '</div></td>';

      const lPct = node.lines ? node.lines.pct : (node.linesPct !== undefined ? node.linesPct : 0);
      const lCov = node.lines ? node.lines.covered : (node.linesCovered || 0);
      const lTot = node.lines ? node.lines.total : (node.linesTotal || 0);
      const fPct = node.functions ? node.functions.pct : (node.funcsPct !== undefined ? node.funcsPct : 0);
      const fCov = node.functions ? node.functions.covered : (node.funcsCovered || 0);
      const fTot = node.functions ? node.functions.total : (node.funcsTotal || 0);
      html += '<td>' + renderCoverageBar(lPct, lCov, lTot, 'lines') + '</td>';
      html += '<td>' + renderCoverageBar(fPct, fCov, fTot, 'funcs') + '</td>';

      html += '<td><div class="test-telemetry-cell">';
      if (node.testDurationMs !== undefined) {
        html += '<span style="font-family: monospace; font-weight: 700; color: var(--text-main);">' + (Math.round(node.testDurationMs * 100) / 100) + 'ms</span>';
        if (node.paretoClass === "p50") html += '<span class="badge badge-p50" title="Top 50% Latency Hotspot">P50</span>';
        else if (node.paretoClass === "p90") html += '<span class="badge badge-p90" title="Top 90% Latency Hotspot">P90</span>';
        else if (node.paretoClass === "normal") html += '<span class="badge badge-pnormal">Fast</span>';
        if (node.testPassed === false) html += '<span class="badge badge-fail" style="font-size:0.7rem; padding: 0.1rem 0.35rem;">FAIL</span>';
        else if (node.testPassed === true) html += '<span class="badge badge-pass" style="font-size:0.7rem; padding: 0.1rem 0.35rem;">PASS</span>';
      } else {
        html += '<span style="color: var(--text-dim);">-</span>';
      }
      html += '</div></td>';

      html += '<td>' + renderDeficitCell(node) + '</td>';
      html += '<td>' + (!isDir ? '<button class="tree-action-btn" data-path="' + escapeHtml(node.path) + '" onclick="event.stopPropagation(); openCodeViewer(\\'' + escapeJs(node.path) + '\\', event)" style="cursor: pointer;">Inspect</button>' : '<span style="color: var(--text-dim); font-size: 0.75rem;">Folder</span>') + '</td>';
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
      if (node.path && nodeMatchesFilter(node) && nodeMatchesSearch(node)) outList.push(node);
      if (node.children) {
        for (let i = 0; i < node.children.length; i++) collectMatchingNodes(node.children[i], outList);
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

    function renderFlatPagination(totalItems) {
      const totalPages = Math.max(1, Math.ceil(totalItems / flatPageSize));
      if (totalItems === 0) return "";
      let html = '<div class="flat-pagination-bar">';
      const startCount = (flatCurrentPage - 1) * flatPageSize + 1;
      const endCount = Math.min(flatCurrentPage * flatPageSize, totalItems);
      html += '<div class="flat-pagination-info">Showing <strong>' + startCount.toLocaleString() + ' - ' + endCount.toLocaleString() + '</strong> of <strong>' + totalItems.toLocaleString() + '</strong> files</div>';
      html += '<div class="flat-pagination-controls">';
      html += '<button class="flat-page-btn flat-page-prev" ' + (flatCurrentPage <= 1 ? 'disabled' : '') + ' onclick="changeFlatPage(' + (flatCurrentPage - 1) + ')">&larr; Prev</button>';

      const maxButtons = 5;
      let startPage = Math.max(1, flatCurrentPage - 2);
      let endPage = Math.min(totalPages, startPage + maxButtons - 1);
      if (endPage - startPage < maxButtons - 1) startPage = Math.max(1, endPage - maxButtons + 1);

      if (startPage > 1) {
        html += '<button class="flat-page-btn" onclick="changeFlatPage(1)">1</button>';
        if (startPage > 2) html += '<span class="flat-page-ellipsis">...</span>';
      }
      for (let p = startPage; p <= endPage; p++) {
        html += '<button class="flat-page-btn ' + (p === flatCurrentPage ? 'active' : '') + '" onclick="changeFlatPage(' + p + ')">' + p + '</button>';
      }
      if (endPage < totalPages) {
        if (endPage < totalPages - 1) html += '<span class="flat-page-ellipsis">...</span>';
        html += '<button class="flat-page-btn" onclick="changeFlatPage(' + totalPages + ')">' + totalPages + '</button>';
      }

      html += '<span class="flat-page-pill">Page ' + flatCurrentPage + ' of ' + totalPages + ' (' + totalItems.toLocaleString() + ' total files)</span>' +
        '<button class="flat-page-btn flat-page-next" ' + (flatCurrentPage >= totalPages ? 'disabled' : '') + ' onclick="changeFlatPage(' + (flatCurrentPage + 1) + ')">Next &rarr;</button></div></div>';
      return html;
    }

    function renderFlatFiles() {
      const filtered = (DATA.files || []).filter(f => nodeMatchesFilter(f) && nodeMatchesSearch(f));
      const sorted = sortUnifiedItems(filtered);
      if (sorted.length === 0) {
        return '<tr><td colspan="6" style="text-align: center; color: var(--text-dim); padding: 2.5rem;">No production files matched the selected criteria.</td></tr>';
      }
      const totalPages = Math.max(1, Math.ceil(sorted.length / flatPageSize));
      if (flatCurrentPage > totalPages) flatCurrentPage = totalPages;
      if (flatCurrentPage < 1) flatCurrentPage = 1;
      const pageItems = sorted.slice((flatCurrentPage - 1) * flatPageSize, flatCurrentPage * flatPageSize);
      return pageItems.map(f => renderTableRow(f, false, undefined)).join("");
    }

    function renderMasterTable() {
      const container = document.getElementById("master-table-container");
      if (!container) return;

      const summaryText = document.getElementById("table-summary-text");
      const treeBar = document.getElementById("tree-actions-bar");
      const isFilterActive = (masterFilter !== "all" || masterSearch !== "");

      if (viewMode === "deficits") {
        if (treeBar) treeBar.style.display = "none";
        container.innerHTML = renderDeficitView();
        if (summaryText) {
          const cCount = (DATA.deficits && DATA.deficits.clusters) ? DATA.deficits.clusters.length : 0;
          summaryText.textContent = "Displaying " + cCount.toLocaleString() + " prioritized deficit clusters";
        }
        return;
      }

      if (treeBar) {
        treeBar.style.display = "flex";
        const showTree = (viewMode === "tree" && !isFilterActive) ? "" : "none";
        const btnExp = document.getElementById("btn-expand-all");
        const btnCol = document.getElementById("btn-collapse-all");
        if (btnExp) btnExp.style.display = showTree;
        if (btnCol) btnCol.style.display = showTree;
      }

      let html = '<table class="unified-tree-table"><thead><tr>';
      const pathColTitle = (viewMode === "tree" && !isFilterActive) ? "Hierarchy Path" : (viewMode === "tree" ? "Ranked Item Path" : "Production File Path");
      html += '<th data-sort="path" onclick="setMasterSort(this.dataset.sort)">' + pathColTitle + ' ' + (sortCol === 'path' ? (sortAsc ? '▲' : '▼') : '') + '</th>' +
        '<th data-sort="lines" onclick="setMasterSort(this.dataset.sort)">Lines Coverage ' + (sortCol === 'lines' ? (sortAsc ? '▲' : '▼') : '') + '</th>' +
        '<th data-sort="funcs" onclick="setMasterSort(this.dataset.sort)">Functions Coverage ' + (sortCol === 'funcs' ? (sortAsc ? '▲' : '▼') : '') + '</th>' +
        '<th data-sort="duration" onclick="setMasterSort(this.dataset.sort)">Runtime Duration ' + (sortCol === 'duration' ? (sortAsc ? '▲' : '▼') : '') + '</th>' +
        '<th data-sort="deficits" onclick="setMasterSort(this.dataset.sort)">Deficits & Misses ' + (sortCol === 'deficits' ? (sortAsc ? '▲' : '▼') : '') + '</th>' +
        '<th style="width: 100px;">Action</th></tr></thead><tbody>';

      const totalFiles = DATA.files ? DATA.files.length : 0;
      const totalTests = (DATA.runtime && typeof DATA.runtime.totalFiles === "number") ? DATA.runtime.totalFiles : (DATA.files ? (new Set(DATA.files.map(f => f.testFile).filter(Boolean)).size) : 0);

      if (viewMode === "tree") {
        if (isFilterActive) {
          html += renderRankedTreeNodes();
          if (summaryText) {
            const matching = [];
            if (DATA.tree) collectMatchingNodes(DATA.tree, matching);
            const mTests = new Set(matching.map(n => n.testFile).filter(Boolean)).size;
            summaryText.textContent = "Displaying " + matching.length.toLocaleString() + " of " + totalFiles.toLocaleString() + " items (" + mTests.toLocaleString() + " unit tests)";
          }
        } else {
          if (DATA.tree && DATA.tree.children && DATA.tree.children.length > 0) {
            const sortedRoots = sortUnifiedItems(DATA.tree.children);
            sortedRoots.forEach(c => {
              html += renderTreeNodeRow(c, 0);
            });
          } else {
            html += '<tr><td colspan="6" style="text-align: center; color: var(--text-dim); padding: 2rem;">No hierarchy tree available.</td></tr>';
          }
          if (summaryText) {
            summaryText.textContent = "Displaying " + totalFiles.toLocaleString() + " files (" + totalTests.toLocaleString() + " unit tests)";
          }
        }
      } else {
        const filtered = (DATA.files || []).filter(f => nodeMatchesFilter(f) && nodeMatchesSearch(f));
        html += renderFlatFiles();
        if (summaryText) {
          const fTests = new Set(filtered.map(f => f.testFile).filter(Boolean)).size;
          if (isFilterActive || filtered.length < totalFiles) {
            summaryText.textContent = "Displaying " + filtered.length.toLocaleString() + " of " + totalFiles.toLocaleString() + " files (" + fTests.toLocaleString() + " unit tests)";
          } else {
            summaryText.textContent = "Displaying " + totalFiles.toLocaleString() + " files (" + totalTests.toLocaleString() + " unit tests)";
          }
        }
      }

      html += '</tbody></table>';
      if (viewMode === "flat") {
        const filtered = (DATA.files || []).filter(f => nodeMatchesFilter(f) && nodeMatchesSearch(f));
        html += renderFlatPagination(filtered.length);
      }
      container.innerHTML = html;
    }

    ${getClientScriptDeficits()}
  `;
}

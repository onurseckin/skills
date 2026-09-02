export function getClientScriptDeficits(): string {
  return `
    let deficitCategoryFilter = "all";
    let deficitSearch = "";
    let deficitSortCol = "repoGain";
    let deficitSortAsc = false;
    let deficitPage = 1;
    const deficitPageSize = 50;

    function initDeficitMetrics() {
      if (!DATA.deficits) return;
      const d = DATA.deficits;
      const b = d.categoryBreakdown || {};

      const linesByCat = {
        "error-handling": 0,
        "branching": 0,
        "initialization": 0,
        "unexercised-logic": 0,
      };
      if (d.clusters) {
        d.clusters.forEach(c => {
          if (linesByCat[c.category] !== undefined) {
            linesByCat[c.category] += c.lineCount;
          }
        });
      }

      const valUncov = document.getElementById("val-def-uncovered");
      const subUncov = document.getElementById("sub-def-uncovered");
      if (valUncov) valUncov.textContent = d.totalUncoveredLines;
      if (subUncov) subUncov.textContent = "Across " + (d.totalRepoLines || 0) + " repo lines";

      const valClust = document.getElementById("val-def-clusters");
      const subClust = document.getElementById("sub-def-clusters");
      if (valClust) valClust.textContent = d.totalClusters;
      if (subClust) subClust.textContent = "Contiguous segments";

      const valErr = document.getElementById("val-def-error");
      const subErr = document.getElementById("sub-def-error");
      if (valErr) valErr.textContent = (b["error-handling"] || 0) + " clusters";
      if (subErr) subErr.textContent = (linesByCat["error-handling"] || 0) + " missed lines";

      const valBranch = document.getElementById("val-def-branching");
      const subBranch = document.getElementById("sub-def-branching");
      if (valBranch) valBranch.textContent = (b.branching || 0) + " clusters";
      if (subBranch) subBranch.textContent = (linesByCat.branching || 0) + " missed lines";

      const valInit = document.getElementById("val-def-init");
      const subInit = document.getElementById("sub-def-init");
      if (valInit) valInit.textContent = (b.initialization || 0) + " clusters";
      if (subInit) subInit.textContent = (linesByCat.initialization || 0) + " missed lines";

      const valLogic = document.getElementById("val-def-logic");
      const subLogic = document.getElementById("sub-def-logic");
      if (valLogic) valLogic.textContent = (b["unexercised-logic"] || 0) + " clusters";
      if (subLogic) subLogic.textContent = (linesByCat["unexercised-logic"] || 0) + " missed lines";
    }

    function setDeficitCategoryFilter(cat) {
      deficitCategoryFilter = cat;
      masterFilter = cat;
      document.querySelectorAll(".filter-btn, .filter-def-btn").forEach(b => b.classList.remove("active"));
      const btn = document.getElementById("filter-def-" + cat) || document.getElementById("filter-" + cat);
      if (btn) btn.classList.add("active");
      deficitPage = 1;
      if (activeFile) closeFile();
      updateUrlHash();
      renderMasterTable();
    }

    function setDeficitSort(col) {
      if (deficitSortCol === col) {
        deficitSortAsc = !deficitSortAsc;
      } else {
        deficitSortCol = col;
        deficitSortAsc = col === "file" || col === "category";
      }
      deficitPage = 1;
      renderMasterTable();
    }

    function changeDeficitPage(delta) {
      deficitPage += delta;
      renderMasterTable();
    }

    function openDeficitCluster(file, startLine) {
      openFile(file, startLine);
    }

    function renderDeficitCell(n) {
      const isDir = n.type === "dir";
      const missCount = n.lines.total - n.lines.covered;
      if (missCount <= 0) {
        return '<span style="color: var(--status-pass); font-weight: 600; font-size: 0.8rem;">100% Perfect</span>';
      }

      const clusterCount = n.deficitCount || (n.deficitClusters ? n.deficitClusters.length : 1);
      const repoGain = n.maxRepoGainPct || (DATA.deficits && DATA.deficits.totalRepoLines ? Math.round((missCount / DATA.deficits.totalRepoLines) * 10000) / 100 : 0);
      const fileGain = n.maxFileGainPct || (n.lines.total > 0 ? Math.round((missCount / n.lines.total) * 10000) / 100 : 0);

      let html = '<div style="display: flex; flex-direction: column; gap: 0.35rem; max-width: 440px;">';
      html += '<div style="display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap;">';
      html += '<span class="deficit-rank" style="color: var(--status-fail);">' + clusterCount + ' cluster' + (clusterCount === 1 ? '' : 's') + ' (' + missCount + 'L)</span>';
      if (repoGain > 0) html += '<span class="gain-badge-repo" title="Repository Potential Gain">+' + repoGain + '% repo</span>';
      if (fileGain > 0 && !isDir) html += '<span class="gain-badge-file" title="File Potential Gain">+' + fileGain + '% file</span>';
      html += '</div>';

      if (n.deficitCategories && n.deficitCategories.length > 0) {
        html += '<div style="display: flex; gap: 0.3rem; flex-wrap: wrap;">';
        n.deficitCategories.forEach(cat => {
          html += '<span class="badge badge-cat-' + cat + '" style="font-size: 0.72rem; padding: 0.15rem 0.4rem;">' + escapeHtml(cat) + '</span>';
        });
        html += '</div>';
      }

      if (!isDir && n.deficitClusters && n.deficitClusters.length > 0) {
        const topCluster = n.deficitClusters[0];
        const lineLabel = topCluster.startLine === topCluster.endLine ? 'L' + topCluster.startLine : 'L' + topCluster.startLine + '-' + topCluster.endLine;
        html += '<div style="display: flex; align-items: center; gap: 0.35rem; font-size: 0.75rem;">';
        html += '<a class="deficit-target-link" data-path="' + escapeHtml(n.path) + '" data-line="' + topCluster.startLine + '" onclick="event.stopPropagation(); openFile(this.dataset.path, parseInt(this.dataset.line, 10))" title="Jump to ' + lineLabel + ' in source code"><strong>' + lineLabel + '</strong></a>';
        if (topCluster.sampleCodeSnippet) {
          html += '<code class="deficit-snippet" style="max-width: 220px;" title="' + escapeHtml(topCluster.sampleCodeSnippet) + '">' + escapeHtml(topCluster.sampleCodeSnippet) + '</code>';
        } else if (topCluster.categoryReason) {
          html += '<span class="deficit-reason" style="font-size: 0.75rem;">' + escapeHtml(topCluster.categoryReason) + '</span>';
        }
        html += '</div>';
      }

      html += '</div>';
      return html;
    }

    function renderDeficitView() {
      if (!DATA.deficits || !DATA.deficits.clusters) {
        return '<div style="padding: 2rem; text-align: center; color: var(--text-dim);">No coverage deficit data available.</div>';
      }

      let clusters = [...DATA.deficits.clusters];
      if (masterFilter && masterFilter !== "all" && masterFilter !== "deficits" && masterFilter !== "miss") {
        clusters = clusters.filter(c => c.category === masterFilter);
      }
      if (masterSearch) {
        const q = masterSearch.toLowerCase();
        clusters = clusters.filter(c => c.file.toLowerCase().includes(q) || (c.categoryReason && c.categoryReason.toLowerCase().includes(q)) || (c.sampleCodeSnippet && c.sampleCodeSnippet.toLowerCase().includes(q)));
      }

      clusters.sort((a, b) => {
        let vA, vB;
        if (deficitSortCol === "file") return deficitSortAsc ? a.file.localeCompare(b.file) : b.file.localeCompare(a.file);
        if (deficitSortCol === "lines") { vA = a.lineCount; vB = b.lineCount; }
        else if (deficitSortCol === "fileGain") { vA = a.fileImpactPct; vB = b.fileImpactPct; }
        else if (deficitSortCol === "category") return deficitSortAsc ? a.category.localeCompare(b.category) : b.category.localeCompare(a.category);
        else { vA = a.repoImpactPct; vB = b.repoImpactPct; }
        return deficitSortAsc ? vA - vB : vB - vA;
      });

      const totalItems = clusters.length;
      const totalPages = Math.max(1, Math.ceil(totalItems / deficitPageSize));
      deficitPage = Math.max(1, Math.min(deficitPage, totalPages));
      const startIdx = (deficitPage - 1) * deficitPageSize;
      const endIdx = Math.min(startIdx + deficitPageSize, totalItems);
      const pageClusters = clusters.slice(startIdx, endIdx);

      let html = '<div class="deficit-table-wrapper"><table class="deficit-table"><thead><tr>';
      html += '<th style="width: 60px;"># Rank</th>';
      html += '<th data-sort="file" onclick="setDeficitSort(this.dataset.sort)">Target File & Range ' + (deficitSortCol === 'file' ? (deficitSortAsc ? '▲' : '▼') : '') + '</th>';
      html += '<th data-sort="lines" onclick="setDeficitSort(this.dataset.sort)" style="width: 130px;">Uncovered Lines ' + (deficitSortCol === 'lines' ? (deficitSortAsc ? '▲' : '▼') : '') + '</th>';
      html += '<th data-sort="repoGain" onclick="setDeficitSort(this.dataset.sort)" style="width: 120px;">Repo Gain ' + (deficitSortCol === 'repoGain' ? (deficitSortAsc ? '▲' : '▼') : '') + '</th>';
      html += '<th data-sort="fileGain" onclick="setDeficitSort(this.dataset.sort)" style="width: 120px;">File Gain ' + (deficitSortCol === 'fileGain' ? (deficitSortAsc ? '▲' : '▼') : '') + '</th>';
      html += '<th data-sort="category" onclick="setDeficitSort(this.dataset.sort)" style="width: 170px;">Risk Category ' + (deficitSortCol === 'category' ? (deficitSortAsc ? '▲' : '▼') : '') + '</th>';
      html += '<th>Heuristic Detail / Snippet</th>';
      html += '</tr></thead><tbody>';

      pageClusters.forEach((c, idx) => {
        const globalRank = startIdx + idx + 1;
        const lineRangeText = c.startLine === c.endLine ? 'L' + c.startLine : 'L' + c.startLine + '-' + c.endLine;
        const catBadgeClass = 'badge badge-cat-' + c.category;

        html += '<tr>';
        html += '<td><span class="deficit-rank">#' + globalRank + '</span></td>';
        html += '<td><a class="deficit-target-link" data-file="' + escapeHtml(c.file) + '" data-line="' + c.startLine + '" onclick="openDeficitCluster(this.dataset.file, parseInt(this.dataset.line, 10))" title="Open in Code Viewer at Line ' + c.startLine + '"><strong>' + escapeHtml(c.file) + '</strong> <span style="color: var(--text-dim); font-size: 0.8rem;">(' + lineRangeText + ')</span></a></td>';
        html += '<td><span style="font-family: monospace; font-weight: 700; color: #f87171;">' + c.lineCount + ' lines</span></td>';
        html += '<td><span class="gain-badge-repo">+' + c.repoImpactPct + '%</span></td>';
        html += '<td><span class="gain-badge-file">+' + c.fileImpactPct + '%</span></td>';
        html += '<td><span class="' + catBadgeClass + '">' + escapeHtml(c.category) + '</span></td>';
        html += '<td><div class="deficit-detail-box"><span class="deficit-reason">' + escapeHtml(c.categoryReason) + '</span>';
        if (c.sampleCodeSnippet) {
          html += '<code class="deficit-snippet" title="' + escapeHtml(c.sampleCodeSnippet) + '">' + escapeHtml(c.sampleCodeSnippet) + '</code>';
        }
        html += '</div></td>';
        html += '</tr>';
      });

      if (pageClusters.length === 0) {
        html += '<tr><td colspan="7" style="text-align: center; color: var(--text-dim); padding: 2rem;">No deficit clusters match the selected criteria.</td></tr>';
      }

      html += '</tbody></table></div>';
      html += '<div class="pagination-bar" style="display: flex; justify-content: space-between; align-items: center; padding: 0.75rem 1rem; margin-top: 0.5rem;">';
      html += '<div style="font-size: 0.85rem; color: var(--text-muted);">Showing <strong>' + (totalItems > 0 ? startIdx + 1 : 0) + ' - ' + endIdx + '</strong> of <strong>' + totalItems + '</strong> clusters</div>';
      html += '<div class="page-controls" style="display: flex; gap: 0.5rem; align-items: center;">';
      html += '<button class="tree-action-btn" ' + (deficitPage <= 1 ? 'disabled' : '') + ' onclick="changeDeficitPage(-1)">&lt; Prev</button>';
      html += '<span style="font-size: 0.8rem; color: var(--text-dim);">Page ' + deficitPage + ' of ' + totalPages + '</span>';
      html += '<button class="tree-action-btn" ' + (deficitPage >= totalPages ? 'disabled' : '') + ' onclick="changeDeficitPage(1)">Next &gt;</button>';
      html += '</div></div>';

      return html;
    }
  `;
}

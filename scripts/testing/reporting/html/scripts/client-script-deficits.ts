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
      if (valErr) valErr.textContent = b["error-handling"] || 0;
      if (subErr) subErr.textContent = "Catch/throw paths";

      const valBranch = document.getElementById("val-def-branching");
      const subBranch = document.getElementById("sub-def-branching");
      if (valBranch) valBranch.textContent = b.branching || 0;
      if (subBranch) subBranch.textContent = "Conditionals & switches";

      const valInit = document.getElementById("val-def-init");
      const subInit = document.getElementById("sub-def-init");
      if (valInit) valInit.textContent = b.initialization || 0;
      if (subInit) subInit.textContent = "Setup & constructors";

      const valLogic = document.getElementById("val-def-logic");
      const subLogic = document.getElementById("sub-def-logic");
      if (valLogic) valLogic.textContent = b["unexercised-logic"] || 0;
      if (subLogic) subLogic.textContent = "Routines & algorithms";
    }

    function setDeficitCategoryFilter(cat) {
      deficitCategoryFilter = cat;
      document.querySelectorAll(".filter-def-btn").forEach(b => b.classList.remove("active"));
      const btn = document.getElementById("filter-def-" + cat);
      if (btn) btn.classList.add("active");
      deficitPage = 1;
      const qs = [];
      if (cat !== "all") qs.push("category=" + encodeURIComponent(cat));
      if (deficitSearch) qs.push("search=" + encodeURIComponent(deficitSearch));
      updateHash(qs.length > 0 ? "#deficits?" + qs.join("&") : "#deficits");
      renderDeficitView();
    }

    function setDeficitSort(col) {
      if (deficitSortCol === col) {
        deficitSortAsc = !deficitSortAsc;
      } else {
        deficitSortCol = col;
        deficitSortAsc = col === "file" || col === "category";
      }
      deficitPage = 1;
      renderDeficitView();
    }

    function changeDeficitPage(delta) {
      deficitPage += delta;
      renderDeficitView();
    }

    function openDeficitCluster(file, startLine) {
      openFile(file, startLine);
    }

    function renderDeficitView() {
      if (!DATA.deficits || !DATA.deficits.clusters) {
        const cView = document.getElementById("deficits-content-view");
        if (cView) cView.innerHTML = '<div style="padding: 2rem; text-align: center; color: var(--text-dim);">No coverage deficit data available.</div>';
        return;
      }
      initDeficitMetrics();

      let clusters = [...DATA.deficits.clusters];

      if (deficitCategoryFilter !== "all") {
        clusters = clusters.filter(c => c.category === deficitCategoryFilter);
      }

      if (deficitSearch) {
        const q = deficitSearch.toLowerCase();
        clusters = clusters.filter(c => c.file.toLowerCase().includes(q) || (c.categoryReason && c.categoryReason.toLowerCase().includes(q)) || (c.sampleCodeSnippet && c.sampleCodeSnippet.toLowerCase().includes(q)));
      }

      clusters.sort((a, b) => {
        let vA, vB;
        if (deficitSortCol === "file") {
          return deficitSortAsc ? a.file.localeCompare(b.file) : b.file.localeCompare(a.file);
        } else if (deficitSortCol === "lines") {
          vA = a.lineCount; vB = b.lineCount;
        } else if (deficitSortCol === "fileGain") {
          vA = a.fileImpactPct; vB = b.fileImpactPct;
        } else if (deficitSortCol === "category") {
          return deficitSortAsc ? a.category.localeCompare(b.category) : b.category.localeCompare(a.category);
        } else {
          vA = a.repoImpactPct; vB = b.repoImpactPct;
        }
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
      html += '<th onclick="setDeficitSort(\\'file\\')">Target File & Range ' + (deficitSortCol === 'file' ? (deficitSortAsc ? '▲' : '▼') : '') + '</th>';
      html += '<th onclick="setDeficitSort(\\'lines\\')" style="width: 130px;">Uncovered Lines ' + (deficitSortCol === 'lines' ? (deficitSortAsc ? '▲' : '▼') : '') + '</th>';
      html += '<th onclick="setDeficitSort(\\'repoGain\\')" style="width: 120px;">Repo Gain ' + (deficitSortCol === 'repoGain' ? (deficitSortAsc ? '▲' : '▼') : '') + '</th>';
      html += '<th onclick="setDeficitSort(\\'fileGain\\')" style="width: 120px;">File Gain ' + (deficitSortCol === 'fileGain' ? (deficitSortAsc ? '▲' : '▼') : '') + '</th>';
      html += '<th onclick="setDeficitSort(\\'category\\')" style="width: 170px;">Risk Category ' + (deficitSortCol === 'category' ? (deficitSortAsc ? '▲' : '▼') : '') + '</th>';
      html += '<th>Heuristic Detail / Snippet</th>';
      html += '</tr></thead><tbody>';

      pageClusters.forEach((c, idx) => {
        const globalRank = startIdx + idx + 1;
        const lineRangeText = c.startLine === c.endLine ? 'L' + c.startLine : 'L' + c.startLine + '-' + c.endLine;
        const rangeLabel = c.file + ':' + lineRangeText;
        const catBadgeClass = 'badge badge-cat-' + c.category;

        html += '<tr>';
        html += '<td><span class="deficit-rank">#' + globalRank + '</span></td>';
        html += '<td><a class="deficit-target-link" data-file="' + escapeHtml(c.file) + '" data-line="' + c.startLine + '" onclick="openDeficitCluster(this.dataset.file, parseInt(this.dataset.line, 10))" title="Open in Coverage Matrix at Line ' + c.startLine + '"><strong>' + escapeHtml(c.file) + '</strong> <span style="color: var(--text-dim); font-size: 0.8rem;">(' + lineRangeText + ')</span></a></td>';
        html += '<td><span style="font-family: monospace; font-weight: 700; color: #f87171;">' + c.lineCount + ' lines</span></td>';
        html += '<td><span class="gain-badge-repo">+' + c.repoImpactPct + '%</span></td>';
        html += '<td><span class="gain-badge-file">+' + c.fileImpactPct + '%</span></td>';
        html += '<td><span class="' + catBadgeClass + '">' + escapeHtml(c.category) + '</span></td>';
        html += '<td><div class="deficit-detail-box">';
        html += '<span class="deficit-reason">' + escapeHtml(c.categoryReason) + '</span>';
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

      // Pagination
      html += '<div class="pagination-bar">';
      html += '<div style="font-size: 0.85rem; color: var(--text-muted);">Showing <strong>' + (totalItems > 0 ? startIdx + 1 : 0) + ' - ' + endIdx + '</strong> of <strong>' + totalItems + '</strong> clusters (50 per page)</div>';
      html += '<div class="page-controls">';
      html += '<button class="page-btn" ' + (deficitPage <= 1 ? 'disabled' : '') + ' onclick="changeDeficitPage(-1)">&lt; Prev</button>';
      html += '<span class="page-indicator">Page ' + deficitPage + ' of ' + totalPages + '</span>';
      html += '<button class="page-btn" ' + (deficitPage >= totalPages ? 'disabled' : '') + ' onclick="changeDeficitPage(1)">Next &gt;</button>';
      html += '</div>';
      html += '</div>';

      const cView = document.getElementById("deficits-content-view");
      if (cView) cView.innerHTML = html;
    }
  `;
}

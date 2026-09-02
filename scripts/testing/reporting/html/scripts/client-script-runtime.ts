export function getClientScriptRuntime(): string {
  return `
    let activeTab = "coverage";
    let runtimePage = 1;
    const runtimePageSize = 50;
    let runtimeSearch = "";
    let runtimeSortCol = "duration";
    let runtimeSortAsc = false;

    function switchTab(tab) {
      activeTab = tab;
      document.querySelectorAll(".tab-btn").forEach(btn => btn.classList.remove("active"));
      const activeBtn = document.getElementById("tab-" + tab);
      if (activeBtn) activeBtn.classList.add("active");

      const covSection = document.getElementById("coverage-section");
      const rtSection = document.getElementById("runtime-section");
      const uniSection = document.getElementById("unified-section");
      const defSection = document.getElementById("deficits-section");

      if (covSection) covSection.style.display = tab === "coverage" ? "block" : "none";
      if (rtSection) rtSection.style.display = tab === "runtime" ? "block" : "none";
      if (uniSection) uniSection.style.display = tab === "unified" ? "block" : "none";
      if (defSection) defSection.style.display = tab === "deficits" ? "block" : "none";

      if (tab === "deficits") {
        const qs = [];
        if (deficitCategoryFilter !== "all") qs.push("category=" + encodeURIComponent(deficitCategoryFilter));
        if (deficitSearch) qs.push("search=" + encodeURIComponent(deficitSearch));
        updateHash(qs.length > 0 ? "#deficits?" + qs.join("&") : "#deficits");
        renderDeficitView();
      } else if (tab === "runtime") {
        updateHash("#runtime" + (runtimeSearch ? "?search=" + encodeURIComponent(runtimeSearch) : ""));
        renderRuntimeView();
      } else if (tab === "unified") {
        updateHash("#unified" + (unifiedSearch ? "?search=" + encodeURIComponent(unifiedSearch) : ""));
        renderUnifiedView();
      } else {
        updateHash(currentFile ? "#coverage/" + currentFile.path : (currentPath ? "#coverage/" + currentPath : "#coverage"));
        render();
      }
    }

    function initRuntimeMetrics() {
      if (!DATA.runtime || !DATA.runtime.files || DATA.runtime.files.length === 0) {
        const tabBtn = document.getElementById("tab-runtime");
        if (tabBtn) tabBtn.style.display = "none";
        return;
      }
      const r = DATA.runtime;
      const valTotal = document.getElementById("val-rt-total");
      const subTotal = document.getElementById("sub-rt-total");
      if (valTotal) valTotal.textContent = r.totalDurationMs + "ms";
      if (subTotal) subTotal.textContent = r.totalFiles + " test files executed";

      const valAvg = document.getElementById("val-rt-avg");
      const subAvg = document.getElementById("sub-rt-avg");
      if (valAvg) valAvg.textContent = r.avgDurationMs + "ms";
      if (subAvg) subAvg.textContent = "Median: " + r.medianDurationMs + "ms";

      const p50Pct = r.totalFiles > 0 ? Math.round((r.pareto50.fileCount / r.totalFiles) * 1000) / 10 : 0;
      const valP50 = document.getElementById("val-rt-p50");
      const subP50 = document.getElementById("sub-rt-p50");
      if (valP50) valP50.textContent = r.pareto50.fileCount + " files (" + p50Pct + "%)";
      if (subP50) subP50.textContent = "Accounts for 50% runtime (" + r.pareto50.cumulativeDurationMs + "ms)";

      const p90Pct = r.totalFiles > 0 ? Math.round((r.pareto90.fileCount / r.totalFiles) * 1000) / 10 : 0;
      const valP90 = document.getElementById("val-rt-p90");
      const subP90 = document.getElementById("sub-rt-p90");
      if (valP90) valP90.textContent = r.pareto90.fileCount + " files (" + p90Pct + "%)";
      if (subP90) subP90.textContent = "Accounts for 90% runtime (" + r.pareto90.cumulativeDurationMs + "ms)";

      const valSlow = document.getElementById("val-rt-slowest");
      const subSlow = document.getElementById("sub-rt-slowest");
      if (r.slowestFile) {
        const shortName = r.slowestFile.file.split("/").slice(-2).join("/");
        if (valSlow) valSlow.textContent = r.slowestFile.durationMs + "ms";
        if (subSlow) subSlow.textContent = shortName + " (" + r.slowestFile.percentage + "%)";
      }
    }

    function setRuntimeSort(col) {
      if (runtimeSortCol === col) {
        runtimeSortAsc = !runtimeSortAsc;
      } else {
        runtimeSortCol = col;
        runtimeSortAsc = col === "file";
      }
      runtimePage = 1;
      renderRuntimeView();
    }

    function changeRuntimePage(delta) {
      runtimePage += delta;
      renderRuntimeView();
    }

    function findSourceForTest(testFile) {
      if (!DATA.files || DATA.files.length === 0) return undefined;
      const direct = DATA.files.find(item => item.testFile === testFile);
      if (direct) return direct.path;
      const stem = testFile.split("/").pop().replace(/(\\.(test|spec))?\\.(ts|tsx|js|jsx|mjs|cjs)$/i, "").toLowerCase();
      const cand = DATA.files.find(item => {
        const itemStem = item.path.split("/").pop().replace(/(\\.(test|spec))?\\.(ts|tsx|js|jsx|mjs|cjs)$/i, "").toLowerCase();
        return itemStem === stem;
      });
      return cand ? cand.path : undefined;
    }

    function focusRuntimeFile(testFile) {
      if (!DATA.runtime || !DATA.runtime.files || DATA.runtime.files.length === 0) return;
      const cleanTarget = decodeURIComponent(testFile).toLowerCase();
      let idx = DATA.runtime.files.findIndex(f => f.file.toLowerCase() === cleanTarget);
      if (idx === -1) {
        idx = DATA.runtime.files.findIndex(f => f.file.toLowerCase().includes(cleanTarget) || cleanTarget.includes(f.file.toLowerCase()));
      }
      if (idx !== -1) {
        runtimePage = Math.floor(idx / runtimePageSize) + 1;
        renderRuntimeView();
        const targetFile = DATA.runtime.files[idx].file;
        const rowId = "rt-row-" + encodeURIComponent(targetFile);
        setTimeout(() => {
          const rowEl = document.getElementById(rowId);
          if (rowEl) {
            rowEl.scrollIntoView({ behavior: "smooth", block: "center" });
            rowEl.style.outline = "2px solid var(--brand-accent)";
            rowEl.style.backgroundColor = "rgba(99, 102, 241, 0.15)";
            setTimeout(() => {
              rowEl.style.outline = "none";
              rowEl.style.backgroundColor = "";
            }, 2500);
          }
        }, 50);
      } else {
        renderRuntimeView();
      }
    }

    function renderRuntimeView() {
      if (!DATA.runtime || !DATA.runtime.files) return;
      initRuntimeMetrics();

      let files = [...DATA.runtime.files];
      if (runtimeSearch) {
        const q = runtimeSearch.toLowerCase();
        files = files.filter(f => f.file.toLowerCase().includes(q));
      }

      files.sort((a, b) => {
        let valA = a.durationMs, valB = b.durationMs;
        if (runtimeSortCol === "file") {
          valA = a.file; valB = b.file;
          return runtimeSortAsc ? valA.localeCompare(valB) : valB.localeCompare(a.file);
        } else if (runtimeSortCol === "pct") {
          valA = a.percentage; valB = b.percentage;
        }
        return runtimeSortAsc ? valA - valB : valB - valA;
      });

      const totalItems = files.length;
      const totalPages = Math.max(1, Math.ceil(totalItems / runtimePageSize));
      runtimePage = Math.max(1, Math.min(runtimePage, totalPages));

      const startIdx = (runtimePage - 1) * runtimePageSize;
      const endIdx = Math.min(startIdx + runtimePageSize, totalItems);
      const pageFiles = files.slice(startIdx, endIdx);
      const maxDur = DATA.runtime.slowestFile ? DATA.runtime.slowestFile.durationMs : 1;

      let html = '<table><thead><tr>';
      html += '<th style="width: 60px;"># Rank</th>';
      html += '<th data-sort="file" onclick="setRuntimeSort(this.dataset.sort)">Test File ' + (runtimeSortCol === 'file' ? (runtimeSortAsc ? '▲' : '▼') : '') + '</th>';
      html += '<th data-sort="duration" onclick="setRuntimeSort(this.dataset.sort)" style="width: 140px;">Duration ' + (runtimeSortCol === 'duration' ? (runtimeSortAsc ? '▲' : '▼') : '') + '</th>';
      html += '<th data-sort="pct" onclick="setRuntimeSort(this.dataset.sort)" style="width: 120px;">Time Share ' + (runtimeSortCol === 'pct' ? (runtimeSortAsc ? '▲' : '▼') : '') + '</th>';
      html += '<th style="width: 160px;">Concentration</th>';
      html += '<th style="width: 90px;">Status</th>';
      html += '</tr></thead><tbody>';

      pageFiles.forEach((f, idx) => {
        const globalRank = startIdx + idx + 1;
        const durBarPct = maxDur > 0 ? Math.min(100, Math.round((f.durationMs / maxDur) * 100)) : 0;
        const statusBadge = f.passed === false ? '<span class="badge badge-fail">FAIL</span>' : '<span class="badge badge-pass">PASS</span>';
        const matchedSource = findSourceForTest(f.file);
        const testNameHtml = matchedSource
          ? '<a href="#coverage/' + escapeHtml(matchedSource) + '" class="test-title-link" title="Inspect ' + escapeHtml(matchedSource) + ' in Coverage Matrix">' + escapeHtml(f.file) + '</a>'
          : '<strong style="color: var(--text-main);">' + escapeHtml(f.file) + '</strong>';
        const rowId = "rt-row-" + encodeURIComponent(f.file);

        html += '<tr id="' + rowId + '" data-test-file="' + escapeHtml(f.file) + '">';
        html += '<td style="font-family: monospace; color: var(--text-dim);">' + globalRank + '</td>';
        html += '<td><div class="item-name">' + testNameHtml + '</div></td>';
        html += '<td><span style="font-family: monospace; font-weight: 700; color: var(--text-main);">' + f.durationMs + 'ms</span></td>';
        html += '<td><span class="badge badge-neutral">' + f.percentage + '%</span></td>';
        html += '<td><div class="runtime-bar-cell"><div class="runtime-bar-track"><div class="runtime-bar-fill" style="width:' + durBarPct + '%"></div></div><span style="font-size: 0.75rem; color: var(--text-dim); font-family: monospace;">' + durBarPct + '%</span></div></td>';
        html += '<td>' + statusBadge + '</td>';
        html += '</tr>';
      });

      if (pageFiles.length === 0) {
        html += '<tr><td colspan="6" style="text-align: center; color: var(--text-dim); padding: 2rem;">No test files matched search query.</td></tr>';
      }

      html += '</tbody></table>';

      // Pagination bar
      html += '<div class="pagination-bar">';
      html += '<div style="font-size: 0.85rem; color: var(--text-muted);">Showing <strong>' + (totalItems > 0 ? startIdx + 1 : 0) + ' - ' + endIdx + '</strong> of <strong>' + totalItems + '</strong> files (50 per page)</div>';
      html += '<div class="page-controls">';
      html += '<button class="page-btn" ' + (runtimePage <= 1 ? 'disabled' : '') + ' onclick="changeRuntimePage(-1)">&lt; Prev</button>';
      html += '<span class="page-indicator">Page ' + runtimePage + ' of ' + totalPages + '</span>';
      html += '<button class="page-btn" ' + (runtimePage >= totalPages ? 'disabled' : '') + ' onclick="changeRuntimePage(1)">Next &gt;</button>';
      html += '</div>';
      html += '</div>';

      const rtView = document.getElementById("runtime-content-view");
      if (rtView) rtView.innerHTML = html;
    }
  `;
}

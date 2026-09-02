import { getClientScriptHelpers } from "./client-script-helpers.ts";

export function getClientScript(payloadJson: string): string {
  return `
    const DATA = ${payloadJson};
    let viewMode = "tree";
    let masterFilter = "all";
    let masterSearch = "";
    let sortCol = "path";
    let sortAsc = true;
    let expandedFolders = new Set(["", "root", "scripts", "olt", "olt/scripts", "olt/scripts/src"]);
    let activeFile = null;

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
      return '<svg width="68" height="68"><circle class="gauge-bg" cx="34" cy="34" r="' + radius + '"></circle><circle class="gauge-fill" cx="34" cy="34" r="' + radius + '" style="stroke:' + color + '; stroke-dasharray:' + circumference + '; stroke-dashoffset:' + offset + '"></circle></svg>';
    }

    function initMetrics() {
      const t = DATA.total;
      const r = DATA.runtime;
      const def = DATA.deficits;
      document.getElementById("header-timestamp").textContent = new Date(DATA.generatedAt).toLocaleString();
      
      const linesPct = t.lines.pct;
      const headerBadge = document.getElementById("header-badge");
      if (headerBadge) {
        headerBadge.textContent = linesPct + "% Lines Covered";
        headerBadge.className = "badge " + badgeClass(linesPct);
      }

      // Card 1: Lines Coverage
      const valLines = document.getElementById("val-lines");
      const subLines = document.getElementById("sub-lines");
      const gaugeLines = document.getElementById("gauge-lines");
      if (valLines) valLines.textContent = t.lines.pct + "%";
      if (subLines) subLines.textContent = t.lines.covered + " / " + t.lines.total + " lines";
      if (gaugeLines) gaugeLines.innerHTML = createGaugeSvg(t.lines.pct, colorForPct(t.lines.pct));

      // Card 2: Functions Coverage
      const valFuncs = document.getElementById("val-funcs");
      const subFuncs = document.getElementById("sub-funcs");
      const gaugeFuncs = document.getElementById("gauge-funcs");
      if (valFuncs) valFuncs.textContent = t.functions.pct + "%";
      if (subFuncs) subFuncs.textContent = t.functions.covered + " / " + t.functions.total + " funcs";
      if (gaugeFuncs) gaugeFuncs.innerHTML = createGaugeSvg(t.functions.pct, colorForPct(t.functions.pct));

      // Card 3: Production Files Tested
      const valFiles = document.getElementById("val-files");
      const gaugeFiles = document.getElementById("gauge-files");
      if (valFiles) valFiles.textContent = DATA.files.length;
      if (gaugeFiles) gaugeFiles.innerHTML = createGaugeSvg(100, "var(--status-pass)");

      // Card 4: Unit Test Files Run
      const valTests = document.getElementById("val-tests");
      const subTests = document.getElementById("sub-tests");
      const gaugeTests = document.getElementById("gauge-tests");
      if (valTests) valTests.textContent = r ? r.totalFiles : "1864";
      if (subTests) subTests.textContent = r ? r.totalDurationMs + "ms (" + (r.pareto50 ? r.pareto50.fileCount : 9) + " in P50)" : "Across test suite";
      if (gaugeTests) gaugeTests.innerHTML = createGaugeSvg(100, "var(--text-muted)");

      // Card 5: Deficit Clusters
      const valDeficits = document.getElementById("val-deficits");
      const subDeficits = document.getElementById("sub-deficits");
      const gaugeDeficits = document.getElementById("gauge-deficits");
      const clusterCount = def && def.clusters ? def.clusters.length : 0;
      const missedLines = t.lines.total - t.lines.covered;
      if (valDeficits) valDeficits.textContent = clusterCount;
      if (subDeficits) subDeficits.textContent = missedLines + " uncovered lines";
      if (gaugeDeficits) gaugeDeficits.innerHTML = createGaugeSvg(Math.max(0, 100 - (missedLines / (t.lines.total || 1)) * 100), "var(--status-fail)");

      if (typeof initDeficitMetrics === "function") {
        initDeficitMetrics();
      }
    }

    function setDensity(mode) {
      if (mode === "compact") {
        document.body.classList.add("density-compact");
        document.getElementById("btn-density-compact")?.classList.add("active");
        document.getElementById("btn-density-comfortable")?.classList.remove("active");
      } else {
        document.body.classList.remove("density-compact");
        document.getElementById("btn-density-comfortable")?.classList.add("active");
        document.getElementById("btn-density-compact")?.classList.remove("active");
      }
    }

    function setViewMode(mode) {
      viewMode = mode;
      document.querySelectorAll(".view-mode-btn").forEach(b => b.classList.remove("active"));
      const btn = document.getElementById("btn-view-" + mode);
      if (btn) btn.classList.add("active");
      const treeBar = document.getElementById("tree-actions-bar");
      if (treeBar) treeBar.style.display = mode === "tree" ? "flex" : "none";
      updateUrlHash();
      renderMasterTable();
    }

    function setMasterFilter(f) {
      masterFilter = f;
      if (f === "perfect") {
        sortCol = "lines";
        sortAsc = false;
      } else if (f === "miss") {
        sortCol = "lines";
        sortAsc = true;
      } else if (f === "deficits") {
        sortCol = "deficits";
        sortAsc = false;
      } else if (f === "slow") {
        sortCol = "duration";
        sortAsc = false;
      } else if (f === "all") {
        sortCol = "path";
        sortAsc = true;
      }
      document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
      const btn = document.getElementById("filter-" + f);
      if (btn) btn.classList.add("active");
      updateUrlHash();
      renderMasterTable();
    }

    function resetMasterFilters() {
      masterFilter = "all";
      masterSearch = "";
      viewMode = "tree";
      sortCol = "path";
      sortAsc = true;
      expandedFolders = new Set(["", "root", "scripts", "olt", "olt/scripts", "olt/scripts/src"]);

      const searchInput = document.getElementById("master-search-box");
      if (searchInput) searchInput.value = "";

      document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
      const filterAllBtn = document.getElementById("filter-all");
      if (filterAllBtn) filterAllBtn.classList.add("active");

      document.querySelectorAll(".view-mode-btn").forEach(b => b.classList.remove("active"));
      const treeBtn = document.getElementById("btn-view-tree");
      if (treeBtn) treeBtn.classList.add("active");

      const treeBar = document.getElementById("tree-actions-bar");
      if (treeBar) treeBar.style.display = "flex";

      updateUrlHash();
      renderMasterTable();
    }

    function onMasterSearch(val) {
      masterSearch = (val || "").trim().toLowerCase();
      updateUrlHash();
      renderMasterTable();
    }

    function toggleFolder(path) {
      if (expandedFolders.has(path)) {
        expandedFolders.delete(path);
      } else {
        expandedFolders.add(path);
      }
      renderMasterTable();
    }

    function expandAllFolders() {
      function collect(n) {
        if (n.type === "dir") {
          expandedFolders.add(n.path);
          if (n.children) n.children.forEach(collect);
        }
      }
      if (DATA.tree) collect(DATA.tree);
      renderMasterTable();
    }

    function collapseAllFolders() {
      expandedFolders.clear();
      expandedFolders.add("");
      expandedFolders.add("root");
      renderMasterTable();
    }

    function setMasterSort(col) {
      if (sortCol === col) {
        sortAsc = !sortAsc;
      } else {
        sortCol = col;
        sortAsc = col === "path";
      }
      renderMasterTable();
    }

    ${getClientScriptHelpers()}

    function initApp() {
      const loader = document.getElementById("dashboard-loader");
      try {
        initMetrics();
        initDeepLinks();
        renderMasterTable();
      } finally {
        if (loader) {
          loader.style.display = "none";
        }
      }
    }

    window.addEventListener("DOMContentLoaded", initApp);
    if (document.readyState === "complete" || document.readyState === "interactive") {
      initApp();
    }
  `.trim();
}

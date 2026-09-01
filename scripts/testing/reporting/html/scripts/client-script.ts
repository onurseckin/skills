import { getClientScriptDeeplink } from "./client-script-deeplink.ts";
import { getClientScriptDeficits } from "./client-script-deficits.ts";
import { getClientScriptHelpers } from "./client-script-helpers.ts";
import { getClientScriptRuntime } from "./client-script-runtime.ts";
import { getClientScriptUnified } from "./client-script-unified.ts";

export function getClientScript(payloadJson: string): string {
  return `
    const DATA = ${payloadJson};
    let currentPath = "";
    let currentFile = null;
    let searchQuery = "";
    let statusFilter = "all";
    let sortColumn = "name";
    let sortAsc = true;

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
      return '<svg><circle class="gauge-bg" cx="34" cy="34" r="' + radius + '"></circle><circle class="gauge-fill" cx="34" cy="34" r="' + radius + '" style="stroke:' + color + '; stroke-dasharray:' + circumference + '; stroke-dashoffset:' + offset + '"></circle></svg>';
    }

    function initMetrics() {
      const t = DATA.total;
      document.getElementById("header-timestamp").textContent = new Date(DATA.generatedAt).toLocaleString();
      
      const linesPct = t.lines.pct;
      const headerBadge = document.getElementById("header-badge");
      if (headerBadge) {
        headerBadge.textContent = linesPct + "% Line Coverage";
        headerBadge.className = "badge " + badgeClass(linesPct);
      }

      const valLines = document.getElementById("val-lines");
      const subLines = document.getElementById("sub-lines");
      const gaugeLines = document.getElementById("gauge-lines");
      if (valLines) valLines.textContent = t.lines.pct + "%";
      if (subLines) subLines.textContent = t.lines.covered + " / " + t.lines.total + " lines";
      if (gaugeLines) gaugeLines.innerHTML = createGaugeSvg(t.lines.pct, colorForPct(t.lines.pct));

      const valStmts = document.getElementById("val-statements");
      const subStmts = document.getElementById("sub-statements");
      const gaugeStmts = document.getElementById("gauge-statements");
      if (valStmts) valStmts.textContent = t.statements.pct + "%";
      if (subStmts) subStmts.textContent = t.statements.covered + " / " + t.statements.total + " stmts";
      if (gaugeStmts) gaugeStmts.innerHTML = createGaugeSvg(t.statements.pct, colorForPct(t.statements.pct));

      const valFuncs = document.getElementById("val-funcs");
      const subFuncs = document.getElementById("sub-funcs");
      const gaugeFuncs = document.getElementById("gauge-funcs");
      if (valFuncs) valFuncs.textContent = t.functions.pct + "%";
      if (subFuncs) subFuncs.textContent = t.functions.covered + " / " + t.functions.total + " funcs";
      if (gaugeFuncs) gaugeFuncs.innerHTML = createGaugeSvg(t.functions.pct, colorForPct(t.functions.pct));

      const valFiles = document.getElementById("val-files");
      const gaugeFiles = document.getElementById("gauge-files");
      if (valFiles) valFiles.textContent = DATA.files.length;
      if (gaugeFiles) gaugeFiles.innerHTML = createGaugeSvg(100, "var(--brand-accent)");

      initRuntimeMetrics();
      initUnifiedMetrics();
      initDeficitMetrics();
    }

    function setFilter(f) {
      statusFilter = f;
      document.querySelectorAll(".filter-btn").forEach(btn => btn.classList.remove("active"));
      const btn = document.getElementById("filter-" + f);
      if (btn) btn.classList.add("active");
      currentFile = null;
      updateHash(f === "all" ? (currentPath ? "#coverage/" + currentPath : "#coverage") : "#coverage?filter=" + f);
      render();
    }

    function renderBreadcrumbs() {
      const el = document.getElementById("breadcrumbs");
      if (!el) return;
      el.innerHTML = "";

      const rootCrumb = document.createElement("span");
      rootCrumb.className = "crumb-chip" + (!currentPath && !currentFile ? " crumb-active" : "");
      rootCrumb.textContent = "root";
      rootCrumb.onclick = () => { currentPath = ""; currentFile = null; updateHash("#coverage"); render(); };
      el.appendChild(rootCrumb);

      if (currentPath || currentFile) {
        const segments = (currentFile ? currentFile.path : currentPath).split("/").filter(Boolean);
        let accumulated = "";
        segments.forEach((seg, idx) => {
          const sep = document.createElement("span");
          sep.textContent = "/";
          sep.style.color = "var(--text-dim)";
          el.appendChild(sep);

          accumulated += (accumulated ? "/" : "") + seg;
          const isLast = idx === segments.length - 1;

          if (isLast && currentFile) {
            const leaf = document.createElement("span");
            leaf.textContent = seg;
            leaf.className = "crumb-chip crumb-active";
            el.appendChild(leaf);
          } else {
            const link = document.createElement("span");
            link.className = "crumb-chip" + (isLast && !currentFile ? " crumb-active" : "");
            link.textContent = seg;
            const target = accumulated;
            link.onclick = () => { currentPath = target; currentFile = null; updateHash("#coverage/" + target); render(); };
            el.appendChild(link);
          }
        });
      }
    }

    function renderFolderView() {
      let filtered = DATA.files.filter(f => {
        if (searchQuery && !f.path.toLowerCase().includes(searchQuery.toLowerCase())) return false;
        if (statusFilter === "miss" && f.linesPct >= 100) return false;
        if (statusFilter === "perfect" && f.linesPct < 100) return false;
        if (!currentPath) return true;
        return f.path.startsWith(currentPath + "/");
      });

      const itemsMap = new Map();
      filtered.forEach(f => {
        const relative = currentPath ? f.path.slice(currentPath.length + 1) : f.path;
        const slashIdx = relative.indexOf("/");
        if (slashIdx === -1) {
          itemsMap.set(relative, { type: "file", name: relative, file: f });
        } else {
          const folderName = relative.slice(0, slashIdx);
          if (!itemsMap.has(folderName)) {
            itemsMap.set(folderName, { type: "folder", name: folderName, files: [] });
          }
          itemsMap.get(folderName).files.push(f);
        }
      });

      let html = '<table><thead><tr>';
      html += '<th onclick="setSort(\\'name\\')">Name ' + (sortColumn === 'name' ? (sortAsc ? '▲' : '▼') : '') + '</th>';
      html += '<th onclick="setSort(\\'lines\\')">Lines ' + (sortColumn === 'lines' ? (sortAsc ? '▲' : '▼') : '') + '</th>';
      html += '<th onclick="setSort(\\'statements\\')">Statements ' + (sortColumn === 'statements' ? (sortAsc ? '▲' : '▼') : '') + '</th>';
      html += '<th onclick="setSort(\\'funcs\\')">Functions ' + (sortColumn === 'funcs' ? (sortAsc ? '▲' : '▼') : '') + '</th>';
      html += '<th>Uncovered Lines</th>';
      html += '</tr></thead><tbody>';

      const items = Array.from(itemsMap.values());
      items.sort((a, b) => {
        if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
        let valA = a.name, valB = b.name;
        if (sortColumn === "lines") {
          valA = a.type === "file" ? a.file.linesPct : getFolderLinesPct(a);
          valB = b.type === "file" ? b.file.linesPct : getFolderLinesPct(b);
        } else if (sortColumn === "statements") {
          valA = a.type === "file" ? a.file.statementsPct : getFolderLinesPct(a);
          valB = b.type === "file" ? b.file.statementsPct : getFolderLinesPct(b);
        } else if (sortColumn === "funcs") {
          valA = a.type === "file" ? a.file.funcsPct : getFolderLinesPct(a);
          valB = b.type === "file" ? b.file.funcsPct : getFolderLinesPct(b);
        }
        if (valA < valB) return sortAsc ? -1 : 1;
        if (valA > valB) return sortAsc ? 1 : -1;
        return a.name.localeCompare(b.name);
      });

      items.forEach(item => {
        if (item.type === "folder") {
          let totalLines = 0, coveredLines = 0, totalFuncs = 0, coveredFuncs = 0;
          let totalStmts = 0, coveredStmts = 0;
          item.files.forEach(f => {
            totalLines += f.linesTotal;
            coveredLines += f.linesCovered;
            totalStmts += f.statementsTotal;
            coveredStmts += f.statementsCovered;
            totalFuncs += f.funcsTotal;
            coveredFuncs += f.funcsCovered;
          });
          const linePct = totalLines > 0 ? Math.round((coveredLines / totalLines) * 10000) / 100 : 100;
          const stmtPct = totalStmts > 0 ? Math.round((coveredStmts / totalStmts) * 10000) / 100 : 100;
          const fnPct = totalFuncs > 0 ? Math.round((coveredFuncs / totalFuncs) * 10000) / 100 : 100;
          const targetFolder = currentPath ? currentPath + "/" + item.name : item.name;

          html += '<tr onclick="openFolder(\\'' + targetFolder + '\\')" style="cursor: pointer;">';
          html += '<td><div class="item-name"><strong style="color: var(--text-main);">' + item.name + '</strong> <span class="badge badge-neutral">' + item.files.length + ' files</span></div></td>';
          html += '<td><span class="badge ' + badgeClass(linePct) + '">' + linePct + '%</span> (' + coveredLines + '/' + totalLines + ')<div class="mini-progress"><div class="mini-progress-fill" style="width:' + linePct + '%; background:' + colorForPct(linePct) + '"></div></div></td>';
          html += '<td><span class="badge ' + badgeClass(stmtPct) + '">' + stmtPct + '%</span> (' + coveredStmts + '/' + totalStmts + ')</td>';
          html += '<td><span class="badge ' + badgeClass(fnPct) + '">' + fnPct + '%</span> (' + coveredFuncs + '/' + totalFuncs + ')</td>';
          html += '<td><span style="color: var(--text-dim); font-size: 0.8rem;">' + (item.files.filter(f => f.linesPct < 100).length) + ' files missing 100%</span></td>';
          html += '</tr>';
        } else {
          const f = item.file;
          const uncov = f.uncoveredLines.length > 0 
            ? f.uncoveredLines.slice(0, 6).join(", ") + (f.uncoveredLines.length > 6 ? ' (+' + (f.uncoveredLines.length - 6) + ')' : '')
            : '<span style="color: var(--status-pass); font-weight: 600;">None (100%)</span>';

          html += '<tr onclick="openFile(\\'' + f.path + '\\')" style="cursor: pointer;">';
          html += '<td><div class="item-name"><span style="color: var(--text-main);">' + item.name + '</span></div></td>';
          html += '<td><span class="badge ' + badgeClass(f.linesPct) + '">' + f.linesPct + '%</span> (' + f.linesCovered + '/' + f.linesTotal + ')<div class="mini-progress"><div class="mini-progress-fill" style="width:' + f.linesPct + '%; background:' + colorForPct(f.linesPct) + '"></div></div></td>';
          html += '<td><span class="badge ' + badgeClass(f.statementsPct) + '">' + f.statementsPct + '%</span> (' + f.statementsCovered + '/' + f.statementsTotal + ')</td>';
          html += '<td><span class="badge ' + badgeClass(f.funcsPct) + '">' + f.funcsPct + '%</span> (' + f.funcsCovered + '/' + f.funcsTotal + ')</td>';
          html += '<td style="font-family: \\'JetBrains Mono\\', monospace; font-size: 0.8rem; color: #f87171;">' + uncov + '</td>';
          html += '</tr>';
        }
      });

      html += '</tbody></table>';
      const cView = document.getElementById("content-view");
      if (cView) cView.innerHTML = html;
    }
    
    ${getClientScriptHelpers()}
    ${getClientScriptRuntime()}
    ${getClientScriptUnified()}
    ${getClientScriptDeficits()}
    ${getClientScriptDeeplink()}

    initDeepLinks();
  `.trim();
}

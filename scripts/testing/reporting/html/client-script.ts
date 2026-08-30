import { getClientScriptHelpers } from "./client-script-helpers.ts";

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
      headerBadge.textContent = linesPct + "% Line Coverage";
      headerBadge.className = "badge " + badgeClass(linesPct);

      document.getElementById("val-lines").textContent = t.lines.pct + "%";
      document.getElementById("sub-lines").textContent = t.lines.covered + " / " + t.lines.total + " lines";
      document.getElementById("gauge-lines").innerHTML = createGaugeSvg(t.lines.pct, colorForPct(t.lines.pct));

      document.getElementById("val-statements").textContent = t.statements.pct + "%";
      document.getElementById("sub-statements").textContent = t.statements.covered + " / " + t.statements.total + " stmts";
      document.getElementById("gauge-statements").innerHTML = createGaugeSvg(t.statements.pct, colorForPct(t.statements.pct));

      document.getElementById("val-funcs").textContent = t.functions.pct + "%";
      document.getElementById("sub-funcs").textContent = t.functions.covered + " / " + t.functions.total + " funcs";
      document.getElementById("gauge-funcs").innerHTML = createGaugeSvg(t.functions.pct, colorForPct(t.functions.pct));

      document.getElementById("val-files").textContent = DATA.files.length;
      document.getElementById("gauge-files").innerHTML = createGaugeSvg(100, "var(--brand-accent)");
    }

    function setFilter(f) {
      statusFilter = f;
      document.querySelectorAll(".filter-btn").forEach(btn => btn.classList.remove("active"));
      document.getElementById("filter-" + f).classList.add("active");
      currentFile = null;
      render();
    }

    function renderBreadcrumbs() {
      const el = document.getElementById("breadcrumbs");
      el.innerHTML = "";

      const rootCrumb = document.createElement("span");
      rootCrumb.className = "crumb-chip" + (!currentPath && !currentFile ? " crumb-active" : "");
      rootCrumb.textContent = "📦 root";
      rootCrumb.onclick = () => { currentPath = ""; currentFile = null; render(); };
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
            link.onclick = () => { currentPath = target; currentFile = null; render(); };
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
          valA = a.type === "file" ? a.file.funcsPct : getFolderFuncsPct(a);
          valB = b.type === "file" ? b.file.funcsPct : getFolderFuncsPct(b);
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
          html += '<td><div class="item-name">📁 <strong>' + item.name + '</strong> <span class="badge badge-neutral">' + item.files.length + ' files</span></div></td>';
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
          html += '<td><div class="item-name">📄 ' + item.name + '</div></td>';
          html += '<td><span class="badge ' + badgeClass(f.linesPct) + '">' + f.linesPct + '%</span> (' + f.linesCovered + '/' + f.linesTotal + ')<div class="mini-progress"><div class="mini-progress-fill" style="width:' + f.linesPct + '%; background:' + colorForPct(f.linesPct) + '"></div></div></td>';
          html += '<td><span class="badge ' + badgeClass(f.statementsPct) + '">' + f.statementsPct + '%</span> (' + f.statementsCovered + '/' + f.statementsTotal + ')</td>';
          html += '<td><span class="badge ' + badgeClass(f.funcsPct) + '">' + f.funcsPct + '%</span> (' + f.funcsCovered + '/' + f.funcsTotal + ')</td>';
          html += '<td style="font-family: \\'JetBrains Mono\\', monospace; font-size: 0.8rem; color: #f87171;">' + uncov + '</td>';
          html += '</tr>';
        }
      });

      html += '</tbody></table>';
      document.getElementById("content-view").innerHTML = html;
    }
    
    ${getClientScriptHelpers()}
  `.trim();
}

import { getClientScriptUnified } from "./client-script-unified.ts";

export function getClientScriptHelpers(): string {
  return `
    function escapeHtml(str) {
      if (typeof str !== "string") return "";
      return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    function openFile(path, lineNo) {
      const f = DATA.files.find(item => item.path === path);
      if (!f) return;
      activeFile = f;

      const masterView = document.getElementById("master-view");
      const codeViewer = document.getElementById("code-viewer-container");
      if (masterView) masterView.style.display = "none";
      if (codeViewer) {
        codeViewer.style.display = "block";
        renderCodeViewer(f, lineNo);
      }

      const hash = '#file/' + path + (lineNo ? ':L' + lineNo : '');
      if (window.location.hash !== hash) {
        history.pushState(null, "", hash);
      }
    }

    function closeFile() {
      activeFile = null;
      const masterView = document.getElementById("master-view");
      const codeViewer = document.getElementById("code-viewer-container");
      if (codeViewer) {
        codeViewer.style.display = "none";
        codeViewer.innerHTML = "";
      }
      if (masterView) masterView.style.display = "block";
      updateUrlHash();
    }

    function renderCodeViewer(f, targetLineNo) {
      const codeViewer = document.getElementById("code-viewer-container");
      if (!codeViewer) return;

      let html = '<div class="file-viewer-header">';
      html += '<div style="display: flex; gap: 0.75rem; align-items: center;">';
      html += '<button class="tree-action-btn" onclick="closeFile()">&larr; Back to Master Table</button>';
      html += '<div style="font-family: monospace; font-weight: 700; font-size: 0.95rem; color: var(--text-main);">' + escapeHtml(f.path) + '</div>';
      html += '</div>';
      html += '<div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">';
      html += '<span class="badge ' + badgeClass(f.linesPct) + '">Lines: ' + f.linesPct + '%</span>';
      html += '<span class="badge ' + badgeClass(f.funcsPct) + '">Funcs: ' + f.funcsPct + '%</span>';
      if (f.testFile) {
        const durText = f.testDurationMs !== undefined ? (Math.round(f.testDurationMs * 100) / 100) + 'ms' : 'Telemetry';
        html += '<span class="badge badge-neutral">Test: ' + durText + '</span>';
      }
      html += '<button class="tree-action-btn" data-path="' + escapeHtml(f.path) + '" onclick="copyPath(this.dataset.path)">Copy Path</button>';
      html += '</div>';
      html += '</div>';

      if (f.uncoveredLines && f.uncoveredLines.length > 0) {
        html += '<div class="missed-chips-bar">';
        html += '<span style="font-size: 0.8rem; font-weight: 700; color: #f87171;">' + f.uncoveredLines.length + ' UNCOVERED LINES:</span>';
        f.uncoveredLines.forEach(lineNo => {
          html += '<button class="miss-chip" onclick="jumpToLine(' + lineNo + ')">L' + lineNo + '</button>';
        });
        html += '</div>';
      }

      if (!f.sourceLines || f.sourceLines.length === 0) {
        html += '<div class="metric-card" style="padding: 2rem; color: var(--text-dim);">Source code content is not available on disk.</div>';
      } else {
        html += '<div class="code-container">';
        f.sourceLines.forEach(line => {
          const isExec = line.isExecutable;
          const isMiss = isExec && line.hits === 0;
          const isHit = isExec && line.hits && line.hits > 0;
          const cls = isMiss ? "miss" : isHit ? "hit" : "neutral";
          const hitsText = isMiss ? "0x" : isHit ? line.hits + "x" : "";
          const hitsColor = isMiss ? "var(--status-fail)" : "var(--status-pass)";

          html += '<div class="code-line ' + cls + '" id="line-' + line.no + '">';
          html += '<div class="line-num" data-path="' + escapeHtml(f.path) + '" data-line="' + line.no + '" onclick="selectLine(this.dataset.path, parseInt(this.dataset.line, 10))" style="cursor: pointer;" title="Click to jump/copy link to Line ' + line.no + '">' + line.no + '</div>';
          html += '<div class="line-hits" style="color:' + hitsColor + '">' + hitsText + '</div>';
          html += '<div class="line-content">' + escapeHtml(line.code) + '</div>';
          html += '</div>';
        });
        html += '</div>';
      }

      codeViewer.innerHTML = html;

      if (targetLineNo) {
        setTimeout(() => jumpToLine(targetLineNo), 60);
      }
    }

    function jumpToLine(lineNo) {
      if (activeFile) {
        const hash = '#file/' + activeFile.path + ':L' + lineNo;
        if (window.location.hash !== hash) {
          history.replaceState(null, "", hash);
        }
      }
      const el = document.getElementById("line-" + lineNo);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.style.outline = "2px solid var(--status-fail)";
        el.style.backgroundColor = "rgba(239, 68, 68, 0.18)";
        setTimeout(() => {
          el.style.outline = "none";
          el.style.backgroundColor = "";
        }, 2000);
      }
    }

    function selectLine(path, lineNo) {
      jumpToLine(lineNo);
      if (navigator && navigator.clipboard) {
        const fullUrl = window.location.origin + window.location.pathname + '#file/' + path + ':L' + lineNo;
        navigator.clipboard.writeText(fullUrl);
      }
    }

    function copyPath(p) {
      if (navigator && navigator.clipboard) {
        navigator.clipboard.writeText(p);
      }
    }

    function updateUrlHash() {
      if (activeFile) return;
      let hash = '#' + viewMode;
      const params = [];
      if (masterFilter !== "all") params.push("filter=" + encodeURIComponent(masterFilter));
      if (masterSearch) params.push("search=" + encodeURIComponent(masterSearch));
      if (params.length > 0) hash += '?' + params.join("&");
      if (window.location.hash !== hash) {
        history.replaceState(null, "", hash);
      }
    }

    function initDeepLinks() {
      function handleRoute() {
        const h = window.location.hash || "#tree";
        if (h.startsWith("#file/")) {
          const rest = h.slice(6);
          const parts = rest.split(":L");
          const filePath = decodeURIComponent(parts[0]);
          const lineNo = parts[1] ? parseInt(parts[1], 10) : undefined;
          openFile(filePath, lineNo);
        } else {
          if (activeFile) {
            closeFile();
          }
          const modePart = h.includes("?") ? h.slice(1, h.indexOf("?")) : h.slice(1);
          if (modePart === "tree" || modePart === "flat") {
            viewMode = modePart;
            document.querySelectorAll(".view-mode-btn").forEach(b => b.classList.remove("active"));
            const btn = document.getElementById("btn-view-" + viewMode);
            if (btn) btn.classList.add("active");
          }
          if (h.includes("?")) {
            const queryStr = h.slice(h.indexOf("?") + 1);
            const params = new URLSearchParams(queryStr);
            const f = params.get("filter");
            if (f) {
              masterFilter = f;
              document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
              const btn = document.getElementById("filter-" + f);
              if (btn) btn.classList.add("active");
            }
            const s = params.get("search");
            if (s) {
              masterSearch = s;
              const input = document.getElementById("master-search-box");
              if (input) input.value = s;
            }
          }
          renderMasterTable();
        }
      }

      window.addEventListener("hashchange", handleRoute);
      handleRoute();
    }

    ${getClientScriptUnified()}
  `;
}

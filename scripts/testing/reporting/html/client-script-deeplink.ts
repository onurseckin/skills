/**
 * Client Script Deep Link Routing Engine
 * Provides bidirectional URL hash navigation, route parsing, state synchronization,
 * and DOM locator/highlight routines for the interactive HTML coverage & performance dashboard.
 */

export interface HashRoute {
  readonly tab: "coverage" | "runtime" | "unified" | "deficits";
  readonly path?: string | undefined;
  readonly line?: number | undefined;
  readonly search?: string | undefined;
  readonly file?: string | undefined;
  readonly filter?: string | undefined;
  readonly category?: string | undefined;
}

export function parseHash(hash: string): HashRoute {
  if (!hash) {
    return { tab: "coverage" };
  }

  let cleaned = hash.startsWith("#") ? hash.slice(1) : hash;
  cleaned = cleaned.trim();
  if (!cleaned) {
    return { tab: "coverage" };
  }

  let rawPath = cleaned;
  let queryString = "";
  const qIdx = cleaned.indexOf("?");
  if (qIdx !== -1) {
    rawPath = cleaned.slice(0, qIdx);
    queryString = cleaned.slice(qIdx + 1);
  }

  const queryParams = new URLSearchParams(queryString);
  const qTab = queryParams.get("tab");
  const qSearch = queryParams.get("search") ?? queryParams.get("q");
  const qFile = queryParams.get("file");
  const qPath = queryParams.get("path");
  const qFilter = queryParams.get("filter");
  const qCategory = queryParams.get("category") ?? queryParams.get("cat");
  const qLineStr = queryParams.get("line") ?? queryParams.get("l") ?? queryParams.get("L");
  let line = qLineStr ? parseInt(qLineStr, 10) : undefined;
  if (line !== undefined && (isNaN(line) || line <= 0)) {
    line = undefined;
  }

  const lineMatch = /[:#]L?(\d+)$/i.exec(rawPath);
  if (lineMatch && lineMatch[1]) {
    const matchedLine = parseInt(lineMatch[1], 10);
    if (!isNaN(matchedLine) && matchedLine > 0) {
      line = matchedLine;
    }
    rawPath = rawPath.slice(0, lineMatch.index);
  }

  let tab: "coverage" | "runtime" | "unified" | "deficits" = "coverage";
  let path: string | undefined = qPath ?? undefined;
  let file: string | undefined = qFile ?? undefined;
  let category: string | undefined = qCategory ?? undefined;

  if (rawPath === "deficits" || rawPath.startsWith("deficits/")) {
    tab = "deficits";
    if (rawPath.startsWith("deficits/")) {
      file = file ?? decodeURIComponent(rawPath.slice("deficits/".length));
    }
  } else if (rawPath === "runtime" || rawPath.startsWith("runtime/")) {
    tab = "runtime";
    if (rawPath.startsWith("runtime/")) {
      file = file ?? decodeURIComponent(rawPath.slice("runtime/".length));
    }
  } else if (rawPath === "unified" || rawPath.startsWith("unified/")) {
    tab = "unified";
    if (rawPath.startsWith("unified/")) {
      path = path ?? decodeURIComponent(rawPath.slice("unified/".length));
    }
  } else if (rawPath === "coverage" || rawPath.startsWith("coverage/")) {
    tab = "coverage";
    if (rawPath.startsWith("coverage/")) {
      path = path ?? decodeURIComponent(rawPath.slice("coverage/".length));
    }
  } else if (rawPath.length > 0) {
    tab = "coverage";
    path = path ?? decodeURIComponent(rawPath);
  }

  if (qTab === "runtime" || qTab === "unified" || qTab === "coverage" || qTab === "deficits") {
    tab = qTab;
  }

  return {
    tab,
    path: path || undefined,
    line,
    search: qSearch || undefined,
    file: file || undefined,
    filter: qFilter || undefined,
    category: category || undefined,
  };
}

export function formatHash(route: HashRoute): string {
  const params = new URLSearchParams();
  if (route.search) params.set("search", route.search);
  if (route.filter) params.set("filter", route.filter);

  if (route.tab === "deficits") {
    if (route.category) params.set("category", route.category);
    if (route.file) params.set("file", route.file);
    const qs = params.toString() ? `?${params.toString()}` : "";
    return `#deficits${qs}`;
  }

  if (route.tab === "runtime") {
    if (route.file) params.set("file", route.file);
    const qs = params.toString() ? `?${params.toString()}` : "";
    return `#runtime${qs}`;
  }

  if (route.tab === "unified") {
    const pathPart = route.path ? `/${route.path}` : "";
    const qs = params.toString() ? `?${params.toString()}` : "";
    return `#unified${pathPart}${qs}`;
  }

  // coverage
  const pathPart = route.path ? `/${route.path}` : "";
  const linePart = route.line ? `:L${route.line}` : "";
  const qs = params.toString() ? `?${params.toString()}` : "";
  return `#coverage${pathPart}${linePart}${qs}`;
}

export function getClientScriptDeeplink(): string {
  return `
    function parseHash(hash) {
      if (!hash) return { tab: "coverage" };
      let cleaned = hash.startsWith("#") ? hash.slice(1) : hash;
      cleaned = cleaned.trim();
      if (!cleaned) return { tab: "coverage" };

      let rawPath = cleaned;
      let queryString = "";
      const qIdx = cleaned.indexOf("?");
      if (qIdx !== -1) {
        rawPath = cleaned.slice(0, qIdx);
        queryString = cleaned.slice(qIdx + 1);
      }

      const queryParams = new URLSearchParams(queryString);
      const qTab = queryParams.get("tab");
      const qSearch = queryParams.get("search") || queryParams.get("q");
      const qFile = queryParams.get("file");
      const qPath = queryParams.get("path");
      const qFilter = queryParams.get("filter");
      const qCategory = queryParams.get("category") || queryParams.get("cat");
      const qLineStr = queryParams.get("line") || queryParams.get("l") || queryParams.get("L");
      let line = qLineStr ? parseInt(qLineStr, 10) : undefined;
      if (line !== undefined && (isNaN(line) || line <= 0)) line = undefined;

      const lineMatch = /[:#]L?(\\d+)$/i.exec(rawPath);
      if (lineMatch && lineMatch[1]) {
        const matchedLine = parseInt(lineMatch[1], 10);
        if (!isNaN(matchedLine) && matchedLine > 0) line = matchedLine;
        rawPath = rawPath.slice(0, lineMatch.index);
      }

      let tab = "coverage";
      let path = qPath || undefined;
      let file = qFile || undefined;
      let category = qCategory || undefined;

      if (rawPath === "deficits" || rawPath.startsWith("deficits/")) {
        tab = "deficits";
        if (rawPath.startsWith("deficits/")) file = file || decodeURIComponent(rawPath.slice("deficits/".length));
      } else if (rawPath === "runtime" || rawPath.startsWith("runtime/")) {
        tab = "runtime";
        if (rawPath.startsWith("runtime/")) file = file || decodeURIComponent(rawPath.slice("runtime/".length));
      } else if (rawPath === "unified" || rawPath.startsWith("unified/")) {
        tab = "unified";
        if (rawPath.startsWith("unified/")) path = path || decodeURIComponent(rawPath.slice("unified/".length));
      } else if (rawPath === "coverage" || rawPath.startsWith("coverage/")) {
        tab = "coverage";
        if (rawPath.startsWith("coverage/")) path = path || decodeURIComponent(rawPath.slice("coverage/".length));
      } else if (rawPath.length > 0) {
        tab = "coverage";
        path = path || decodeURIComponent(rawPath);
      }

      if (qTab === "runtime" || qTab === "unified" || qTab === "coverage" || qTab === "deficits") tab = qTab;

      return { tab, path, line, search: qSearch || undefined, file, filter: qFilter || undefined, category };
    }

    function updateHash(newHash) {
      if (window.location.hash === newHash) return;
      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, "", newHash);
      } else {
        window.location.hash = newHash;
      }
    }

    function applyHashRoute() {
      const route = parseHash(window.location.hash);
      if (route.tab === "deficits") {
        if (activeTab !== "deficits") switchTab("deficits");
        if (route.category) setDeficitCategoryFilter(route.category);
        if (route.search !== undefined) {
          deficitSearch = route.search;
          const defInput = document.getElementById("deficit-search-box");
          if (defInput) defInput.value = route.search;
        }
        if (route.file && route.line) {
          openDeficitCluster(route.file, route.line);
        } else {
          renderDeficitView();
        }
      } else if (route.tab === "runtime") {
        if (activeTab !== "runtime") switchTab("runtime");
        if (route.search !== undefined) {
          runtimeSearch = route.search;
          const rtInput = document.getElementById("runtime-search-box");
          if (rtInput) rtInput.value = route.search;
        }
        if (route.file) {
          focusRuntimeFile(route.file);
        } else {
          renderRuntimeView();
        }
      } else if (route.tab === "unified") {
        if (activeTab !== "unified") switchTab("unified");
        if (route.filter) setUnifiedFilter(route.filter);
        if (route.search !== undefined) {
          unifiedSearch = route.search;
          const uniInput = document.getElementById("unified-search-box");
          if (uniInput) uniInput.value = route.search;
        }
        if (route.path) {
          const segs = route.path.split("/").filter(Boolean);
          let acc = "";
          segs.forEach(s => {
            acc += (acc ? "/" : "") + s;
            expandedFolders.add(acc);
          });
        }
        renderUnifiedView();
      } else {
        if (activeTab !== "coverage") switchTab("coverage");
        if (route.filter) {
          statusFilter = route.filter;
          document.querySelectorAll(".filter-btn").forEach(btn => btn.classList.remove("active"));
          const btn = document.getElementById("filter-" + route.filter);
          if (btn) btn.classList.add("active");
        }
        if (route.search !== undefined) {
          searchQuery = route.search;
          const sInput = document.getElementById("search-box");
          if (sInput) sInput.value = route.search;
        }
        if (route.path) {
          const f = DATA.files.find(item => item.path === route.path);
          if (f) {
            currentFile = f;
            render();
            if (route.line) {
              setTimeout(() => jumpToLine(route.line), 50);
            }
          } else {
            const isFolder = DATA.files.some(item => item.path.startsWith(route.path + "/"));
            if (isFolder) {
              currentPath = route.path;
              currentFile = null;
              render();
            } else {
              render();
            }
          }
        } else {
          currentFile = null;
          render();
        }
      }
    }

    function initDeepLinks() {
      window.addEventListener("hashchange", applyHashRoute);
      initMetrics();
      applyHashRoute();
    }
  `;
}

import { describe, expect, test } from "bun:test";
import { getClientScriptHelpers } from "../../../../scripts/testing/reporting/html/scripts/client-script-helpers.ts";
import { getClientScript } from "../../../../scripts/testing/reporting/html/scripts/client-script.ts";

function createMockDomEnvironment(customPayload?: any) {
  const elements = new Map<string, any>();
  const listeners = new Map<string, Function[]>();
  const payload = {
    generatedAt: "2026-09-01T00:00:00.000Z",
    total: {
      lines: { total: 10, covered: 10, pct: 100 },
      functions: { total: 2, covered: 2, pct: 100 },
    },
    files: [],
    tree: { path: "root", type: "dir", children: [] },
    runtime: { totalFiles: 0, totalDurationMs: 0 },
    deficits: { clusters: [], totalUncoveredLines: 0 },
    ...customPayload,
  };

  function makeElement(id = "", cls = "") {
    const el: any = {
      id,
      className: cls,
      classList: {
        classes: new Set(cls.split(" ").filter(Boolean)),
        add(c: string) {
          this.classes.add(c);
          el.className = Array.from(this.classes).join(" ");
        },
        remove(c: string) {
          this.classes.delete(c);
          el.className = Array.from(this.classes).join(" ");
        },
        contains(c: string) {
          return this.classes.has(c);
        },
      },
      style: {},
      textContent: "",
      innerHTML: "",
      dataset: {},
      children: [] as any[],
      scrollIntoView() {},
      addEventListener(t: string, fn: Function) {
        if (!listeners.has(id + ":" + t)) listeners.set(id + ":" + t, []);
        listeners.get(id + ":" + t)!.push(fn);
      },
      querySelectorAll(sel: string) {
        return Array.from(elements.values()).filter((e) =>
          sel.startsWith(".") ? e.classList.contains(sel.slice(1)) : e.id === sel.slice(1),
        );
      },
    };
    if (id) elements.set(id, el);
    return el;
  }

  const ids = [
    "header-timestamp",
    "header-badge",
    "sub-lines",
    "kpi-fill-lines",
    "kpi-val-lines",
    "sub-funcs",
    "kpi-fill-funcs",
    "kpi-val-funcs",
    "val-files",
    "val-tests",
    "sub-tests",
    "val-deficits",
    "sub-deficits",
    "btn-view-tree",
    "btn-view-flat",
    "btn-view-deficits",
    "filter-all",
    "filter-miss",
    "filter-deficits",
    "filter-def-error-handling",
    "filter-def-branching",
    "filter-def-initialization",
    "filter-def-unexercised-logic",
    "filter-slow",
    "filter-perfect",
    "master-search-box",
    "btn-reset-filters",
    "tree-actions-bar",
    "btn-expand-all",
    "btn-collapse-all",
    "table-summary-text",
    "master-table-container",
    "deficits-section",
    "runtime-section",
    "code-viewer-container",
    "master-view",
    "dashboard-loader",
    "search-box",
    "runtime-search-box",
    "unified-search-box",
    "deficit-search-box",
  ];
  for (const id of ids) makeElement(id);

  const doc = {
    readyState: "loading",
    getElementById: (id: string) => elements.get(id) || makeElement(id),
    querySelectorAll: (sel: string) =>
      Array.from(elements.values()).filter((e) =>
        sel
          .split(",")
          .map((s) => s.trim())
          .some((p) =>
            p.startsWith(".") ? e.classList.contains(p.slice(1)) : e.id === p.slice(1),
          ),
      ),
    addEventListener: (t: string, fn: Function) => {
      if (!listeners.has("doc:" + t)) listeners.set("doc:" + t, []);
      listeners.get("doc:" + t)!.push(fn);
    },
  };

  const win = {
    location: { hash: "#tree", origin: "http://localhost", pathname: "/cov.html" },
    history: {
      pushState: (_s: any, _t: string, h: string) => {
        win.location.hash = h;
      },
      replaceState: (_s: any, _t: string, h: string) => {
        win.location.hash = h;
      },
    },
    navigator: {
      clipboard: {
        lastCopied: "",
        writeText: async (t: string) => {
          win.navigator.clipboard.lastCopied = t;
        },
      },
    },
    addEventListener: (t: string, fn: Function) => {
      if (!listeners.has("win:" + t)) listeners.set("win:" + t, []);
      listeners.get("win:" + t)!.push(fn);
    },
  };

  const script = getClientScript(JSON.stringify(payload));
  const ctx = new Function(
    "document",
    "window",
    "navigator",
    "history",
    "location",
    `
    ${script}
    return {
      DATA, colorForPct, badgeClass, initMetrics, setViewMode, setMasterFilter,
      resetMasterFilters, onMasterSearch, toggleFolder, expandAllFolders, collapseAllFolders,
      setMasterSort, changeFlatPage, renderFolderView, renderFileView, setFilter, setSort,
      renderBreadcrumbs, getFolderLinesPct, getFolderFuncsPct, initApp, escapeHtml, escapeJs,
      openCodeViewer, toggleFolderRow, openFile, closeFile, renderCodeViewer, jumpToLine,
      selectLine, copyPath, updateUrlHash, updateHash, initDeepLinks,
      getViewMode: () => viewMode, getMasterFilter: () => masterFilter,
      getMasterSearch: () => masterSearch, getSortCol: () => sortCol, getSortAsc: () => sortAsc,
      getExpandedFolders: () => expandedFolders, getActiveFile: () => activeFile,
      getFlatCurrentPage: () => flatCurrentPage,
    };
  `,
  )(doc, win, win.navigator, win.history, win.location);

  return { ctx, doc, win, elements };
}

describe("HTML Client Script & Helpers Coverage", () => {
  test("getClientScript and getClientScriptHelpers build required client JS", () => {
    const code = getClientScript(JSON.stringify({ generatedAt: "2026-09-01T00:00:00.000Z" }));
    expect(code).toContain("const DATA =");
    expect(code).toContain("2026-09-01T00:00:00.000Z");
    expect(code).toContain("function initMetrics()");
    expect(code).toContain("function setViewMode(");
    expect(code).toContain("function escapeHtml(");
    expect(getClientScriptHelpers()).toContain("function escapeHtml(");
  });

  test("colorForPct and badgeClass compute status colors and class tokens", () => {
    const { ctx } = createMockDomEnvironment();
    expect(ctx.colorForPct(100)).toBe("var(--status-pass)");
    expect(ctx.colorForPct(95)).toBe("var(--status-warn)");
    expect(ctx.colorForPct(80)).toBe("var(--status-warn)");
    expect(ctx.colorForPct(79.9)).toBe("var(--status-fail)");
    expect(ctx.colorForPct(0)).toBe("var(--status-fail)");
    expect(ctx.badgeClass(100)).toBe("badge-pass");
    expect(ctx.badgeClass(85)).toBe("badge-warn");
    expect(ctx.badgeClass(75)).toBe("badge-fail");
  });

  test("initMetrics sets header timestamp, line/function KPI metrics, and deficit counters", () => {
    const payload = {
      generatedAt: "2026-09-01T12:00:00.000Z",
      total: {
        lines: { covered: 900, total: 1000, pct: 90 },
        functions: { covered: 45, total: 50, pct: 90 },
      },
      files: [{ path: "src/a.ts", testFile: "tests/a.test.ts" }],
      runtime: { totalFiles: 1, totalDurationMs: 120, pareto50: { fileCount: 1 } },
      deficits: { clusters: [{ id: "c1" }], totalUncoveredLines: 100 },
    };
    const { ctx, elements } = createMockDomEnvironment(payload);
    ctx.initMetrics();
    expect(elements.get("header-badge")?.textContent).toContain("90% Lines Covered");
    expect(elements.get("kpi-val-lines")?.textContent).toBe("90%");
  });

  test("setViewMode, filters, search, folders, and sorting operate correctly", () => {
    const { ctx, elements, win } = createMockDomEnvironment({
      tree: { path: "root", type: "dir", children: [{ path: "src", type: "dir" }] },
    });
    ctx.setViewMode("flat");
    expect(
      ctx.getViewMode() === "flat" && elements.get("btn-view-flat")?.classList.contains("active"),
    ).toBe(true);

    ctx.setMasterFilter("miss");
    expect(ctx.getMasterFilter() === "miss" && ctx.getSortCol() === "lines").toBe(true);
    ctx.setMasterFilter("deficits");
    expect(ctx.getSortCol()).toBe("deficits");

    ctx.onMasterSearch("  foo  ");
    expect(ctx.getMasterSearch()).toBe("foo");
    ctx.resetMasterFilters();
    expect(ctx.getMasterFilter()).toBe("all");

    ctx.toggleFolder("src");
    expect(ctx.getExpandedFolders().has("src")).toBe(true);
    ctx.collapseAllFolders();
    expect(ctx.getExpandedFolders().has("src")).toBe(false);

    ctx.initApp();
    expect(elements.get("dashboard-loader")?.style.display).toBe("none");
  });

  test("escapeHtml, escapeJs, and viewer navigation operations operate correctly", () => {
    const { ctx, elements, win } = createMockDomEnvironment({
      files: [
        {
          path: "src/main.ts",
          linesPct: 90,
          funcsPct: 100,
          uncoveredLines: [5],
          sourceLines: [{ no: 5, isExecutable: true, hits: 0, code: "err" }],
        },
      ],
    });
    expect(ctx.escapeHtml("<tag>")).toBe("&lt;tag&gt;");
    expect(ctx.escapeJs("a\\'b")).toBe("a\\\\\\'b");

    ctx.openCodeViewer("src/main.ts", 5);
    expect(elements.get("code-viewer-container")?.style.display).toBe("block");
    ctx.closeFile();
    expect(elements.get("code-viewer-container")?.style.display).toBe("none");

    ctx.openFile("src/main.ts");
    ctx.jumpToLine(42);
    expect(win.location.hash).toBe("#file/src/main.ts:L42");
    ctx.selectLine("src/main.ts", 42);
    expect(win.navigator.clipboard.lastCopied).toContain("#file/src/main.ts:L42");

    win.location.hash = "#file/src%2Fmain.ts:L5";
    ctx.initDeepLinks();
    expect(ctx.getActiveFile()?.path).toBe("src/main.ts");
  });
});

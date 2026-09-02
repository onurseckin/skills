import { describe, expect, test } from "bun:test";
import { getClientScriptUnified } from "../../../../scripts/testing/reporting/html/scripts/client-script-unified.ts";

function createUnifiedContext(customData?: any) {
  const elements = new Map<string, any>();
  function makeEl(id = "") {
    const el: any = {
      id,
      innerHTML: "",
      style: {},
      textContent: "",
      dataset: {},
      classList: { add() {}, remove() {}, contains: () => false },
    };
    if (id) elements.set(id, el);
    return el;
  }
  [
    "master-table-container",
    "tree-actions-bar",
    "table-summary-text",
    "btn-expand-all",
    "btn-collapse-all",
  ].forEach((id) => makeEl(id));

  const DATA = {
    total: {
      lines: { total: 100, covered: 90, pct: 90 },
      functions: { total: 10, covered: 9, pct: 90 },
    },
    files: [],
    tree: { path: "root", type: "dir", children: [] },
    runtime: { totalFiles: 1, totalDurationMs: 50 },
    deficits: { clusters: [{ id: "c1" }], totalRepoLines: 1000 },
    ...customData,
  };

  const doc = {
    getElementById: (id: string) => elements.get(id) || makeEl(id),
    querySelectorAll: () => [],
  };
  const win = { location: { hash: "#tree" }, history: { replaceState() {} } };

  const unifiedScript = getClientScriptUnified();
  const ctx = new Function(
    "document",
    "window",
    "DATA",
    `
    let viewMode = "tree";
    let masterFilter = "all";
    let masterSearch = "";
    let sortCol = "path";
    let sortAsc = true;
    let expandedFolders = new Set(["", "root", "src"]);
    let flatCurrentPage = 1;
    let flatPageSize = 10;
    let activeFile = null;

    function escapeHtml(s) { return typeof s === "string" ? s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") : ""; }
    function escapeJs(s) { return typeof s === "string" ? s.replace(/\\\\/g, "\\\\\\\\").replace(/'/g, "\\\\'") : ""; }
    function toggleFolderRow(p) { if (expandedFolders.has(p)) expandedFolders.delete(p); else expandedFolders.add(p); }
    function openCodeViewer(p) { activeFile = p; }
    function openFile(p) { activeFile = p; }
    function updateUrlHash() {}
    function setMasterSort(c) { if (sortCol === c) sortAsc = !sortAsc; else { sortCol = c; sortAsc = c === "path"; } }
    function changeFlatPage(p) { flatCurrentPage = p; }

    ${unifiedScript}

    return {
      nodeMatchesFilter, nodeMatchesSearch, nodeHasMatchingDescendants,
      getNodeMetricVal, sortUnifiedItems, renderCoverageBar, renderTableRow,
      renderTreeNodeRow, collectMatchingNodes, renderRankedTreeNodes,
      renderFlatPagination, renderFlatFiles, renderMasterTable,
      setFilter: (f) => { masterFilter = f; },
      setSearch: (s) => { masterSearch = s; },
      setSort: (c, asc) => { sortCol = c; sortAsc = asc; },
      setView: (v) => { viewMode = v; },
      setPage: (p, s) => { flatCurrentPage = p; flatPageSize = s; },
      getExpanded: () => expandedFolders,
    };
  `,
  )(doc, win, DATA);

  return { ctx, elements, DATA };
}

describe("HTML Client Script Unified Coverage", () => {
  test("getClientScriptUnified string builder includes core tree and table functions", () => {
    const code = getClientScriptUnified();
    expect(code).toContain("function nodeMatchesFilter(");
    expect(code).toContain("function nodeMatchesSearch(");
    expect(code).toContain("function getNodeMetricVal(");
    expect(code).toContain("function renderMasterTable(");
  });

  test("nodeMatchesFilter evaluates miss, deficits, categories, slow, and perfect filters", () => {
    const { ctx } = createUnifiedContext();
    const nodePerfect = {
      lines: { pct: 100, total: 10, covered: 10 },
      linesPct: 100,
      uncoveredLines: [],
    };
    const nodeMiss = {
      lines: { pct: 80, total: 10, covered: 8 },
      linesPct: 80,
      uncoveredLines: [3, 4],
      deficitCategories: ["error-handling"],
    };
    const nodeSlow = { linesPct: 90, paretoClass: "p50", deficitCount: 1 };
    const nodeInit = { linesPct: 95, deficitCategories: ["initialization"] };

    ctx.setFilter("all");
    expect(ctx.nodeMatchesFilter(nodePerfect)).toBe(true);

    ctx.setFilter("miss");
    expect(ctx.nodeMatchesFilter(nodeMiss)).toBe(true);
    expect(ctx.nodeMatchesFilter(nodePerfect)).toBe(false);

    ctx.setFilter("deficits");
    expect(ctx.nodeMatchesFilter(nodeMiss)).toBe(true);
    expect(ctx.nodeMatchesFilter(nodeSlow)).toBe(true);
    expect(ctx.nodeMatchesFilter(nodePerfect)).toBe(false);

    ctx.setFilter("error-handling");
    expect(ctx.nodeMatchesFilter(nodeMiss)).toBe(true);
    expect(ctx.nodeMatchesFilter(nodeInit)).toBe(false);

    ctx.setFilter("initialization");
    expect(ctx.nodeMatchesFilter(nodeInit)).toBe(true);

    ctx.setFilter("slow");
    expect(ctx.nodeMatchesFilter(nodeSlow)).toBe(true);
    expect(ctx.nodeMatchesFilter(nodePerfect)).toBe(false);

    ctx.setFilter("perfect");
    expect(ctx.nodeMatchesFilter(nodePerfect)).toBe(true);
    expect(ctx.nodeMatchesFilter(nodeMiss)).toBe(false);
  });

  test("nodeMatchesSearch and nodeHasMatchingDescendants search names, paths, tests, and snippets", () => {
    const { ctx } = createUnifiedContext();
    const leaf = {
      name: "engine.ts",
      path: "src/engine.ts",
      testFile: "tests/engine.test.ts",
      deficitCategories: ["branching"],
      deficitClusters: [
        { categoryReason: "unhandled error condition", sampleCodeSnippet: "throw new Error()" },
      ],
    };
    const tree = { name: "src", path: "src", type: "dir", children: [leaf] };

    ctx.setSearch("");
    expect(ctx.nodeMatchesSearch(leaf)).toBe(true);

    ctx.setSearch("engine");
    expect(ctx.nodeMatchesSearch(leaf)).toBe(true);

    ctx.setSearch("tests/engine");
    expect(ctx.nodeMatchesSearch(leaf)).toBe(true);

    ctx.setSearch("branching");
    expect(ctx.nodeMatchesSearch(leaf)).toBe(true);

    ctx.setSearch("unhandled error");
    expect(ctx.nodeMatchesSearch(leaf)).toBe(true);

    ctx.setSearch("non-existent-query");
    expect(ctx.nodeMatchesSearch(leaf)).toBe(false);

    ctx.setSearch("engine");
    expect(ctx.nodeHasMatchingDescendants(tree)).toBe(true);
  });

  test("getNodeMetricVal and sortUnifiedItems sort lines, funcs, duration, deficits, and names", () => {
    const { ctx } = createUnifiedContext();
    const itemA = {
      path: "src/a.ts",
      lines: { pct: 70, total: 10, covered: 7 },
      functions: { pct: 80 },
      testDurationMs: 100,
      maxRepoGainPct: 5,
    };
    const itemB = {
      path: "src/b.ts",
      lines: { pct: 90, total: 10, covered: 9 },
      functions: { pct: 100 },
      testDurationMs: 20,
      maxRepoGainPct: 1,
    };

    expect(ctx.getNodeMetricVal(itemA, "lines")).toBe(70);
    expect(ctx.getNodeMetricVal(itemA, "funcs")).toBe(80);
    expect(ctx.getNodeMetricVal(itemA, "duration")).toBe(100);
    expect(ctx.getNodeMetricVal(itemA, "deficits")).toBe(5);
    expect(ctx.getNodeMetricVal(itemA, "path")).toBe("src/a.ts");

    ctx.setSort("lines", true);
    expect(ctx.sortUnifiedItems([itemB, itemA])[0].path).toBe("src/a.ts");
    ctx.setSort("duration", false);
    expect(ctx.sortUnifiedItems([itemB, itemA])[0].path).toBe("src/a.ts");
  });

  test("renderCoverageBar, renderTableRow, and renderFlatPagination format outputs correctly", () => {
    const { ctx } = createUnifiedContext();
    expect(ctx.renderCoverageBar(100, 10, 10, "lines")).toContain("cov-bar-fill-pass");
    expect(ctx.renderCoverageBar(60, 6, 10, "funcs")).toContain("cov-bar-fill-fail");

    const dirNode = {
      path: "src",
      name: "src",
      type: "dir",
      children: [{ path: "src/a.ts" }],
      lines: { pct: 90, covered: 9, total: 10 },
    };
    const fileNode = {
      path: "src/a.ts",
      name: "a.ts",
      type: "file",
      lines: { pct: 90, covered: 9, total: 10 },
      functions: { pct: 100, covered: 2, total: 2 },
      testDurationMs: 45.678,
      paretoClass: "p50",
      testPassed: true,
    };

    expect(ctx.renderTableRow(dirNode, true, 0)).toContain("tree-row-dir");
    expect(ctx.renderTableRow(fileNode, false, 1)).toContain("tree-row-file");

    expect(ctx.renderFlatPagination(0)).toBe("");
    ctx.setPage(1, 10);
    expect(ctx.renderFlatPagination(8)).toContain("Showing <strong>1 - 8</strong>");
    ctx.setPage(5, 10);
    expect(ctx.renderFlatPagination(100)).toContain("Page 5 of 10");
  });

  test("renderMasterTable renders tree hierarchy, flat list, deficits mode, and filter results", () => {
    const file1 = {
      path: "src/a.ts",
      name: "a.ts",
      type: "file",
      lines: { pct: 100, covered: 10, total: 10 },
      linesPct: 100,
    };
    const file2 = {
      path: "src/b.ts",
      name: "b.ts",
      type: "file",
      lines: { pct: 50, covered: 5, total: 10 },
      linesPct: 50,
    };
    const treeData = {
      files: [file1, file2],
      tree: {
        path: "root",
        type: "dir",
        children: [{ path: "src", name: "src", type: "dir", children: [file1, file2] }],
      },
    };
    const { ctx, elements } = createUnifiedContext(treeData);

    ctx.setView("tree");
    ctx.setFilter("all");
    ctx.renderMasterTable();
    expect(elements.get("master-table-container")?.innerHTML).toContain("unified-tree-table");

    ctx.setFilter("miss");
    ctx.renderMasterTable();
    expect(elements.get("master-table-container")?.innerHTML).toContain("src/b.ts");

    ctx.setView("flat");
    ctx.setFilter("all");
    ctx.renderMasterTable();
    expect(elements.get("master-table-container")?.innerHTML).toContain("flat-pagination-bar");

    ctx.setView("deficits");
    ctx.renderMasterTable();
    expect(elements.get("table-summary-text")?.textContent).toContain(
      "prioritized deficit clusters",
    );
  });
});

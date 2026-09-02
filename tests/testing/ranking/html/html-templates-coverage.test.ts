import { describe, expect, test } from "bun:test";
import { getHtmlStyles } from "../../../../scripts/testing/reporting/html/styles/styles.ts";
import { buildHtmlDocument } from "../../../../scripts/testing/reporting/html/templates.ts";

describe("HTML Coverage Templates & Styles Coverage", () => {
  describe("buildHtmlDocument template generation", () => {
    test("generates complete HTML document with embedded styles and client script", () => {
      const mockStyles = "body { background-color: #000; }";
      const mockScript = "console.log('dashboard-init');";

      const html = buildHtmlDocument(mockStyles, mockScript);

      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain('<html lang="en" class="dark">');
      expect(html).toContain('<meta charset="UTF-8">');
      expect(html).toContain(
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
      );
      expect(html).toContain(
        "<title>Test Coverage & Runtime Dashboard - @onurseckin/skills</title>",
      );
      expect(html).toContain(mockStyles);
      expect(html).toContain(mockScript);
    });

    test("contains all required header, brand, and badge markup", () => {
      const html = buildHtmlDocument("", "");

      expect(html).toContain("<header>");
      expect(html).toContain('<div class="brand">');
      expect(html).toContain('<div class="brand-icon">');
      expect(html).toContain('<div class="brand-text">Skills Test Suite & Performance</div>');
      expect(html).toContain('<span id="header-badge" class="badge"></span>');
      expect(html).toContain('id="header-timestamp"');
    });

    test("contains static offline loader and all 5 master KPI summary cards", () => {
      const html = buildHtmlDocument("", "");

      // Loader
      expect(html).toContain('id="dashboard-loader"');
      expect(html).toContain('class="loader-spinner"');
      expect(html).toContain("Loading Test Coverage & Telemetry...");

      // Lines Coverage Card
      expect(html).toContain("Lines Coverage");
      expect(html).toContain('id="sub-lines"');
      expect(html).toContain('id="kpi-fill-lines"');
      expect(html).toContain('id="kpi-val-lines"');

      // Functions Coverage Card
      expect(html).toContain("Functions Coverage");
      expect(html).toContain('id="sub-funcs"');
      expect(html).toContain('id="kpi-fill-funcs"');
      expect(html).toContain('id="kpi-val-funcs"');

      // Production Files Tested Card
      expect(html).toContain("Production Files Tested");
      expect(html).toContain('id="val-files"');
      expect(html).toContain("Across Source Code");

      // Unit Test Files Run Card
      expect(html).toContain("Unit Test Files Run");
      expect(html).toContain('id="val-tests"');
      expect(html).toContain('id="sub-tests"');

      // Deficit Clusters Card
      expect(html).toContain("Deficit Clusters");
      expect(html).toContain('id="val-deficits"');
      expect(html).toContain('id="sub-deficits"');
      expect(html).toContain('id="val-def-uncovered"');
      expect(html).toContain('id="val-rt-total"');
    });

    test("contains 4 dedicated deficit overview KPI category cards with click filters", () => {
      const html = buildHtmlDocument("", "");

      expect(html).toContain("onclick=\"setDeficitCategoryFilter('error-handling')\"");
      expect(html).toContain('id="val-def-error"');
      expect(html).toContain('id="sub-def-error"');

      expect(html).toContain("onclick=\"setDeficitCategoryFilter('branching')\"");
      expect(html).toContain('id="val-def-branching"');
      expect(html).toContain('id="sub-def-branching"');

      expect(html).toContain("onclick=\"setDeficitCategoryFilter('initialization')\"");
      expect(html).toContain('id="val-def-init"');
      expect(html).toContain('id="sub-def-init"');

      expect(html).toContain("onclick=\"setDeficitCategoryFilter('unexercised-logic')\"");
      expect(html).toContain('id="val-def-logic"');
      expect(html).toContain('id="sub-def-logic"');
    });

    test("contains controls bar, view modes, filter buttons, and search inputs", () => {
      const html = buildHtmlDocument("", "");

      // View mode buttons
      expect(html).toContain('id="btn-view-tree"');
      expect(html).toContain('id="btn-view-flat"');
      expect(html).toContain('id="btn-view-deficits"');

      // Filters
      expect(html).toContain('id="filter-all"');
      expect(html).toContain('id="filter-miss"');
      expect(html).toContain('id="filter-deficits"');
      expect(html).toContain('id="filter-def-error-handling"');
      expect(html).toContain('id="filter-def-branching"');
      expect(html).toContain('id="filter-def-initialization"');
      expect(html).toContain('id="filter-def-unexercised-logic"');
      expect(html).toContain('id="filter-slow"');
      expect(html).toContain('id="filter-perfect"');

      // Search & Actions
      expect(html).toContain('id="master-search-box"');
      expect(html).toContain('id="btn-reset-filters"');
      expect(html).toContain('id="tree-actions-bar"');
      expect(html).toContain('id="btn-expand-all"');
      expect(html).toContain('id="btn-collapse-all"');
      expect(html).toContain('id="table-summary-text"');
      expect(html).toContain('id="master-table-container"');
      expect(html).toContain('id="code-viewer-container"');
    });

    test("handles special characters and empty inputs safely", () => {
      const specialStyles = "/* <style> injection test & special 'chars' */";
      const specialScript = "// <script> 'test' & \"escapes\"";
      const html = buildHtmlDocument(specialStyles, specialScript);

      expect(html).toContain(specialStyles);
      expect(html).toContain(specialScript);
      expect(html.endsWith("</html>")).toBe(true);
    });
  });

  describe("getHtmlStyles CSS generation", () => {
    test("returns comprehensive CSS stylesheet with CSS variables, typography, and dark mode theme", () => {
      const styles = getHtmlStyles();

      expect(typeof styles).toBe("string");
      expect(styles.length).toBeGreaterThan(500);

      // Root CSS Variables
      expect(styles).toContain("--bg-base: #09090b");
      expect(styles).toContain("--bg-surface: #0f1117");
      expect(styles).toContain("--bg-card: #18181b");
      expect(styles).toContain("--status-pass: #10b981");
      expect(styles).toContain("--status-fail: #ef4444");
      expect(styles).toContain("--status-warn: #f59e0b");
      expect(styles).toContain("--border-subtle:");

      // Base layout and scrollbars
      expect(styles).toContain("::-webkit-scrollbar");
      expect(styles).toContain("font-family: -apple-system");
      expect(styles).toContain(".dashboard-loader");
      expect(styles).toContain("@keyframes spin");

      // Badges
      expect(styles).toContain(".badge-pass");
      expect(styles).toContain(".badge-info");
      expect(styles).toContain(".badge-warn");
      expect(styles).toContain(".badge-fail");
      expect(styles).toContain(".badge-p50");
      expect(styles).toContain(".badge-p90");
      expect(styles).toContain(".badge-pnormal");

      // Controls and Tables
      expect(styles).toContain(".controls-bar");
      expect(styles).toContain(".view-mode-btn");
      expect(styles).toContain(".filter-btn");
      expect(styles).toContain(".search-input");
      expect(styles).toContain(".table-responsive");
      expect(styles).toContain(".mini-progress");
    });

    test("composes code viewer, runtime, unified, and deficit styles cleanly", () => {
      const styles = getHtmlStyles();

      // From styles-code-viewer.ts
      expect(styles).toContain(".code-container");
      expect(styles).toContain(".code-line");

      // From styles-runtime.ts
      expect(styles).toContain(".runtime-");

      // From styles-unified.ts
      expect(styles).toContain(".unified-");

      // From styles-deficit.ts
      expect(styles).toContain(".deficit-");
    });
  });
});

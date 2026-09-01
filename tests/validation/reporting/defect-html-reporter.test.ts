import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { verifyHtmlReporterTemplatePurity } from "../../../olt/scripts/src/validation/index.ts";
import {
  buildHtmlDocument,
  extractCoverageFileData,
  generateInteractiveHtml,
  getClientScript,
  getHtmlStyles,
  writeInteractiveHtml,
  type CoverageSummary,
  type FileCoverageMetric,
} from "../../../scripts/testing/reporting/index.ts";
import {
  cleanupVirtualValidationFS,
  scratchRoot,
  setupVirtualValidationFS,
} from "../validation-fixture.ts";

describe("Defect Remediation: Unterminated template literal TS1160 in scripts/testing/reporting/html/", () => {
  beforeEach(() => {
    setupVirtualValidationFS();
  });

  afterEach(() => {
    cleanupVirtualValidationFS();
  });
  test("runs automated verification audit function and confirms complete remediation", () => {
    const result = verifyHtmlReporterTemplatePurity();
    expect(result.defectRemediated).toBe(true);
    expect(result.defectId).toBe("defect-html-reporter-escaped-backtick-unterminated-literal");
    expect(result.stylesValid).toBe(true);
    expect(result.clientScriptValid).toBe(true);
    expect(result.documentValid).toBe(true);
    expect(result.extractedFilesCount).toBe(1);
    expect(result.errors.length).toBe(0);
  });

  test("generates CSS styles with dark theme tokens and code viewer rules", () => {
    const styles = getHtmlStyles();
    expect(styles).toContain(":root");
    expect(styles).toContain("--bg-base");
    expect(styles).toContain("--brand-accent");
    expect(styles).toContain(".metrics-grid");
    expect(styles).toContain(".file-viewer-header");
    expect(styles).toContain(".code-line.hit");
    expect(styles).toContain(".code-line.miss");
  });

  test("generates client-side interactive script with safe JSON embedding", () => {
    const dummyPayload = JSON.stringify({
      generatedAt: "2026-08-30T00:00:00.000Z",
      total: {
        lines: { total: 50, covered: 45, skipped: 0, pct: 90 },
        statements: { total: 50, covered: 45, skipped: 0, pct: 90 },
        functions: { total: 10, covered: 9, skipped: 0, pct: 90 },
      },
      files: [],
    });

    const script = getClientScript(dummyPayload);
    expect(script).toContain("const DATA =");
    expect(script).toContain("function initMetrics()");
    expect(script).toContain("function renderFolderView()");
    expect(script).toContain("function renderFileView()");
    expect(script).toContain("function jumpToLine(");
    expect(script).toContain("function escapeHtml(");
  });

  test("assembles valid HTML5 document wrapper without unclosed tags", () => {
    const styles = "body { background: #000; }";
    const script = "console.log('init');";
    const doc = buildHtmlDocument(styles, script);

    expect(doc.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(doc).toContain("<title>Test Coverage & Runtime Dashboard - @onurseckin/skills</title>");
    expect(doc).toContain("<style>\nbody { background: #000; }\n  </style>");
    expect(doc).toContain("<script>\nconsole.log('init');\n  </script>");
    expect(doc.endsWith("</html>")).toBe(true);
  });

  test("extracts per-file coverage detail payloads and line hit metadata", () => {
    const vfs = setupVirtualValidationFS();
    const filePath = join(process.cwd(), "scripts/testing/reporting/html/index.ts");
    vfs.mkdirSync(join(process.cwd(), "scripts/testing/reporting/html"), { recursive: true });
    vfs.writeFileSync(filePath, 'export * from "./styles.ts";\nexport * from "./templates.ts";\n');

    const fileMap = new Map<string, FileCoverageMetric>();
    fileMap.set("scripts/testing/reporting/html/index.ts", {
      lines: { total: 50, covered: 50, skipped: 0, pct: 100 },
      statements: { total: 50, covered: 50, skipped: 0, pct: 100 },
      functions: { total: 5, covered: 5, skipped: 0, pct: 100 },
      uncoveredLines: [],
      lineHits: new Map<number, number>([
        [1, 5],
        [2, 5],
      ]),
    });

    const extracted = extractCoverageFileData(fileMap, process.cwd());
    expect(extracted.length).toBe(1);
    expect(extracted[0]?.path).toBe("scripts/testing/reporting/html/index.ts");
    expect(extracted[0]?.linesPct).toBe(100);
    expect(extracted[0]?.sourceLines).toBeDefined();
    expect(extracted[0]?.sourceLines?.length).toBeGreaterThan(0);
  });

  test("generates and writes interactive coverage HTML to disk safely", () => {
    const fileMap = new Map<string, FileCoverageMetric>();
    fileMap.set("test-file.ts", {
      lines: { total: 20, covered: 18, skipped: 0, pct: 90 },
      statements: { total: 20, covered: 18, skipped: 0, pct: 90 },
      functions: { total: 2, covered: 2, skipped: 0, pct: 100 },
      uncoveredLines: [10, 11],
      lineHits: new Map<number, number>([
        [1, 2],
        [10, 0],
      ]),
    });

    const summary: CoverageSummary = {
      total: {
        lines: { total: 20, covered: 18, skipped: 0, pct: 90 },
        statements: { total: 20, covered: 18, skipped: 0, pct: 90 },
        functions: { total: 2, covered: 2, skipped: 0, pct: 100 },
      },
      files: {},
    };

    const outHtml = generateInteractiveHtml(fileMap, summary, process.cwd());
    expect(outHtml).toContain("<!DOCTYPE html>");
    expect(outHtml).toContain("test-file.ts");

    const tmpCoverageDir = scratchRoot("defect-html-reporter", "coverage");
    const writtenPath = writeInteractiveHtml(fileMap, summary, tmpCoverageDir, "out");
    expect(existsSync(writtenPath)).toBe(true);
  });
});

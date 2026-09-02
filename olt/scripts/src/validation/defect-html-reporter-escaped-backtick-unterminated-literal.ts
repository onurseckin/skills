import {
  buildHtmlDocument,
  extractCoverageFileData,
  generateInteractiveHtml,
  getClientScript,
  getHtmlStyles,
  type CoverageSummary,
  type FileCoverageMetric,
} from "../../../../scripts/testing/reporting/index.ts";

export interface HtmlReporterDefectAuditResult {
  readonly defectRemediated: boolean;
  readonly defectId: string;
  readonly stylesValid: boolean;
  readonly clientScriptValid: boolean;
  readonly documentValid: boolean;
  readonly extractedFilesCount: number;
  readonly errors: readonly string[];
}

export function verifyHtmlReporterTemplatePurity(): HtmlReporterDefectAuditResult {
  const errors: string[] = [];

  const styles = getHtmlStyles();
  if (!styles || typeof styles !== "string" || styles.length === 0) {
    errors.push("Failed to generate valid CSS styles string");
  } else if (!styles.includes("--bg-base") || !styles.includes("metrics-grid")) {
    errors.push("CSS styles missing required design tokens");
  }

  const samplePayload = JSON.stringify({
    generatedAt: new Date().toISOString(),
    total: {
      lines: { total: 100, covered: 90, skipped: 0, pct: 90 },
      statements: { total: 100, covered: 90, skipped: 0, pct: 90 },
      functions: { total: 10, covered: 9, skipped: 0, pct: 90 },
    },
    files: [
      {
        path: "src/sample.ts",
        linesPct: 90,
        statementsPct: 90,
        funcsPct: 90,
        linesCovered: 90,
        linesTotal: 100,
        statementsCovered: 90,
        statementsTotal: 100,
        funcsCovered: 9,
        funcsTotal: 10,
        uncoveredLines: [42],
      },
    ],
  });

  const clientScript = getClientScript(samplePayload);
  if (!clientScript || typeof clientScript !== "string" || clientScript.length === 0) {
    errors.push("Failed to generate valid client script string");
  } else if (!clientScript.includes("initMetrics") || !clientScript.includes("renderMasterTable")) {
    errors.push("Client script missing core interactive functions");
  }

  const document = buildHtmlDocument(styles, clientScript);
  if (!document || typeof document !== "string" || !document.startsWith("<!DOCTYPE html>")) {
    errors.push("Failed to generate valid HTML5 document skeleton");
  } else if (!document.includes("<style>") || !document.includes("<script>")) {
    errors.push("HTML document missing style or script inclusion tags");
  }

  const dummyMetric: FileCoverageMetric = {
    file: "src/example.ts",
    lines: { total: 10, covered: 9, skipped: 0, pct: 90 },
    statements: { total: 10, covered: 9, skipped: 0, pct: 90 },
    functions: { total: 2, covered: 2, skipped: 0, pct: 100 },
    uncoveredLines: [5],
    lineHits: new Map<number, number>([
      [1, 1],
      [2, 1],
      [3, 1],
      [4, 1],
      [5, 0],
    ]),
  };

  const fileMap = new Map<string, FileCoverageMetric>([["src/example.ts", dummyMetric]]);
  const summary: CoverageSummary = {
    total: {
      lines: { total: 10, covered: 9, skipped: 0, pct: 90 },
      statements: { total: 10, covered: 9, skipped: 0, pct: 90 },
      functions: { total: 2, covered: 2, skipped: 0, pct: 100 },
    },
    "src/example.ts": {
      lines: { total: 10, covered: 9, skipped: 0, pct: 90 },
      statements: { total: 10, covered: 9, skipped: 0, pct: 90 },
      functions: { total: 2, covered: 2, skipped: 0, pct: 100 },
    },
  };

  const extracted = extractCoverageFileData(fileMap, process.cwd());
  if (extracted.length !== 1 || extracted[0]?.path !== "src/example.ts") {
    errors.push("Coverage data extractor failed to extract per-file metrics");
  }

  const generatedHtml = generateInteractiveHtml(fileMap, summary, process.cwd());
  if (!generatedHtml.includes("<!DOCTYPE html>") || !generatedHtml.includes("src/example.ts")) {
    errors.push("generateInteractiveHtml failed to produce complete dashboard");
  }

  return {
    defectRemediated: errors.length === 0,
    defectId: "defect-html-reporter-escaped-backtick-unterminated-literal",
    stylesValid: styles.length > 0 && !styles.includes("undefined"),
    clientScriptValid: clientScript.length > 0 && errors.length === 0,
    documentValid: document.length > 0 && document.endsWith("</html>"),
    extractedFilesCount: extracted.length,
    errors,
  };
}

export {
  buildHtmlDocument,
  extractCoverageFileData,
  generateInteractiveHtml,
  getClientScript,
  getHtmlStyles,
};

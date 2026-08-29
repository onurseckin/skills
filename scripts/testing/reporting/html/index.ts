/**
 * Interactive HTML Coverage Dashboard Subsystem Entrypoint
 * Assembles data extraction, CSS styles, client-side scripts, and HTML templates
 * to produce and write self-contained interactive coverage dashboards.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { CoverageSummary, FileCoverageMetric } from "../types.ts";
import { getClientScript } from "./client-script.ts";
import { extractCoverageFileData } from "./data-extractor.ts";
import { getHtmlStyles } from "./styles.ts";
import { buildHtmlDocument } from "./templates.ts";

export { getHtmlStyles } from "./styles.ts";
export { getClientScript } from "./client-script.ts";
export { buildHtmlDocument } from "./templates.ts";
export { extractCoverageFileData } from "./data-extractor.ts";

export function generateInteractiveHtml(
  fileMap: Map<string, FileCoverageMetric>,
  summary: CoverageSummary,
  repoRoot: string = process.cwd(),
): string {
  const root = resolve(repoRoot);
  const total = summary.total ?? {
    lines: { total: 0, covered: 0, skipped: 0, pct: 100 },
    statements: { total: 0, covered: 0, skipped: 0, pct: 100 },
    functions: { total: 0, covered: 0, skipped: 0, pct: 100 },
  };

  const filesArray = extractCoverageFileData(fileMap, root);

  const payloadJson = JSON.stringify({
    generatedAt: new Date().toISOString(),
    total,
    files: filesArray,
  }).replace(/<\/script>/gi, "<\\/script>");

  const styles = getHtmlStyles();
  const clientScript = getClientScript(payloadJson);
  return buildHtmlDocument(styles, clientScript);
}

export function writeInteractiveHtml(
  fileMap: Map<string, FileCoverageMetric>,
  summary: CoverageSummary,
  repoRoot: string = process.cwd(),
  coverageDirName: string = "coverage",
): string {
  const root = resolve(repoRoot);
  const covDir = join(root, coverageDirName);
  if (!existsSync(covDir)) {
    mkdirSync(covDir, { recursive: true });
  }
  const outPath = join(covDir, "index.html");
  const html = generateInteractiveHtml(fileMap, summary, root);
  writeFileSync(outPath, html, "utf-8");
  return outPath;
}

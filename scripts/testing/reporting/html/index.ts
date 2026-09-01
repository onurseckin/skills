import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { generateDeficitRoadmap } from "../deficit-clustering.ts";
import type { CoverageSummary, FileCoverageMetric, TestRuntimeSummary } from "../types.ts";
import { buildUnifiedHierarchy, extractCoverageFileData } from "./data-extractor.ts";
import { getHtmlStyles } from "./styles.ts";
import { getClientScript } from "./client-script.ts";
import { buildHtmlDocument } from "./templates.ts";

export type { HashRoute } from "./client-script-deeplink.ts";
export { formatHash, getClientScriptDeeplink, parseHash } from "./client-script-deeplink.ts";
export { getHtmlStyles } from "./styles.ts";
export { getUnifiedStyles } from "./styles-unified.ts";
export { getDeficitStyles } from "./styles-deficit.ts";
export { getCodeViewerStyles } from "./styles-code-viewer.ts";
export { getRuntimeStyles } from "./styles-runtime.ts";
export { getClientScript } from "./client-script.ts";
export { getClientScriptUnified } from "./client-script-unified.ts";
export { getClientScriptDeficits } from "./client-script-deficits.ts";
export { getClientScriptRuntime } from "./client-script-runtime.ts";
export { getClientScriptHelpers } from "./client-script-helpers.ts";
export { buildHtmlDocument } from "./templates.ts";
export {
  buildUnifiedHierarchy,
  extractCoverageFileData,
  findMatchingSourceFile,
  findMatchingTestFile,
} from "./data-extractor.ts";

export function generateInteractiveHtml(
  fileMap: Map<string, FileCoverageMetric>,
  summary: CoverageSummary,
  repoRoot: string = process.cwd(),
  runtime?: TestRuntimeSummary,
): string {
  const root = resolve(repoRoot);
  const total =
    typeof summary.total !== "undefined" && summary.total !== null
      ? summary.total
      : {
          lines: { total: 0, covered: 0, skipped: 0, pct: 100 },
          statements: { total: 0, covered: 0, skipped: 0, pct: 100 },
          functions: { total: 0, covered: 0, skipped: 0, pct: 100 },
        };

  const activeRuntime = runtime ?? summary.runtime;
  const filesArray = extractCoverageFileData(fileMap, root, activeRuntime);
  const tree = buildUnifiedHierarchy(filesArray, activeRuntime);
  const deficits = generateDeficitRoadmap(fileMap, { rootDir: root });

  const payloadJson = JSON.stringify({
    generatedAt: new Date().toISOString(),
    total,
    files: filesArray,
    runtime: activeRuntime,
    tree,
    deficits,
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
  runtime?: TestRuntimeSummary,
): string {
  const root = resolve(repoRoot);
  const covDir = join(root, coverageDirName);
  if (!existsSync(covDir)) {
    mkdirSync(covDir, { recursive: true });
  }
  const outPath = join(covDir, "index.html");
  const html = generateInteractiveHtml(fileMap, summary, root, runtime);
  writeFileSync(outPath, html, "utf-8");
  return outPath;
}

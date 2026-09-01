// @ts-nocheck
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { generateDeficitRoadmap } from "../deficits/index.ts";
import type { CoverageSummary, FileCoverageMetric, TestRuntimeSummary } from "../types.ts";
import { buildUnifiedHierarchy, extractCoverageFileData } from "./data-extractor.ts";
import { getHtmlStyles, getUnifiedStyles, getDeficitStyles, getCodeViewerStyles, getRuntimeStyles } from "./styles/index.ts";
import {
  getClientScript,
  getClientScriptUnified,
  getClientScriptDeficits,
  getClientScriptRuntime,
  getClientScriptHelpers,
  formatHash,
  getClientScriptDeeplink,
  parseHash,
  type HashRoute,
} from "./scripts/index.ts";
import { buildHtmlDocument } from "./templates.ts";

export type { HashRoute };
export { formatHash, getClientScriptDeeplink, parseHash };
export { getHtmlStyles, getUnifiedStyles, getDeficitStyles, getCodeViewerStyles, getRuntimeStyles };
export {
  getClientScript,
  getClientScriptUnified,
  getClientScriptDeficits,
  getClientScriptRuntime,
  getClientScriptHelpers,
};
export { buildHtmlDocument };
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

export function writeInteractiveHtmlReport(
  fileMap: Map<string, FileCoverageMetric>,
  summary: CoverageSummary,
  targetPathOrRepoRoot: string = process.cwd(),
  coverageDirNameOrRepoRoot?: string | TestRuntimeSummary,
  runtime?: TestRuntimeSummary,
): string {
  let resolvedFile: string;
  let repoRoot = process.cwd();
  let activeRuntime = runtime;

  if (typeof coverageDirNameOrRepoRoot === "string") {
    if (coverageDirNameOrRepoRoot.endsWith(".html")) {
      resolvedFile = join(resolve(targetPathOrRepoRoot), coverageDirNameOrRepoRoot);
      repoRoot = resolve(targetPathOrRepoRoot);
    } else {
      resolvedFile = join(resolve(targetPathOrRepoRoot), coverageDirNameOrRepoRoot, "index.html");
      repoRoot = resolve(targetPathOrRepoRoot);
    }
  } else {
    if (typeof coverageDirNameOrRepoRoot === "object") {
      activeRuntime = coverageDirNameOrRepoRoot;
    }
    const resolved = resolve(targetPathOrRepoRoot);
    if (resolved.endsWith(".html")) {
      resolvedFile = resolved;
      repoRoot = join(resolved, "..");
    } else {
      resolvedFile = join(resolved, "index.html");
      repoRoot = resolved;
    }
  }

  const html = generateInteractiveHtml(fileMap, summary, repoRoot, activeRuntime);
  const dir = join(resolvedFile, "..");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(resolvedFile, html, "utf-8");
  return resolvedFile;
}

export const writeInteractiveHtml = writeInteractiveHtmlReport;


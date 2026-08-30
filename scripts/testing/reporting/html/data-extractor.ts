import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { FileCoverageMetric, FileDetailData, SourceLineDetail } from "../types.ts";

export function extractCoverageFileData(
  fileMap: Map<string, FileCoverageMetric>,
  repoRoot: string,
): FileDetailData[] {
  const root = resolve(repoRoot);
  const filesArray: FileDetailData[] = [];

  for (const [relPath, metric] of fileMap.entries()) {
    const fullPath = join(root, relPath);
    let sourceLines: SourceLineDetail[] | undefined;

    if (existsSync(fullPath)) {
      try {
        const rawContent = readFileSync(fullPath, "utf-8");
        const rawLines = rawContent.split("\n");
        const hitsMap = metric.lineHits;

        sourceLines = rawLines.map((lineText, idx) => {
          const lineNo = idx + 1;
          const isExecutable = hitsMap.has(lineNo);
          const hits = isExecutable ? hitsMap.get(lineNo) : undefined;
          return {
            no: lineNo,
            code: lineText,
            hits,
            isExecutable,
          };
        });
      } catch {
        sourceLines = undefined;
      }
    }

    filesArray.push({
      path: relPath,
      linesPct: metric.lines.pct,
      statementsPct: metric.statements.pct,
      funcsPct: metric.functions.pct,
      linesCovered: metric.lines.covered,
      linesTotal: metric.lines.total,
      statementsCovered: metric.statements.covered,
      statementsTotal: metric.statements.total,
      funcsCovered: metric.functions.covered,
      funcsTotal: metric.functions.total,
      uncoveredLines: metric.uncoveredLines,
      sourceLines,
    });
  }

  return filesArray;
}

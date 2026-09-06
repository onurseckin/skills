import { existsSync, lstatSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { RootHygieneFinding } from "./types.ts";

const MAX_STATIC_TRAVERSAL_DEPTH = 12;

function isIgnoredStaticPath(relPath: string, relOlt: string): boolean {
  const norm = relPath.replaceAll("\\", "/");
  const normOlt = relOlt.replaceAll("\\", "/");
  return (
    norm === "olt/references" ||
    norm.startsWith("olt/references/") ||
    normOlt === "references" ||
    normOlt.startsWith("references/") ||
    norm === "olt/scripts/src/ui-validation/quarantine" ||
    norm.startsWith("olt/scripts/src/ui-validation/quarantine/") ||
    normOlt === "scripts/src/ui-validation/quarantine" ||
    normOlt.startsWith("scripts/src/ui-validation/quarantine/")
  );
}

export function scanStaticPackage(
  oltDir: string,
  repoRoot: string,
): { count: number; findings: RootHygieneFinding[] } {
  if (!existsSync(oltDir)) return { count: 0, findings: [] };
  const findings: RootHygieneFinding[] = [];
  const visited = new Set<string>();
  let count = 0;

  function traverse(dir: string, depth: number): void {
    if (depth > MAX_STATIC_TRAVERSAL_DEPTH) return;
    const realDir = resolve(dir);
    if (visited.has(realDir)) return;
    visited.add(realDir);

    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const relPath = relative(repoRoot, fullPath);
      const relOlt = relative(oltDir, fullPath);
      if (isIgnoredStaticPath(relPath, relOlt)) {
        continue;
      }
      count += 1;
      try {
        const stats = lstatSync(fullPath);
        if (stats.isDirectory()) {
          if (["coverage", ".coverage", "logs", "quarantine", ".tmp", "scratch"].includes(entry)) {
            findings.push({
              path: fullPath,
              relativePath: relPath,
              scope: "static_package",
              violationType: "STATIC_PACKAGE_RUNTIME_POLLUTION",
              severity: "ERROR",
              message: `Runtime directory '${entry}' in static package 'olt/'.`,
              isExecutable: false,
              sizeBytes: 0,
            });
          } else {
            traverse(fullPath, depth + 1);
          }
        } else if (stats.isFile()) {
          const isRuntimeFile =
            entry.endsWith(".jsonl") ||
            entry.endsWith(".log") ||
            entry.endsWith(".tmp") ||
            entry === "defects.jsonl" ||
            entry === ".session.json" ||
            entry === "report.json";
          if (isRuntimeFile) {
            findings.push({
              path: fullPath,
              relativePath: relPath,
              scope: "static_package",
              violationType: "STATIC_PACKAGE_RUNTIME_POLLUTION",
              severity: "ERROR",
              message: `Runtime file '${entry}' in static package 'olt/'.`,
              isExecutable: false,
              sizeBytes: stats.size,
            });
          }
        }
      } catch {
        continue;
      }
    }
  }
  traverse(oltDir, 0);
  return { count, findings };
}

import { existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { QuarantinedFileRecord, RootHygieneFinding } from "./types.ts";

export function quarantineViolations(
  repoRoot: string,
  violations: readonly RootHygieneFinding[],
  targetQuarantineDir?: string,
): QuarantinedFileRecord[] {
  const qDir = targetQuarantineDir
    ? resolve(targetQuarantineDir)
    : join(resolve(repoRoot), ".olt", "scratch", "quarantine");
  const records: QuarantinedFileRecord[] = [];
  for (const finding of violations) {
    if (!existsSync(finding.path)) continue;
    try {
      const stats = statSync(finding.path);
      if (stats.isFile()) {
        if (!existsSync(qDir)) mkdirSync(qDir, { recursive: true, mode: 0o700 });
        const stamp = Date.now();
        const safeName = `${stamp}-${finding.scope}-${basename(finding.path)}`;
        const dest = join(qDir, safeName);
        renameSync(finding.path, dest);
        records.push({
          originalPath: finding.path,
          relativePath: finding.relativePath,
          quarantinePath: dest,
          timestamp: new Date(stamp).toISOString(),
          scope: finding.scope,
          success: true,
        });
      }
    } catch (err: unknown) {
      records.push({
        originalPath: finding.path,
        relativePath: finding.relativePath,
        quarantinePath: "",
        timestamp: new Date().toISOString(),
        scope: finding.scope,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return records;
}

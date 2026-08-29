import { existsSync, mkdirSync, readdirSync, renameSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { ALLOWED_ROOT_DIRS, ALLOWED_ROOT_FILES } from "../../authority/guards/constants.ts";
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

export function purgeOrphanedScratch(repoRoot: string): string[] {
  const root = resolve(repoRoot);
  const orphanedDir = join(root, "scratch", "orphaned");
  const scrubbed: string[] = [];

  if (!existsSync(root)) return scrubbed;

  let entries: string[] = [];
  try {
    entries = readdirSync(root);
  } catch {
    return scrubbed;
  }

  for (const entry of entries) {
    if (ALLOWED_ROOT_FILES.has(entry)) continue;
    if (ALLOWED_ROOT_DIRS.has(entry)) continue;

    const fullPath = join(root, entry);
    try {
      const stats = statSync(fullPath);
      if (stats.isFile()) {
        if (!existsSync(orphanedDir)) {
          mkdirSync(orphanedDir, { recursive: true, mode: 0o700 });
        }
        const targetPath = join(orphanedDir, `${Date.now()}-${entry}`);
        renameSync(fullPath, targetPath);
        scrubbed.push(entry);
      }
    } catch {
      continue;
    }
  }

  return scrubbed;
}

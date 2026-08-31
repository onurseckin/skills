import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  renameSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
  type Stats,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { ALLOWED_ROOT_DIRS, ALLOWED_ROOT_FILES } from "../../authority/guards/constants.ts";
import { safeCpSync, safeRmSync } from "../../core/shared/safe-fs/index.ts";
import type { QuarantinedFileRecord, RootHygieneFinding } from "./types.ts";

function safeAtomicMove(source: string, dest: string, stats: Stats): void {
  try {
    renameSync(source, dest);
  } catch (err: unknown) {
    const isExdev =
      err instanceof Error && "code" in err && (err as { code: string }).code === "EXDEV";
    if (!isExdev) throw err;

    if (stats.isSymbolicLink()) {
      const target = readlinkSync(source);
      symlinkSync(target, dest);
      unlinkSync(source);
    } else if (stats.isDirectory()) {
      safeCpSync(source, dest, {
        allowedRoots: [resolve(source), resolve(dest)],
        allowOverwrite: true,
      });
      safeRmSync(source, { allowedRoots: [resolve(source)] });
    } else {
      copyFileSync(source, dest);
      chmodSync(dest, stats.mode);
      utimesSync(dest, stats.atime, stats.mtime);
      unlinkSync(source);
    }
  }
}

export function quarantineViolations(
  repoRoot: string,
  violations: readonly RootHygieneFinding[],
  targetQuarantineDir?: string,
): QuarantinedFileRecord[] {
  const qDir = targetQuarantineDir
    ? resolve(targetQuarantineDir)
    : join(resolve(repoRoot), ".olt", "quarantine");
  const records: QuarantinedFileRecord[] = [];
  let sequence = 0;

  for (const finding of violations) {
    if (!existsSync(finding.path)) continue;
    try {
      const stats = lstatSync(finding.path);
      if (stats.isFile() || stats.isDirectory() || stats.isSymbolicLink()) {
        if (!existsSync(qDir)) mkdirSync(qDir, { recursive: true, mode: 0o700 });
        const stamp = Date.now();
        sequence += 1;
        let safeName = `${stamp}-${sequence}-${finding.scope}-${basename(finding.path)}`;
        let dest = join(qDir, safeName);
        let collisionIndex = 0;
        while (existsSync(dest)) {
          collisionIndex += 1;
          safeName = `${stamp}-${sequence}_${collisionIndex}-${finding.scope}-${basename(finding.path)}`;
          dest = join(qDir, safeName);
        }

        safeAtomicMove(finding.path, dest, stats);
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

  let seq = 0;
  for (const entry of entries) {
    if (ALLOWED_ROOT_FILES.has(entry)) continue;
    if (ALLOWED_ROOT_DIRS.has(entry)) continue;

    const fullPath = join(root, entry);
    try {
      const stats = lstatSync(fullPath);
      if (stats.isFile() || stats.isDirectory() || stats.isSymbolicLink()) {
        if (!existsSync(orphanedDir)) {
          mkdirSync(orphanedDir, { recursive: true, mode: 0o700 });
        }
        seq += 1;
        const stamp = Date.now();
        let targetName = `${stamp}-${seq}-${entry}`;
        let targetPath = join(orphanedDir, targetName);
        let col = 0;
        while (existsSync(targetPath)) {
          col += 1;
          targetName = `${stamp}-${seq}_${col}-${entry}`;
          targetPath = join(orphanedDir, targetName);
        }
        safeAtomicMove(fullPath, targetPath, stats);
        scrubbed.push(entry);
      }
    } catch {
      continue;
    }
  }

  return scrubbed;
}

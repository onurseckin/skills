import { safeCpSync, safeRenameSync, safeRmSync } from "../../core/shared/safe-fs.ts";
import { existsSync, lstatSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";
import {
  BOILERPLATE_CAPSULE_SUBDIRECTORIES,
  type ArchiveCapsuleOptions,
  type ArchiveCapsuleResult,
  type PruneBoilerplateOptions,
  type PruneBoilerplateResult,
} from "./types.ts";

/**
 * Checks whether a directory is empty or contains only ignorable OS files / empty subdirectories.
 */
export function isEffectivelyEmptyDirectory(dirPath: string): boolean {
  if (!existsSync(dirPath)) return true;
  try {
    const stat = lstatSync(dirPath);
    if (!stat.isDirectory()) return false;
    const entries = readdirSync(dirPath);
    if (entries.length === 0) return true;

    for (const entry of entries) {
      if (entry === ".DS_Store") continue;
      const childPath = join(dirPath, entry);
      try {
        const childStat = lstatSync(childPath);
        if (!childStat.isDirectory()) return false;
        if (!isEffectivelyEmptyDirectory(childPath)) return false;
      } catch {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Prunes empty boilerplate subdirectories from an active or archived capsule.
 * Preserves core files and any directory that contains files or data.
 */
export function pruneCapsuleBoilerplate(
  capsulePath: string,
  options: PruneBoilerplateOptions = {},
): PruneBoilerplateResult {
  if (!capsulePath || !existsSync(capsulePath)) {
    throw new HarnessError("INVALID_ARGUMENT", `capsulePath must exist: ${capsulePath}`);
  }
  const resolved = resolve(capsulePath);
  const stat = lstatSync(resolved);
  if (!stat.isDirectory()) {
    throw new HarnessError("INVALID_ARGUMENT", `capsulePath must be a directory: ${capsulePath}`);
  }

  const subdirs = options.subdirectories ?? BOILERPLATE_CAPSULE_SUBDIRECTORIES;
  const prunedDirectories: string[] = [];
  const preservedDirectories: string[] = [];

  for (const subdir of subdirs) {
    const targetPath = join(resolved, subdir);
    if (!existsSync(targetPath)) continue;
    try {
      const subStat = lstatSync(targetPath);
      if (!subStat.isDirectory()) {
        preservedDirectories.push(subdir);
        continue;
      }
      if (isEffectivelyEmptyDirectory(targetPath)) {
        if (!options.dryRun) {
          safeRmSync(targetPath, { allowedRoots: [resolved], missingOk: true });
        }
        prunedDirectories.push(subdir);
      } else {
        preservedDirectories.push(subdir);
      }
    } catch {
      preservedDirectories.push(subdir);
    }
  }

  return {
    capsulePath: resolved,
    prunedDirectories,
    preservedDirectories,
  };
}

function collectCapsuleFileManifest(root: string): Map<string, number> {
  const manifest = new Map<string, number>();
  const walk = (absDir: string, relDir: string): void => {
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      const relPath = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
      const absPath = join(absDir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        walk(absPath, relPath);
        continue;
      }
      if (entry.isFile()) {
        manifest.set(relPath, statSync(absPath).size);
      }
    }
  };
  walk(root, "");
  return manifest;
}

export function assertCapsuleCopyComplete(sourceRoot: string, targetRoot: string): void {
  const sourceManifest = collectCapsuleFileManifest(sourceRoot);
  if (!existsSync(targetRoot)) {
    throw new HarnessError(
      "INTEGRITY",
      `archiveCapsule: copy target does not exist after cpSync: '${targetRoot}'; refusing to delete source '${sourceRoot}'`,
    );
  }
  const targetManifest = collectCapsuleFileManifest(targetRoot);
  for (const [relPath, size] of sourceManifest) {
    const copiedSize = targetManifest.get(relPath);
    if (copiedSize === undefined) {
      throw new HarnessError(
        "INTEGRITY",
        `archiveCapsule: cross-device copy of '${sourceRoot}' is missing '${relPath}' in '${targetRoot}'; refusing to delete the source until the copy is verified complete`,
      );
    }
    if (copiedSize !== size) {
      throw new HarnessError(
        "INTEGRITY",
        `archiveCapsule: cross-device copy of '${relPath}' has size ${copiedSize}, expected ${size}; refusing to delete source '${sourceRoot}' until the copy is verified complete`,
      );
    }
  }
}

/**
 * Archives a legacy capsule root by moving it to .capsules/archive/<runId>
 * and pruning empty boilerplate subdirectories.
 */
export function archiveCapsule(
  sourceCapsulePath: string,
  options: ArchiveCapsuleOptions = {},
): ArchiveCapsuleResult {
  if (!sourceCapsulePath || !existsSync(sourceCapsulePath)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `sourceCapsulePath must exist: ${sourceCapsulePath}`,
    );
  }
  const resolvedSource = resolve(sourceCapsulePath);
  const stat = lstatSync(resolvedSource);
  if (!stat.isDirectory()) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `sourceCapsulePath must be a directory: ${sourceCapsulePath}`,
    );
  }

  const runId = basename(resolvedSource);
  const parentDir = dirname(resolvedSource);
  const archiveDir = options.targetArchiveDir
    ? resolve(options.targetArchiveDir)
    : join(parentDir, "archive");
  const targetPath = join(archiveDir, runId);
  const allowedRoots = [...new Set([parentDir, archiveDir])];
  const allowGitRepositoryDeletion = options.allowGitRepositoryDeletion ?? false;

  if (existsSync(targetPath)) {
    if (options.overwrite) {
      if (!options.dryRun) {
        safeRmSync(targetPath, { allowedRoots, allowGitRepositoryDeletion, missingOk: true });
      }
    } else {
      throw new HarnessError(
        "INVALID_STATE",
        `Target archived capsule already exists: ${targetPath}`,
      );
    }
  }

  let prunedDirectories: string[] = [];

  if (!options.dryRun) {
    if (!existsSync(archiveDir)) {
      mkdirSync(archiveDir, { recursive: true, mode: 0o755 });
    }
    try {
      safeRenameSync(resolvedSource, targetPath, { allowedRoots, allowGitRepositoryDeletion });
    } catch (error) {
      if (error instanceof HarnessError) throw error;
      safeCpSync(resolvedSource, targetPath, { allowedRoots });
      assertCapsuleCopyComplete(resolvedSource, targetPath);
      safeRmSync(resolvedSource, { allowedRoots, allowGitRepositoryDeletion, missingOk: true });
    }

    if (options.pruneBoilerplate !== false) {
      const pruneRes = pruneCapsuleBoilerplate(targetPath);
      prunedDirectories = [...pruneRes.prunedDirectories];
    }
  }

  return {
    sourcePath: resolvedSource,
    archivedPath: targetPath,
    runId,
    prunedDirectories,
  };
}

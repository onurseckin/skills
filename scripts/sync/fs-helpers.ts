import {
  existsSync,
  lstatSync,
  readFileSync,
  readlinkSync,
  renameSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
  type Stats,
} from "node:fs";
import { join } from "node:path";
import type { JsonObject } from "../../olt/scripts/src/core/contracts/json.ts";
import { HarnessError } from "../../olt/scripts/src/core/errors/harness-error.ts";
import {
  assertSafeToDelete,
  safeCpSync,
  safeRmSync,
  type DestructiveAuditEvent,
} from "../../olt/scripts/src/core/shared/safe-fs/index.ts";

export const FALLBACK_MARKER = ".olt-sync-managed.json";

export function logDestructiveOp(event: DestructiveAuditEvent): void {
  process.stderr.write(`[sync-audit] ${JSON.stringify(event)}\n`);
}

export interface GuardedRemoveOptions {
  readonly allowedRoots: readonly string[];
  readonly missingOk?: boolean;
  readonly allowGitRepositoryDeletion?: boolean;
  readonly onAudit?: (event: DestructiveAuditEvent) => void;
}

export function guardedRemoveSync(targetPath: string, options: GuardedRemoveOptions): void {
  safeRmSync(targetPath, {
    allowedRoots: options.allowedRoots,
    missingOk: options.missingOk !== undefined ? options.missingOk : true,
    allowGitRepositoryDeletion:
      options.allowGitRepositoryDeletion !== undefined ? options.allowGitRepositoryDeletion : false,
    onAudit: options.onAudit !== undefined ? options.onAudit : logDestructiveOp,
  });
}

export interface FsDriver {
  readonly lstatSync?: (path: string) => Stats;
  readonly readlinkSync?: (path: string) => string;
  readonly symlinkSync?: (target: string, path: string) => void;
  readonly renameSync?: (oldPath: string, newPath: string) => void;
  readonly unlinkSync?: (path: string) => void;
}

export interface SmartEnsureSymlinkOptions {
  readonly allowedRoots: readonly string[];
  readonly onAudit?: (event: DestructiveAuditEvent) => void;
  readonly fsDriver?: FsDriver;
  readonly allowGitRepositoryDeletion?: boolean;
}

function readExistingEntry(
  linkPath: string,
  customLstat?: (path: string) => Stats,
): Stats | undefined {
  try {
    const fn = customLstat !== undefined ? customLstat : lstatSync;
    return fn(linkPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function describeKind(stats: Stats): string {
  if (stats.isDirectory()) return "directory";
  if (stats.isFile()) return "file";
  return "non-symlink filesystem entry";
}

export function isManagedFallbackCopy(dirPath: string, expectedTarget: string): boolean {
  try {
    const markerFile = join(dirPath, FALLBACK_MARKER);
    if (!existsSync(markerFile)) return false;
    const data = JSON.parse(readFileSync(markerFile, "utf-8")) as { target?: string };
    return data.target === expectedTarget;
  } catch {
    return false;
  }
}

export function smartEnsureSymlink(
  target: string,
  linkPath: string,
  options: SmartEnsureSymlinkOptions,
): "skipped" | "created" {
  const onAudit = options.onAudit !== undefined ? options.onAudit : logDestructiveOp;
  const readlinkFn =
    options.fsDriver?.readlinkSync !== undefined ? options.fsDriver.readlinkSync : readlinkSync;
  const symlinkFn =
    options.fsDriver?.symlinkSync !== undefined ? options.fsDriver.symlinkSync : symlinkSync;
  const renameFn =
    options.fsDriver?.renameSync !== undefined ? options.fsDriver.renameSync : renameSync;
  const unlinkFn =
    options.fsDriver?.unlinkSync !== undefined ? options.fsDriver.unlinkSync : unlinkSync;
  const allowGit =
    options.allowGitRepositoryDeletion !== undefined ? options.allowGitRepositoryDeletion : false;

  assertSafeToDelete(linkPath, {
    allowedRoots: options.allowedRoots,
    missingOk: true,
    allowGitRepositoryDeletion: allowGit,
  });
  const existing = readExistingEntry(linkPath, options.fsDriver?.lstatSync);

  if (existing !== undefined) {
    if (!existing.isSymbolicLink()) {
      const isOwnedFallback = existing.isDirectory() && isManagedFallbackCopy(linkPath, target);
      if (!isOwnedFallback) {
        const issue: JsonObject = { linkPath, target, kind: describeKind(existing) };
        throw new HarnessError(
          "PATH_SAFETY",
          `smartEnsureSymlink refuses to replace a real ${describeKind(existing)} at '${linkPath}' with a symlink to '${target}'; only a symlink it can prove it owns may be replaced here, resolve this by hand`,
          [issue],
        );
      }
    } else {
      let currentTarget: string | undefined;
      try {
        currentTarget = readlinkFn(linkPath);
      } catch {
        currentTarget = undefined;
      }
      if (currentTarget === target) {
        return "skipped";
      }
    }
  }

  const nonce = `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  const tempLinkPath = `${linkPath}.tmp-${nonce}`;

  assertSafeToDelete(tempLinkPath, {
    allowedRoots: options.allowedRoots,
    missingOk: true,
    allowGitRepositoryDeletion: allowGit,
  });

  try {
    symlinkFn(target, tempLinkPath);
    renameFn(tempLinkPath, linkPath);
    return "created";
  } catch {
    try {
      unlinkFn(tempLinkPath);
    } catch {}

    if (existing !== undefined) {
      guardedRemoveSync(linkPath, {
        allowedRoots: options.allowedRoots,
        missingOk: true,
        allowGitRepositoryDeletion: allowGit,
        onAudit,
      });
    }

    safeCpSync(target, linkPath, {
      allowedRoots: options.allowedRoots,
      allowOverwrite: false,
      onAudit,
    });

    try {
      if (existsSync(linkPath) && lstatSync(linkPath).isDirectory()) {
        writeFileSync(
          join(linkPath, FALLBACK_MARKER),
          JSON.stringify({
            target,
            managedBy: "@onurseckin/skills",
            createdAt: new Date().toISOString(),
          }),
          "utf-8",
        );
      }
    } catch {}

    return "created";
  }
}

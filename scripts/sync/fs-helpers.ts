import { lstatSync, readlinkSync, symlinkSync, type Stats } from "node:fs";
import type { JsonObject } from "../../olt/scripts/src/core/contracts/json.ts";
import { HarnessError } from "../../olt/scripts/src/core/errors/harness-error.ts";
import {
  assertSafeToDelete,
  safeCpSync,
  safeRmSync,
  type DestructiveAuditEvent,
} from "../../olt/scripts/src/core/shared/safe-fs.ts";

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
    missingOk: options.missingOk ?? true,
    allowGitRepositoryDeletion: options.allowGitRepositoryDeletion ?? false,
    onAudit: options.onAudit ?? logDestructiveOp,
  });
}

export interface SmartEnsureSymlinkOptions {
  readonly allowedRoots: readonly string[];
  readonly onAudit?: (event: DestructiveAuditEvent) => void;
}

function readExistingEntry(linkPath: string): Stats | undefined {
  try {
    return lstatSync(linkPath);
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

export function smartEnsureSymlink(
  target: string,
  linkPath: string,
  options: SmartEnsureSymlinkOptions,
): "skipped" | "created" {
  const onAudit = options.onAudit ?? logDestructiveOp;
  assertSafeToDelete(linkPath, { allowedRoots: options.allowedRoots, missingOk: true });
  const existing = readExistingEntry(linkPath);

  if (existing !== undefined) {
    if (!existing.isSymbolicLink()) {
      const issue: JsonObject = { linkPath, target, kind: describeKind(existing) };
      throw new HarnessError(
        "PATH_SAFETY",
        `smartEnsureSymlink refuses to replace a real ${describeKind(existing)} at '${linkPath}' with a symlink to '${target}'; only a symlink it can prove it owns may be replaced here, resolve this by hand`,
        [issue],
      );
    }

    let currentTarget: string | undefined;
    try {
      currentTarget = readlinkSync(linkPath);
    } catch {
      currentTarget = undefined;
    }
    if (currentTarget === target) {
      return "skipped";
    }

    guardedRemoveSync(linkPath, {
      allowedRoots: options.allowedRoots,
      missingOk: true,
      onAudit,
    });
  }

  try {
    symlinkSync(target, linkPath);
  } catch {
    safeCpSync(target, linkPath, {
      allowedRoots: options.allowedRoots,
      allowOverwrite: false,
      onAudit,
    });
  }
  return "created";
}

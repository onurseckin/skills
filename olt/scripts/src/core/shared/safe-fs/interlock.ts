import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve, sep } from "node:path";
import type { JsonObject } from "../../contracts/index.ts";
import { HarnessError } from "../../errors/index.ts";
import {
  MIN_PATH_SEGMENTS,
  canonicalizeTarget,
  isSelfOrStrictAncestor,
  pathExists,
  realpathOfExistingAncestor,
  segmentCount,
} from "./path-safety.ts";

export type SafeFsRefusalRule =
  | "ABSOLUTE_DENYLIST_CWD"
  | "ABSOLUTE_DENYLIST_CWD_ANCESTOR"
  | "ABSOLUTE_DENYLIST_FILESYSTEM_ROOT"
  | "ABSOLUTE_DENYLIST_HOME_CHILD"
  | "ABSOLUTE_DENYLIST_HOME_DIRECTORY"
  | "ABSOLUTE_DENYLIST_TOO_SHALLOW"
  | "COPY_DESTINATION_EXISTS"
  | "CONTAINMENT"
  | "NO_ALLOWED_ROOTS"
  | "REPOSITORY_INTERLOCK"
  | "SOURCE_MISSING";

export interface DestructiveAuditEvent {
  readonly operation: "copy" | "delete" | "mkdir" | "rename" | "write";
  readonly requestedPath: string;
  readonly resolvedPath: string;
  readonly timestamp: string;
  readonly extra?: Readonly<Record<string, string>>;
}

export type AuditSink = (event: DestructiveAuditEvent) => void;

export interface SafeDeleteOptions {
  readonly allowedRoots: readonly string[];
  readonly allowGitRepositoryDeletion?: boolean;
  readonly missingOk?: boolean;
  readonly onAudit?: AuditSink;
}

export function refuse(
  rule: SafeFsRefusalRule,
  target: string,
  allowedRoots: readonly string[],
  detail: string,
): never {
  const issue: JsonObject = {
    rule,
    target,
    allowedRoots: [...allowedRoots],
  };
  throw new HarnessError(
    "PATH_SAFETY",
    `safe-fs refused [${rule}] target '${target}' against allowed roots [${allowedRoots.join(", ") || "<none>"}]: ${detail}`,
    [issue],
  );
}

export function assertNotDenylisted(target: string, allowedRoots: readonly string[]): void {
  const home = resolve(homedir());
  const cwd = resolve(process.cwd());
  const root = resolve(sep);

  if (target === root) {
    refuse(
      "ABSOLUTE_DENYLIST_FILESYSTEM_ROOT",
      target,
      allowedRoots,
      "target is the filesystem root",
    );
  }
  if (target === home) {
    refuse(
      "ABSOLUTE_DENYLIST_HOME_DIRECTORY",
      target,
      allowedRoots,
      "target is the user's home directory",
    );
  }
  if (dirname(target) === home) {
    refuse(
      "ABSOLUTE_DENYLIST_HOME_CHILD",
      target,
      allowedRoots,
      "target is a direct child of the user's home directory",
    );
  }
  if (segmentCount(target) < MIN_PATH_SEGMENTS) {
    refuse(
      "ABSOLUTE_DENYLIST_TOO_SHALLOW",
      target,
      allowedRoots,
      `target has fewer than ${MIN_PATH_SEGMENTS} path segments`,
    );
  }
  if (target === cwd) {
    refuse(
      "ABSOLUTE_DENYLIST_CWD",
      target,
      allowedRoots,
      "target is the current working directory",
    );
  }
  if (isSelfOrStrictAncestor(target, cwd) && target !== cwd) {
    refuse(
      "ABSOLUTE_DENYLIST_CWD_ANCESTOR",
      target,
      allowedRoots,
      "target is an ancestor of the current working directory",
    );
  }
}

export function assertWithinAllowedRoots(target: string, allowedRoots: readonly string[]): string {
  if (allowedRoots.length === 0) {
    refuse("NO_ALLOWED_ROOTS", target, allowedRoots, "no allowed roots were provided");
  }
  for (const declaredRoot of allowedRoots) {
    const canonicalRoot = realpathOfExistingAncestor(resolve(declaredRoot));
    const withSep = canonicalRoot.endsWith(sep) ? canonicalRoot : canonicalRoot + sep;
    if (target !== canonicalRoot && target.startsWith(withSep)) {
      return canonicalRoot;
    }
  }
  refuse(
    "CONTAINMENT",
    target,
    allowedRoots,
    "target must be strictly inside one of the allowed roots, and cannot equal or be an ancestor of one",
  );
}

export function assertNoRepositoryBoundaryCrossed(
  target: string,
  boundary: string,
  allowGitRepositoryDeletion: boolean,
  allowedRoots: readonly string[],
): void {
  if (allowGitRepositoryDeletion) return;
  let current = target;
  while (true) {
    if (existsSync(resolve(current, ".git"))) {
      refuse(
        "REPOSITORY_INTERLOCK",
        target,
        allowedRoots,
        `'${current}' contains a .git entry; pass allowGitRepositoryDeletion:true to override`,
      );
    }
    if (current === boundary) break;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

export function assertSafeToDelete(
  targetPath: string,
  options: SafeDeleteOptions,
): { readonly resolvedPath: string; readonly exists: boolean } {
  const canonical = canonicalizeTarget(targetPath);
  assertNotDenylisted(canonical, options.allowedRoots);
  const boundary = assertWithinAllowedRoots(canonical, options.allowedRoots);
  assertNoRepositoryBoundaryCrossed(
    canonical,
    boundary,
    options.allowGitRepositoryDeletion ?? false,
    options.allowedRoots,
  );
  const exists = pathExists(canonical);
  if (!exists && !options.missingOk) {
    throw new HarnessError(
      "INVALID_STATE",
      `safe-fs: delete target does not exist and missingOk was not set: '${canonical}'`,
      [{ target: canonical } satisfies JsonObject],
    );
  }
  return { resolvedPath: canonical, exists };
}

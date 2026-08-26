import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, resolve, sep } from "node:path";
import type { JsonObject } from "../contracts/json.ts";
import { HarnessError } from "../errors/harness-error.ts";

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

const MIN_PATH_SEGMENTS = 3;

export interface DestructiveAuditEvent {
  readonly operation: "copy" | "delete" | "mkdir" | "rename" | "write";
  readonly requestedPath: string;
  readonly resolvedPath: string;
  readonly timestamp: string;
  readonly extra?: Readonly<Record<string, string>>;
}

type AuditSink = (event: DestructiveAuditEvent) => void;

export interface SafeDeleteOptions {
  readonly allowedRoots: readonly string[];
  readonly allowGitRepositoryDeletion?: boolean;
  readonly missingOk?: boolean;
  readonly onAudit?: AuditSink;
}

export interface SafeRenameOptions {
  readonly allowedRoots: readonly string[];
  readonly allowGitRepositoryDeletion?: boolean;
  readonly onAudit?: AuditSink;
}

export interface SafeWriteOptions {
  readonly allowedRoots: readonly string[];
  readonly onAudit?: AuditSink;
}

export interface SafeCopyOptions extends SafeWriteOptions {
  readonly allowOverwrite?: boolean;
}

export interface SafeMkdirOptions extends SafeWriteOptions {
  readonly recursive?: boolean;
}

function refuse(
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

function pathExists(target: string): boolean {
  try {
    lstatSync(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function realpathOfExistingAncestor(target: string): string {
  const resolved = resolve(target);
  try {
    return realpathSync(resolved);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const parent = dirname(resolved);
    if (parent === resolved) return resolved;
    return resolve(realpathOfExistingAncestor(parent), basename(resolved));
  }
}

function canonicalizeTarget(target: string): string {
  const resolved = resolve(target);
  const parent = dirname(resolved);
  if (parent === resolved) return resolved;
  const realParent = realpathOfExistingAncestor(parent);
  return resolve(realParent, basename(resolved));
}

function segmentCount(target: string): number {
  return target.split(sep).filter((segment) => segment.length > 0).length;
}

function isSelfOrStrictAncestor(ancestor: string, descendant: string): boolean {
  if (ancestor === descendant) return true;
  const withSep = ancestor.endsWith(sep) ? ancestor : ancestor + sep;
  return descendant.startsWith(withSep);
}

function assertNotDenylisted(target: string, allowedRoots: readonly string[]): void {
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

function assertWithinAllowedRoots(target: string, allowedRoots: readonly string[]): string {
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

function assertNoRepositoryBoundaryCrossed(
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

function emitAudit(
  sink: AuditSink | undefined,
  event: Omit<DestructiveAuditEvent, "timestamp">,
): void {
  if (!sink) return;
  sink({ ...event, timestamp: new Date().toISOString() });
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

export function safeRmSync(targetPath: string, options: SafeDeleteOptions): void {
  const { resolvedPath, exists } = assertSafeToDelete(targetPath, options);
  if (!exists) return;
  rmSync(resolvedPath, { recursive: true, force: true });
  emitAudit(options.onAudit, {
    operation: "delete",
    requestedPath: targetPath,
    resolvedPath,
  });
}

export function safeRenameSync(fromPath: string, toPath: string, options: SafeRenameOptions): void {
  const fromCanonical = canonicalizeTarget(fromPath);
  assertNotDenylisted(fromCanonical, options.allowedRoots);
  const fromBoundary = assertWithinAllowedRoots(fromCanonical, options.allowedRoots);
  assertNoRepositoryBoundaryCrossed(
    fromCanonical,
    fromBoundary,
    options.allowGitRepositoryDeletion ?? false,
    options.allowedRoots,
  );
  if (!pathExists(fromCanonical)) {
    refuse("SOURCE_MISSING", fromCanonical, options.allowedRoots, "rename source does not exist");
  }

  const toCanonical = canonicalizeTarget(toPath);
  assertNotDenylisted(toCanonical, options.allowedRoots);
  assertWithinAllowedRoots(toCanonical, options.allowedRoots);

  renameSync(fromCanonical, toCanonical);
  emitAudit(options.onAudit, {
    operation: "rename",
    requestedPath: fromPath,
    resolvedPath: toCanonical,
    extra: { from: fromCanonical },
  });
}

export function safeCpSync(fromPath: string, toPath: string, options: SafeCopyOptions): void {
  const toCanonical = canonicalizeTarget(toPath);
  assertNotDenylisted(toCanonical, options.allowedRoots);
  assertWithinAllowedRoots(toCanonical, options.allowedRoots);
  if (!(options.allowOverwrite ?? false) && pathExists(toCanonical)) {
    refuse(
      "COPY_DESTINATION_EXISTS",
      toCanonical,
      options.allowedRoots,
      "destination already exists; pass allowOverwrite:true to override",
    );
  }
  cpSync(fromPath, toCanonical, { recursive: true });
  emitAudit(options.onAudit, {
    operation: "copy",
    requestedPath: toPath,
    resolvedPath: toCanonical,
    extra: { from: resolve(fromPath) },
  });
}

export function safeWriteFileSync(
  targetPath: string,
  data: NodeJS.ArrayBufferView | string,
  options: SafeWriteOptions,
): void {
  const canonical = canonicalizeTarget(targetPath);
  assertNotDenylisted(canonical, options.allowedRoots);
  assertWithinAllowedRoots(canonical, options.allowedRoots);
  writeFileSync(canonical, data);
  emitAudit(options.onAudit, {
    operation: "write",
    requestedPath: targetPath,
    resolvedPath: canonical,
  });
}

export function safeMkdirSync(targetPath: string, options: SafeMkdirOptions): void {
  const canonical = canonicalizeTarget(targetPath);
  assertNotDenylisted(canonical, options.allowedRoots);
  assertWithinAllowedRoots(canonical, options.allowedRoots);
  mkdirSync(canonical, { recursive: options.recursive ?? true });
  emitAudit(options.onAudit, {
    operation: "mkdir",
    requestedPath: targetPath,
    resolvedPath: canonical,
  });
}

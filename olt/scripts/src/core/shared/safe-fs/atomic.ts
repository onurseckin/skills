import { cpSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { canonicalizeTarget, pathExists } from "./path-safety.ts";
import {
  assertNoRepositoryBoundaryCrossed,
  assertNotDenylisted,
  assertSafeToDelete,
  assertWithinAllowedRoots,
  refuse,
} from "./interlock.ts";
import type { AuditSink, DestructiveAuditEvent, SafeDeleteOptions } from "./interlock.ts";

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

export function emitAudit(
  sink: AuditSink | undefined,
  event: Omit<DestructiveAuditEvent, "timestamp">,
): void {
  if (!sink) return;
  sink({ ...event, timestamp: new Date().toISOString() });
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

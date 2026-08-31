import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";
import type { MailboxEnvelope, MailboxPaths } from "../types.ts";

export interface ReadUnreadMessagesOptions {
  readonly quarantinePath?: string;
  readonly verifyHmac?: boolean;
  readonly secretKey?: string;
  readonly lockPath?: string;
}

export interface ReadUnreadMessagesResult {
  readonly messages: readonly MailboxEnvelope<unknown>[];
  readonly quarantinedCount: number;
}

export interface RotateMailboxOptions {
  readonly maxActiveMessages?: number;
  readonly lockPath?: string;
}

export function isValidAgentId(agentId: unknown): agentId is string {
  if (typeof agentId !== "string" || agentId.trim().length === 0) return false;
  if (agentId === "." || agentId.includes("..")) return false;
  if (agentId.includes("/") || agentId.includes("\\") || agentId.includes("\0")) return false;
  return true;
}

export function isVirtualMailboxPath(filePath: string): boolean {
  if (typeof filePath !== "string") return false;
  return (
    filePath.startsWith("virtual:") ||
    filePath.startsWith("mem:") ||
    filePath.startsWith("/virtual/") ||
    filePath.startsWith("/mem/")
  );
}

const inMemoryDirs = new Set<string>();

export function registerInMemoryMailboxDir(dir: string): void {
  if (typeof dir === "string" && dir.trim().length > 0) inMemoryDirs.add(dir.trim());
}

export function isInMemoryMailboxDir(dir: string): boolean {
  return inMemoryDirs.has(dir);
}

export function getInMemoryMailboxDirs(): readonly string[] {
  return Array.from(inMemoryDirs);
}

export function clearInMemoryMailboxDirs(): void {
  inMemoryDirs.clear();
}

export { clearInMemoryMailboxDirs as resetInMemoryMailboxDirs };

function trimTrailingSlashes(p: string): string {
  let end = p.length;
  while (end > 0 && (p[end - 1] === "/" || p[end - 1] === "\\")) end--;
  return p.slice(0, end);
}

function getDirname(p: string): string {
  const lastSlash = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return lastSlash > 0 ? p.slice(0, lastSlash) : p;
}

export function ensureParentDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
}

export function defaultLockPathFor(filePath: string): string {
  const res = resolve(filePath),
    m = res.match(/[/\\].olt[/\\]mailboxes[/\\]([^/\\]+)[/\\]/);
  return m?.[1]
    ? join(res.slice(0, res.indexOf(".olt")), ".olt", "locks", "mailboxes", `${m[1]}.lock`)
    : `${filePath}.lock`;
}

export function resolveMailboxPaths(agentId: string, baseDir?: string): MailboxPaths {
  if (typeof agentId !== "string" || agentId.trim().length === 0) {
    throw new HarnessError("INVALID_ARGUMENT", "agentId must be a non-empty string");
  }
  if (!isValidAgentId(agentId)) {
    throw new HarnessError("PATH_SAFETY", `Invalid agentId '${agentId}'`);
  }

  const root = baseDir
    ? isVirtualMailboxPath(baseDir)
      ? `${trimTrailingSlashes(baseDir)}/.olt`
      : baseDir.includes(".olt")
        ? resolve(baseDir)
        : join(resolve(baseDir), ".olt")
    : join(resolve(process.cwd()), ".olt");
  const agentMailboxDir = isVirtualMailboxPath(root)
    ? `${root}/mailboxes/${agentId}`
    : join(root, "mailboxes", agentId);
  const locksDir = isVirtualMailboxPath(root)
    ? `${root}/locks/mailboxes`
    : join(root, "locks", "mailboxes");

  return {
    agentMailboxDir,
    inboxPath: isVirtualMailboxPath(root)
      ? `${agentMailboxDir}/inbox.jsonl`
      : join(agentMailboxDir, "inbox.jsonl"),
    outboxPath: isVirtualMailboxPath(root)
      ? `${agentMailboxDir}/outbox.jsonl`
      : join(agentMailboxDir, "outbox.jsonl"),
    archivePath: isVirtualMailboxPath(root)
      ? `${agentMailboxDir}/archive.jsonl`
      : join(agentMailboxDir, "archive.jsonl"),
    cursorPath: isVirtualMailboxPath(root)
      ? `${agentMailboxDir}/cursor.json`
      : join(agentMailboxDir, "cursor.json"),
    quarantinePath: isVirtualMailboxPath(root)
      ? `${agentMailboxDir}/quarantine.log`
      : join(agentMailboxDir, "quarantine.log"),
    lockPath: isVirtualMailboxPath(root)
      ? `${locksDir}/${agentId}.lock`
      : join(locksDir, `${agentId}.lock`),
  };
}

export function resolveMailboxLockPath(agentId: string, baseDir?: string): string {
  return resolveMailboxPaths(agentId, baseDir).lockPath;
}

export function resolveSystemLockPath(lockName: string, repoRoot?: string): string {
  if (typeof lockName !== "string" || lockName.trim().length === 0) {
    throw new HarnessError("INVALID_ARGUMENT", "lockName must be a non-empty string");
  }
  const clean = lockName.replace(/\.lock$|\.flock$/, "");
  if (!isValidAgentId(clean)) {
    throw new HarnessError("PATH_SAFETY", `Invalid lockName '${lockName}'`);
  }
  const root = repoRoot
    ? repoRoot.includes(".olt")
      ? resolve(repoRoot)
      : join(resolve(repoRoot), ".olt")
    : join(resolve(process.cwd()), ".olt");
  return join(root, "locks", lockName);
}

export function ensureMailboxDirectories(paths: MailboxPaths): MailboxPaths {
  if (!paths || typeof paths !== "object" || Array.isArray(paths)) {
    throw new HarnessError("INVALID_ARGUMENT", "paths must be a valid MailboxPaths object");
  }
  if (typeof paths.agentMailboxDir !== "string" || paths.agentMailboxDir.trim().length === 0) {
    throw new HarnessError("INVALID_ARGUMENT", "paths.agentMailboxDir must be a non-empty string");
  }
  if (typeof paths.lockPath !== "string" || paths.lockPath.trim().length === 0) {
    throw new HarnessError("INVALID_ARGUMENT", "paths.lockPath must be a non-empty string");
  }
  if (isVirtualMailboxPath(paths.agentMailboxDir)) {
    registerInMemoryMailboxDir(paths.agentMailboxDir);
    registerInMemoryMailboxDir(dirname(paths.lockPath));
    return paths;
  }
  try {
    if (!existsSync(paths.agentMailboxDir))
      mkdirSync(paths.agentMailboxDir, { recursive: true, mode: 0o700 });
    const lockDir = dirname(paths.lockPath);
    if (!existsSync(lockDir)) mkdirSync(lockDir, { recursive: true, mode: 0o700 });
  } catch (err) {
    throw new HarnessError("INTEGRITY", `Failed to create mailbox directories: ${String(err)}`);
  }
  return paths;
}

export function ensureMailboxDir(agentId: string, baseDir?: string): MailboxPaths {
  return ensureMailboxDirectories(resolveMailboxPaths(agentId, baseDir));
}

export function listMailboxAgentIds(baseDir?: string): readonly string[] {
  if (baseDir && isVirtualMailboxPath(baseDir)) {
    const norm = trimTrailingSlashes(baseDir);
    const result: string[] = [];
    for (const dir of inMemoryDirs) {
      if (getDirname(dir) === norm) {
        const id = dir.slice(norm.length + 1);
        if (isValidAgentId(id)) result.push(id);
      }
    }
    return result;
  }
  return [];
}

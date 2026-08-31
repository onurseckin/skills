import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";
import type { MailboxPaths } from "../types.ts";

export function isValidAgentId(agentId: unknown): agentId is string {
  if (typeof agentId !== "string") return false;
  if (agentId.trim().length === 0) return false;
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
  if (typeof dir === "string" && dir.trim().length > 0) {
    inMemoryDirs.add(dir.trim());
  }
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

function trimTrailingSlashes(p: string): string {
  let end = p.length;
  while (end > 0 && (p[end - 1] === "/" || p[end - 1] === "\\")) {
    end--;
  }
  return p.slice(0, end);
}

function getDirname(p: string): string {
  const lastSlash = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return lastSlash > 0 ? p.slice(0, lastSlash) : p;
}

export function resolveMailboxLockPath(agentId: string, baseDir?: string): string {
  if (typeof agentId !== "string" || agentId.trim().length === 0) {
    throw new HarnessError("INVALID_ARGUMENT", "agentId must be a non-empty string");
  }
  if (!isValidAgentId(agentId)) {
    throw new HarnessError(
      "PATH_SAFETY",
      `Invalid agentId '${agentId}': cannot contain path separators or traversal elements`,
    );
  }

  const effectiveBase = baseDir !== undefined ? baseDir : process.cwd();
  if (effectiveBase.startsWith("virtual:") || effectiveBase.startsWith("mem:")) {
    const root = trimTrailingSlashes(effectiveBase);
    return `${root}/.olt/locks/mailboxes/${agentId}.lock`;
  }
  const root = resolve(effectiveBase);
  return join(root, ".olt", "locks", "mailboxes", `${agentId}.lock`);
}

export function resolveMailboxPaths(agentId: string, baseDir?: string): MailboxPaths {
  if (typeof agentId !== "string" || agentId.trim().length === 0) {
    throw new HarnessError("INVALID_ARGUMENT", "agentId must be a non-empty string");
  }
  if (!isValidAgentId(agentId)) {
    throw new HarnessError(
      "PATH_SAFETY",
      `Invalid agentId '${agentId}': cannot contain path separators or traversal elements`,
    );
  }

  const effectiveBase = baseDir !== undefined ? baseDir : process.cwd();
  if (effectiveBase.startsWith("virtual:") || effectiveBase.startsWith("mem:")) {
    const root = trimTrailingSlashes(effectiveBase);
    const agentMailboxDir = `${root}/.olt/mailboxes/${agentId}`;
    return {
      agentMailboxDir,
      inboxPath: `${agentMailboxDir}/inbox.jsonl`,
      outboxPath: `${agentMailboxDir}/outbox.jsonl`,
      archivePath: `${agentMailboxDir}/archive.jsonl`,
      cursorPath: `${agentMailboxDir}/cursor.json`,
      quarantinePath: `${agentMailboxDir}/quarantine.log`,
      lockPath: resolveMailboxLockPath(agentId, baseDir),
    };
  }

  const root = resolve(effectiveBase);
  const mailboxesDir = join(root, ".olt", "mailboxes");
  const agentMailboxDir = join(mailboxesDir, agentId);

  return {
    agentMailboxDir,
    inboxPath: join(agentMailboxDir, "inbox.jsonl"),
    outboxPath: join(agentMailboxDir, "outbox.jsonl"),
    archivePath: join(agentMailboxDir, "archive.jsonl"),
    cursorPath: join(agentMailboxDir, "cursor.json"),
    quarantinePath: join(agentMailboxDir, "quarantine.log"),
    lockPath: resolveMailboxLockPath(agentId, baseDir),
  };
}

export function ensureMailboxDirectories(paths: MailboxPaths): void {
  if (
    !paths ||
    typeof paths !== "object" ||
    typeof paths.agentMailboxDir !== "string" ||
    paths.agentMailboxDir.trim().length === 0 ||
    typeof paths.lockPath !== "string" ||
    paths.lockPath.trim().length === 0
  ) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "Invalid MailboxPaths: missing agentMailboxDir or lockPath",
    );
  }

  if (
    isVirtualMailboxPath(paths.agentMailboxDir) ||
    isVirtualMailboxPath(paths.lockPath) ||
    inMemoryDirs.has(paths.agentMailboxDir)
  ) {
    inMemoryDirs.add(paths.agentMailboxDir);
    inMemoryDirs.add(getDirname(paths.lockPath));
    return;
  }

  try {
    if (!existsSync(paths.agentMailboxDir)) {
      mkdirSync(paths.agentMailboxDir, { recursive: true, mode: 0o700 });
    }
    const lockDir = dirname(paths.lockPath);
    if (!existsSync(lockDir)) {
      mkdirSync(lockDir, { recursive: true, mode: 0o700 });
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    throw new HarnessError("INTEGRITY", `Failed to create mailbox directories: ${errorMsg}`);
  }
}

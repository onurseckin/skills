import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";
import type { MailboxPaths } from "../types.ts";

function isValidAgentId(agentId: unknown): agentId is string {
  if (typeof agentId !== "string") {
    return false;
  }
  if (agentId.trim().length === 0) {
    return false;
  }
  if (agentId === ".") {
    return false;
  }
  if (agentId.includes("..")) {
    return false;
  }
  if (agentId.includes("/")) {
    return false;
  }
  if (agentId.includes("\\")) {
    return false;
  }
  if (agentId.includes("\0")) {
    return false;
  }
  return true;
}

export function resolveMailboxPaths(agentId: string, baseDir?: string): MailboxPaths {
  if (typeof agentId !== "string") {
    throw new HarnessError("INVALID_ARGUMENT", "agentId must be a non-empty string");
  }
  if (agentId.trim().length === 0) {
    throw new HarnessError("INVALID_ARGUMENT", "agentId must be a non-empty string");
  }
  if (!isValidAgentId(agentId)) {
    throw new HarnessError(
      "PATH_SAFETY",
      `Invalid agentId '${agentId}': cannot contain path separators or traversal elements`,
    );
  }

  const effectiveBase = baseDir !== undefined ? baseDir : process.cwd();
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
    lockPath: join(root, ".olt", "locks", "mailboxes", `${agentId}.lock`),
  };
}

export function ensureMailboxDirectories(paths: MailboxPaths): void {
  if (!paths) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "Invalid MailboxPaths: missing agentMailboxDir or lockPath",
    );
  }
  if (typeof paths !== "object") {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "Invalid MailboxPaths: missing agentMailboxDir or lockPath",
    );
  }
  if (typeof paths.agentMailboxDir !== "string") {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "Invalid MailboxPaths: missing agentMailboxDir or lockPath",
    );
  }
  if (paths.agentMailboxDir.trim().length === 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "Invalid MailboxPaths: missing agentMailboxDir or lockPath",
    );
  }
  if (typeof paths.lockPath !== "string") {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "Invalid MailboxPaths: missing agentMailboxDir or lockPath",
    );
  }
  if (paths.lockPath.trim().length === 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "Invalid MailboxPaths: missing agentMailboxDir or lockPath",
    );
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

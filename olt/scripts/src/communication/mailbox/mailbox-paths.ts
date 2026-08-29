import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";
import type { MailboxPaths } from "../types.ts";

/**
 * Resolves the canonical mailbox filesystem paths for a given agent ID.
 *
 * Topology:
 * - Root: `<baseDir>/.olt/mailboxes/<agent_id>/`
 * - Locks: `<baseDir>/.olt/mailboxes/.locks/<agent_id>.lock`
 * - Files: `inbox.jsonl`, `outbox.jsonl`, `archive.jsonl`, `cursor.json`, `quarantine.log`
 */
export function resolveMailboxPaths(agentId: string, baseDir?: string): MailboxPaths {
  if (typeof agentId !== "string" || agentId.trim().length === 0) {
    throw new HarnessError("INVALID_ARGUMENT", "agentId must be a non-empty string");
  }

  if (
    agentId === "." ||
    agentId.includes("..") ||
    agentId.includes("/") ||
    agentId.includes("\\") ||
    agentId.includes("\0")
  ) {
    throw new HarnessError(
      "PATH_SAFETY",
      `Invalid agentId '${agentId}': cannot contain path separators or traversal elements`,
    );
  }

  const root = resolve(baseDir ?? process.cwd());
  const mailboxesDir = join(root, ".olt", "mailboxes");
  const agentMailboxDir = join(mailboxesDir, agentId);

  return {
    agentMailboxDir,
    inboxPath: join(agentMailboxDir, "inbox.jsonl"),
    outboxPath: join(agentMailboxDir, "outbox.jsonl"),
    archivePath: join(agentMailboxDir, "archive.jsonl"),
    cursorPath: join(agentMailboxDir, "cursor.json"),
    quarantinePath: join(agentMailboxDir, "quarantine.log"),
    lockPath: join(mailboxesDir, ".locks", `${agentId}.lock`),
  };
}

/**
 * Ensures the agent's mailbox directory and the parent lock directory exist.
 */
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

  try {
    if (!existsSync(paths.agentMailboxDir)) {
      mkdirSync(paths.agentMailboxDir, { recursive: true, mode: 0o700 });
    }
    const lockDir = dirname(paths.lockPath);
    if (!existsSync(lockDir)) {
      mkdirSync(lockDir, { recursive: true, mode: 0o700 });
    }
  } catch (error) {
    throw new HarnessError(
      "INTEGRITY",
      `Failed to create mailbox directories: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

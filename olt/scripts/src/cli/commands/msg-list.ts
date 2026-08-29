import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  createEmptyCursor,
  isValidEnvelopeStructure,
  loadMailboxCursor,
  resolveMailboxPaths,
} from "../../communication/mailbox/index.ts";
import type { MailboxEnvelope } from "../../communication/types.ts";
import { enforceLineLimit, formatTable } from "../formatters/line-limiter.ts";
import { textFlag, type CommandContext, type Flags } from "../options.ts";

export interface MailboxSummary {
  readonly agentId: string;
  readonly inboxCount: number;
  readonly outboxCount: number;
  readonly unreadCount: number;
  readonly quarantineCount: number;
  readonly lastReadSequence: number;
  readonly lastReadId: string;
}

export interface MsgListResult {
  readonly markdown: string;
  readonly mailboxes: readonly MailboxSummary[];
  readonly totalMailboxes: number;
  readonly [key: string]: unknown;
}

function countLines(filePath: string): number {
  if (!existsSync(filePath)) {
    return 0;
  }
  const content = readFileSync(filePath, "utf8");
  return content.split("\n").filter((line) => line.trim().length > 0).length;
}

function readInboxEnvelopes(inboxPath: string): readonly MailboxEnvelope<unknown>[] {
  if (!existsSync(inboxPath)) {
    return [];
  }
  const content = readFileSync(inboxPath, "utf8");
  const rawLines = content.split("\n");
  const envelopes: MailboxEnvelope<unknown>[] = [];
  for (const line of rawLines) {
    if (line.trim().length === 0) {
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(line);
      if (isValidEnvelopeStructure(parsed)) {
        envelopes.push(parsed);
      }
    } catch {}
  }
  return envelopes;
}

function summarizeMailbox(agentId: string, effectiveBase: string): MailboxSummary {
  const paths = resolveMailboxPaths(agentId, effectiveBase);
  const envelopes = readInboxEnvelopes(paths.inboxPath);
  const cursor = existsSync(paths.cursorPath)
    ? loadMailboxCursor(paths.cursorPath)
    : createEmptyCursor();
  const seenIds = new Set(cursor.seen_ids);
  const unreadCount = envelopes.filter((env) => !seenIds.has(env.id)).length;
  const outboxCount = countLines(paths.outboxPath);
  const quarantineCount = countLines(paths.quarantinePath);

  return {
    agentId,
    inboxCount: envelopes.length,
    outboxCount,
    unreadCount,
    quarantineCount,
    lastReadSequence: cursor.last_read_sequence,
    lastReadId: cursor.last_read_id,
  };
}

export function msgListCommand(flags: Flags, _context?: CommandContext): MsgListResult {
  const baseDir = textFlag(flags, "base-dir", false);
  const actor = textFlag(flags, "actor", false);
  const effectiveBase = baseDir !== undefined ? resolve(baseDir) : process.cwd();
  const mailboxesRoot = join(effectiveBase, ".olt", "mailboxes");

  let agentIds: string[] = [];
  if (actor !== undefined) {
    const actorPaths = resolveMailboxPaths(actor, effectiveBase);
    if (existsSync(actorPaths.agentMailboxDir)) {
      agentIds = [actor];
    }
  } else if (existsSync(mailboxesRoot)) {
    const entries = readdirSync(mailboxesRoot, { withFileTypes: true });
    agentIds = entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .sort();
  }

  const summaries: MailboxSummary[] = agentIds.map((id) => summarizeMailbox(id, effectiveBase));

  const lines: string[] = [
    "### Mailbox Summaries (`msg:list`)",
    `- **Total Mailboxes**: \`${summaries.length}\``,
    "",
  ];

  if (summaries.length > 0) {
    lines.push(
      ...formatTable(
        ["Agent", "Inbox", "Unread", "Outbox", "Quarantine", "Last Seq"],
        summaries.map((m) => [
          `\`${m.agentId}\``,
          String(m.inboxCount),
          String(m.unreadCount),
          String(m.outboxCount),
          String(m.quarantineCount),
          String(m.lastReadSequence),
        ]),
      ),
    );
  } else {
    lines.push("_No mailboxes found._");
  }

  return {
    markdown: enforceLineLimit(lines.join("\n"), 25),
    mailboxes: summaries,
    totalMailboxes: summaries.length,
  };
}

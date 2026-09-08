import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { MailboxCursor, MailboxEnvelope } from "../../communication/index.ts";
import type { DoctorDiagnosticFinding } from "./types.ts";

export interface MailboxHealthOptions {
  readonly repoRoot?: string | undefined;
  readonly slaThresholdSeconds?: number | undefined;
  readonly autoHeal?: boolean | undefined;
  readonly activeAgentIds?: readonly string[] | undefined;
  readonly state?: Readonly<Record<string, unknown>> | null | undefined;
}

export type MailboxPathOptions = MailboxHealthOptions;

export function isValidCursorObject(val: unknown): val is MailboxCursor {
  if (typeof val !== "object" || val === null || Array.isArray(val)) return false;
  const o = val as Record<string, unknown>;
  return (
    typeof o.last_read_sequence === "number" &&
    Number.isFinite(o.last_read_sequence) &&
    o.last_read_sequence >= 0 &&
    typeof o.last_read_id === "string" &&
    typeof o.updated_at === "string" &&
    Array.isArray(o.seen_ids) &&
    o.seen_ids.every((i) => typeof i === "string")
  );
}

export function isValidEnvelopeObject(val: unknown): val is MailboxEnvelope<unknown> {
  if (typeof val !== "object" || val === null || Array.isArray(val)) return false;
  const o = val as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    o.id.trim().length > 0 &&
    typeof o.sequence === "number" &&
    typeof o.sender_id === "string" &&
    typeof o.recipient_id === "string" &&
    typeof o.message_type === "string" &&
    typeof o.timestamp === "string" &&
    typeof o.correlation_id === "string" &&
    typeof o.hmac_signature === "string"
  );
}

export function readJsonlEnvelopes(filePath: string): {
  readonly envelopes: readonly MailboxEnvelope<unknown>[];
  readonly rawEntries: readonly {
    readonly line: string;
    readonly parsed: unknown;
  }[];
} {
  if (!existsSync(filePath)) return { envelopes: [], rawEntries: [] };
  const envelopes: MailboxEnvelope<unknown>[] = [];
  const rawEntries: { readonly line: string; readonly parsed: unknown }[] = [];
  try {
    for (const line of readFileSync(filePath, "utf8").split("\n")) {
      if (line.trim().length === 0) continue;
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(line);
      } catch {}
      rawEntries.push({ line, parsed });
      if (isValidEnvelopeObject(parsed)) envelopes.push(parsed);
    }
  } catch {}
  return { envelopes, rawEntries };
}

export function resolveMailboxRoot(options: MailboxPathOptions): string {
  return join(
    resolve(typeof options.repoRoot === "string" ? options.repoRoot : process.cwd()),
    ".olt",
    "mailboxes",
  );
}

export function listAgentDirs(mailboxesDir: string): readonly string[] {
  if (!existsSync(mailboxesDir)) return [];
  try {
    return readdirSync(mailboxesDir).filter((e) => {
      try {
        return statSync(join(mailboxesDir, e)).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

export function inspectCursor(cursorPath: string): {
  readonly isCorrupt: boolean;
  readonly cursor: MailboxCursor | null;
} {
  if (!existsSync(cursorPath)) return { isCorrupt: true, cursor: null };
  try {
    const parsed = JSON.parse(readFileSync(cursorPath, "utf8"));
    if (isValidCursorObject(parsed)) return { isCorrupt: false, cursor: parsed };
  } catch {}
  return { isCorrupt: true, cursor: null };
}

export function checkQuarantine(
  agentDir: string,
  agentId: string,
  engine: string,
): DoctorDiagnosticFinding | null {
  const p = join(agentDir, "quarantine.log");
  if (!existsSync(p)) return null;
  try {
    const lines = readFileSync(p, "utf8")
      .split("\n")
      .filter((l) => l.trim().length > 0);
    if (lines.length > 0) {
      return {
        code: "MAILBOX_QUARANTINE_PRESENT",
        severity: "WARN",
        engine,
        message: `Mailbox '${agentId}' contains ${lines.length} quarantined record(s)`,
        details: { agentId, quarantinePath: p, count: lines.length },
      };
    }
  } catch {}
  return null;
}

export function healCorruptedCursor(cursorPath: string, inboxPath: string): boolean {
  try {
    let lastReadSeq = 0;
    let lastReadId = "";
    const seenIds: string[] = [];

    const outboxPath = join(dirname(inboxPath), "outbox.jsonl");
    const outboxEnvelopes = existsSync(outboxPath) ? readJsonlEnvelopes(outboxPath).envelopes : [];
    const respondedCorrelations = new Set<string>(
      outboxEnvelopes.map((e) => e.correlation_id).filter((c) => Boolean(c)),
    );

    const ACTIONABLE_UNACK_TYPES = new Set([
      "VALIDATION_REQUEST",
      "TASK_ASSIGNMENT",
      "TASK_DISPATCH",
      "TASK_CLAIM",
      "APPROVAL_REQUEST",
      "WORKFLOW_DISPATCH",
      "PROMPT",
    ]);

    if (existsSync(inboxPath)) {
      const inboxEnvelopes = readJsonlEnvelopes(inboxPath).envelopes;
      for (const env of inboxEnvelopes) {
        if (
          ACTIONABLE_UNACK_TYPES.has(env.message_type) &&
          env.correlation_id &&
          !respondedCorrelations.has(env.correlation_id)
        ) {
          break;
        }

        seenIds.push(env.id);
        if (env.sequence > lastReadSeq) {
          lastReadSeq = env.sequence;
          lastReadId = env.id;
        }
      }
    }
    const dir = dirname(cursorPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmpPath = `${cursorPath}.tmp-${Date.now()}`;
    const cursor: MailboxCursor = {
      last_read_sequence: lastReadSeq,
      last_read_id: lastReadId,
      seen_ids: seenIds,
      updated_at: new Date().toISOString(),
    };
    writeFileSync(tmpPath, JSON.stringify(cursor, null, 2) + "\n", "utf8");
    renameSync(tmpPath, cursorPath);
    return true;
  } catch {
    return false;
  }
}

export function resolveActiveAgentSet(options: {
  readonly activeAgentIds?: readonly string[] | undefined;
  readonly state?: Readonly<Record<string, unknown>> | null | undefined;
}): ReadonlySet<string> | null {
  if (options.activeAgentIds !== undefined && options.activeAgentIds !== null) {
    return new Set(options.activeAgentIds);
  }
  if (options.state !== undefined && options.state !== null && typeof options.state === "object") {
    const rawAgents = (options.state as Record<string, unknown>).agents;
    if (Array.isArray(rawAgents)) {
      const ids: string[] = [];
      for (const a of rawAgents) {
        if (typeof a === "string" && a.trim().length > 0) {
          ids.push(a.trim());
        } else if (a && typeof a === "object") {
          const item = a as Record<string, unknown>;
          const id =
            typeof item.id === "string"
              ? item.id
              : typeof item.agentId === "string"
                ? item.agentId
                : null;
          if (id && id.trim().length > 0) ids.push(id.trim());
        }
      }
      return new Set(ids);
    }
    if (rawAgents && typeof rawAgents === "object") {
      return new Set(Object.keys(rawAgents));
    }
    return new Set<string>();
  }
  return null;
}

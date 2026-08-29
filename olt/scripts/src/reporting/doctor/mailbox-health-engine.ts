import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { verifyEnvelopeHmac } from "../../communication/mailbox/envelope.ts";
import type { MailboxCursor, MailboxEnvelope } from "../../communication/types.ts";
import type { DoctorCheckEngineResult, DoctorDiagnosticFinding } from "./types.ts";

export interface DoctorCheckResult extends DoctorCheckEngineResult {
  readonly autoHealed?: readonly string[] | undefined;
}

export interface MailboxHealthOptions {
  readonly repoRoot?: string | undefined;
  readonly slaThresholdSeconds?: number | undefined;
  readonly autoHeal?: boolean | undefined;
  readonly activeAgentIds?: readonly string[] | undefined;
  readonly state?: Readonly<Record<string, unknown>> | null | undefined;
}

function isValidCursorObject(val: unknown): val is MailboxCursor {
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

function isValidEnvelopeObject(val: unknown): val is MailboxEnvelope<unknown> {
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

function readJsonlEnvelopes(filePath: string): {
  readonly envelopes: readonly MailboxEnvelope<unknown>[];
  readonly rawEntries: readonly { readonly line: string; readonly parsed: unknown }[];
} {
  if (!existsSync(filePath)) return { envelopes: [], rawEntries: [] };
  const envelopes: MailboxEnvelope<unknown>[] = [];
  const rawEntries: { readonly line: string; readonly parsed: unknown }[] = [];
  try {
    for (const line of readFileSync(filePath, "utf8").split("\n")) {
      if (line.trim().length === 0) continue;
      let parsed: unknown = null;
      try { parsed = JSON.parse(line); } catch {}
      rawEntries.push({ line, parsed });
      if (isValidEnvelopeObject(parsed)) envelopes.push(parsed);
    }
  } catch {}
  return { envelopes, rawEntries };
}

function resolveMailboxRoot(options: MailboxHealthOptions): string {
  return join(resolve(typeof options.repoRoot === "string" ? options.repoRoot : process.cwd()), ".olt", "mailboxes");
}

function listAgentDirs(mailboxesDir: string): readonly string[] {
  if (!existsSync(mailboxesDir)) return [];
  try {
    return readdirSync(mailboxesDir).filter((e) => {
      try { return statSync(join(mailboxesDir, e)).isDirectory(); } catch { return false; }
    });
  } catch { return []; }
}

function inspectCursor(cursorPath: string): { readonly isCorrupt: boolean; readonly cursor: MailboxCursor | null } {
  if (!existsSync(cursorPath)) return { isCorrupt: true, cursor: null };
  try {
    const parsed = JSON.parse(readFileSync(cursorPath, "utf8"));
    if (isValidCursorObject(parsed)) return { isCorrupt: false, cursor: parsed };
  } catch {}
  return { isCorrupt: true, cursor: null };
}

function checkQuarantine(agentDir: string, agentId: string, engine: string): DoctorDiagnosticFinding | null {
  const p = join(agentDir, "quarantine.log");
  if (!existsSync(p)) return null;
  try {
    const lines = readFileSync(p, "utf8").split("\n").filter((l) => l.trim().length > 0);
    if (lines.length > 0) {
      return { code: "MAILBOX_QUARANTINE_PRESENT", severity: "WARN", engine, message: `Mailbox '${agentId}' contains ${lines.length} quarantined record(s)`, details: { agentId, quarantinePath: p, count: lines.length } };
    }
  } catch {}
  return null;
}

export function healCorruptedCursor(cursorPath: string, inboxPath: string): boolean {
  try {
    let lastReadSeq = 0;
    let lastReadId = "";
    const seenIds: string[] = [];
    if (existsSync(inboxPath)) {
      for (const env of readJsonlEnvelopes(inboxPath).envelopes) {
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
    const cursor: MailboxCursor = { last_read_sequence: lastReadSeq, last_read_id: lastReadId, seen_ids: seenIds, updated_at: new Date().toISOString() };
    writeFileSync(tmpPath, JSON.stringify(cursor, null, 2) + "\n", "utf8");
    renameSync(tmpPath, cursorPath);
    return true;
  } catch {
    return false;
  }
}

export function pruneOrphanedMailboxes(options: MailboxHealthOptions = {}): readonly string[] {
  const pruned: string[] = [];
  const mailboxesDir = resolveMailboxRoot(options);
  const activeSet = options.activeAgentIds ? new Set(options.activeAgentIds) : null;
  const now = Date.now();
  for (const agentId of listAgentDirs(mailboxesDir)) {
    const agentDir = join(mailboxesDir, agentId);
    let mtimeMs = 0;
    try { mtimeMs = statSync(agentDir).mtimeMs; } catch { continue; }
    let isOrphaned = activeSet !== null ? !activeSet.has(agentId) : (now - mtimeMs) / 1000 > 3600;
    if (activeSet === null && options.state && typeof options.state === "object") {
      const agents = options.state.agents as Record<string, unknown> | undefined;
      const tasks = options.state.tasks as Record<string, unknown> | undefined;
      isOrphaned = !((agents && agentId in agents) || (tasks && agentId in tasks)) && (now - mtimeMs) / 1000 > 3600;
    }
    if (isOrphaned) {
      const toArchive: string[] = [];
      for (const f of ["inbox.jsonl", "outbox.jsonl"]) {
        const p = join(agentDir, f);
        if (existsSync(p)) {
          try {
            const c = readFileSync(p, "utf8").trim();
            if (c.length > 0) toArchive.push(c);
            unlinkSync(p);
          } catch {}
        }
      }
      if (toArchive.length > 0) {
        const arc = join(agentDir, "archive.jsonl");
        try {
          const exist = existsSync(arc) ? readFileSync(arc, "utf8") : "";
          writeFileSync(arc, (exist.trim() + "\n" + toArchive.join("\n")).trim() + "\n", "utf8");
        } catch {}
      }
      try { if (readdirSync(agentDir).length === 0) rmdirSync(agentDir); } catch {}
      pruned.push(`Pruned orphaned mailbox '${agentId}'`);
    }
  }
  return pruned;
}

export function autoHealMailboxState(options: MailboxHealthOptions = {}): readonly string[] {
  const healed: string[] = [];
  const mailboxesDir = resolveMailboxRoot(options);
  for (const agentId of listAgentDirs(mailboxesDir)) {
    const agentDir = join(mailboxesDir, agentId);
    const { isCorrupt } = inspectCursor(join(agentDir, "cursor.json"));
    if (isCorrupt && healCorruptedCursor(join(agentDir, "cursor.json"), join(agentDir, "inbox.jsonl"))) {
      healed.push(`Rebuilt corrupted cursor for mailbox '${agentId}'`);
    }
  }
  healed.push(...pruneOrphanedMailboxes(options));
  return healed;
}

export function checkMailboxDiskActivity(oltDir: string): DoctorCheckEngineResult {
  const findings: DoctorDiagnosticFinding[] = [];
  const baseDir = existsSync(oltDir) ? oltDir : join(process.cwd(), oltDir);
  const mailboxesDir = existsSync(join(baseDir, "mailboxes"))
    ? join(baseDir, "mailboxes")
    : existsSync(join(baseDir, ".olt", "mailboxes"))
      ? join(baseDir, ".olt", "mailboxes")
      : existsSync(baseDir) && baseDir.endsWith("mailboxes")
        ? baseDir
        : join(baseDir, "mailboxes");
  if (!existsSync(mailboxesDir)) return { engine: "checkMailboxDiskActivity", passed: true, findings };
  for (const agentId of listAgentDirs(mailboxesDir)) {
    const agentDir = join(mailboxesDir, agentId);
    const qFinding = checkQuarantine(agentDir, agentId, "checkMailboxDiskActivity");
    if (qFinding) findings.push(qFinding);
    const { isCorrupt } = inspectCursor(join(agentDir, "cursor.json"));
    if (isCorrupt) {
      findings.push({ code: "MAILBOX_CURSOR_CORRUPTED", severity: "ERROR", engine: "checkMailboxDiskActivity", message: `Mailbox '${agentId}' has a missing or corrupted cursor.json`, details: { agentId, cursorPath: join(agentDir, "cursor.json") } });
    }
    const inboxData = readJsonlEnvelopes(join(agentDir, "inbox.jsonl"));
    const outboxData = readJsonlEnvelopes(join(agentDir, "outbox.jsonl"));
    for (const item of [...inboxData.rawEntries, ...outboxData.rawEntries]) {
      if (!isValidEnvelopeObject(item.parsed)) {
        findings.push({ code: "MAILBOX_DISK_CORRUPT_ENVELOPE", severity: "ERROR", engine: "checkMailboxDiskActivity", message: `Malformed envelope syntax on disk for mailbox '${agentId}'`, details: { agentId, line: item.line } });
      }
    }
  }
  return { engine: "checkMailboxDiskActivity", passed: findings.filter((f) => f.severity === "ERROR").length === 0, findings };
}

export function checkMailboxHealth(
  options: MailboxHealthOptions = {},
): Promise<DoctorCheckResult> & DoctorCheckResult {
  const findings: DoctorDiagnosticFinding[] = [];
  const mailboxesDir = resolveMailboxRoot(options);
  const sla = typeof options.slaThresholdSeconds === "number" ? options.slaThresholdSeconds : 120;
  const now = Date.now();
  const allRequests: MailboxEnvelope<unknown>[] = [];
  const verdictCorrelations = new Set<string>();
  const autoHealList: string[] = [];

  for (const agentId of listAgentDirs(mailboxesDir)) {
    const agentDir = join(mailboxesDir, agentId);
    const inboxPath = join(agentDir, "inbox.jsonl");
    const qFinding = checkQuarantine(agentDir, agentId, "checkMailboxHealth");
    if (qFinding) findings.push(qFinding);
    const inboxData = readJsonlEnvelopes(inboxPath);
    const outboxData = readJsonlEnvelopes(join(agentDir, "outbox.jsonl"));
    for (const item of [...inboxData.rawEntries, ...outboxData.rawEntries]) {
      if (!isValidEnvelopeObject(item.parsed)) {
        findings.push({ code: "MAILBOX_HMAC_INTEGRITY_FAILURES", severity: "ERROR", engine: "checkMailboxHealth", message: `HMAC signature verification failed for mailbox '${agentId}': malformed envelope syntax`, details: { agentId, line: item.line } });
      } else {
        const res = verifyEnvelopeHmac(item.parsed);
        if (!res.valid) {
          findings.push({ code: "MAILBOX_HMAC_INTEGRITY_FAILURES", severity: "ERROR", engine: "checkMailboxHealth", message: `HMAC signature verification failed for mailbox '${agentId}' message '${item.parsed.id}'`, details: { agentId, messageId: item.parsed.id, error: res.error } });
        }
      }
    }
    for (const env of [...inboxData.envelopes, ...outboxData.envelopes]) {
      if (env.message_type === "VALIDATION_REQUEST") allRequests.push(env);
      else if (env.message_type === "VALIDATION_VERDICT") verdictCorrelations.add(env.correlation_id);
    }
    const { isCorrupt, cursor: cursorObj } = inspectCursor(join(agentDir, "cursor.json"));
    if (isCorrupt) {
      if (options.autoHeal && healCorruptedCursor(join(agentDir, "cursor.json"), inboxPath)) {
        autoHealList.push(`Rebuilt corrupted cursor for mailbox '${agentId}'`);
      } else {
        findings.push({ code: "MAILBOX_CURSOR_CORRUPTED", severity: "ERROR", engine: "checkMailboxHealth", message: `Mailbox '${agentId}' has a missing or corrupted cursor.json`, details: { agentId, cursorPath: join(agentDir, "cursor.json") } });
      }
    }
    const lastReadSeq = cursorObj ? cursorObj.last_read_sequence : 0;
    const seenIds = new Set(cursorObj ? cursorObj.seen_ids : []);
    for (const msg of inboxData.envelopes) {
      if (msg.sequence > lastReadSeq && !seenIds.has(msg.id)) {
        const msgTime = Date.parse(msg.timestamp);
        const age = !Number.isNaN(msgTime) ? Math.max(0, (now - msgTime) / 1000) : 0;
        if (age > sla) {
          findings.push({ code: "MAILBOX_UNREAD_SLA_EXCEEDED", severity: "WARN", engine: "checkMailboxHealth", message: `Mailbox '${agentId}' has unread message '${msg.id}' (type: ${msg.message_type}) exceeding SLA (${Math.round(age)}s > ${sla}s)`, details: { agentId, messageId: msg.id, ageSeconds: age } });
          if (age > 300) {
            findings.push({ code: "MAILBOX_MESSAGE_STARVATION", severity: "ERROR", engine: "checkMailboxHealth", message: `Mailbox '${agentId}' is experiencing message starvation for message '${msg.id}' (${Math.round(age)}s > 300s)`, details: { agentId, messageId: msg.id, ageSeconds: age } });
          }
        }
      }
    }
  }

  const seenLoopCorrelations = new Set<string>();
  for (const req of allRequests) {
    if (!seenLoopCorrelations.has(req.correlation_id)) {
      seenLoopCorrelations.add(req.correlation_id);
      if (!verdictCorrelations.has(req.correlation_id)) {
        const reqTime = Date.parse(req.timestamp);
        const age = !Number.isNaN(reqTime) ? Math.max(0, (now - reqTime) / 1000) : 0;
        if (age > sla) {
          findings.push({ code: "MAILBOX_BROKEN_COMMUNICATION_LOOP", severity: "WARN", engine: "checkMailboxHealth", message: `Unresponded VALIDATION_REQUEST '${req.id}' for correlation '${req.correlation_id}' between '${req.sender_id}' and '${req.recipient_id}'`, details: { correlationId: req.correlation_id, senderId: req.sender_id, recipientId: req.recipient_id } });
        }
      }
    }
  }
  if (options.autoHeal) autoHealList.push(...pruneOrphanedMailboxes(options));
  const res: DoctorCheckResult = {
    engine: "checkMailboxHealth",
    passed: findings.filter((f) => f.severity === "ERROR").length === 0,
    findings,
    ...(autoHealList.length > 0 ? { autoHealed: autoHealList } : {}),
  };
  return Object.assign(Promise.resolve(res), res);
}

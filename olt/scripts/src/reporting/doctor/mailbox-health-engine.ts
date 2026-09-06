import { existsSync } from "node:fs";
import { join } from "node:path";
import { verifyEnvelopeHmac } from "../../communication/mailbox/envelope.ts";
import type { MailboxEnvelope } from "../../communication/types.ts";
import type { DoctorCheckEngineResult, DoctorDiagnosticFinding } from "./types.ts";
import {
  checkQuarantine,
  healCorruptedCursor,
  inspectCursor,
  isValidEnvelopeObject,
  listAgentDirs,
  readJsonlEnvelopes,
  resolveActiveAgentSet,
  resolveMailboxRoot,
  type MailboxHealthOptions,
} from "./mailbox-health-helpers.ts";
import { autoHealMailboxState, pruneOrphanedMailboxes } from "./mailbox-health-pruner.ts";

export { healCorruptedCursor, autoHealMailboxState, pruneOrphanedMailboxes };
export type { MailboxHealthOptions };

export interface DoctorCheckResult extends DoctorCheckEngineResult {
  readonly autoHealed?: readonly string[] | undefined;
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
  if (!existsSync(mailboxesDir))
    return { engine: "checkMailboxDiskActivity", passed: true, findings };
  for (const agentId of listAgentDirs(mailboxesDir)) {
    const agentDir = join(mailboxesDir, agentId);
    const qFinding = checkQuarantine(agentDir, agentId, "checkMailboxDiskActivity");
    if (qFinding) findings.push(qFinding);
    const { isCorrupt } = inspectCursor(join(agentDir, "cursor.json"));
    if (isCorrupt) {
      findings.push({
        code: "MAILBOX_CURSOR_CORRUPTED",
        severity: "ERROR",
        engine: "checkMailboxDiskActivity",
        message: `Mailbox '${agentId}' has a missing or corrupted cursor.json`,
        details: { agentId, cursorPath: join(agentDir, "cursor.json") },
      });
    }
    const inboxData = readJsonlEnvelopes(join(agentDir, "inbox.jsonl"));
    const outboxData = readJsonlEnvelopes(join(agentDir, "outbox.jsonl"));
    for (const item of [...inboxData.rawEntries, ...outboxData.rawEntries]) {
      if (!isValidEnvelopeObject(item.parsed)) {
        findings.push({
          code: "MAILBOX_DISK_CORRUPT_ENVELOPE",
          severity: "ERROR",
          engine: "checkMailboxDiskActivity",
          message: `Malformed envelope syntax on disk for mailbox '${agentId}'`,
          details: { agentId, line: item.line },
        });
      }
    }
  }
  return {
    engine: "checkMailboxDiskActivity",
    passed: findings.filter((f) => f.severity === "ERROR").length === 0,
    findings,
  };
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

  const activeSet = resolveActiveAgentSet(options);
  const allDirs = listAgentDirs(mailboxesDir);
  const targetDirs =
    activeSet !== null ? allDirs.filter((agentId) => activeSet.has(agentId)) : allDirs;

  for (const agentId of targetDirs) {
    const agentDir = join(mailboxesDir, agentId);
    const inboxPath = join(agentDir, "inbox.jsonl");
    const qFinding = checkQuarantine(agentDir, agentId, "checkMailboxHealth");
    if (qFinding) findings.push(qFinding);
    const inboxData = readJsonlEnvelopes(inboxPath);
    const outboxData = readJsonlEnvelopes(join(agentDir, "outbox.jsonl"));
    for (const item of [...inboxData.rawEntries, ...outboxData.rawEntries]) {
      if (!isValidEnvelopeObject(item.parsed)) {
        findings.push({
          code: "MAILBOX_HMAC_INTEGRITY_FAILURES",
          severity: "ERROR",
          engine: "checkMailboxHealth",
          message: `HMAC signature verification failed for mailbox '${agentId}': malformed envelope syntax`,
          details: { agentId, line: item.line },
        });
      } else {
        const res = verifyEnvelopeHmac(item.parsed);
        if (!res.valid) {
          findings.push({
            code: "MAILBOX_HMAC_INTEGRITY_FAILURES",
            severity: "ERROR",
            engine: "checkMailboxHealth",
            message: `HMAC signature verification failed for mailbox '${agentId}' message '${item.parsed.id}'`,
            details: {
              agentId,
              messageId: item.parsed.id,
              error: res.error,
            },
          });
        }
      }
    }
    for (const env of [...inboxData.envelopes, ...outboxData.envelopes]) {
      if (env.message_type === "VALIDATION_REQUEST") allRequests.push(env);
      else if (env.message_type === "VALIDATION_VERDICT")
        verdictCorrelations.add(env.correlation_id);
    }
    const { isCorrupt, cursor: cursorObj } = inspectCursor(join(agentDir, "cursor.json"));
    if (isCorrupt) {
      if (options.autoHeal && healCorruptedCursor(join(agentDir, "cursor.json"), inboxPath)) {
        autoHealList.push(`Rebuilt corrupted cursor for mailbox '${agentId}'`);
      } else {
        findings.push({
          code: "MAILBOX_CURSOR_CORRUPTED",
          severity: "ERROR",
          engine: "checkMailboxHealth",
          message: `Mailbox '${agentId}' has a missing or corrupted cursor.json`,
          details: {
            agentId,
            cursorPath: join(agentDir, "cursor.json"),
          },
        });
      }
    }
    const lastReadSeq = cursorObj ? cursorObj.last_read_sequence : 0;
    const seenIds = new Set(cursorObj ? cursorObj.seen_ids : []);
    for (const msg of inboxData.envelopes) {
      if (msg.sequence > lastReadSeq && !seenIds.has(msg.id)) {
        const msgTime = Date.parse(msg.timestamp);
        const age = !Number.isNaN(msgTime) ? Math.max(0, (now - msgTime) / 1000) : 0;
        if (age > sla) {
          findings.push({
            code: "MAILBOX_UNREAD_SLA_EXCEEDED",
            severity: "WARN",
            engine: "checkMailboxHealth",
            message: `Mailbox '${agentId}' has unread message '${msg.id}' (type: ${msg.message_type}) exceeding SLA (${Math.round(age)}s > ${sla}s)`,
            details: { agentId, messageId: msg.id, ageSeconds: age },
          });
          if (age > 300) {
            findings.push({
              code: "MAILBOX_MESSAGE_STARVATION",
              severity: "ERROR",
              engine: "checkMailboxHealth",
              message: `Mailbox '${agentId}' is experiencing message starvation for message '${msg.id}' (${Math.round(age)}s > 300s)`,
              details: {
                agentId,
                messageId: msg.id,
                ageSeconds: age,
              },
            });
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
          findings.push({
            code: "MAILBOX_BROKEN_COMMUNICATION_LOOP",
            severity: "WARN",
            engine: "checkMailboxHealth",
            message: `Unresponded VALIDATION_REQUEST '${req.id}' for correlation '${req.correlation_id}' between '${req.sender_id}' and '${req.recipient_id}'`,
            details: {
              correlationId: req.correlation_id,
              senderId: req.sender_id,
              recipientId: req.recipient_id,
            },
          });
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

import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  autoHealMailboxState,
  checkMailboxDiskActivity,
  checkMailboxHealth,
  healCorruptedCursor,
  pruneOrphanedMailboxes,
} from "../../../olt/scripts/src/reporting/doctor/mailbox-health-engine.ts";
import { createSignedEnvelope } from "../../../olt/scripts/src/communication/mailbox/envelope.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

describe("Mailbox Health Engine", () => {
  test("checkMailboxDiskActivity returns passed when mailboxes dir does not exist", () => {
    const res = checkMailboxDiskActivity("/non-existent-dir-for-doctor");
    expect(res.engine).toBe("checkMailboxDiskActivity");
    expect(res.passed).toBe(true);
    expect(res.findings).toHaveLength(0);
  });

  test("checkMailboxDiskActivity detects quarantine, corrupt cursor, and malformed envelopes", () => {
    const scratch = scratchRoot(import.meta.path, "mb-disk-activity-test");
    const mailboxesDir = join(scratch, ".olt", "mailboxes");
    const agentDir = join(mailboxesDir, "agent-bad");
    mkdirSync(agentDir, { recursive: true });

    writeFileSync(join(agentDir, "quarantine.log"), "corrupt data 1\ncorrupt data 2\n", "utf8");
    writeFileSync(join(agentDir, "cursor.json"), "invalid json", "utf8");
    writeFileSync(join(agentDir, "inbox.jsonl"), "{ malformed line\n", "utf8");

    const res = checkMailboxDiskActivity(scratch);
    expect(res.engine).toBe("checkMailboxDiskActivity");
    expect(res.passed).toBe(false);

    const qFinding = res.findings.find((f) => f.code === "MAILBOX_QUARANTINE_PRESENT");
    expect(qFinding).toBeDefined();
    expect(qFinding?.severity).toBe("WARN");

    const cursorFinding = res.findings.find((f) => f.code === "MAILBOX_CURSOR_CORRUPTED");
    expect(cursorFinding).toBeDefined();
    expect(cursorFinding?.severity).toBe("ERROR");

    const envFinding = res.findings.find((f) => f.code === "MAILBOX_DISK_CORRUPT_ENVELOPE");
    expect(envFinding).toBeDefined();
    expect(envFinding?.severity).toBe("ERROR");

    rmSync(scratch, { recursive: true, force: true });
  });

  test("checkMailboxHealth passes on clean empty mailboxes", async () => {
    const scratch = scratchRoot(import.meta.path, "mb-health-clean-test");
    mkdirSync(join(scratch, ".olt", "mailboxes"), { recursive: true });

    const res = await checkMailboxHealth({ repoRoot: scratch });
    expect(res.engine).toBe("checkMailboxHealth");
    expect(res.passed).toBe(true);
    expect(res.findings).toHaveLength(0);

    rmSync(scratch, { recursive: true, force: true });
  });

  test("checkMailboxHealth detects HMAC signature mismatch and malformed envelopes", async () => {
    const scratch = scratchRoot(import.meta.path, "mb-health-hmac-test");
    const agentDir = join(scratch, ".olt", "mailboxes", "agent-hmac");
    mkdirSync(agentDir, { recursive: true });

    writeFileSync(
      join(agentDir, "cursor.json"),
      JSON.stringify({
        last_read_sequence: 0,
        last_read_id: "",
        seen_ids: [],
        updated_at: new Date().toISOString(),
      }),
      "utf8",
    );

    const badEnv = {
      id: "msg-1",
      sequence: 1,
      sender_id: "sender",
      recipient_id: "agent-hmac",
      message_type: "INFO",
      timestamp: new Date().toISOString(),
      correlation_id: "c-1",
      hmac_signature: "bad-sig-123",
      payload: {},
    };
    writeFileSync(join(agentDir, "inbox.jsonl"), JSON.stringify(badEnv) + "\n", "utf8");

    const res = await checkMailboxHealth({ repoRoot: scratch });
    expect(res.passed).toBe(false);
    const hmacFinding = res.findings.find((f) => f.code === "MAILBOX_HMAC_INTEGRITY_FAILURES");
    expect(hmacFinding).toBeDefined();

    rmSync(scratch, { recursive: true, force: true });
  });

  test("checkMailboxHealth detects SLA exceeded and message starvation on unread messages", async () => {
    const scratch = scratchRoot(import.meta.path, "mb-health-sla-test");
    const agentDir = join(scratch, ".olt", "mailboxes", "agent-sla");
    mkdirSync(agentDir, { recursive: true });

    writeFileSync(
      join(agentDir, "cursor.json"),
      JSON.stringify({
        last_read_sequence: 0,
        last_read_id: "",
        seen_ids: [],
        updated_at: new Date().toISOString(),
      }),
      "utf8",
    );

    const oldTimestamp = new Date(Date.now() - 400 * 1000).toISOString();
    const signedEnv = createSignedEnvelope({
      senderId: "sender",
      senderRole: "implementer",
      recipientId: "agent-sla",
      messageType: "VALIDATION_REQUEST",
      payload: {},
    });
    const oldSignedEnv = {
      ...signedEnv,
      timestamp: oldTimestamp,
    };
    writeFileSync(join(agentDir, "inbox.jsonl"), JSON.stringify(oldSignedEnv) + "\n", "utf8");

    const res = await checkMailboxHealth({ repoRoot: scratch, slaThresholdSeconds: 60 });
    const slaFinding = res.findings.find((f) => f.code === "MAILBOX_UNREAD_SLA_EXCEEDED");
    expect(slaFinding).toBeDefined();

    const starvFinding = res.findings.find((f) => f.code === "MAILBOX_MESSAGE_STARVATION");
    expect(starvFinding).toBeDefined();

    rmSync(scratch, { recursive: true, force: true });
  });

  test("checkMailboxHealth detects broken loops when VALIDATION_REQUEST is unresponded", async () => {
    const scratch = scratchRoot(import.meta.path, "mb-health-loop-test");
    const agentDir = join(scratch, ".olt", "mailboxes", "agent-loop");
    mkdirSync(agentDir, { recursive: true });

    const oldTimestamp = new Date(Date.now() - 150 * 1000).toISOString();
    const reqEnv = createSignedEnvelope({
      senderId: "agent-loop",
      senderRole: "implementer",
      recipientId: "validator-1",
      messageType: "VALIDATION_REQUEST",
      payload: { test: true },
    });
    const oldReqEnv = { ...reqEnv, timestamp: oldTimestamp };

    writeFileSync(
      join(agentDir, "cursor.json"),
      JSON.stringify({
        last_read_sequence: oldReqEnv.sequence,
        last_read_id: oldReqEnv.id,
        seen_ids: [oldReqEnv.id],
        updated_at: new Date().toISOString(),
      }),
      "utf8",
    );
    writeFileSync(join(agentDir, "outbox.jsonl"), JSON.stringify(oldReqEnv) + "\n", "utf8");

    const res = await checkMailboxHealth({ repoRoot: scratch, slaThresholdSeconds: 60 });
    const loopFinding = res.findings.find((f) => f.code === "MAILBOX_BROKEN_COMMUNICATION_LOOP");
    expect(loopFinding).toBeDefined();
    expect(loopFinding?.severity).toBe("WARN");

    rmSync(scratch, { recursive: true, force: true });
  });

  test("checkMailboxHealth does not report broken loop when VALIDATION_VERDICT is present", async () => {
    const scratch = scratchRoot(import.meta.path, "mb-health-loop-ok-test");
    const agentDir = join(scratch, ".olt", "mailboxes", "agent-ok");
    mkdirSync(agentDir, { recursive: true });

    const reqEnv = createSignedEnvelope({
      senderId: "agent-ok",
      senderRole: "implementer",
      recipientId: "validator-1",
      messageType: "VALIDATION_REQUEST",
      payload: {},
    });
    const verdictEnv = createSignedEnvelope({
      senderId: "validator-1",
      senderRole: "validator",
      recipientId: "agent-ok",
      messageType: "VALIDATION_VERDICT",
      correlationId: reqEnv.correlation_id,
      payload: { verdict: "ACCEPTED" },
    });

    writeFileSync(
      join(agentDir, "cursor.json"),
      JSON.stringify({
        last_read_sequence: verdictEnv.sequence,
        last_read_id: verdictEnv.id,
        seen_ids: [verdictEnv.id],
        updated_at: new Date().toISOString(),
      }),
      "utf8",
    );
    writeFileSync(join(agentDir, "outbox.jsonl"), JSON.stringify(reqEnv) + "\n", "utf8");
    writeFileSync(join(agentDir, "inbox.jsonl"), JSON.stringify(verdictEnv) + "\n", "utf8");

    const res = await checkMailboxHealth({ repoRoot: scratch, slaThresholdSeconds: 60 });
    const loopFinding = res.findings.find((f) => f.code === "MAILBOX_BROKEN_COMMUNICATION_LOOP");
    expect(loopFinding).toBeUndefined();

    rmSync(scratch, { recursive: true, force: true });
  });

  test("autoHeal repairs corrupted cursor and reports in autoHealed list", async () => {
    const scratch = scratchRoot(import.meta.path, "mb-heal-auto-test");
    const agentDir = join(scratch, ".olt", "mailboxes", "agent-heal");
    mkdirSync(agentDir, { recursive: true });

    writeFileSync(join(agentDir, "cursor.json"), "invalid json content", "utf8");
    const env = createSignedEnvelope({
      senderId: "sender-1",
      senderRole: "orchestrator",
      recipientId: "agent-heal",
      messageType: "INFO",
      payload: { data: "test" },
    });
    writeFileSync(join(agentDir, "inbox.jsonl"), JSON.stringify(env) + "\n", "utf8");

    const res = await checkMailboxHealth({ repoRoot: scratch, autoHeal: true });
    expect(res.autoHealed).toBeDefined();
    expect(res.autoHealed?.length).toBeGreaterThan(0);
    expect(res.autoHealed?.[0]).toContain("Rebuilt corrupted cursor for mailbox 'agent-heal'");

    const directHeal = healCorruptedCursor(
      join(agentDir, "cursor.json"),
      join(agentDir, "inbox.jsonl"),
    );
    expect(directHeal).toBe(true);

    const pruned = pruneOrphanedMailboxes({ repoRoot: scratch, activeAgentIds: ["agent-heal"] });
    expect(pruned).toHaveLength(0);

    const healedAll = autoHealMailboxState({ repoRoot: scratch });
    expect(healedAll).toHaveLength(0);

    rmSync(scratch, { recursive: true, force: true });
  });
});

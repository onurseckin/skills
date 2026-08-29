import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  checkMailboxDiskActivity,
  checkMailboxHealth,
  healCorruptedCursor,
  pruneOrphanedMailboxes,
} from "../../../olt/scripts/src/reporting/doctor/mailbox-health-engine.ts";
import { createSignedEnvelope } from "../../../olt/scripts/src/communication/mailbox/envelope.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

describe("checkMailboxDiskActivity", () => {
  test("returns passed when mailboxes directory does not exist", () => {
    const res = checkMailboxDiskActivity("/non-existent-dir-for-doctor");
    expect(res.engine).toBe("checkMailboxDiskActivity");
    expect(res.passed).toBe(true);
    expect(res.findings).toHaveLength(0);
  });

  test("detects quarantine log, corrupt cursor, and malformed envelopes on disk", () => {
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
});

describe("checkMailboxHealth", () => {
  test("passes on clean empty mailboxes", () => {
    const scratch = scratchRoot(import.meta.path, "mb-health-clean-test");
    mkdirSync(join(scratch, ".olt", "mailboxes"), { recursive: true });

    const res = checkMailboxHealth({ repoRoot: scratch });
    expect(res.engine).toBe("checkMailboxHealth");
    expect(res.passed).toBe(true);
    expect(res.findings).toHaveLength(0);

    rmSync(scratch, { recursive: true, force: true });
  });

  test("detects HMAC signature mismatch in inbox", () => {
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

    const res = checkMailboxHealth({ repoRoot: scratch });
    expect(res.passed).toBe(false);
    const hmacFinding = res.findings.find((f) => f.code === "MAILBOX_HMAC_INTEGRITY_FAILURES");
    expect(hmacFinding).toBeDefined();

    rmSync(scratch, { recursive: true, force: true });
  });

  test("detects SLA exceeded and starvation on unread messages", () => {
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

    const res = checkMailboxHealth({ repoRoot: scratch, slaThresholdSeconds: 60 });
    const slaFinding = res.findings.find((f) => f.code === "MAILBOX_UNREAD_SLA_EXCEEDED");
    expect(slaFinding).toBeDefined();

    const starvFinding = res.findings.find((f) => f.code === "MAILBOX_MESSAGE_STARVATION");
    expect(starvFinding).toBeDefined();

    rmSync(scratch, { recursive: true, force: true });
  });

  test("heals corrupted cursor and prunes orphaned mailboxes with autoHeal", () => {
    const scratch = scratchRoot(import.meta.path, "mb-heal-test");
    const agentDir = join(scratch, ".olt", "mailboxes", "agent-heal");
    mkdirSync(agentDir, { recursive: true });

    writeFileSync(join(agentDir, "cursor.json"), "corrupt json", "utf8");
    const env = createSignedEnvelope({
      senderId: "s",
      senderRole: "implementer",
      recipientId: "agent-heal",
      messageType: "INFO",
      payload: {},
    });
    writeFileSync(join(agentDir, "inbox.jsonl"), JSON.stringify(env) + "\n", "utf8");

    const healed = healCorruptedCursor(
      join(agentDir, "cursor.json"),
      join(agentDir, "inbox.jsonl"),
    );
    expect(healed).toBe(true);

    const pruned = pruneOrphanedMailboxes({ repoRoot: scratch, activeAgentIds: ["agent-heal"] });
    expect(pruned).toHaveLength(0);

    rmSync(scratch, { recursive: true, force: true });
  });
});

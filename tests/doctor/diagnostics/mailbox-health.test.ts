import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import * as mb from "../../../olt/scripts/src/reporting/doctor/mailbox-health-engine.ts";
import { createSignedEnvelope } from "../../../olt/scripts/src/communication/mailbox/envelope.ts";
import {
  VirtualMemoryFS,
  createVirtualFSSession,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

export const mailboxHealthSuiteName = "Mailbox Health Engine Diagnostics";

let vfs: VirtualMemoryFS;
let session: VirtualFSSession | null = null;

beforeEach(() => {
  vfs = new VirtualMemoryFS();
  session = createVirtualFSSession(vfs);
});

afterEach(() => {
  session?.cleanup();
  session = null;
});

const setupAgent = (scratch: string, agent: string) => {
  const dir = join(scratch, ".olt", "mailboxes", agent);
  vfs.mkdirSync(dir, { recursive: true });
  return dir;
};

const setCursor = (dir: string, seq = 0, id = "", seen: string[] = []) =>
  vfs.writeFileSync(
    join(dir, "cursor.json"),
    JSON.stringify({
      last_read_sequence: seq,
      last_read_id: id,
      seen_ids: seen,
      updated_at: new Date().toISOString(),
    }),
  );

describe(mailboxHealthSuiteName, () => {
  test("checkMailboxDiskActivity returns passed when mailboxes dir does not exist", () => {
    const res = mb.checkMailboxDiskActivity("/non-existent-dir-for-doctor");
    expect(
      res.engine === "checkMailboxDiskActivity" && res.passed && res.findings.length === 0,
    ).toBe(true);
  });

  test("checkMailboxDiskActivity detects quarantine, corrupt cursor, and malformed envelopes", () => {
    const dir = setupAgent("/virtual/mb-disk-activity", "agent-bad");
    vfs.writeFileSync(join(dir, "quarantine.log"), "corrupt data 1\ncorrupt data 2\n");
    vfs.writeFileSync(join(dir, "cursor.json"), "invalid json");
    vfs.writeFileSync(join(dir, "inbox.jsonl"), "{ malformed line\n");

    const res = mb.checkMailboxDiskActivity("/virtual/mb-disk-activity");
    expect(res.engine === "checkMailboxDiskActivity" && !res.passed).toBe(true);
    expect(res.findings.some((f) => f.code === "MAILBOX_QUARANTINE_PRESENT")).toBe(true);
    expect(res.findings.some((f) => f.code === "MAILBOX_CURSOR_CORRUPTED")).toBe(true);
    expect(res.findings.some((f) => f.code === "MAILBOX_DISK_CORRUPT_ENVELOPE")).toBe(true);
  });

  test("checkMailboxHealth passes on clean empty mailboxes", async () => {
    const scratch = "/virtual/mb-clean";
    vfs.mkdirSync(join(scratch, ".olt", "mailboxes"), { recursive: true });
    const res = await mb.checkMailboxHealth({ repoRoot: scratch });
    expect(res.engine === "checkMailboxHealth" && res.passed && res.findings.length === 0).toBe(
      true,
    );
  });

  test("checkMailboxHealth detects HMAC signature mismatch and malformed envelopes", async () => {
    const dir = setupAgent("/virtual/mb-hmac", "agent-hmac");
    setCursor(dir);
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
    vfs.writeFileSync(join(dir, "inbox.jsonl"), JSON.stringify(badEnv) + "\n");

    const res = await mb.checkMailboxHealth({ repoRoot: "/virtual/mb-hmac" });
    expect(
      !res.passed && res.findings.some((f) => f.code === "MAILBOX_HMAC_INTEGRITY_FAILURES"),
    ).toBe(true);
  });

  test("checkMailboxHealth detects SLA exceeded and message starvation on unread messages", async () => {
    const dir = setupAgent("/virtual/mb-sla", "agent-sla");
    setCursor(dir);
    const oldTimestamp = new Date(Date.now() - 400 * 1000).toISOString();
    const signedEnv = {
      ...createSignedEnvelope({
        senderId: "sender",
        senderRole: "implementer",
        recipientId: "agent-sla",
        messageType: "VALIDATION_REQUEST",
        payload: {},
      }),
      timestamp: oldTimestamp,
    };
    vfs.writeFileSync(join(dir, "inbox.jsonl"), JSON.stringify(signedEnv) + "\n");

    const res = await mb.checkMailboxHealth({
      repoRoot: "/virtual/mb-sla",
      slaThresholdSeconds: 60,
    });
    expect(res.findings.some((f) => f.code === "MAILBOX_UNREAD_SLA_EXCEEDED")).toBe(true);
    expect(res.findings.some((f) => f.code === "MAILBOX_MESSAGE_STARVATION")).toBe(true);
  });

  test("checkMailboxHealth detects broken loops when VALIDATION_REQUEST is unresponded", async () => {
    const dir = setupAgent("/virtual/mb-loop", "agent-loop");
    const oldTimestamp = new Date(Date.now() - 150 * 1000).toISOString();
    const oldReqEnv = {
      ...createSignedEnvelope({
        senderId: "agent-loop",
        senderRole: "implementer",
        recipientId: "validator-1",
        messageType: "VALIDATION_REQUEST",
        payload: { test: true },
      }),
      timestamp: oldTimestamp,
    };

    setCursor(dir, oldReqEnv.sequence, oldReqEnv.id, [oldReqEnv.id]);
    vfs.writeFileSync(join(dir, "outbox.jsonl"), JSON.stringify(oldReqEnv) + "\n");

    const res = await mb.checkMailboxHealth({
      repoRoot: "/virtual/mb-loop",
      slaThresholdSeconds: 60,
    });
    const loopFinding = res.findings.find((f) => f.code === "MAILBOX_BROKEN_COMMUNICATION_LOOP");
    expect(loopFinding !== undefined && loopFinding.severity === "WARN").toBe(true);
  });

  test("checkMailboxHealth does not report broken loop when VALIDATION_VERDICT is present", async () => {
    const dir = setupAgent("/virtual/mb-loop-ok", "agent-ok");
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

    setCursor(dir, verdictEnv.sequence, verdictEnv.id, [verdictEnv.id]);
    vfs.writeFileSync(join(dir, "outbox.jsonl"), JSON.stringify(reqEnv) + "\n");
    vfs.writeFileSync(join(dir, "inbox.jsonl"), JSON.stringify(verdictEnv) + "\n");

    const res = await mb.checkMailboxHealth({
      repoRoot: "/virtual/mb-loop-ok",
      slaThresholdSeconds: 60,
    });
    expect(res.findings.some((f) => f.code === "MAILBOX_BROKEN_COMMUNICATION_LOOP")).toBe(false);
  });

  test("autoHeal repairs corrupted cursor and reports in autoHealed list", async () => {
    const dir = setupAgent("/virtual/mb-heal", "agent-heal");
    vfs.writeFileSync(join(dir, "cursor.json"), "invalid json content");
    const env = createSignedEnvelope({
      senderId: "sender-1",
      senderRole: "orchestrator",
      recipientId: "agent-heal",
      messageType: "INFO",
      payload: { data: "test" },
    });
    vfs.writeFileSync(join(dir, "inbox.jsonl"), JSON.stringify(env) + "\n");

    const res = await mb.checkMailboxHealth({ repoRoot: "/virtual/mb-heal", autoHeal: true });
    expect(
      Boolean(
        res.autoHealed &&
        res.autoHealed.length > 0 &&
        res.autoHealed[0]?.includes("Rebuilt corrupted cursor for mailbox 'agent-heal'"),
      ),
    ).toBe(true);
    expect(mb.healCorruptedCursor(join(dir, "cursor.json"), join(dir, "inbox.jsonl"))).toBe(true);
    expect(
      mb.pruneOrphanedMailboxes({ repoRoot: "/virtual/mb-heal", activeAgentIds: ["agent-heal"] }),
    ).toHaveLength(0);
    expect(mb.autoHealMailboxState({ repoRoot: "/virtual/mb-heal" })).toHaveLength(0);
  });
});

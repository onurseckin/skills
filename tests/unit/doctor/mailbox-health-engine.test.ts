import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createSignedEnvelope } from "../../../olt/scripts/src/communication/mailbox/envelope.ts";
import {
  autoHealMailboxState,
  checkMailboxHealth,
  healCorruptedCursor,
  pruneOrphanedMailboxes,
} from "../../../olt/scripts/src/reporting/doctor/mailbox-health-engine.ts";
import { autoHealCapsule } from "../../../olt/scripts/src/reporting/doctor/auto-heal.ts";

describe("Doctor Mailbox Health Engine & Auto-Healing", () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = join(
      process.cwd(),
      "coverage",
      "test-isolation",
      `mb-doctor-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(testRoot, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testRoot)) rmSync(testRoot, { recursive: true, force: true });
  });

  function setupMailbox(agentId: string): {
    dir: string;
    inbox: string;
    outbox: string;
    cursor: string;
    quarantine: string;
  } {
    const dir = join(testRoot, ".olt", "mailboxes", agentId);
    mkdirSync(dir, { recursive: true });
    const inbox = join(dir, "inbox.jsonl");
    const outbox = join(dir, "outbox.jsonl");
    const cursor = join(dir, "cursor.json");
    const quarantine = join(dir, "quarantine.log");
    writeFileSync(
      cursor,
      JSON.stringify(
        {
          last_read_sequence: 0,
          last_read_id: "",
          seen_ids: [],
          updated_at: new Date().toISOString(),
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
    return { dir, inbox, outbox, cursor, quarantine };
  }

  it("passes cleanly when mailboxes directory does not exist or is empty", () => {
    const res = checkMailboxHealth({ repoRoot: testRoot });
    expect(res.engine).toBe("checkMailboxHealth");
    expect(res.passed).toBe(true);
    expect(res.findings.length).toBe(0);
  });

  it("passes cleanly with healthy read mailboxes", () => {
    const { inbox, cursor } = setupMailbox("agent-1");
    const env = createSignedEnvelope({
      senderId: "agent-0",
      senderRole: "orchestrator",
      recipientId: "agent-1",
      messageType: "DISPATCH_TASK",
      payload: { task: "t1" },
      sequence: 1,
    });
    writeFileSync(inbox, JSON.stringify(env) + "\n", "utf8");
    writeFileSync(
      cursor,
      JSON.stringify(
        {
          last_read_sequence: 1,
          last_read_id: env.id,
          seen_ids: [env.id],
          updated_at: new Date().toISOString(),
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
    const res = checkMailboxHealth({ repoRoot: testRoot });
    expect(res.passed).toBe(true);
    expect(res.findings.length).toBe(0);
  });

  it("detects unread message SLA exceeded and message starvation", () => {
    const { inbox } = setupMailbox("agent-sla");
    const oldTimestamp = new Date(Date.now() - 150 * 1000).toISOString();
    const envWarn = {
      ...createSignedEnvelope({
        senderId: "agent-0",
        senderRole: "orchestrator",
        recipientId: "agent-sla",
        messageType: "DISPATCH_TASK",
        payload: { task: "t-warn" },
        sequence: 1,
      }),
      timestamp: oldTimestamp,
    };
    const starvingTimestamp = new Date(Date.now() - 350 * 1000).toISOString();
    const envStarve = {
      ...createSignedEnvelope({
        senderId: "agent-0",
        senderRole: "orchestrator",
        recipientId: "agent-sla",
        messageType: "DISPATCH_TASK",
        payload: { task: "t-starve" },
        sequence: 2,
      }),
      timestamp: starvingTimestamp,
    };
    writeFileSync(inbox, JSON.stringify(envWarn) + "\n" + JSON.stringify(envStarve) + "\n", "utf8");
    const res = checkMailboxHealth({ repoRoot: testRoot, slaThresholdSeconds: 120 });
    const slaFinding = res.findings.find((f) => f.code === "MAILBOX_UNREAD_SLA_EXCEEDED");
    const starveFinding = res.findings.find((f) => f.code === "MAILBOX_MESSAGE_STARVATION");
    expect(slaFinding).toBeDefined();
    expect(slaFinding?.severity).toBe("WARN");
    expect(starveFinding).toBeDefined();
    expect(starveFinding?.severity).toBe("ERROR");
    expect(res.passed).toBe(false);
  });

  it("detects broken agent communication loop for unresponded validation request", () => {
    const { outbox: senderOutbox } = setupMailbox("sender-agent");
    setupMailbox("validator-agent");
    const oldTimestamp = new Date(Date.now() - 200 * 1000).toISOString();
    const reqEnv = {
      ...createSignedEnvelope({
        senderId: "sender-agent",
        senderRole: "orchestrator",
        recipientId: "validator-agent",
        messageType: "VALIDATION_REQUEST",
        payload: { run: "r1" },
        sequence: 1,
      }),
      timestamp: oldTimestamp,
    };
    writeFileSync(senderOutbox, JSON.stringify(reqEnv) + "\n", "utf8");
    const res = checkMailboxHealth({ repoRoot: testRoot, slaThresholdSeconds: 120 });
    const loopFinding = res.findings.find((f) => f.code === "MAILBOX_BROKEN_COMMUNICATION_LOOP");
    expect(loopFinding).toBeDefined();
    expect(loopFinding?.severity).toBe("WARN");
  });

  it("does not report broken loop when validation verdict is present", () => {
    const { outbox: senderOutbox } = setupMailbox("sender-agent-2");
    const { outbox: validatorOutbox } = setupMailbox("validator-agent-2");
    const oldTimestamp = new Date(Date.now() - 200 * 1000).toISOString();
    const reqEnv = {
      ...createSignedEnvelope({
        senderId: "sender-agent-2",
        senderRole: "orchestrator",
        recipientId: "validator-agent-2",
        messageType: "VALIDATION_REQUEST",
        payload: { run: "r2" },
        sequence: 1,
      }),
      timestamp: oldTimestamp,
    };
    const verdictEnv = createSignedEnvelope({
      senderId: "validator-agent-2",
      senderRole: "validator",
      recipientId: "sender-agent-2",
      messageType: "VALIDATION_VERDICT",
      payload: { approved: true },
      sequence: 1,
      correlationId: reqEnv.correlation_id,
    });
    writeFileSync(senderOutbox, JSON.stringify(reqEnv) + "\n", "utf8");
    writeFileSync(validatorOutbox, JSON.stringify(verdictEnv) + "\n", "utf8");
    const res = checkMailboxHealth({ repoRoot: testRoot, slaThresholdSeconds: 120 });
    const loopFinding = res.findings.find((f) => f.code === "MAILBOX_BROKEN_COMMUNICATION_LOOP");
    expect(loopFinding).toBeUndefined();
  });

  it("detects quarantine log presence and reports warning", () => {
    const { quarantine } = setupMailbox("agent-quarantine");
    writeFileSync(quarantine, "[2026-08-29T10:00:00Z] [REASON: MALFORMED] {bad: line}\n", "utf8");
    const res = checkMailboxHealth({ repoRoot: testRoot });
    const qFinding = res.findings.find((f) => f.code === "MAILBOX_QUARANTINE_PRESENT");
    expect(qFinding).toBeDefined();
    expect(qFinding?.severity).toBe("WARN");
  });

  it("detects HMAC integrity failure for tampered envelopes", () => {
    const { inbox } = setupMailbox("agent-tampered");
    const env = createSignedEnvelope({
      senderId: "agent-0",
      senderRole: "orchestrator",
      recipientId: "agent-tampered",
      messageType: "DISPATCH_TASK",
      payload: { data: "original" },
      sequence: 1,
    });
    const tampered = { ...env, payload: { data: "tampered-content" } };
    writeFileSync(inbox, JSON.stringify(tampered) + "\n", "utf8");
    const res = checkMailboxHealth({ repoRoot: testRoot });
    const hmacFinding = res.findings.find((f) => f.code === "MAILBOX_HMAC_INTEGRITY_FAILURES");
    expect(hmacFinding).toBeDefined();
    expect(hmacFinding?.severity).toBe("ERROR");
    expect(res.passed).toBe(false);
  });

  it("detects corrupted cursor.json without auto-heal", () => {
    const { cursor } = setupMailbox("agent-corrupt-cursor");
    writeFileSync(cursor, "INVALID_NOT_JSON", "utf8");
    const res = checkMailboxHealth({ repoRoot: testRoot, autoHeal: false });
    const cFinding = res.findings.find((f) => f.code === "MAILBOX_CURSOR_CORRUPTED");
    expect(cFinding).toBeDefined();
    expect(cFinding?.severity).toBe("ERROR");
  });

  it("heals corrupted cursor with autoHeal option", () => {
    const { cursor, inbox } = setupMailbox("agent-heal-cursor");
    const env1 = createSignedEnvelope({
      senderId: "agent-0",
      senderRole: "orchestrator",
      recipientId: "agent-heal-cursor",
      messageType: "DISPATCH_TASK",
      payload: { step: 1 },
      sequence: 1,
    });
    const env2 = createSignedEnvelope({
      senderId: "agent-0",
      senderRole: "orchestrator",
      recipientId: "agent-heal-cursor",
      messageType: "DISPATCH_TASK",
      payload: { step: 2 },
      sequence: 2,
    });
    writeFileSync(inbox, JSON.stringify(env1) + "\n" + JSON.stringify(env2) + "\n", "utf8");
    writeFileSync(cursor, "{ bad: json }", "utf8");
    const res = checkMailboxHealth({ repoRoot: testRoot, autoHeal: true });
    expect(res.autoHealed).toBeDefined();
    expect(res.autoHealed?.some((msg) => msg.includes("agent-heal-cursor"))).toBe(true);
    const parsedCursor = JSON.parse(readFileSync(cursor, "utf8"));
    expect(parsedCursor.last_read_sequence).toBe(2);
    expect(parsedCursor.seen_ids).toContain(env1.id);
    expect(parsedCursor.seen_ids).toContain(env2.id);
  });

  it("tests healCorruptedCursor direct invocation", () => {
    const cursorPath = join(testRoot, "test-cursor.json");
    const inboxPath = join(testRoot, "test-inbox.jsonl");
    const env = createSignedEnvelope({
      senderId: "agent-a",
      senderRole: "orchestrator",
      recipientId: "agent-b",
      messageType: "DISPATCH_TASK",
      payload: { v: 42 },
      sequence: 5,
    });
    writeFileSync(inboxPath, JSON.stringify(env) + "\n", "utf8");
    const ok = healCorruptedCursor(cursorPath, inboxPath);
    expect(ok).toBe(true);
    const cursor = JSON.parse(readFileSync(cursorPath, "utf8"));
    expect(cursor.last_read_sequence).toBe(5);
    expect(cursor.last_read_id).toBe(env.id);
  });

  it("prunes orphaned mailboxes for inactive agents", () => {
    setupMailbox("active-agent");
    const { inbox: orphanInbox, dir: orphanDir } = setupMailbox("orphan-agent");
    const env = createSignedEnvelope({
      senderId: "agent-0",
      senderRole: "orchestrator",
      recipientId: "orphan-agent",
      messageType: "DISPATCH_TASK",
      payload: { test: true },
      sequence: 1,
    });
    writeFileSync(orphanInbox, JSON.stringify(env) + "\n", "utf8");
    const pruned = pruneOrphanedMailboxes({ repoRoot: testRoot, activeAgentIds: ["active-agent"] });
    expect(pruned.length).toBe(1);
    expect(pruned[0]).toContain("orphan-agent");
    expect(existsSync(orphanInbox)).toBe(false);
    expect(existsSync(join(orphanDir, "archive.jsonl"))).toBe(true);
  });

  it("autoHealMailboxState executes cursor healing and pruning", () => {
    const { cursor: corruptCursor } = setupMailbox("agent-auto-1");
    writeFileSync(corruptCursor, "{ invalid", "utf8");
    setupMailbox("orphan-auto-2");
    const healed = autoHealMailboxState({ repoRoot: testRoot, activeAgentIds: ["agent-auto-1"] });
    expect(healed.length).toBeGreaterThanOrEqual(2);
    expect(healed.some((h) => h.includes("agent-auto-1"))).toBe(true);
    expect(healed.some((h) => h.includes("orphan-auto-2"))).toBe(true);
  });

  it("integrates autoHealMailboxState in autoHealCapsule", () => {
    const runRoot = join(testRoot, ".olt", "capsules", "run-1");
    mkdirSync(runRoot, { recursive: true });
    writeFileSync(join(runRoot, "events.jsonl"), "", "utf8");
    const { cursor } = setupMailbox("agent-capsule-heal");
    writeFileSync(cursor, "{ corrupt", "utf8");
    const result = autoHealCapsule(runRoot, { repoRoot: testRoot });
    expect(result.autoHealed.some((msg) => msg.includes("agent-capsule-heal"))).toBe(true);
  });
});

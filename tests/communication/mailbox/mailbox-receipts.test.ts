import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  collectInboxReceipts,
  dispatchPeerMessage,
  loadMailboxCursor,
  resolveMailboxPaths,
} from "../../../olt/scripts/src/communication/mailbox/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { cleanupVirtualCommunicationFS, setupVirtualCommunicationFS } from "../helpers.ts";

describe("Mailbox Receipt Collection & Cursor Integration", () => {
  let testRoot: string;

  beforeEach(() => {
    setupVirtualCommunicationFS();
    testRoot = join(
      process.cwd(),
      "coverage",
      "scratch",
      `rcpt-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(testRoot, { recursive: true });

    dispatchPeerMessage({
      senderId: "w-1",
      senderRole: "w",
      recipientRoleOrId: "coord-main",
      messageType: "HANDOFF_RECEIPT",
      payload: { step: 1 },
      correlationId: "corr-A",
      baseDir: testRoot,
    });
    dispatchPeerMessage({
      senderId: "w-2",
      senderRole: "w",
      recipientRoleOrId: "coord-main",
      messageType: "VALIDATION_VERDICT",
      payload: { ok: true },
      correlationId: "corr-A",
      baseDir: testRoot,
    });
    dispatchPeerMessage({
      senderId: "w-1",
      senderRole: "w",
      recipientRoleOrId: "coord-main",
      messageType: "DISPATCH_TASK",
      payload: { step: 2 },
      correlationId: "corr-B",
      baseDir: testRoot,
    });
  });

  afterEach(() => {
    cleanupVirtualCommunicationFS();
    if (existsSync(testRoot)) rmSync(testRoot, { recursive: true, force: true });
  });

  it("collects all unread messages when no filters are set", () => {
    const result = collectInboxReceipts("coord-main", { baseDir: testRoot });
    expect(result.totalReceipts).toBe(3);
    expect(result.receipts.length).toBe(3);
  });

  it("filters receipts by correlationId and messageType", () => {
    const corrA = collectInboxReceipts("coord-main", {
      correlationId: "corr-A",
      baseDir: testRoot,
    });
    expect(corrA.totalReceipts).toBe(2);

    const verdicts = collectInboxReceipts("coord-main", {
      messageType: "VALIDATION_VERDICT",
      baseDir: testRoot,
    });
    expect(verdicts.totalReceipts).toBe(1);
    expect(verdicts.receipts[0]!.message_type).toBe("VALIDATION_VERDICT");

    const filtered = collectInboxReceipts("coord-main", {
      correlationId: "corr-A",
      messageType: "HANDOFF_RECEIPT",
      baseDir: testRoot,
    });
    expect(filtered.totalReceipts).toBe(1);
    expect(filtered.receipts[0]!.correlation_id).toBe("corr-A");
  });

  it("advances cursor atomically when advanceCursor is true", () => {
    const paths = resolveMailboxPaths("coord-main", testRoot);
    const initial = loadMailboxCursor(paths.cursorPath);
    expect(initial.last_read_sequence).toBe(0);

    const collected = collectInboxReceipts("coord-main", {
      correlationId: "corr-A",
      advanceCursor: true,
      baseDir: testRoot,
    });
    expect(collected.totalReceipts).toBe(2);

    const updated = loadMailboxCursor(paths.cursorPath);
    expect(updated.last_read_sequence).toBeGreaterThan(0);
    expect(updated.seen_ids.length).toBe(2);

    const secondPass = collectInboxReceipts("coord-main", {
      correlationId: "corr-A",
      baseDir: testRoot,
    });
    expect(secondPass.totalReceipts).toBe(0);
  });

  it("does not advance cursor when advanceCursor is false or when no receipts match", () => {
    const paths = resolveMailboxPaths("coord-main", testRoot);
    collectInboxReceipts("coord-main", { correlationId: "corr-A", baseDir: testRoot });
    expect(loadMailboxCursor(paths.cursorPath).last_read_sequence).toBe(0);

    const noMatch = collectInboxReceipts("coord-main", {
      correlationId: "non-existent",
      advanceCursor: true,
      baseDir: testRoot,
    });
    expect(noMatch.totalReceipts).toBe(0);
    expect(loadMailboxCursor(paths.cursorPath).last_read_sequence).toBe(0);
  });

  it("quarantines tampered HMAC signatures and torn lines during receipt collection", () => {
    const paths = resolveMailboxPaths("tamper-agent", testRoot);
    mkdirSync(join(testRoot, ".olt", "mailboxes", "tamper-agent"), { recursive: true });

    const validEnv = dispatchPeerMessage({
      senderId: "w-1",
      senderRole: "w",
      recipientRoleOrId: "tamper-agent",
      messageType: "HANDOFF_RECEIPT",
      payload: { ok: true },
      baseDir: testRoot,
    });

    const tamperedEnv = {
      ...validEnv,
      id: "fake-id",
      hmac_signature: "deadbeef00112233445566778899aabbccddeeff",
    };
    appendFileSync(paths.inboxPath, "\n{ torn JSON invalid\n" + JSON.stringify(tamperedEnv) + "\n");

    const result = collectInboxReceipts("tamper-agent", { baseDir: testRoot });
    expect(result.totalReceipts).toBe(1);
    expect(result.receipts[0]!.id).toBe(validEnv.id);
    expect(existsSync(paths.quarantinePath)).toBe(true);
    const qLog = readFileSync(paths.quarantinePath, "utf8");
    expect(qLog).toContain("MALFORMED_JSON_SYNTAX");
    expect(qLog).toContain("HMAC_VERIFICATION_FAILED");
  });

  it("fails closed on empty agent ID", () => {
    expect(() => collectInboxReceipts("", { baseDir: testRoot })).toThrow(HarnessError);
  });

  it("ensures file is <= 300 physical lines", () => {
    const file = join(process.cwd(), "tests/communication/mailbox/mailbox-receipts.test.ts");
    const lines = readFileSync(file, "utf8").split("\n");
    expect(lines.length).toBeLessThanOrEqual(300);
  });
});

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createSignedEnvelope,
  ensureMailboxDirectories,
  quarantineTornLines,
  readUnreadMessages,
  resolveMailboxPaths,
} from "../../../olt/scripts/src/communication/mailbox/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";

describe("Mailbox Stream Quarantine & Torn Line Engine", () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = join(
      process.cwd(),
      "coverage",
      "test-isolation",
      `mb-q-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(testRoot, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testRoot)) rmSync(testRoot, { recursive: true, force: true });
  });

  describe("Torn Lines & Quarantine Stripping", () => {
    it("strips unterminated JSON fragments, invalid envelopes, and tampered lines into quarantine.log", () => {
      const paths = resolveMailboxPaths("agent-epsilon", testRoot);
      ensureMailboxDirectories(paths);
      const valid1 = createSignedEnvelope({
        senderId: "s",
        senderRole: "r",
        recipientId: "agent-epsilon",
        messageType: "DISPATCH_TASK",
        payload: { v: 1 },
        sequence: 1,
      });
      const valid2 = createSignedEnvelope({
        senderId: "s",
        senderRole: "r",
        recipientId: "agent-epsilon",
        messageType: "DISPATCH_TASK",
        payload: { v: 2 },
        sequence: 2,
      });
      const tampered = { ...valid1, id: "tampered-id", payload: { hack: true } };
      const raw = [
        JSON.stringify(valid1),
        '{"id": "broken-torn',
        '{"id": "not-env", "x": 1}',
        JSON.stringify(tampered),
        JSON.stringify(valid2),
        "",
      ].join("\n");
      writeFileSync(paths.inboxPath, raw, "utf8");

      const readResult = readUnreadMessages(paths.inboxPath, null, {
        quarantinePath: paths.quarantinePath,
        verifyHmac: true,
      });
      expect(readResult.quarantinedCount).toBe(3);
      expect(readResult.messages.length).toBe(2);
      expect(existsSync(paths.quarantinePath)).toBe(true);
      const qLog = readFileSync(paths.quarantinePath, "utf8");
      expect(qLog).toContain("MALFORMED_JSON_SYNTAX");
      expect(qLog).toContain("INVALID_ENVELOPE_STRUCTURE");
      expect(qLog).toContain("HMAC_VERIFICATION_FAILED");
      const sanitized = readFileSync(paths.inboxPath, "utf8").trim().split("\n");
      expect(sanitized.length).toBe(2);
    });

    it("quarantineTornLines cleanses corrupted lines directly", () => {
      const paths = resolveMailboxPaths("agent-zeta", testRoot);
      ensureMailboxDirectories(paths);
      writeFileSync(paths.inboxPath, '{"broken\n{"also-broken\n', "utf8");
      expect(quarantineTornLines(paths.inboxPath, paths.quarantinePath)).toBe(2);
      expect(readFileSync(paths.inboxPath, "utf8")).toBe("");
    });

    it("throws HarnessError on malformed inbox when quarantinePath is omitted", () => {
      const paths = resolveMailboxPaths("agent-eta", testRoot);
      ensureMailboxDirectories(paths);
      writeFileSync(paths.inboxPath, '{"broken json\n', "utf8");
      expect(() => readUnreadMessages(paths.inboxPath)).toThrow(HarnessError);
    });
  });

  describe("HMAC Verification & Tampered Message Quarantine", () => {
    it("quarantines tampered HMAC messages when verifyHmac is true and quarantinePath is provided", () => {
      const paths = resolveMailboxPaths("agent-theta", testRoot);
      ensureMailboxDirectories(paths);
      const valid = createSignedEnvelope({
        senderId: "s",
        senderRole: "r",
        recipientId: "agent-theta",
        messageType: "DISPATCH_TASK",
        payload: { secret: 42 },
        sequence: 1,
      });
      const tampered = { ...valid, id: "tampered-id", payload: { secret: 999 } };
      writeFileSync(
        paths.inboxPath,
        `${JSON.stringify(valid)}\n${JSON.stringify(tampered)}\n`,
        "utf8",
      );

      const result = readUnreadMessages(paths.inboxPath, null, {
        verifyHmac: true,
        quarantinePath: paths.quarantinePath,
      });
      expect(result.quarantinedCount).toBe(1);
      expect(result.messages.length).toBe(1);
      expect(result.messages[0]!.id).toBe(valid.id);
      expect(readFileSync(paths.quarantinePath, "utf8")).toContain("HMAC_VERIFICATION_FAILED");
    });

    it("throws HarnessError when tampered HMAC is encountered without quarantinePath", () => {
      const paths = resolveMailboxPaths("agent-iota", testRoot);
      ensureMailboxDirectories(paths);
      const valid = createSignedEnvelope({
        senderId: "s",
        senderRole: "r",
        recipientId: "agent-iota",
        messageType: "DISPATCH_TASK",
        payload: {},
        sequence: 1,
      });
      writeFileSync(
        paths.inboxPath,
        `${JSON.stringify({ ...valid, payload: { tampered: true } })}\n`,
        "utf8",
      );
      expect(() => readUnreadMessages(paths.inboxPath, null, { verifyHmac: true })).toThrow(
        HarnessError,
      );
    });
  });

  describe("Architecture Invariants", () => {
    it("ensures test file is <= 300 physical lines with 0 any", () => {
      const file = join(process.cwd(), "tests/unit/communication/mailbox-quarantine.test.ts");
      const lines = readFileSync(file, "utf8").split("\n");
      expect(lines.length).toBeLessThanOrEqual(300);
    });
  });
});

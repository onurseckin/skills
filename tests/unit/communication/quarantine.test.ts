import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createSignedEnvelope,
  ensureMailboxDirectories,
  ingestToQuarantine,
  quarantineTornLines,
  readUnreadMessages,
  resolveMailboxPaths,
  sweepQuarantineDeadLetters,
} from "../../../olt/scripts/src/communication/mailbox/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";

describe("Mailbox Quarantine Engine", () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = join(
      process.cwd(),
      "coverage",
      "test-isolation",
      `quarantine-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(testRoot, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testRoot)) rmSync(testRoot, { recursive: true, force: true });
  });

  describe("ingestToQuarantine", () => {
    it("appends malformed envelope to quarantine.log and returns structured entry", () => {
      const entry = ingestToQuarantine(
        "agent-alpha",
        { broken: "payload", raw: 123 },
        "CORRUPTED_PAYLOAD",
        { baseDir: testRoot },
      );

      expect(entry.agentId).toBe("agent-alpha");
      expect(entry.reason).toBe("CORRUPTED_PAYLOAD");
      expect(entry.rawEnvelope).toContain("payload");
      expect(existsSync(entry.quarantinePath)).toBe(true);

      const log = readFileSync(entry.quarantinePath, "utf8");
      expect(log).toContain("[REASON: CORRUPTED_PAYLOAD]");
      expect(log).toContain('{"broken":"payload","raw":123}');
    });

    it("handles string rawEnvelope and custom lockPath", () => {
      const paths = resolveMailboxPaths("agent-beta", testRoot);
      const entry = ingestToQuarantine("agent-beta", "raw unparsed junk string", "SYNTAX_ERROR", {
        baseDir: testRoot,
        lockPath: paths.lockPath,
      });

      expect(entry.rawEnvelope).toBe("raw unparsed junk string");
      const log = readFileSync(paths.quarantinePath, "utf8");
      expect(log).toContain("[REASON: SYNTAX_ERROR] raw unparsed junk string");
    });

    it("throws HarnessError on invalid agentId or empty reason", () => {
      expect(() => ingestToQuarantine("", "data", "REASON")).toThrow(HarnessError);
      expect(() => ingestToQuarantine("agent/traversal", "data", "REASON")).toThrow(HarnessError);
      expect(() => ingestToQuarantine("agent-gamma", "data", "")).toThrow(HarnessError);
    });
  });

  describe("sweepQuarantineDeadLetters", () => {
    it("sweeps dead letters across all agent mailboxes", () => {
      ingestToQuarantine("agent-1", '{"bad": 1}', "BAD_1", { baseDir: testRoot });
      ingestToQuarantine("agent-2", '{"bad": 2}', "BAD_2", { baseDir: testRoot });

      const sweep = sweepQuarantineDeadLetters({ baseDir: testRoot });
      expect(sweep.totalEntries).toBe(2);
      expect(sweep.deadLetters.length).toBe(2);
      expect(sweep.purgedEntries).toBe(0);

      const reasons = sweep.deadLetters.map((d) => d.reason);
      expect(reasons).toContain("BAD_1");
      expect(reasons).toContain("BAD_2");
    });

    it("sweeps single agent quarantine when agentId option is specified", () => {
      ingestToQuarantine("agent-1", '{"bad": 1}', "BAD_1", { baseDir: testRoot });
      ingestToQuarantine("agent-2", '{"bad": 2}', "BAD_2", { baseDir: testRoot });

      const sweep = sweepQuarantineDeadLetters({ baseDir: testRoot, agentId: "agent-1" });
      expect(sweep.totalEntries).toBe(1);
      expect(sweep.deadLetters.length).toBe(1);
      expect(sweep.deadLetters[0].agentId).toBe("agent-1");
    });

    it("purges dead letters when purge flag is true", () => {
      const entry = ingestToQuarantine("agent-purge", "corrupt text", "PURGE_ME", {
        baseDir: testRoot,
      });
      expect(existsSync(entry.quarantinePath)).toBe(true);

      const sweep = sweepQuarantineDeadLetters({
        baseDir: testRoot,
        agentId: "agent-purge",
        purge: true,
      });
      expect(sweep.totalEntries).toBe(1);
      expect(sweep.purgedEntries).toBe(1);
      expect(readFileSync(entry.quarantinePath, "utf8")).toBe("");
    });

    it("filters dead letters by maxAgeMs", () => {
      const paths = resolveMailboxPaths("agent-age", testRoot);
      ensureMailboxDirectories(paths);
      const oldTime = new Date(Date.now() - 100000).toISOString();
      const freshTime = new Date().toISOString();
      writeFileSync(
        paths.quarantinePath,
        `[${oldTime}] [REASON: OLD_ERROR] old data\n[${freshTime}] [REASON: NEW_ERROR] new data\n`,
        "utf8",
      );

      const sweep = sweepQuarantineDeadLetters({
        baseDir: testRoot,
        agentId: "agent-age",
        maxAgeMs: 50000,
      });
      expect(sweep.totalEntries).toBe(2);
      expect(sweep.deadLetters.length).toBe(1);
      expect(sweep.deadLetters[0].reason).toBe("OLD_ERROR");
    });
  });

  describe("Torn Lines & Quarantine Stripping Integration", () => {
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
    });

    it("quarantineTornLines cleanses corrupted lines directly", () => {
      const paths = resolveMailboxPaths("agent-zeta", testRoot);
      ensureMailboxDirectories(paths);
      writeFileSync(paths.inboxPath, '{"broken\n{"also-broken\n', "utf8");
      expect(quarantineTornLines(paths.inboxPath, paths.quarantinePath)).toBe(2);
      expect(readFileSync(paths.inboxPath, "utf8")).toBe("");
    });
  });
});

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  clearInMemoryQuarantines,
  createSignedEnvelope,
  ensureMailboxDirectories,
  getInMemoryQuarantine,
  ingestToQuarantine,
  quarantineTornLines,
  readUnreadMessages,
  registerInMemoryMailboxDir,
  resolveMailboxPaths,
  setInMemoryQuarantine,
  sweepQuarantineDeadLetters,
  writeInMemoryQuarantine,
} from "../../../olt/scripts/src/communication/mailbox/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";

describe("Mailbox Quarantine Engine", () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = join(
      process.cwd(),
      "coverage",
      "scratch",
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

    it("handles string, primitive rawEnvelope, and empty lockPath", () => {
      const paths = resolveMailboxPaths("agent-beta", testRoot);
      const entry = ingestToQuarantine("agent-beta", "raw unparsed junk string", "SYNTAX_ERROR", {
        baseDir: testRoot,
        lockPath: paths.lockPath,
      });

      expect(entry.rawEnvelope).toBe("raw unparsed junk string");
      const log = readFileSync(paths.quarantinePath, "utf8");
      expect(log).toContain("[REASON: SYNTAX_ERROR] raw unparsed junk string");

      const numEntry = ingestToQuarantine("agent-beta", 98765, "NUMBER_PAYLOAD", {
        baseDir: testRoot,
        lockPath: "  ",
      });
      expect(numEntry.rawEnvelope).toBe("98765");
    });

    it("throws HarnessError on invalid agentId or empty reason", () => {
      expect(() => ingestToQuarantine("", "data", "REASON")).toThrow(HarnessError);
      expect(() => ingestToQuarantine(123 as unknown as string, "data", "REASON")).toThrow(
        HarnessError,
      );
      expect(() => ingestToQuarantine("agent/traversal", "data", "REASON")).toThrow(HarnessError);
      expect(() => ingestToQuarantine("agent-gamma", "data", "")).toThrow(HarnessError);
      expect(() => ingestToQuarantine("agent-gamma", "data", 123 as unknown as string)).toThrow(
        HarnessError,
      );
    });
  });

  describe("sweepQuarantineDeadLetters", () => {
    it("sweeps dead letters across all agent mailboxes and handles non-directory files", () => {
      ingestToQuarantine("agent-1", '{"bad": 1}', "BAD_1", { baseDir: testRoot });
      ingestToQuarantine("agent-2", '{"bad": 2}', "BAD_2", { baseDir: testRoot });

      const mailboxesDir = join(testRoot, ".olt", "mailboxes");
      writeFileSync(join(mailboxesDir, "regular-file.txt"), "not a dir", "utf8");

      const sweep = sweepQuarantineDeadLetters({ baseDir: testRoot });
      expect(sweep.totalEntries).toBe(2);
      expect(sweep.deadLetters.length).toBe(2);
      expect(sweep.purgedEntries).toBe(0);

      const reasons = sweep.deadLetters.map((d) => d.reason);
      expect(reasons).toContain("BAD_1");
      expect(reasons).toContain("BAD_2");
    });

    it("returns empty result when mailboxes dir does not exist", () => {
      const nonExistentRoot = join(testRoot, "nonexistent");
      const sweep = sweepQuarantineDeadLetters({ baseDir: nonExistentRoot });
      expect(sweep.totalEntries).toBe(0);
      expect(sweep.deadLetters).toEqual([]);
    });

    it("sweeps single agent quarantine when agentId option is specified", () => {
      ingestToQuarantine("agent-1", '{"bad": 1}', "BAD_1", { baseDir: testRoot });
      ingestToQuarantine("agent-2", '{"bad": 2}', "BAD_2", { baseDir: testRoot });

      const sweep = sweepQuarantineDeadLetters({ baseDir: testRoot, agentId: "agent-1" });
      expect(sweep.totalEntries).toBe(1);
      expect(sweep.deadLetters.length).toBe(1);
      expect(sweep.deadLetters[0]?.agentId).toBe("agent-1");
    });

    it("purges dead letters completely when purge flag is true and all are expired", () => {
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

    it("purges only expired dead letters and retains fresh ones when purge flag is true", () => {
      const paths = resolveMailboxPaths("agent-partial-purge", testRoot);
      ensureMailboxDirectories(paths);
      const oldTime = new Date(Date.now() - 100000).toISOString();
      const freshTime = new Date().toISOString();
      writeFileSync(
        paths.quarantinePath,
        `[${oldTime}] [REASON: EXPIRED_ERR] old content\n[${freshTime}] [REASON: FRESH_ERR] fresh content\n`,
        "utf8",
      );

      const sweep = sweepQuarantineDeadLetters({
        baseDir: testRoot,
        agentId: "agent-partial-purge",
        maxAgeMs: 50000,
        purge: true,
      });

      expect(sweep.totalEntries).toBe(2);
      expect(sweep.deadLetters.length).toBe(1);
      expect(sweep.deadLetters[0]?.reason).toBe("EXPIRED_ERR");
      expect(sweep.purgedEntries).toBe(1);

      const remainingContent = readFileSync(paths.quarantinePath, "utf8");
      expect(remainingContent).toContain("FRESH_ERR");
      expect(remainingContent).not.toContain("EXPIRED_ERR");
    });

    it("parses unstructured corrupted lines as UNKNOWN_CORRUPTION", () => {
      const paths = resolveMailboxPaths("agent-raw-corrupt", testRoot);
      ensureMailboxDirectories(paths);
      writeFileSync(
        paths.quarantinePath,
        "completely unformatted raw corrupted garbage line without regex pattern\n",
        "utf8",
      );

      const sweep = sweepQuarantineDeadLetters({
        baseDir: testRoot,
        agentId: "agent-raw-corrupt",
      });

      expect(sweep.totalEntries).toBe(1);
      expect(sweep.deadLetters[0]?.reason).toBe("UNKNOWN_CORRUPTION");
      expect(sweep.deadLetters[0]?.rawEnvelope).toContain("unformatted raw corrupted");
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

    it("safely escapes and unescapes multi-line error stack traces and markdown", () => {
      const multiLinePayload = "Error: stack trace failure\n  at file.ts:12\n  at async foo.ts:34";
      const entry = ingestToQuarantine("agent-multiline", multiLinePayload, "STACK_TRACE", {
        baseDir: testRoot,
      });
      const lines = readFileSync(entry.quarantinePath, "utf8").trim().split("\n");
      expect(lines.length).toBe(1);
      expect(lines[0]).toContain("\\n  at file.ts:12");

      const sweep = sweepQuarantineDeadLetters({ baseDir: testRoot, agentId: "agent-multiline" });
      expect(sweep.deadLetters.length).toBe(1);
      expect(sweep.deadLetters[0]?.rawEnvelope).toBe(multiLinePayload);
    });

    it("reversibly preserves escaped backslashes in JSON literals without converting to control chars", () => {
      const jsonWithEscapes = '{"msg":"hello\\\\nworld","path":"C:\\\\Users\\\\test"}';
      ingestToQuarantine("agent-escapes", jsonWithEscapes, "LITERAL_JSON", {
        baseDir: testRoot,
      });
      const sweep = sweepQuarantineDeadLetters({ baseDir: testRoot, agentId: "agent-escapes" });
      expect(sweep.deadLetters.length).toBe(1);
      expect(sweep.deadLetters[0]?.rawEnvelope).toBe(jsonWithEscapes);
    });

    it("handles in-memory quarantine store, ingest, sweep, and purge in virtual mode", () => {
      const vRoot = "virtual://quarantine-suite";
      const p = "virtual://quarantine-suite/.olt/mailboxes/agent-virt/quarantine.log";
      setInMemoryQuarantine(p, ["[2026-08-30T00:00:00.000Z] [REASON: IN_MEM_ERR] payload\n"]);
      expect(getInMemoryQuarantine(p)?.length).toBe(1);

      writeInMemoryQuarantine(p, "[2026-08-30T00:00:01.000Z] [REASON: IN_MEM_ERR_2] payload2\n");
      expect(getInMemoryQuarantine(p)?.length).toBe(2);

      const vEntry = ingestToQuarantine("agent-virt", "virt error", "VIRT_ERR", { baseDir: vRoot });
      expect(vEntry.agentId).toBe("agent-virt");

      const sweep = sweepQuarantineDeadLetters({
        baseDir: vRoot,
        agentId: "agent-virt",
        purge: true,
      });
      expect(sweep.totalEntries).toBeGreaterThanOrEqual(1);
      expect(sweep.purgedEntries).toBeGreaterThanOrEqual(1);

      registerInMemoryMailboxDir("virtual://auto-sweep/.olt/mailboxes/agent-auto");
      writeInMemoryQuarantine(
        "virtual://auto-sweep/.olt/mailboxes/agent-auto/quarantine.log",
        "[2026-08-30T00:00:00.000Z] [REASON: AUTO_ERR] data\n",
      );
      const autoSweep = sweepQuarantineDeadLetters({ baseDir: "virtual://auto-sweep" });
      expect(autoSweep.deadLetters.length).toBeGreaterThanOrEqual(1);

      clearInMemoryQuarantines();
      expect(getInMemoryQuarantine(p)).toBeUndefined();
    });
  });
});

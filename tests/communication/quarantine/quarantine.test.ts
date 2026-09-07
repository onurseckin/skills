import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  ensureMailboxDirectories,
  ingestToQuarantine,
  resolveMailboxPaths,
  sweepQuarantineDeadLetters,
} from "../../../olt/scripts/src/communication/mailbox/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { cleanupVirtualCommunicationFS, setupVirtualCommunicationFS, vfs } from "../helpers.ts";

describe("Mailbox Quarantine Engine — Ingestion & Edge Cases", () => {
  let testRoot: string;

  beforeEach(() => {
    setupVirtualCommunicationFS();
    testRoot = "/tmp/mock-communication/quarantine-test";
    vfs.mkdirSync(testRoot, { recursive: true });
  });

  afterEach(() => {
    cleanupVirtualCommunicationFS();
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
      expect(vfs.existsSync(entry.quarantinePath)).toBe(true);

      const log = vfs.readFileSync(entry.quarantinePath, "utf8");
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
      const log = vfs.readFileSync(paths.quarantinePath, "utf8");
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

  describe("Edge cases: CRLF escaping, future timestamp retention, and multi-entry append", () => {
    it("strictly escapes CRLF line endings to preserve single-line log structure", () => {
      const crlfPayload = "line1\r\nline2\r\nline3";
      const entry = ingestToQuarantine("agent-crlf", crlfPayload, "CRLF_ERR", {
        baseDir: testRoot,
      });
      const content = vfs.readFileSync(entry.quarantinePath, "utf8").trim();
      const lines = content.split("\n");
      expect(lines.length).toBe(1);
      expect(lines[0]).toContain("\\r\\nline2\\r\\nline3");

      const sweep = sweepQuarantineDeadLetters({ baseDir: testRoot, agentId: "agent-crlf" });
      expect(sweep.deadLetters.length).toBe(1);
      expect(sweep.deadLetters[0]?.rawEnvelope).toBe(crlfPayload);
    });

    it("safely retains future-timestamped dead letters during age-based purge", () => {
      const paths = resolveMailboxPaths("agent-future", testRoot);
      ensureMailboxDirectories(paths);
      const futureTime = new Date(Date.now() + 1000000).toISOString();
      const pastTime = new Date(Date.now() - 200000).toISOString();
      vfs.writeFileSync(
        paths.quarantinePath,
        `[${pastTime}] [REASON: OLD] old data\n[${futureTime}] [REASON: FUTURE] future data\n`,
        "utf8",
      );

      const sweep = sweepQuarantineDeadLetters({
        baseDir: testRoot,
        agentId: "agent-future",
        maxAgeMs: 50000,
        purge: true,
      });

      expect(sweep.totalEntries).toBe(2);
      expect(sweep.purgedEntries).toBe(1);
      expect(sweep.deadLetters.length).toBe(1);
      expect(sweep.deadLetters[0]?.reason).toBe("OLD");

      const remaining = vfs.readFileSync(paths.quarantinePath, "utf8");
      expect(remaining).toContain("FUTURE");
      expect(remaining).not.toContain("OLD");
    });

    it("maintains file integrity across multiple sequential ingests for the same agent", () => {
      const a = ingestToQuarantine("agent-multi", { seq: 1 }, "ERR_1", { baseDir: testRoot });
      const b = ingestToQuarantine("agent-multi", { seq: 2 }, "ERR_2", { baseDir: testRoot });
      const c = ingestToQuarantine("agent-multi", { seq: 3 }, "ERR_3", { baseDir: testRoot });

      expect(a.quarantinePath).toBe(b.quarantinePath);
      expect(b.quarantinePath).toBe(c.quarantinePath);

      const content = vfs.readFileSync(a.quarantinePath, "utf8").trim();
      const lines = content.split("\n");
      expect(lines.length).toBe(3);
      expect(lines[0]).toContain("ERR_1");
      expect(lines[1]).toContain("ERR_2");
      expect(lines[2]).toContain("ERR_3");
    });
  });
});

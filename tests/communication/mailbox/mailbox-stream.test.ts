import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSignedEnvelope } from "../../../olt/scripts/src/communication/mailbox/envelope.ts";
import {
  clearInMemoryMailboxDirs,
  ensureMailboxDirectories,
  resolveMailboxPaths,
} from "../../../olt/scripts/src/communication/mailbox/mailbox-paths.ts";
import {
  appendMailboxMessage,
  clearInMemoryMailboxStore,
  getInMemoryMailbox,
  getInMemoryQuarantine,
  isValidEnvelopeStructure,
  quarantineTornLines,
  readUnreadMessages,
  rotateMailboxMessages,
  setInMemoryMailbox,
  setInMemoryStreamMode,
} from "../../../olt/scripts/src/communication/mailbox/mailbox-stream.ts";
import type {
  MailboxCursor,
  MailboxEnvelope,
} from "../../../olt/scripts/src/communication/types.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { cleanupVirtualCommunicationFS, setupVirtualCommunicationFS } from "../helpers.ts";

describe("Mailbox Stream IO & Paths Engine (In-Memory)", () => {
  const virtualRoot = "virtual://stream-suite";
  const makeEnv = (recipientId: string, seq = 1, type = "DISPATCH_TASK") =>
    createSignedEnvelope({
      senderId: "s",
      senderRole: "m",
      recipientId,
      messageType: type,
      payload: { seq },
      sequence: seq,
    });

  beforeEach(() => {
    setupVirtualCommunicationFS();
    clearInMemoryMailboxStore();
    clearInMemoryMailboxDirs();
    setInMemoryStreamMode(true);
  });

  afterEach(() => {
    cleanupVirtualCommunicationFS();
  });

  describe("resolveMailboxPaths & ensureMailboxDirectories", () => {
    it("resolves canonical virtual mailbox hierarchy paths", () => {
      const paths = resolveMailboxPaths("agent-alpha", virtualRoot);
      expect(paths.agentMailboxDir).toBe("virtual://stream-suite/.olt/mailboxes/agent-alpha");
      expect(paths.inboxPath).toBe("virtual://stream-suite/.olt/mailboxes/agent-alpha/inbox.jsonl");
      expect(paths.outboxPath).toBe(
        "virtual://stream-suite/.olt/mailboxes/agent-alpha/outbox.jsonl",
      );
      expect(paths.archivePath).toBe(
        "virtual://stream-suite/.olt/mailboxes/agent-alpha/archive.jsonl",
      );
      expect(paths.cursorPath).toBe(
        "virtual://stream-suite/.olt/mailboxes/agent-alpha/cursor.json",
      );
      expect(paths.quarantinePath).toBe(
        "virtual://stream-suite/.olt/mailboxes/agent-alpha/quarantine.log",
      );
      expect(paths.lockPath).toBe("virtual://stream-suite/.olt/locks/mailboxes/agent-alpha.lock");
    });

    it("rejects invalid agent IDs and directory traversal attempts", () => {
      for (const bad of ["", "   ", ".", "../agent-bad", "sub/agent", "sub\\agent", "bad\0agent"]) {
        expect(() => resolveMailboxPaths(bad, virtualRoot)).toThrow(HarnessError);
      }
    });

    it("provisions in-memory directory structures and rejects invalid paths", () => {
      const paths = resolveMailboxPaths("agent-beta", virtualRoot);
      expect(() => ensureMailboxDirectories(paths)).not.toThrow();
      expect(() => ensureMailboxDirectories({} as unknown as typeof paths)).toThrow(HarnessError);
      expect(() =>
        ensureMailboxDirectories({ agentMailboxDir: "", lockPath: "" } as unknown as typeof paths),
      ).toThrow(HarnessError);
    });
  });

  describe("isValidEnvelopeStructure", () => {
    it("validates well-formed envelopes and rejects incomplete structures", () => {
      const valid = makeEnv("a2", 1);
      expect(isValidEnvelopeStructure(valid)).toBe(true);
      for (const inv of [
        null,
        {},
        { ...valid, id: "" },
        { ...valid, sequence: NaN },
        { ...valid, sequence: "invalid" },
      ]) {
        expect(isValidEnvelopeStructure(inv)).toBe(false);
      }
    });
  });

  describe("appendMailboxMessage", () => {
    it("appends valid envelopes to in-memory inbox buffer", () => {
      const paths = resolveMailboxPaths("agent-gamma", virtualRoot);
      const [env1, env2] = [makeEnv("agent-gamma", 1), makeEnv("agent-gamma", 2)];
      appendMailboxMessage(paths.inboxPath, env1);
      appendMailboxMessage(paths.inboxPath, env2, paths.lockPath);
      const lines = getInMemoryMailbox(paths.inboxPath) ?? [];
      expect(lines.length).toBe(2);
      expect(JSON.parse(lines[0] ?? "{}").id).toBe(env1.id);
      expect(JSON.parse(lines[1] ?? "{}").id).toBe(env2.id);
    });

    it("fails closed on invalid arguments", () => {
      expect(() => appendMailboxMessage("", {} as unknown as MailboxEnvelope)).toThrow(
        HarnessError,
      );
      expect(() =>
        appendMailboxMessage("virtual://inbox.jsonl", {} as unknown as MailboxEnvelope),
      ).toThrow(HarnessError);
    });
  });

  describe("readUnreadMessages, Cursor Filtering & Quarantine", () => {
    it("reads unread messages according to cursor sequence and seen ids idempotently in RAM", () => {
      const paths = resolveMailboxPaths("agent-delta", virtualRoot);
      const [env1, env2, env3] = [1, 2, 3].map((s) => makeEnv("agent-delta", s, "PULSE_HEARTBEAT"));
      [env1, env2, env3].forEach((e) => appendMailboxMessage(paths.inboxPath, e));

      const cursor: MailboxCursor = {
        last_read_sequence: 1,
        last_read_id: env1.id,
        seen_ids: [env1.id, env2.id],
        updated_at: new Date().toISOString(),
      };
      const r1 = readUnreadMessages(paths.inboxPath, cursor, { lockPath: paths.lockPath });
      expect(r1.quarantinedCount).toBe(0);
      expect(r1.messages.length).toBe(1);
      expect(r1.messages[0]?.id).toBe(env3.id);

      const advancedCursor: MailboxCursor = {
        last_read_sequence: 3,
        last_read_id: env3.id,
        seen_ids: [env1.id, env2.id, env3.id],
        updated_at: new Date().toISOString(),
      };
      expect(readUnreadMessages(paths.inboxPath, advancedCursor).messages.length).toBe(0);
    });

    it("quarantines torn or corrupt lines in RAM without crashing", () => {
      const paths = resolveMailboxPaths("agent-torn", virtualRoot);
      const validEnv = makeEnv("agent-torn", 1, "PULSE_HEARTBEAT");
      setInMemoryMailbox(paths.inboxPath, [
        JSON.stringify(validEnv),
        "{ torn json line...",
        JSON.stringify({ bad: "envelope" }),
      ]);

      const count = quarantineTornLines(paths.inboxPath, paths.quarantinePath);
      expect(count).toBe(2);
      expect(getInMemoryQuarantine(paths.quarantinePath)?.length).toBeGreaterThan(0);

      const cleanResult = readUnreadMessages(paths.inboxPath);
      expect(cleanResult.messages.length).toBe(1);
      expect(cleanResult.messages[0]?.id).toBe(validEnv.id);
    });

    it("returns empty result for non-existent mailbox", () => {
      const paths = resolveMailboxPaths("non-existent", virtualRoot);
      const result = readUnreadMessages(paths.inboxPath);
      expect(result.messages).toEqual([]);
      expect(result.quarantinedCount).toBe(0);
    });
  });

  describe("rotateMailboxMessages", () => {
    it("rotates excess messages into in-memory archive when window threshold is exceeded", () => {
      const paths = resolveMailboxPaths("agent-kappa", virtualRoot);
      for (let i = 1; i <= 5; i++) {
        appendMailboxMessage(paths.inboxPath, makeEnv("agent-kappa", i));
      }
      const rotatedCount = rotateMailboxMessages(paths.inboxPath, paths.archivePath, {
        maxActiveMessages: 3,
        lockPath: paths.lockPath,
      });
      expect(rotatedCount).toBe(2);
      const inboxLines = getInMemoryMailbox(paths.inboxPath) ?? [];
      expect(inboxLines.length).toBe(3);
      expect(JSON.parse(inboxLines[0] ?? "{}").sequence).toBe(3);

      const archiveLines = getInMemoryMailbox(paths.archivePath) ?? [];
      expect(archiveLines.length).toBe(2);
      expect(JSON.parse(archiveLines[0] ?? "{}").sequence).toBe(1);
    });

    it("handles rotation boundary conditions and validates distinct paths", () => {
      const paths = resolveMailboxPaths("agent-lambda", virtualRoot);
      appendMailboxMessage(paths.inboxPath, makeEnv("agent-lambda", 1));
      expect(rotateMailboxMessages(paths.inboxPath, paths.archivePath)).toBe(0);
      expect(() => rotateMailboxMessages("", paths.archivePath)).toThrow(HarnessError);
      expect(() => rotateMailboxMessages(paths.inboxPath, "")).toThrow(HarnessError);
      expect(() => rotateMailboxMessages(paths.inboxPath, paths.inboxPath)).toThrow(HarnessError);
      expect(() =>
        rotateMailboxMessages(paths.inboxPath, paths.archivePath, { maxActiveMessages: -1 }),
      ).toThrow(HarnessError);
    });

    it("rotates messages on physical disk filesystem with lock", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "stream-disk-test-"));
      try {
        const paths = resolveMailboxPaths("disk-agent", tempDir);
        ensureMailboxDirectories(paths);
        for (let i = 1; i <= 4; i++) {
          appendMailboxMessage(paths.inboxPath, makeEnv("disk-agent", i));
        }
        const rotated = rotateMailboxMessages(paths.inboxPath, paths.archivePath, {
          maxActiveMessages: 2,
        });
        expect(rotated).toBe(2);
        const res = readUnreadMessages(paths.inboxPath);
        expect(res.messages.length).toBe(2);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("quarantines malformed envelopes when quarantinePath option is passed to readUnreadMessages", () => {
      const paths = resolveMailboxPaths("agent-q-opt", virtualRoot);
      setInMemoryMailbox(paths.inboxPath, [
        "{ invalid json",
        JSON.stringify({ not: "valid envelope" }),
        JSON.stringify(makeEnv("agent-q-opt", 1)),
      ]);
      const res = readUnreadMessages(paths.inboxPath, null, {
        quarantinePath: paths.quarantinePath,
      });
      expect(res.messages.length).toBe(1);
      expect(res.quarantinedCount).toBe(2);
    });
  });
});

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  appendMailboxMessage,
  createSignedEnvelope,
  ensureMailboxDirectories,
  isValidEnvelopeStructure,
  readUnreadMessages,
  resolveMailboxPaths,
  rotateMailboxMessages,
} from "../../../olt/scripts/src/communication/mailbox/index.ts";
import type {
  MailboxCursor,
  MailboxEnvelope,
} from "../../../olt/scripts/src/communication/types.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";

describe("Mailbox Stream IO & Paths Engine", () => {
  let testRoot: string;
  beforeEach(() => {
    testRoot = join(
      process.cwd(),
      "coverage",
      "test-isolation",
      `mb-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(testRoot, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testRoot)) rmSync(testRoot, { recursive: true, force: true });
  });

  describe("resolveMailboxPaths & ensureMailboxDirectories", () => {
    it("resolves canonical mailbox hierarchy paths", () => {
      const paths = resolveMailboxPaths("agent-alpha", testRoot);
      expect(paths.agentMailboxDir).toBe(join(testRoot, ".olt", "mailboxes", "agent-alpha"));
      expect(paths.inboxPath).toBe(
        join(testRoot, ".olt", "mailboxes", "agent-alpha", "inbox.jsonl"),
      );
      expect(paths.outboxPath).toBe(
        join(testRoot, ".olt", "mailboxes", "agent-alpha", "outbox.jsonl"),
      );
      expect(paths.archivePath).toBe(
        join(testRoot, ".olt", "mailboxes", "agent-alpha", "archive.jsonl"),
      );
      expect(paths.cursorPath).toBe(
        join(testRoot, ".olt", "mailboxes", "agent-alpha", "cursor.json"),
      );
      expect(paths.quarantinePath).toBe(
        join(testRoot, ".olt", "mailboxes", "agent-alpha", "quarantine.log"),
      );
      expect(paths.lockPath).toBe(join(testRoot, ".olt", "locks", "mailboxes", "agent-alpha.lock"));
    });

    it("rejects invalid agent IDs and directory traversal attempts", () => {
      expect(() => resolveMailboxPaths("", testRoot)).toThrow(HarnessError);
      expect(() => resolveMailboxPaths("   ", testRoot)).toThrow(HarnessError);
      expect(() => resolveMailboxPaths(".", testRoot)).toThrow(HarnessError);
      expect(() => resolveMailboxPaths("../agent-bad", testRoot)).toThrow(HarnessError);
      expect(() => resolveMailboxPaths("sub/agent", testRoot)).toThrow(HarnessError);
      expect(() => resolveMailboxPaths("sub\\agent", testRoot)).toThrow(HarnessError);
      expect(() => resolveMailboxPaths("bad\0agent", testRoot)).toThrow(HarnessError);
    });

    it("creates necessary directory structures with ensureMailboxDirectories and rejects invalid paths", () => {
      const paths = resolveMailboxPaths("agent-beta", testRoot);
      expect(existsSync(paths.agentMailboxDir)).toBe(false);
      ensureMailboxDirectories(paths);
      expect(existsSync(paths.agentMailboxDir)).toBe(true);
      expect(existsSync(join(testRoot, ".olt", "locks", "mailboxes"))).toBe(true);
      expect(() => ensureMailboxDirectories({} as unknown as typeof paths)).toThrow(HarnessError);
      expect(() =>
        ensureMailboxDirectories({ agentMailboxDir: "", lockPath: "" } as unknown as typeof paths),
      ).toThrow(HarnessError);
    });
  });

  describe("isValidEnvelopeStructure", () => {
    it("validates well-formed envelopes and rejects incomplete structures", () => {
      const valid = createSignedEnvelope({
        senderId: "a1",
        senderRole: "w",
        recipientId: "a2",
        messageType: "DISPATCH_TASK",
        payload: { t: 1 },
      });
      expect(isValidEnvelopeStructure(valid)).toBe(true);
      expect(isValidEnvelopeStructure(null)).toBe(false);
      expect(isValidEnvelopeStructure({})).toBe(false);
      expect(isValidEnvelopeStructure({ ...valid, id: "" })).toBe(false);
      expect(isValidEnvelopeStructure({ ...valid, sequence: NaN })).toBe(false);
      expect(isValidEnvelopeStructure({ ...valid, sequence: "invalid" })).toBe(false);
    });
  });

  describe("appendMailboxMessage", () => {
    it("appends valid envelopes to inbox with optional flock lock", () => {
      const paths = resolveMailboxPaths("agent-gamma", testRoot);
      const env1 = createSignedEnvelope({
        senderId: "s",
        senderRole: "m",
        recipientId: "agent-gamma",
        messageType: "DISPATCH_TASK",
        payload: { s: 1 },
        sequence: 1,
      });
      const env2 = createSignedEnvelope({
        senderId: "s",
        senderRole: "m",
        recipientId: "agent-gamma",
        messageType: "DISPATCH_TASK",
        payload: { s: 2 },
        sequence: 2,
      });
      appendMailboxMessage(paths.inboxPath, env1);
      appendMailboxMessage(paths.inboxPath, env2, paths.lockPath);
      const lines = readFileSync(paths.inboxPath, "utf8").trim().split("\n");
      expect(lines.length).toBe(2);
      const line0 = lines[0];
      const line1 = lines[1];
      expect(line0).toBeDefined();
      expect(line1).toBeDefined();
      if (line0 !== undefined && line1 !== undefined) {
        expect(JSON.parse(line0).id).toBe(env1.id);
        expect(JSON.parse(line1).id).toBe(env2.id);
      }
    });

    it("fails closed on invalid arguments", () => {
      expect(() => appendMailboxMessage("", {} as unknown as MailboxEnvelope)).toThrow(
        HarnessError,
      );
      expect(() =>
        appendMailboxMessage(join(testRoot, "inbox.jsonl"), {} as unknown as MailboxEnvelope),
      ).toThrow(HarnessError);
    });
  });

  describe("readUnreadMessages & Cursor Filtering", () => {
    it("reads unread messages according to cursor sequence and seen ids idempotently", () => {
      const paths = resolveMailboxPaths("agent-delta", testRoot);
      const env1 = createSignedEnvelope({
        senderId: "s",
        senderRole: "r",
        recipientId: "agent-delta",
        messageType: "PULSE_HEARTBEAT",
        payload: {},
        sequence: 1,
      });
      const env2 = createSignedEnvelope({
        senderId: "s",
        senderRole: "r",
        recipientId: "agent-delta",
        messageType: "PULSE_HEARTBEAT",
        payload: {},
        sequence: 2,
      });
      const env3 = createSignedEnvelope({
        senderId: "s",
        senderRole: "r",
        recipientId: "agent-delta",
        messageType: "PULSE_HEARTBEAT",
        payload: {},
        sequence: 3,
      });
      appendMailboxMessage(paths.inboxPath, env1);
      appendMailboxMessage(paths.inboxPath, env2);
      appendMailboxMessage(paths.inboxPath, env3);

      const cursor: MailboxCursor = {
        last_read_sequence: 1,
        last_read_id: env1.id,
        seen_ids: [env1.id, env2.id],
        updated_at: new Date().toISOString(),
      };
      const r1 = readUnreadMessages(paths.inboxPath, cursor, { lockPath: paths.lockPath });
      expect(r1.quarantinedCount).toBe(0);
      expect(r1.messages.length).toBe(1);
      const firstMsg = r1.messages[0];
      expect(firstMsg).toBeDefined();
      if (firstMsg !== undefined) {
        expect(firstMsg.id).toBe(env3.id);
      }

      const advancedCursor: MailboxCursor = {
        last_read_sequence: 3,
        last_read_id: env3.id,
        seen_ids: [env1.id, env2.id, env3.id],
        updated_at: new Date().toISOString(),
      };
      const r2 = readUnreadMessages(paths.inboxPath, advancedCursor);
      expect(r2.messages.length).toBe(0);
    });

    it("returns empty result for non-existent mailbox", () => {
      const paths = resolveMailboxPaths("non-existent", testRoot);
      const result = readUnreadMessages(paths.inboxPath);
      expect(result.messages).toEqual([]);
      expect(result.quarantinedCount).toBe(0);
    });
  });

  describe("rotateMailboxMessages", () => {
    it("rotates excess messages into archive.jsonl when window threshold is exceeded", () => {
      const paths = resolveMailboxPaths("agent-kappa", testRoot);
      ensureMailboxDirectories(paths);
      for (let i = 1; i <= 5; i++) {
        appendMailboxMessage(
          paths.inboxPath,
          createSignedEnvelope({
            senderId: "s",
            senderRole: "r",
            recipientId: "agent-kappa",
            messageType: "DISPATCH_TASK",
            payload: { i },
            sequence: i,
          }),
        );
      }
      const rotatedCount = rotateMailboxMessages(paths.inboxPath, paths.archivePath, {
        maxActiveMessages: 3,
        lockPath: paths.lockPath,
      });
      expect(rotatedCount).toBe(2);
      const inboxLines = readFileSync(paths.inboxPath, "utf8").trim().split("\n");
      expect(inboxLines.length).toBe(3);
      const firstInbox = inboxLines[0];
      expect(firstInbox).toBeDefined();
      if (firstInbox !== undefined) {
        expect(JSON.parse(firstInbox).sequence).toBe(3);
      }
      const archiveLines = readFileSync(paths.archivePath, "utf8").trim().split("\n");
      expect(archiveLines.length).toBe(2);
      const firstArchive = archiveLines[0];
      expect(firstArchive).toBeDefined();
      if (firstArchive !== undefined) {
        expect(JSON.parse(firstArchive).sequence).toBe(1);
      }
    });

    it("handles rotation boundary conditions and default 1000 limit", () => {
      const paths = resolveMailboxPaths("agent-lambda", testRoot);
      appendMailboxMessage(
        paths.inboxPath,
        createSignedEnvelope({
          senderId: "s",
          senderRole: "r",
          recipientId: "agent-lambda",
          messageType: "DISPATCH_TASK",
          payload: {},
          sequence: 1,
        }),
      );
      expect(rotateMailboxMessages(paths.inboxPath, paths.archivePath)).toBe(0);
      expect(existsSync(paths.archivePath)).toBe(false);
    });

    it("validates distinct paths and positive maxActiveMessages", () => {
      const paths = resolveMailboxPaths("agent-mu", testRoot);
      expect(() => rotateMailboxMessages(paths.inboxPath, paths.inboxPath)).toThrow(HarnessError);
      expect(() =>
        rotateMailboxMessages(paths.inboxPath, paths.archivePath, { maxActiveMessages: -1 }),
      ).toThrow(HarnessError);
      expect(() =>
        rotateMailboxMessages(paths.inboxPath, paths.archivePath, { maxActiveMessages: 1.5 }),
      ).toThrow(HarnessError);
    });
  });

  describe("Architecture Invariants & Code Standards", () => {
    it("ensures source files and test suite are <= 300 physical lines", () => {
      const files = [
        join(process.cwd(), "olt/scripts/src/communication/mailbox/mailbox-paths.ts"),
        join(process.cwd(), "olt/scripts/src/communication/mailbox/mailbox-stream.ts"),
        join(process.cwd(), "olt/scripts/src/communication/mailbox/index.ts"),
        join(process.cwd(), "tests/unit/communication/mailbox-stream.test.ts"),
      ];
      for (const file of files) {
        const lines = readFileSync(file, "utf8").split("\n");
        expect(lines.length).toBeLessThanOrEqual(300);
      }
    });

    it("ensures 0 any and 0 compiler suppressions in mailbox modules", () => {
      const files = [
        join(process.cwd(), "olt/scripts/src/communication/mailbox/mailbox-paths.ts"),
        join(process.cwd(), "olt/scripts/src/communication/mailbox/mailbox-stream.ts"),
        join(process.cwd(), "olt/scripts/src/communication/mailbox/index.ts"),
      ];
      for (const file of files) {
        const content = readFileSync(file, "utf8");
        expect(content).not.toContain("@ts-ignore");
        expect(content).not.toContain("@ts-expect-error");
        expect(content).not.toMatch(/:\s*any\b/);
      }
    });
  });
});

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  msgRecvCommand,
  msgSendCommand,
} from "../../../../../../olt/scripts/src/cli/commands/index.ts";
import { execute } from "../../../../../../olt/scripts/src/cli/execute.ts";
import { renderHelp } from "../../../../../../olt/scripts/src/cli/help.ts";
import {
  findCommand,
  isPrimaryCommand,
} from "../../../../../../olt/scripts/src/cli/registry/index.ts";
import { verifyEnvelopeHmac } from "../../../../../../olt/scripts/src/communication/mailbox/index.ts";
import type { MailboxEnvelope } from "../../../../../../olt/scripts/src/communication/types.ts";
import { HarnessError } from "../../../../../../olt/scripts/src/core/errors/index.ts";
import {
  cleanupVirtualCliFS,
  setupVirtualCliFS,
} from "../../../fixtures/full-lifecycle-fixture.ts";

describe("Mailbox CLI Operations - Core Send/Recv Workflows", () => {
  let testRoot: string;

  beforeEach(() => {
    setupVirtualCliFS();
    testRoot = join(
      process.cwd(),
      "scratch",
      "test-isolation",
      `msg-ops-c-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(testRoot, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testRoot)) {
      try {
        rmSync(testRoot, { recursive: true, force: true });
      } catch {}
    }
    cleanupVirtualCliFS();
  });

  describe("registry and specification", () => {
    it("registers msg command suite as primary tier commands", () => {
      for (const name of ["msg:send", "msg:recv", "msg:poll", "msg:list"]) {
        const spec = findCommand(name);
        expect(spec).toBeDefined();
        if (spec !== undefined) {
          expect(spec.domain).toBe("msg");
          expect(spec.tier).toBe("primary");
          expect(isPrimaryCommand(spec)).toBe(true);
        }
      }
    });

    it("renders help docs for msg commands", () => {
      expect(renderHelp(null)).toContain("| msg |");
      const pollHelp = renderHelp("msg:poll");
      expect(pollHelp).toContain("### `msg:poll`");
      expect(pollHelp).toContain("--interval");
      expect(pollHelp).toContain("--timeout");
    });
  });

  describe("msg:send and msg:recv operations", () => {
    it("executes send and receive workflow with HMAC verification", async () => {
      const sendRes = await execute([
        "msg:send",
        "--to",
        "agent-beta",
        "--type",
        "DISPATCH_TASK",
        "--body",
        "Run unit tests",
        "--payload",
        '{"taskId":"task-123"}',
        "--actor",
        "agent-alpha",
        "--role",
        "coordinator",
        "--correlation-id",
        "corr-555",
        "--base-dir",
        testRoot,
      ]);
      expect(sendRes.recipient_id).toBe("agent-beta");
      expect(sendRes.sender_id).toBe("agent-alpha");
      expect(sendRes.correlation_id).toBe("corr-555");
      const envelope = sendRes.envelope as MailboxEnvelope<{ taskId: string; body: string }>;
      expect(envelope.payload.taskId).toBe("task-123");
      expect(envelope.payload.body).toBe("Run unit tests");
      expect(verifyEnvelopeHmac(envelope).valid).toBe(true);

      const recvRes = await execute(["msg:recv", "--actor", "agent-beta", "--base-dir", testRoot]);
      expect(recvRes.totalReceipts).toBe(1);
      const receipts = recvRes.receipts as readonly MailboxEnvelope[];
      expect(receipts[0]?.id).toBe(envelope.id);

      const recvEmpty = await msgRecvCommand({ actor: "agent-beta", "base-dir": testRoot });
      expect(recvEmpty.totalReceipts).toBe(0);
    });

    it("supports no-advance-cursor flag to keep messages unread", async () => {
      msgSendCommand({
        to: "worker-stay",
        type: "DISPATCH_TASK",
        body: "Message 1",
        actor: "coord",
        "base-dir": testRoot,
      });
      const peek1 = await msgRecvCommand({
        actor: "worker-stay",
        "no-advance-cursor": true,
        "base-dir": testRoot,
      });
      expect(peek1.totalReceipts).toBe(1);
      const peek2 = await msgRecvCommand({
        actor: "worker-stay",
        "no-advance-cursor": true,
        "base-dir": testRoot,
      });
      expect(peek2.totalReceipts).toBe(1);
    });

    it("filters received messages by type and correlation-id", async () => {
      msgSendCommand({
        to: "filter-agent",
        type: "DISPATCH_TASK",
        actor: "coord",
        "correlation-id": "cid-a",
        "base-dir": testRoot,
      });
      msgSendCommand({
        to: "filter-agent",
        type: "PULSE_HEARTBEAT",
        actor: "coord",
        "correlation-id": "cid-b",
        "base-dir": testRoot,
      });
      const filtered = await msgRecvCommand({
        actor: "filter-agent",
        type: "DISPATCH_TASK",
        "correlation-id": "cid-a",
        "base-dir": testRoot,
      });
      expect(filtered.totalReceipts).toBe(1);
      expect(filtered.receipts[0]?.message_type).toBe("DISPATCH_TASK");
      expect(filtered.receipts[0]?.correlation_id).toBe("cid-a");
    });

    it("throws HarnessError on invalid send invocation", () => {
      expect(() => msgSendCommand({ "base-dir": testRoot })).toThrow(HarnessError);
    });
  });
});

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { execute } from "../../../../../../olt/scripts/src/cli/execute.ts";
import {
  msgRecvCommand,
  msgSendCommand,
} from "../../../../../../olt/scripts/src/cli/commands/index.ts";
import { renderHelp } from "../../../../../../olt/scripts/src/cli/help.ts";
import {
  findCommand,
  isPrimaryCommand,
} from "../../../../../../olt/scripts/src/cli/registry/index.ts";
import {
  loadMailboxCursor,
  resolveMailboxPaths,
  verifyEnvelopeHmac,
} from "../../../../../../olt/scripts/src/communication/mailbox/index.ts";
import type { MailboxEnvelope } from "../../../../../../olt/scripts/src/communication/types.ts";
import { HarnessError } from "../../../../../../olt/scripts/src/core/errors/index.ts";

describe("Mailbox IPC CLI Commands - Registry, Send and Receive", () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = join(
      process.cwd(),
      "coverage",
      "test-isolation",
      `msg-cmd-disp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(testRoot, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testRoot)) rmSync(testRoot, { recursive: true, force: true });
  });

  describe("registry and help rendering", () => {
    it("registers all 4 msg commands in primary tier", () => {
      for (const name of ["msg:send", "msg:recv", "msg:poll", "msg:list"]) {
        const spec = findCommand(name);
        expect(spec).toBeDefined();
        if (spec !== undefined) {
          expect(spec.domain).toBe("msg");
          expect(spec.tier).toBe("primary");
          expect(spec.internal).toBe(false);
          expect(isPrimaryCommand(spec)).toBe(true);
        }
      }
    });

    it("renders overview help including msg primary domain", () => {
      const overview = renderHelp(null);
      expect(overview).toContain("| msg |");
      expect(overview).toContain("`msg:send`");
      expect(overview).toContain("`msg:list`");
    });

    it("renders individual rich help for each msg command", () => {
      for (const name of ["msg:send", "msg:recv", "msg:poll", "msg:list"]) {
        const help = renderHelp(name);
        expect(help).toContain(`### \`${name}\``);
        expect(help).toContain("- **Domain**: msg");
        expect(help).toContain("- **Tier**: primary");
        expect(help).toContain("**Exit codes**");
        expect(help).toContain("**Examples**");
      }
    });
  });

  describe("msg:send command", () => {
    it("dispatches signed envelope with body and payload via CLI execute", async () => {
      const result = await execute([
        "msg:send",
        "--to",
        "worker-alpha",
        "--type",
        "DISPATCH_TASK",
        "--body",
        "Process chunk #1",
        "--payload",
        '{"chunkId":1,"retries":3}',
        "--actor",
        "coordinator-1",
        "--role",
        "coordinator",
        "--correlation-id",
        "corr-101",
        "--base-dir",
        testRoot,
      ]);
      expect(typeof result.markdown).toBe("string");
      expect(String(result.markdown)).toContain("Mailbox Message Dispatched");
      expect(result.recipient_id).toBe("worker-alpha");
      expect(result.sender_id).toBe("coordinator-1");
      expect(result.sender_role).toBe("coordinator");
      expect(result.message_type).toBe("DISPATCH_TASK");
      expect(result.correlation_id).toBe("corr-101");

      const env = result.envelope as unknown as MailboxEnvelope<{
        chunkId: number;
        retries: number;
        body: string;
      }>;
      expect(env).toBeDefined();
      expect(env.payload.chunkId).toBe(1);
      expect(env.payload.body).toBe("Process chunk #1");
      expect(verifyEnvelopeHmac(env).valid).toBe(true);

      const paths = resolveMailboxPaths("worker-alpha", testRoot);
      expect(existsSync(paths.inboxPath)).toBe(true);
      expect(readFileSync(paths.inboxPath, "utf8").trim().split("\n").length).toBe(1);
    });

    it("handles plain text payload and auto-derives sender when omitted", () => {
      const result = msgSendCommand({
        to: "worker-beta",
        type: "PULSE_HEARTBEAT",
        payload: "non-json",
        "base-dir": testRoot,
      });
      expect(result.envelope.recipient_id).toBe("worker-beta");
      expect(result.envelope.payload).toEqual({ text: "non-json" });
      expect(typeof result.envelope.sender_id).toBe("string");
      expect(typeof result.envelope.sender_role).toBe("string");
      expect(verifyEnvelopeHmac(result.envelope).valid).toBe(true);
    });

    it("fails closed when required flags are missing", () => {
      expect(() => msgSendCommand({ type: "DISPATCH_TASK", "base-dir": testRoot })).toThrow(
        HarnessError,
      );
      expect(() => msgSendCommand({ to: "worker-alpha", "base-dir": testRoot })).toThrow(
        HarnessError,
      );
    });
  });

  describe("msg:recv command", () => {
    it("receives unread messages and advances cursor by default", async () => {
      msgSendCommand({
        to: "worker-rcv",
        type: "DISPATCH_TASK",
        body: "M1",
        actor: "coord-1",
        role: "coordinator",
        "base-dir": testRoot,
      });
      msgSendCommand({
        to: "worker-rcv",
        type: "PULSE_HEARTBEAT",
        body: "M2",
        actor: "coord-1",
        role: "coordinator",
        "base-dir": testRoot,
      });

      const recv1 = await execute(["msg:recv", "--actor", "worker-rcv", "--base-dir", testRoot]);
      expect(recv1.totalReceipts).toBe(2);
      expect((recv1.receipts as unknown as MailboxEnvelope[]).length).toBe(2);

      const paths = resolveMailboxPaths("worker-rcv", testRoot);
      const cursor = loadMailboxCursor(paths.cursorPath);
      expect(cursor.seen_ids.length).toBe(2);
      expect(cursor.last_read_sequence).toBeGreaterThanOrEqual(1);

      const recv2 = await execute(["msg:recv", "--actor", "worker-rcv", "--base-dir", testRoot]);
      expect(recv2.totalReceipts).toBe(0);
    });

    it("preserves cursor when no-advance-cursor is specified", async () => {
      msgSendCommand({
        to: "worker-no-adv",
        type: "DISPATCH_TASK",
        body: "Stay",
        actor: "c1",
        role: "coordinator",
        "base-dir": testRoot,
      });
      const r1 = await msgRecvCommand({
        actor: "worker-no-adv",
        "no-advance-cursor": true,
        "base-dir": testRoot,
      });
      expect(r1.totalReceipts).toBe(1);
      const r2 = await msgRecvCommand({
        actor: "worker-no-adv",
        "no-advance-cursor": true,
        "base-dir": testRoot,
      });
      expect(r2.totalReceipts).toBe(1);
    });

    it("filters messages by type and correlation-id", async () => {
      msgSendCommand({
        to: "worker-f",
        type: "DISPATCH_TASK",
        actor: "c",
        role: "coordinator",
        "correlation-id": "t-1",
        "base-dir": testRoot,
      });
      msgSendCommand({
        to: "worker-f",
        type: "PULSE_HEARTBEAT",
        actor: "c",
        role: "coordinator",
        "correlation-id": "t-2",
        "base-dir": testRoot,
      });

      const filtered = await msgRecvCommand({
        actor: "worker-f",
        type: "DISPATCH_TASK",
        "correlation-id": "t-1",
        "base-dir": testRoot,
      });
      expect(filtered.totalReceipts).toBe(1);
      expect(filtered.receipts[0]?.message_type).toBe("DISPATCH_TASK");
      expect(filtered.receipts[0]?.correlation_id).toBe("t-1");
    });

    it("waits for incoming message when wait flag is set", async () => {
      const waitPromise = msgRecvCommand({
        actor: "worker-wait",
        wait: true,
        timeout: "400",
        "base-dir": testRoot,
      });
      setTimeout(() => {
        msgSendCommand({
          to: "worker-wait",
          type: "DISPATCH_TASK",
          body: "Delayed",
          actor: "c",
          role: "coordinator",
          "base-dir": testRoot,
        });
      }, 50);
      const recv = await waitPromise;
      expect(recv.totalReceipts).toBe(1);
      expect(recv.receipts[0]?.payload).toEqual({ body: "Delayed" });
    });
  });
});

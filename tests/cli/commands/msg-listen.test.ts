import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { msgListenCommand } from "../../../olt/scripts/src/cli/commands/msg-listen.ts";
import { msgPollCommand } from "../../../olt/scripts/src/cli/commands/msg-poll.ts";
import { msgSendCommand } from "../../../olt/scripts/src/cli/commands/msg-send.ts";
import { startContinuousDrain } from "../../../olt/scripts/src/liaison/agent/transport.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("Mailbox msg:listen and msg:poll continuous transport", () => {
  let session: VirtualFSSession;
  let vfs: VirtualMemoryFS;
  const testBaseDir = "/virtual/mailboxes";

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
    vfs.mkdirSync(testBaseDir, { recursive: true });
  });

  afterEach(() => {
    session.cleanup();
  });

  it("msg:poll with timeout=0 does not exit immediately and polls until message arrives", async () => {
    const recipient = "worker-zero-timeout";
    const pollPromise = msgPollCommand({
      actor: recipient,
      interval: "25",
      timeout: "0",
      "base-dir": testBaseDir,
    });

    await new Promise((resolve) => setTimeout(resolve, 60));

    await msgSendCommand({
      to: recipient,
      type: "DISPATCH_TASK",
      body: "Process task #1",
      actor: "coordinator",
      role: "coordinator",
      "base-dir": testBaseDir,
    });

    const result = await pollPromise;
    expect(result.totalReceipts).toBe(1);
    expect(result.receipts[0]?.message_type).toBe("DISPATCH_TASK");
    expect(result.rounds).toBeGreaterThanOrEqual(2);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(50);
  });

  it("msg:poll with continuous flag polls multiple batches until max-rounds", async () => {
    const recipient = "worker-continuous-poll";
    const pollPromise = msgPollCommand({
      actor: recipient,
      interval: "20",
      timeout: "0",
      "max-rounds": "4",
      continuous: true,
      "base-dir": testBaseDir,
    });

    await new Promise((resolve) => setTimeout(resolve, 15));
    await msgSendCommand({
      to: recipient,
      type: "DISPATCH_TASK",
      body: "Task A",
      actor: "coordinator",
      role: "coordinator",
      "base-dir": testBaseDir,
    });

    await new Promise((resolve) => setTimeout(resolve, 30));
    await msgSendCommand({
      to: recipient,
      type: "HANDOFF_RECEIPT",
      body: "Receipt B",
      actor: "coordinator",
      role: "coordinator",
      "base-dir": testBaseDir,
    });

    const result = await pollPromise;
    expect(result.totalReceipts).toBe(2);
    expect(result.rounds).toBe(4);
    expect(result.receipts.length).toBe(2);
  });

  it("msg:poll with continuous flag exits early when abort signal fires", async () => {
    const ac = new AbortController();
    const recipient = "worker-poll-abort";
    const pollPromise = msgPollCommand(
      {
        actor: recipient,
        interval: "20",
        timeout: "0",
        continuous: true,
        "base-dir": testBaseDir,
      },
      { signal: ac.signal },
    );

    await new Promise((resolve) => setTimeout(resolve, 50));
    ac.abort();

    const result = await pollPromise;
    expect(result.totalReceipts).toBe(0);
    expect(result.rounds).toBeGreaterThanOrEqual(2);
  });

  it("startContinuousDrain processes incoming messages in background", async () => {
    const liaisonActor = "liaison_worker";
    const drained: string[] = [];

    const handle = startContinuousDrain({
      agentId: liaisonActor,
      baseDir: testBaseDir,
      idleWaitMs: 20,
      emitDeliveredReceipts: false,
      onMessage: (env) => {
        drained.push(env.id);
        return {
          messageId: env.id,
          correlationId: env.correlation_id,
          status: "delivered",
        };
      },
    });

    expect(handle.isRunning).toBe(true);

    await msgSendCommand({
      to: liaisonActor,
      type: "PULSE_HEARTBEAT",
      body: "Heartbeat ping",
      actor: "sentinel",
      role: "sentinel",
      "base-dir": testBaseDir,
    });

    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(drained.length).toBe(1);
    const metrics = handle.getMetrics();
    expect(metrics.totalProcessed).toBe(1);

    await handle.stop();
    expect(handle.isRunning).toBe(false);
  });

  it("msg:listen processes incoming messages and terminates via abort signal", async () => {
    const ac = new AbortController();
    const listenerActor = "worker-listen-target";

    const listenPromise = msgListenCommand(
      {
        actor: listenerActor,
        interval: "20",
        "batch-size": "5",
        "base-dir": testBaseDir,
      },
      { signal: ac.signal },
    );

    await new Promise((resolve) => setTimeout(resolve, 20));

    await msgSendCommand({
      to: listenerActor,
      type: "DISPATCH_TASK",
      body: "Listen task #1",
      actor: "coordinator",
      role: "coordinator",
      "base-dir": testBaseDir,
    });

    await msgSendCommand({
      to: listenerActor,
      type: "SYSTEM_ALERT",
      body: "Listen task #2",
      actor: "coordinator",
      role: "coordinator",
      "base-dir": testBaseDir,
    });

    await new Promise((resolve) => setTimeout(resolve, 70));
    ac.abort();

    const result = await listenPromise;
    expect(result.actor).toBe(listenerActor);
    expect(result.totalDrained).toBe(2);
    expect(result.messages.length).toBe(2);
    expect(result.markdown).toContain("Mailbox Continuous Listen Result");
  });

  it("msg:listen stops automatically when max-messages threshold is reached", async () => {
    const listenerActor = "worker-max-msg";

    await msgSendCommand({
      to: listenerActor,
      type: "DISPATCH_TASK",
      body: "Threshold 1",
      actor: "coordinator",
      role: "coordinator",
      "base-dir": testBaseDir,
    });

    const result = await msgListenCommand({
      actor: listenerActor,
      interval: "20",
      "max-messages": "1",
      "base-dir": testBaseDir,
    });

    expect(result.totalDrained).toBe(1);
    expect(result.messages[0]?.message_type).toBe("DISPATCH_TASK");
  });
});

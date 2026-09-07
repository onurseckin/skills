import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { msgListenCommand } from "../../../olt/scripts/src/cli/commands/msg-listen.ts";
import { msgRecvCommand } from "../../../olt/scripts/src/cli/commands/msg-recv.ts";
import { msgSendCommand } from "../../../olt/scripts/src/cli/commands/msg-send.ts";
import {
  ensureMailboxDirectories,
  loadMailboxCursor,
  resolveMailboxPaths,
} from "../../../olt/scripts/src/communication/mailbox/index.ts";
import {
  recordListenerHeartbeat,
  removeListenerHeartbeat,
} from "../../../olt/scripts/src/communication/mailbox/liveness.ts";
import {
  releaseInMemoryLock,
  resetInMemoryLocks,
  setInMemoryLocking,
  tryAcquireInMemoryLock,
} from "../../../olt/scripts/src/communication/locking/safe-lock.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  createVirtualFSSession,
  type VirtualFSSession,
  VirtualMemoryFS,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("Mailbox Reader Coordination & Concurrency Invariants", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession;
  let testRoot: string;

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
    setInMemoryLocking(true);
    testRoot = `/fixture/reader-coord-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    vfs.mkdirSync(testRoot, { recursive: true });
  });

  afterEach(() => {
    session.cleanup();
    resetInMemoryLocks();
    setInMemoryLocking(false);
  });

  it("fails fast with collision error when background listener heartbeat is active (counterfactual: if reverted, concurrent listeners would interleave uncoordinated and drop messages)", async () => {
    const agentId = "worker-coord-heartbeat";
    const paths = resolveMailboxPaths(agentId, testRoot);
    ensureMailboxDirectories(paths);

    recordListenerHeartbeat(agentId, { baseDir: testRoot, pid: process.pid });

    let collisionError: unknown = null;
    try {
      await msgListenCommand({ actor: agentId, "base-dir": testRoot, timeout: 50 });
    } catch (error) {
      collisionError = error;
    } finally {
      removeListenerHeartbeat(agentId, testRoot);
    }

    expect(collisionError instanceof HarnessError).toBe(true);
    expect((collisionError as HarnessError).code).toBe("INVALID_STATE");
    expect((collisionError as HarnessError).message).toContain("Concurrent reader collision");
  });

  it("fails fast when mailbox drain lock is held by an active drain process (counterfactual: if reverted, two listeners would compete for the same drain stream)", async () => {
    const agentId = "worker-coord-drainlock";
    const paths = resolveMailboxPaths(agentId, testRoot);
    ensureMailboxDirectories(paths);

    const drainLockPath = `${paths.lockPath.slice(0, -5)}.drain.lock`;
    const drainLock = tryAcquireInMemoryLock(drainLockPath, `listener-${agentId}-${process.pid}`);
    expect(drainLock.acquired).toBe(true);

    let drainCollisionError: unknown = null;
    try {
      await msgListenCommand({ actor: agentId, "base-dir": testRoot, timeout: 50 });
    } catch (error) {
      drainCollisionError = error;
    } finally {
      releaseInMemoryLock(drainLockPath, drainLock.fd as number);
    }

    expect(drainCollisionError instanceof HarnessError).toBe(true);
    expect((drainCollisionError as HarnessError).code).toBe("INVALID_STATE");
    expect((drainCollisionError as HarnessError).message).toContain("Concurrent reader collision");
  });

  it("foreground msgRecv with --no-advance-cursor inspects mailbox without advancing cursor or blinding drain (counterfactual: if reverted, foreground inspection would consume messages and blind listeners)", async () => {
    const agentId = "worker-coord-peek";
    const paths = resolveMailboxPaths(agentId, testRoot);
    ensureMailboxDirectories(paths);

    const drainLockPath = `${paths.lockPath.slice(0, -5)}.drain.lock`;
    const drainLock = tryAcquireInMemoryLock(drainLockPath, `listener-${agentId}-${process.pid}`);
    expect(drainLock.acquired).toBe(true);

    const sent = msgSendCommand({
      to: agentId,
      type: "SYSTEM_ALERT",
      actor: "coordinator",
      body: "peek-payload",
      "base-dir": testRoot,
    });

    const peekRes = await msgRecvCommand({
      actor: agentId,
      "base-dir": testRoot,
      "no-advance-cursor": true,
    });
    expect(peekRes.totalReceipts).toBe(1);
    expect(peekRes.receipts[0]?.id).toBe(sent.envelope.id);
    expect(peekRes.receipts[0]?.delivery_status).toBe("DELIVERED");
    expect(loadMailboxCursor(paths.cursorPath).last_read_sequence).toBe(0);

    releaseInMemoryLock(drainLockPath, drainLock.fd as number);

    const listenRes = await msgListenCommand({
      actor: agentId,
      "base-dir": testRoot,
      timeout: 100,
      "max-messages": 1,
    });
    expect(listenRes.totalDrained).toBe(1);
    expect(listenRes.messages[0]?.id).toBe(sent.envelope.id);
    expect(loadMailboxCursor(paths.cursorPath).last_read_sequence).toBe(1);
  });

  it("permits fresh listener to start cleanly after prior listener heartbeat and drain lock are released (counterfactual: if reverted, stale locks would permanently wedge future readers)", async () => {
    const agentId = "worker-coord-lifecycle";
    const paths = resolveMailboxPaths(agentId, testRoot);
    ensureMailboxDirectories(paths);

    const firstDrain = await msgListenCommand({
      actor: agentId,
      "base-dir": testRoot,
      timeout: 50,
      "max-messages": 1,
    });
    expect(firstDrain.totalDrained).toBe(0);

    msgSendCommand({
      to: agentId,
      type: "PULSE_HEARTBEAT",
      actor: "coordinator",
      body: "lifecycle-test",
      "base-dir": testRoot,
    });

    const secondDrain = await msgListenCommand({
      actor: agentId,
      "base-dir": testRoot,
      timeout: 100,
      "max-messages": 1,
    });
    expect(secondDrain.totalDrained).toBe(1);
    expect(loadMailboxCursor(paths.cursorPath).last_read_sequence).toBe(1);
  });
});

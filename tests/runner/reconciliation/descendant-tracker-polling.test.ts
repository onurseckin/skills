import { describe, expect, test } from "bun:test";
import {
  DescendantTracker,
  type ProcessIdentity,
} from "../../../olt/scripts/src/engine/runner/reconciliation/descendant-tracker.ts";
import { MIN_POLL_DELAY_MS } from "../../../olt/scripts/src/engine/runner/reconciliation/descendant-poll-policy.ts";

describe("DescendantTracker background polling", () => {
  test("schedules and runs background polls after a successful start, then stops cleanly", async () => {
    const runnerPid = 30;
    const root: ProcessIdentity = { pid: 40, parent: runnerPid, group: 40, birth: "birth-40" };
    const processes = new Map([
      [root.pid, { pid: root.pid, parent: runnerPid, group: root.group }],
    ]);
    let snapshotCalls = 0;
    const tracker = new DescendantTracker(root.pid, new Set(), "token", {
      runnerPid,
      snapshot: async () => {
        snapshotCalls += 1;
        return processes;
      },
      identify: (pid) => (pid === root.pid ? root : undefined),
      ownedPids: () => new Set(),
      kill: () => true,
      probe: () => "absent",
    });

    const started = await tracker.start();
    expect(started).toEqual(root);
    const afterStart = snapshotCalls;

    // MIN_POLL_DELAY_MS is 10ms; waiting several multiples lets the background poll loop
    // (scheduleNextPoll -> poll -> scheduleNextPoll) run more than once before we stop it.
    await new Promise((resolve) => setTimeout(resolve, MIN_POLL_DELAY_MS * 5));
    expect(snapshotCalls).toBeGreaterThan(afterStart);

    await tracker.stop();
  });
});

describe("DescendantTracker background polling failure handling", () => {
  test("swallows a transient background poll failure but still surfaces it from a later stop()", async () => {
    const runnerPid = 30;
    const root: ProcessIdentity = { pid: 40, parent: runnerPid, group: 40, birth: "birth-40" };
    const processes = new Map([
      [root.pid, { pid: root.pid, parent: runnerPid, group: root.group }],
    ]);
    let snapshotCalls = 0;
    const tracker = new DescendantTracker(root.pid, new Set(), "token", {
      runnerPid,
      snapshot: async () => {
        snapshotCalls += 1;
        // The very first background poll after start() fails once; the poll loop must swallow
        // that rejection (so it does not become an unhandled rejection) and keep polling, while
        // still remembering the failure so a later stop() surfaces it.
        if (snapshotCalls === 2) throw new Error("injected background poll failure");
        return processes;
      },
      identify: (pid) => (pid === root.pid ? root : undefined),
      ownedPids: () => new Set(),
      kill: () => true,
      probe: () => "absent",
    });

    await tracker.start();
    await new Promise((resolve) => setTimeout(resolve, MIN_POLL_DELAY_MS * 4));
    expect(snapshotCalls).toBeGreaterThanOrEqual(2);

    await expect(tracker.stop()).rejects.toThrow("injected background poll failure");
  });
});

describe("DescendantTracker.terminate repeated calls", () => {
  test("resumes signaling on a later call using the delivery ledger instead of re-sending TERM", async () => {
    const runnerPid = 30;
    const root: ProcessIdentity = { pid: 40, parent: runnerPid, group: 40, birth: "birth-40" };
    const child: ProcessIdentity = { pid: 50, parent: 40, group: 40, birth: "birth-50" };
    const processes = new Map(
      [root, child].map((item) => [
        item.pid,
        { pid: item.pid, parent: item.parent, group: item.group },
      ]),
    );
    const killed: Array<[number, NodeJS.Signals]> = [];
    const tracker = new DescendantTracker(root.pid, new Set(), "token", {
      runnerPid,
      snapshot: async () => processes,
      identify: (pid) => (pid === root.pid ? root : pid === child.pid ? child : undefined),
      ownedPids: () => new Set(),
      kill: (pid, signal) => {
        killed.push([pid, signal]);
        return true;
      },
      probe: () => "absent",
    });
    await tracker.start();
    await tracker.stop();

    const firstDelivered: NodeJS.Signals[] = [];
    const first = await tracker.terminate(0, (signal) => firstDelivered.push(signal));
    expect(first).toEqual(["SIGTERM", "SIGKILL"]);
    expect(firstDelivered).toEqual(["SIGTERM", "SIGKILL"]);

    // Both signals were already recorded as delivered to this exact process identity, so a
    // second terminate() call skips re-sending them but must not bail out early just because
    // this round's own SIGTERM delivery was a no-op; the ledger from the first call proves it
    // already went out.
    killed.length = 0;
    const second = await tracker.terminate(0, () => undefined);
    expect(second).toEqual([]);
    expect(killed).toEqual([]);
  });
});

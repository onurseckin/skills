import { describe, expect, test } from "bun:test";
import { DescendantTracker, type ProcessIdentity } from "../../src/runner/descendant-tracker.ts";
import { terminateProcessGroup } from "../../src/runner/process-group.ts";

const identity = (pid: number, parent: number, group = pid): ProcessIdentity => ({
  pid,
  parent,
  group,
  birth: `birth-${pid}`,
});

describe("successful signal delivery ledger", () => {
  test("records process-group TERM before a later KILL failure", async () => {
    const root = identity(40, 30);
    const delivered: NodeJS.Signals[] = [];
    await expect(
      terminateProcessGroup(40, 0, new Promise(() => undefined), root, {
        inspect: () => root,
        kill: (_pid, signal) => {
          if (signal === "SIGKILL") throw new Error("injected KILL failure");
          return true;
        },
        wait: async () => undefined,
        onSignal: (signal) => delivered.push(signal),
      }),
    ).rejects.toThrow("injected KILL failure");

    expect(delivered).toEqual(["SIGTERM"]);
  });

  test("resumes process-group cleanup after a delivered TERM without sending TERM twice", async () => {
    const root = identity(40, 30);
    const sent: NodeJS.Signals[] = [];
    const recorded: NodeJS.Signals[] = [];
    const result = await terminateProcessGroup(
      40,
      0,
      new Promise(() => undefined),
      root,
      {
        inspect: () => root,
        kill: (_pid, signal) => {
          sent.push(signal);
          return true;
        },
        wait: async () => undefined,
        signalsSent: ["SIGTERM"],
        onSignal: (signal) => recorded.push(signal),
      },
    );

    expect(result).toEqual(["SIGKILL"]);
    expect(sent).toEqual(["SIGKILL"]);
    expect(recorded).toEqual(["SIGKILL"]);
  });

  test("records descendant TERM before a later candidate failure", async () => {
    const runner = identity(30, 20);
    const root = identity(40, 30);
    const first = identity(50, 40, 40);
    const second = identity(60, 40, 40);
    const processes = new Map([runner, root, first, second].map((item) => [item.pid, item]));
    const delivered: NodeJS.Signals[] = [];
    const tracker = new DescendantTracker(root.pid, new Set(), "token", {
      runnerPid: runner.pid,
      snapshot: async () => processes,
      identify: (pid) => processes.get(pid),
      ownedPids: () => new Set(),
      kill: (pid) => {
        if (pid === second.pid) throw new Error("injected descendant failure");
      },
      probe: () => "absent",
    });
    await tracker.start();
    await tracker.stop();

    await expect(tracker.terminate(0, (signal) => delivered.push(signal))).rejects.toThrow(
      "injected descendant failure",
    );
    expect(delivered).toEqual(["SIGTERM"]);
  });

  test("resumes descendant cleanup per strong identity after a marker callback failure", async () => {
    const runner = identity(30, 20);
    const root = identity(40, 30);
    const first = identity(50, 40, 40);
    const second = identity(60, 40, 40);
    const processes = new Map([runner, root, first, second].map((item) => [item.pid, item]));
    const sent: Array<[number, NodeJS.Signals]> = [];
    const tracker = new DescendantTracker(root.pid, new Set(), "token", {
      runnerPid: runner.pid,
      snapshot: async () => processes,
      identify: (pid) => processes.get(pid),
      ownedPids: () => new Set(),
      kill: (pid, signal) => sent.push([pid, signal]),
      probe: () => "absent",
    });
    await tracker.start();
    await tracker.stop();
    let appendFails = true;

    await expect(
      tracker.terminate(0, () => {
        if (appendFails) {
          appendFails = false;
          throw new Error("injected marker append failure");
        }
      }),
    ).rejects.toThrow("injected marker append failure");
    await tracker.terminate(0, () => undefined);

    expect(sent.filter((entry) => entry[1] === "SIGTERM")).toEqual([
      [first.pid, "SIGTERM"],
      [second.pid, "SIGTERM"],
    ]);
  });
});

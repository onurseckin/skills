import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DescendantTracker,
  type ProcessIdentity,
} from "../../../orchestrating-long-tasks/scripts/src/runner/descendant-tracker.ts";
import {
  MAX_POLL_DELAY_MS,
  MIN_POLL_DELAY_MS,
  nextPollDelayMs,
} from "../../../orchestrating-long-tasks/scripts/src/runner/descendant-poll-policy.ts";
import { authenticatedOwnerPids } from "../../../orchestrating-long-tasks/scripts/src/runner/pipe-ownership.ts";
import { waitForProcessExit } from "./run-command-fixture.ts";

function snapshot(...identities: ProcessIdentity[]): Map<number, ProcessIdentity> {
  return new Map(identities.map((identity) => [identity.pid, identity]));
}

const identity = (pid: number, parent: number, group = pid): ProcessIdentity => ({
  pid,
  parent,
  group,
  birth: `birth-${pid}`,
});

describe("descendant termination safety", () => {
  test("requires per-command authentication before trusting pipe owners", () => {
    expect(authenticatedOwnerPids(new Set([10, 20, 30]), new Set([30, 40]))).toEqual(new Set([30]));
  });

  test("never tracks or signals the runner ancestry even if ownership discovery returns it", async () => {
    const processes = snapshot(
      identity(10, 0),
      identity(20, 10),
      identity(30, 20),
      identity(40, 30),
      identity(50, 40, 40),
      identity(70, 1),
    );
    const killed: Array<[number, NodeJS.Signals]> = [];
    const tracker = new DescendantTracker(40, new Set([1n]), "token", {
      runnerPid: 30,
      snapshot: async () => processes,
      identify: (pid) => processes.get(pid),
      ownedPids: () => new Set([10, 20, 30, 70]),
      kill: (pid, signal) => {
        killed.push([pid, signal]);
      },
    });

    await tracker.start();
    await tracker.stop();
    await tracker.terminate(0);

    expect(new Set(killed.map(([pid]) => pid))).toEqual(new Set([50, 70]));
  });

  test("refuses a root that is not a direct isolated child of the runner", async () => {
    const badParent = new DescendantTracker(40, new Set(), "token", {
      runnerPid: 30,
      snapshot: async () => snapshot(identity(30, 20), identity(40, 20)),
      identify: (pid) => snapshot(identity(30, 20), identity(40, 20)).get(pid),
      ownedPids: () => new Set(),
      kill: () => undefined,
    });
    await expect(badParent.start()).rejects.toThrow(/direct child/i);

    const badGroup = new DescendantTracker(40, new Set(), "token", {
      runnerPid: 30,
      snapshot: async () => snapshot(identity(30, 20), identity(40, 30, 30)),
      identify: (pid) => snapshot(identity(30, 20), identity(40, 30, 30)).get(pid),
      ownedPids: () => new Set(),
      kill: () => undefined,
    });
    await expect(badGroup.start()).rejects.toThrow(/process group/i);
  });

  test("accepts a command that naturally exits before its root identity can be captured", async () => {
    const killed: number[] = [];
    const staleSnapshot = snapshot(identity(30, 20), identity(40, 30));
    const current = snapshot(identity(30, 20));
    const tracker = new DescendantTracker(40, new Set(), "token", {
      runnerPid: 30,
      snapshot: async () => staleSnapshot,
      identify: (pid) => current.get(pid),
      ownedPids: () => new Set(),
      kill: (pid) => killed.push(pid),
    });

    expect(await tracker.start()).toBeUndefined();
    await tracker.stop();
    expect(await tracker.terminate(0)).toEqual([]);
    expect(killed).toEqual([]);
  });

  test("still terminates an authenticated escaped owner after the root naturally exits", async () => {
    const processes = snapshot(identity(30, 20), identity(50, 1, 50));
    const killed: number[] = [];
    const tracker = new DescendantTracker(40, new Set([1n]), "token", {
      runnerPid: 30,
      snapshot: async () => processes,
      identify: (pid) => processes.get(pid),
      ownedPids: () => new Set([50]),
      kill: (pid) => killed.push(pid),
    });

    expect(await tracker.start()).toBeUndefined();
    await tracker.stop();
    await tracker.terminate(0);
    expect(killed).toEqual([50, 50]);
  });

  test("does not signal a reused descendant pid", async () => {
    let processes = snapshot(identity(30, 20), identity(40, 30), identity(50, 40, 40));
    const killed: number[] = [];
    const tracker = new DescendantTracker(40, new Set(), "token", {
      runnerPid: 30,
      snapshot: async () => processes,
      identify: (pid) => processes.get(pid),
      ownedPids: () => new Set(),
      kill: (pid) => {
        killed.push(pid);
      },
    });
    await tracker.start();
    await tracker.stop();
    processes = snapshot(identity(30, 20), identity(40, 30), {
      ...identity(50, 1),
      birth: "reused",
    });

    await tracker.terminate(0);
    expect(killed).toEqual([]);
  });

  test("does not extend ancestry through a reused root pid", async () => {
    let processes = snapshot(identity(20, 10), identity(30, 20), identity(40, 30));
    const killed: number[] = [];
    const tracker = new DescendantTracker(40, new Set(), "token", {
      runnerPid: 30,
      snapshot: async () => processes,
      identify: (pid) => processes.get(pid),
      ownedPids: () => new Set(),
      kill: (pid) => killed.push(pid),
    });
    await tracker.start();
    processes = snapshot(
      identity(20, 10),
      identity(30, 20),
      {
        ...identity(40, 1),
        birth: "reused-root",
      },
      identity(60, 40),
    );
    await tracker.stop();
    await tracker.terminate(0);
    expect(killed).toEqual([]);
  });

  test("does not extend through a tracked parent after its bound ancestry edge breaks", async () => {
    let processes = snapshot(
      identity(20, 10),
      identity(30, 20),
      identity(40, 30),
      identity(50, 40, 40),
    );
    const killed: number[] = [];
    const tracker = new DescendantTracker(40, new Set(), "token", {
      runnerPid: 30,
      snapshot: async () => processes,
      identify: (pid) => processes.get(pid),
      ownedPids: () => new Set(),
      kill: (pid) => killed.push(pid),
    });
    await tracker.start();
    processes = snapshot(
      identity(20, 10),
      identity(30, 20),
      { ...identity(40, 1), birth: "reused-root" },
      identity(50, 40, 40),
      identity(60, 50, 40),
    );
    await tracker.stop();
    await tracker.terminate(0);
    expect(killed).toEqual([50, 50]);
  });
});

describe("descendant poll cadence", () => {
  test("resets to the floor the instant a new descendant is discovered", () => {
    expect(nextPollDelayMs(160, true)).toBe(MIN_POLL_DELAY_MS);
    expect(nextPollDelayMs(MAX_POLL_DELAY_MS, true)).toBe(MIN_POLL_DELAY_MS);
  });

  test("backs off geometrically while nothing new is found, capped at the ceiling", () => {
    let delay = MIN_POLL_DELAY_MS;
    const observed: number[] = [];
    for (let index = 0; index < 8; index += 1) {
      delay = nextPollDelayMs(delay, false);
      observed.push(delay);
    }
    expect(observed).toEqual([20, 40, 80, 160, 250, 250, 250, 250]);
    expect(Math.max(...observed)).toBeLessThanOrEqual(MAX_POLL_DELAY_MS);
  });

  test("never regresses below the floor a fresh tracker starts at", () => {
    expect(nextPollDelayMs(MIN_POLL_DELAY_MS, false)).toBeGreaterThan(MIN_POLL_DELAY_MS);
  });
});

describe("descendant tracking against real OS processes", () => {
  const roots: string[] = [];
  const fixture = join(import.meta.dir, "fixtures/command-fixture.ts");

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  // This is the guarantee the whole tracker exists for, proven against a real process tree
  // rather than a scripted snapshot map: a plain (non-detached, non-pipe-owning) grandchild is
  // reachable ONLY through the ancestry walk the periodic poll performs, so if the backed-off
  // cadence introduced in this fix ever let a fork-then-quick-exit slip past unseen, this is the
  // test that would catch it.
  test("still catches a real descendant that outlives its immediate leader under the backed-off cadence", async () => {
    const runRoot = await mkdtemp(join(tmpdir(), "descendant-cadence-"));
    roots.push(runRoot);
    const pidPath = join(runRoot, "grandchild.pid");
    const leader = Bun.spawn({
      cmd: [process.execPath, fixture, "spawn-then-outlive", pidPath],
      detached: true,
      stdout: "ignore",
      stderr: "ignore",
    });
    const tracker = new DescendantTracker(leader.pid, new Set(), "real-cadence-token");

    await tracker.start();
    await leader.exited; // the leader exits deliberately while its grandchild is still running
    await tracker.stop();

    const grandchildPid = Number(await readFile(pidPath, "utf8"));
    const signals = await tracker.terminate(50);
    expect(signals).toContain("SIGTERM");
    await waitForProcessExit(grandchildPid);
  }, 10_000);
});

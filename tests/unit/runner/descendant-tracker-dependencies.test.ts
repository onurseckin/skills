import { describe, expect, test } from "bun:test";
import { trackerDependencies } from "../../../orchestrating-long-tasks/scripts/src/runner/descendant-tracker-dependencies.ts";
import { readProcessIdentity } from "../../../orchestrating-long-tasks/scripts/src/runner/process-identity.ts";
import {
  ownedProcessPids,
  ownershipTokenIdentities,
} from "../../../orchestrating-long-tasks/scripts/src/runner/pipe-ownership.ts";
import { processSnapshot } from "../../../orchestrating-long-tasks/scripts/src/runner/process-tree.ts";
import { probeAttemptProcess } from "../../../orchestrating-long-tasks/scripts/src/runner/attempt-intent.ts";

describe("trackerDependencies", () => {
  test("falls back to the real platform implementations when nothing is supplied", () => {
    const dependencies = trackerDependencies({});
    expect(dependencies.runnerPid).toBe(process.pid);
    expect(dependencies.snapshot).toBe(processSnapshot);
    expect(dependencies.identify).toBe(readProcessIdentity);
    expect(dependencies.ownedPids).toBe(ownedProcessPids);
    expect(dependencies.tokenOwners).toBe(ownershipTokenIdentities);
    expect(dependencies.kill).toBe(process.kill);
    expect(dependencies.probe).toBe(probeAttemptProcess);
  });

  test("uses every explicitly supplied override as-is", () => {
    const identify = () => undefined;
    const snapshot = async () => new Map();
    const ownedPids = () => new Set<number>();
    const tokenOwners = () => [];
    const kill = () => true;
    const probe = () => "absent" as const;
    const dependencies = trackerDependencies({
      runnerPid: 99,
      snapshot,
      identify,
      ownedPids,
      tokenOwners,
      kill,
      probe,
    });
    expect(dependencies).toEqual({
      runnerPid: 99,
      snapshot,
      identify,
      ownedPids,
      tokenOwners,
      kill,
      probe,
    });
  });

  test("derives tokenOwners from a supplied ownedPids and identify when tokenOwners is omitted", () => {
    const pipeAnchors = new Set([1n, 2n]);
    const identified = new Map([
      [10, { pid: 10, parent: 1, group: 10, birth: "b10" }],
      [20, { pid: 20, parent: 1, group: 20, birth: "b20" }],
    ]);
    const dependencies = trackerDependencies(
      {
        ownedPids: (anchors, token) => {
          expect(anchors).toBe(pipeAnchors);
          expect(token).toBe("secret");
          return new Set([10, 20, 30]);
        },
        identify: (pid) => identified.get(pid),
      },
      pipeAnchors,
    );
    const owners = dependencies.tokenOwners("secret");
    // pid 30 has no known identity and is filtered out of the derived owner list.
    expect(owners.sort((a, b) => a.pid - b.pid)).toEqual([
      { pid: 10, parent: 1, group: 10, birth: "b10" },
      { pid: 20, parent: 1, group: 20, birth: "b20" },
    ]);
  });
});

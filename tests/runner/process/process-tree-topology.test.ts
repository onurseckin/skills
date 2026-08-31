import { describe, expect, test } from "bun:test";
import {
  ancestry,
  matchesTopology,
} from "../../../olt/scripts/src/engine/runner/process/process-tree.ts";
import type { ProcessTopology } from "../../../olt/scripts/src/engine/runner/process/process-identity.ts";

describe("ancestry", () => {
  test("walks the parent chain from a pid up through every recorded ancestor", () => {
    const processes = new Map<number, ProcessTopology>([
      [1, { pid: 1, parent: 0, group: 1 }],
      [10, { pid: 10, parent: 1, group: 10 }],
      [20, { pid: 20, parent: 10, group: 10 }],
    ]);
    // The chain includes pid 0 itself: it is the last parent value read from the table, even
    // though 0 has no entry of its own (its own lookup then yields undefined and halts).
    expect(ancestry(processes, 20)).toEqual(new Set([20, 10, 1, 0]));
  });

  test("includes a parent pid one level past the process table before stopping", () => {
    const processes = new Map<number, ProcessTopology>([[20, { pid: 20, parent: 999, group: 20 }]]);
    expect(ancestry(processes, 20)).toEqual(new Set([20, 999]));
  });

  test("does not loop forever when the table contains a parent cycle", () => {
    const processes = new Map<number, ProcessTopology>([
      [10, { pid: 10, parent: 20, group: 10 }],
      [20, { pid: 20, parent: 10, group: 10 }],
    ]);
    expect(ancestry(processes, 10)).toEqual(new Set([10, 20]));
  });
});

describe("matchesTopology", () => {
  const identity = { pid: 10, parent: 1, group: 10, birth: "birth-10" };

  test("matches when pid, parent, and group line up exactly", () => {
    expect(matchesTopology(identity, { pid: 10, parent: 1, group: 10 })).toBe(true);
  });

  test("rejects a mismatch on any single field", () => {
    expect(matchesTopology(identity, { pid: 10, parent: 2, group: 10 })).toBe(false);
    expect(matchesTopology(identity, { pid: 10, parent: 1, group: 11 })).toBe(false);
    expect(matchesTopology({ ...identity, pid: 11 }, { pid: 10, parent: 1, group: 10 })).toBe(
      false,
    );
  });

  test("rejects when either side is missing", () => {
    expect(matchesTopology(undefined, { pid: 10, parent: 1, group: 10 })).toBe(false);
    expect(matchesTopology(identity, undefined)).toBe(false);
    expect(matchesTopology(undefined, undefined)).toBe(false);
  });
});

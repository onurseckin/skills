import { describe, expect, test } from "bun:test";
import { assignWorktrees } from "../../../../orchestrating-long-tasks/scripts/src/workflow/worktree/assign.ts";
import type { TopologyRecord } from "../../../../orchestrating-long-tasks/scripts/src/contracts/topology.ts";

function topology(waves: readonly (readonly string[])[]): TopologyRecord {
  return {
    revision: 1,
    max_parallel: 4,
    decisions: [],
    waves: waves.map((task_ids, index) => ({ wave: index + 1, task_ids: [...task_ids] })),
  };
}

describe("assignWorktrees", () => {
  test("gives every task in the widest wave its own slot", () => {
    const tasks = new Map([
      ["t1", { write_scope: ["src/a"] }],
      ["t2", { write_scope: ["src/b"] }],
      ["t3", { write_scope: ["src/c"] }],
    ]);
    const { assignments, worktreeCount } = assignWorktrees(topology([["t1", "t2", "t3"]]), tasks);
    expect(worktreeCount).toBe(3);
    expect(assignments).toEqual([
      { task_id: "t1", worktree_id: "wt-0", wave: 1 },
      { task_id: "t2", worktree_id: "wt-1", wave: 1 },
      { task_id: "t3", worktree_id: "wt-2", wave: 1 },
    ]);
  });

  test("reuses slots round-robin across sequential waves, sizing the pool to the peak wave", () => {
    const tasks = new Map([
      ["t1", { write_scope: ["src/a"] }],
      ["t2", { write_scope: ["src/b"] }],
      ["t3", { write_scope: ["src/a"] }], // same scope as t1 — fine, they never run concurrently
    ]);
    const { assignments, worktreeCount } = assignWorktrees(
      topology([
        ["t1", "t2"],
        ["t3"],
      ]),
      tasks,
    );
    expect(worktreeCount).toBe(2);
    expect(assignments).toEqual([
      { task_id: "t1", worktree_id: "wt-0", wave: 1 },
      { task_id: "t2", worktree_id: "wt-1", wave: 1 },
      { task_id: "t3", worktree_id: "wt-0", wave: 2 },
    ]);
  });

  test("never assigns the same slot to two tasks that could run concurrently, even across many waves", () => {
    const tasks = new Map(
      Array.from({ length: 6 }, (_, i) => [`t${i}`, { write_scope: [`src/${i}`] }] as const),
    );
    const { assignments } = assignWorktrees(
      topology([
        ["t0", "t1", "t2"],
        ["t3", "t4"],
        ["t5"],
      ]),
      tasks,
    );
    const byWave = new Map<number, string[]>();
    for (const a of assignments) {
      byWave.set(a.wave, [...(byWave.get(a.wave) ?? []), a.worktree_id]);
    }
    for (const slots of byWave.values()) {
      expect(new Set(slots).size).toBe(slots.length);
    }
  });

  test("throws INTEGRITY when a corrupted topology puts colliding tasks in one wave", () => {
    const tasks = new Map([
      ["t1", { write_scope: ["src/shared"] }],
      ["t2", { write_scope: ["src/shared/nested"] }],
    ]);
    expect(() => assignWorktrees(topology([["t1", "t2"]]), tasks)).toThrow(/colliding tasks/);
  });
});

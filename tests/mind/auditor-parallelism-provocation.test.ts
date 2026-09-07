import { describe, expect, it, mock } from "bun:test";
import { auditAntiStagnationPassivity } from "../../olt/scripts/src/mind/auditing/anti-stagnation-engine.ts";
import * as manager from "../../olt/scripts/src/workflow/worktree/manager.ts";
import * as clusterer from "../../olt/scripts/src/mind/preplanning/backlog-clusterer.ts";

const realManager = { ...manager };
const realClusterer = { ...clusterer };

function restoreMocks(): void {
  mock.module("../../olt/scripts/src/workflow/worktree/manager.ts", () => realManager);
  mock.module("../../olt/scripts/src/mind/preplanning/backlog-clusterer.ts", () => realClusterer);
}

describe("Mind Auditor Parallelism Provocation", () => {
  it("should not deliver provocation if concurrency is high", () => {
    mock.module("../../olt/scripts/src/workflow/worktree/manager.ts", () => ({
      listWorktrees: () => [
        { status: "active", trackId: "t1" },
        { status: "active", trackId: "t2" },
      ],
    }));
    mock.module("../../olt/scripts/src/mind/preplanning/backlog-clusterer.ts", () => ({
      clusterBacklogAndDefects: () => [
        { cluster_id: "c1", domain: "core" },
        { cluster_id: "c2", domain: "mind" },
      ],
      loadBacklogItems: () => [],
      loadDefectItems: () => [],
    }));

    const result = auditAntiStagnationPassivity();
    restoreMocks();
    expect(result.worktreeOccupancy).toBe(2);
    expect(result.disjointClusterCount).toBe(2);
    expect(result.provocationDelivered).toBe(false);
  });

  it("should deliver provocation if disjoint clusters exist and concurrency <= 1", () => {
    mock.module("../../olt/scripts/src/workflow/worktree/manager.ts", () => ({
      listWorktrees: () => [{ status: "active", trackId: "t1" }],
    }));
    mock.module("../../olt/scripts/src/mind/preplanning/backlog-clusterer.ts", () => ({
      clusterBacklogAndDefects: () => [
        { cluster_id: "c1", domain: "core" },
        { cluster_id: "c2", domain: "mind" },
      ],
      loadBacklogItems: () => [],
      loadDefectItems: () => [],
    }));

    const result = auditAntiStagnationPassivity();
    restoreMocks();
    expect(result.worktreeOccupancy).toBe(1);
    expect(result.disjointClusterCount).toBe(2);
    expect(result.provocationDelivered).toBe(true);
    expect(result.message).toContain("Worktree occupancy is critically low");
  });

  it("should not deliver provocation if disjoint clusters <= 1", () => {
    mock.module("../../olt/scripts/src/workflow/worktree/manager.ts", () => ({
      listWorktrees: () => [{ status: "active", trackId: "t1" }],
    }));
    mock.module("../../olt/scripts/src/mind/preplanning/backlog-clusterer.ts", () => ({
      clusterBacklogAndDefects: () => [{ cluster_id: "c1", domain: "core" }],
      loadBacklogItems: () => [],
      loadDefectItems: () => [],
    }));

    const result = auditAntiStagnationPassivity();
    restoreMocks();
    expect(result.worktreeOccupancy).toBe(1);
    expect(result.disjointClusterCount).toBe(1);
    expect(result.provocationDelivered).toBe(false);
  });
});

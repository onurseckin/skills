import { describe, expect, it } from "bun:test";
import {
  clusterTasks,
  provisionTaskClusters,
  type PlanTaskInput,
} from "../../../olt/scripts/src/mind/planning/index.ts";
import {
  clusterBacklogTasks,
  extractPlanTasksFromBacklog,
  provisionBacklogTracks,
  runPreplanningTick,
  type RawBacklogItem,
  type RawDefectItem,
} from "../../../olt/scripts/src/mind/preplanning/index.ts";
import type {
  CreateWorktreeOptions,
  TrackWorktreeInfo,
} from "../../../olt/scripts/src/workflow/worktree/manager.ts";

const createMockWorktree = (options: CreateWorktreeOptions): TrackWorktreeInfo => ({
  trackId: options.trackId,
  worktreeId: options.trackId,
  worktreePath: `/mock/worktrees/${options.trackId}`,
  branch: `track/${options.trackId}`,
  baseBranch: options.baseBranch ?? "main",
  lockPath: `/mock/locks/${options.trackId}.lock`,
  createdAt: "2026-09-06T00:00:00.000Z",
  status: "active",
  tier: "track",
});

describe("Dynamic Graph Clustering Core Suite", () => {
  it("returns empty clusters when given empty task array", () => {
    const clusters = clusterTasks([], 5);
    expect(clusters).toEqual([]);
  });

  it("handles maxTracks less than 1 by clamping to 1", () => {
    const tasks: readonly PlanTaskInput[] = [
      { id: "t1", title: "Task 1", write_scope: ["a.ts"] },
      { id: "t2", title: "Task 2", write_scope: ["b.ts"] },
    ];
    const clusters = clusterTasks(tasks, 0);
    expect(clusters.length).toBe(1);
    expect(clusters[0]!.tasks.length).toBe(2);
  });

  it("partitions independent tasks into disjoint parallel tracks", () => {
    const tasks: readonly PlanTaskInput[] = [
      { id: "task-1", title: "Task 1", write_scope: ["src/a.ts"] },
      { id: "task-2", title: "Task 2", write_scope: ["src/b.ts"] },
      { id: "task-3", title: "Task 3", write_scope: ["src/c.ts"] },
    ];
    const clusters = clusterTasks(tasks, 5);
    expect(clusters.length).toBe(3);
    expect(clusters[0]!.trackId).toBe("track-1");
    expect(clusters[1]!.trackId).toBe("track-2");
    expect(clusters[2]!.trackId).toBe("track-3");

    const idsInTracks = clusters.map((c) => c.tasks.map((t) => t.id));
    expect(idsInTracks).toContainEqual(["task-1"]);
    expect(idsInTracks).toContainEqual(["task-2"]);
    expect(idsInTracks).toContainEqual(["task-3"]);
  });

  it("clusters tasks with shared write scope into the same track", () => {
    const tasks: readonly PlanTaskInput[] = [
      { id: "task-1", title: "Task 1", write_scope: ["src/shared.ts", "src/a.ts"] },
      { id: "task-2", title: "Task 2", write_scope: ["src/b.ts"] },
      { id: "task-3", title: "Task 3", write_scope: ["src/shared.ts"] },
    ];
    const clusters = clusterTasks(tasks, 5);
    expect(clusters.length).toBe(2);
    const sharedCluster = clusters.find((c) => c.tasks.some((t) => t.id === "task-1"))!;
    expect(sharedCluster.tasks.some((t) => t.id === "task-3")).toBe(true);
    expect(sharedCluster.tasks.some((t) => t.id === "task-2")).toBe(false);
  });

  it("clusters tasks with dataflow dependencies into the same track", () => {
    const tasks: readonly PlanTaskInput[] = [
      { id: "task-producer", title: "Producer", write_scope: ["src/store.ts"] },
      { id: "task-consumer", title: "Consumer", dependencies: ["task-producer"] },
      { id: "task-independent", title: "Independent", write_scope: ["src/other.ts"] },
    ];
    const clusters = clusterTasks(tasks, 5);
    expect(clusters.length).toBe(2);
    const depCluster = clusters.find((c) => c.tasks.some((t) => t.id === "task-producer"))!;
    expect(depCluster.tasks.some((t) => t.id === "task-consumer")).toBe(true);
    expect(depCluster.tasks.some((t) => t.id === "task-independent")).toBe(false);
  });

  it("merges smallest clusters when component count exceeds maxTracks", () => {
    const tasks: readonly PlanTaskInput[] = [
      { id: "t1", title: "T1", write_scope: ["1.ts"] },
      { id: "t2", title: "T2", write_scope: ["2.ts"] },
      { id: "t3", title: "T3", write_scope: ["3.ts"] },
      { id: "t4", title: "T4", write_scope: ["4.ts"] },
    ];
    const clusters = clusterTasks(tasks, 2);
    expect(clusters.length).toBe(2);
    const totalAssigned = clusters.reduce((acc, c) => acc + c.tasks.length, 0);
    expect(totalAssigned).toBe(4);
  });

  it("provisions track worktrees via provisionTaskClusters with worktreeCreator", () => {
    const tasks: readonly PlanTaskInput[] = [
      { id: "t1", title: "T1", write_scope: ["src/a.ts"] },
      { id: "t2", title: "T2", write_scope: ["src/b.ts"] },
    ];
    const provisioned = provisionTaskClusters({
      repoRoot: "/mock/repo",
      tasks,
      maxTracks: 2,
      worktreeCreator: createMockWorktree,
    });
    expect(provisioned.length).toBe(2);
    expect(provisioned[0]!.worktree.trackId).toBe("track-1");
    expect(provisioned[0]!.worktree.worktreePath).toBe("/mock/worktrees/track-1");
    expect(provisioned[1]!.worktree.trackId).toBe("track-2");
    expect(provisioned[1]!.worktree.worktreePath).toBe("/mock/worktrees/track-2");
  });
});

describe("Mind Preplanning Dynamic Graph Clustering Reachability", () => {
  it("extracts plan tasks from raw backlog and defect items with write scopes and dependencies", () => {
    const backlog: readonly RawBacklogItem[] = [
      { id: "b1", title: "Item 1", write_scope: ["src/feature.ts"], dependencies: ["d1"] },
      { id: "b2", title: "Item 2", scope: ["src/other.ts"] },
    ];
    const defects: readonly RawDefectItem[] = [
      { id: "d1", title: "Defect 1", write_scope: ["src/fix.ts"] },
    ];
    const tasks = extractPlanTasksFromBacklog(backlog, defects);
    expect(tasks.length).toBe(3);
    expect(tasks[0]!.id).toBe("b1");
    expect(tasks[0]!.write_scope).toEqual(["src/feature.ts"]);
    expect(tasks[0]!.dependencies).toEqual(["d1"]);
    expect(tasks[1]!.id).toBe("b2");
    expect(tasks[1]!.write_scope).toEqual(["src/other.ts"]);
    expect(tasks[2]!.id).toBe("d1");
    expect(tasks[2]!.write_scope).toEqual(["src/fix.ts"]);
  });

  it("clusterBacklogTasks clusters backlog items and defects into disjoint tracks", () => {
    const items: readonly RawBacklogItem[] = [
      { id: "item-alpha", title: "Alpha", write_scope: ["src/alpha.ts"], status: "PENDING" },
      { id: "item-beta", title: "Beta", write_scope: ["src/beta.ts"], status: "PENDING" },
      {
        id: "item-gamma",
        title: "Gamma",
        write_scope: ["src/alpha.ts"],
        status: "PENDING",
      },
    ];
    const defects: readonly RawDefectItem[] = [
      {
        id: "defect-alpha",
        title: "Fix Alpha",
        dependencies: ["item-alpha"],
        status: "OPEN",
      },
    ];

    const clusters = clusterBacklogTasks(items, defects, 5);
    expect(clusters.length).toBe(2);

    const alphaCluster = clusters.find((c) => c.tasks.some((t) => t.id === "item-alpha"))!;
    expect(alphaCluster.tasks.some((t) => t.id === "item-gamma")).toBe(true);
    expect(alphaCluster.tasks.some((t) => t.id === "defect-alpha")).toBe(true);
    expect(alphaCluster.tasks.some((t) => t.id === "item-beta")).toBe(false);

    const betaCluster = clusters.find((c) => c.tasks.some((t) => t.id === "item-beta"))!;
    expect(betaCluster.tasks.length).toBe(1);
  });

  it("provisionBacklogTracks invokes provisionTaskClusters and returns provisioned clusters", () => {
    const explicitBacklog: readonly RawBacklogItem[] = [
      { id: "b1", title: "B1", write_scope: ["src/one.ts"], status: "PENDING" },
      { id: "b2", title: "B2", write_scope: ["src/two.ts"], status: "PENDING" },
    ];
    const provisioned = provisionBacklogTracks({
      rootDir: "/mock/repo",
      explicitBacklog,
      explicitDefects: [],
      maxTracks: 2,
      worktreeCreator: createMockWorktree,
    });
    expect(provisioned.length).toBe(2);
    expect(provisioned[0]!.trackId).toBe("track-1");
    expect(provisioned[0]!.worktree.branch).toBe("track/track-1");
    expect(provisioned[1]!.trackId).toBe("track-2");
    expect(provisioned[1]!.worktree.branch).toBe("track/track-2");
  });

  it("runPreplanningTick routes through clusterTasks and exposes task_clusters in result", () => {
    const explicitBacklog: readonly RawBacklogItem[] = [
      { id: "task-x", title: "X", write_scope: ["src/x.ts"], status: "PENDING", domain: "core" },
      { id: "task-y", title: "Y", write_scope: ["src/y.ts"], status: "PENDING", domain: "core" },
    ];
    const explicitDefects: readonly RawDefectItem[] = [
      {
        id: "def-x",
        title: "DX",
        dependencies: ["task-x"],
        status: "OPEN",
        domain: "core",
      },
    ];

    const result = runPreplanningTick({
      rootDir: "/mock/repo",
      dryRun: true,
      explicitBacklog,
      explicitDefects,
      maxTracks: 5,
    });

    expect(result.task_clusters).toBeDefined();
    expect(result.task_clusters!.length).toBe(2);

    const trackWithX = result.task_clusters!.find((tc) => tc.tasks.some((t) => t.id === "task-x"))!;
    expect(trackWithX.tasks.some((t) => t.id === "def-x")).toBe(true);
    expect(trackWithX.tasks.some((t) => t.id === "task-y")).toBe(false);

    const trackWithY = result.task_clusters!.find((tc) => tc.tasks.some((t) => t.id === "task-y"))!;
    expect(trackWithY.tasks.length).toBe(1);
  });

  it("runPreplanningTick provisions worktrees when provisionWorktrees is requested", () => {
    const explicitBacklog: readonly RawBacklogItem[] = [
      { id: "t1", title: "T1", write_scope: ["src/t1.ts"], status: "PENDING", domain: "tooling" },
      { id: "t2", title: "T2", write_scope: ["src/t2.ts"], status: "PENDING", domain: "tooling" },
    ];

    const result = runPreplanningTick({
      rootDir: "/mock/repo",
      dryRun: true,
      provisionWorktrees: true,
      explicitBacklog,
      explicitDefects: [],
      maxTracks: 2,
      worktreeCreator: createMockWorktree,
    });

    expect(result.task_clusters).toBeDefined();
    expect(result.task_clusters!.length).toBe(2);
    expect(result.provisioned_clusters).toBeDefined();
    expect(result.provisioned_clusters!.length).toBe(2);
    expect(result.provisioned_clusters![0]!.worktree.trackId).toBe("track-1");
    expect(result.provisioned_clusters![1]!.worktree.trackId).toBe("track-2");
  });

  it("runPreplanningTick returns empty task_clusters on empty eligible backlog", () => {
    const result = runPreplanningTick({
      rootDir: "/mock/repo",
      dryRun: true,
      explicitBacklog: [],
      explicitDefects: [],
    });
    expect(result.task_clusters).toEqual([]);
    expect(result.provisioned_clusters).toBeUndefined();
  });
});

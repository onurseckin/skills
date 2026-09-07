import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runGit } from "../../olt/scripts/src/workflow/worktree/git-ops.ts";
import {
  clusterTasks,
  provisionTaskClusters,
} from "../../olt/scripts/src/mind/planning/dynamic-graph-clustering.ts";
import type { PlanTaskInput } from "../../olt/scripts/src/mind/planning/engine/index.ts";

describe("Dynamic Graph Clustering", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "harness-test-"));
    runGit(repoRoot, ["init", "--initial-branch=main"]);
    runGit(repoRoot, ["commit", "--allow-empty", "-m", "Initial commit"]);
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it("clusters independent tasks into separate tracks", () => {
    const tasks: readonly PlanTaskInput[] = [
      { id: "t1", title: "Task 1", write_scope: ["file1.ts"] },
      { id: "t2", title: "Task 2", write_scope: ["file2.ts"] },
    ];
    const clusters = clusterTasks(tasks, 5);
    expect(clusters.length).toBe(2);
    expect(clusters.some((c) => c.tasks.some((t) => t.id === "t1"))).toBe(true);
    expect(clusters.some((c) => c.tasks.some((t) => t.id === "t2"))).toBe(true);
  });

  it("merges tasks with dataflow dependencies into same track", () => {
    const tasks: readonly PlanTaskInput[] = [
      { id: "t1", title: "Task 1", write_scope: ["file1.ts"] },
      { id: "t2", title: "Task 2", dependencies: ["t1"] },
      { id: "t3", title: "Task 3", write_scope: ["file3.ts"] },
    ];
    const clusters = clusterTasks(tasks, 5);
    expect(clusters.length).toBe(2);
    const depCluster = clusters.find((c) => c.tasks.some((t) => t.id === "t1"))!;
    expect(depCluster.tasks.some((t) => t.id === "t2")).toBe(true);
  });

  it("merges tasks with file overlap into same track", () => {
    const tasks: readonly PlanTaskInput[] = [
      { id: "t1", title: "Task 1", write_scope: ["shared.ts"] },
      { id: "t2", title: "Task 2", write_scope: ["shared.ts"] },
    ];
    const clusters = clusterTasks(tasks, 5);
    expect(clusters.length).toBe(1);
    expect(clusters[0]!.tasks.length).toBe(2);
  });

  it("limits tracks up to maxTracks by merging smallest clusters", () => {
    const tasks: readonly PlanTaskInput[] = [
      { id: "t1", title: "T1" },
      { id: "t2", title: "T2" },
      { id: "t3", title: "T3" },
      { id: "t4", title: "T4" },
      { id: "t5", title: "T5" },
      { id: "t6", title: "T6" },
    ]; // 6 independent tasks
    const clusters = clusterTasks(tasks, 3);
    expect(clusters.length).toBe(3);
  });

  it("provisions worktrees for task clusters", () => {
    const tasks: readonly PlanTaskInput[] = [
      { id: "t1", title: "Task 1" },
      { id: "t2", title: "Task 2" },
    ];
    const provisioned = provisionTaskClusters({
      repoRoot,
      tasks,
      maxTracks: 2,
    });
    expect(provisioned.length).toBe(2);
    expect(provisioned[0]!.worktree.worktreePath).toContain(".olt/worktrees/track-1");
    expect(provisioned[1]!.worktree.worktreePath).toContain(".olt/worktrees/track-2");
  });
});

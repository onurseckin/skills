import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import { setupVirtualMindFS, cleanupVirtualMindFS, scratchRoot } from "./fixtures/index.ts";
import { MindAuditorEngine } from "../../olt/scripts/src/mind/auditing/cognitive/index.ts";
import * as manager from "../../olt/scripts/src/workflow/worktree/manager.ts";
import * as clusterer from "../../olt/scripts/src/mind/preplanning/backlog-clusterer.ts";

const realManager = { ...manager };
const realClusterer = { ...clusterer };

const MIN_MANIFEST_YAML =
  "role: mind\ntier: 0\nspawns:\n  - orchestrator\nmay:\n  - Coordinate strategic goals\nmust_not:\n  - Implement code directly\n";

function restoreMocks(): void {
  mock.module("../../olt/scripts/src/workflow/worktree/manager.ts", () => realManager);
  mock.module("../../olt/scripts/src/mind/preplanning/backlog-clusterer.ts", () => realClusterer);
}

describe("Mind pulse wires in the anti-stagnation parallelism provocation", () => {
  beforeEach(() => {
    setupVirtualMindFS();
  });

  afterEach(() => {
    cleanupVirtualMindFS();
  });

  function freshRepoRoot(label: string): string {
    const repo = scratchRoot("pulse-parallelism-wiring", label);
    fs.mkdirSync(join(repo, ".olt", "capsules"), { recursive: true });
    fs.mkdirSync(join(repo, "olt", "agents"), { recursive: true });
    fs.writeFileSync(join(repo, "olt", "agents", "mind.yaml"), MIN_MANIFEST_YAML);
    return repo;
  }

  it("surfaces a delivered provocation and appends it to the injection prompt when concurrency is low", () => {
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

    const repoRoot = freshRepoRoot("delivered");
    const result = MindAuditorEngine.auditMindPulse(repoRoot, {
      cursor: { lastInspectedTimestamp: "2026-08-25T00:00:00.000Z", lastInspectedEventIndex: 0 },
      now: "2026-08-25T00:00:01.000Z",
    });
    restoreMocks();

    expect(result.parallelismProvocation?.provocationDelivered).toBe(true);
    expect(result.parallelismProvocation?.worktreeOccupancy).toBe(1);
    expect(result.parallelismProvocation?.disjointClusterCount).toBe(2);
    expect(result.injectionPrompt).toContain("SOCRATIC PROVOCATION");
  });

  it("does not append a provocation when worktree concurrency is high", () => {
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

    const repoRoot = freshRepoRoot("not-delivered");
    const result = MindAuditorEngine.auditMindPulse(repoRoot, {
      cursor: { lastInspectedTimestamp: "2026-08-25T00:00:00.000Z", lastInspectedEventIndex: 0 },
      now: "2026-08-25T00:00:01.000Z",
    });
    restoreMocks();

    expect(result.parallelismProvocation?.provocationDelivered).toBe(false);
    expect(result.injectionPrompt ?? "").not.toContain("SOCRATIC PROVOCATION");
  });
});

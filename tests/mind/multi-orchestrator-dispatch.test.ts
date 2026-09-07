import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  assertDisjointClusters,
  partitionDisjointClusters,
  shardClusterByCapacity,
} from "../../olt/scripts/src/mind/preplanning/cluster-partitioner.ts";
import {
  dispatchMultiOrchestratorClusters,
  mapClustersToOrchestrators,
  triggerOrchestratorWorktreeProvisioning,
} from "../../olt/scripts/src/mind/preplanning/multi-orchestrator-dispatch.ts";
import { runPreplanningTick } from "../../olt/scripts/src/mind/preplanning/continuous-preplanner.ts";
import { runMindProductManagerLoop } from "../../olt/scripts/src/mind/lifecycle/orchestration/product-manager.ts";
import {
  createTestBacklogItem,
  createTestDefectItem,
  createTestThematicCluster,
} from "./multi-orchestrator-dispatch-fixtures.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("Multi-Orchestrator Worktree Topology & Dispatch Suite", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession;
  let testDir: string;
  let queuePath: string;
  let memoryPath: string;

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
    testDir = `/virtual/orch-dispatch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    vfs.mkdirSync(testDir, { recursive: true });
    vfs.mkdirSync(join(testDir, ".olt"), { recursive: true });
    vfs.chdir(testDir);
    queuePath = join(testDir, ".olt", "tasks.jsonl");
    memoryPath = join(testDir, ".olt", "memory.json");
  });

  afterEach(() => {
    session.cleanup();
  });

  describe("Disjoint Cluster Partitioning & Sharding", () => {
    it("partitions backlog and defects across multiple domains into disjoint clusters", () => {
      const items = [
        createTestBacklogItem("item-1", "reporting", "Generate telemetry report"),
        createTestBacklogItem("item-2", "engine", "Refactor transaction pipeline"),
        createTestBacklogItem("item-3", "reporting", "Doctor worktree health check"),
      ];
      const defects = [createTestDefectItem("defect-1", "engine", "Race condition in store lock")];

      const clusters = partitionDisjointClusters(items, defects, {
        rootDir: testDir,
        singleOrchestratorCapacity: 10,
      });

      expect(clusters.length).toBe(2);
      const domains = clusters.map((c) => c.domain).sort();
      expect(domains).toEqual(["engine", "reporting"]);
      expect(() => assertDisjointClusters(clusters)).not.toThrow();
    });

    it("shards clusters into sub-clusters when workload exceeds single orchestrator capacity", () => {
      const cluster = createTestThematicCluster(
        "cluster-core-101",
        "core",
        ["item-1", "item-2", "item-3", "item-4", "item-5", "item-6"],
        ["def-1", "def-2"],
      );

      const shards = shardClusterByCapacity(cluster, 3, "docs/planning");
      expect(shards.length).toBe(3);
      expect(shards[0]!.backlog_item_ids.length + shards[0]!.defect_ids.length).toBeLessThanOrEqual(
        3,
      );
      expect(shards[1]!.backlog_item_ids.length + shards[1]!.defect_ids.length).toBeLessThanOrEqual(
        3,
      );
      expect(shards[2]!.backlog_item_ids.length + shards[2]!.defect_ids.length).toBeLessThanOrEqual(
        3,
      );
      expect(shards[0]!.cluster_id).toBe("cluster-core-101-shard-1");
      expect(shards[1]!.cluster_id).toBe("cluster-core-101-shard-2");
      expect(shards[2]!.cluster_id).toBe("cluster-core-101-shard-3");
      expect(() => assertDisjointClusters(shards)).not.toThrow();
    });
  });

  describe("Automated Orchestrator Worktree Provisioning Trigger", () => {
    it("does not provision worktrees when cluster count is less than 2", () => {
      const singleCluster = [createTestThematicCluster("cluster-core-1", "core", ["item-1"], [])];
      const allocations = triggerOrchestratorWorktreeProvisioning(singleCluster, {
        rootDir: testDir,
      });
      expect(allocations.length).toBe(0);
    });

    it("provisions dedicated worktree allocations for each cluster when cluster count >= 2", () => {
      const clusters = [
        createTestThematicCluster("cluster-reporting-1", "reporting", ["item-1"], []),
        createTestThematicCluster("cluster-engine-1", "engine", ["item-2"], []),
      ];

      const allocations = triggerOrchestratorWorktreeProvisioning(clusters, {
        rootDir: testDir,
      });

      expect(allocations.length).toBe(2);
      expect(allocations[0]!.status).toBe("PROVISIONED");
      expect(allocations[0]!.worktree_path).toContain("orch-reporting-reporting-1");
      expect(allocations[1]!.status).toBe("PROVISIONED");
      expect(allocations[1]!.worktree_path).toContain("orch-engine-engine-1");
    });
  });

  describe("Multi-Orchestrator Dispatch Mapping", () => {
    it("maps clusters to dedicated Tier 1 Orchestrators with semantic role names", () => {
      const clusters = [
        createTestThematicCluster("cluster-reporting-1", "reporting", ["item-1"], []),
        createTestThematicCluster("cluster-mind-1", "mind", ["item-2"], []),
      ];

      const allocations = triggerOrchestratorWorktreeProvisioning(clusters, {
        rootDir: testDir,
      });
      const mappings = mapClustersToOrchestrators(clusters, allocations);

      expect(mappings.length).toBe(2);
      expect(mappings[0]!.role).toBe("orchestrator_reporting");
      expect(mappings[0]!.worktree_required).toBe(true);
      expect(mappings[0]!.worktree_allocation).toBeDefined();
      expect(mappings[1]!.role).toBe("orchestrator_mind");
      expect(mappings[1]!.worktree_required).toBe(true);
      expect(mappings[1]!.worktree_allocation).toBeDefined();
    });

    it("generates a complete multi-orchestrator dispatch plan with disjoint invariants", () => {
      const clusters = [
        createTestThematicCluster("cluster-validation-1", "validation", ["item-1"], []),
        createTestThematicCluster("cluster-core-1", "core", ["item-2"], []),
      ];

      const plan = dispatchMultiOrchestratorClusters(clusters, { rootDir: testDir });
      expect(plan.cluster_count).toBe(2);
      expect(plan.orchestrator_count).toBe(2);
      expect(plan.worktrees_provisioned).toBe(true);
      expect(plan.disjoint).toBe(true);
      expect(plan.allocations.length).toBe(2);
      expect(plan.dispatch_mappings.length).toBe(2);
    });
  });

  describe("Continuous Preplanner Integration", () => {
    it("runs preplanning tick with multi-domain backlog and populates dispatch plan", () => {
      const items = [
        createTestBacklogItem("item-a", "reporting", "Reporting metric aggregator"),
        createTestBacklogItem("item-b", "validation", "Validator rule checks"),
      ];

      const result = runPreplanningTick({
        rootDir: testDir,
        dryRun: true,
        explicitBacklog: items,
        explicitDefects: [],
      });

      expect(result.clusters.length).toBe(2);
      expect(result.multi_orchestrator_dispatch).toBeDefined();
      expect(result.multi_orchestrator_dispatch?.worktrees_provisioned).toBe(true);
      expect(result.orchestrator_worktrees?.length).toBe(2);
    });
  });

  describe("Product Manager Anti-Bottleneck & Decoupling Invariants", () => {
    it("enforces SINGLE_ORCHESTRATOR_BOTTLENECK_VIOLATION when cluster count >= 2 but orchestratorCount is 1", () => {
      expect(() => {
        runMindProductManagerLoop({
          repoRoot: testDir,
          queuePath,
          memoryPath,
          orchestratorCount: 1,
          maxProposals: 3,
        });
      }).toThrow(/SINGLE_ORCHESTRATOR_BOTTLENECK_VIOLATION/);
    });

    it("decouples task dependencies and stages multi-orchestrator execution when orchestratorCount > 1", () => {
      const result = runMindProductManagerLoop({
        repoRoot: testDir,
        queuePath,
        memoryPath,
        orchestratorCount: 2,
        maxProposals: 3,
      });

      expect(result.proposals.length).toBeGreaterThan(0);
      expect(result.synthesizedTasks.length).toBe(result.proposals.length);
      for (const task of result.synthesizedTasks) {
        expect(task.dependencies).toEqual([]);
      }
      expect(result.multiOrchestratorDispatch).toBeDefined();
    });
  });
});

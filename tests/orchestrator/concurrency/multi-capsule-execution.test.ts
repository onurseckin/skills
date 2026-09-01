import { describe, expect, it } from "bun:test";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  MultiCapsuleDAG,
  assertAntiSequentiality,
  formatMultiCapsuleSummary,
  hasScopeOverlap,
  validateAntiSequentiality,
  type CapsuleSpec,
  type MultiCapsuleSummary,
} from "../../../olt/scripts/src/orchestrator/multi-capsule.ts";

describe("Multi-Capsule DAG, Wave Partitioning & Anti-Sequentiality", () => {
  describe("1. MultiCapsuleDAG & Wave Partitioning", () => {
    it("partitions independent capsules into Wave 0 for pure concurrent dispatch", () => {
      const specs: CapsuleSpec[] = [
        { id: "cap-alpha", repoPath: "/repo", writeScope: ["src/alpha/"] },
        { id: "cap-beta", repoPath: "/repo", writeScope: ["src/beta/"] },
        { id: "cap-gamma", repoPath: "/repo", writeScope: ["src/gamma/"] },
      ];

      const dag = new MultiCapsuleDAG(specs);
      const waves = dag.computeParallelWaves();

      expect(waves.length).toBe(1);
      expect(waves[0]?.length).toBe(3);
      expect(dag.getCriticalPathLength()).toBe(1);
      expect(dag.getDependencies("cap-alpha")).toEqual([]);
      expect(dag.getDependents("cap-alpha")).toEqual([]);
    });

    it("partitions dependent capsules into topologically ordered waves", () => {
      const specs: CapsuleSpec[] = [
        { id: "cap-root", repoPath: "/repo", writeScope: ["src/root/"] },
        {
          id: "cap-child-1",
          repoPath: "/repo",
          writeScope: ["src/child1/"],
          dependencies: ["cap-root"],
        },
        {
          id: "cap-child-2",
          repoPath: "/repo",
          writeScope: ["src/child2/"],
          dependencies: ["cap-root"],
        },
        {
          id: "cap-grandchild",
          repoPath: "/repo",
          writeScope: ["src/grandchild/"],
          dependencies: ["cap-child-1", "cap-child-2"],
        },
      ];

      const dag = new MultiCapsuleDAG(specs);
      const waves = dag.computeParallelWaves();

      expect(waves.length).toBe(3);
      expect(waves[0]?.map((c) => c.id)).toEqual(["cap-root"]);
      expect(waves[1]?.map((c) => c.id).sort()).toEqual(["cap-child-1", "cap-child-2"]);
      expect(waves[2]?.map((c) => c.id)).toEqual(["cap-grandchild"]);
      expect(dag.getCriticalPathLength()).toBe(3);
      expect(dag.getDependencies("cap-grandchild").sort()).toEqual(["cap-child-1", "cap-child-2"]);
      expect(dag.getDependents("cap-root").sort()).toEqual(["cap-child-1", "cap-child-2"]);
    });

    it("throws HarnessError on duplicate capsule IDs", () => {
      const specs: CapsuleSpec[] = [
        { id: "cap-dup", repoPath: "/repo", writeScope: ["src/a/"] },
        { id: "cap-dup", repoPath: "/repo", writeScope: ["src/b/"] },
      ];

      expect(() => new MultiCapsuleDAG(specs)).toThrow(HarnessError);
      expect(() => new MultiCapsuleDAG(specs)).toThrow("Duplicate capsule id: cap-dup");
    });

    it("throws HarnessError on undeclared dependency reference", () => {
      const specs: CapsuleSpec[] = [
        {
          id: "cap-01",
          repoPath: "/repo",
          writeScope: ["src/a/"],
          dependencies: ["cap-nonexistent"],
        },
      ];

      expect(() => new MultiCapsuleDAG(specs)).toThrow(HarnessError);
      expect(() => new MultiCapsuleDAG(specs)).toThrow(
        "references undeclared dependency 'cap-nonexistent'",
      );
    });

    it("throws HarnessError on self dependency", () => {
      const specs: CapsuleSpec[] = [
        { id: "cap-01", repoPath: "/repo", writeScope: ["src/a/"], dependencies: ["cap-01"] },
      ];

      expect(() => new MultiCapsuleDAG(specs)).toThrow(HarnessError);
      expect(() => new MultiCapsuleDAG(specs)).toThrow("cannot depend on itself");
    });

    it("throws HarnessError on circular dependency cycle", () => {
      const specs: CapsuleSpec[] = [
        { id: "cap-a", repoPath: "/repo", writeScope: ["src/a/"], dependencies: ["cap-c"] },
        { id: "cap-b", repoPath: "/repo", writeScope: ["src/b/"], dependencies: ["cap-a"] },
        { id: "cap-c", repoPath: "/repo", writeScope: ["src/c/"], dependencies: ["cap-b"] },
      ];

      expect(() => new MultiCapsuleDAG(specs)).toThrow(HarnessError);
      expect(() => new MultiCapsuleDAG(specs)).toThrow("Circular dependency detected");
    });
  });

  describe("2. Anti-Sequentiality Engine & Violation Detection", () => {
    it("detects scope collision when parallel candidates share write scope without worktree isolation", () => {
      const specs: CapsuleSpec[] = [
        { id: "cap-1", repoPath: "/repo", writeScope: ["src/shared/feature.ts"] },
        { id: "cap-2", repoPath: "/repo", writeScope: ["src/shared/"] },
      ];

      const report = validateAntiSequentiality(specs, {
        allowScopeOverlapInIsolatedWorktrees: true,
      });
      expect(report.compliant).toBe(false);
      expect(report.violations.length).toBe(1);
      expect(report.violations[0]?.type).toBe("SCOPE_COLLISION_WITHOUT_WORKTREE_ISOLATION");
      expect(report.violations[0]?.capsuleIds).toEqual(["cap-1", "cap-2"]);
    });

    it("allows shared write scope when capsules declare distinct isolated worktrees", () => {
      const specs: CapsuleSpec[] = [
        {
          id: "cap-1",
          repoPath: "/repo",
          writeScope: ["src/shared/feature.ts"],
          worktreePath: "/worktrees/wt-1",
        },
        {
          id: "cap-2",
          repoPath: "/repo",
          writeScope: ["src/shared/feature.ts"],
          worktreePath: "/worktrees/wt-2",
        },
      ];

      const report = validateAntiSequentiality(specs, {
        allowScopeOverlapInIsolatedWorktrees: true,
      });
      expect(report.compliant).toBe(true);
      expect(report.violations.length).toBe(0);
    });

    it("detects artificial sequential bottlenecks from unjustified dependencies", () => {
      const specs: CapsuleSpec[] = [
        { id: "cap-independent-1", repoPath: "/repo", writeScope: ["src/lane-1/"] },
        {
          id: "cap-independent-2",
          repoPath: "/repo",
          writeScope: ["src/lane-2/"],
          dependencies: ["cap-independent-1"],
          metadata: { pure_parallel: true },
        },
      ];

      const report = validateAntiSequentiality(specs);
      expect(report.compliant).toBe(false);
      const unjustified = report.violations.find((v) => v.type === "UNJUSTIFIED_DEPENDENCY");
      expect(unjustified).toBeDefined();
      expect(unjustified?.capsuleIds).toEqual(["cap-independent-2", "cap-independent-1"]);
    });

    it("detects capacity starvation neglect when concurrency is throttled to 1 despite multiple parallel lanes", () => {
      const specs: CapsuleSpec[] = [
        { id: "cap-p1", repoPath: "/repo", writeScope: ["src/lane1/"] },
        { id: "cap-p2", repoPath: "/repo", writeScope: ["src/lane2/"] },
        { id: "cap-p3", repoPath: "/repo", writeScope: ["src/lane3/"] },
      ];

      const report = validateAntiSequentiality(specs, { maxParallelCapsules: 1 });
      expect(report.compliant).toBe(false);
      const starvation = report.violations.find((v) => v.type === "CAPACITY_STARVATION_NEGLECT");
      expect(starvation).toBeDefined();
      expect(starvation?.remedy).toContain("Increase maxParallelCapsules");
    });

    it("assertAntiSequentiality throws HarnessError on violations", () => {
      const specs: CapsuleSpec[] = [
        { id: "cap-1", repoPath: "/repo", writeScope: ["src/a.ts"] },
        { id: "cap-2", repoPath: "/repo", writeScope: ["src/a.ts"] },
      ];

      expect(() =>
        assertAntiSequentiality(specs, { allowScopeOverlapInIsolatedWorktrees: false }),
      ).toThrow(HarnessError);
    });

    it("correctly identifies scope overlap helper with prefixes and exact paths", () => {
      expect(hasScopeOverlap(["src/feature/"], ["src/feature/index.ts"])).toBe(true);
      expect(hasScopeOverlap(["src/feature/index.ts"], ["src/feature/"])).toBe(true);
      expect(hasScopeOverlap(["src/a.ts"], ["src/a.ts"])).toBe(true);
      expect(hasScopeOverlap(["src/a.ts"], ["src/b.ts"])).toBe(false);
      expect(hasScopeOverlap(["src/feature-a/"], ["src/feature-b/"])).toBe(false);
    });
  });

  describe("3. Markdown Summary & Formatting", () => {
    it("formats a comprehensive markdown report including violations and audit metrics", () => {
      const summary: MultiCapsuleSummary = {
        totalCapsules: 2,
        convergedCount: 1,
        failedCount: 1,
        blockedCount: 0,
        cancelledCount: 0,
        overallStatus: "partial",
        startedAt: "2026-08-22T14:00:00.000Z",
        completedAt: "2026-08-22T14:00:05.000Z",
        durationMs: 5000,
        concurrencyLimit: 4,
        independentWavesCount: 1,
        results: {
          "cap-1": {
            capsuleId: "cap-1",
            status: "converged",
            startedAt: "2026-08-22T14:00:00.000Z",
            completedAt: "2026-08-22T14:00:03.000Z",
            durationMs: 3000,
            gatePassed: true,
            summary: "Converged successfully",
          },
          "cap-2": {
            capsuleId: "cap-2",
            status: "failed",
            startedAt: "2026-08-22T14:00:00.000Z",
            completedAt: "2026-08-22T14:00:04.000Z",
            durationMs: 4000,
            gatePassed: false,
            error: "Syntax error in target module",
          },
        },
        antiSequentialityReport: {
          compliant: true,
          violations: [],
          parallelismRatio: 2.0,
          concurrencyFactor: 2,
          independentLanesCount: 2,
          criticalPathLength: 1,
          totalCapsules: 2,
          diagnostics: ["All lanes clean."],
        },
        markdownSummary: "",
      };

      const md = formatMultiCapsuleSummary(summary);
      expect(md).toContain("# Multi-Capsule Parallel Orchestration Summary");
      expect(md).toContain("🟡 PARTIAL");
      expect(md).toContain("`cap-1`");
      expect(md).toContain("`cap-2`");
      expect(md).toContain("✅ Pass");
      expect(md).toContain("❌ Fail");
      expect(md).toContain("2.00x");
    });
  });
});

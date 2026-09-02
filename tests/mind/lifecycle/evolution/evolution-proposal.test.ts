import { describe, expect, it } from "bun:test";
import {
  balanceOrchestratorLoad,
  synthesizeDynamicPlanRevisions,
} from "../../../../olt/scripts/src/mind/lifecycle/evolution/proposal.ts";
import type { OrchestratorNodeInfo } from "../../../../olt/scripts/src/mind/lifecycle/evolution/types.ts";

describe("Evolution Proposal Suite (proposal.ts)", () => {
  const makeOrch = (
    id: string,
    assignedTaskIds: string[] = [],
    assignedWriteScopes: string[] = ["src/default"],
  ): OrchestratorNodeInfo => ({
    id,
    role: "orchestrator",
    tier: 1,
    domainSlug: `domain-${id}`,
    assignedTaskIds,
    assignedWriteScopes,
    capacity: 10,
    currentLoad: assignedTaskIds.length,
    status: "ACTIVE",
  });

  describe("balanceOrchestratorLoad", () => {
    it("returns zeroed empty plan when orchestrator list is empty", () => {
      const plan = balanceOrchestratorLoad([], [{ id: "t1", write_scope: ["src/a"] }]);
      expect(plan.assignments).toEqual([]);
      expect(plan.isBalanced).toBe(true);
      expect(plan.loadVarianceBefore).toBe(0);
      expect(plan.loadVarianceAfter).toBe(0);
      expect(plan.scopeCollisionsAvoided).toBe(0);
    });

    it("preserves existing task assignments when tasks are already assigned", () => {
      const orchs = [makeOrch("o1", ["t1"], ["src/a"]), makeOrch("o2", ["t2"], ["src/b"])];
      const plan = balanceOrchestratorLoad(orchs, [
        { id: "t1", write_scope: ["src/a"] },
        { id: "t2", write_scope: ["src/b"] },
      ]);
      expect(plan.assignments.length).toBe(2);
      expect(plan.assignments[0]!.taskIds).toEqual(["t1"]);
      expect(plan.assignments[1]!.taskIds).toEqual(["t2"]);
      expect(plan.scopeCollisionsAvoided).toBe(0);
      expect(plan.isBalanced).toBe(true);
    });

    it("balances unassigned tasks by matching write scopes and avoiding collisions", () => {
      const orchs = [makeOrch("o1", ["t1"], ["src/core"]), makeOrch("o2", ["t2"], ["src/utils"])];
      const tasks = [
        { id: "t3", write_scope: ["src/core", "src/new-feature"] },
        { id: "t4", write_scope: ["src/utils"] },
      ];
      const plan = balanceOrchestratorLoad(orchs, tasks);
      const o1Ass = plan.assignments.find((a) => a.orchestratorId === "o1");
      const o2Ass = plan.assignments.find((a) => a.orchestratorId === "o2");

      expect(o1Ass?.taskIds).toContain("t3");
      expect(o1Ass?.writeScopes).toContain("src/new-feature");
      expect(o2Ass?.taskIds).toContain("t4");
      expect(plan.scopeCollisionsAvoided).toBe(2);
    });

    it("falls back to lowest load orchestrator when scope match reaches max capacity", () => {
      const orchs = [
        makeOrch("o1", ["t1", "t2"], ["src/shared"]),
        makeOrch("o2", [], ["src/other"]),
      ];
      // Set maxTasksPerOrchestrator to 2, so o1 is at maxCap
      const plan = balanceOrchestratorLoad(orchs, [{ id: "t3", write_scope: ["src/shared"] }], {
        maxTasksPerOrchestrator: 2,
      });
      const o2Ass = plan.assignments.find((a) => a.orchestratorId === "o2");
      expect(o2Ass?.taskIds).toContain("t3");
      expect(o2Ass?.writeScopes).toContain("src/shared");
    });

    it("distributes unassigned tasks to lowest load node when no scope matches", () => {
      const orchs = [makeOrch("o1", ["t1"], ["src/a"]), makeOrch("o2", [], ["src/b"])];
      const plan = balanceOrchestratorLoad(orchs, [{ id: "t2", write_scope: ["src/unrelated"] }]);
      const o2Ass = plan.assignments.find((a) => a.orchestratorId === "o2");
      expect(o2Ass?.taskIds).toContain("t2");
    });

    it("calculates high variance correctly when load is imbalanced", () => {
      const orchs = [
        makeOrch("o1", ["t1", "t2", "t3", "t4", "t5"], ["src/a"]),
        makeOrch("o2", [], ["src/b"]),
      ];
      const plan = balanceOrchestratorLoad(orchs, []);
      expect(plan.loadVarianceBefore).toBeGreaterThan(1.0);
      expect(plan.isBalanced).toBe(false);
    });
  });

  describe("synthesizeDynamicPlanRevisions", () => {
    it("handles empty parameters and returns empty revisions", () => {
      const res = synthesizeDynamicPlanRevisions({});
      expect(res.revisions).toEqual([]);
      expect(res.summary).toContain("Synthesized 0 dynamic plan revision proposal(s)");
    });

    it("maps all discovery categories and severities accurately", () => {
      const discoveries = [
        {
          category: "TEST_COVERAGE",
          severity: "CRITICAL",
          description: "Missing test for module X",
          file: "src/module-x.ts",
        },
        {
          category: "test_coverage",
          severity: "HIGH",
          description: "Low coverage on Y",
          targetFile: "src/module-y.ts",
        },
        {
          category: "COGNITIVE_GAP",
          severity: "MEDIUM",
          description: "Undocumented boundary",
        },
        {
          category: "cognitive_gap",
          severity: "LOW",
          description: "Ambiguous spec",
          file: "src/spec.ts",
        },
        {
          category: "DEFECT_REMEDIATION",
          severity: "CRITICAL",
          description: "Crash in worker loop",
          file: "src/worker.ts",
        },
        {
          category: "defect_remediation",
          description: "Memory leak",
          file: "src/leak.ts",
        },
        {
          category: "CODE_QUALITY",
          severity: "HIGH",
          description: "Cyclomatic complexity high",
          file: "src/complex.ts",
        },
        {
          category: "code_quality",
          description: "Dead code",
          file: "src/dead.ts",
        },
        {
          category: "CUSTOM_DISCOVERY",
          description: "Custom scan finding",
        },
      ];

      const res = synthesizeDynamicPlanRevisions({
        discoveries,
        actor: "mind-supervisor",
      });

      expect(res.revisions.length).toBeGreaterThan(0);
      expect(res.summary).toContain("Synthesized");
      expect(res.summary).toContain("from 9 evolutionary signal(s)");
    });

    it("combines existing signals with discovered signals", () => {
      const res = synthesizeDynamicPlanRevisions({
        signals: [
          {
            signalType: "TASK_STARVATION",
            source: "queue_monitor",
            severity: "HIGH",
            evidence: "Zero tasks for 5 minutes",
            affectedWriteScopes: ["tasks/"],
            charterGoalId: "goal-1",
          },
        ],
        discoveries: [
          {
            category: "TEST_COVERAGE",
            severity: "HIGH",
            description: "Gap in test suite",
            file: "tests/suite.test.ts",
          },
        ],
      });

      expect(res.summary).toContain("from 2 evolutionary signal(s)");
    });
  });
});

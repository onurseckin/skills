import { describe, expect, it } from "bun:test";
import { checkPlanningDag } from "../../olt/scripts/src/reporting/doctor/planning-dag-engine.ts";

describe("Planning DAG Integrity & Tier Hierarchy Invariant", () => {
  describe("EMPTY_GRAPH_DURING_ACTIVE_EXECUTION", () => {
    it("fails when nodes are empty and activeWorktreeCount > 0", () => {
      const res = checkPlanningDag({
        tasks: {},
        activeWorktreeCount: 2,
      });

      expect(res.passed).toBe(false);
      const finding = res.findings.find((f) => f.code === "EMPTY_GRAPH_DURING_ACTIVE_EXECUTION");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("ERROR");
      expect(finding?.message).toContain(
        "Planning DAG is empty (0 tasks) during active worktree/pulse execution",
      );
      expect(finding?.details?.activeWorktrees).toBe(2);
    });

    it("fails when nodes are empty and state has active_pulses", () => {
      const res = checkPlanningDag({
        tasks: {},
        state: { active_pulses: 3 },
      });

      expect(res.passed).toBe(false);
      const finding = res.findings.find((f) => f.code === "EMPTY_GRAPH_DURING_ACTIVE_EXECUTION");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("ERROR");
    });

    it("fails when nodes are empty and state has active execution phase", () => {
      const res = checkPlanningDag({
        tasks: null,
        graph: null,
        state: { phase: "executing_wave" },
      });

      expect(res.passed).toBe(false);
      expect(res.findings.some((f) => f.code === "EMPTY_GRAPH_DURING_ACTIVE_EXECUTION")).toBe(true);
    });

    it("passes when graph is empty and no active worktrees or pulses exist", () => {
      const res = checkPlanningDag({
        tasks: {},
        state: { phase: "idle", active_pulses: 0 },
        activeWorktreeCount: 0,
      });

      expect(res.passed).toBe(true);
      expect(res.findings.filter((f) => f.severity === "ERROR")).toHaveLength(0);
    });
  });

  describe("PLANNING_DAG_TIER_SKIP_VIOLATION (delta_tier <= 1)", () => {
    it("rejects edge skipping from Tier 0 directly to Tier 2 (delta = 2)", () => {
      const res = checkPlanningDag({
        graph: {
          nodes: [
            { id: "mind_task", tier: 0 },
            { id: "coord_task", tier: 2 },
          ],
          edges: [{ from: "mind_task", to: "coord_task" }],
        },
      });

      expect(res.passed).toBe(false);
      const finding = res.findings.find((f) => f.code === "PLANNING_DAG_TIER_SKIP_VIOLATION");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("ERROR");
      expect(finding?.message).toContain(
        'Tier-skip violation detected in planning DAG edge: "mind_task" (Tier 0) -> "coord_task" (Tier 2) exceeds delta_tier <= 1',
      );
      expect(finding?.details?.from).toBe("mind_task");
      expect(finding?.details?.to).toBe("coord_task");
      expect(finding?.details?.fromTier).toBe(0);
      expect(finding?.details?.toTier).toBe(2);
      expect(finding?.details?.delta).toBe(2);
    });

    it("rejects edge skipping from Tier 0 directly to Tier 3 (delta = 3)", () => {
      const res = checkPlanningDag({
        tasks: {
          task_mind: { id: "task_mind", role: "mind" },
          task_impl: {
            id: "task_impl",
            role: "implementer",
            dependencies: ["task_mind"],
          },
        },
      });

      expect(res.passed).toBe(false);
      const finding = res.findings.find((f) => f.code === "PLANNING_DAG_TIER_SKIP_VIOLATION");
      expect(finding).toBeDefined();
      expect(finding?.details?.delta).toBe(3);
    });

    it("rejects edge skipping from Tier 1 directly to Tier 3 (delta = 2)", () => {
      const res = checkPlanningDag({
        graph: {
          nodes: [
            { id: "orch_root", agentId: "orch_01" },
            { id: "val_step", agentId: "val_01" },
          ],
          edges: [{ from: "orch_root", to: "val_step" }],
        },
      });

      expect(res.passed).toBe(false);
      const finding = res.findings.find((f) => f.code === "PLANNING_DAG_TIER_SKIP_VIOLATION");
      expect(finding).toBeDefined();
      expect(finding?.details?.fromTier).toBe(1);
      expect(finding?.details?.toTier).toBe(3);
      expect(finding?.details?.delta).toBe(2);
    });

    it("allows valid hierarchy edges where delta_tier <= 1", () => {
      const res = checkPlanningDag({
        graph: {
          nodes: [
            { id: "node_t0", tier: 0 },
            { id: "node_t1", tier: 1 },
            { id: "node_t2", tier: 2 },
            { id: "node_t3", tier: 3 },
          ],
          edges: [
            { from: "node_t0", to: "node_t1" },
            { from: "node_t1", to: "node_t2" },
            { from: "node_t2", to: "node_t3" },
          ],
        },
      });

      expect(res.passed).toBe(true);
      expect(
        res.findings.filter((f) => f.code === "PLANNING_DAG_TIER_SKIP_VIOLATION"),
      ).toHaveLength(0);
    });

    it("allows intra-tier edges where delta_tier == 0", () => {
      const res = checkPlanningDag({
        graph: {
          nodes: [
            { id: "impl_step_1", role: "implementer" },
            { id: "impl_step_2", role: "implementer" },
          ],
          edges: [{ from: "impl_step_1", to: "impl_step_2" }],
        },
      });

      expect(res.passed).toBe(true);
      expect(
        res.findings.filter((f) => f.code === "PLANNING_DAG_TIER_SKIP_VIOLATION"),
      ).toHaveLength(0);
    });
  });
});

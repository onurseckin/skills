import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../../olt/scripts/src/testing/virtual-fs/index.ts";
import {
  compileRepairDag,
  evaluateRepairCycleConvergence,
  type ClosedLoopRepairPayload,
} from "../../../../olt/scripts/src/engine/scheduler/index.ts";
import type { TaskRecord } from "../../../../olt/scripts/src/workflow/types.ts";
import { workflowState } from "../../fixtures.ts";

describe("Critic Feedback: Repair DAG Compilation & Convergence", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession | null = null;

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
  });

  afterEach(() => {
    if (session) {
      session.cleanup();
      session = null;
    }
    vfs.reset();
  });

  describe("compileRepairDag", () => {
    test("calculates Work, Span, and parallelism metrics for parallel independent tasks with differing effort", () => {
      const state = workflowState();
      state.tasks["T-A"] = {
        id: "T-A",
        status: "changes_requested",
        requirement_ids: ["R-A"],
        write_scope: ["src/a.ts"],
        dependencies: [],
        attempts: [],
        history: [],
        repair_round: 1,
        effort: 2,
      } as unknown as TaskRecord;
      state.tasks["T-B"] = {
        id: "T-B",
        status: "changes_requested",
        requirement_ids: ["R-B"],
        write_scope: ["src/b.ts"],
        dependencies: [],
        attempts: [],
        history: [],
        repair_round: 1,
        effort: 5,
      } as unknown as TaskRecord;

      const payloads: ClosedLoopRepairPayload[] = [
        {
          taskId: "T-A",
          repairRound: 1,
          priorStatus: "done",
          newStatus: "changes_requested",
          binding: { implementerId: "w1", validatorId: "v1", isReplacementPair: false },
          writeScope: ["src/a.ts"],
          findings: [],
          counterfactualRequirements: [],
          revalidationGates: ["bun test tests/a.test.ts"],
          repairDirectives: "",
          isEscalated: false,
        },
        {
          taskId: "T-B",
          repairRound: 1,
          priorStatus: "done",
          newStatus: "changes_requested",
          binding: { implementerId: "w2", validatorId: "v2", isReplacementPair: false },
          writeScope: ["src/b.ts"],
          findings: [],
          counterfactualRequirements: [],
          revalidationGates: ["bun test tests/b.test.ts"],
          repairDirectives: "",
          isEscalated: false,
        },
      ];

      const dag = compileRepairDag(payloads, state, 1);
      expect(dag.totalWork).toBe(7);
      expect(dag.totalSpan).toBe(5);
      expect(dag.parallelismFactor).toBe(1.4);
      expect(dag.criticalPath).toEqual(["T-B"]);
      expect(dag.isAcyclic).toBeTrue();
    });

    test("sanitizes invalid task effort values (0, negative, non-integer) defaulting to 1", () => {
      const state = workflowState();
      state.tasks["T-ZERO"] = {
        id: "T-ZERO",
        status: "changes_requested",
        requirement_ids: ["R-0"],
        write_scope: ["src/zero.ts"],
        dependencies: [],
        attempts: [],
        history: [],
        repair_round: 1,
        effort: 0,
      } as unknown as TaskRecord;
      state.tasks["T-NEG"] = {
        id: "T-NEG",
        status: "changes_requested",
        requirement_ids: ["R-0"],
        write_scope: ["src/neg.ts"],
        dependencies: [],
        attempts: [],
        history: [],
        repair_round: 1,
        effort: -2,
      } as unknown as TaskRecord;

      const payloads: ClosedLoopRepairPayload[] = [
        {
          taskId: "T-ZERO",
          repairRound: 1,
          priorStatus: "done",
          newStatus: "changes_requested",
          binding: { implementerId: "w1", validatorId: "v1", isReplacementPair: false },
          writeScope: ["src/zero.ts"],
          findings: [],
          counterfactualRequirements: [],
          revalidationGates: [],
          repairDirectives: "",
          isEscalated: false,
        },
        {
          taskId: "T-NEG",
          repairRound: 1,
          priorStatus: "done",
          newStatus: "changes_requested",
          binding: { implementerId: "w2", validatorId: "v2", isReplacementPair: false },
          writeScope: ["src/neg.ts"],
          findings: [],
          counterfactualRequirements: [],
          revalidationGates: [],
          repairDirectives: "",
          isEscalated: false,
        },
      ];

      const dag = compileRepairDag(payloads, state, 1);
      expect(dag.totalWork).toBe(2);
      expect(dag.totalSpan).toBe(1);
    });
  });

  describe("evaluateRepairCycleConvergence", () => {
    test("evaluates convergence status accurately across all tasks in state", () => {
      const state = workflowState();
      state.tasks["T-1"]!.status = "changes_requested";
      state.tasks["T-1"]!.findings = [
        {
          id: "F-1",
          requirement_id: "R-1",
          severity: "critical",
          observation: "Defect",
          evidence: [],
          remediation: "Fix",
          revalidation: "",
          status: "open",
        },
      ];

      const status1 = evaluateRepairCycleConvergence(state);
      expect(status1.isConverged).toBeFalse();
      expect(status1.tasksInRepair).toEqual(["T-1"]);
      expect(status1.openFindingsCount).toBe(1);

      state.tasks["T-1"]!.status = "validated";
      state.tasks["T-1"]!.findings[0]!.status = "resolved";

      const status2 = evaluateRepairCycleConvergence(state);
      expect(status2.isConverged).toBeTrue();
      expect(status2.tasksInRepair).toEqual([]);
      expect(status2.openFindingsCount).toBe(0);
    });

    test("evaluates mixed task statuses accurately distinguishing running, escalated, and repair states", () => {
      const state = workflowState();
      state.tasks["T-RUN"] = {
        ...state.tasks["T-1"]!,
        id: "T-RUN",
        status: "running",
        findings: [],
      };
      state.tasks["T-ESC"] = {
        ...state.tasks["T-1"]!,
        id: "T-ESC",
        status: "escalated",
        findings: [],
      };
      state.tasks["T-REQ"] = {
        ...state.tasks["T-1"]!,
        id: "T-REQ",
        status: "changes_requested",
        findings: [],
      };
      state.tasks["T-VAL"] = {
        ...state.tasks["T-1"]!,
        id: "T-VAL",
        status: "validated",
        findings: [],
      };

      const report = evaluateRepairCycleConvergence(state);
      expect(report.isConverged).toBeFalse();
      expect(report.tasksInRepair).toContain("T-REQ");
      expect(report.escalatedTasks).toContain("T-ESC");
      expect(report.tasksInRepair).not.toContain("T-RUN");
      expect(report.tasksInRepair).not.toContain("T-VAL");
    });
  });
});

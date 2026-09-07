import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../../olt/scripts/src/testing/virtual-fs/index.ts";
import {
  compileRepairDag,
  routeCriticFeedback,
  type ClosedLoopRepairPayload,
} from "../../../../olt/scripts/src/engine/scheduler/index.ts";
import type { TaskRecord } from "../../../../olt/scripts/src/workflow/types.ts";
import { TestPort, workflowState } from "../../fixtures.ts";

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
    test("compiles repair payloads into a strictly sequenced DAG with Work/Span metrics", () => {
      const state = workflowState();
      state.tasks["T-1"] = {
        id: "T-1",
        status: "changes_requested",
        requirement_ids: ["R-1"],
        write_scope: ["src/owned"],
        dependencies: [],
        attempts: [],
        history: [],
        repair_round: 1,
        effort: 2,
      } as unknown as TaskRecord;

      const payloads: ClosedLoopRepairPayload[] = [
        {
          taskId: "T-1",
          repairRound: 1,
          priorStatus: "done",
          newStatus: "changes_requested",
          binding: {
            implementerId: "worker-replacement",
            validatorId: "val-independent",
            isReplacementPair: true,
          },
          writeScope: ["src/owned"],
          findings: [
            {
              id: "F-1",
              requirement_id: "R-1",
              severity: "critical",
              observation: "Buffer overflow on header parse",
              counterfactualRequirement: "Header buffer must truncate at 8KB",
              evidence: [],
              remediation: "Add boundary check",
              revalidation: "bun test tests/unit/header.test.ts",
              status: "open",
              affectedFilePaths: ["src/owned"],
            },
          ],
          counterfactualRequirements: ["Header buffer must truncate at 8KB"],
          revalidationGates: ["bun test tests/unit/header.test.ts"],
          repairDirectives: "Remediate buffer overflow",
          isEscalated: false,
        },
      ];

      const dag = compileRepairDag(payloads, state, 2);
      expect(dag.roundNumber).toBe(2);
      expect(dag.nodes.length).toBe(1);
      expect(dag.nodes[0]?.taskId).toBe("T-1");
      expect(dag.nodes[0]?.assignee).toBe("worker-replacement");
      expect(dag.nodes[0]?.revalidationCommand).toBe("bun test tests/unit/header.test.ts");
      expect(dag.isAcyclic).toBeTrue();
      expect(dag.totalWork).toBe(2);
      expect(dag.totalSpan).toBe(2);
      expect(dag.parallelismFactor).toBe(1);
      expect(dag.dominatingDirectives.length).toBeGreaterThanOrEqual(3);
    });

    test("handles dependency cycles in repair DAG gracefully by marking acyclic=false", () => {
      const state = workflowState();
      state.tasks["T-A"] = {
        id: "T-A",
        status: "changes_requested",
        requirement_ids: [],
        write_scope: [],
        dependencies: ["T-B"],
        attempts: [],
        history: [],
      } as unknown as TaskRecord;
      state.tasks["T-B"] = {
        id: "T-B",
        status: "changes_requested",
        requirement_ids: [],
        write_scope: [],
        dependencies: ["T-A"],
        attempts: [],
        history: [],
      } as unknown as TaskRecord;

      const payloads: ClosedLoopRepairPayload[] = [
        {
          taskId: "T-A",
          repairRound: 1,
          priorStatus: "done",
          newStatus: "changes_requested",
          binding: { implementerId: "w1", validatorId: "v1", isReplacementPair: false },
          writeScope: [],
          findings: [],
          counterfactualRequirements: [],
          revalidationGates: [],
          repairDirectives: "",
          isEscalated: false,
        },
        {
          taskId: "T-B",
          repairRound: 1,
          priorStatus: "done",
          newStatus: "changes_requested",
          binding: { implementerId: "w2", validatorId: "v2", isReplacementPair: false },
          writeScope: [],
          findings: [],
          counterfactualRequirements: [],
          revalidationGates: [],
          repairDirectives: "",
          isEscalated: false,
        },
      ];

      const dag = compileRepairDag(payloads, state, 1);
      expect(dag.isAcyclic).toBeFalse();
    });

    test("compileRepairDag computes critical path for multi-step dependent repair DAG", () => {
      const state = workflowState();
      state.tasks["T-1"] = {
        ...state.tasks["T-1"]!,
        id: "T-1",
        status: "changes_requested",
        requirement_ids: ["R-001"],
        write_scope: ["src/1.ts"],
        dependencies: [],
        effort: 2,
        findings: [],
      };
      state.tasks["T-2"] = {
        ...state.tasks["T-1"]!,
        id: "T-2",
        status: "changes_requested",
        requirement_ids: ["R-001"],
        write_scope: ["src/2.ts"],
        dependencies: ["T-1"],
        effort: 3,
        findings: [],
      };

      const rawFindings = [
        {
          id: "F-1",
          requirement_id: "R-001",
          role: "critic",
          category: "soundness",
          observation: "Issue across both tasks",
          affected_files: ["src/1.ts", "src/2.ts"],
          remediation: "Fix both",
          revalidation_command: "bun test",
          status: "open",
        },
      ];

      const port = new TestPort(state);
      const routed = routeCriticFeedback(port, { actor: "val-1", role: "validator" }, rawFindings);
      const dag = compileRepairDag(routed.payloads, port.read(), 2);
      expect(dag.isAcyclic).toBeTrue();
      expect(dag.totalSpan).toBeGreaterThanOrEqual(2);
      expect(dag.criticalPath.length).toBeGreaterThanOrEqual(1);
    });

    test("handles zero-payload empty DAG compilation safely with default metrics", () => {
      const state = workflowState();
      const dag = compileRepairDag([], state, 1);
      expect(dag.roundNumber).toBe(1);
      expect(dag.nodes).toEqual([]);
      expect(dag.totalWork).toBe(1);
      expect(dag.totalSpan).toBe(1);
      expect(dag.isAcyclic).toBeTrue();
      expect(dag.parallelismFactor).toBe(1);
      expect(dag.criticalPath).toEqual([]);
    });
  });
});

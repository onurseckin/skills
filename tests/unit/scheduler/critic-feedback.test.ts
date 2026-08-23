import { describe, expect, test } from "bun:test";
import {
  deriveCounterfactualRequirement,
  normalizeCriticFinding,
  selectImplementerValidatorPair,
  detectDeterministicRepeat,
  compileRepairDag,
  routeCriticFeedback,
  evaluateRepairCycleConvergence,
  type ClosedLoopRepairPayload,
  type CriticFindingDetail,
} from "../../../olt/scripts/src/engine/scheduler/index.ts";
import type { TaskRecord, WorkflowState } from "../../../olt/scripts/src/workflow/types.ts";
import { TestPort, repositoryBinding, workflowState } from "../workflow/test-port.ts";

describe("Recursive Critic Feedback & Dominating Skill Engine", () => {
  describe("deriveCounterfactualRequirement", () => {
    test("derives counterfactual requirement from observation and remediation", () => {
      const counterfactual = deriveCounterfactualRequirement(
        "Memory leak in worker pool on shutdown",
        "Call pool.drain() during SIGTERM handler",
      );
      expect(counterfactual).toContain("Counterfactual Requirement:");
      expect(counterfactual).toContain("Call pool.drain() during SIGTERM handler");
      expect(counterfactual).toContain("Memory leak in worker pool on shutdown");
    });

    test("preserves explicit counterfactual if already provided", () => {
      const explicit = "Invariant: Heap memory must not grow by >1MB after 1000 pool cycles.";
      const counterfactual = deriveCounterfactualRequirement("Memory leak", "Drain pool", explicit);
      expect(counterfactual).toBe(explicit);
    });
  });

  describe("normalizeCriticFinding", () => {
    test("normalizes raw critic finding object into strongly typed CriticFindingDetail", () => {
      const raw = {
        id: "F-AUTH-01",
        requirement_id: "REQ-AUTH",
        severity: "critical",
        observation: "JWT token validation allows expired tokens",
        remediation: "Verify exp claim strictly",
        revalidation: "bun test tests/unit/auth.test.ts",
        file_paths: ["src/auth/jwt.ts"],
      };

      const normalized = normalizeCriticFinding(raw);
      expect(normalized).not.toBeNull();
      expect(normalized?.id).toBe("F-AUTH-01");
      expect(normalized?.requirement_id).toBe("REQ-AUTH");
      expect(normalized?.severity).toBe("critical");
      expect(normalized?.counterfactualRequirement).toContain("Counterfactual Requirement:");
      expect(normalized?.revalidation).toBe("bun test tests/unit/auth.test.ts");
      expect(normalized?.affectedFilePaths).toEqual(["src/auth/jwt.ts"]);
      expect(normalized?.status).toBe("open");
    });

    test("returns null on invalid input", () => {
      expect(normalizeCriticFinding(null)).toBeNull();
      expect(normalizeCriticFinding("not-an-object")).toBeNull();
      expect(normalizeCriticFinding({})).toBeNull();
    });
  });

  describe("selectImplementerValidatorPair", () => {
    const dummyTask: TaskRecord = {
      id: "task-db",
      status: "running",
      original_implementer: "worker-alpha",
      repair_assignee: "worker-alpha",
      requirement_ids: ["REQ-DB"],
      write_scope: ["src/db.ts"],
      dependencies: [],
      attempts: [],
      history: [],
      repair_round: 0,
    };

    test("selects same author for initial round under same_author policy", () => {
      const pair = selectImplementerValidatorPair(dummyTask, 1, "same_author");
      expect(pair.implementerId).toBe("worker-alpha");
      expect(pair.isReplacementPair).toBeFalse();
      expect(pair.validatorId).not.toBe("worker-alpha");
    });

    test("binds replacement implementer and independent validator on subsequent repair rounds", () => {
      const pair = selectImplementerValidatorPair(
        dummyTask,
        2,
        "replacement_pair",
        ["worker-alpha", "worker-beta", "worker-gamma"],
        ["val-1", "val-2"],
      );
      expect(pair.isReplacementPair).toBeTrue();
      expect(pair.implementerId).toBe("worker-beta");
      expect(pair.validatorId).not.toBe(pair.implementerId);
      expect(pair.validatorId).not.toBe("worker-alpha");
    });
  });

  describe("detectDeterministicRepeat", () => {
    test("detects identical repeat findings across rounds", () => {
      const priorFindings = [
        {
          id: "F-01",
          requirement_id: "R-1",
          severity: "critical" as const,
          observation: "Race condition in queue drain",
          evidence: [],
          remediation: "Add lock",
          revalidation: "bun test",
          status: "open" as const,
        },
      ];

      const newFinding: CriticFindingDetail = {
        id: "F-01",
        requirement_id: "R-1",
        severity: "critical",
        observation: "Race condition in queue drain",
        counterfactualRequirement: "Lock must be held",
        evidence: [],
        remediation: "Add lock",
        revalidation: "bun test",
        status: "open",
        affectedFilePaths: [],
      };

      expect(detectDeterministicRepeat(priorFindings, newFinding)).toBeTrue();
    });

    test("returns false for novel findings", () => {
      const priorFindings = [
        {
          id: "F-01",
          requirement_id: "R-1",
          severity: "critical" as const,
          observation: "Race condition in queue drain",
          evidence: [],
          remediation: "Add lock",
          revalidation: "bun test",
          status: "open" as const,
        },
      ];

      const novelFinding: CriticFindingDetail = {
        id: "F-02",
        requirement_id: "R-2",
        severity: "minor",
        observation: "Typo in log message",
        counterfactualRequirement: "Log must match schema",
        evidence: [],
        remediation: "Fix spelling",
        revalidation: "bun test",
        status: "open",
        affectedFilePaths: [],
      };

      expect(detectDeterministicRepeat(priorFindings, novelFinding)).toBeFalse();
    });
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
  });

  describe("routeCriticFeedback", () => {
    test("returns converged when critic review is clean", () => {
      const state = workflowState();
      const port = new TestPort(state);

      const result = routeCriticFeedback(
        port,
        { actor: "critic-lead", role: "completeness-critic" },
        { status: "clean", findings: [] },
      );

      expect(result.isConverged).toBeTrue();
      expect(result.totalFindingsRouted).toBe(0);
      expect(result.totalTasksInRepair).toBe(0);
      expect(result.changesRequestedTaskIds).toEqual([]);
    });

    test("autonomously creates Round N+1 repair tasks with replacement binding and counterfactual requirements", () => {
      const state = workflowState();
      state.tasks["T-1"]!.original_implementer = "worker-1";
      state.tasks["T-1"]!.status = "done";
      state.tasks["T-1"]!.write_scope = ["src/auth.ts"];
      state.tasks["T-1"]!.repair_round = 0;

      const port = new TestPort(state);
      const result = routeCriticFeedback(
        port,
        { actor: "critic-lead", role: "completeness-critic" },
        {
          status: "findings",
          findings: [
            {
              id: "F-AUTH-01",
              requirement_id: "R-1",
              severity: "critical",
              observation: "Insecure password hash algorithm used",
              remediation: "Use Argon2id with 64MB memory cost",
              revalidation: "bun test tests/unit/auth.test.ts",
              file_paths: ["src/auth.ts"],
            },
          ],
        },
        {
          pairStrategy: "replacement_pair",
          availableImplementers: ["worker-1", "worker-repair-expert"],
          availableValidators: ["validator-auth"],
        },
      );

      expect(result.isConverged).toBeFalse();
      expect(result.roundNumber).toBe(1);
      expect(result.totalFindingsRouted).toBe(1);
      expect(result.totalTasksInRepair).toBe(1);
      expect(result.changesRequestedTaskIds).toEqual(["T-1"]);

      const payload = result.payloads[0]!;
      expect(payload.taskId).toBe("T-1");
      expect(payload.repairRound).toBe(1);
      expect(payload.newStatus).toBe("changes_requested");
      expect(payload.binding.implementerId).toBe("worker-repair-expert");
      expect(payload.binding.isReplacementPair).toBeTrue();
      expect(payload.counterfactualRequirements[0]).toContain("Use Argon2id with 64MB memory cost");
      expect(payload.revalidationGates).toContain("bun test tests/unit/auth.test.ts");
      expect(payload.repairDirectives).toContain("CLOSED-LOOP REPAIR DIRECTIVE");

      const updatedState = port.read();
      expect(updatedState.tasks["T-1"]?.status).toBe("changes_requested");
      expect(updatedState.tasks["T-1"]?.repair_round).toBe(1);
      expect(updatedState.tasks["T-1"]?.repair_assignee).toBe("worker-repair-expert");
    });

    test("escalates task when max repair rounds budget is exhausted", () => {
      const state = workflowState();
      state.tasks["T-1"]!.status = "changes_requested";
      state.tasks["T-1"]!.repair_round = 2; // will increment to 3 (max is 3)

      const port = new TestPort(state);
      const result = routeCriticFeedback(
        port,
        { actor: "val-1", role: "validator" },
        [
          {
            id: "F-NEW-01",
            requirement_id: "R-1",
            severity: "critical",
            observation: "Still failing boundary validation",
            remediation: "Enforce upper bound",
          },
        ],
        { maxRepairRounds: 3 },
      );

      expect(result.totalTasksEscalated).toBe(1);
      expect(result.escalatedTaskIds).toEqual(["T-1"]);
      expect(result.payloads[0]?.newStatus).toBe("escalated");
      expect(result.payloads[0]?.escalationReason).toContain("Repair rounds exhausted (3/3)");

      const updated = port.read();
      expect(updated.tasks["T-1"]?.status).toBe("escalated");
    });

    test("escalates task on deterministic defect repeat detection", () => {
      const state = workflowState();
      state.tasks["T-1"]!.status = "changes_requested";
      state.tasks["T-1"]!.repair_round = 1;
      state.tasks["T-1"]!.findings = [
        {
          id: "F-STUBBORN-01",
          requirement_id: "R-1",
          severity: "critical",
          observation: "Null pointer on empty input array",
          evidence: [],
          remediation: "Handle empty array case",
          revalidation: "bun test",
          status: "open",
        },
      ];

      const port = new TestPort(state);
      const result = routeCriticFeedback(
        port,
        { actor: "val-1", role: "validator" },
        [
          {
            id: "F-STUBBORN-01",
            requirement_id: "R-1",
            severity: "critical",
            observation: "Null pointer on empty input array",
            remediation: "Handle empty array case",
          },
        ],
        { maxRepairRounds: 5 },
      );

      expect(result.totalTasksEscalated).toBe(1);
      expect(result.escalatedTaskIds).toEqual(["T-1"]);
      expect(result.payloads[0]?.newStatus).toBe("escalated");
      expect(result.payloads[0]?.escalationReason).toContain("Deterministic defect repeated");
    });

    test("enforces hierarchical compliance and rejects unauthorized reviewer roles", () => {
      const state = workflowState();
      const port = new TestPort(state);

      expect(() =>
        routeCriticFeedback(
          port,
          { actor: "worker-1", role: "implementer" as unknown as "validator" },
          [{ id: "F-1", requirement_id: "R-1", observation: "Err" }],
        ),
      ).toThrow("Hierarchical decision tree violation");
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
  });
});

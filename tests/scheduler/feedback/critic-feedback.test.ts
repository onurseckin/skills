import { describe, expect, test } from "bun:test";
import { routeCriticFeedback } from "../../../olt/scripts/src/engine/scheduler/index.ts";
import type { TaskRecord } from "../../../olt/scripts/src/workflow/types.ts";
import { TestPort, workflowState } from "../fixtures.ts";

describe("Critic Feedback: Routing & Autonomous Remediation", () => {
  describe("routeCriticFeedback with requirement proofs and matching heuristics", () => {
    test("routes unproven requirement proofs as repair findings", () => {
      const state = workflowState();
      state.tasks["T-1"] = {
        id: "T-1",
        status: "done",
        requirement_ids: ["REQ-UNPROVEN"],
        write_scope: ["src/unproven.ts"],
        dependencies: [],
        attempts: [],
        history: [],
        repair_round: 0,
      } as unknown as TaskRecord;

      const port = new TestPort(state);
      const result = routeCriticFeedback(
        port,
        { actor: "critic-lead", role: "completeness-critic" },
        {
          status: "findings",
          findings: [],
          requirement_proofs: [
            {
              requirement_id: "REQ-UNPROVEN",
              status: "unproven",
              observation: "Proof missing for invariant",
              remediation: "Add property test proof",
            },
          ],
        },
      );

      expect(result.isConverged).toBeFalse();
      expect(result.totalFindingsRouted).toBe(1);
      expect(result.changesRequestedTaskIds).toContain("T-1");
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
      state.tasks["T-1"]!.repair_round = 2;

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

    test("routeCriticFeedback matches tasks by affectedFilePaths and write scope in observation", () => {
      const state = workflowState();
      state.tasks["T-PATH"] = {
        ...state.tasks["T-1"]!,
        id: "T-PATH",
        status: "ready",
        requirement_ids: ["R-OTHER"],
        write_scope: ["src/special/file.ts"],
        findings: [],
      };

      const findingsByPath = [
        {
          id: "F-PATH",
          requirement_id: "R-UNKNOWN",
          role: "critic",
          category: "soundness",
          observation: "Issue in src/special/file.ts",
          affected_files: ["src/special/file.ts"],
          remediation: "Fix",
          revalidation_command: "bun test",
          status: "open",
        },
      ];

      const port = new TestPort(state);
      const result = routeCriticFeedback(
        port,
        { actor: "val-1", role: "validator" },
        findingsByPath,
      );
      expect(result.payloads[0]?.taskId).toBe("T-PATH");
    });

    test("routeCriticFeedback falls back to done/validated/changes_requested tasks when no requirement or path matches", () => {
      const state = workflowState();
      state.tasks["T-FALLBACK"] = {
        ...state.tasks["T-1"]!,
        id: "T-FALLBACK",
        status: "done",
        requirement_ids: ["R-100"],
        write_scope: ["src/done.ts"],
        findings: [],
      };

      const unmappedFindings = [
        {
          id: "F-UNMAPPED",
          requirement_id: "R-TOTALLY-UNMAPPED",
          role: "critic",
          category: "soundness",
          observation: "General issue without file markers",
          affected_files: [],
          remediation: "Fix",
          revalidation_command: "bun test",
          status: "open",
        },
      ];

      const port = new TestPort(state);
      const result = routeCriticFeedback(
        port,
        { actor: "val-1", role: "validator" },
        unmappedFindings,
      );
      expect(result.payloads[0]?.taskId).toBe("T-FALLBACK");
    });
  });
});

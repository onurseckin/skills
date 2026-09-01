import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  assertAcyclicPushbackDelegation,
  assertNoBoundaryLeak,
  delegateRepairTask,
  detectGraphCycles,
  isBoundaryLeakViolation,
  isCodeMutationAction,
  isCriticOrValidatorAgent,
  isCriticOrValidatorRole,
  isSupervisorRole,
  validateAcyclicPushbackDelegation,
  validateBoundaryIntegrity,
  type BoundaryLeakCheck,
  type BoundaryViolation,
  type RepairDelegationOrder,
  type AntiLeakValidationResult,
} from "../../../olt/scripts/src/validation/anti-leak/index.ts";

describe("Anti-Boundary-Leak Rule & Automated Repair Delegation", () => {
  describe("4. Strict Invariant Assertion (assertNoBoundaryLeak)", () => {
    it("does not throw on compliant checks", () => {
      const compliantCheck: BoundaryLeakCheck = {
        agent_id: "implementer_1",
        role: "implementer",
        action: "task:claim",
        task_id: "task-100",
      };

      expect(() => {
        assertNoBoundaryLeak(compliantCheck);
      }).not.toThrow();
    });

    it("throws HarnessError with ROLE_CONFINEMENT_VIOLATION on boundary leaks", () => {
      const leakingCheck: BoundaryLeakCheck = {
        agent_id: "val-tester",
        role: "validator",
        action: "write_to_file",
        task_id: "task-leak",
        target_file: "src/leaked.ts",
      };

      expect(() => {
        assertNoBoundaryLeak(leakingCheck);
      }).toThrow(HarnessError);

      try {
        assertNoBoundaryLeak(leakingCheck);
      } catch (err: unknown) {
        expect(err instanceof HarnessError).toBe(true);
        const harnessErr = err as HarnessError;
        expect(harnessErr.code).toBe("ROLE_CONFINEMENT_VIOLATION");
        expect(harnessErr.message).toContain("Anti-boundary-leak rule violation");
        expect(harnessErr.issues.length).toBeGreaterThan(0);
        expect(harnessErr.fix).toBeDefined();
      }
    });
  });

  describe("5. Automated Repair Task Delegation (delegateRepairTask)", () => {
    it("generates a valid RepairDelegationOrder for isolated repair delegation", () => {
      const order: RepairDelegationOrder = delegateRepairTask({
        taskId: "task-p08-anti-leak",
        originalImplementer: "implementer_task-p08-anti-leak",
        validatorId: "validator_task-p08-anti-leak",
        findingIds: ["FINDING-001", "FINDING-002"],
        writeScope: [
          "olt/scripts/src/validation/anti-leak/index.ts",
          "tests/validation/anti-leak/anti-leak-detection.test.ts",
        ],
        reason: "finding_remediation",
        repairRound: 1,
      });

      expect(order.task_id).toBe("task-p08-anti-leak");
      expect(order.original_implementer).toBe("implementer_task-p08-anti-leak");
      expect(order.assigned_repairer).toBe("repairer-p08-anti-leak");
      expect(order.validator_id).toBe("validator_task-p08-anti-leak");
      expect(order.finding_ids).toEqual(["FINDING-001", "FINDING-002"]);
      expect(order.write_scope.length).toBe(2);
      expect(order.reason).toBe("finding_remediation");
      expect(order.repair_round).toBe(1);
      expect(order.command).toContain("task:claim");
      expect(order.command).toContain("--role repairer");
      expect(order.command).toContain("--agent repairer-p08-anti-leak");
      expect(order.generated_at).toBeDefined();
    });

    it("respects explicitly assigned repairers if distinct from validator", () => {
      const order = delegateRepairTask({
        taskId: "task-perf-01",
        originalImplementer: "impl-alice",
        assignedRepairer: "repairer-bob",
        validatorId: "val-carol",
        writeScope: ["src/perf.ts"],
        repairRound: 2,
        reason: "repeated_failure",
      });

      expect(order.assigned_repairer).toBe("repairer-bob");
      expect(order.repair_round).toBe(2);
      expect(order.reason).toBe("repeated_failure");
      expect(order.command).toContain("--agent repairer-bob");
    });

    it("rejects repair delegation when assigned repairer equals validatorId (anti-leak violation)", () => {
      expect(() => {
        delegateRepairTask({
          taskId: "task-defect-01",
          originalImplementer: "impl-alice",
          assignedRepairer: "val-carol",
          validatorId: "val-carol",
          writeScope: ["src/defect.ts"],
        });
      }).toThrow(HarnessError);

      try {
        delegateRepairTask({
          taskId: "task-defect-01",
          originalImplementer: "impl-alice",
          assignedRepairer: "val-carol",
          validatorId: "val-carol",
          writeScope: ["src/defect.ts"],
        });
      } catch (err: unknown) {
        const harnessErr = err as HarnessError;
        expect(harnessErr.code).toBe("ROLE_CONFINEMENT_VIOLATION");
        expect(harnessErr.message).toContain("cannot be the validator");
      }
    });

    it("rejects repair delegation when assigned repairer uses validator naming pattern", () => {
      expect(() => {
        delegateRepairTask({
          taskId: "task-defect-02",
          originalImplementer: "impl-alice",
          assignedRepairer: "val-repair-substitute",
          validatorId: "val-other",
          writeScope: ["src/defect.ts"],
        });
      }).toThrow(HarnessError);

      try {
        delegateRepairTask({
          taskId: "task-defect-02",
          originalImplementer: "impl-alice",
          assignedRepairer: "val-repair-substitute",
          validatorId: "val-other",
          writeScope: ["src/defect.ts"],
        });
      } catch (err: unknown) {
        const harnessErr = err as HarnessError;
        expect(harnessErr.code).toBe("ROLE_CONFINEMENT_VIOLATION");
        expect(harnessErr.message).toContain("matches critic/validator naming pattern");
      }
    });

    it("rejects missing or empty taskId, originalImplementer, or writeScope", () => {
      expect(() => {
        delegateRepairTask({
          taskId: "",
          originalImplementer: "impl-alice",
          writeScope: ["src/file.ts"],
        });
      }).toThrow("taskId must be a non-empty string");

      expect(() => {
        delegateRepairTask({
          taskId: "task-1",
          originalImplementer: "",
          writeScope: ["src/file.ts"],
        });
      }).toThrow("originalImplementer must be a non-empty string");

      expect(() => {
        delegateRepairTask({
          taskId: "task-1",
          originalImplementer: "impl-alice",
          writeScope: [],
        });
      }).toThrow("writeScope must contain at least one target path");
    });
  });
});

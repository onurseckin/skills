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
  describe("1. Role and Action Classification Helpers", () => {
    it("correctly identifies critic and validator roles", () => {
      expect(isCriticOrValidatorRole("validator")).toBe(true);
      expect(isCriticOrValidatorRole("completeness-critic")).toBe(true);
      expect(isCriticOrValidatorRole("critic")).toBe(true);
      expect(isCriticOrValidatorRole("sub-validator")).toBe(true);
      expect(isCriticOrValidatorRole("plan-validator")).toBe(true);
      expect(isCriticOrValidatorRole("validator-quality")).toBe(true);
      expect(isCriticOrValidatorRole("security-critic")).toBe(true);

      expect(isCriticOrValidatorRole("implementer")).toBe(false);
      expect(isCriticOrValidatorRole("repairer")).toBe(false);
      expect(isCriticOrValidatorRole("coordinator")).toBe(false);
      expect(isCriticOrValidatorRole("orchestrator")).toBe(false);
    });

    it("correctly identifies critic and validator agent naming conventions", () => {
      expect(isCriticOrValidatorAgent("val-task-123")).toBe(true);
      expect(isCriticOrValidatorAgent("validator-quality")).toBe(true);
      expect(isCriticOrValidatorAgent("validator_task-p08")).toBe(true);
      expect(isCriticOrValidatorAgent("critic-completeness")).toBe(true);
      expect(isCriticOrValidatorAgent("critic_assessment")).toBe(true);

      expect(isCriticOrValidatorAgent("implementer_task-p08")).toBe(false);
      expect(isCriticOrValidatorAgent("repairer-task-p08")).toBe(false);
      expect(isCriticOrValidatorAgent("coord-main")).toBe(false);
    });

    it("correctly identifies supervisory roles (Tiers 0, 1, 2)", () => {
      expect(isSupervisorRole("mind")).toBe(true);
      expect(isSupervisorRole("orchestrator")).toBe(true);
      expect(isSupervisorRole("coordinator")).toBe(true);
      expect(isSupervisorRole("architect")).toBe(true);
      expect(isSupervisorRole("planner")).toBe(true);
      expect(isSupervisorRole("supervisor")).toBe(true);
      expect(isSupervisorRole("mind-cadence")).toBe(true);
      expect(isSupervisorRole("coord-execution")).toBe(true);
      expect(isSupervisorRole("orch-eval")).toBe(true);

      expect(isSupervisorRole("implementer")).toBe(false);
      expect(isSupervisorRole("repairer")).toBe(false);
      expect(isSupervisorRole("validator")).toBe(false);
    });

    it("correctly identifies code mutation actions", () => {
      expect(isCodeMutationAction("write_to_file")).toBe(true);
      expect(isCodeMutationAction("replace_file_content")).toBe(true);
      expect(isCodeMutationAction("edit_file")).toBe(true);
      expect(isCodeMutationAction("apply_diff")).toBe(true);
      expect(isCodeMutationAction("patch")).toBe(true);
      expect(isCodeMutationAction("create_file")).toBe(true);
      expect(isCodeMutationAction("delete_file")).toBe(true);

      expect(isCodeMutationAction("run:exec")).toBe(false);
      expect(isCodeMutationAction("task:review")).toBe(false);
      expect(isCodeMutationAction("task:probe")).toBe(false);
      expect(isCodeMutationAction("task:reject")).toBe(false);
    });
  });

  describe("2. Boundary Leak Detection (isBoundaryLeakViolation)", () => {
    it("flags critics and validators attempting task:claim", () => {
      const valClaimCheck: BoundaryLeakCheck = {
        agent_id: "val-quality-1",
        role: "validator",
        action: "task:claim",
        task_id: "task-auth-jwt",
        write_scope: ["src/auth/jwt.ts"],
      };
      expect(isBoundaryLeakViolation(valClaimCheck)).toBe(true);

      const criticClaimCheck: BoundaryLeakCheck = {
        agent_id: "critic-completeness",
        role: "completeness-critic",
        action: "claim",
        task_id: "task-auth-jwt",
      };
      expect(isBoundaryLeakViolation(criticClaimCheck)).toBe(true);
    });

    it("flags critics and validators attempting code edits", () => {
      const valEditCheck: BoundaryLeakCheck = {
        agent_id: "validator-1",
        role: "validator",
        action: "write_to_file",
        task_id: "task-core",
        target_file: "src/core/engine.ts",
      };
      expect(isBoundaryLeakViolation(valEditCheck)).toBe(true);

      const criticPatchCheck: BoundaryLeakCheck = {
        agent_id: "critic-agent",
        role: "critic",
        action: "replace_file_content",
        target_file: "src/api/handler.ts",
      };
      expect(isBoundaryLeakViolation(criticPatchCheck)).toBe(true);
    });

    it("flags supervisors attempting code mutation or claiming task write leases", () => {
      const coordClaimCheck: BoundaryLeakCheck = {
        agent_id: "coord-root",
        role: "coordinator",
        action: "task:claim",
        task_id: "task-perf-01",
        write_scope: ["src/perf.ts"],
      };
      expect(isBoundaryLeakViolation(coordClaimCheck)).toBe(true);

      const orchEditCheck: BoundaryLeakCheck = {
        agent_id: "orch-leader",
        role: "orchestrator",
        action: "edit_file",
        target_file: "src/main.ts",
      };
      expect(isBoundaryLeakViolation(orchEditCheck)).toBe(true);
    });

    it("flags self-repair assignments where validator is assigned as repairer", () => {
      const selfRepairCheck: BoundaryLeakCheck = {
        agent_id: "val-tester-1",
        role: "validator",
        action: "task:assign-repairer",
        task_id: "task-repair-1",
        metadata: {
          validator_id: "val-tester-1",
          assigned_repairer: "val-tester-1",
        },
      };
      expect(isBoundaryLeakViolation(selfRepairCheck)).toBe(true);
    });

    it("allows valid implementer and repairer actions", () => {
      const validClaim: BoundaryLeakCheck = {
        agent_id: "implementer_task-auth",
        role: "implementer",
        action: "task:claim",
        task_id: "task-auth",
        write_scope: ["src/auth/jwt.ts", "tests/jwt/jwt.test.ts"],
      };
      expect(isBoundaryLeakViolation(validClaim)).toBe(false);

      const validRepairerEdit: BoundaryLeakCheck = {
        agent_id: "repairer-task-auth",
        role: "repairer",
        action: "replace_file_content",
        task_id: "task-auth",
        target_file: "src/auth/jwt.ts",
      };
      expect(isBoundaryLeakViolation(validRepairerEdit)).toBe(false);
    });
  });

  describe("3. Boundary Integrity Validation (validateBoundaryIntegrity)", () => {
    it("returns compliant result when no boundary leaks exist", () => {
      const checks: readonly BoundaryLeakCheck[] = [
        {
          agent_id: "implementer_task-1",
          role: "implementer",
          action: "task:claim",
          task_id: "task-1",
          write_scope: ["src/feature.ts"],
        },
        {
          agent_id: "repairer_task-2",
          role: "repairer",
          action: "write_to_file",
          task_id: "task-2",
          target_file: "src/fix.ts",
        },
        {
          agent_id: "val-reviewer",
          role: "validator",
          action: "task:review",
          task_id: "task-1",
        },
      ];

      const result: AntiLeakValidationResult = validateBoundaryIntegrity(checks);
      expect(result.compliant).toBe(true);
      expect(result.valid).toBe(true);
      expect(result.violations.length).toBe(0);
      expect(result.summary).toContain("passed: 0 violations");
    });

    it("captures detailed violations when boundary leaks are detected", () => {
      const checks: readonly BoundaryLeakCheck[] = [
        {
          agent_id: "val-reviewer",
          role: "validator",
          action: "task:claim",
          task_id: "task-code-edit",
          write_scope: ["src/parser.ts"],
        },
        {
          agent_id: "critic-sec",
          role: "completeness-critic",
          action: "replace_file_content",
          task_id: "task-code-edit",
          target_file: "src/parser.ts",
        },
        {
          agent_id: "coordinator-alpha",
          role: "coordinator",
          action: "write_to_file",
          task_id: "task-sup",
          target_file: "src/sup.ts",
        },
        {
          agent_id: "val-audit",
          role: "validator",
          action: "task:assign-repairer",
          task_id: "task-remedy",
          metadata: {
            validator_id: "val-audit",
            assigned_repairer: "val-audit",
          },
        },
      ];

      const result: AntiLeakValidationResult = validateBoundaryIntegrity(checks);
      expect(result.compliant).toBe(false);
      expect(result.valid).toBe(false);
      expect(result.violations.length).toBe(4);

      const types = result.violations.map((v: BoundaryViolation) => v.violation_type);
      expect(types).toContain("validator_write_lease");
      expect(types).toContain("critic_code_edit");
      expect(types).toContain("supervisor_code_contamination");
      expect(types).toContain("self_repair_violation");

      for (const violation of result.violations) {
        expect(violation.severity).toBe("critical");
        expect(violation.observation.length).toBeGreaterThan(0);
        expect(violation.remediation.length).toBeGreaterThan(0);
        expect(violation.evidence).toBeDefined();
      }
    });

    it("accepts a single BoundaryLeakCheck object as input", () => {
      const singleCheck: BoundaryLeakCheck = {
        agent_id: "val-single",
        role: "validator",
        action: "task:claim",
        task_id: "task-single",
      };

      const result = validateBoundaryIntegrity(singleCheck);
      expect(result.compliant).toBe(false);
      expect(result.violations.length).toBe(1);
    });
  });
});

import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { HarnessError } from "../../../olt/scripts/src/errors/harness-error.ts";
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
} from "../../../olt/scripts/src/validation/anti-leak.ts";

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
        write_scope: ["src/auth/jwt.ts", "tests/unit/jwt.test.ts"],
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
          "olt/scripts/src/validation/anti-leak.ts",
          "tests/unit/validation/anti-leak.test.ts",
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

  describe("7. Acyclic Pushback Delegation & Structured Remediation Enforcement", () => {
    it("detects cycles in dependency graphs", () => {
      const acyclicGraph = {
        "task-1": ["task-2"],
        "task-2": ["task-3"],
        "task-3": [],
      };
      expect(detectGraphCycles(acyclicGraph).hasCycle).toBe(false);

      const cyclicGraph = {
        "task-1": ["task-2"],
        "task-2": ["task-3"],
        "task-3": ["task-1"],
      };
      const cycleResult = detectGraphCycles(cyclicGraph);
      expect(cycleResult.hasCycle).toBe(true);
      expect(cycleResult.cyclePath).toBeDefined();
    });

    it("rejects pushback with empty observation or remediation", () => {
      const emptyObservation = validateAcyclicPushbackDelegation({
        taskId: "task-1",
        validatorId: "val-1",
        observation: "",
        remediation: "Fix the defect",
      });
      expect(emptyObservation.valid).toBe(false);
      expect(emptyObservation.structured).toBe(false);

      const emptyRemediation = validateAcyclicPushbackDelegation({
        taskId: "task-1",
        validatorId: "val-1",
        observation: "Defect observed",
        remediation: "",
      });
      expect(emptyRemediation.valid).toBe(false);
      expect(emptyRemediation.structured).toBe(false);
    });

    it("rejects circular delegation where assigned repairer matches rejecting validator", () => {
      const circular = validateAcyclicPushbackDelegation({
        taskId: "task-1",
        validatorId: "val-quality-1",
        assignedRepairer: "val-quality-1",
        observation: "Defect found",
        remediation: "Fix defect in auth module",
      });
      expect(circular.valid).toBe(false);
      expect(circular.acyclic).toBe(false);
      expect(circular.violations.some((v) => v.includes("Circular delegation violation"))).toBe(
        true,
      );

      expect(() => {
        assertAcyclicPushbackDelegation({
          taskId: "task-1",
          validatorId: "val-quality-1",
          assignedRepairer: "val-quality-1",
          observation: "Defect found",
          remediation: "Fix defect in auth module",
        });
      }).toThrow("Acyclic pushback delegation failure");
    });

    it("rejects repairer matching validator naming pattern", () => {
      const valRepairer = validateAcyclicPushbackDelegation({
        taskId: "task-1",
        validatorId: "val-quality-1",
        assignedRepairer: "validator_task-1-repair",
        observation: "Defect found",
        remediation: "Fix defect",
      });
      expect(valRepairer.valid).toBe(false);
      expect(valRepairer.acyclic).toBe(false);
    });

    it("rejects pushback creating cyclic dependency graph", () => {
      const cyclic = validateAcyclicPushbackDelegation({
        taskId: "task-1",
        validatorId: "val-1",
        assignedRepairer: "repairer-task-1",
        observation: "Defect observed",
        remediation: "Fix the defect",
        dependencyGraph: {
          "task-1": ["task-2"],
          "task-2": ["task-1"],
        },
      });
      expect(cyclic.valid).toBe(false);
      expect(cyclic.acyclic).toBe(false);
      expect(cyclic.violations.some((v) => v.includes("Circular DAG dependency detected"))).toBe(
        true,
      );
    });

    it("accepts valid structured acyclic pushback delegation", () => {
      const valid = validateAcyclicPushbackDelegation({
        taskId: "task-1",
        validatorId: "val-quality-1",
        assignedRepairer: "repairer-task-1",
        observation: "Null pointer on empty input in parseToken",
        remediation: "Add null check before accessing token.length",
        findings: [
          {
            id: "F-AUTH-001",
            requirement_id: "REQ-AUTH",
            severity: "critical",
            observation: "Null pointer on empty input",
            evidence: [{ path: "test.log" }],
            remediation: "Add null check",
            revalidation: "Run unit tests",
          },
        ],
        dependencyGraph: {
          "task-1": ["task-2"],
          "task-2": [],
        },
      });
      expect(valid.valid).toBe(true);
      expect(valid.acyclic).toBe(true);
      expect(valid.structured).toBe(true);
      expect(valid.violations.length).toBe(0);

      expect(() => {
        assertAcyclicPushbackDelegation({
          taskId: "task-1",
          validatorId: "val-quality-1",
          assignedRepairer: "repairer-task-1",
          observation: "Null pointer on empty input in parseToken",
          remediation: "Add null check before accessing token.length",
        });
      }).not.toThrow();
    });
  });

  describe("8. Static Invariant Verification: Zero TypeScript any & Zero Suppressions", () => {
    it("verifies zero TypeScript any and zero suppressions across anti-leak source and test files", () => {
      const filesToAudit = [
        "/Users/onurseckinsenoglu/repos/skills/olt/scripts/src/validation/anti-leak.ts",
        "/Users/onurseckinsenoglu/repos/skills/tests/unit/validation/anti-leak.test.ts",
      ];

      const anyPattern = new RegExp(":\\s*any\\b|as\\s+any\\b|<any>");
      const suppressionPattern = new RegExp(
        [
          "@ts" + "-ignore",
          "@ts" + "-expect-error",
          "@ts" + "-nocheck",
          "eslint" + "-disable",
          "oxlint" + "-disable",
        ].join("|"),
      );

      for (const filePath of filesToAudit) {
        expect(existsSync(filePath)).toBe(true);
        const content = readFileSync(filePath, "utf-8");
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (line.includes("anyPattern") || line.includes("suppressionPattern")) continue;

          expect(anyPattern.test(line)).toBe(false);
          expect(suppressionPattern.test(line)).toBe(false);
        }
      }
    });
  });
});

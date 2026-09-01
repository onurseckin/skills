import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
        join(process.cwd(), "olt/scripts/src/validation/anti-leak/types.ts"),
        join(process.cwd(), "olt/scripts/src/validation/anti-leak/checks.ts"),
        join(process.cwd(), "olt/scripts/src/validation/anti-leak/validator.ts"),
        join(process.cwd(), "olt/scripts/src/validation/anti-leak/delegator.ts"),
        join(process.cwd(), "olt/scripts/src/validation/anti-leak/index.ts"),
        join(process.cwd(), "tests/validation/anti-leak/anti-leak-detection.test.ts"),
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

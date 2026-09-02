import { describe, expect, it } from "bun:test";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  mutateRoleWithFeedback,
  synthesizeRoleFromDefectRemediation,
  synthesizeRoleFromTaskRequirements,
} from "../../../olt/scripts/src/mind/roles/dynamic/mutator.ts";

describe("Dynamic Role Mutator & Synthesizer Coverage", () => {
  describe("synthesizeRoleFromTaskRequirements", () => {
    it("synthesizes implementer and validator roles with custom domain and standard task", () => {
      const plan = synthesizeRoleFromTaskRequirements({
        taskId: "task.101/feature",
        taskTitle: "Add payment webhook",
        writeScope: ["src/payments/webhook.ts", "src/payments/types.ts"],
        gate: "bun test tests/payments/",
        domain: "security",
        candidateId: "cand-99",
        feedbackId: "fb-12",
      });

      expect(plan.taskId).toBe("task.101/feature");
      expect(plan.antiBatchingCompliant).toBe(true);
      expect(plan.antiBoundaryLeakGuaranteed).toBe(true);
      expect(plan.validationSummary).toContain("task.101/feature");

      // Implementer contract
      const impl = plan.implementerRole;
      expect(impl.role).toBe("implementer-security-task-101-feature");
      expect(impl.tier).toBe(3);
      expect(impl.spec.archetype).toBe("tier_3_implementer");
      expect(impl.domain).toBe("security");
      expect(impl.title).toBe("Specialized Implementer for Task task.101/feature");
      expect(impl.summary).toContain("Add payment webhook");
      expect(impl.writeScopePolicy).toBe("lease_bounded");
      expect(impl.may.some((m) => m.includes("src/payments/webhook.ts"))).toBe(true);
      expect(impl.must_not.some((p) => p.includes("outside leased write scope"))).toBe(true);
      expect(impl.cognitivePillars.some((p) => p.includes("Zero-Any"))).toBe(true);
      expect(impl.spec.metadata?.candidateId).toBe("cand-99");
      expect(impl.spec.metadata?.feedbackId).toBe("fb-12");

      // Validator contract
      const val = plan.validatorRole;
      expect(val.role).toBe("validator-security-task-101-feature");
      expect(val.tier).toBe(3);
      expect(val.spec.archetype).toBe("tier_3_validator");
      expect(val.writeScopePolicy).toBe("forbidden");
      expect(val.may.some((m) => m.includes("bun test tests/payments/"))).toBe(true);
      expect(val.must_not.some((p) => p.includes("Anti-Boundary-Leak"))).toBe(true);
      expect(val.spec.metadata?.validatedImplementer).toBe("implementer-security-task-101-feature");
    });

    it("synthesizes repairer role when requiresRepair is true and defaults domain to general", () => {
      const plan = synthesizeRoleFromTaskRequirements({
        taskId: "task-repair-202",
        taskTitle: "Fix race condition in store",
        writeScope: ["src/store.ts"],
        gate: "bun test tests/store.test.ts",
        requiresRepair: true,
      });

      expect(plan.implementerRole.role).toBe("repairer-task-repair-202");
      expect(plan.implementerRole.spec.archetype).toBe("tier_3_repairer");
      expect(plan.implementerRole.domain).toBe("general");
      expect(plan.implementerRole.title).toBe("Specialized Repairer for Task task-repair-202");
      expect(plan.validatorRole.role).toBe("validator-general-task-repair-202");
    });
  });

  describe("synthesizeRoleFromDefectRemediation", () => {
    it("synthesizes defect remediation role with custom invariants", () => {
      const role = synthesizeRoleFromDefectRemediation({
        defectId: "DEF-882.patch",
        defectType: "memory_leak",
        rootCause: "unbounded timer registry",
        affectedScope: ["src/timers/registry.ts"],
        correctiveAction: "clear handles on unmount",
        requiredInvariants: ["Registry size must stay <= 100"],
      });

      expect(role.role).toBe("remediator-defect-def-882-patch");
      expect(role.tier).toBe(3);
      expect(role.spec.archetype).toBe("tier_3_repairer");
      expect(role.domain).toBe("defect-investigation");
      expect(role.title).toBe("Defect Remediation Specialist: DEF-882.patch");
      expect(role.summary).toContain("DEF-882.patch");
      expect(role.writeScopePolicy).toBe("lease_bounded");
      expect(role.spec.invariants).toContain("Remediation Target: DEF-882.patch");
      expect(role.spec.invariants).toContain("Action: clear handles on unmount");
      expect(role.spec.invariants).toContain("Registry size must stay <= 100");
      expect(role.cognitivePillars.some((p) => p.includes("memory_leak"))).toBe(true);
      expect(role.cognitivePillars.some((p) => p.includes("unbounded timer registry"))).toBe(true);
      expect(role.spec.metadata?.defectId).toBe("DEF-882.patch");
      expect(role.spec.metadata?.defectType).toBe("memory_leak");
      expect(role.markdown).toContain("Defect Remediation Specialist: DEF-882.patch");
      expect(role.sha256).toBeTruthy();
    });

    it("synthesizes defect remediation role when requiredInvariants is omitted", () => {
      const role = synthesizeRoleFromDefectRemediation({
        defectId: "DEF-900",
        defectType: "syntax_error",
        rootCause: "missing parenthesis",
        affectedScope: ["src/parser.ts"],
        correctiveAction: "add closing parenthesis",
      });

      expect(role.role).toBe("remediator-defect-def-900");
      expect(role.spec.invariants.length).toBe(2);
    });
  });

  describe("mutateRoleWithFeedback", () => {
    it("mutates role with comprehensive feedback and updates lineage and version", () => {
      const initialRole = synthesizeRoleFromDefectRemediation({
        defectId: "DEF-300",
        defectType: "null_pointer",
        rootCause: "missing null check",
        affectedScope: ["src/utils.ts"],
        correctiveAction: "add optional chaining",
      });

      const mutated = mutateRoleWithFeedback(initialRole, {
        mutationReason: "Harden validation after secondary defect findings",
        newInvariants: ["Ensure null check handles undefined as well"],
        newPillars: ["Zero suppression policy"],
        additionalCommands: ["task:retry"],
        removedCommands: ["task:heartbeat"],
        additionalProhibitions: ["Do not use loose equality =="],
        metadataUpdate: { auditRunId: "audit-100" },
      });

      expect(mutated.spec.version).toBe(2);
      expect(mutated.spec.parentRole).toBe(initialRole.role);
      expect(mutated.spec.invariants).toContain("Ensure null check handles undefined as well");
      expect(mutated.cognitivePillars).toContain("Zero suppression policy");
      expect(mutated.commands).toContain("task:retry");
      expect(mutated.commands).not.toContain("task:heartbeat");
      expect(mutated.must_not).toContain("Do not use loose equality ==");
      expect(mutated.spec.metadata?.auditRunId).toBe("audit-100");
      expect(mutated.spec.metadata?.lastMutationReason).toBe(
        "Harden validation after secondary defect findings",
      );

      // Lineage entry verification
      expect(mutated.spec.lineage?.length).toBe(1);
      const entry = mutated.spec.lineage![0];
      expect(entry.version).toBe(1);
      expect(entry.mutationReason).toBe("Harden validation after secondary defect findings");
      expect(entry.previousSha256).toBe(initialRole.sha256);
      expect(entry.changedFields).toEqual([
        "invariants",
        "cognitivePillars",
        "grantedCommands",
        "prohibitedActions",
      ]);

      // Successive mutation (version 2 -> 3) with empty optional updates
      const secondMutation = mutateRoleWithFeedback(mutated, {
        mutationReason: "Secondary touchpoint with no array changes",
      });

      expect(secondMutation.spec.version).toBe(3);
      expect(secondMutation.spec.lineage?.length).toBe(2);
      expect(secondMutation.spec.lineage![1].version).toBe(2);
      expect(secondMutation.spec.lineage![1].changedFields).toEqual([]);
      expect(secondMutation.sha256).not.toBe(mutated.sha256);
    });

    it("throws HarnessError if mutated role fails spec validation", () => {
      const baseRole = synthesizeRoleFromDefectRemediation({
        defectId: "DEF-500",
        defectType: "type_error",
        rootCause: "bad type cast",
        affectedScope: ["src/index.ts"],
        correctiveAction: "proper type narrowing",
      });

      expect(() => {
        mutateRoleWithFeedback(baseRole, {
          mutationReason: "Attempt invalid grant",
          additionalCommands: ["orchestrator:run"], // FORBIDDEN_COMMAND
        });
      }).toThrow(HarnessError);

      try {
        mutateRoleWithFeedback(baseRole, {
          mutationReason: "Attempt invalid grant",
          additionalCommands: ["orchestrator:run"],
        });
      } catch (err) {
        expect(err).toBeInstanceOf(HarnessError);
        expect((err as HarnessError).code).toBe("ROLE_CONFINEMENT_VIOLATION");
      }
    });
  });
});

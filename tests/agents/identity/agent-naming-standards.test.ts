import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  AGENT_NAMING_STANDARDS,
  agentIdToRole,
  agentIdToTier,
  isStandardAgentId,
  parseStandardAgentId,
  recommendStandardAgentId,
  roleToTier,
  validateAgentNamingConvention,
  type StandardAgentRole,
} from "../../../olt/scripts/src/authority/thread/index.ts";
import { identifyExecutionContext } from "../../../olt/scripts/src/authority/thread/index.ts";
import {
  findSkillRoot,
  loadAgentManifest,
  loadRoleContract,
} from "../../../olt/scripts/src/authority/manifest/index.ts";
import { whoamiCommand } from "../../../olt/scripts/src/cli/commands/whoami.ts";

describe("Agent Naming - Standards & Tiers", () => {
  const allKnownRoles: StandardAgentRole[] = [
    "mind",
    "orchestrator",
    "mind-auditor",
    "coordinator",
    "implementer",
    "validator",
    "repairer",
    "completeness-critic",
    "planner",
    "plan-validator",
    "validator-code-quality",
    "validator-ui-design",
    "validator-security",
    "validator-product",
    "validator-system-design",
    "sub-implementer",
    "sub-validator",
    "sub-investigator",
  ];

  describe("Naming Specification Completeness Matrix", () => {
    test("every defined role has complete, consistent naming standard metadata", () => {
      for (const role of allKnownRoles) {
        const spec = AGENT_NAMING_STANDARDS[role];
        expect(spec).toBeDefined();
        expect(spec.role).toBe(role);
        expect([0, 1, 2, 3]).toContain(spec.tier);
        expect(["pulse", "phase", "audit", "domain", "task", "subtask"]).toContain(
          spec.bindingType,
        );
        expect(spec.regexPattern).toBeInstanceOf(RegExp);
        expect(spec.example.length).toBeGreaterThan(0);
        expect(spec.description.length).toBeGreaterThan(0);

        // Verify the example strictly passes its own pattern
        expect(spec.regexPattern.test(spec.example)).toBe(true);
        expect(isStandardAgentId(spec.example)).toBe(true);

        const parsed = parseStandardAgentId(spec.example);
        expect(parsed).not.toBeNull();
        expect(parsed?.role).toBe(role);
        expect(parsed?.tier).toBe(spec.tier);
        expect(parsed?.bindingType).toBe(spec.bindingType);
      }
    });

    test("roleToTier and agentIdToTier map all standard roles symmetrically", () => {
      for (const role of allKnownRoles) {
        const spec = AGENT_NAMING_STANDARDS[role];
        expect(roleToTier(role)).toBe(spec.tier);
        expect(agentIdToTier(spec.example)).toBe(spec.tier);
        expect(agentIdToRole(spec.example)).toBe(role);
      }
    });
  });

  describe("Tier 0: Mind Naming and Restraint Invariants", () => {
    test("validates Tier 0 mind agent IDs with pulse bindings", () => {
      const validIds = ["mind_pulse-001", "mind_pulse-gen-1", "mind_p-12345", "mind_run-session-a"];

      for (const id of validIds) {
        expect(isStandardAgentId(id)).toBe(true);
        const parsed = parseStandardAgentId(id);
        expect(parsed?.tier).toBe(0);
        expect(parsed?.role).toBe("mind");
        expect(parsed?.bindingType).toBe("pulse");

        const validation = validateAgentNamingConvention(id, "mind", 0);
        expect(validation.valid).toBe(true);
      }
    });

    test("rejects invalid mind identifiers and provides recommendation", () => {
      const invalidMind = "mind-runner-1";
      expect(isStandardAgentId(invalidMind)).toBe(false);
      const res = validateAgentNamingConvention(invalidMind, "mind", 0, "pulse-1");
      expect(res.valid).toBe(false);
      expect(res.recommendedAgentId).toBe("mind_pulse-1");
    });
  });

  describe("Tier 1: Orchestrator & Mind Auditor Naming", () => {
    test("validates Tier 1 orchestrator agent IDs with phase bindings", () => {
      const validOrchIds = [
        "orchestrator_wave-1-foundations",
        "orchestrator_phase-2-execution",
        "orchestrator_bootstrap",
      ];

      for (const id of validOrchIds) {
        expect(isStandardAgentId(id)).toBe(true);
        const parsed = parseStandardAgentId(id);
        expect(parsed?.tier).toBe(1);
        expect(parsed?.role).toBe("orchestrator");
        expect(parsed?.bindingType).toBe("phase");

        const validation = validateAgentNamingConvention(id, "orchestrator", 1);
        expect(validation.valid).toBe(true);
      }
    });

    test("validates Tier 1 mind-auditor agent IDs with audit bindings", () => {
      const validAuditIds = ["mind-auditor_audit-gen-1", "mind-auditor_pulse-check-4"];

      for (const id of validAuditIds) {
        expect(isStandardAgentId(id)).toBe(true);
        const parsed = parseStandardAgentId(id);
        expect(parsed?.tier).toBe(1);
        expect(parsed?.role).toBe("mind-auditor");
        expect(parsed?.bindingType).toBe("audit");
      }
    });
  });

  describe("Tier 2: Coordinator Naming", () => {
    test("validates Tier 2 coordinator agent IDs with domain bindings", () => {
      const validCoordIds = [
        "coordinator_domain-cli-tools",
        "coordinator_domain-backend-auth",
        "coordinator_domain-contracts-and-git",
        "coordinator_wave-3",
      ];

      for (const id of validCoordIds) {
        expect(isStandardAgentId(id)).toBe(true);
        const parsed = parseStandardAgentId(id);
        expect(parsed?.tier).toBe(2);
        expect(parsed?.role).toBe("coordinator");
        expect(parsed?.bindingType).toBe("domain");

        const validation = validateAgentNamingConvention(id, "coordinator", 2);
        expect(validation.valid).toBe(true);
      }
    });

    test("enforces domain binding when recommending coordinator identifiers", () => {
      expect(recommendStandardAgentId("coordinator", "domain-contracts-and-git")).toBe(
        "coordinator_domain-contracts-and-git",
      );
    });
  });

  describe("Tier 3: Implementers, Validators, Repairers, and Subagents", () => {
    test("validates Tier 3 task-bound implementers with optional slugs", () => {
      const validImplIds = [
        "implementer_task-1",
        "implementer_task-p54",
        "implementer_task-p54-agent-naming",
        "implementer_task-p55-git-preservation",
        "implementer_task-complex-auth-refactor-part-1",
      ];

      for (const id of validImplIds) {
        expect(isStandardAgentId(id)).toBe(true);
        const parsed = parseStandardAgentId(id);
        expect(parsed?.tier).toBe(3);
        expect(parsed?.role).toBe("implementer");
        expect(parsed?.bindingType).toBe("task");
        expect(parsed?.taskId?.startsWith("task-")).toBe(true);
      }
    });

    test("validates Tier 3 domain-specialized validators", () => {
      const specializedValidators: Array<{ id: string; role: StandardAgentRole; taskId: string }> =
        [
          {
            id: "validator-code-quality_task-p54-naming",
            role: "validator-code-quality",
            taskId: "task-p54",
          },
          {
            id: "validator-ui-design_task-p48-viewports",
            role: "validator-ui-design",
            taskId: "task-p48",
          },
          { id: "validator-security_task-p30-jwt", role: "validator-security", taskId: "task-p30" },
          { id: "validator-product_task-p10-specs", role: "validator-product", taskId: "task-p10" },
          {
            id: "validator-system-design_task-p12-arch",
            role: "validator-system-design",
            taskId: "task-p12",
          },
        ];

      for (const item of specializedValidators) {
        expect(isStandardAgentId(item.id)).toBe(true);
        const parsed = parseStandardAgentId(item.id);
        expect(parsed?.role).toBe(item.role);
        expect(parsed?.tier).toBe(3);
        expect(parsed?.taskId).toBe(item.taskId);

        const validation = validateAgentNamingConvention(item.id, item.role, 3, item.taskId);
        expect(validation.valid).toBe(true);
      }
    });

    test("validates Tier 3 subagents (sub-implementer, sub-validator, sub-investigator)", () => {
      const subagents: Array<{ id: string; role: StandardAgentRole; subtaskId: string }> = [
        {
          id: "sub-implementer_subtask-1-unit-test",
          role: "sub-implementer",
          subtaskId: "subtask-1",
        },
        { id: "sub-validator_subtask-1-proof", role: "sub-validator", subtaskId: "subtask-1" },
        { id: "sub-investigator_subtask-2-diag", role: "sub-investigator", subtaskId: "subtask-2" },
      ];

      for (const item of subagents) {
        expect(isStandardAgentId(item.id)).toBe(true);
        const parsed = parseStandardAgentId(item.id);
        expect(parsed?.role).toBe(item.role);
        expect(parsed?.tier).toBe(3);
        expect(parsed?.taskId).toBe(item.subtaskId);

        const validation = validateAgentNamingConvention(item.id, item.role, 3, item.subtaskId);
        expect(validation.valid).toBe(true);
      }
    });
  });

  describe("Negative and Boundary Validation Diagnostics", () => {
    test("detects role mismatches between agent ID prefix and declared role", () => {
      const validation = validateAgentNamingConvention(
        "implementer_task-1-fix",
        "validator",
        3,
        "task-1",
      );
      expect(validation.valid).toBe(false);
      expect(validation.reason).toContain("Role mismatch");
      expect(validation.recommendedAgentId).toBe("validator_task-1");
    });

    test("detects tier mismatches between declared tier and agent identifier tier", () => {
      const validation = validateAgentNamingConvention(
        "coordinator_domain-cli",
        "coordinator",
        3, // Expected tier 3, but coordinator is tier 2
      );
      expect(validation.valid).toBe(false);
      expect(validation.reason).toContain("Tier mismatch");
    });

    test("detects task ID mismatch between agent identifier and leased task", () => {
      const validation = validateAgentNamingConvention(
        "implementer_task-p54-naming",
        "implementer",
        3,
        "task-p55", // Expected task-p55, but ID contains task-p54
      );
      expect(validation.valid).toBe(false);
      expect(validation.reason).toContain("Task ID mismatch");
      expect(validation.recommendedAgentId).toBe("implementer_task-p55-naming");
    });

    test("rejects malformed syntax like dashes instead of underscores, spaces, or uppercase", () => {
      expect(isStandardAgentId("implementer-task-1")).toBe(false);
      expect(isStandardAgentId("Implementer_task-1")).toBe(false);
      expect(isStandardAgentId("implementer_task_1")).toBe(false);
      expect(isStandardAgentId("implementer task-1")).toBe(false);
      expect(isStandardAgentId("")).toBe(false);
    });
  });

});

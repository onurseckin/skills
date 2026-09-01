import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { findCommand } from "../../../../olt/scripts/src/cli/registry/index.ts";
import type { CommandSpec } from "../../../../olt/scripts/src/cli/registry/types.ts";
import type { Flags } from "../../../../olt/scripts/src/cli/options.ts";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import {
  isCognitiveValidatorRole,
  isMechanicValidatorRole,
  isExecutionCommand,
  isExecutionToolCategory,
  isProhibitedCognitiveTool,
  validateHierarchicalSpawning,
  assertHierarchicalSpawning,
  assertCognitiveValidatorHardlock,
  assertRoleMayInvoke,
  assertGrantedCommand,
} from "../../../../olt/scripts/src/packets/command-authority.ts";
import {
  auditSingleRole,
  createRoleBoundaryWatchdog,
  validateParentChildSupervision,
  assertParentChildBoundary,
  type RoleBoundaryAction,
} from "../../../../olt/scripts/src/mind/auditing/roles/index.ts";
import {
  isBoundaryLeakViolation,
  validateBoundaryIntegrity,
  assertNoBoundaryLeak,
  type BoundaryLeakCheck,
} from "../../../../olt/scripts/src/validation/anti-leak/index.ts";
import { transact } from "../../../../olt/scripts/src/engine/store/index.ts";
import { emptyGrantRun } from "../../../packets/validation/grants/grant-run-fixture.ts";
import type { DynamicRoleSpec } from "../../../../olt/scripts/src/mind/roles/dynamic/index.ts";

function spec(invocation: string): CommandSpec {
  const found = findCommand(invocation);
  if (!found) throw new Error(`Registry has no command named ${invocation}`);
  return found;
}

describe("Validator Hard-Lock - Boundary Supervision (Part 1)", () => {
  describe("1. Hierarchical Parent-Child Boundary Supervision", () => {
    it("validates direct hierarchical spawning transitions across all 4 tiers", () => {
      // Tier 0 Mind -> Tier 1 Orchestrator
      const mindToOrch = validateHierarchicalSpawning("mind", "orchestrator");
      expect(mindToOrch.valid).toBe(true);
      expect(mindToOrch.parentTier).toBe(0);
      expect(mindToOrch.childTier).toBe(1);

      // Tier 0 Mind -> Tier 2 Coordinator [REJECT]
      const mindToCoord = validateHierarchicalSpawning("mind", "coordinator");
      expect(mindToCoord.valid).toBe(false);
      expect(mindToCoord.reason).toContain(
        "Tier 0 Mind (mind) may only dispatch Tier 1 Orchestrators",
      );

      // Tier 0 Mind -> Tier 3 Implementer [REJECT]
      const mindToImpl = validateHierarchicalSpawning("mind", "implementer");
      expect(mindToImpl.valid).toBe(false);

      // Tier 1 Orchestrator -> Tier 2 Coordinator
      const orchToCoord = validateHierarchicalSpawning("orchestrator", "coordinator");
      expect(orchToCoord.valid).toBe(true);
      expect(orchToCoord.parentTier).toBe(1);
      expect(orchToCoord.childTier).toBe(2);

      // Tier 1 Orchestrator -> Tier 0 Mind [REJECT]
      const orchToMind = validateHierarchicalSpawning("orchestrator", "mind");
      expect(orchToMind.valid).toBe(false);

      // Tier 1 Orchestrator -> Tier 3 Implementer [REJECT: must dispatch Coordinator]
      const orchToImpl = validateHierarchicalSpawning("orchestrator", "implementer");
      expect(orchToImpl.valid).toBe(false);
      expect(orchToImpl.reason).toContain(
        "Tier 1 Orchestrator (orchestrator) may only dispatch Tier 2 Coordinators",
      );

      // Tier 2 Coordinator -> Tier 3 Implementer / Validator / Critic / Repairer
      expect(validateHierarchicalSpawning("coordinator", "implementer").valid).toBe(true);
      expect(validateHierarchicalSpawning("coordinator", "validator").valid).toBe(true);
      expect(validateHierarchicalSpawning("coordinator", "completeness-critic").valid).toBe(true);
      expect(validateHierarchicalSpawning("coordinator", "repairer").valid).toBe(true);

      // Tier 2 Coordinator -> Tier 2 Coordinator [REJECT]
      expect(validateHierarchicalSpawning("coordinator", "coordinator").valid).toBe(false);

      // Tier 3 workers -> leaf execution workers [REJECT]
      expect(validateHierarchicalSpawning("implementer", "sub-worker").valid).toBe(false);
      expect(validateHierarchicalSpawning("validator", "sub-validator").valid).toBe(false);
      expect(validateHierarchicalSpawning("repairer", "sub-repairer").valid).toBe(false);
    });

    it("assertHierarchicalSpawning throws ROLE_CONFINEMENT_VIOLATION on cross-tier spawning", () => {
      expect(() =>
        assertHierarchicalSpawning("mind", "implementer", "mind-lead", "impl-1"),
      ).toThrow(HarnessError);

      expect(() =>
        assertHierarchicalSpawning("orchestrator", "validator", "orch-lead", "val-1"),
      ).toThrow("Hierarchical Parent-Child Boundary Violation");

      expect(() =>
        assertHierarchicalSpawning("implementer", "sub-worker", "impl-1", "sub-1"),
      ).toThrow("leaf execution worker");

      expect(() =>
        assertHierarchicalSpawning("orchestrator", "coordinator", "orch-1", "coord-1"),
      ).not.toThrow();
    });

    it("validateParentChildSupervision and assertParentChildBoundary in role-auditing maintain strict tier supervision", () => {
      expect(validateParentChildSupervision("mind", "orchestrator").valid).toBe(true);
      expect(validateParentChildSupervision("orchestrator", "coordinator").valid).toBe(true);
      expect(validateParentChildSupervision("coordinator", "implementer").valid).toBe(true);
      expect(validateParentChildSupervision("coordinator", "validator").valid).toBe(true);

      expect(validateParentChildSupervision("mind", "coordinator").valid).toBe(false);
      expect(validateParentChildSupervision("orchestrator", "implementer").valid).toBe(false);
      expect(validateParentChildSupervision("implementer", "sub-implementer").valid).toBe(false);

      expect(() =>
        assertParentChildBoundary("orchestrator", "implementer", "orch-1", "impl-1"),
      ).toThrow("Active Hierarchical Parent-Child Boundary Violation");
    });

    it("audits dynamic role specs for spawning hierarchy and parent role compliance", () => {
      // Valid Tier 0 Mind
      const validMindSpec: DynamicRoleSpec = {
        name: "test-mind",
        archetype: "tier_0_mind",
        tier: 0,
        title: "Test Mind",
        summary: "Mind supervisor",
        domain: "general",
        grantedCommands: ["mind:init", "whoami"],
        permittedActivities: ["Observe state"],
        prohibitedActions: ["Direct file write"],
        invariants: ["Zero-Tolerance"],
        spawns: ["orchestrator"],
        cognitivePillars: ["Observational Integrity", "Zero-Any Discipline"],
        writeScopePolicy: "forbidden",
      };
      const mindFindings = auditSingleRole(validMindSpec);
      expect(mindFindings.some((f) => f.category === "spawning_hierarchy")).toBe(false);

      // Invalid Tier 0 Mind with cross-tier spawns
      const invalidMindSpec: DynamicRoleSpec = {
        ...validMindSpec,
        name: "invalid-mind",
        spawns: ["coordinator", "implementer"],
      };
      const invalidMindFindings = auditSingleRole(invalidMindSpec);
      expect(
        invalidMindFindings.some(
          (f) => f.category === "spawning_hierarchy" && f.id.startsWith("FIND-HIER-SPAWN0"),
        ),
      ).toBe(true);

      // Invalid Tier 1 Orchestrator with cross-tier spawns
      const invalidOrchSpec: DynamicRoleSpec = {
        name: "invalid-orch",
        archetype: "tier_1_orchestrator",
        tier: 1,
        title: "Invalid Orch",
        summary: "Orchestrator lead",
        domain: "general",
        grantedCommands: ["plan:compile", "whoami"],
        permittedActivities: ["Compile plans"],
        prohibitedActions: ["Direct file write"],
        invariants: ["Zero-Tolerance"],
        spawns: ["implementer", "validator"],
        cognitivePillars: ["Plan Discipline", "Zero-Any Discipline"],
        writeScopePolicy: "forbidden",
      };
      const invalidOrchFindings = auditSingleRole(invalidOrchSpec);
      expect(
        invalidOrchFindings.some(
          (f) => f.category === "spawning_hierarchy" && f.id.startsWith("FIND-HIER-SPAWN1"),
        ),
      ).toBe(true);

      // Invalid Tier 2 Coordinator with supervisor spawns
      const invalidCoordSpec: DynamicRoleSpec = {
        name: "invalid-coord",
        archetype: "tier_2_coordinator",
        tier: 2,
        title: "Invalid Coord",
        summary: "Coordinator lead",
        domain: "general",
        grantedCommands: ["queue:pop", "whoami"],
        permittedActivities: ["Dispatch tasks"],
        prohibitedActions: ["Direct file write"],
        invariants: ["Zero-Tolerance"],
        spawns: ["orchestrator", "mind"],
        cognitivePillars: ["Queue Discipline", "Zero-Any Discipline"],
        writeScopePolicy: "forbidden",
      };
      const invalidCoordFindings = auditSingleRole(invalidCoordSpec);
      expect(
        invalidCoordFindings.some(
          (f) => f.category === "spawning_hierarchy" && f.id.startsWith("FIND-HIER-SPAWN2"),
        ),
      ).toBe(true);

      // Invalid Tier 3 Implementer with spawns (leaf violation)
      const invalidImplSpec: DynamicRoleSpec = {
        name: "invalid-impl",
        archetype: "tier_3_implementer",
        tier: 3,
        title: "Invalid Impl",
        summary: "Implementer worker",
        domain: "general",
        grantedCommands: ["task:claim", "task:submit", "whoami"],
        permittedActivities: ["Write code"],
        prohibitedActions: ["Run broad tests"],
        invariants: ["Zero-Tolerance"],
        spawns: ["sub-worker"],
        cognitivePillars: ["Code Discipline", "Zero-Any Discipline"],
        writeScopePolicy: "assigned_only",
      };
      const invalidImplFindings = auditSingleRole(invalidImplSpec);
      expect(
        invalidImplFindings.some(
          (f) => f.category === "spawning_hierarchy" && f.id.startsWith("FIND-HIER-SPAWN3"),
        ),
      ).toBe(true);

      // Invalid Tier 3 role with non-adjacent parentRole (e.g. parentRole: "mind")
      const invalidParentSpec: DynamicRoleSpec = {
        ...invalidImplSpec,
        name: "invalid-parent-impl",
        spawns: [],
        parentRole: "mind",
      };
      const invalidParentFindings = auditSingleRole(invalidParentSpec);
      expect(
        invalidParentFindings.some(
          (f) => f.category === "spawning_hierarchy" && f.id.startsWith("FIND-HIER-PARENT3"),
        ),
      ).toBe(true);
    });
  });
});

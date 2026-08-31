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


describe("Validator Hard-Lock - Boundary Supervision (Part 2)", () => {
  describe("1. Hierarchical Parent-Child Boundary Supervision", () => {
    it("enforces hierarchical spawning in real-time RoleBoundaryWatchdog", () => {
      const watchdog = createRoleBoundaryWatchdog();

      // Tier 3 Leaf spawning
      const leafAction: RoleBoundaryAction = {
        agentId: "impl-1",
        role: "implementer",
        actionType: "spawning",
        targetRole: "sub-worker",
        targetTier: 3,
      };
      const leafViolation = watchdog.auditAction(leafAction);
      expect(leafViolation).not.toBeNull();
      expect(leafViolation?.violationType).toBe("leaf_spawning");
      expect(leafViolation?.severity).toBe("CRITICAL");

      // Tier 0 Mind cross-tier spawning (attempting to spawn implementer)
      const mindAction: RoleBoundaryAction = {
        agentId: "mind-1",
        role: "mind",
        actionType: "spawning",
        targetRole: "implementer",
        targetTier: 3,
      };
      const mindViolation = watchdog.auditAction(mindAction);
      expect(mindViolation).not.toBeNull();
      expect(mindViolation?.violationType).toBe("cross_tier_spawning");
      expect(mindViolation?.observation).toContain("Mind may only dispatch Tier 1 Orchestrators");

      // Tier 1 Orchestrator cross-tier spawning (attempting to spawn implementer directly)
      const orchAction: RoleBoundaryAction = {
        agentId: "orch-1",
        role: "orchestrator",
        actionType: "spawning",
        targetRole: "implementer",
        targetTier: 3,
      };
      const orchViolation = watchdog.auditAction(orchAction);
      expect(orchViolation).not.toBeNull();
      expect(orchViolation?.violationType).toBe("cross_tier_spawning");
      expect(orchViolation?.observation).toContain(
        "Orchestrators may only dispatch Tier 2 Coordinators",
      );

      // Tier 2 Coordinator spawning Tier 3 Implementer [VALID]
      const validCoordAction: RoleBoundaryAction = {
        agentId: "coord-1",
        role: "coordinator",
        actionType: "spawning",
        targetRole: "implementer",
        targetTier: 3,
      };
      expect(watchdog.auditAction(validCoordAction)).toBeNull();
    });

    it("enforces hierarchical spawning on agent:register in active capsule ledger", async () => {
      const { run } = await emptyGrantRun("hierarchical-reg-");
      transact(run, "test-setup", "grant-hierarchy", {}, (draft) => {
        draft.agents = [
          {
            id: "mind-lead",
            role: "mind",
            parent_agent_id: null,
            parent_task_id: null,
            host: "claude-code",
            granted_at: new Date().toISOString(),
            status: "active",
          },
          {
            id: "orch-lead",
            role: "orchestrator",
            parent_agent_id: "mind-lead",
            parent_task_id: null,
            host: "claude-code",
            granted_at: new Date().toISOString(),
            status: "active",
          },
          {
            id: "coord-lead",
            role: "coordinator",
            parent_agent_id: "orch-lead",
            parent_task_id: null,
            host: "claude-code",
            granted_at: new Date().toISOString(),
            status: "active",
          },
        ];
      });

      // Valid registration: Coordinator registering Implementer
      const validRegFlags: Flags = {
        run,
        actor: "coord-lead",
        agent: "worker-1",
        role: "implementer",
        "parent-agent": "coord-lead",
        host: "claude-code",
      };
      expect(() =>
        assertGrantedCommand(spec("agent:register"), validRegFlags, {
          actor: "coord-lead",
          verified: true,
        }),
      ).not.toThrow();

      // Invalid registration: Orchestrator attempting to directly register Implementer
      const invalidOrchRegFlags: Flags = {
        run,
        actor: "orch-lead",
        agent: "worker-2",
        role: "implementer",
        "parent-agent": "orch-lead",
        host: "claude-code",
      };
      expect(() =>
        assertGrantedCommand(spec("agent:register"), invalidOrchRegFlags, {
          actor: "orch-lead",
          verified: true,
        }),
      ).toThrow("Hierarchical Parent-Child Boundary Violation");

      // Invalid registration: Tier 3 Implementer dispatched with no parent agent
      const orphanRegFlags: Flags = {
        run,
        actor: "mind-lead",
        agent: "worker-orphan",
        role: "implementer",
        host: "claude-code",
      };
      expect(() =>
        assertGrantedCommand(spec("agent:register"), orphanRegFlags, {
          actor: "mind-lead",
          verified: true,
        }),
      ).toThrow("Hierarchical supervision violation");
    });
  });
});

import { describe, expect, test, spyOn } from "bun:test";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { findCommand } from "../../../../olt/scripts/src/cli/registry/index.ts";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import {
  assertGrantedCommand,
  assertAgentRegisterHierarchy,
  assertSubjectTargetPolicy,
} from "../../../../olt/scripts/src/packets/command-authority-grants.ts";
import { assertRoleMayInvoke } from "../../../../olt/scripts/src/packets/command-authority-invocation.ts";
import {
  formatHardlockRemediation,
  formatHierarchicalRemediation,
  formatSupervisionRemediation,
  formatDeclaredSpawnRemediation,
  formatRoleContractRemediation,
  formatSessionRemediation,
  resolveCurrentHost,
} from "../../../../olt/scripts/src/packets/command-authority-remediation.ts";
import {
  capsuleState,
  isNoRunBootstrapExempt,
  actsOnOwnGrant,
  isMissingCapsuleExempt,
  normalizeRoleForContract,
} from "../../../../olt/scripts/src/packets/command-authority-state.ts";
import { requiresActingIdentity } from "../../../../olt/scripts/src/packets/grant-bootstrap-allowlist.ts";
import { emptyGrantRun } from "../../validation/grants/grant-run-fixture.ts";
import {
  registerAgentGrant,
  releaseAgentGrant,
} from "../../../../olt/scripts/src/workflow/agents/grants.ts";
import type { AuthenticatedCaller } from "../../../../olt/scripts/src/packets/command-authority.ts";

function spec(name: string) {
  const found = findCommand(name);
  if (!found) throw new Error(`Unknown command: ${name}`);
  return found;
}

describe("Command Authority Edges - Hierarchy & Policies", () => {
  describe("command-authority-grants-edge-cases", () => {
    test("assertSubjectTargetPolicy on agent:report and agent:release", () => {
      const mockLedger = [
        {
          id: "orch-1",
          role: "orchestrator" as const,
          status: "active" as const,
          parent_agent_id: null,
          parent_task_id: null,
        },
        {
          id: "coord-1",
          role: "coordinator" as const,
          status: "active" as const,
          parent_agent_id: "orch-1",
          parent_task_id: null,
        },
      ];

      // agent:report with target !== caller -> throws AUTHENTICATION_FAILURE
      expect(() =>
        assertSubjectTargetPolicy(spec("agent:report"), { agent: "orch-1" }, "coord-1", mockLedger),
      ).toThrow(HarnessError);

      // agent:release with target as direct child of caller -> succeeds
      expect(() =>
        assertSubjectTargetPolicy(
          spec("agent:release"),
          { agent: "coord-1" },
          "orch-1",
          mockLedger,
        ),
      ).not.toThrow();

      // agent:release with target not child -> throws AUTHENTICATION_FAILURE
      expect(() =>
        assertSubjectTargetPolicy(
          spec("agent:release"),
          { agent: "orch-1" },
          "coord-1",
          mockLedger,
        ),
      ).toThrow(HarnessError);
    });

    test("assertAgentRegisterHierarchy throws INVALID_STATE when parent-agent not in ledger", async () => {
      const { run } = await emptyGrantRun("missing-parent-");
      await registerAgentGrant({
        runRoot: run,
        agentId: "orch-1",
        role: "orchestrator",
        parentAgentId: null,
        parentTaskId: null,
        host: "claude-code",
        authority: { kind: "conditional_genesis" },
        maxAgents: 10,
        telemetry: {},
      });

      const caller: AuthenticatedCaller = {
        actor: "non-existent",
        role: "orchestrator",
        verified: true,
      };
      expect(() =>
        assertGrantedCommand(
          spec("agent:register"),
          { run, "parent-agent": "non-existent", role: "coordinator", agent: "coord-1" },
          caller,
        ),
      ).toThrow(HarnessError);
    });

    test("assertAgentRegisterHierarchy throws INVALID_STATE when parent grant is not active", async () => {
      const { run } = await emptyGrantRun("released-parent-");
      await registerAgentGrant({
        runRoot: run,
        agentId: "orch-1",
        role: "orchestrator",
        parentAgentId: null,
        parentTaskId: null,
        host: "claude-code",
        authority: { kind: "conditional_genesis" },
        maxAgents: 10,
        telemetry: {},
      });
      await releaseAgentGrant({
        runRoot: run,
        agentId: "orch-1",
        actor: "orch-1",
        reason: "done",
      });

      const caller: AuthenticatedCaller = { actor: "orch-1", role: "orchestrator", verified: true };
      expect(() =>
        assertGrantedCommand(
          spec("agent:register"),
          { run, "parent-agent": "orch-1", role: "coordinator", agent: "coord-1" },
          caller,
        ),
      ).toThrow(HarnessError);
    });

    test("assertAgentRegisterHierarchy throws AUTHENTICATION_FAILURE when agentId does not match parentAgentId", async () => {
      const { run } = await emptyGrantRun("mismatched-parent-");
      await registerAgentGrant({
        runRoot: run,
        agentId: "orch-1",
        role: "orchestrator",
        parentAgentId: null,
        parentTaskId: null,
        host: "claude-code",
        authority: { kind: "conditional_genesis" },
        maxAgents: 10,
        telemetry: {},
      });

      const caller: AuthenticatedCaller = {
        actor: "coord-other",
        role: "coordinator",
        verified: true,
      };
      expect(() =>
        assertGrantedCommand(
          spec("agent:register"),
          { run, "parent-agent": "orch-1", role: "coordinator", agent: "coord-1" },
          caller,
        ),
      ).toThrow(HarnessError);
    });

    test("assertGrantedCommand throws AUTHENTICATION_FAILURE when explicit acting claim != caller.actor", async () => {
      const { run } = await emptyGrantRun("claim-mismatch-");
      await registerAgentGrant({
        runRoot: run,
        agentId: "orch-1",
        role: "orchestrator",
        parentAgentId: null,
        parentTaskId: null,
        host: "claude-code",
        authority: { kind: "conditional_genesis" },
        maxAgents: 10,
        telemetry: {},
      });

      const caller: AuthenticatedCaller = { actor: "orch-1", role: "orchestrator", verified: true };
      expect(() =>
        assertGrantedCommand(
          spec("task:claim"),
          { run, actor: "impersonator", task: "T-1" },
          caller,
        ),
      ).toThrow(HarnessError);
    });

    test("assertGrantedCommand throws AUTHENTICATION_FAILURE on governed mutation with unverified caller", async () => {
      const { run } = await emptyGrantRun("unverified-governed-");
      expect(() =>
        assertGrantedCommand(
          spec("queue:drain"),
          { "authority-run": run, actor: "mind-1" },
          { actor: "mind-1", role: "mind", verified: false },
        ),
      ).toThrow(HarnessError);
    });

    test("assertGrantedCommand throws ROLE_CONFINEMENT_VIOLATION on governed mutation when caller role is disallowed", async () => {
      const { run } = await emptyGrantRun("disallowed-governed-");
      await registerAgentGrant({
        runRoot: run,
        agentId: "worker-1",
        role: "implementer",
        parentAgentId: null,
        parentTaskId: null,
        host: "claude-code",
        authority: { kind: "conditional_genesis" },
        maxAgents: 10,
        telemetry: {},
      });

      const caller: AuthenticatedCaller = {
        actor: "worker-1",
        role: "implementer",
        verified: true,
      };
      expect(() =>
        assertGrantedCommand(
          spec("queue:drain"),
          { "authority-run": run, actor: "worker-1" },
          caller,
        ),
      ).toThrow(HarnessError);
    });

    test("assertGrantedCommand throws AUTHENTICATION_FAILURE for unverified agent:register on non-empty ledger", async () => {
      const { run } = await emptyGrantRun("unverified-reg-");
      await registerAgentGrant({
        runRoot: run,
        agentId: "orch-1",
        role: "orchestrator",
        parentAgentId: null,
        parentTaskId: null,
        host: "claude-code",
        authority: { kind: "conditional_genesis" },
        maxAgents: 10,
        telemetry: {},
      });

      // Without parent-agent
      expect(() =>
        assertGrantedCommand(
          spec("agent:register"),
          { run, role: "coordinator", agent: "coord-1" },
          { actor: "orch-1", role: "orchestrator", verified: false },
        ),
      ).toThrow(HarnessError);

      // With parent-agent
      expect(() =>
        assertGrantedCommand(
          spec("agent:register"),
          { run, "parent-agent": "orch-1", role: "coordinator", agent: "coord-1" },
          { actor: "orch-1", role: "orchestrator", verified: false },
        ),
      ).toThrow(HarnessError);
    });
  });
});

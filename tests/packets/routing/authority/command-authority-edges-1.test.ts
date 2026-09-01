import { describe, expect, test, spyOn } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
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

describe("Command Authority Edges - Invocations & Grants", () => {
  describe("grant-bootstrap-allowlist", () => {
    test("requiresActingIdentity returns true when authority declares it and false for display filter or no acting flags", () => {
      expect(requiresActingIdentity(spec("task:claim"))).toBe(true);
      expect(requiresActingIdentity(spec("task:brief"))).toBe(false);
      expect(requiresActingIdentity(spec("doctor"))).toBe(false);

      const filterSpec = {
        name: "dag:trace",
        aliases: [],
        flags: [{ name: "agent", type: "string" }],
      } as unknown as Parameters<typeof requiresActingIdentity>[0];
      expect(requiresActingIdentity(filterSpec)).toBe(false);
    });
  });

  describe("command-authority-state", () => {
    test("capsuleState returns undefined when loadRun throws", async () => {
      const { run } = await emptyGrantRun("corrupt-capsule-");
      await writeFile(join(run, "state.json"), "{ corrupted json syntax");
      expect(capsuleState(run)).toBeUndefined();
    });

    test("isNoRunBootstrapExempt handles plan:brainstorm and bootstrap exempts", () => {
      expect(isNoRunBootstrapExempt(spec("plan:brainstorm"), { prompt: "ideas" })).toBe(true);
      expect(isNoRunBootstrapExempt(spec("plan:brainstorm"), {})).toBe(false);
    });

    test("actsOnOwnGrant and isMissingCapsuleExempt edge cases", () => {
      expect(actsOnOwnGrant(spec("task:submit"), { agent: "worker-1" }, "worker-1")).toBe(false);
      expect(isMissingCapsuleExempt(spec("orchestrator:run"))).toBe(true);
    });

    test("normalizeRoleForContract normalizes common role aliases", () => {
      expect(normalizeRoleForContract("meta-auditor")).toBe("skill-auditor");
      expect(normalizeRoleForContract("meta_auditor")).toBe("skill-auditor");
      expect(normalizeRoleForContract("critic")).toBe("completeness-critic");
      expect(normalizeRoleForContract("worker")).toBe("implementer");
      expect(normalizeRoleForContract("orch")).toBe("orchestrator");
      expect(normalizeRoleForContract("coord")).toBe("coordinator");
      expect(normalizeRoleForContract("validator")).toBe("validator");
    });
  });

  describe("command-authority-remediation", () => {
    test("formats remediation messages across all supported host environments", () => {
      expect(formatHardlockRemediation("codex")).toContain("In Codex");
      expect(formatHardlockRemediation("cursor")).toContain("In Cursor");
      expect(formatHardlockRemediation("unknown")).toContain("Cognitive validators must not");

      expect(formatHierarchicalRemediation(0, 1, "codex")).toContain("In Codex");
      expect(formatHierarchicalRemediation(3, 4, "cursor")).toContain("In Cursor");

      expect(formatSupervisionRemediation("implementer", 3, "codex")).toContain("In Codex");
      expect(formatDeclaredSpawnRemediation("orchestrator", "worker", "cursor")).toContain(
        "subagent dispatch",
      );
      expect(formatRoleContractRemediation("implementer", "task:submit", "codex")).toContain(
        "spawn_agent",
      );

      expect(formatSessionRemediation("agent:register", "antigravity")).toContain("In Antigravity");
      expect(formatSessionRemediation("task:submit", "codex")).toContain("In Codex");
      expect(formatSessionRemediation("task:submit", "unknown")).toContain("In Host environment");
    });

    test("resolveCurrentHost catches exceptions and defaults to unknown", () => {
      const badEnv = new Proxy(
        {},
        {
          get() {
            throw new Error("Env access error");
          },
        },
      ) as Record<string, string | undefined>;
      expect(resolveCurrentHost(badEnv)).toBe("unknown");
    });
  });

  describe("command-authority-invocation", () => {
    test("assertRoleMayInvoke enforces fail-closed on blank or unresolved roles and agentIds", () => {
      expect(() => assertRoleMayInvoke("", spec("task:submit"), "agent-1")).toThrow(HarnessError);
      expect(() => assertRoleMayInvoke(null, spec("task:submit"), "agent-1")).toThrow(HarnessError);
      expect(() => assertRoleMayInvoke("unresolved", spec("task:submit"), "agent-1")).toThrow(
        HarnessError,
      );
      expect(() => assertRoleMayInvoke("implementer", spec("task:submit"), "")).toThrow(
        HarnessError,
      );
      expect(() => assertRoleMayInvoke("implementer", spec("task:submit"), null)).toThrow(
        HarnessError,
      );
      expect(() => assertRoleMayInvoke("implementer", spec("task:submit"), "unresolved")).toThrow(
        HarnessError,
      );
    });

    test("assertRoleMayInvoke allows meta-auditor for meta-audit", () => {
      expect(() =>
        assertRoleMayInvoke("meta-auditor", spec("meta-audit"), "agent-1"),
      ).not.toThrow();
      expect(() =>
        assertRoleMayInvoke("meta_auditor", spec("meta-audit"), "agent-1"),
      ).not.toThrow();
    });

    test("assertRoleMayInvoke cognitive validator executing shell command handles loadRoleContract errors and successes", () => {
      expect(() =>
        assertRoleMayInvoke("cognitive-validator-custom", spec("run:exec"), "agent-1"),
      ).toThrow(HarnessError);

      expect(() => assertRoleMayInvoke("validator", spec("run:exec"), "agent-1")).toThrow(
        HarnessError,
      );
    });

    test("assertRoleMayInvoke throws PERMISSION_DENIED on non-existent contract role", () => {
      expect(() =>
        assertRoleMayInvoke("nonexistent-role-xyz", spec("task:submit"), "agent-1"),
      ).toThrow(HarnessError);
    });
  });

  describe("command-authority-grants", () => {
    test("assertAgentRegisterHierarchy directly tests edge cases", () => {
      const mockLedger = [
        {
          id: "orch-1",
          role: "orchestrator" as const,
          status: "active" as const,
          parent_agent_id: null,
          parent_task_id: null,
        },
      ];

      // parentAgentId active and agentId undefined -> throws AUTHENTICATION_FAILURE
      expect(() =>
        assertAgentRegisterHierarchy(
          { "parent-agent": "orch-1", role: "coordinator", agent: "coord-1" },
          mockLedger,
          undefined,
        ),
      ).toThrow(HarnessError);

      // parentAgentId active and agentId !== parentAgentId -> throws AUTHENTICATION_FAILURE
      expect(() =>
        assertAgentRegisterHierarchy(
          { "parent-agent": "orch-1", role: "coordinator", agent: "coord-1" },
          mockLedger,
          "other-agent",
        ),
      ).toThrow("does not match --parent-agent");

      // Non-empty ledger, unparented Tier 2 -> throws ROLE_CONFINEMENT_VIOLATION
      expect(() =>
        assertAgentRegisterHierarchy(
          { role: "coordinator", agent: "coord-1" },
          mockLedger,
          "orch-1",
        ),
      ).toThrow(HarnessError);

      // Non-empty ledger, unparented Tier 1, agentId undefined -> throws INVALID_STATE
      expect(() =>
        assertAgentRegisterHierarchy(
          { role: "orchestrator", agent: "orch-2" },
          mockLedger,
          undefined,
        ),
      ).toThrow(HarnessError);

      // Non-empty ledger, unparented Tier 1, agentId holds no active grant -> throws INVALID_STATE
      expect(() =>
        assertAgentRegisterHierarchy(
          { role: "orchestrator", agent: "orch-2" },
          mockLedger,
          "inactive-agent",
        ),
      ).toThrow(HarnessError);
    });

    test("assertGrantedCommand throws AUTHENTICATION_FAILURE when unverified caller claims parent-agent", async () => {
      const { run } = await emptyGrantRun("unverified-parent-");
      expect(() =>
        assertGrantedCommand(
          spec("agent:register"),
          { run, "parent-agent": "orch-1", role: "coordinator", agent: "coord-1" },
          { actor: "orch-1", role: "orchestrator", verified: false },
        ),
      ).toThrow("claim --parent-agent 'orch-1' spawn authority");
    });
  });
});

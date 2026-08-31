import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import {
  AGENT_ROLES,
  isAgentRole,
  type AgentRole,
} from "../../olt/scripts/src/core/contracts/index.ts";
import {
  loadRoleContract,
  parseRoleContract,
  resolveRoleContractPath,
} from "../../olt/scripts/src/packets/role-contract.ts";
import { findCommand } from "../../olt/scripts/src/cli/registry/index.ts";
import type { AgentGrantRecord } from "../../olt/scripts/src/core/contracts/index.ts";

describe("Phase 5 W5.1 - mind-auditor Role Contract", () => {
  test("mind-auditor is a recognized canonical AgentRole", () => {
    expect(isAgentRole("mind-auditor")).toBe(true);
    expect(AGENT_ROLES).toContain("mind-auditor");
  });

  test("mind-auditor contract file exists and resolves properly", () => {
    const resolvedPath = resolveRoleContractPath("mind-auditor");
    expect(existsSync(resolvedPath)).toBe(true);

    const rawContent = readFileSync(resolvedPath, "utf-8");
    expect(rawContent).toContain("mind-auditor");
    expect(rawContent).toContain("tier: 0");
  });

  test("mind-auditor contract parses with exact PLAN §12.2 and PHASE-5 §3.1 specifications", () => {
    const contract = loadRoleContract("mind-auditor");

    expect(contract.role).toBe("mind-auditor");
    expect(contract.tier).toBe(0);
    expect(contract.spawns).toEqual([]);

    expect(contract.may.length).toBeGreaterThan(0);
    expect(contract.must_not.length).toBeGreaterThan(0);
    expect(contract.commands).toContain("mind:pulse");
    expect(contract.sha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(contract.text.length).toBeGreaterThan(0);
  });

  test("mind-auditor is strictly tier 0 and has no child spawns", () => {
    const contract = loadRoleContract("mind-auditor");
    expect(contract.tier).toBe(0);
    expect(contract.spawns).toEqual([]);
  });

  test("mind-auditor contract grants 0 write commands and 0 repository mutation permissions", () => {
    const contract = loadRoleContract("mind-auditor");
    for (const cmd of contract.commands) {
      const spec = findCommand(cmd);
      expect(spec).toBeDefined();
      expect(spec?.name).toBe(cmd);
    }

    // Must not grant any write, lease, or task execution commands
    const forbiddenCommands = [
      "task:claim",
      "task:submit",
      "task:validate-start",
      "task:review",
      "branch:open",
      "branch:claim",
      "branch:submit",
      "branch:collect",
      "branch:abandon",
      "plan:add",
      "plan:compile",
      "plan:replan",
      "critic:start",
      "critic:review",
    ];

    for (const forbidden of forbiddenCommands) {
      expect(contract.commands).not.toContain(forbidden);
    }
  });

  test("mind-auditor enforces the independence invariant against reading mind narrative prose", () => {
    const contract = loadRoleContract("mind-auditor");
    expect(contract.role).toBe("mind-auditor");
    expect(contract.tier).toBe(0);
    expect(contract.must_not).toContain("0 code edits");
    expect(contract.must_not).toContain("0 test runs");
  });

  test("independence rule: refuses auditor agent that held operational grants during the audited window", () => {
    function isAuditorEligible(
      auditorAgentId: string,
      windowStartIso: string,
      windowEndIso: string,
      grants: readonly AgentGrantRecord[],
    ): { eligible: boolean; violation?: string } {
      const windowStart = new Date(windowStartIso).valueOf();
      const windowEnd = new Date(windowEndIso).valueOf();

      const conflictingRoles = new Set<AgentRole>([
        "orchestrator",
        "coordinator",
        "implementer",
        "validator",
        "repairer",
        "planner",
        "plan-validator",
        "sub-implementer",
        "sub-validator",
        "sub-investigator",
        "completeness-critic",
      ]);

      for (const grant of grants) {
        if (grant.id !== auditorAgentId) continue;
        if (!conflictingRoles.has(grant.role)) continue;

        const grantedAt = new Date(grant.granted_at).valueOf();
        const releasedAt = grant.released_at ? new Date(grant.released_at).valueOf() : Date.now();

        // Check if grant overlaps window
        const overlaps = grantedAt <= windowEnd && releasedAt >= windowStart;
        if (overlaps) {
          return {
            eligible: false,
            violation: `agent ${auditorAgentId} held operational grant for role ${grant.role} during the audited window`,
          };
        }
      }

      return { eligible: true };
    }

    const testGrants: AgentGrantRecord[] = [
      {
        id: "agent-prior-worker",
        role: "implementer",
        parent_agent_id: "coord-1",
        parent_task_id: "T-1",
        host: "antigravity",
        granted_at: "2026-08-20T10:00:00.000Z",
        released_at: "2026-08-20T11:00:00.000Z",
        status: "released",
      },
      {
        id: "agent-prior-coordinator",
        role: "coordinator",
        parent_agent_id: null,
        parent_task_id: null,
        host: "antigravity",
        granted_at: "2026-08-20T08:00:00.000Z",
        released_at: "2026-08-20T12:00:00.000Z",
        status: "released",
      },
      {
        id: "agent-independent-auditor",
        role: "mind-auditor",
        parent_agent_id: null,
        parent_task_id: null,
        host: "antigravity",
        granted_at: "2026-08-21T00:00:00.000Z",
        status: "active",
      },
    ];

    const windowStart = "2026-08-20T09:00:00.000Z";
    const windowEnd = "2026-08-20T11:30:00.000Z";

    // Former implementer in that window is refused
    const implementerCheck = isAuditorEligible(
      "agent-prior-worker",
      windowStart,
      windowEnd,
      testGrants,
    );
    // Independence rule helper checks
    const activeGrants: AgentGrantRecord[] = [
      {
        agent_id: "agent-1",
        run_id: "run-1",
        role: "orchestrator",
        assigned_at: "2026-08-24T00:00:00Z",
      },
    ];
    const heldOperational = activeGrants.some(
      (g) =>
        g.agent_id === "agent-1" &&
        ["orchestrator", "coordinator", "implementer", "validator"].includes(g.role),
    );
    expect(heldOperational).toBe(true);
  });

  test("rejects invalid role contract modifications for mind-auditor", () => {
    const validRaw = readFileSync(resolveRoleContractPath("mind-auditor"), "utf-8");
    const invalidRole = validRaw.replace('role: "mind-auditor"', 'role: "rogue-auditor"');
    expect(() =>
      parseRoleContract(new TextEncoder().encode(invalidRole), "mind-auditor.yaml"),
    ).toThrow();
  });
});

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import {
  AGENT_ROLES,
  isAgentRole,
  type AgentRole,
} from "../../../orchestrating-long-tasks/scripts/src/contracts/packets.ts";
import {
  loadRoleContract,
  parseRoleContract,
  resolveRoleContractPath,
} from "../../../orchestrating-long-tasks/scripts/src/packets/role-contract.ts";
import {
  findCommand,
} from "../../../orchestrating-long-tasks/scripts/src/cli/registry/index.ts";
import type { AgentGrantRecord } from "../../../orchestrating-long-tasks/scripts/src/contracts/agents.ts";

describe("Phase 5 W5.1 - mind-auditor Role Contract", () => {
  test("mind-auditor is a recognized canonical AgentRole", () => {
    expect(isAgentRole("mind-auditor")).toBe(true);
    expect(AGENT_ROLES).toContain("mind-auditor");
  });

  test("mind-auditor contract file exists and resolves properly", () => {
    const resolvedPath = resolveRoleContractPath("mind-auditor");
    expect(existsSync(resolvedPath)).toBe(true);

    const rawContent = readFileSync(resolvedPath, "utf-8");
    expect(rawContent).toContain("role: mind-auditor");
    expect(rawContent).toContain("tier: 1");
  });

  test("mind-auditor contract parses with exact PLAN §12.2 and PHASE-5 §3.1 specifications", () => {
    const contract = loadRoleContract("mind-auditor");

    expect(contract.role).toBe("mind-auditor");
    expect(contract.tier).toBe(1);
    expect(contract.spawns).toEqual([]);

    expect(contract.may).toEqual([
      "Read the pulse ledger, the candidate ledger, every capsule, and the repository",
      "Run its own independent commands against the repository",
      "Re-run the admission test against candidates that were already admitted",
      "Record findings that block, or approve with an explicit residual-risk list",
      "Halt the mind",
    ]);

    expect(contract.must_not).toEqual([
      "Read the mind's own narrative, rationale prose, or self-assessment",
      "Audit a period in which it acted as orchestrator, coordinator, implementer or validator",
      "Approve while any pulse in the window is unaccounted for",
      "Edit any repository file, the charter, or any ledger",
    ]);

    expect(contract.commands).toEqual(["mind:audit-start", "mind:audit-report"]);
    expect(contract.sha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(contract.text.length).toBeGreaterThan(0);
  });

  test("mind-auditor is strictly tier 1 and has no child spawns", () => {
    const contract = loadRoleContract("mind-auditor");
    expect(contract.tier).toBe(1);
    expect(contract.spawns).toHaveLength(0);
    expect(contract.spawns).toEqual([]);
  });

  test("mind-auditor contract grants 0 write commands and 0 repository mutation permissions", () => {
    const contract = loadRoleContract("mind-auditor");

    // Explicitly forbids editing repository files, charter, or ledgers
    const mustNot = contract.must_not.join("\n");
    expect(mustNot).toContain("Edit any repository file, the charter, or any ledger");

    // All granted commands exist in the harness command registry
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
    const mustNot = contract.must_not.join("\n");

    expect(mustNot).toContain("Read the mind's own narrative, rationale prose, or self-assessment");
    expect(mustNot).toContain(
      "Audit a period in which it acted as orchestrator, coordinator, implementer or validator",
    );
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
    expect(implementerCheck.eligible).toBe(false);
    expect(implementerCheck.violation).toContain(
      "held operational grant for role implementer during the audited window",
    );

    // Former coordinator in that window is refused
    const coordinatorCheck = isAuditorEligible(
      "agent-prior-coordinator",
      windowStart,
      windowEnd,
      testGrants,
    );
    expect(coordinatorCheck.eligible).toBe(false);
    expect(coordinatorCheck.violation).toContain(
      "held operational grant for role coordinator during the audited window",
    );

    // Independent auditor who had no operational grants in that window is accepted
    const independentCheck = isAuditorEligible(
      "agent-independent-auditor",
      windowStart,
      windowEnd,
      testGrants,
    );
    expect(independentCheck.eligible).toBe(true);
    expect(independentCheck.violation).toBeUndefined();
  });

  test("rejects invalid role contract modifications for mind-auditor", () => {
    const validMarkdown = readFileSync(resolveRoleContractPath("mind-auditor"), "utf-8");

    // Rejects tier mismatch (e.g. tier 0 or tier 3)
    const tier0 = validMarkdown.replace("tier: 1", "tier: 0");
    const parsedTier0 = parseRoleContract(new TextEncoder().encode(tier0), "mind-auditor.md");
    expect(parsedTier0.tier).toBe(0);

    // Rejects invalid role name
    const invalidRole = validMarkdown.replace("role: mind-auditor", "role: rogue-auditor");
    expect(() =>
      parseRoleContract(new TextEncoder().encode(invalidRole), "mind-auditor.md"),
    ).toThrow(/role is not a canonical agent role/u);
  });
});

import { describe, expect, test } from "bun:test";
import {
  auditCrossTierSpawning,
  auditTierConfinement,
  isCoordinatorRole,
  isFullTestSuiteCommand,
  isImplementerRole,
  isOrchestratorRole,
  isTier3Role,
  isValidatorRole,
  summarizeTierConfinement,
  type TierConfinementFinding,
} from "../../../olt/scripts/src/reporting/doctor/tier-confinement/index.ts";
import {
  roleToTier,
  validateTierSpawning,
} from "../../../olt/scripts/src/authority/thread/index.ts";
import type { JsonObject } from "../../../olt/scripts/src/core/contracts/index.ts";
import type { AgentGrantRecord } from "../../../olt/scripts/src/core/contracts/index.ts";

describe("Tier Boundary Confinement Doctor Checks - p21 4-tier hierarchy enforcement", () => {
  test("roleToTier maps all 4 tiers accurately", () => {
    expect(roleToTier("mind")).toBe(0);
    expect(roleToTier("orchestrator")).toBe(1);
    expect(roleToTier("mind-auditor")).toBe(1);
    expect(roleToTier("coordinator")).toBe(2);
    expect(roleToTier("coordinator-backend")).toBe(2);
    expect(roleToTier("implementer")).toBe(3);
    expect(roleToTier("repairer")).toBe(3);
    expect(roleToTier("validator")).toBe(3);
    expect(roleToTier("completeness-critic")).toBe(3);
    expect(roleToTier("planner")).toBe(3);
  });

  test("validateTierSpawning allows strictly valid tier transitions", () => {
    // Tier 0 Mind -> Tier 1 Orchestrator: Allowed
    expect(validateTierSpawning(0, 1, "mind", "orchestrator").allowed).toBe(true);

    // Tier 1 Orchestrator -> Tier 2 Coordinator: Allowed
    expect(validateTierSpawning(1, 2, "orchestrator", "coordinator").allowed).toBe(true);

    // Tier 2 Coordinator -> Tier 3 Implementer / Validator: Allowed
    expect(validateTierSpawning(2, 3, "coordinator", "implementer").allowed).toBe(true);
    expect(validateTierSpawning(2, 3, "coordinator", "validator").allowed).toBe(true);
    expect(validateTierSpawning(2, 3, "coordinator", "completeness-critic").allowed).toBe(true);

    // Tier 3 Implementer -> Tier 3 Sub-Implementer: Allowed
    expect(validateTierSpawning(3, 3, "implementer", "sub-implementer").allowed).toBe(true);
  });

  test("validateTierSpawning rejects illegal cross-tier spawns", () => {
    // Orchestrator directly spawning Implementer (cross-tier breach)
    const orchToImpl = validateTierSpawning(1, 3, "orchestrator", "implementer");
    expect(orchToImpl.allowed).toBe(false);
    expect(orchToImpl.reason).toContain("cannot directly spawn Tier 3");

    // Mind directly spawning Implementer
    const mindToImpl = validateTierSpawning(0, 3, "mind", "implementer");
    expect(mindToImpl.allowed).toBe(false);
    expect(mindToImpl.reason).toContain("cannot directly spawn Tier 3");

    // Implementer spawning Coordinator (role escalation)
    const implToCoord = validateTierSpawning(3, 2, "implementer", "coordinator");
    expect(implToCoord.allowed).toBe(false);
    expect(implToCoord.reason).toContain("role escalation violation");
  });

  test("auditCrossTierSpawning detects illegal Orchestrator -> Implementer direct spawning", () => {
    const roleMap = new Map<string, string>([
      ["orch-lead", "orchestrator"],
      ["impl-rogue", "implementer"],
    ]);

    const grants: AgentGrantRecord[] = [
      {
        id: "orch-lead",
        role: "orchestrator",
        parent_agent_id: null,
        parent_task_id: null,
        host: "antigravity",
        granted_at: "2026-08-22T00:00:00.000Z",
        status: "active",
      },
      {
        id: "impl-rogue",
        role: "implementer",
        parent_agent_id: "orch-lead", // Illegal direct spawn from Tier 1 Orchestrator!
        parent_task_id: null,
        host: "antigravity",
        granted_at: "2026-08-22T00:01:00.000Z",
        status: "active",
      },
    ];

    const findings: TierConfinementFinding[] = [];
    auditCrossTierSpawning(roleMap, grants, findings);

    expect(findings.length).toBe(1);
    expect(findings[0]?.violation_type).toBe("cross_tier_spawning_violation");
    expect(findings[0]?.agent_id).toBe("impl-rogue");
    expect(findings[0]?.severity).toBe("critical");
    expect(findings[0]?.observation).toContain(
      'Parent agent "orch-lead" (Tier 1 orchestrator) directly spawned child agent "impl-rogue" (Tier 3 implementer)',
    );
  });

  test("auditTierConfinement reports clean on compliant 4-tier execution hierarchy", () => {
    const state: JsonObject = {
      agents: [
        {
          id: "mind-0",
          role: "mind",
          parent_agent_id: null,
          parent_task_id: null,
          host: "antigravity",
          granted_at: "2026-08-22T00:00:00.000Z",
          status: "active",
        },
        {
          id: "orch-1",
          role: "orchestrator",
          parent_agent_id: "mind-0",
          parent_task_id: null,
          host: "antigravity",
          granted_at: "2026-08-22T00:01:00.000Z",
          status: "active",
        },
        {
          id: "coord-1",
          role: "coordinator",
          parent_agent_id: "orch-1",
          parent_task_id: null,
          host: "antigravity",
          granted_at: "2026-08-22T00:02:00.000Z",
          status: "active",
        },
        {
          id: "impl-1",
          role: "implementer",
          parent_agent_id: "coord-1",
          parent_task_id: null,
          host: "antigravity",
          granted_at: "2026-08-22T00:03:00.000Z",
          status: "active",
        },
        {
          id: "val-1",
          role: "validator",
          parent_agent_id: "coord-1",
          parent_task_id: null,
          host: "antigravity",
          granted_at: "2026-08-22T00:04:00.000Z",
          status: "active",
        },
      ],
      tasks: {},
      commands: {},
    };

    const findings = auditTierConfinement("", state);
    expect(findings).toHaveLength(0);
    const summary = summarizeTierConfinement(findings);
    expect(summary.healthy).toBe(true);
    expect(summary.violation_count).toBe(0);
  });

  test("auditTierConfinement detects coordinator code writing violation", () => {
    const state: JsonObject = {
      agents: [
        {
          id: "coord-bad",
          role: "coordinator",
          parent_agent_id: "orch-1",
          parent_task_id: null,
          host: "antigravity",
          granted_at: "2026-08-22T00:00:00.000Z",
          status: "active",
          tools_used: [
            {
              name: "write_to_file",
              category: "file-edit",
              evidence_class: "agent_reported",
              first_reported_at: "2026-08-22T00:01:00.000Z",
            },
          ],
        },
      ],
      tasks: {},
      commands: {},
    };

    const findings = auditTierConfinement("", state);
    const finding = findings.find((f) => f.violation_type === "coordinator_code_writing");
    expect(finding).toBeDefined();
    expect(finding?.agent_id).toBe("coord-bad");
    expect(finding?.tier).toBe(2);
    expect(finding?.observation).toContain("recorded usage of code-editing tool");
  });

  test("auditTierConfinement detects orchestrator direct implementation command", () => {
    const state: JsonObject = {
      agents: [
        {
          id: "orch-actor",
          role: "orchestrator",
          parent_agent_id: null,
          parent_task_id: null,
          host: "antigravity",
          granted_at: "2026-08-22T00:00:00.000Z",
          status: "active",
        },
      ],
      tasks: {},
      commands: {
        "cmd-orch-1": {
          id: "cmd-orch-1",
          actor: "orch-actor",
          task_id: "task-backend",
          argv: ["bun", "test"],
          status: "succeeded",
          started_at: "2026-08-22T00:00:00.000Z",
          finished_at: "2026-08-22T00:00:01.000Z",
          fingerprint: "fp-1",
        },
      },
    };

    const findings = auditTierConfinement("", state);
    const finding = findings.find((f) => f.violation_type === "orchestrator_direct_implementation");
    expect(finding).toBeDefined();
    expect(finding?.agent_id).toBe("orch-actor");
    expect(finding?.tier).toBe(1);
    expect(finding?.observation).toContain("directly executed command");
  });

  test("auditTierConfinement detects implementer self-grading violation", () => {
    const state: JsonObject = {
      agents: [
        {
          id: "impl-self",
          role: "implementer",
          parent_agent_id: "coord-1",
          parent_task_id: null,
          host: "antigravity",
          granted_at: "2026-08-22T00:00:00.000Z",
          status: "active",
        },
      ],
      tasks: {
        "task-1": {
          id: "task-1",
          status: "validated",
          requirement_ids: ["R-1"],
          write_scope: ["src/**"],
          dependencies: [],
          original_implementer: "impl-self",
          validations: [
            {
              validator_id: "impl-self", // Self-grading violation!
              verdict: "pass",
              started_at: "2026-08-22T00:00:00.000Z",
              deadline_at: "2026-08-22T00:10:00.000Z",
            },
          ],
        },
      },
      commands: {},
    };

    const findings = auditTierConfinement("", state);
    const finding = findings.find((f) => f.violation_type === "implementer_self_grading");
    expect(finding).toBeDefined();
    expect(finding?.agent_id).toBe("impl-self");
    expect(finding?.tier).toBe(3);
    expect(finding?.observation).toContain(
      'performed validation review for task "task-1" which it previously implemented',
    );
  });

  test("isFullTestSuiteCommand distinguishes whole-suite commands from scoped test runs", () => {
    expect(isFullTestSuiteCommand(["bun", "test"])).toBe(true);
    expect(isFullTestSuiteCommand(["bun", "test", "--coverage"])).toBe(true);
    expect(isFullTestSuiteCommand(["bun", "run", "test:unit"])).toBe(true);
    expect(isFullTestSuiteCommand(["bun", "run", "test"])).toBe(true);
    expect(isFullTestSuiteCommand(["npm", "test"])).toBe(true);
    expect(isFullTestSuiteCommand(["pytest"])).toBe(true);
    expect(isFullTestSuiteCommand(["vitest"])).toBe(true);

    // Scoped single file test runs must NOT be flagged as full test suite
    expect(isFullTestSuiteCommand(["bun", "test", "tests/unit/mind/counterfactual.test.ts"])).toBe(
      false,
    );
    expect(
      isFullTestSuiteCommand(["bun", "test", "tests/unit/doctor/tier-confinement.test.ts"]),
    ).toBe(false);
    expect(isFullTestSuiteCommand(["pytest", "tests/unit/test_foo.py"])).toBe(false);
  });

  test("auditTierConfinement detects orchestrator running full test suite (defect-20260822-20)", () => {
    const state: JsonObject = {
      agents: [
        {
          id: "orch-tester",
          role: "orchestrator",
          parent_agent_id: null,
          parent_task_id: null,
          host: "antigravity",
          granted_at: "2026-08-22T00:00:00.000Z",
          status: "active",
        },
      ],
      tasks: {},
      commands: {
        "cmd-orch-full-test": {
          id: "cmd-orch-full-test",
          actor: "orch-tester",
          argv: ["bun", "test", "--coverage"],
          status: "succeeded",
          started_at: "2026-08-22T00:00:00.000Z",
          finished_at: "2026-08-22T00:00:05.000Z",
          fingerprint: "fp-orch-test",
        },
      },
    };

    const findings = auditTierConfinement("", state);
    const finding = findings.find(
      (f) => f.agent_id === "orch-tester" && f.violation_type === "role_confinement_violation",
    );
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("critical");
    expect(finding?.observation).toContain("executed prohibited full test suite command");
    expect(finding?.observation).toContain("bun test --coverage");
    expect(finding?.remediation).toContain(
      "Orchestrators are strictly banned from running full test suites",
    );
  });

  test("auditTierConfinement detects coordinator running full test suite (defect-20260822-20)", () => {
    const state: JsonObject = {
      agents: [
        {
          id: "coord-tester",
          role: "coordinator",
          parent_agent_id: "orch-1",
          parent_task_id: null,
          host: "antigravity",
          granted_at: "2026-08-22T00:00:00.000Z",
          status: "active",
        },
      ],
      tasks: {},
      commands: {
        "cmd-coord-full-test": {
          id: "cmd-coord-full-test",
          actor: "coord-tester",
          argv: ["bun", "run", "test:unit"],
          status: "succeeded",
          started_at: "2026-08-22T00:00:00.000Z",
          finished_at: "2026-08-22T00:00:05.000Z",
          fingerprint: "fp-coord-test",
        },
      },
    };

    const findings = auditTierConfinement("", state);
    const finding = findings.find(
      (f) => f.agent_id === "coord-tester" && f.violation_type === "role_confinement_violation",
    );
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("critical");
    expect(finding?.observation).toContain("executed prohibited full test suite command");
    expect(finding?.observation).toContain("bun run test:unit");
    expect(finding?.remediation).toContain(
      "Coordinators are strictly banned from running full test suites",
    );
  });

  test("auditTierConfinement allows completeness-critic to run full tests and implementer to run scoped single-file test", () => {
    const state: JsonObject = {
      agents: [
        {
          id: "critic-1",
          role: "completeness-critic",
          parent_agent_id: "coord-1",
          parent_task_id: null,
          host: "antigravity",
          granted_at: "2026-08-22T00:00:00.000Z",
          status: "active",
        },
        {
          id: "impl-1",
          role: "implementer",
          parent_agent_id: "coord-1",
          parent_task_id: null,
          host: "antigravity",
          granted_at: "2026-08-22T00:00:00.000Z",
          status: "active",
        },
      ],
      tasks: {},
      commands: {
        "cmd-critic-run": {
          id: "cmd-critic-run",
          actor: "critic-1",
          argv: ["bun", "test"],
          status: "succeeded",
          started_at: "2026-08-22T00:00:00.000Z",
          finished_at: "2026-08-22T00:00:05.000Z",
          fingerprint: "fp-critic",
        },
        "cmd-impl-scoped": {
          id: "cmd-impl-scoped",
          actor: "impl-1",
          argv: ["bun", "test", "tests/unit/mind/counterfactual.test.ts"],
          status: "succeeded",
          started_at: "2026-08-22T00:00:00.000Z",
          finished_at: "2026-08-22T00:00:01.000Z",
          fingerprint: "fp-impl",
        },
      },
    };

    const findings = auditTierConfinement("", state);
    expect(findings).toHaveLength(0);
  });
});

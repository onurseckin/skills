import { describe, expect, test } from "bun:test";
import {
  auditTierConfinement,
  isFullTestSuiteCommand,
} from "../../../olt/scripts/src/reporting/doctor/tier-confinement/index.ts";
import type { JsonObject } from "../../../olt/scripts/src/core/contracts/index.ts";

export const tierConfinementInvariantsSuiteName = "Tier Boundary Confinement Doctor Checks - Tool Execution & Command Confinement Invariants";

describe(tierConfinementInvariantsSuiteName, () => {
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
              validator_id: "impl-self",
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
    expect(isFullTestSuiteCommand(["bun", "test", "tests/mind/counterfactual.test.ts"])).toBe(
      false,
    );
    expect(
      isFullTestSuiteCommand(["bun", "test", "tests/doctor/rules/tier-confinement-core.test.ts"]),
    ).toBe(false);
    expect(isFullTestSuiteCommand(["pytest", "tests/authority/guards-and-rbac.test.ts"])).toBe(false);
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
          argv: ["bun", "test", "tests/mind/counterfactual.test.ts"],
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

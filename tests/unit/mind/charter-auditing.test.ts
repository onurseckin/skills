import { describe, expect, test } from "bun:test";
import {
  CHARTER_AUDIT_PASSED,
  CHARTER_BUDGET_EXCEEDED,
  CHARTER_INTEGRITY_DRIFT,
  CHARTER_PROHIBITION_VIOLATION,
  CHARTER_SCOPE_VIOLATION,
  CHARTER_UNRESOLVED_GOALS,
  DEFECT_MIND_AUDITING_MISSING_STATE_CHARTER,
  auditCharterBudgetCompliance,
  auditCharterGoals,
  auditCharterIntegrity,
  auditCharterManifest,
  auditCharterProhibitions,
  auditCharterRepoRoots,
  auditLiveCharter,
  parseCharter,
} from "../../../olt/scripts/src/mind/auditing/charter-auditing.ts";
import {
  auditCharterGoals as barrelAuditCharterGoals,
  auditCharterManifest as barrelAuditCharterManifest,
} from "../../../olt/scripts/src/mind/auditing/index.ts";

describe("Charter Auditing Module (charter-auditing.ts)", () => {
  const SAMPLE_CHARTER_YAML = `
name: "mind"
role: "mind"
tier: 0
charter:
  identity: "Autonomous Mind supervisor"
  goals:
    - id: "G1"
      statement: "100% test coverage"
    - id: "G2"
      statement: "Zero type regressions"
  non_goals:
    - "Manual deployments"
  repo_roots:
    - "olt/"
    - "tests/"
  budgets:
    max_agents_in_flight: 4
    max_rounds_per_objective: 5
    wall_clock_ms_per_day: 14400000
    max_open_proposals: 3
  prohibitions: |
    Never modify role contracts unattended.
    Never push force to main branch.
`;

  test("exports canonical constants and defect reference", () => {
    expect(CHARTER_AUDIT_PASSED).toBe("CHARTER_AUDIT_PASSED");
    expect(CHARTER_UNRESOLVED_GOALS).toBe("CHARTER_UNRESOLVED_GOALS");
    expect(CHARTER_BUDGET_EXCEEDED).toBe("CHARTER_BUDGET_EXCEEDED");
    expect(CHARTER_INTEGRITY_DRIFT).toBe("CHARTER_INTEGRITY_DRIFT");
    expect(CHARTER_SCOPE_VIOLATION).toBe("CHARTER_SCOPE_VIOLATION");
    expect(CHARTER_PROHIBITION_VIOLATION).toBe("CHARTER_PROHIBITION_VIOLATION");
    expect(DEFECT_MIND_AUDITING_MISSING_STATE_CHARTER).toBe(
      "defect-mind-auditing-missing-state-charter",
    );
  });

  test("barrel index re-exports charter auditing functions cleanly", () => {
    expect(typeof barrelAuditCharterGoals).toBe("function");
    expect(typeof barrelAuditCharterManifest).toBe("function");
  });

  test("auditCharterGoals passes for defined goals and catches unmapped ones", () => {
    const charter = parseCharter(SAMPLE_CHARTER_YAML);

    const validResult = auditCharterGoals(charter, ["G1", "G2"]);
    expect(validResult.valid).toBe(true);
    expect(validResult.definedGoals).toEqual(["G1", "G2"]);
    expect(validResult.unmappedGoals).toEqual([]);
    expect(validResult.findings).toEqual([]);

    const invalidResult = auditCharterGoals(charter, ["G1", "G99"]);
    expect(invalidResult.valid).toBe(false);
    expect(invalidResult.unmappedGoals).toEqual(["G99"]);
    expect(invalidResult.findings.length).toBe(1);
    expect(invalidResult.findings[0]).toContain("G99");
  });

  test("auditCharterBudgetCompliance validates usage metrics against limits", () => {
    const charter = parseCharter(SAMPLE_CHARTER_YAML);

    const compliantResult = auditCharterBudgetCompliance(charter, {
      agentsInFlight: 2,
      roundsSpent: 3,
      wallClockMsSpent: 10000,
      openProposalsCount: 1,
    });
    expect(compliantResult.compliant).toBe(true);
    expect(compliantResult.violations).toEqual([]);

    const overLimitResult = auditCharterBudgetCompliance(charter, {
      agentsInFlight: 10,
      roundsSpent: 8,
      wallClockMsSpent: 20000000,
      openProposalsCount: 5,
    });
    expect(overLimitResult.compliant).toBe(false);
    expect(overLimitResult.violations.length).toBe(4);
  });

  test("auditCharterIntegrity detects unauthorized digest drift", () => {
    const shaA = "a".repeat(64);
    const shaB = "b".repeat(64);

    const matchResult = auditCharterIntegrity(shaA, shaA);
    expect(matchResult.intact).toBe(true);
    expect(matchResult.driftDetected).toBe(false);
    expect(matchResult.findings).toEqual([]);

    const unauthorizedDrift = auditCharterIntegrity(shaA, shaB, false);
    expect(unauthorizedDrift.intact).toBe(false);
    expect(unauthorizedDrift.driftDetected).toBe(true);
    expect(unauthorizedDrift.authorized).toBe(false);
    expect(unauthorizedDrift.findings.length).toBe(1);

    const authorizedDrift = auditCharterIntegrity(shaA, shaB, true);
    expect(authorizedDrift.intact).toBe(true);
    expect(authorizedDrift.driftDetected).toBe(true);
    expect(authorizedDrift.authorized).toBe(true);
    expect(authorizedDrift.findings).toEqual([]);
  });

  test("auditCharterRepoRoots checks paths against allowed roots", () => {
    const charter = parseCharter(SAMPLE_CHARTER_YAML);

    const validPaths = auditCharterRepoRoots(charter, [
      "olt/scripts/src/mind/auditing/index.ts",
      "tests/unit/mind/charter-auditing.test.ts",
    ]);
    expect(validPaths.valid).toBe(true);
    expect(validPaths.outOfBoundsPaths).toEqual([]);
    expect(validPaths.findings).toEqual([]);

    const invalidPaths = auditCharterRepoRoots(charter, [
      "olt/scripts/src/mind/auditing/index.ts",
      "external/unauthorized/file.ts",
    ]);
    expect(invalidPaths.valid).toBe(false);
    expect(invalidPaths.outOfBoundsPaths).toEqual(["external/unauthorized/file.ts"]);
    expect(invalidPaths.findings.length).toBe(1);
  });

  test("auditCharterProhibitions flags actions matching prohibited directives", () => {
    const charter = parseCharter(SAMPLE_CHARTER_YAML);

    const safeAction = auditCharterProhibitions(charter, "Run unit tests and format code");
    expect(safeAction.permitted).toBe(true);
    expect(safeAction.findings).toEqual([]);

    const prohibitedAction = auditCharterProhibitions(
      charter,
      "modify role contracts without approval",
    );
    expect(prohibitedAction.permitted).toBe(false);
    expect(prohibitedAction.matchedProhibitions.length).toBeGreaterThan(0);
    expect(prohibitedAction.findings.length).toBeGreaterThan(0);
  });

  test("auditCharterManifest compiles full audit report", () => {
    const report = auditCharterManifest(SAMPLE_CHARTER_YAML, {
      referencedGoals: ["G1"],
      touchedPaths: ["olt/scripts/src/mind/auditing/index.ts"],
      budgetUsage: { agentsInFlight: 2 },
    });

    expect(report.valid).toBe(true);
    expect(report.charterSha256.length).toBe(64);
    expect(report.goalAudit.valid).toBe(true);
    expect(report.integrityAudit.intact).toBe(true);
    expect(report.repoRootsAudit.valid).toBe(true);
    expect(report.budgetAudit?.compliant).toBe(true);
    expect(report.findings).toEqual([]);
    expect(typeof report.timestamp).toBe("string");
  });

  test("auditLiveCharter loads and audits repository charter", () => {
    const report = auditLiveCharter(process.cwd(), {
      referencedGoals: ["G1", "G2", "G3"],
      touchedPaths: ["olt/scripts/src/mind/auditing/index.ts"],
    });

    expect(report.charterSha256.length).toBe(64);
    expect(report.goalAudit.valid).toBe(true);
    expect(report.repoRootsAudit.valid).toBe(true);
  });
});

import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../olt/scripts/src/core/errors/index.ts";
import {
  CANONICAL_GOVERNANCE_CHARTER_PATH,
  CANONICAL_LIFECYCLE_CHARTER_PATH,
  DEFAULT_CHARTER_RELATIVE_PATH,
  DEFAULT_MIND_BUDGET,
  DEFAULT_PROHIBITIONS,
  DEFECT_REF,
  ERROR_CODE,
  assertGovernanceCharter,
  formatCharterSummary,
  getCharterGoal,
  hasCharterGoal,
  loadCharter,
  parseBudgetsObject,
  parseCharter,
  parseCharterFromYaml,
  parseCharterYaml,
  parseDurationOrNumber,
  resolveCharterPath,
  resolveGovernanceCharter,
  validateGovernanceCharter,
  verifyCharterIntegrity,
  type CharterGoal,
  type MindBudget,
  type MindBudgetOverrides,
  type ParsedCharter,
  type StabilityCheck,
} from "../../olt/scripts/src/mind/governance/charter.ts";
import * as governanceBarrel from "../../olt/scripts/src/mind/governance/index.ts";
import * as mindBarrel from "../../olt/scripts/src/mind/index.ts";
import { scratchRoot } from "../shared/scratch-root.ts";

describe("Mind Governance Charter Module (mind/governance/charter.ts)", () => {
  const SAMPLE_YAML = `
name: "mind"
role: "mind"
tier: 0
charter:
  identity: "Autonomous Mind supervising long-running task orchestration."
  goals:
    - id: "G1"
      statement: "100% test coverage"
    - id: "G2"
      statement: "Zero type regressions"
  non_goals:
    - "Modifying production secrets"
  repo_roots:
    - "olt/"
    - "tests/"
  stability:
    - command: "bun test"
      expectedExit: 0
  budgets:
    cadence: "infinite_borderless"
    infinite_cadence: true
    wall_clock_ms_per_day: "2h"
    base_interval_ms: "500ms"
  prohibitions: |
    Never push directly to default branch.
  escalation: "Escalate to on-call."
  open_questions:
    - "Should we add telemetry alerts?"
`;

  test("defect metadata and canonical path constants match specifications", () => {
    expect(DEFECT_REF).toBe("defect-stale-governance-charter-imports");
    expect(ERROR_CODE).toBe("STALE_GOVERNANCE_CHARTER_IMPORTS");
    expect(CANONICAL_GOVERNANCE_CHARTER_PATH).toBe("olt/scripts/src/mind/governance/charter.ts");
    expect(CANONICAL_LIFECYCLE_CHARTER_PATH).toBe(
      "olt/scripts/src/mind/lifecycle/charter/index.ts",
    );
  });

  test("parses structured YAML manifest into ParsedCharter", () => {
    const parsed = parseCharter(SAMPLE_YAML);
    expect(parsed.identity).toBe("Autonomous Mind supervising long-running task orchestration.");
    expect(parsed.goals.length).toBe(2);
    expect(parsed.goalIds).toEqual(["G1", "G2"]);
    expect(parsed.nonGoals).toEqual(["Modifying production secrets"]);
    expect(parsed.repoRoots).toEqual(["olt/", "tests/"]);
    expect(parsed.stability?.length).toBe(1);
    expect(parsed.budgets?.infinite_cadence).toBe(true);
    expect(parsed.budgets?.wall_clock_ms_per_day).toBe(2 * 60 * 60 * 1000);
    expect(parsed.budgets?.base_interval_ms).toBe(500);
    expect(parsed.prohibitions).toContain("Never push directly");
    expect(parsed.escalation).toBe("Escalate to on-call.");
    expect(parsed.openQuestions).toEqual(["Should we add telemetry alerts?"]);
    expect(parsed.sha256.length).toBe(64);
  });

  test("validates governance charter structures", () => {
    const parsed = parseCharter(SAMPLE_YAML);
    expect(validateGovernanceCharter(parsed)).toBe(true);
    expect(() => assertGovernanceCharter(parsed)).not.toThrow();

    const invalid = {
      ...parsed,
      identity: "",
    };
    expect(validateGovernanceCharter(invalid)).toBe(false);
    expect(() => assertGovernanceCharter(invalid)).toThrow(HarnessError);
  });

  test("resolves goal queries with getCharterGoal and hasCharterGoal", () => {
    const parsed = parseCharter(SAMPLE_YAML);
    expect(hasCharterGoal(parsed, "G1")).toBe(true);
    expect(hasCharterGoal(parsed, "g2")).toBe(true);
    expect(hasCharterGoal(parsed, "G99")).toBe(false);

    const goal = getCharterGoal(parsed, "g1");
    expect(goal?.id).toBe("G1");
    expect(goal?.statement).toBe("100% test coverage");
    expect(getCharterGoal(parsed, "G99")).toBeUndefined();
  });

  test("formats charter summary cleanly", () => {
    const parsed = parseCharter(SAMPLE_YAML);
    const summary = formatCharterSummary(parsed);
    expect(summary).toContain("Autonomous Mind");
    expect(summary).toContain("G1: 100% test coverage");
    expect(summary).toContain("Repo Roots: [olt/, tests/]");
  });

  test("resolves and loads live charter from repository root", () => {
    const liveCharter = loadCharter(process.cwd());
    expect(liveCharter.identity.length).toBeGreaterThan(0);
    expect(liveCharter.goalIds.length).toBeGreaterThan(0);
    expect(liveCharter.repoRoots.length).toBeGreaterThan(0);

    const govCharter = resolveGovernanceCharter(process.cwd());
    expect(govCharter.sha256).toBe(liveCharter.sha256);
  });

  test("verifies charter sha256 integrity", () => {
    const liveCharter = loadCharter(process.cwd());
    const result = verifyCharterIntegrity(process.cwd(), liveCharter.sha256);
    expect(result.valid).toBe(true);
    expect(result.actualSha256).toBe(liveCharter.sha256);

    const badResult = verifyCharterIntegrity(
      process.cwd(),
      "bad-sha256-hash-value-00000000000000000000000000000000000000000000000000",
    );
    expect(badResult.valid).toBe(false);
  });

  test("resolves charter path with custom relative paths in scratch environment", () => {
    const repo = scratchRoot(import.meta.path, "gov-charter");
    mkdirSync(join(repo, "olt", "agents"), { recursive: true });
    const charterFile = join(repo, "olt", "agents", "mind.yaml");
    writeFileSync(charterFile, SAMPLE_YAML, "utf-8");

    const resolved = resolveCharterPath(repo);
    expect(resolved).toBe(charterFile);

    const resolvedCustom = resolveCharterPath(repo, "olt/agents/mind.yaml");
    expect(resolvedCustom).toBe(charterFile);
  });

  test("parses duration and budget overrides accurately", () => {
    expect(parseDurationOrNumber("30s")).toBe(30000);
    expect(parseDurationOrNumber("15m")).toBe(900000);
    expect(parseDurationOrNumber("1h")).toBe(3600000);
    expect(parseDurationOrNumber("1d")).toBe(86400000);
    expect(parseDurationOrNumber("unlimited")).toBeNull();
    expect(parseDurationOrNumber(1234)).toBe(1234);

    const parsedBudgets = parseBudgetsObject({
      cadence: "infinite_borderless",
      wall_clock_ms_per_day: "1h",
      base_interval_ms: 100,
    });
    expect(parsedBudgets.infinite_cadence).toBe(true);
    expect(parsedBudgets.wall_clock_ms_per_day).toBe(3600000);
    expect(parsedBudgets.base_interval_ms).toBe(100);
  });

  test("throws HarnessError on invalid inputs", () => {
    expect(() => parseCharter("")).toThrow(HarnessError);
    expect(() => parseDurationOrNumber("invalid-duration")).toThrow(HarnessError);
    expect(() => resolveGovernanceCharter("/non/existent/directory/path/here")).toThrow(
      HarnessError,
    );
  });

  test("exports match between governance/charter.ts, governance/index.ts, and mind/index.ts", () => {
    expect(governanceBarrel.parseCharter).toBe(parseCharter);
    expect(governanceBarrel.loadCharter).toBe(loadCharter);
    expect(governanceBarrel.resolveCharterPath).toBe(resolveCharterPath);
    expect(governanceBarrel.DEFAULT_MIND_BUDGET).toBe(DEFAULT_MIND_BUDGET);
    expect(governanceBarrel.DEFAULT_PROHIBITIONS).toBe(DEFAULT_PROHIBITIONS);
    expect(governanceBarrel.DEFECT_REF).toBe(DEFECT_REF);
    expect(governanceBarrel.discoverAndCalibrateRepoPolicy).toBeDefined();
    expect(governanceBarrel.auditRepoGovernanceCoverage).toBeDefined();
    expect(governanceBarrel.calibrateRepoGovernance).toBeDefined();
    expect(governanceBarrel.auditGovernanceReadiness).toBeDefined();
    expect(mindBarrel.governance).toBeDefined();
    expect(mindBarrel.charter).toBeDefined();
  });

  test("discovers toolchain and audits repo governance coverage in scratch repository", () => {
    const scratch = scratchRoot(import.meta.path, "governance-discovery-test");
    mkdirSync(join(scratch, ".olt"), { recursive: true });
    writeFileSync(
      join(scratch, "package.json"),
      JSON.stringify({ name: "test-repo", scripts: { test: "bun test" } }),
    );

    const discovery = governanceBarrel.discoverAndCalibrateRepoPolicy(scratch);
    expect(discovery.repoRoot).toBe(scratch);
    expect(discovery.calibratedPolicy).toBeDefined();

    const coverage = governanceBarrel.auditRepoGovernanceCoverage(scratch);
    expect(coverage.repoRoot).toBe(scratch);
    expect(coverage.policyPresent).toBe(true);
  });
});

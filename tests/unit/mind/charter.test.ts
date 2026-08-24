import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";
import {
  DEFAULT_MIND_BUDGET,
  DEFAULT_PROHIBITIONS,
  parseCharter,
  resolveCharterPath,
} from "../../../olt/scripts/src/mind/charter.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

describe("Mind Charter Module (charter.ts)", () => {
  const VALID_CHARTER = `
# System Charter

## identity
Autonomous Mind supervising orchestration.

## goals
- G1: 100% test coverage
- G2: Zero type regressions

## non-goals
- Modifying production secrets
- Deploying without owner approval

## repo_roots
- \`src/\`
- \`docs/\`

## stability
- \`bun test\` -> exit 0
- \`bun tsc\` -> exit 0

## budgets
- cadence: infinite_borderless
- concurrency_model: topological_work_span
- infinite_cadence: true
- pulses_per_day: unlimited
- wall_clock_ms_per_day: 4h
- max_agents_in_flight: 4
- max_rounds_per_objective: 5
- base_interval_ms: 500ms
- max_interval_ms: 30s
- max_pause_interval_ms: 10m
- pulse_deadline_ms: 1d
- max_open_proposals: 3
- quiet_hours: 23:00-05:00

## prohibitions
Never modify role contracts unattended.

## escalation
Ping the on-call engineer when 3 consecutive crashed pulses are observed.

## open_questions
- Should we add Slack notification integration?
- Unordered open question line
`;

  test("parses a comprehensive valid charter markdown", () => {
    const parsed = parseCharter(VALID_CHARTER);

    expect(parsed.identity).toBe("Autonomous Mind supervising orchestration.");
    expect(parsed.goals.length).toBe(2);
    expect(parsed.goals[0].id).toBe("G1");
    expect(parsed.goals[0].statement).toBe("100% test coverage");
    expect(parsed.goalIds).toEqual(["G1", "G2"]);
    expect(parsed.nonGoals.length).toBe(2);
    expect(parsed.repoRoots).toEqual(["src/", "docs/"]);

    expect(parsed.stability?.length).toBe(2);
    expect(parsed.stability?.[0].command).toBe("bun test");
    expect(parsed.stability?.[0].expectedExit).toBe(0);

    expect(parsed.budgets).toBeDefined();
    expect(parsed.budgets?.infinite_cadence).toBe(true);
    expect(parsed.budgets?.pulses_per_day).toBeNull();
    expect(parsed.budgets?.wall_clock_ms_per_day).toBe(4 * 60 * 60 * 1000);
    expect(parsed.budgets?.base_interval_ms).toBe(500);
    expect(parsed.budgets?.max_interval_ms).toBe(30 * 1000);
    expect(parsed.budgets?.max_pause_interval_ms).toBe(10 * 60 * 1000);
    expect(parsed.budgets?.pulse_deadline_ms).toBe(24 * 60 * 60 * 1000);
    expect(parsed.budgets?.max_agents_in_flight).toBe(4);
    expect(parsed.budgets?.max_rounds_per_objective).toBe(5);
    expect(parsed.budgets?.max_open_proposals).toBe(3);
    expect(parsed.budgets?.quiet_hours).toBe("23:00-05:00");

    expect(parsed.prohibitions).toContain("Never modify role contracts");
    expect(parsed.escalation).toContain("Ping the on-call engineer");
    expect(parsed.openQuestions?.length).toBe(2);
    expect(parsed.sha256.length).toBe(64);
  });

  test("supports repo_roots and goals with unbracketed/plain items and open_questions", () => {
    const charter = `
## identity
Simple Mind

## goals
- G1: Goal One
- [G2] - Goal Two

## non-goals
- Nothing

## repo_roots
- src/
- tests/

## open_questions
Plain open question without bullet
`;
    const parsed = parseCharter(charter);
    expect(parsed.goals.length).toBe(2);
    expect(parsed.goals[0].id).toBe("G1");
    expect(parsed.goals[0].statement).toBe("Goal One");
    expect(parsed.repoRoots).toEqual(["src/", "tests/"]);
    expect(parsed.openQuestions).toContain("Plain open question without bullet");
  });

  test("throws HarnessError on invalid budget formats", () => {
    const charterWithBadBudget = `
## identity
Mind

## goals
- G1: Goal

## non-goals
- Non-goal

## repo_roots
- \`src/\`

## budgets
- wall_clock_ms_per_day: invalid-duration-format
`;
    expect(() => parseCharter(charterWithBadBudget)).toThrow(HarnessError);
  });

  test("throws HarnessError on missing mandatory sections", () => {
    expect(() => parseCharter("")).toThrow(HarnessError);

    // Missing identity
    expect(() =>
      parseCharter(`
## goals
- G1: Goal
## non-goals
- Non-goal
## repo_roots
- \`src/\`
`),
    ).toThrow(HarnessError);

    // Empty identity
    expect(() =>
      parseCharter(`
## identity
## goals
- G1: Goal
## non-goals
- Non-goal
## repo_roots
- \`src/\`
`),
    ).toThrow(HarnessError);

    // Missing goals
    expect(() =>
      parseCharter(`
## identity
Mind
## non-goals
- Non-goal
## repo_roots
- \`src/\`
`),
    ).toThrow(HarnessError);

    // Empty goals
    expect(() =>
      parseCharter(`
## identity
Mind
## goals
## non-goals
- Non-goal
## repo_roots
- \`src/\`
`),
    ).toThrow(HarnessError);

    // Missing non-goals
    expect(() =>
      parseCharter(`
## identity
Mind
## goals
- G1: Goal
## repo_roots
- \`src/\`
`),
    ).toThrow(HarnessError);

    // Empty non-goals
    expect(() =>
      parseCharter(`
## identity
Mind
## goals
- G1: Goal
## non-goals
## repo_roots
- \`src/\`
`),
    ).toThrow(HarnessError);

    // Missing repo_roots
    expect(() =>
      parseCharter(`
## identity
Mind
## goals
- G1: Goal
## non-goals
- Non-goal
`),
    ).toThrow(HarnessError);

    // Empty repo_roots
    expect(() =>
      parseCharter(`
## identity
Mind
## goals
- G1: Goal
## non-goals
- Non-goal
## repo_roots
`),
    ).toThrow(HarnessError);
  });

  test("resolveCharterPath finds charter in docs or fallback path", () => {
    const repo = scratchRoot(import.meta.path, "charter-res");
    mkdirSync(join(repo, "docs"), { recursive: true });
    const docsCharter = join(repo, "docs", "CHARTER.md");
    writeFileSync(docsCharter, VALID_CHARTER, "utf-8");

    const resolved = resolveCharterPath(repo, "CHARTER.md");
    expect(resolved).toBe(docsCharter);

    const resolvedWithRoots = resolveCharterPath(repo, "CHARTER.md", [join(repo, "docs")]);
    expect(resolvedWithRoots).toBe(docsCharter);

    const fallback = resolveCharterPath(repo, "NON_EXISTENT_CHARTER.md");
    expect(fallback).toBe(join(repo, "NON_EXISTENT_CHARTER.md"));
  });

  test("exports DEFAULT_MIND_BUDGET and DEFAULT_PROHIBITIONS", () => {
    expect(DEFAULT_MIND_BUDGET.cadence).toBe("infinite_borderless");
    expect(DEFAULT_MIND_BUDGET.concurrency_model).toBe("topological_work_span");
    expect(DEFAULT_MIND_BUDGET.infinite_cadence).toBe(true);
    expect(DEFAULT_PROHIBITIONS).toContain("NEVER, unattended, at any tier:");
  });
});

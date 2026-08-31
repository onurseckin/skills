import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../olt/scripts/src/core/errors/index.ts";
import {
  DEFAULT_CHARTER_RELATIVE_PATH,
  DEFAULT_MIND_BUDGET,
  DEFAULT_PROHIBITIONS,
  loadCharter,
  parseCharter,
  parseCharterYaml,
  resolveCharterPath,
} from "../../olt/scripts/src/mind/lifecycle/charter/index.ts";
import { scratchRoot } from "../shared/scratch-root.ts";

describe("Mind Charter Module (charter.ts) - Pure YAML Manifest SSoT", () => {
  const VALID_MIND_YAML = `
name: "mind"
role: "mind"
tier: 0
charter:
  identity: "Autonomous Mind supervising long-running task orchestration and maintaining codebase health."
  goals:
    - id: "G1"
      statement: "100% test coverage"
    - id: "G2"
      statement: "Zero type regressions"
  cognitive_pillars:
    - "Pillar 1: CLI-First Token Leverage"
    - "Pillar 2: Visual Truth & Radical Observability"
  non_goals:
    - "Modifying production secrets"
    - "Deploying without owner approval"
  repo_roots:
    - "src/"
    - "docs/"
  stability:
    - command: "bun test"
      expectedExit: 0
    - command: "bun tsc"
      expectedExit: 0
  budgets:
    cadence: "infinite_borderless"
    concurrency_model: "topological_work_span"
    infinite_cadence: true
    pulses_per_day: "unlimited"
    wall_clock_ms_per_day: "4h"
    max_agents_in_flight: 4
    max_rounds_per_objective: 5
    base_interval_ms: "500ms"
    max_interval_ms: "30s"
    max_pause_interval_ms: "10m"
    pulse_deadline_ms: "1d"
    max_open_proposals: 3
    quiet_hours: "23:00-05:00"
  prohibitions: |
    Never modify role contracts unattended.
  escalation: "Ping the on-call engineer when 3 consecutive crashed pulses are observed."
  open_questions:
    - "Should we add Slack notification integration?"
    - "Unordered open question line"
`;

  test("parses a comprehensive valid YAML agent manifest", () => {
    const parsed = parseCharter(VALID_MIND_YAML);

    expect(parsed.identity).toBe(
      "Autonomous Mind supervising long-running task orchestration and maintaining codebase health.",
    );
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

  test("parses packaged olt/agents/mind.yaml directly", () => {
    const rawYaml = readFileSync(join(process.cwd(), "olt", "agents", "mind.yaml"), "utf-8");
    const parsed = parseCharter(rawYaml);

    expect(parsed.identity).toContain(
      "The autonomous maintenance, product evolution, and strategic innovation mind",
    );
    expect(parsed.goals.length).toBe(3);
    expect(parsed.goalIds).toEqual(["G1", "G2", "G3"]);
    expect(parsed.goals[0].statement).toContain("0 TypeScript any");
    expect(parsed.goals[1].statement).toContain("Relentlessly perfectionize existing applications");
    expect(parsed.goals[2].statement).toContain(
      "Continuously act as an autonomous Creative Product Manager",
    );
    expect(parsed.repoRoots).toEqual(["."]);
    expect(parsed.stability?.length).toBe(2);
    expect(parsed.stability?.[0].command).toBe("bun test tests/unit");
    expect(parsed.stability?.[1].command).toBe("bun run typecheck");
  });

  test("loadCharter helper loads and parses mind.yaml from repository root", () => {
    const parsed = loadCharter(process.cwd());
    expect(parsed.goalIds).toEqual(["G1", "G2", "G3"]);
    expect(parsed.repoRoots).toEqual(["."]);
  });

  test("throws HarnessError on invalid budget formats", () => {
    const manifestWithBadBudget = `
identity: "Mind"
goals:
  - id: "G1"
    statement: "Goal"
non_goals:
  - "Non-goal"
repo_roots:
  - "src/"
budgets:
  wall_clock_ms_per_day: "invalid-duration-format"
`;
    expect(() => parseCharter(manifestWithBadBudget)).toThrow(HarnessError);
  });

  test("throws HarnessError on missing mandatory sections", () => {
    expect(() => parseCharter("")).toThrow(HarnessError);

    // Missing identity
    expect(() =>
      parseCharter(`
goals:
  - id: "G1"
    statement: "Goal"
non_goals:
  - "Non-goal"
repo_roots:
  - "src/"
`),
    ).toThrow(HarnessError);

    // Empty identity
    expect(() =>
      parseCharter(`
identity: ""
goals:
  - id: "G1"
    statement: "Goal"
non_goals:
  - "Non-goal"
repo_roots:
  - "src/"
`),
    ).toThrow(HarnessError);

    // Missing goals
    expect(() =>
      parseCharter(`
identity: "Mind"
non_goals:
  - "Non-goal"
repo_roots:
  - "src/"
`),
    ).toThrow(HarnessError);

    // Empty goals
    expect(() =>
      parseCharter(`
identity: "Mind"
goals: []
non_goals:
  - "Non-goal"
repo_roots:
  - "src/"
`),
    ).toThrow(HarnessError);

    // Missing non-goals
    expect(() =>
      parseCharter(`
identity: "Mind"
goals:
  - id: "G1"
    statement: "Goal"
repo_roots:
  - "src/"
`),
    ).toThrow(HarnessError);

    // Empty non-goals
    expect(() =>
      parseCharter(`
identity: "Mind"
goals:
  - id: "G1"
    statement: "Goal"
non_goals: []
repo_roots:
  - "src/"
`),
    ).toThrow(HarnessError);
  });

  test("defaults repo_roots to ['.'] when omitted or empty", () => {
    const withoutRepoRoots = `
identity: "Mind"
goals:
  - id: "G1"
    statement: "Goal"
non_goals:
  - "Non-goal"
`;
    const parsed = parseCharter(withoutRepoRoots);
    expect(parsed.repoRoots).toEqual(["."]);

    const withEmptyRepoRoots = `
identity: "Mind"
goals:
  - id: "G1"
    statement: "Goal"
non_goals:
  - "Non-goal"
repo_roots: []
`;
    const parsedEmpty = parseCharter(withEmptyRepoRoots);
    expect(parsedEmpty.repoRoots).toEqual(["."]);
  });

  test("resolveCharterPath finds mind.yaml as canonical SSoT", () => {
    const repo = scratchRoot(import.meta.path, "charter-res");
    mkdirSync(join(repo, "olt", "agents"), { recursive: true });
    const mindYamlPath = join(repo, "olt", "agents", "mind.yaml");
    writeFileSync(mindYamlPath, VALID_MIND_YAML, "utf-8");

    const resolvedDefault = resolveCharterPath(repo);
    expect(resolvedDefault).toBe(mindYamlPath);

    const resolvedExplicit = resolveCharterPath(repo, "olt/agents/mind.yaml");
    expect(resolvedExplicit).toBe(mindYamlPath);

    const fallback = resolveCharterPath(repo, "custom/non-existent.yaml");
    expect(fallback).toBe(join(repo, "custom/non-existent.yaml"));
  });

  test("exports DEFAULT_CHARTER_RELATIVE_PATH, DEFAULT_MIND_BUDGET and DEFAULT_PROHIBITIONS", () => {
    expect(DEFAULT_CHARTER_RELATIVE_PATH).toBe("olt/agents/mind.yaml");
    expect(DEFAULT_MIND_BUDGET.cadence).toBe("infinite_borderless");
    expect(DEFAULT_MIND_BUDGET.concurrency_model).toBe("topological_work_span");
    expect(DEFAULT_MIND_BUDGET.infinite_cadence).toBe(true);
    expect(DEFAULT_PROHIBITIONS).toContain("NEVER, unattended, at any tier:");
  });
});

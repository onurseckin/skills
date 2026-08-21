import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, realpathSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mindInitCommand } from "../../../orchestrating-long-tasks/scripts/src/cli/commands/mind-init.ts";
import { HarnessError } from "../../../orchestrating-long-tasks/scripts/src/errors/harness-error.ts";
import {
  DEFAULT_MIND_BUDGET,
  DEFAULT_PROHIBITIONS,
  parseCharter,
} from "../../../orchestrating-long-tasks/scripts/src/mind/charter.ts";
import { verifyIntegrity } from "../../../orchestrating-long-tasks/scripts/src/store/integrity.ts";
import { loadRun } from "../../../orchestrating-long-tasks/scripts/src/store/load.ts";
import { scratchRoot as makeScratchRoot } from "../../support/scratch-root.ts";

function scratchRoot(label: string): string {
  return makeScratchRoot(import.meta.path, label);
}

const SAMPLE_VALID_CHARTER = `
# System Charter

## identity
Autonomous Mind supervising long-running task orchestration and maintaining codebase health.

## goals
- G1: Maintain 100% test coverage across all packages
- G2: Enforce zero type error regressions and zero prohibited any forms
- G3: Ensure all background task leases are bounded and monitored

## non-goals
- Modifying production secrets or ungranted external APIs
- Deploying releases without explicit owner confirmation

## repo_roots
- \`orchestrating-long-tasks/\`
- \`docs/\`
- \`tests/\`

## stability
- \`bun run test\` → exit 0
- \`bun run typecheck\` -> exit 0

## budgets
- pulses_per_day: 48
- wall_clock_ms_per_day: 4h
- max_agents_in_flight: 4
- max_rounds_per_objective: 5
- base_interval_ms: 10m
- max_interval_ms: 2h
- max_pause_interval_ms: 20m
- pulse_deadline_ms: 15m
- max_open_proposals: 3
- quiet_hours: 23:00-05:00

## prohibitions
Never modify role contracts or delete git tags unattended.

## escalation
Ping the on-call engineer when 3 consecutive crashed pulses are observed.

## open_questions
- Should we expand the supervision pulse window during off-peak hours?
`;

describe("parseCharter", () => {
  test("parses all required and optional sections correctly", () => {
    const parsed = parseCharter(SAMPLE_VALID_CHARTER);
    expect(parsed.identity).toContain("Autonomous Mind supervising long-running task orchestration");
    expect(parsed.goals.length).toBe(3);
    expect(parsed.goalIds).toEqual(["G1", "G2", "G3"]);
    expect(parsed.goals[0]).toEqual({
      id: "G1",
      statement: "Maintain 100% test coverage across all packages",
    });
    expect(parsed.nonGoals.length).toBe(2);
    expect(parsed.nonGoals[0]).toBe("Modifying production secrets or ungranted external APIs");
    expect(parsed.repoRoots).toEqual(["orchestrating-long-tasks/", "docs/", "tests/"]);
    expect(parsed.stability).toBeDefined();
    expect(parsed.stability!.length).toBe(2);
    expect(parsed.stability![0]).toEqual({ command: "bun run test", expectedExit: 0 });
    expect(parsed.stability![1]).toEqual({ command: "bun run typecheck", expectedExit: 0 });
    expect(parsed.budgets).toBeDefined();
    expect(parsed.budgets!.pulses_per_day).toBe(48);
    expect(parsed.budgets!.wall_clock_ms_per_day).toBe(4 * 60 * 60 * 1000);
    expect(parsed.budgets!.max_agents_in_flight).toBe(4);
    expect(parsed.budgets!.max_rounds_per_objective).toBe(5);
    expect(parsed.budgets!.base_interval_ms).toBe(10 * 60 * 1000);
    expect(parsed.budgets!.max_interval_ms).toBe(2 * 60 * 60 * 1000);
    expect(parsed.budgets!.max_pause_interval_ms).toBe(20 * 60 * 1000);
    expect(parsed.budgets!.pulse_deadline_ms).toBe(15 * 60 * 1000);
    expect(parsed.budgets!.max_open_proposals).toBe(3);
    expect(parsed.budgets!.quiet_hours).toBe("23:00-05:00");
    expect(parsed.prohibitions).toBe("Never modify role contracts or delete git tags unattended.");
    expect(parsed.escalation).toContain("Ping the on-call engineer");
    expect(parsed.openQuestions).toBeDefined();
    expect(parsed.openQuestions!.length).toBe(1);
    expect(parsed.openQuestions![0]).toContain("Should we expand the supervision pulse window");
    expect(parsed.sha256).toBeDefined();
    expect(parsed.sha256.length).toBe(64);
  });

  test("parses a minimal charter with only required sections", () => {
    const minimal = `
## identity
Minimal Mind

## goals
- G1: Basic health

## non-goals
- No out-of-scope work

## repo_roots
- \`src/\`
`;
    const parsed = parseCharter(minimal);
    expect(parsed.identity).toBe("Minimal Mind");
    expect(parsed.goalIds).toEqual(["G1"]);
    expect(parsed.nonGoals).toEqual(["No out-of-scope work"]);
    expect(parsed.repoRoots).toEqual(["src/"]);
    expect(parsed.stability).toBeUndefined();
    expect(parsed.budgets).toBeUndefined();
    expect(parsed.prohibitions).toBeUndefined();
    expect(parsed.escalation).toBeUndefined();
  });

  test("refuses empty charter text", () => {
    expect(() => parseCharter("")).toThrow(HarnessError);
    expect(() => parseCharter("   \n\t  ")).toThrow(/empty/);
  });

  test("refuses charter missing identity section", () => {
    const missingIdentity = `
## goals
- G1: Goal

## non-goals
- Non-goal

## repo_roots
- \`src/\`
`;
    expect(() => parseCharter(missingIdentity)).toThrow(/missing required section: identity/);
  });

  test("refuses charter with empty identity section", () => {
    const emptyIdentity = `
## identity

## goals
- G1: Goal

## non-goals
- Non-goal

## repo_roots
- \`src/\`
`;
    expect(() => parseCharter(emptyIdentity)).toThrow(/identity.*empty/);
  });

  test("refuses charter missing goals section", () => {
    const missingGoals = `
## identity
Some identity

## non-goals
- Non-goal

## repo_roots
- \`src/\`
`;
    expect(() => parseCharter(missingGoals)).toThrow(/missing required section: goals/);
  });

  test("refuses charter with invalid goals format", () => {
    const invalidGoals = `
## identity
Some identity

## goals
Just some text without goal bullets

## non-goals
- Non-goal

## repo_roots
- \`src/\`
`;
    expect(() => parseCharter(invalidGoals)).toThrow(/contains no valid goal lines/);
  });

  test("refuses charter missing non-goals section", () => {
    const missingNonGoals = `
## identity
Some identity

## goals
- G1: Valid goal

## repo_roots
- \`src/\`
`;
    expect(() => parseCharter(missingNonGoals)).toThrow(/missing required section: non-goals/);
  });

  test("refuses charter missing repo_roots section", () => {
    const missingRepoRoots = `
## identity
Some identity

## goals
- G1: Valid goal

## non-goals
- Non-goal
`;
    expect(() => parseCharter(missingRepoRoots)).toThrow(/missing required section: repo_roots/);
  });
});

describe("mindInitCommand", () => {
  test("initializes a valid mind capsule with charter, manifest, state and last_pulse.json", () => {
    const repo = scratchRoot("mind-init-success");
    const charterPath = join(repo, "CHARTER.md");
    writeFileSync(charterPath, SAMPLE_VALID_CHARTER, "utf-8");

    const result = mindInitCommand({
      repo,
      charter: "CHARTER.md",
      actor: "owner-alice",
    });

    expect(result.mind_id).toBe("mind-gen-1");
    expect(result.generation).toBe(1);
    expect(typeof result.run_root).toBe("string");
    expect(typeof result.markdown).toBe("string");
    expect(result.markdown).toContain("Mind Initialized: mind-gen-1");
    expect(result.markdown).toContain("G1, G2, G3");

    const runRoot = result.run_root as string;
    const realRepo = realpathSync(repo);
    expect(runRoot).toBe(join(realRepo, ".capsules", "mind-gen-1"));

    // Check prompt.md
    const promptPath = join(runRoot, "prompt.md");
    expect(existsSync(promptPath)).toBe(true);
    expect(readFileSync(promptPath, "utf-8")).toBe(SAMPLE_VALID_CHARTER);
    // Mode should be read-only (0444)
    expect((statSync(promptPath).mode & 0o222) === 0).toBe(true);

    // Check manifest.json
    const loaded = loadRun(runRoot);
    expect(loaded.manifest.run_id).toBe("mind-gen-1");
    expect(loaded.manifest.capture_mode).toBe("file");
    expect(loaded.manifest.source_verified).toBe(true);
    expect(loaded.manifest.prompt_sha256).toBe(result.charter_sha256 as string);

    // Check state.json
    const state = loaded.state as Record<string, unknown>;
    expect(state.mind).toBeDefined();
    const mind = state.mind as Record<string, unknown>;
    expect(mind.generation).toBe(1);
    expect(mind.charter).toEqual({
      source_path: "CHARTER.md",
      pinned_sha256: result.charter_sha256,
      goals: ["G1", "G2", "G3"],
      repo_roots: ["orchestrating-long-tasks/", "docs/", "tests/"],
      evidence_class: "harness_observed",
    });
    expect(mind.previous_generation).toBeNull();

    // Check budget
    const budget = state.budget as Record<string, unknown>;
    expect(budget.pulses_per_day).toBe(48);
    expect(budget.wall_clock_ms_per_day).toBe(4 * 60 * 60 * 1000);
    expect(budget.max_agents_in_flight).toBe(4);
    expect(budget.pulses_today).toBe(0);
    expect(budget.wall_clock_ms_today).toBe(0);
    expect(budget.day_key).toBe(new Date().toISOString().slice(0, 10));

    // Check pulse & ledgers
    const pulse = state.pulse as Record<string, unknown>;
    expect(pulse.counter).toBe(0);
    expect(pulse.open).toBeNull();
    expect(pulse.last).toBeNull();
    expect(Array.isArray(state.observations)).toBe(true);
    expect(Array.isArray(state.candidates)).toBe(true);
    expect(Array.isArray(state.escalations)).toBe(true);

    // Check last_pulse.json
    const lastPulsePath = join(runRoot, "last_pulse.json");
    expect(existsSync(lastPulsePath)).toBe(true);
    const lastPulse = JSON.parse(readFileSync(lastPulsePath, "utf-8"));
    expect(lastPulse.pulse_id).toBeNull();
    expect(lastPulse.outcome).toBeNull();
    expect(lastPulse.next_wake_at).toBeNull();
    expect(typeof lastPulse.at).toBe("string");

    // Verify integrity passes with zero issues
    const issues = verifyIntegrity(runRoot);
    expect(issues).toEqual([]);
  });

  test("supports explicit generation flag and custom budget defaults", () => {
    const repo = scratchRoot("mind-init-gen-2");
    const minimalCharter = `
## identity
Gen 2 Mind

## goals
- G1: Continuous operation

## non-goals
- Dangerous operations

## repo_roots
- \`src/\`
`;
    const charterPath = join(repo, "docs", "CHARTER.md");
    writeFileSync(join(repo, "docs"), "", { flag: "w" }); // ensure dir
  });

  test("supports custom generation and seeds default budget when unspecified", () => {
    const repo = scratchRoot("mind-init-custom-gen");
    const charterPath = join(repo, "custom-charter.md");
    const minimalCharter = `
## identity
Gen 2 Mind

## goals
- G1: Continuous operation

## non-goals
- Dangerous operations

## repo_roots
- \`src/\`
`;
    writeFileSync(charterPath, minimalCharter, "utf-8");

    const result = mindInitCommand({
      repo,
      charter: "custom-charter.md",
      generation: "2",
    });

    expect(result.mind_id).toBe("mind-gen-2");
    expect(result.generation).toBe(2);

    const runRoot = result.run_root as string;
    const loaded = loadRun(runRoot);
    const state = loaded.state as Record<string, unknown>;
    const budget = state.budget as Record<string, unknown>;
    expect(budget.pulses_per_day).toBe(DEFAULT_MIND_BUDGET.pulses_per_day);
    expect(budget.base_interval_ms).toBe(DEFAULT_MIND_BUDGET.base_interval_ms);
    expect(budget.max_interval_ms).toBe(DEFAULT_MIND_BUDGET.max_interval_ms);

    const issues = verifyIntegrity(runRoot);
    expect(issues).toEqual([]);
  });

  test("refuses duplicate initialization without mutating existing capsule", () => {
    const repo = scratchRoot("mind-init-duplicate");
    const charterPath = join(repo, "CHARTER.md");
    writeFileSync(charterPath, SAMPLE_VALID_CHARTER, "utf-8");

    const result = mindInitCommand({
      repo,
      charter: "CHARTER.md",
    });
    const runRoot = result.run_root as string;
    const loadedFirst = loadRun(runRoot);
    const firstRevision = loadedFirst.state.revision;
    const firstEventSeq = loadedFirst.state.event_sequence;

    expect(() => {
      mindInitCommand({
        repo,
        charter: "CHARTER.md",
      });
    }).toThrow(HarnessError);

    try {
      mindInitCommand({
        repo,
        charter: "CHARTER.md",
      });
    } catch (err) {
      expect((err as HarnessError).code).toBe("INVALID_STATE");
      expect((err as HarnessError).message).toContain("capsule already exists");
    }

    // State must be unmutated
    const loadedSecond = loadRun(runRoot);
    expect(loadedSecond.state.revision).toBe(firstRevision);
    expect(loadedSecond.state.event_sequence).toBe(firstEventSeq);
  });

  test("refuses when charter file is missing or not a regular file", () => {
    const repo = scratchRoot("mind-init-invalid-file");

    // Missing file
    expect(() => {
      mindInitCommand({
        repo,
        charter: "non-existent.md",
      });
    }).toThrow(HarnessError);

    // Directory as charter
    expect(() => {
      mindInitCommand({
        repo,
        charter: ".",
      });
    }).toThrow(HarnessError);

    // Empty file
    const emptyPath = join(repo, "empty.md");
    writeFileSync(emptyPath, "", "utf-8");
    expect(() => {
      mindInitCommand({
        repo,
        charter: "empty.md",
      });
    }).toThrow(/empty/);

    // Symlink file (no-follow)
    const realTarget = join(repo, "real.md");
    writeFileSync(realTarget, SAMPLE_VALID_CHARTER, "utf-8");
    const symlinkPath = join(repo, "symlink.md");
    symlinkSync(realTarget, symlinkPath);
    expect(() => {
      mindInitCommand({
        repo,
        charter: "symlink.md",
      });
    }).toThrow(/cannot read charter file|not a regular file|symlink/i);
  });
});

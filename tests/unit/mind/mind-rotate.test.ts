import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { doctorCommand } from "../../../orchestrating-long-tasks/scripts/src/cli/commands/diagnostics-ops.ts";
import { mindInitCommand } from "../../../orchestrating-long-tasks/scripts/src/cli/commands/mind-init.ts";
import {
  formatMindRotateBrief,
  mindRotateCommand,
} from "../../../orchestrating-long-tasks/scripts/src/cli/commands/mind-rotate.ts";
import { summaryViewCommand } from "../../../orchestrating-long-tasks/scripts/src/cli/commands/summary-ops.ts";
import type {
  JsonObject,
  JsonValue,
} from "../../../orchestrating-long-tasks/scripts/src/contracts/json.ts";
import { HarnessError } from "../../../orchestrating-long-tasks/scripts/src/errors/harness-error.ts";
import {
  evaluateGate6NotADuplicate,
  type CandidateRecord,
  type GateEvaluationContext,
} from "../../../orchestrating-long-tasks/scripts/src/mind/gates.ts";
import { rotateMindGeneration } from "../../../orchestrating-long-tasks/scripts/src/mind/rotate.ts";
import { verifyIntegrity } from "../../../orchestrating-long-tasks/scripts/src/store/integrity.ts";
import { loadRun } from "../../../orchestrating-long-tasks/scripts/src/store/load.ts";
import { transact } from "../../../orchestrating-long-tasks/scripts/src/store/transaction.ts";
import { scratchRoot as makeScratchRoot } from "../../support/scratch-root.ts";

function scratchRoot(label: string): string {
  return makeScratchRoot(import.meta.path, label);
}

const SAMPLE_CHARTER = `
# System Charter

## identity
Autonomous Mind supervising long-running task orchestration and codebase health.

## goals
- G1: Maintain 100% test coverage across all packages
- G2: Enforce zero type regressions and zero prohibited any forms
- G3: Ensure all background task leases are bounded and monitored

## non-goals
- Modifying production secrets or ungranted external APIs
- Deploying releases without explicit owner confirmation

## repo_roots
- \`src/\`
- \`docs/\`
- \`tests/\`

## stability
- \`bun test\` -> exit 0

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
Never modify role contracts unattended.

## escalation
Ping the on-call engineer when 3 consecutive crashed pulses are observed.
`;

function setupMindCapsule(
  label: string,
  options: {
    readonly charterText?: string;
    readonly pulseCounter?: number;
    readonly budgetOverride?: Record<string, unknown>;
    readonly candidates?: readonly CandidateRecord[];
  } = {},
): { repoRoot: string; runRoot: string; charterPath: string } {
  const repo = scratchRoot(label);
  const charterPath = join(repo, "CHARTER.md");
  writeFileSync(charterPath, options.charterText ?? SAMPLE_CHARTER, "utf-8");

  const initResult = mindInitCommand({
    repo,
    charter: "CHARTER.md",
    actor: "owner-alice",
  });

  const runRoot = initResult.run_root as string;

  if (
    options.pulseCounter !== undefined ||
    options.budgetOverride !== undefined ||
    options.candidates !== undefined
  ) {
    transact(runRoot, "owner-alice", "mind-customized-test", {}, (state) => {
      if (options.pulseCounter !== undefined) {
        const pulse = (state.pulse ?? {}) as Record<string, unknown>;
        pulse.counter = options.pulseCounter;
        state.pulse = pulse as unknown as JsonObject;
      }
      if (options.budgetOverride !== undefined) {
        const budget = (state.budget ?? {}) as Record<string, unknown>;
        for (const [key, val] of Object.entries(options.budgetOverride)) {
          budget[key] = val;
        }
        state.budget = budget as unknown as JsonObject;
      }
      if (options.candidates !== undefined) {
        state.candidates = options.candidates as unknown as JsonValue;
      }
    });
  }

  return { repoRoot: repo, runRoot, charterPath };
}

describe("rotateMindGeneration and mindRotateCommand", () => {
  test("executes generational rotation from Generation 1 to Generation 2 via CLI handler", () => {
    const { runRoot } = setupMindCapsule("rotate-cli-gen1-to-gen2", {
      pulseCounter: 15,
      budgetOverride: { pulses_today: 10, wall_clock_ms_today: 120000 },
    });

    const result = mindRotateCommand({
      run: runRoot,
      actor: "owner-alice",
      now: "2026-08-21T12:00:00.000Z",
    });

    expect(result.source_generation).toBe(1);
    expect(result.target_generation).toBe(2);
    expect(result.source_run_id).toBe("mind-gen-1");
    expect(result.target_run_id).toBe("mind-gen-2");
    expect(result.pulse_counter).toBe(15);
    expect(result.rotated_at).toBe("2026-08-21T12:00:00.000Z");
    expect(result.markdown).toContain("Mind Rotated: Generation 1 → 2");
    expect(result.markdown).toContain("sealed with status `rotated`");

    // 1. Verify Generation 1 (Source) State
    const sourceLoaded = loadRun(runRoot);
    const sourceState = sourceLoaded.state as Record<string, unknown>;
    const sourceMind = sourceState.mind as Record<string, unknown>;
    expect(sourceMind.status).toBe("rotated");
    expect(sourceMind.rotated_at).toBe("2026-08-21T12:00:00.000Z");
    expect(sourceMind.next_generation).toEqual({
      run_id: "mind-gen-2",
      generation: 2,
      rotated_at: "2026-08-21T12:00:00.000Z",
    });

    const sourceLastPulse = JSON.parse(
      readFileSync(join(runRoot, "last_pulse.json"), "utf-8"),
    ) as Record<string, unknown>;
    expect(sourceLastPulse.outcome).toBe("rotated");
    expect(sourceLastPulse.next_wake_at).toBeNull();

    // 2. Verify Generation 2 (Target) State
    const targetRunRoot = result.target_run_root;
    expect(existsSync(targetRunRoot)).toBe(true);

    const targetLoaded = loadRun(targetRunRoot);
    const targetState = targetLoaded.state as Record<string, unknown>;
    const targetMind = targetState.mind as Record<string, unknown>;
    expect(targetMind.generation).toBe(2);
    expect(targetMind.opened_at).toBe("2026-08-21T12:00:00.000Z");
    expect(targetMind.charter).toEqual({
      source_path: "CHARTER.md",
      pinned_sha256: sourceLoaded.manifest.prompt_sha256,
      goals: ["G1", "G2", "G3"],
      repo_roots: ["src/", "docs/", "tests/"],
      evidence_class: "harness_observed",
    });
    expect(targetMind.previous_generation).toEqual({
      run_id: "mind-gen-1",
      event_head: sourceLoaded.state.event_head,
      sealed_at: "2026-08-21T12:00:00.000Z",
    });

    // Budget state carried forward
    const targetBudget = targetState.budget as Record<string, unknown>;
    expect(targetBudget.pulses_today).toBe(10);
    expect(targetBudget.wall_clock_ms_today).toBe(120000);
    expect(targetBudget.pulses_per_day).toBe(48);

    // Pulse counter carried forward
    const targetPulse = targetState.pulse as Record<string, unknown>;
    expect(targetPulse.counter).toBe(15);
    expect(targetPulse.open).toBeNull();
    expect(targetPulse.last).toBeNull();

    // Target prompt.md is read-only (0444) and identical
    const targetPromptPath = join(targetRunRoot, "prompt.md");
    expect(readFileSync(targetPromptPath, "utf-8")).toBe(
      readFileSync(join(runRoot, "prompt.md"), "utf-8"),
    );
    expect((statSync(targetPromptPath).mode & 0o222) === 0).toBe(true);

    // Chain manifest created in target capsule
    const chainManifestPath = join(targetRunRoot, "chain_manifest.json");
    expect(existsSync(chainManifestPath)).toBe(true);
    const chainManifest = JSON.parse(readFileSync(chainManifestPath, "utf-8")) as Record<
      string,
      unknown
    >;
    expect(chainManifest.schema).toBe("orchestrator.chain_manifest");
    expect(chainManifest.sourceRunId).toBe("mind-gen-1");
    expect(chainManifest.targetRunId).toBe("mind-gen-2");
    expect(chainManifest.previousEventHead).toBe(sourceLoaded.state.event_head);
  });

  test("retains declined candidate records across generation boundary and enforces Gate 6 duplicate rejection", () => {
    const declinedCandidate: CandidateRecord = {
      id: "cand-declined-1",
      kind: "defect",
      statement: "typecheck fails in auth module",
      witness_command_id: "cmd-typecheck-fail-42",
      charter_goal_ids: ["G2"],
      falsifier_argv: ["bun", "run", "typecheck"],
      falsifier_exit: 1,
      write_scope: ["src/auth/token.ts"],
      status: "declined",
      decided_at: "2026-08-20T10:00:00.000Z",
      decline_reason: "already addressed in branch feat-auth",
      gate_failed: null,
    };

    const activeCandidate: CandidateRecord = {
      id: "cand-open-2",
      kind: "defect",
      statement: "coverage drops below threshold",
      witness_command_id: "cmd-cov-fail-10",
      charter_goal_ids: ["G1"],
      falsifier_argv: ["bun", "test", "--coverage"],
      falsifier_exit: 1,
      write_scope: ["src/coverage/"],
      status: "opened",
    };

    const { runRoot } = setupMindCapsule("rotate-candidate-retention", {
      candidates: [declinedCandidate, activeCandidate],
    });

    const rotateResult = rotateMindGeneration({
      sourceRunRoot: runRoot,
      actor: "owner-alice",
    });

    expect(rotateResult.carriedCandidates.length).toBe(2);
    expect(rotateResult.openCandidatesCount).toBe(1);
    expect(rotateResult.declinedCandidatesCount).toBe(1);

    const targetLoaded = loadRun(rotateResult.targetRunRoot);
    const targetCandidates = (targetLoaded.state as Record<string, unknown>)
      .candidates as readonly CandidateRecord[];
    expect(targetCandidates.length).toBe(2);

    const foundDeclined = targetCandidates.find((c) => c.id === "cand-declined-1");
    expect(foundDeclined).toBeDefined();
    expect(foundDeclined?.status).toBe("declined");
    expect(foundDeclined?.decline_reason).toBe("already addressed in branch feat-auth");

    const foundOpen = targetCandidates.find((c) => c.id === "cand-open-2");
    expect(foundOpen).toBeDefined();
    expect(foundOpen?.status).toBe("opened");

    // Gate 6 duplicate rejection test in Generation 2
    const gateContext: GateEvaluationContext = {
      runRoot: rotateResult.targetRunRoot,
      repoRoot: "/test/repo",
      actor: "mind-agent-1",
      state: targetLoaded.state as Record<string, unknown>,
      charterGoals: new Set(["G1", "G2", "G3"]),
      repoRoots: ["src/", "docs/", "tests/"],
    };

    // 1. Same witness command id as permanently declined candidate -> REJECTED by Gate 6
    const duplicateByWitness: CandidateRecord = {
      id: "cand-new-duplicate-1",
      kind: "defect",
      statement: "different statement text",
      witness_command_id: "cmd-typecheck-fail-42",
      write_scope: ["src/other/"],
      status: "opened",
    };
    const verdict1 = evaluateGate6NotADuplicate(duplicateByWitness, gateContext);
    expect(verdict1.passed).toBe(false);
    expect(verdict1.reason).toContain(
      "duplicate of permanently declined candidate 'cand-declined-1'",
    );

    // 2. Same statement & overlapping scope as permanently declined candidate -> REJECTED by Gate 6
    const duplicateByStatementScope: CandidateRecord = {
      id: "cand-new-duplicate-2",
      kind: "defect",
      statement: "typecheck fails in auth module",
      witness_command_id: "cmd-different-fail-99",
      write_scope: ["src/auth/token.ts"],
      status: "opened",
    };
    const verdict2 = evaluateGate6NotADuplicate(duplicateByStatementScope, gateContext);
    expect(verdict2.passed).toBe(false);
    expect(verdict2.reason).toContain(
      "duplicate of permanently declined candidate 'cand-declined-1'",
    );

    // 3. New candidate with distinct witness and scope -> PASSES Gate 6
    const freshCandidate: CandidateRecord = {
      id: "cand-fresh-3",
      kind: "defect",
      statement: "missing documentation for api",
      witness_command_id: "cmd-doc-check-fail-7",
      write_scope: ["docs/api.md"],
      status: "opened",
    };
    const verdict3 = evaluateGate6NotADuplicate(freshCandidate, gateContext);
    expect(verdict3.passed).toBe(true);
  });

  test("preserves charter pinned digest, budget ledger day key, and pulse counter across rotation", () => {
    const { runRoot } = setupMindCapsule("rotate-budget-pulse-preservation", {
      pulseCounter: 842,
      budgetOverride: {
        day_key: "2026-08-21",
        pulses_today: 37,
        wall_clock_ms_today: 4567890,
        pulses_per_day: 96,
        wall_clock_ms_per_day: 21600000,
        max_agents_in_flight: 8,
      },
    });

    const sourceLoaded = loadRun(runRoot);
    const pinnedHash = sourceLoaded.manifest.prompt_sha256;

    const rotateResult = rotateMindGeneration({
      sourceRunRoot: runRoot,
      nextRunId: "mind-gen-2",
    });

    expect(rotateResult.charterSha256).toBe(pinnedHash);
    expect(rotateResult.pulseCounter).toBe(842);

    const targetLoaded = loadRun(rotateResult.targetRunRoot);
    expect(targetLoaded.manifest.prompt_sha256).toBe(pinnedHash);

    const targetState = targetLoaded.state as Record<string, unknown>;
    const targetMind = targetState.mind as Record<string, unknown>;
    const targetCharter = targetMind.charter as Record<string, unknown>;
    expect(targetCharter.pinned_sha256).toBe(pinnedHash);

    const targetBudget = targetState.budget as Record<string, unknown>;
    expect(targetBudget.day_key).toBe("2026-08-21");
    expect(targetBudget.pulses_today).toBe(37);
    expect(targetBudget.wall_clock_ms_today).toBe(4567890);
    expect(targetBudget.pulses_per_day).toBe(96);
    expect(targetBudget.wall_clock_ms_per_day).toBe(21600000);
    expect(targetBudget.max_agents_in_flight).toBe(8);

    const targetPulse = targetState.pulse as Record<string, unknown>;
    expect(targetPulse.counter).toBe(842);
  });

  test("sealed Generation N remains fully readable and valid under doctor and summary:view", async () => {
    const { runRoot } = setupMindCapsule("rotate-doctor-summary-view", {
      pulseCounter: 5,
    });

    const rotateResult = rotateMindGeneration({
      sourceRunRoot: runRoot,
    });

    // 1. Verify Generation 1 (Source) Integrity & Diagnostics
    const gen1Issues = verifyIntegrity(runRoot);
    expect(gen1Issues).toEqual([]);

    const doctorGen1 = await doctorCommand({ run: runRoot });
    expect(typeof doctorGen1.markdown).toBe("string");
    expect(doctorGen1.markdown).toContain("Capsule Doctor");

    const summaryGen1 = summaryViewCommand({ run: runRoot });
    expect(typeof summaryGen1.markdown).toBe("string");
    expect(summaryGen1.markdown).toContain("Summary");

    // 2. Verify Generation 2 (Target) Integrity & Diagnostics
    const gen2Issues = verifyIntegrity(rotateResult.targetRunRoot);
    expect(gen2Issues).toEqual([]);

    const doctorGen2 = await doctorCommand({ run: rotateResult.targetRunRoot });
    expect(typeof doctorGen2.markdown).toBe("string");
    expect(doctorGen2.markdown).toContain("Capsule Doctor");

    const summaryGen2 = summaryViewCommand({ run: rotateResult.targetRunRoot });
    expect(typeof summaryGen2.markdown).toBe("string");
    expect(summaryGen2.markdown).toContain("Summary");
  });

  test("supports multi-generation chaining (Generation 1 -> Generation 2 -> Generation 3)", () => {
    const { runRoot: gen1Root } = setupMindCapsule("rotate-multi-gen-chain", {
      pulseCounter: 10,
      candidates: [
        {
          id: "cand-declined-gen1",
          kind: "defect",
          statement: "gen 1 rejected defect",
          witness_command_id: "cmd-gen1-fail",
          write_scope: ["src/core/"],
          status: "declined",
          decline_reason: "rejected in gen 1",
        },
      ],
    });

    // Rotate Gen 1 -> Gen 2
    const rot1 = rotateMindGeneration({
      sourceRunRoot: gen1Root,
      now: "2026-08-21T01:00:00.000Z",
    });
    expect(rot1.sourceGeneration).toBe(1);
    expect(rot1.targetGeneration).toBe(2);
    expect(rot1.targetRunId).toBe("mind-gen-2");

    // In Gen 2, add another candidate and advance pulse counter
    transact(rot1.targetRunRoot, "mind-agent", "mind-customized-gen2", {}, (state) => {
      const pulse = (state.pulse ?? {}) as Record<string, unknown>;
      pulse.counter = 25;
      state.pulse = pulse as unknown as JsonObject;

      const candidates = (
        Array.isArray(state.candidates) ? state.candidates : []
      ) as CandidateRecord[];
      candidates.push({
        id: "cand-declined-gen2",
        kind: "defect",
        statement: "gen 2 rejected defect",
        witness_command_id: "cmd-gen2-fail",
        write_scope: ["src/net/"],
        status: "declined",
        decline_reason: "rejected in gen 2",
      });
      state.candidates = candidates as unknown as JsonValue;
    });

    // Rotate Gen 2 -> Gen 3
    const rot2 = rotateMindGeneration({
      sourceRunRoot: rot1.targetRunRoot,
      now: "2026-08-21T02:00:00.000Z",
    });
    expect(rot2.sourceGeneration).toBe(2);
    expect(rot2.targetGeneration).toBe(3);
    expect(rot2.targetRunId).toBe("mind-gen-3");
    expect(rot2.pulseCounter).toBe(25);
    expect(rot2.declinedCandidatesCount).toBe(2);

    const gen3Loaded = loadRun(rot2.targetRunRoot);
    const gen3State = gen3Loaded.state as Record<string, unknown>;
    const gen3Mind = gen3State.mind as Record<string, unknown>;
    expect(gen3Mind.generation).toBe(3);
    expect(gen3Mind.previous_generation).toEqual({
      run_id: "mind-gen-2",
      event_head: loadRun(rot1.targetRunRoot).state.event_head,
      sealed_at: "2026-08-21T02:00:00.000Z",
    });

    // All 3 generations pass integrity
    expect(verifyIntegrity(gen1Root)).toEqual([]);
    expect(verifyIntegrity(rot1.targetRunRoot)).toEqual([]);
    expect(verifyIntegrity(rot2.targetRunRoot)).toEqual([]);
  });

  test("refuses rotation when source is invalid or already sealed", () => {
    const { runRoot } = setupMindCapsule("rotate-error-handling");

    // Rotate once successfully
    rotateMindGeneration({ sourceRunRoot: runRoot });

    // Rotating already rotated capsule -> throws INVALID_STATE
    expect(() => {
      rotateMindGeneration({ sourceRunRoot: runRoot });
    }).toThrow(HarnessError);

    try {
      rotateMindGeneration({ sourceRunRoot: runRoot });
    } catch (err: unknown) {
      expect((err as HarnessError).code).toBe("INVALID_STATE");
      expect((err as HarnessError).message).toContain("already sealed with status 'rotated'");
    }

    // Rotating non-existent directory -> throws INVALID_ARGUMENT
    expect(() => {
      rotateMindGeneration({ sourceRunRoot: "/non/existent/path" });
    }).toThrow(HarnessError);

    // Target capsule collision -> throws INVALID_STATE
    const { runRoot: secondRunRoot } = setupMindCapsule("rotate-collision-test");
    expect(() => {
      // mind-gen-2 already exists from previous test in same directory
      rotateMindGeneration({
        sourceRunRoot: secondRunRoot,
        nextRunId: "mind-gen-1", // collision with self
      });
    }).toThrow(HarnessError);
  });

  test("formatMindRotateBrief formats expected markdown summary", () => {
    const brief = formatMindRotateBrief({
      sourceRunId: "mind-gen-1",
      targetRunId: "mind-gen-2",
      sourceGeneration: 1,
      targetGeneration: 2,
      targetRunRoot: ".capsules/mind-gen-2",
      charterSha256: "abcdef1234567890",
      pulseCounter: 42,
      carriedCandidatesCount: 5,
      openCandidatesCount: 2,
      declinedCandidatesCount: 3,
      previousEventHead: "eventhead123",
      rotatedAt: "2026-08-21T12:00:00.000Z",
    });

    expect(brief).toContain("Mind Rotated: Generation 1 → 2");
    expect(brief).toContain("`mind-gen-1` (sealed with status `rotated`)");
    expect(brief).toContain("`mind-gen-2` at `.capsules/mind-gen-2`");
    expect(brief).toContain("`abcdef1234567890` (pinned across boundary)");
    expect(brief).toContain("42 (preserved)");
    expect(brief).toContain("5 (2 open/admitted, 3 declined)");
    expect(brief).toContain("`eventhead123`");
  });
});

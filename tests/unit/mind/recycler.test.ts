import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { mindInitCommand } from "../../../olt/scripts/src/cli/commands/mind-init.ts";
import {
  formatMindRotateBrief,
  mindRotateCommand,
} from "../../../olt/scripts/src/cli/commands/mind-rotate.ts";
import type { JsonObject, JsonValue } from "../../../olt/scripts/src/contracts/json.ts";
import {
  appendFeedbackItem,
  writeFeedbackQueue,
  type FeedbackItem,
} from "../../../olt/scripts/src/mind/feedback-queue.ts";
import type { CandidateRecord } from "../../../olt/scripts/src/mind/gates.ts";
import {
  assessRecyclingState,
  compileAutonomicWavePlan,
  drainAndAdmitFeedbackCandidates,
  enforceInfiniteMindCadence,
  executeAutonomicRollover,
  extractAllCandidates,
  formatAutonomicRolloverBrief,
  formatRecycleBrief,
  inspectRecycleHealth,
  planAutonomousRoundRecycle,
  transitionCompletenessCriticSignOff,
  transitionPulseCloseToWake,
  validateRolloverReadiness,
} from "../../../olt/scripts/src/mind/recycler.ts";
import type { RoundRecord } from "../../../olt/scripts/src/mind/rounds.ts";
import { loadRun } from "../../../olt/scripts/src/store/load.ts";
import { transact } from "../../../olt/scripts/src/store/transaction.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

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
- max_rounds_per_objective: 3
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

function createCandidate(
  id: string,
  status: "opened" | "open" | "admitted" | "declined",
  statement = `Candidate statement for ${id}`,
  objectiveRunId?: string,
): CandidateRecord {
  return {
    id,
    kind: "defect",
    statement,
    charter_goal: "G1",
    write_scope: ["src/"],
    status,
    discovered_at: "2026-08-21T10:00:00.000Z",
    discovered_by: "mind-1",
    objective_run_id: objectiveRunId,
  };
}

function createRound(
  round: number,
  objectiveId: string,
  candidateId: string,
  status: "opened" | "closed",
  result?: "converged" | "budget_exhausted" | "abandoned" | "findings",
): RoundRecord {
  return {
    round,
    objective_id: objectiveId,
    candidate_id: candidateId,
    status,
    result,
    opened_at: "2026-08-21T10:00:00.000Z",
    opened_by: "mind-1",
    closed_at: status === "closed" ? "2026-08-21T11:00:00.000Z" : undefined,
    closed_by: status === "closed" ? "mind-1" : undefined,
    requirements: ["Req 1"],
    chain_from_round: round > 1 ? round - 1 : undefined,
  };
}

function setupMindCapsule(
  label: string,
  options: {
    readonly candidates?: readonly CandidateRecord[];
    readonly rounds?: readonly RoundRecord[];
    readonly completionReview?: { status: "clean" | "findings"; summary: string };
    readonly budget?: Record<string, unknown>;
    readonly actor?: string;
  } = {},
): { repoRoot: string; runRoot: string } {
  const repo = scratchRoot(import.meta.path, label);
  const charterPath = join(repo, "CHARTER.md");
  writeFileSync(charterPath, SAMPLE_CHARTER, "utf-8");

  const initResult = mindInitCommand({
    repo,
    charter: "CHARTER.md",
    actor: options.actor ?? "owner-alice",
  });

  const runRoot = initResult.run_root as string;

  if (
    options.candidates !== undefined ||
    options.rounds !== undefined ||
    options.completionReview !== undefined ||
    options.budget !== undefined
  ) {
    transact(runRoot, options.actor ?? "owner-alice", "mind-customized-test", {}, (state) => {
      if (options.candidates !== undefined) {
        state.candidates = options.candidates as unknown as JsonValue;
      }
      if (options.rounds !== undefined) {
        state.rounds = options.rounds as unknown as JsonValue;
      }
      if (options.completionReview !== undefined) {
        state.completion_review = options.completionReview as unknown as JsonObject;
      }
      if (options.budget !== undefined) {
        state.budget = options.budget as unknown as JsonObject;
      }
    });
  }

  return { repoRoot: repo, runRoot };
}

describe("mind autonomic recycler", () => {
  describe("extractAllCandidates", () => {
    test("returns empty array when no candidates exist in state", () => {
      const state: Record<string, unknown> = {};
      const candidates = extractAllCandidates(state);
      expect(candidates).toEqual([]);
    });

    test("extracts candidates from root state.candidates", () => {
      const c1 = createCandidate("cand-1", "admitted");
      const state: Record<string, unknown> = {
        candidates: [c1],
      };
      const candidates = extractAllCandidates(state);
      expect(candidates).toHaveLength(1);
      expect(candidates[0]?.id).toBe("cand-1");
    });

    test("extracts candidates from state.mind.candidates", () => {
      const c1 = createCandidate("cand-mind-1", "opened");
      const state: Record<string, unknown> = {
        mind: {
          candidates: [c1],
        },
      };
      const candidates = extractAllCandidates(state);
      expect(candidates).toHaveLength(1);
      expect(candidates[0]?.id).toBe("cand-mind-1");
    });

    test("deduplicates candidates present in both root and mind substate by id", () => {
      const c1Root = createCandidate("cand-shared", "admitted");
      const c1Mind = createCandidate("cand-shared", "opened");
      const c2Mind = createCandidate("cand-mind-unique", "opened");
      const state: Record<string, unknown> = {
        candidates: [c1Root],
        mind: {
          candidates: [c1Mind, c2Mind],
        },
      };
      const candidates = extractAllCandidates(state);
      expect(candidates).toHaveLength(2);
      expect(candidates[0]?.id).toBe("cand-shared");
      expect(candidates[0]?.status).toBe("admitted");
      expect(candidates[1]?.id).toBe("cand-mind-unique");
    });

    test("filters out invalid candidate entries", () => {
      const state: Record<string, unknown> = {
        candidates: [
          null,
          undefined,
          123,
          { statement: "no id" },
          createCandidate("cand-valid", "admitted"),
        ],
      };
      const candidates = extractAllCandidates(state);
      expect(candidates).toHaveLength(1);
      expect(candidates[0]?.id).toBe("cand-valid");
    });
  });

  describe("assessRecyclingState and transitionCompletenessCriticSignOff", () => {
    const runRoot = ".capsules/test-mind-run";

    test("critic clean: transitions to candidate_to_planning when an admitted candidate exists", () => {
      const c1 = createCandidate("cand-1", "admitted", "Fix memory leak in parser");
      const state: Record<string, unknown> = {
        mind: { actor: "mind-lead" },
        candidates: [c1],
        completion_review: { status: "clean", summary: "All gates verified cleanly." },
      };

      const assessment = assessRecyclingState(state, runRoot);
      expect(assessment.canRecycle).toBe(true);
      expect(assessment.phase).toBe("critic_signed_off");
      expect(assessment.transition).toBe("candidate_to_planning");
      expect(assessment.objectiveId).toBe("obj-cand-1");
      expect(assessment.candidateId).toBe("cand-1");
      expect(assessment.roundNumber).toBe(1);
      expect(assessment.infiniteCadence).toBe(true);
      expect(assessment.nextRecommendedCommand).toContain("mind:round-open");
      expect(assessment.nextRecommendedCommand).toContain("--actor mind-lead");
      expect(assessment.nextRecommendedCommand).toContain("--candidate cand-1");
      expect(assessment.suggestedCommands[1]).toContain("plan:init");
      expect(assessment.reason).toContain("admitted candidate 'cand-1' is ready");
    });

    test("critic clean: skips converged candidate and advances to next admitted candidate", () => {
      const c1 = createCandidate("cand-1", "admitted", "Statement 1", "run-1");
      const c2 = createCandidate("cand-2", "admitted", "Statement 2");
      const r1 = createRound(1, "obj-cand-1", "cand-1", "closed", "converged");
      const state: Record<string, unknown> = {
        candidates: [c1, c2],
        rounds: [r1],
        completion_review: { status: "clean", summary: "Round 1 converged." },
      };

      const assessment = assessRecyclingState(state, runRoot);
      expect(assessment.transition).toBe("candidate_to_planning");
      expect(assessment.candidateId).toBe("cand-2");
      expect(assessment.objectiveId).toBe("obj-cand-2");
    });

    test("critic clean: transitions to discovery_to_admission when only open candidates exist", () => {
      const c1 = createCandidate("cand-open-1", "opened");
      const state: Record<string, unknown> = {
        candidates: [c1],
        completion_review: { status: "clean", summary: "Round clean." },
      };

      const assessment = assessRecyclingState(state, runRoot);
      expect(assessment.phase).toBe("critic_signed_off");
      expect(assessment.transition).toBe("discovery_to_admission");
      expect(assessment.candidateId).toBe("cand-open-1");
      expect(assessment.nextRecommendedCommand).toContain("mind:admit");
      expect(assessment.nextRecommendedCommand).toContain("--candidate cand-open-1");
      expect(assessment.reason).toContain("admission review");
    });

    test("critic clean: transitions to critic_to_discovery when no candidates remain and no feedback queue", () => {
      const state: Record<string, unknown> = {
        mind: { actor: "mind-worker" },
        completion_review: { status: "clean", summary: "All tasks completed." },
      };

      const assessment = assessRecyclingState(state, runRoot);
      expect(assessment.phase).toBe("critic_signed_off");
      expect(assessment.transition).toBe("critic_to_discovery");
      expect(assessment.objectiveId).toBeNull();
      expect(assessment.candidateId).toBeNull();
      expect(assessment.nextRecommendedCommand).toContain("mind:candidate");
      expect(assessment.suggestedCommands).toContain(`bun harness.ts mind:wake --run ${runRoot}`);
      expect(assessment.reason).toContain("transitioning to new candidate discovery");
    });

    test("critic clean: transitions to generation_rollover when feedback items are pending in queue", () => {
      const repo = scratchRoot(import.meta.path, "assess-rollover-test");
      const queuePath = join(repo, "FEEDBACK_QUEUE.jsonl");
      writeFeedbackQueue(
        [
          {
            id: "p00-rollover-item",
            timestamp: "2026-08-21T10:00:00.000Z",
            priority: "CRITICAL_USER_FEEDBACK",
            status: "PENDING",
            category: "CORE_ENGINE",
            title: "Perpetual Autonomic Mind Cadence",
            content: "Eliminate Mind idle loops and rollover immediately.",
          },
        ],
        queuePath,
      );

      const state: Record<string, unknown> = {
        mind: { actor: "mind-lead", generation: 1 },
        completion_review: { status: "clean", summary: "Gen 1 converged." },
      };

      const assessment = assessRecyclingState(state, runRoot, {
        feedbackQueuePath: queuePath,
        checkFeedbackQueue: true,
      });

      expect(assessment.canRecycle).toBe(true);
      expect(assessment.phase).toBe("generation_converged");
      expect(assessment.transition).toBe("generation_rollover");
      expect(assessment.targetGeneration).toBe(2);
      expect(assessment.pendingFeedbackCount).toBe(1);
      expect(assessment.nextRecommendedCommand).toContain("mind:rotate");
      expect(assessment.reason).toContain("generation 1 converged with 1 pending feedback items");
    });

    test("critic findings: opens successor round when round budget is available", () => {
      const r1 = createRound(1, "obj-1", "cand-1", "opened");
      const state: Record<string, unknown> = {
        mind: { actor: "mind-lead" },
        rounds: [r1],
        budget: { max_rounds_per_objective: 3 },
        completion_review: { status: "findings", summary: "Edge case in parser failed." },
      };

      const assessment = assessRecyclingState(state, runRoot);
      expect(assessment.phase).toBe("critic_signed_off");
      expect(assessment.transition).toBe("critic_to_next_round");
      expect(assessment.objectiveId).toBe("obj-1");
      expect(assessment.candidateId).toBe("cand-1");
      expect(assessment.roundNumber).toBe(2);
      expect(assessment.nextRecommendedCommand).toContain("mind:round-open");
      expect(assessment.nextRecommendedCommand).toContain("--round 2");
      expect(assessment.nextRecommendedCommand).toContain(`--chain-from ${runRoot}`);
      expect(assessment.reason).toContain("opening successor round 2 (max 3)");
    });

    test("critic findings: transitions to discovery when max rounds budget is exhausted", () => {
      const r3 = createRound(3, "obj-1", "cand-1", "opened");
      const state: Record<string, unknown> = {
        rounds: [r3],
        budget: { max_rounds_per_objective: 3 },
        completion_review: { status: "findings", summary: "Unresolved issues remain." },
      };

      const assessment = assessRecyclingState(state, runRoot);
      expect(assessment.phase).toBe("critic_signed_off");
      expect(assessment.transition).toBe("critic_to_discovery");
      expect(assessment.roundNumber).toBeNull();
      expect(assessment.nextRecommendedCommand).toContain("mind:wake");
      expect(assessment.reason).toContain("Round budget exhausted (3/3)");
    });

    test("no critic review: transitions to candidate_to_planning if admitted candidates exist and no round is open", () => {
      const c1 = createCandidate("cand-admitted", "admitted");
      const state: Record<string, unknown> = {
        candidates: [c1],
      };

      const assessment = assessRecyclingState(state, runRoot);
      expect(assessment.phase).toBe("candidates_admitted");
      expect(assessment.transition).toBe("candidate_to_planning");
      expect(assessment.candidateId).toBe("cand-admitted");
      expect(assessment.objectiveId).toBe("obj-cand-admitted");
      expect(assessment.roundNumber).toBe(1);
      expect(assessment.nextRecommendedCommand).toContain("mind:round-open");
    });

    test("no critic review: transitions to discovery_to_admission if open candidates exist and no round is open", () => {
      const c1 = createCandidate("cand-open", "open");
      const state: Record<string, unknown> = {
        candidates: [c1],
      };

      const assessment = assessRecyclingState(state, runRoot);
      expect(assessment.phase).toBe("idle_discovery");
      expect(assessment.transition).toBe("discovery_to_admission");
      expect(assessment.candidateId).toBe("cand-open");
      expect(assessment.nextRecommendedCommand).toContain("mind:admit");
    });

    test("no critic review: reports in_progress when open round exists", () => {
      const r1 = createRound(1, "obj-active", "cand-active", "opened");
      const state: Record<string, unknown> = {
        rounds: [r1],
      };

      const assessment = assessRecyclingState(state, runRoot);
      expect(assessment.phase).toBe("in_progress");
      expect(assessment.transition).toBe("pulse_to_wake");
      expect(assessment.objectiveId).toBe("obj-active");
      expect(assessment.candidateId).toBe("cand-active");
      expect(assessment.roundNumber).toBe(1);
      expect(assessment.nextRecommendedCommand).toContain("mind:wake");
    });

    test("no critic review: reports quiescent when no rounds and no candidates exist", () => {
      const state: Record<string, unknown> = {};

      const assessment = assessRecyclingState(state, runRoot);
      expect(assessment.phase).toBe("quiescent");
      expect(assessment.transition).toBe("pulse_to_wake");
      expect(assessment.objectiveId).toBeNull();
      expect(assessment.candidateId).toBeNull();
      expect(assessment.roundNumber).toBeNull();
      expect(assessment.nextRecommendedCommand).toContain("mind:wake");
      expect(assessment.infiniteCadence).toBe(true);
    });

    test("transitionCompletenessCriticSignOff aliases assessRecyclingState correctly", () => {
      const c1 = createCandidate("cand-1", "admitted");
      const state: Record<string, unknown> = {
        candidates: [c1],
        completion_review: { status: "clean", summary: "Clean sign-off." },
      };

      const direct = assessRecyclingState(state, runRoot);
      const helper = transitionCompletenessCriticSignOff(state, {
        runRoot,
        actor: "mind-lead",
      });

      expect(helper).toEqual(direct);
    });
  });

  describe("transitionPulseCloseToWake", () => {
    test("arms next wake after pulse closure with non-termination invariant", () => {
      const runRoot = ".capsules/pulse-test";
      const result = transitionPulseCloseToWake(runRoot, "pulse-007", "success");

      expect(result.canRecycle).toBe(true);
      expect(result.phase).toBe("pulse_closed");
      expect(result.transition).toBe("pulse_to_wake");
      expect(result.infiniteCadence).toBe(true);
      expect(result.objectiveId).toBeNull();
      expect(result.candidateId).toBeNull();
      expect(result.nextRecommendedCommand).toBe(`bun harness.ts mind:wake --run ${runRoot}`);
      expect(result.suggestedCommands).toEqual([`bun harness.ts mind:wake --run ${runRoot}`]);
      expect(result.reason).toContain("Pulse 'pulse-007' closed with outcome 'success'");
      expect(result.reason).toContain("Non-termination rail active");
    });
  });

  describe("planAutonomousRoundRecycle", () => {
    test("generates complete recycle plan with formatted brief", () => {
      const runRoot = ".capsules/plan-recycle-test";
      const c1 = createCandidate("cand-plan", "admitted");
      const state: Record<string, unknown> = {
        candidates: [c1],
        completion_review: { status: "clean", summary: "Round 1 verified." },
      };

      const plan = planAutonomousRoundRecycle(state, {
        runRoot,
        actor: "mind-agent",
      });

      expect(plan.runRoot).toBe(runRoot);
      expect(plan.transition).toBe("candidate_to_planning");
      expect(plan.currentRound).toBe(1);
      expect(plan.nextRound).toBe(2);
      expect(plan.objectiveId).toBe("obj-cand-plan");
      expect(plan.candidateId).toBe("cand-plan");
      expect(plan.nextRecommendedCommand).toContain("mind:round-open");
      expect(plan.planCommands.length).toBeGreaterThan(0);
      expect(plan.markdown).toContain("### Autonomous Mind Recycler");
      expect(plan.markdown).toContain(runRoot);
      expect(plan.markdown).toContain("candidate_to_planning");
    });
  });

  describe("formatRecycleBrief", () => {
    test("formats brief within line limit and includes all present attributes", () => {
      const runRoot = ".capsules/brief-test";
      const assessment = {
        canRecycle: true,
        phase: "critic_signed_off" as const,
        transition: "critic_to_next_round" as const,
        objectiveId: "obj-99",
        candidateId: "cand-99",
        roundNumber: 2,
        nextRecommendedCommand: `bun harness.ts mind:round-open --run ${runRoot} --round 2`,
        suggestedCommands: [`bun harness.ts mind:round-open --run ${runRoot} --round 2`],
        reason: "Successor round ready.",
        infiniteCadence: true as const,
      };

      const brief = formatRecycleBrief(assessment, runRoot);
      expect(brief).toContain("### Autonomous Mind Recycler");
      expect(brief).toContain(`- **Capsule**: \`${runRoot}\``);
      expect(brief).toContain("- **Phase**: `critic_signed_off`");
      expect(brief).toContain("- **Transition**: `critic_to_next_round`");
      expect(brief).toContain("- **Objective**: `obj-99`");
      expect(brief).toContain("- **Candidate**: `cand-99`");
      expect(brief).toContain("- **Round**: 2");
      expect(brief).toContain("- **Cadence**: infinite autonomous loop active");
      expect(brief).toContain("- **Reason**: Successor round ready.");
      expect(brief).toContain(`- **Next Instruction**: \`${assessment.nextRecommendedCommand}\``);

      const lineCount = brief.split("\n").length;
      expect(lineCount).toBeLessThanOrEqual(25);
    });

    test("formats brief omitting null objective, candidate, and round", () => {
      const runRoot = ".capsules/brief-quiescent";
      const assessment = {
        canRecycle: true,
        phase: "quiescent" as const,
        transition: "pulse_to_wake" as const,
        objectiveId: null,
        candidateId: null,
        roundNumber: null,
        nextRecommendedCommand: `bun harness.ts mind:wake --run ${runRoot}`,
        suggestedCommands: [`bun harness.ts mind:wake --run ${runRoot}`],
        reason: "Quiescent loop waiting for wake.",
        infiniteCadence: true as const,
      };

      const brief = formatRecycleBrief(assessment, runRoot);
      expect(brief).not.toContain("- **Objective**:");
      expect(brief).not.toContain("- **Candidate**:");
      expect(brief).not.toContain("- **Round**:");
      expect(brief).toContain("- **Phase**: `quiescent`");
    });
  });

  describe("enforceInfiniteMindCadence", () => {
    test("returns infinite cadence confirmation when non-terminal", () => {
      const runRoot = ".capsules/cadence-live";
      const result = enforceInfiniteMindCadence({
        runRoot,
        actor: "mind-1",
        isTerminal: false,
      });

      expect(result.cadence).toBe("infinite_autonomous");
      expect(result.allowed).toBe(true);
      expect(result.nextInstruction).toBe(`bun harness.ts mind:wake --run ${runRoot}`);
      expect(result.message).toContain("Infinite autonomous mind cadence active");
    });

    test("returns armed wake instruction even when terminal outcome recorded", () => {
      const runRoot = ".capsules/cadence-terminal";
      const result = enforceInfiniteMindCadence({
        runRoot,
        actor: "mind-1",
        isTerminal: true,
      });

      expect(result.cadence).toBe("infinite_autonomous");
      expect(result.allowed).toBe(true);
      expect(result.nextInstruction).toBe(`bun harness.ts mind:wake --run ${runRoot}`);
      expect(result.message).toContain(
        "Terminal outcome recorded; perpetual mind loop remains armed",
      );
    });
  });

  describe("drainAndAdmitFeedbackCandidates", () => {
    test("drains pending feedbacks from queue and admits them into capsule state", () => {
      const { runRoot, repoRoot } = setupMindCapsule("drain-test");
      const queuePath = join(repoRoot, "FEEDBACK_QUEUE.jsonl");

      writeFeedbackQueue(
        [
          {
            id: "fb-101",
            timestamp: "2026-08-21T10:00:00.000Z",
            priority: "CRITICAL_USER_FEEDBACK",
            status: "PENDING",
            category: "CORE_ENGINE",
            title: "Improve recycling cadence",
            content: "Avoid sleep between rounds",
          },
          {
            id: "fb-102",
            timestamp: "2026-08-21T10:05:00.000Z",
            priority: "HIGH_ARCHITECTURAL_FEATURE",
            status: "PENDING",
            category: "CLI_TOOLING",
            title: "Support wave plans",
            content: "Parallel orchestrator execution",
          },
        ],
        queuePath,
      );

      const result = drainAndAdmitFeedbackCandidates({
        runRoot,
        actor: "mind-admin",
        queuePath,
      });

      expect(result.drainedItems).toHaveLength(2);
      expect(result.admittedCandidates).toHaveLength(2);
      expect(result.admittedCandidates[0]?.id).toBe("cand-fb-101");
      expect(result.admittedCandidates[0]?.status).toBe("admitted");
      expect(result.admittedCandidates[1]?.id).toBe("cand-fb-102");
      expect(result.nextCommands).toHaveLength(2);
      expect(result.nextCommands[0]).toContain("mind:round-open");
      expect(result.wavePlanCommands).toContain(`bun harness.ts plan:compile --run ${runRoot}`);
      expect(result.wavePlanCommands).toContain(
        `bun harness.ts orchestrate --run ${runRoot} --parallel`,
      );

      // Verify state on disk
      const loaded = loadRun(runRoot, false);
      const candidates = extractAllCandidates(loaded.state as Record<string, unknown>);
      expect(candidates).toHaveLength(2);
      expect(candidates.map((c) => c.id)).toContain("cand-fb-101");
      expect(candidates.map((c) => c.id)).toContain("cand-fb-102");
    });
  });

  describe("compileAutonomicWavePlan", () => {
    test("groups admitted candidates into parallel execution batches", () => {
      const c1 = createCandidate("cand-w1", "admitted");
      const c2 = createCandidate("cand-w2", "admitted");
      const c3 = createCandidate("cand-w3", "admitted");
      const c4 = createCandidate("cand-w4", "admitted");
      const c5 = createCandidate("cand-w5", "admitted");

      const state: Record<string, unknown> = {
        mind: { generation: 2, actor: "mind-lead" },
        candidates: [c1, c2, c3, c4, c5],
      };

      const wavePlan = compileAutonomicWavePlan(state, ".capsules/mind-gen-2", {
        maxParallel: 2,
      });

      expect(wavePlan.generation).toBe(2);
      expect(wavePlan.totalCandidates).toBe(5);
      expect(wavePlan.waves).toHaveLength(3); // 2 + 2 + 1
      expect(wavePlan.waves[0]?.candidateIds).toEqual(["cand-w1", "cand-w2"]);
      expect(wavePlan.waves[1]?.candidateIds).toEqual(["cand-w3", "cand-w4"]);
      expect(wavePlan.waves[2]?.candidateIds).toEqual(["cand-w5"]);
      expect(wavePlan.dispatchCommands).toContain(
        "bun harness.ts plan:compile --run .capsules/mind-gen-2",
      );
      expect(wavePlan.dispatchCommands).toContain(
        "bun harness.ts orchestrate --run .capsules/mind-gen-2 --parallel",
      );
      expect(wavePlan.nextInstruction).toContain("mind:round-open");
    });
  });

  describe("executeAutonomicRollover & formatAutonomicRolloverBrief", () => {
    test("executes end-to-end autonomic generation rollover from Generation 1 to Generation 2", () => {
      const c1 = createCandidate("cand-prev-converged", "admitted");
      const r1 = createRound(1, "obj-1", "cand-prev-converged", "closed", "converged");
      const { runRoot, repoRoot } = setupMindCapsule("exec-rollover-test", {
        candidates: [c1],
        rounds: [r1],
        completionReview: { status: "clean", summary: "All Gen 1 tasks converged cleanly." },
      });

      const queuePath = join(repoRoot, "FEEDBACK_QUEUE.jsonl");
      writeFeedbackQueue(
        [
          {
            id: "fb-gen2-01",
            timestamp: "2026-08-21T11:00:00.000Z",
            priority: "CRITICAL_USER_FEEDBACK",
            status: "PENDING",
            category: "CORE_ENGINE",
            title: "Perpetual master heartbeat",
            content: "Anti-idle rollover engine",
          },
        ],
        queuePath,
      );

      const rolloverResult = executeAutonomicRollover({
        sourceRunRoot: runRoot,
        actor: "mind-master-orchestrator",
        feedbackQueuePath: queuePath,
        autoDrain: true,
      });

      expect(rolloverResult.success).toBe(true);
      expect(rolloverResult.sourceGeneration).toBe(1);
      expect(rolloverResult.targetGeneration).toBe(2);
      expect(rolloverResult.drainedFeedbackItems).toHaveLength(1);
      expect(rolloverResult.admittedCandidates).toHaveLength(1);
      expect(rolloverResult.admittedCandidates[0]?.id).toBe("cand-fb-gen2-01");
      expect(rolloverResult.wavePlan.waves.length).toBeGreaterThan(0);
      expect(rolloverResult.markdown).toContain("Autonomic Mind Generation Rollover: 1 → 2");
      expect(rolloverResult.markdown).toContain(
        "infinite autonomous loop active (zero yield / zero idle)",
      );

      // Check successor capsule
      const targetState = loadRun(rolloverResult.targetRunRoot, false);
      const targetMind = targetState.state.mind as Record<string, unknown>;
      expect(targetMind.generation).toBe(2);

      // Check source capsule is sealed
      const sourceState = loadRun(runRoot, false);
      const sourceMind = sourceState.state.mind as Record<string, unknown>;
      expect(sourceMind.status).toBe("rotated");
    });

    test("formatAutonomicRolloverBrief produces concise brief under line limit", () => {
      const brief = formatAutonomicRolloverBrief({
        sourceRunId: "mind-gen-1",
        targetRunId: "mind-gen-2",
        sourceGeneration: 1,
        targetGeneration: 2,
        targetRunRoot: ".capsules/mind-gen-2",
        drainedCount: 3,
        admittedCount: 3,
        waveCount: 2,
        nextInstruction: "bun harness.ts orchestrate --run .capsules/mind-gen-2 --parallel",
      });

      expect(brief).toContain("### Autonomic Mind Generation Rollover: 1 → 2");
      expect(brief).toContain("- **Source**: `mind-gen-1` (converged & sealed)");
      expect(brief).toContain("- **Successor**: `mind-gen-2` at `.capsules/mind-gen-2`");
      expect(brief).toContain("- **FEEDBACK_QUEUE Drained**: 3 items admitted");
      expect(brief).toContain(
        "- **Cadence**: infinite autonomous loop active (zero yield / zero idle)",
      );
      expect(brief.split("\n").length).toBeLessThanOrEqual(25);
    });
  });

  describe("formatMindRotateBrief and mindRotateCommand", () => {
    test("formatMindRotateBrief produces structured markdown within line limit", () => {
      const brief = formatMindRotateBrief({
        sourceRunId: "mind-gen-1",
        targetRunId: "mind-gen-2",
        sourceGeneration: 1,
        targetGeneration: 2,
        targetRunRoot: ".capsules/mind-gen-2",
        charterSha256: "abc123def456",
        pulseCounter: 42,
        carriedCandidatesCount: 3,
        openCandidatesCount: 2,
        declinedCandidatesCount: 1,
        previousEventHead: "evt-999",
        rotatedAt: "2026-08-21T12:00:00.000Z",
      });

      expect(brief).toContain("### Mind Rotated: Generation 1 → 2");
      expect(brief).toContain("- **Source Capsule**: `mind-gen-1` (sealed with status `rotated`)");
      expect(brief).toContain("- **Successor Capsule**: `mind-gen-2` at `.capsules/mind-gen-2`");
      expect(brief).toContain("- **Charter SHA-256**: `abc123def456`");
      expect(brief).toContain("- **Pulse Counter**: 42 (preserved)");
      expect(brief).toContain("- **Candidates Carried Forward**: 3 (2 open/admitted, 1 declined)");
      expect(brief).toContain("- **Previous Event Head**: `evt-999`");
      expect(brief).toContain("mind:wake --run .capsules/mind-gen-2");

      const lineCount = brief.split("\n").length;
      expect(lineCount).toBeLessThanOrEqual(30);
    });

    test("executes mindRotateCommand successfully on initialized mind capsule", () => {
      const c1 = createCandidate("cand-open-1", "opened");
      const c2 = createCandidate("cand-declined-1", "declined");
      const { runRoot } = setupMindCapsule("rotate-test-cmd", {
        candidates: [c1, c2],
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
      expect(result.carried_candidates_count).toBe(2);
      expect(result.open_candidates_count).toBe(1);
      expect(result.declined_candidates_count).toBe(1);
      expect(result.rotated_at).toBe("2026-08-21T12:00:00.000Z");
      expect(result.markdown).toContain("Mind Rotated: Generation 1 → 2");

      // Verify target capsule is loaded and initialized properly
      const targetState = loadRun(result.target_run_root);
      const targetMind = targetState.state.mind as Record<string, unknown>;
      expect(targetMind.generation).toBe(2);
      expect(result.source_run_id).toBe("mind-gen-1");
    });
  });

  describe("inspectRecycleHealth & validateRolloverReadiness", () => {
    test("inspectRecycleHealth returns healthy status and activeCadence", () => {
      const state: Record<string, unknown> = {
        mind: {
          generation: 1,
          rounds: [{ number: 1, status: "closed", objective_id: "obj-1" }],
        },
      };
      const health = inspectRecycleHealth(state, "/fake/run", {
        actor: "owner-alice",
        now: "2026-08-21T15:00:00.000Z",
      });
      expect(health.healthy).toBe(true);
      expect(health.activeCadence).toBe("infinite_autonomous");
      expect(health.timestamp).toBe("2026-08-21T15:00:00.000Z");
      expect(health.assessment.infiniteCadence).toBe(true);
    });

    test("validateRolloverReadiness validates generation sequence correctly", () => {
      const stateWithoutMind: Record<string, unknown> = {};
      const resMissing = validateRolloverReadiness(stateWithoutMind, 2);
      expect(resMissing.ready).toBe(false);
      expect(resMissing.reason).toContain("Missing mind substate");

      const stateWithMind: Record<string, unknown> = { mind: { generation: 2 } };
      const resEqual = validateRolloverReadiness(stateWithMind, 2);
      expect(resEqual.ready).toBe(false);
      expect(resEqual.reason).toContain("must exceed current generation");

      const resLower = validateRolloverReadiness(stateWithMind, 1);
      expect(resLower.ready).toBe(false);

      const resHigher = validateRolloverReadiness(stateWithMind, 3);
      expect(resHigher.ready).toBe(true);
      expect(resHigher.generation).toBe(2);
      expect(resHigher.targetGeneration).toBe(3);
      expect(resHigher.reason).toContain("ready to transition from generation 2 to 3");
    });
  });
});

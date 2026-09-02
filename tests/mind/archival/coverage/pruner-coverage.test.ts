import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import { initRun, transact } from "../../../../olt/scripts/src/engine/store/index.ts";
import {
  executeAutonomicRollover,
  formatAutonomicRolloverBrief,
  formatRecycleBrief,
  planAutonomousRoundRecycle,
} from "../../../../olt/scripts/src/mind/archival/recycler/pruner.ts";
import type { RecycleAssessment } from "../../../../olt/scripts/src/mind/archival/recycler/types.ts";

const validCharter = `name: "mind"\nrole: "mind"\ntier: 0\ncharter:\n  identity: "Mind Pruner Consciousness"\n  goals:\n    - id: "G1"\n      statement: "Goal 1"\n  cognitive_pillars:\n    - "Pillar 1"\n  non_goals:\n    - "No non-goals"\n  repo_roots:\n    - "."\n`;

describe("Mind Archival Recycler Pruner Suite", () => {
  let tempDir: string;
  let repoRoot: string;
  let charterFile: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "pruner-cov-test-"));
    repoRoot = tempDir;
    mkdirSync(join(repoRoot, "olt", "agents"), { recursive: true });
    charterFile = join(repoRoot, "olt", "agents", "mind.yaml");
    writeFileSync(charterFile, validCharter);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function setupCapsule(runId: string, mindStatus = "active", generation = 1): string {
    const prompt = new TextEncoder().encode(validCharter);
    const runRoot = initRun(repoRoot, runId, prompt, "file", true);
    transact(runRoot, "owner", "mind-init", {}, (state) => {
      state.mind = {
        generation,
        status: mindStatus,
        charter: { source_path: "olt/agents/mind.yaml", repo_roots: ["."] },
      } as unknown as typeof state.mind;
      state.pulse = { counter: 1, open: null, last: { pulse_id: "pulse-last" } };
      state.candidates = [];
      state.rounds = [];
    });
    return runRoot;
  }

  it("formatAutonomicRolloverBrief renders brief markdown and respects line limit", () => {
    const brief = formatAutonomicRolloverBrief({
      sourceRunId: "run-gen-1",
      targetRunId: "run-gen-2",
      sourceGeneration: 1,
      targetGeneration: 2,
      targetRunRoot: "/virtual/capsules/run-gen-2",
      drainedCount: 3,
      admittedCount: 2,
      waveCount: 1,
      nextInstruction: "bun harness.ts mind:wake",
    });

    expect(brief).toContain("### Autonomic Mind Generation Rollover: 1 → 2");
    expect(brief).toContain("`run-gen-1` (converged & sealed)");
    expect(brief).toContain("`run-gen-2` at `/virtual/capsules/run-gen-2`");
    expect(brief).toContain("3 items admitted");
    expect(brief).toContain("Candidates Admitted**: 2");
    expect(brief).toContain("Concurrency Waves Compiled**: 1");
    expect(brief).toContain("infinite autonomous loop active");
    expect(brief).toContain("`bun harness.ts mind:wake`");
    expect(brief.split("\n").length).toBeLessThanOrEqual(25);
  });

  it("formatRecycleBrief renders brief with all assessment fields and handles missing fields", () => {
    const fullAssessment: RecycleAssessment = {
      canRecycle: true,
      phase: "critic_signed_off",
      transition: "candidate_to_planning",
      objectiveId: "obj-123",
      candidateId: "cand-456",
      roundNumber: 2,
      reason: "Critic approved round",
      nextRecommendedCommand: "bun harness.ts mind:round-open",
      suggestedCommands: ["bun harness.ts mind:round-open"],
      infiniteCadence: true,
    };
    const renderedFull = formatRecycleBrief(fullAssessment, "/virtual/test-capsule");
    expect(renderedFull).toContain("### Autonomous Mind Recycler");
    expect(renderedFull).toContain("- **Capsule**: `/virtual/test-capsule`");
    expect(renderedFull).toContain("- **Phase**: `critic_signed_off`");
    expect(renderedFull).toContain("- **Transition**: `candidate_to_planning`");
    expect(renderedFull).toContain("- **Objective**: `obj-123`");
    expect(renderedFull).toContain("- **Candidate**: `cand-456`");
    expect(renderedFull).toContain("- **Round**: 2");
    expect(renderedFull).toContain("- **Reason**: Critic approved round");
    expect(renderedFull).toContain("- **Next Instruction**: `bun harness.ts mind:round-open`");

    const minimalAssessment: RecycleAssessment = {
      canRecycle: false,
      phase: "quiescent",
      transition: "idle_to_wake",
      objectiveId: null,
      candidateId: null,
      roundNumber: null,
      reason: "Idle state reached",
      nextRecommendedCommand: "bun harness.ts mind:wake",
      suggestedCommands: [],
      infiniteCadence: true,
    };
    const renderedMinimal = formatRecycleBrief(minimalAssessment, "/virtual/min-capsule");
    expect(renderedMinimal).not.toContain("**Objective**");
    expect(renderedMinimal).not.toContain("**Candidate**");
    expect(renderedMinimal).not.toContain("**Round**");
    expect(renderedMinimal).toContain("- **Reason**: Idle state reached");
  });

  it("planAutonomousRoundRecycle computes plan with nextRound and markdown", () => {
    const stateWithCandidate = {
      mind: { actor: "test-mind", generation: 1 },
      completion_review: { status: "clean" },
      candidates: [{ id: "c-plan-1", status: "admitted" }],
      rounds: [],
    };
    const plan = planAutonomousRoundRecycle(stateWithCandidate, {
      runRoot: "/virtual/plan-run",
      now: 1756700000000,
    });
    expect(plan.runRoot).toBe("/virtual/plan-run");
    expect(plan.transition).toBe("candidate_to_planning");
    expect(plan.currentRound).toBe(1);
    expect(plan.nextRound).toBe(2);
    expect(plan.objectiveId).toBe("obj-c-plan-1");
    expect(plan.candidateId).toBe("c-plan-1");
    expect(plan.nextRecommendedCommand).toContain("mind:round-open");
    expect(plan.markdown).toContain("### Autonomous Mind Recycler");

    const quiescentState = { mind: { actor: "test-mind", generation: 1 }, candidates: [] };
    const quiescentPlan = planAutonomousRoundRecycle(quiescentState, {
      runRoot: "/virtual/quiescent-run",
    });
    expect(quiescentPlan.currentRound).toBeNull();
    expect(quiescentPlan.nextRound).toBeNull();
  });

  it("executeAutonomicRollover throws HarnessError INVALID_STATE if source capsule is not ready", () => {
    const runRoot = setupCapsule("sealed-source", "rotated", 1);
    expect(() =>
      executeAutonomicRollover({
        sourceRunRoot: runRoot,
        targetRunId: "sealed-target",
      }),
    ).toThrow(HarnessError);
  });

  it("executeAutonomicRollover rolls over generation, drains feedback, and compiles wave plan", () => {
    const sourceRunRoot = setupCapsule("rollover-source", "active", 1);
    const queuePath = join(tempDir, "fb-queue.jsonl");
    const fbItem = {
      id: "fb-pruner-1",
      timestamp: "2026-09-01T12:00:00.000Z",
      priority: "HIGH",
      status: "PENDING",
      category: "GENERAL",
      title: "Pruner Feedback Item",
      content: "Ensure pruner drains queue cleanly",
    };
    writeFileSync(queuePath, `${JSON.stringify(fbItem)}\n`);

    const result = executeAutonomicRollover({
      sourceRunRoot,
      targetRunId: "rollover-target",
      actor: "mind-governor-custom",
      feedbackQueuePath: queuePath,
      now: 1756700000000,
      autoDrain: true,
      maxParallel: 2,
    });

    expect(result.success).toBe(true);
    expect(result.sourceGeneration).toBe(1);
    expect(result.targetGeneration).toBe(2);
    expect(result.sourceRunId).toBe("rollover-source");
    expect(result.targetRunId).toBe("rollover-target");
    expect(result.drainedFeedbackItems.length).toBe(1);
    expect(result.admittedCandidates.length).toBe(1);
    expect(result.wavePlan.waves.length).toBe(1);
    expect(result.nextRecommendedCommand).toContain("mind:round-open");
    expect(result.markdown).toContain("### Autonomic Mind Generation Rollover: 1 → 2");
  });

  it("executeAutonomicRollover skips feedback drainage when autoDrain is false", () => {
    const sourceRunRoot = setupCapsule("no-drain-source", "active", 1);
    const queuePath = join(tempDir, "ignored-fb.jsonl");
    const fbItem = {
      id: "fb-ignored",
      timestamp: "2026-09-01T12:00:00.000Z",
      priority: "NORMAL",
      status: "PENDING",
      category: "GENERAL",
      title: "Ignored Item",
      content: "Should not be drained",
    };
    writeFileSync(queuePath, `${JSON.stringify(fbItem)}\n`);

    const result = executeAutonomicRollover({
      sourceRunRoot,
      targetRunId: "no-drain-target",
      feedbackQueuePath: queuePath,
      autoDrain: false,
    });

    expect(result.success).toBe(true);
    expect(result.drainedFeedbackItems.length).toBe(0);
    expect(result.admittedCandidates.length).toBe(0);
    expect(result.targetGeneration).toBe(2);
  });
});

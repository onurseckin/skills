import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  compileAutonomicWavePlan,
  drainAndAdmitFeedbackCandidates,
  transitionCompletenessCriticSignOff,
  transitionPulseCloseToWake,
  transitionPulseToWake,
} from "../../../../olt/scripts/src/mind/archival/recycler/collector.ts";
import { initRun, loadRun, transact } from "../../../../olt/scripts/src/engine/store/index.ts";
import {
  cleanupRoots,
  cleanupVirtualCliFS,
  setupVirtualCliFS,
} from "../../../cli/commands/fixtures/full-lifecycle-fixture.ts";

const roots: string[] = [];

describe("Mind Archival Recycler Collector Suite", () => {
  let testDir: string;

  beforeEach(() => {
    setupVirtualCliFS();
    testDir = `/virtual/cli/recycler-test-${Date.now()}`;
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(async () => {
    await cleanupRoots(roots);
    cleanupVirtualCliFS();
  });

  function setupFixture(label: string) {
    const repoRoot = `/virtual/cli/collector-${label}-${Math.random().toString(36).slice(2)}`;
    roots.push(repoRoot);
    mkdirSync(repoRoot, { recursive: true });
    const prompt = new TextEncoder().encode("Mind test prompt");
    const runRoot = initRun(repoRoot, `run-${label}`, prompt, "file", true);
    return { repoRoot, runRoot };
  }

  it("transitionCompletenessCriticSignOff delegates to assessRecyclingState", () => {
    const state = {
      mind: { actor: "mind-signoff", generation: 1 },
      completion_review: { status: "clean" },
      candidates: [{ id: "c-100", status: "admitted" }],
    };

    const res = transitionCompletenessCriticSignOff(state, {
      runRoot: "/virtual/test-run",
      now: 1756700000000,
    });

    expect(res.canRecycle).toBe(true);
    expect(res.phase).toBe("critic_signed_off");
    expect(res.transition).toBe("candidate_to_planning");
    expect(res.candidateId).toBe("c-100");
  });

  it("transitionPulseToWake and transitionPulseCloseToWake generate wake command and assessment", () => {
    const res1 = transitionPulseToWake("/virtual/pulse-run", "pulse-42", "completed");
    expect(res1.canRecycle).toBe(true);
    expect(res1.phase).toBe("pulse_closed");
    expect(res1.transition).toBe("pulse_to_wake");
    expect(res1.nextRecommendedCommand).toContain("mind:wake --run /virtual/pulse-run");
    expect(res1.reason).toContain("Pulse 'pulse-42' closed with outcome 'completed'");
    expect(res1.infiniteCadence).toBe(true);

    const res2 = transitionPulseCloseToWake("/virtual/pulse-run-2", "pulse-99");
    expect(res2.canRecycle).toBe(true);
    expect(res2.transition).toBe("pulse_to_wake");
    expect(res2.reason).toContain("outcome 'active'");
  });

  it("drainAndAdmitFeedbackCandidates handles empty feedback queue gracefully", () => {
    const { runRoot } = setupFixture("empty-feedback");
    const emptyQueuePath = join(testDir, "empty-feedback.jsonl");
    writeFileSync(emptyQueuePath, "");

    const res = drainAndAdmitFeedbackCandidates({
      runRoot,
      actor: "mind-governor",
      queuePath: emptyQueuePath,
    });

    expect(res.runRoot).toBe(runRoot);
    expect(res.drainedItems.length).toBe(0);
    expect(res.admittedCandidates.length).toBe(0);
    expect(res.nextCommands.length).toBe(0);
    expect(res.wavePlanCommands.length).toBe(2);
  });

  it("drainAndAdmitFeedbackCandidates drains items, mutates state, and creates admitted candidates", () => {
    const { runRoot } = setupFixture("drain-admit");
    const queuePath = join(testDir, "pending-feedback.jsonl");

    const feedback1 = {
      id: "fb-101",
      candidate_id: "cand-doc-1",
      timestamp: "2026-09-01T12:00:00.000Z",
      priority: "HIGH",
      status: "PENDING",
      category: "DOCUMENTATION",
      title: "Update API docs",
      content: "Document missing flags",
    };

    const feedback2 = {
      id: "fb-102",
      timestamp: "2026-09-01T12:01:00.000Z",
      priority: "NORMAL",
      status: "PENDING",
      category: "CLI_TOOLING",
      title: "Fix crash on invalid input",
      content: "Ensure CLI handles empty input",
    };

    writeFileSync(queuePath, `${JSON.stringify(feedback1)}\n${JSON.stringify(feedback2)}\n`);

    const res = drainAndAdmitFeedbackCandidates({
      runRoot,
      actor: "mind-governor",
      queuePath,
      defaultCharterGoal: "G2",
      defaultWriteScope: ["src/mind/"],
      now: 1756700000000,
    });

    expect(res.drainedItems.length).toBe(2);
    expect(res.admittedCandidates.length).toBe(2);
    expect(res.admittedCandidates[0]?.id).toBe("cand-doc-1");
    expect(res.admittedCandidates[0]?.kind).toBe("proposal");
    expect(res.admittedCandidates[0]?.charter_goals).toEqual(["G2"]);
    expect(res.admittedCandidates[0]?.write_scope).toEqual(["src/mind/"]);
    expect(res.admittedCandidates[0]?.statement).toBe("Update API docs: Document missing flags");

    expect(res.admittedCandidates[1]?.id).toBe("cand-fb-102");
    expect(res.admittedCandidates[1]?.kind).toBe("defect");
    expect(res.admittedCandidates[1]?.statement).toBe(
      "Fix crash on invalid input: Ensure CLI handles empty input",
    );

    expect(res.nextCommands.length).toBe(2);
    expect(res.nextCommands[0]).toContain("mind:round-open");

    const loaded = loadRun(runRoot, false);
    const candidates = loaded.state.candidates as Array<Record<string, unknown>>;
    expect(candidates.length).toBe(2);
    expect((loaded.state.mind as Record<string, unknown>).candidates).toBeDefined();
  });

  it("compileAutonomicWavePlan generates wave partitions and commands with custom actor & maxParallel", () => {
    const state = {
      mind: { generation: 2, actor: "mind-orchestrator" },
      candidates: [
        { id: "c-1", status: "admitted" },
        { id: "c-2", status: "admitted" },
        { id: "c-3", status: "admitted" },
        { id: "c-4", status: "admitted" },
        { id: "c-5", status: "admitted" },
        { id: "c-6", status: "declined" },
      ],
    };

    const res = compileAutonomicWavePlan(state, "/virtual/wave-run", {
      maxParallel: 2,
    });

    expect(res.runRoot).toBe("/virtual/wave-run");
    expect(res.generation).toBe(2);
    expect(res.totalCandidates).toBe(5);
    expect(res.waves.length).toBe(3); // 2 + 2 + 1
    expect(res.waves[0]?.waveIndex).toBe(1);
    expect(res.waves[0]?.candidateIds).toEqual(["c-1", "c-2"]);
    expect(res.waves[1]?.candidateIds).toEqual(["c-3", "c-4"]);
    expect(res.waves[2]?.candidateIds).toEqual(["c-5"]);
    expect(res.dispatchCommands.length).toBe(7); // 5 round-open + 1 plan:compile + 1 orchestrate
    expect(res.nextInstruction).toContain(
      "mind:round-open --run /virtual/wave-run --actor mind-orchestrator --objective obj-c-1 --candidate c-1",
    );
  });

  it("compileAutonomicWavePlan falls back to mind:wake when no admitted candidates exist", () => {
    const state = {
      mind: {},
      candidates: [],
    };

    const res = compileAutonomicWavePlan(state, "/virtual/empty-run");
    expect(res.totalCandidates).toBe(0);
    expect(res.waves.length).toBe(0);
    expect(res.dispatchCommands).toEqual([
      "bun harness.ts plan:compile --run /virtual/empty-run",
      "bun harness.ts orchestrate --run /virtual/empty-run --parallel",
    ]);
    expect(res.nextInstruction).toContain("plan:compile --run /virtual/empty-run");
  });
});

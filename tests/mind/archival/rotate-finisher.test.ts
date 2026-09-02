import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { initRun, loadRun, transact } from "../../../olt/scripts/src/engine/store/index.ts";
import { parseCharter } from "../../../olt/scripts/src/mind/lifecycle/charter/index.ts";
import { finishRotation } from "../../../olt/scripts/src/mind/archival/rotate/finisher.ts";
import { writeAgentLedger } from "../../../olt/scripts/src/workflow/agents/ledger.ts";

const sampleCharterYaml = `
name: "mind"
role: "mind"
tier: 0
charter:
  identity: "Mind rotation finisher test identity"
  goals:
    - id: "G1"
      statement: "Goal one"
    - id: "G2"
      statement: "Goal two"
  cognitive_pillars:
    - "Observability"
  non_goals:
    - "Make-work"
  repo_roots:
    - "."
`;

describe("finishRotation", () => {
  let tempDir: string;
  let repoRoot: string;
  let capsulesParent: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "finish-rot-test-"));
    repoRoot = tempDir;
    capsulesParent = join(repoRoot, ".olt", "capsules");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("throws HarnessError INTEGRITY on charter digest mismatch", () => {
    const promptBytes = new TextEncoder().encode(sampleCharterYaml);
    const parsedCharter = parseCharter(sampleCharterYaml);
    const sourceRunRoot = initRun(repoRoot, "source-run-mismatch", promptBytes, "file", true);

    const corruptedCharter = {
      ...parsedCharter,
      sha256: "0000000000000000000000000000000000000000000000000000000000000000",
    };

    expect(() =>
      finishRotation({
        repoRoot,
        targetRunId: "target-run-mismatch",
        promptBytes,
        parsedCharter: corruptedCharter,
        liveCharterPath: join(repoRoot, "olt", "agents", "mind.yaml"),
        sourceRunId: "source-run-mismatch",
        realSourceRunRoot: sourceRunRoot,
        sourceGeneration: 1,
        targetGeneration: 2,
        sourceState: {},
        capsulesParent,
        actor: "owner",
        nowIso: new Date().toISOString(),
        previousEventHead: null,
        charterSourcePath: "olt/agents/mind.yaml",
        charterGoals: parsedCharter.goalIds,
        charterRepoRoots: parsedCharter.repoRoots,
        sourceLoaded: { state: {} },
      }),
    ).toThrow(HarnessError);
  });

  it("successfully completes rotation carrying state, grants, candidates, and budget", () => {
    const promptBytes = new TextEncoder().encode(sampleCharterYaml);
    const parsedCharter = parseCharter(sampleCharterYaml);
    const sourceRunRoot = initRun(repoRoot, "source-run-ok", promptBytes, "file", true);

    // Populate source run state with budget, pulse, candidates, ledger
    transact(sourceRunRoot, "owner", "mind-init", {}, (state) => {
      state.budget = {
        pulses_per_day: 50,
        wall_clock_ms_per_day: 100000,
        max_agents_in_flight: 8,
        max_rounds_per_objective: 4,
        base_interval_ms: 1000,
        max_interval_ms: 10000,
        max_pause_interval_ms: 5000,
        pulse_deadline_ms: 30000,
        max_open_proposals: 10,
        quiet_hours: false,
        day_key: "2026-09-01",
        pulses_today: 12,
        wall_clock_ms_today: 45000,
      };
      state.pulse = {
        counter: 15,
        open: null,
        last: { pulse_id: "pulse-last" },
      };
      state.candidates = [
        { id: "cand-open-1", status: "opened", generation: 1 },
        { id: "cand-adm-1", status: "admitted", generation: 1 },
        { id: "cand-dec-1", status: "declined", generation: 1 },
      ];
      state.objectives = [{ id: "obj-1", status: "active", generation: 1 }];
      writeAgentLedger(state, [
        {
          id: "agent-active",
          role: "implementer",
          parent_agent_id: null,
          parent_task_id: null,
          host: "local",
          granted_at: "2026-09-01T00:00:00.000Z",
          status: "active",
        },
        {
          id: "agent-retired",
          role: "validator",
          parent_agent_id: null,
          parent_task_id: null,
          host: "local",
          granted_at: "2026-09-01T00:00:00.000Z",
          status: "released",
        },
      ]);
    });

    const sourceLoaded = loadRun(sourceRunRoot, false);
    const nowIso = "2026-09-01T12:00:00.000Z";

    const result = finishRotation({
      repoRoot,
      targetRunId: "target-run-ok",
      promptBytes,
      parsedCharter,
      liveCharterPath: join(repoRoot, "olt", "agents", "mind.yaml"),
      sourceRunId: "source-run-ok",
      realSourceRunRoot: sourceRunRoot,
      sourceGeneration: 1,
      targetGeneration: 2,
      sourceState: sourceLoaded.state as Record<string, unknown>,
      capsulesParent,
      actor: "mind-governor",
      nowIso,
      previousEventHead: sourceLoaded.state.event_head ?? null,
      charterSourcePath: "olt/agents/mind.yaml",
      charterGoals: parsedCharter.goalIds,
      charterRepoRoots: parsedCharter.repoRoots,
      sourceLoaded: sourceLoaded as { state: Record<string, unknown> },
    });

    expect(result.sourceRunId).toBe("source-run-ok");
    expect(result.targetRunId).toBe("target-run-ok");
    expect(result.sourceGeneration).toBe(1);
    expect(result.targetGeneration).toBe(2);
    expect(result.charterSha256).toBe(parsedCharter.sha256);
    expect(result.pulseCounter).toBe(15);
    expect(result.openCandidatesCount).toBe(2);
    expect(result.declinedCandidatesCount).toBe(1);
    expect(result.carriedGrantsCount).toBe(1);
    expect(result.rotatedAt).toBe(nowIso);

    // Verify initialized target state
    const targetLoaded = loadRun(result.targetRunRoot, false);
    const targetState = targetLoaded.state as Record<string, unknown>;
    const targetMind = targetState.mind as Record<string, unknown>;
    expect(targetMind.generation).toBe(2);
    expect(targetMind.opened_at).toBe(nowIso);

    const targetBudget = targetState.budget as Record<string, unknown>;
    expect(targetBudget.pulses_per_day).toBe(50);
    expect(targetBudget.quiet_hours).toBe(false);
    expect(targetBudget.pulses_today).toBe(12);

    const targetPulse = targetState.pulse as Record<string, unknown>;
    expect(targetPulse.counter).toBe(15);
    expect(targetPulse.open).toBeNull();
    expect(targetPulse.last).toBeNull();

    // Verify last_pulse.json written in target root
    const lastPulsePath = join(result.targetRunRoot, "last_pulse.json");
    expect(existsSync(lastPulsePath)).toBe(true);
    const lastPulseContent = JSON.parse(readFileSync(lastPulsePath, "utf-8"));
    expect(lastPulseContent.at).toBe(nowIso);
    expect(lastPulseContent.pulse_id).toBeNull();
  });

  it("handles fallback defaults for pulse counter and budget when sourceState has none", () => {
    const promptBytes = new TextEncoder().encode(sampleCharterYaml);
    const parsedCharter = parseCharter(sampleCharterYaml);
    const sourceRunRoot = initRun(repoRoot, "source-run-defaults", promptBytes, "file", true);
    const sourceLoaded = loadRun(sourceRunRoot, false);
    const nowIso = "2026-09-01T14:00:00.000Z";

    const result = finishRotation({
      repoRoot,
      targetRunId: "target-run-defaults",
      promptBytes,
      parsedCharter,
      liveCharterPath: join(repoRoot, "olt", "agents", "mind.yaml"),
      sourceRunId: "source-run-defaults",
      realSourceRunRoot: sourceRunRoot,
      sourceGeneration: 1,
      targetGeneration: 2,
      sourceState: {},
      capsulesParent,
      actor: "owner",
      nowIso,
      previousEventHead: null,
      charterSourcePath: "olt/agents/mind.yaml",
      charterGoals: parsedCharter.goalIds,
      charterRepoRoots: parsedCharter.repoRoots,
      sourceLoaded: { state: {} },
    });

    expect(result.pulseCounter).toBe(0);
    expect(result.carriedGrantsCount).toBe(0);

    const targetLoaded = loadRun(result.targetRunRoot, false);
    const targetState = targetLoaded.state as Record<string, unknown>;
    const targetBudget = targetState.budget as Record<string, unknown>;
    expect(targetBudget.day_key).toBe("2026-09-01");
    expect(targetBudget.pulses_today).toBe(0);
    expect(targetBudget.wall_clock_ms_today).toBe(0);
  });
});

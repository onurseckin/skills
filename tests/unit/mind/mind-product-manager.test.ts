import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  evaluateMindMode,
  discoverGroundedFeatures,
  runMindProductManagerLoop,
  evaluateAntiStagnation,
  computeProgressSignature,
  recordNonZeroProgress,
} from "../../../olt/scripts/src/mind/lifecycle/orchestration/index.ts";
import {
  auditMindPreplanningStagnation,
  auditMindCreativeStagnation,
  compareReportDelta,
  isZeroDeltaReport,
  suppressZeroDeltaReport,
  MIND_CREATIVE_STAGNATION,
  MIND_PREPLANNING_STAGNATION,
} from "../../../olt/scripts/src/mind/auditing/mind-stagnation-auditor.ts";
import {
  mindCandidateCommand,
  formatMindCandidateBrief,
} from "../../../olt/scripts/src/cli/commands/mind-candidate.ts";
import {
  mindObserveCommand,
  formatMindObserveBrief,
} from "../../../olt/scripts/src/cli/commands/mind-observe.ts";
import {
  mindPulseCommand,
  computeMindCognitiveTelemetry,
} from "../../../olt/scripts/src/cli/commands/mind-pulse.ts";
import { initRun, loadRun, transact } from "../../../olt/scripts/src/engine/store/index.ts";
import { writeAgentLedger } from "../../../olt/scripts/src/workflow/agents/ledger.ts";
import { writeTaskQueue, enqueueTasksBatch } from "../../../olt/scripts/src/task/queue/index.ts";
import { writeFeedbackQueue } from "../../../olt/scripts/src/mind/feedback/queue/index.ts";
import {
  readCognitiveMemory,
  writeCognitiveMemory,
} from "../../../olt/scripts/src/mind/tasks/smart/planner/memory.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {}
  }
  roots.length = 0;
});

function createTestFixture(name = "mind-pm-fixture") {
  const repo = mkdtempSync(join(tmpdir(), `mind-pm-test-${name}-`));
  roots.push(repo);

  const charterDir = join(repo, "olt", "agents");
  mkdirSync(charterDir, { recursive: true });
  const charterPath = join(charterDir, "mind.yaml");
  const charterContent = `
# Mind Charter
goals:
  - G1
  - G2
  - G3
repo_roots:
  - .
budgets:
  pulses_per_day: 100
  wall_clock_ms_per_day: 86400000
  max_agents_in_flight: 5
  max_rounds_per_objective: 3
  base_interval_ms: 900000
  max_interval_ms: 7200000
  pulse_deadline_ms: 1800000
  max_open_proposals: 5
`;
  writeFileSync(charterPath, charterContent.trim());
  const charterBytes = Buffer.from(charterContent.trim(), "utf-8");
  const charterSha = createHash("sha256").update(charterBytes).digest("hex");

  const run = initRun(repo, `run-${name}`, charterBytes, "file", true);
  roots.push(run);

  // Set initial mind state
  transact(run, "owner", "mind-initialized", { generation: 1 }, (state) => {
    state.mind = {
      generation: 1,
      opened_at: new Date().toISOString(),
      charter: {
        source_path: "olt/agents/mind.yaml",
        pinned_sha256: charterSha,
        goals: ["G1", "G2", "G3"],
        repo_roots: ["."],
        evidence_class: "harness_observed",
      },
      halted: false,
    };
    state.budget = {
      pulses_per_day: 100,
      wall_clock_ms_per_day: 86400000,
      pulse_deadline_ms: 1800000,
      base_interval_ms: 900000,
      day_key: new Date().toISOString().slice(0, 10),
      pulses_today: 0,
      wall_clock_ms_today: 0,
      max_rounds_per_objective: 3,
      max_open_proposals: 5,
    };
    state.pulse = {
      counter: 0,
      open: null,
      last: null,
    };
    writeAgentLedger(state, [
      {
        id: "mind-1",
        role: "mind",
        parent_agent_id: null,
        parent_task_id: null,
        host: "local",
        granted_at: new Date().toISOString(),
        status: "active",
      },
    ]);
  });

  const oltDir = join(repo, ".olt");
  mkdirSync(oltDir, { recursive: true });

  const queuePath = join(oltDir, "task-queue.jsonl");
  writeTaskQueue([], queuePath);

  const feedbackPath = join(oltDir, "backlog.jsonl");
  writeFeedbackQueue([], feedbackPath);

  const memoryPath = join(oltDir, "memory.json");
  writeCognitiveMemory(
    {
      version: 1,
      last_updated: new Date().toISOString(),
      active_hypotheses: [
        {
          id: "hyp-1",
          statement: "Autonomous Product Manager cycle drives 100% grounded feature expansion.",
          confidence: 0.95,
          status: "active",
          evidence: ["Test fixture initialized"],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
      roadmaps: [],
      strategic_focus: ["Mode A Creative Product Manager"],
    },
    memoryPath,
  );

  return { repo, run, queuePath, feedbackPath, memoryPath, charterSha };
}

describe("Mind Product Manager Autonomous Expansion & Anti-Stagnation Loop", () => {
  it("transitions automatically to Mode A Creative Product Manager when queue and feedback are empty", () => {
    const { repo, queuePath, feedbackPath, memoryPath } = createTestFixture("mode-a-transition");

    const evaluation = evaluateMindMode({
      repoRoot: repo,
      queuePath,
      feedbackQueuePath: feedbackPath,
      capsulesDir: repo,
      memoryPath,
    });

    expect(evaluation.mode).toBe("MODE_A_CREATIVE_PRODUCT_MANAGER");
    expect(evaluation.activeTasksCount).toBe(0);
    expect(evaluation.feedbackCount).toBe(0);
    expect(evaluation.recommendedAction).toBe("EXECUTE_AUTONOMOUS_PRODUCT_EXPANSION");
  });

  it("transitions to Mode B External Intake when pending feedback items exist", () => {
    const { repo, queuePath, feedbackPath, memoryPath } = createTestFixture("mode-b-transition");

    writeFeedbackQueue(
      [
        {
          id: "fb-1",
          timestamp: new Date().toISOString(),
          priority: "HIGH_ARCHITECTURAL_FEATURE",
          status: "PENDING",
          category: "CORE_ENGINE",
          title: "Optimize Token Efficiency",
          content: "Reduce prompt serialization overhead across subagent calls",
          candidate_id: null,
        },
      ],
      feedbackPath,
    );

    const evaluation = evaluateMindMode({
      repoRoot: repo,
      queuePath,
      feedbackQueuePath: feedbackPath,
      capsulesDir: repo,
      memoryPath,
    });

    expect(evaluation.mode).toBe("MODE_B_EXTERNAL_INTAKE");
    expect(evaluation.feedbackCount).toBe(1);
    expect(evaluation.recommendedAction).toBe("PROCESS_FEEDBACK_INTAKE");
  });

  it("transitions to QUEUE_ACTIVE_EXECUTION when active tasks exist in the task queue", () => {
    const { repo, queuePath, feedbackPath, memoryPath } = createTestFixture("queue-active-transition");

    enqueueTasksBatch(
      [
        {
          id: "task-1-active-feature",
          title: "Active Invariant Verification",
          description: "Verify 0 TypeScript any across modules",
          priority: "HIGH",
          write_scope: ["src/"],
          gate: "bun test",
          charter_goals: ["G1"],
          acceptance_criteria: ["Passes unit tests"],
          dependencies: [],
          source_type: "self_evolution",
        },
      ],
      queuePath,
    );

    const evaluation = evaluateMindMode({
      repoRoot: repo,
      queuePath,
      feedbackQueuePath: feedbackPath,
      capsulesDir: repo,
      memoryPath,
    });

    expect(evaluation.mode).toBe("QUEUE_ACTIVE_EXECUTION");
    expect(evaluation.activeTasksCount).toBe(1);
    expect(evaluation.recommendedAction).toBe("SUPERVISE_ACTIVE_WAVES");
  });

  it("discovers grounded feature proposals matching charter goals G1, G2, and G3", () => {
    const { repo } = createTestFixture("grounded-discovery");

    const structure = {
      repoRoot: repo,
      apps: ["apps/web"],
      packages: ["packages/core"],
      src: ["src"],
      tests: ["tests/unit"],
      docs: ["docs"],
      planning: ["docs/planning"],
      hasApps: true,
      hasPackages: true,
      hasSrc: true,
      hasTests: true,
      hasDocs: true,
      hasPlanning: true,
    };

    const proposals = discoverGroundedFeatures(structure, ["G1", "G2", "G3"], 3);

    expect(proposals.length).toBe(3);
    expect(proposals[0]!.step).toBe("step_1_baseline_quality");
    expect(proposals[0]!.charterGoals).toContain("G1");

    expect(proposals[1]!.step).toBe("step_2_product_ux_audit");
    expect(proposals[1]!.charterGoals).toContain("G2");

    expect(proposals[2]!.step).toBe("step_3_creative_ideation");
    expect(proposals[2]!.charterGoals).toContain("G3");
  });

  it("executes the full Product Manager loop synthesizing isolated tasks and logging non-zero progress", () => {
    const { repo, queuePath, memoryPath } = createTestFixture("pm-loop-execution");

    const result = runMindProductManagerLoop({
      repoRoot: repo,
      queuePath,
      memoryPath,
      charterGoals: ["G1", "G2", "G3"],
      autoEnqueue: true,
    });

    expect(result.mode).toBe("MODE_A_CREATIVE_PRODUCT_MANAGER");
    expect(result.proposals.length).toBeGreaterThanOrEqual(1);
    expect(result.synthesizedTasks.length).toBeGreaterThanOrEqual(1);
    expect(result.enqueuedTasks.length).toBe(result.synthesizedTasks.length);
    expect(result.cognitiveProgressLogged).toBe(true);

    // Verify cognitive memory was updated
    const memory = readCognitiveMemory(memoryPath);
    expect(memory.strategic_focus.length).toBeGreaterThan(0);
    expect(memory.strategic_focus.some((f) => f.includes("Mode A Creative Product Manager"))).toBe(true);
  });

  it("computes anti-stagnation heuristics and evaluates zero-delta signatures deterministically", () => {
    const { memoryPath } = createTestFixture("anti-stagnation-eval");

    const input1 = {
      synthesizedCount: 3,
      enqueuedCount: 3,
      openDefectsCount: 0,
      feedbackCount: 0,
      hypothesisCount: 1,
    };
    const sig1 = computeProgressSignature(input1);
    expect(typeof sig1).toBe("string");
    expect(sig1.length).toBe(16);

    const state1 = evaluateAntiStagnation(input1, { memoryPath });
    expect(state1.isStagnant).toBe(false);
    expect(state1.creativeStagnationDetected).toBe(false);
    expect(state1.progressiveScore).toBeGreaterThanOrEqual(100);

    // Stagnant scenario: zero synthesized, previous signature identical
    const input2 = {
      synthesizedCount: 0,
      enqueuedCount: 0,
      openDefectsCount: 0,
      feedbackCount: 0,
      hypothesisCount: 1,
      previousSignature: sig1,
    };
    const state2 = evaluateAntiStagnation(input2, {
      memoryPath,
      maintenanceThreshold: 1,
    });
    expect(state2.isStagnant).toBe(true);
    expect(state2.creativeStagnationDetected).toBe(true);
  });

  it("records non-zero progress into cognitive memory without corrupting hypotheses", () => {
    const { memoryPath } = createTestFixture("progress-recording");

    const state = evaluateAntiStagnation(
      { synthesizedCount: 2, enqueuedCount: 2, openDefectsCount: 0, feedbackCount: 0 },
      { memoryPath },
    );

    recordNonZeroProgress("Synthesized 2 grounded feature tasks", state, {
      memoryPath,
      charterGoals: ["G1", "G2"],
    });

    const memory = readCognitiveMemory(memoryPath);
    expect(memory.active_hypotheses.length).toBe(1);
    expect(memory.active_hypotheses[0]!.id).toBe("hyp-1");
    expect(memory.strategic_focus.some((s) => s.includes("Synthesized 2 grounded feature tasks"))).toBe(true);
  });

  it("Mind Auditor detects MIND_CREATIVE_STAGNATION in maintenance-only loops without product progress", () => {
    const { repo } = createTestFixture("auditor-creative-stagnation");

    const stagnationResult = auditMindCreativeStagnation({
      rootDir: repo,
      isMaintenanceOnlyLoop: true,
      consecutiveMaintenanceCycles: 3,
      productProgressMade: false,
    });

    expect(stagnationResult.is_stagnant).toBe(true);
    expect(stagnationResult.error_code).toBe(MIND_CREATIVE_STAGNATION);
    expect(stagnationResult.recommended_remediation).toBe("AUTONOMIC_CREATIVE_OVERLOAD");
    expect(typeof stagnationResult.cognitive_challenge_prompt).toBe("string");
  });

  it("Mind Auditor detects zero-delta stagnation and enforces report suppression", () => {
    const { repo } = createTestFixture("auditor-zero-delta");

    const report1 = auditMindPreplanningStagnation({
      rootDir: repo,
      explicitBacklog: [],
      explicitDefects: [],
    });

    const report2 = auditMindPreplanningStagnation({
      rootDir: repo,
      explicitBacklog: [],
      explicitDefects: [],
      previousReport: report1,
      suppressZeroDelta: true,
    });

    expect(isZeroDeltaReport(report2, report1)).toBe(true);
    const suppressed = suppressZeroDeltaReport(report2, report1);
    expect(suppressed.suppressed).toBe(true);
    expect(suppressed.zero_delta).toBe(true);
  });

  it("CLI mindCandidateCommand creates proposal candidates aligned with charter goals", () => {
    const { run } = createTestFixture("cli-mind-candidate");

    const result = mindCandidateCommand({
      run,
      actor: "mind-1",
      kind: "proposal",
      statement: "Autonomous Multi-Viewport Layout Harmonizer",
      "charter-goal": ["G2"],
      "write-scope": ["apps/web/src/components/layout/"],
      rationale: "Aligns with charter goal G2 for visual perfection",
    });

    expect(result.candidate_id).toMatch(/^cand-\d+$/);
    const candidate = result.candidate as Record<string, unknown>;
    expect(candidate.kind).toBe("proposal");
    expect(candidate.charter_goal_ids).toEqual(["G2"]);
    expect(typeof result.markdown).toBe("string");
  });

  it("CLI mindObserveCommand validates recorded command evidence and records observations", () => {
    const { run } = createTestFixture("cli-mind-observe");

    // Create commands directory and command record
    const cmdDir = join(run, "commands");
    mkdirSync(cmdDir, { recursive: true });
    writeFileSync(
      join(cmdDir, "cmd-evidence-100.json"),
      JSON.stringify({
        id: "cmd-evidence-100",
        name: "test-runner",
        command_line: "bun test tests/unit",
        argv: ["bun", "test", "tests/unit"],
        status: "completed",
        exit_code: 0,
      }),
    );

    const result = mindObserveCommand({
      run,
      actor: "mind-1",
      source: "open-findings",
      "command-id": "cmd-evidence-100",
      count: 0,
    });

    expect(result.observation_id).toMatch(/^obs-\d+$/);
    expect(result.source).toBe("open-findings");
    expect(result.command_id).toBe("cmd-evidence-100");
    expect(typeof result.markdown).toBe("string");
  });

  it("CLI mindPulseCommand executes pulse cycle with cognitive telemetry and directives", async () => {
    const { run } = createTestFixture("cli-mind-pulse");

    const pulseRes = await mindPulseCommand({
      run,
      actor: "mind-1",
      driver: "perpetual-loop",
    });

    expect(pulseRes.status).toBe("opened");
    expect(typeof pulseRes.pulse_id).toBe("string");
    expect(pulseRes.work_span).toBeDefined();
    expect(typeof pulseRes.markdown).toBe("string");
  });
});

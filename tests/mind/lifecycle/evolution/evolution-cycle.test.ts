import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  executeSelfEvolutionStep,
  runSelfEvolutionCycle,
} from "../../../../olt/scripts/src/mind/lifecycle/evolution/cycle.ts";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { OrchestratorNodeInfo } from "../../../../olt/scripts/src/mind/lifecycle/evolution/types.ts";

describe("Evolution Cycle Suite (cycle.ts)", () => {
  let tempDir: string;
  let taskQueuePath: string;
  let feedbackQueuePath: string;
  let historyPath: string;
  let emptySrcDir: string;
  let emptyTestDir: string;
  let charterPath: string;
  let emptyCapsulesDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `cycle-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
    mkdirSync(tempDir, { recursive: true });
    taskQueuePath = join(tempDir, "tasks.jsonl");
    feedbackQueuePath = join(tempDir, "feedbacks.jsonl");
    historyPath = join(tempDir, "history.jsonl");
    emptySrcDir = join(tempDir, "empty_src");
    emptyTestDir = join(tempDir, "empty_test");
    charterPath = join(tempDir, "CHARTER.yaml");
    emptyCapsulesDir = join(tempDir, "capsules");
    mkdirSync(emptySrcDir, { recursive: true });
    mkdirSync(emptyTestDir, { recursive: true });
    mkdirSync(emptyCapsulesDir, { recursive: true });

    const charterYaml = `
identity: test-mind
goals:
  - id: G1
    statement: Continuous evolution
non_goals:
  - regressions
`;
    writeFileSync(charterPath, charterYaml, "utf8");
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("executes Mode B feedback intake when pending feedback exists", () => {
    const pendingFeedback = {
      id: "fb-intake-1",
      timestamp: new Date().toISOString(),
      title: "Test gap",
      content: "Needs test coverage expansion",
      priority: "NORMAL",
      status: "PENDING",
      category: "GENERAL",
    };
    writeFileSync(feedbackQueuePath, JSON.stringify(pendingFeedback) + "\n", "utf8");
    writeFileSync(taskQueuePath, "", "utf8");

    const result = runSelfEvolutionCycle({
      taskQueuePath,
      feedbackQueuePath,
      historyPath,
      generation: 2,
      cycleNumber: 3,
      now: "2026-09-01T12:00:00.000Z",
      actor: "test-supervisor",
    });

    expect(result.mode).toBe("MODE_B_FEEDBACK_INTAKE");
    expect(result.generation).toBe(2);
    expect(result.cycleNumber).toBe(3);
    expect(result.timestamp).toBe("2026-09-01T12:00:00.000Z");
    expect(result.admittedFeedbackIds).toContain("fb-intake-1");
    expect(result.discoveriesCount).toBe(1);
    expect(existsSync(historyPath)).toBe(true);

    const historyContent = readFileSync(historyPath, "utf8");
    expect(historyContent).toContain("cycle-gen2-3-");
    expect(historyContent).toContain("MODE_B_FEEDBACK_INTAKE");
  });

  it("executes Mode A autonomic discovery when dormant charter goals are discovered", () => {
    writeFileSync(taskQueuePath, "", "utf8");
    writeFileSync(feedbackQueuePath, "", "utf8");

    const result = runSelfEvolutionCycle({
      taskQueuePath,
      feedbackQueuePath,
      historyPath,
      workspaceRoot: tempDir,
      sourceRoots: [emptySrcDir],
      testRoots: [emptyTestDir],
      charterPath,
      capsulesDir: emptyCapsulesDir,
      generation: 1,
      cycleNumber: 1,
    });

    expect(result.mode).toBe("MODE_A_AUTONOMIC_DISCOVERY");
    expect(result.discoveriesCount).toBeGreaterThan(0);
    expect(result.synthesizedTasks.length).toBeGreaterThan(0);
    expect(result.nextRecommendedCommand).toContain("queue:wave");
  });

  it("executes Mode C fallback when workspace scan yields zero discoveries", () => {
    const completedTask = {
      id: "task-prev-1",
      title: "Completed G1 goal task",
      status: "COMPLETED",
      priority: "MEDIUM",
      write_scope: ["src/done.ts"],
      charter_goals: ["G1"],
      gate: "gate-1",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    writeFileSync(taskQueuePath, JSON.stringify(completedTask) + "\n", "utf8");
    writeFileSync(feedbackQueuePath, "", "utf8");

    const result = runSelfEvolutionCycle({
      taskQueuePath,
      feedbackQueuePath,
      historyPath,
      workspaceRoot: tempDir,
      sourceRoots: [emptySrcDir],
      testRoots: [emptyTestDir],
      charterPath,
      capsulesDir: emptyCapsulesDir,
      generation: 1,
      cycleNumber: 1,
    });

    expect(result.mode).toBe("MODE_C_INVARIANT_HARDENING");
    expect(result.discoveriesCount).toBe(0);
    expect(result.synthesizedTasks.length).toBeGreaterThanOrEqual(1);
    expect(result.nextRecommendedCommand).toContain("queue:wave");
  });

  it("handles active tasks in queue and custom runRoot in recommendations", () => {
    const activeTask = {
      id: "task-act-1",
      title: "Active task execution",
      status: "IN_PROGRESS",
      priority: "HIGH",
      write_scope: ["src/core.ts"],
      gate: "gate-1",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    writeFileSync(taskQueuePath, JSON.stringify(activeTask) + "\n", "utf8");
    writeFileSync(feedbackQueuePath, "", "utf8");

    const result = runSelfEvolutionCycle({
      taskQueuePath,
      feedbackQueuePath,
      historyPath,
      sourceRoots: [emptySrcDir],
      testRoots: [emptyTestDir],
      charterPath,
      capsulesDir: emptyCapsulesDir,
      runRoot: "/var/runs/run-99",
    });

    expect(result.nextRecommendedCommand).toContain("--run /var/runs/run-99");
    expect(result.cadenceState.infiniteCadenceEnforced).toBe(true);
  });

  it("synthesizes dynamic plan revisions from external signals", () => {
    writeFileSync(taskQueuePath, "", "utf8");
    writeFileSync(feedbackQueuePath, "", "utf8");

    const result = runSelfEvolutionCycle({
      taskQueuePath,
      feedbackQueuePath,
      historyPath,
      sourceRoots: [emptySrcDir],
      testRoots: [emptyTestDir],
      charterPath,
      capsulesDir: emptyCapsulesDir,
      externalSignals: [
        {
          signalType: "DEFECT_SURGE",
          source: "ci_monitor",
          severity: "CRITICAL",
          evidence: "Multiple test failures in worker",
          affectedWriteScopes: ["src/worker.ts"],
          charterGoalId: "goal-stability",
        },
      ],
    });

    expect(result.planRevisions.length).toBeGreaterThan(0);
    expect(result.summary).toContain("generated");
  });

  it("evaluates multi-orchestrator hierarchy scaling decisions", () => {
    writeFileSync(taskQueuePath, "", "utf8");
    writeFileSync(feedbackQueuePath, "", "utf8");

    const orchs: OrchestratorNodeInfo[] = [
      {
        id: "orch-1",
        role: "orchestrator",
        tier: 1,
        domainSlug: "domain-1",
        assignedTaskIds: [],
        assignedWriteScopes: ["src/"],
        capacity: 10,
        currentLoad: 0,
        status: "ACTIVE",
      },
    ];

    const result = runSelfEvolutionCycle({
      taskQueuePath,
      feedbackQueuePath,
      historyPath,
      sourceRoots: [emptySrcDir],
      testRoots: [emptyTestDir],
      charterPath,
      capsulesDir: emptyCapsulesDir,
      orchestrators: orchs,
      autoEnqueue: false,
    });

    expect(result.hierarchyMetrics.activeTier1Count).toBe(1);
    expect(result.scalingDecision).toBeDefined();
    expect(result.cadenceState.infiniteCadenceEnforced).toBe(true);
  });

  it("exports executeSelfEvolutionStep as an alias to runSelfEvolutionCycle", () => {
    expect(executeSelfEvolutionStep).toBe(runSelfEvolutionCycle);
    writeFileSync(taskQueuePath, "", "utf8");
    writeFileSync(feedbackQueuePath, "", "utf8");

    const res = executeSelfEvolutionStep({
      taskQueuePath,
      feedbackQueuePath,
      historyPath,
      sourceRoots: [emptySrcDir],
      testRoots: [emptyTestDir],
      charterPath,
      capsulesDir: emptyCapsulesDir,
    });
    expect(res.cycleId).toContain("cycle-gen1-1-");
  });
});

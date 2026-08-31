import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  appendFeedbackItem,
  readFeedbackQueue,
} from "../../olt/scripts/src/mind/feedback/queue/index.ts";
import {
  CLOSING_FORBIDDEN_IDLE_MIND,
  enforcePerpetualNonStoppingCadence,
  evaluatePerpetualCadence,
  executeSelfEvolutionStep,
  formatSelfEvolutionBrief,
  getEvolutionStats,
  NON_STOPPING_RULE,
  PERPETUAL_NON_STOPPING_CADENCE,
  readEvolutionHistory,
  recordEvolutionCycle,
  resolveEvolutionHistoryPath,
  runSelfEvolutionCycle,
  type EvolutionLedgerEntry,
} from "../../olt/scripts/src/mind/lifecycle/evolution/index.ts";
import {
  mindSelfEvolveCommand,
  MIND_SELF_EVOLVE_COMMAND_SPEC,
} from "../../olt/scripts/src/mind/lifecycle/index.ts";
import {
  clearTaskQueue,
  enqueueTask,
  readTaskQueue,
} from "../../olt/scripts/src/task/queue/index.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

describe("Autonomous Mind Self-Evolution Loop & Perpetual Cadence", () => {
  const testDir = scratchRoot(import.meta.path, "test-self-evolution");
  const taskQueueFile = join(testDir, "TASK_QUEUE.jsonl");
  const feedbackQueueFile = join(testDir, "FEEDBACK_QUEUE.jsonl");
  const historyFile = join(testDir, "EVOLUTION_HISTORY.jsonl");
  const charterFile = join(testDir, "mind.yaml");
  const srcDir = join(testDir, "src");
  const testsDir = join(testDir, "tests");

  function setupWorkspace() {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
    mkdirSync(srcDir, { recursive: true });
    mkdirSync(testsDir, { recursive: true });

    // Seed mind.yaml
    const charterContent = `name: "mind"\nrole: "mind"\ncharter:\n  identity: "Test Perpetual Mind System"\n  goals:\n    - id: "G1"\n      statement: "Infinite Stability"\n    - id: "G2"\n      statement: "Continuous Evolution"\n    - id: "G3"\n      statement: "Strict Type Safety"\n  non_goals:\n    - "Self Termination"\n  repo_roots:\n    - "src/"\n`;
    writeFileSync(charterFile, charterContent, "utf8");
  }

  function teardownWorkspace() {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  describe("Perpetual Cadence & Non-Stopping Invariants", () => {
    it("enforces perpetual non-stopping cadence invariants and prevents loop termination", () => {
      const guard = enforcePerpetualNonStoppingCadence({
        actor: "perpetual-mind",
        runRoot: ".olt/capsules/test-run",
      });

      expect(guard.cadence).toBe(PERPETUAL_NON_STOPPING_CADENCE);
      expect(guard.allowed).toBe(true);
      expect(guard.closing_permitted).toBe(false);
      expect(guard.message).toBe(NON_STOPPING_RULE);
      expect(guard.nextInstruction).toContain(
        "bun harness.ts mind:wake --run .olt/capsules/test-run",
      );
    });

    it("evaluates cadence as QUEUE_ACTIVE when tasks exist in queue", () => {
      setupWorkspace();

      enqueueTask(
        {
          id: "task-active-1",
          title: "Active task in progress",
          write_scope: ["src/"],
          gate: "bun test",
          status: "IN_PROGRESS",
        },
        taskQueueFile,
      );

      const evaluation = evaluatePerpetualCadence({
        taskQueuePath: taskQueueFile,
        feedbackQueuePath: feedbackQueueFile,
      });

      expect(evaluation.mode).toBe("QUEUE_ACTIVE");
      expect(evaluation.canEvolve).toBe(false);
      expect(evaluation.queueActive).toBe(true);
      expect(evaluation.closing_permitted).toBe(false);
      expect(evaluation.nextInstruction).toContain("bun harness.ts queue:wave");

      teardownWorkspace();
    });

    it("evaluates cadence as MODE_B_FEEDBACK_INTAKE when pending feedback exists", () => {
      setupWorkspace();

      appendFeedbackItem(
        {
          id: "fb-critical-patch",
          title: "Critical Security Patch",
          content: "Patch token validation",
          priority: "CRITICAL_USER_FEEDBACK",
          category: "CORE_ENGINE",
          status: "PENDING",
        },
        feedbackQueueFile,
      );

      const evaluation = evaluatePerpetualCadence({
        taskQueuePath: taskQueueFile,
        feedbackQueuePath: feedbackQueueFile,
      });

      expect(evaluation.mode).toBe("MODE_B_FEEDBACK_INTAKE");
      expect(evaluation.canEvolve).toBe(true);
      expect(evaluation.pendingFeedbackCount).toBe(1);
      expect(evaluation.closing_permitted).toBe(false);

      teardownWorkspace();
    });

    it("evaluates cadence as MODE_A_AUTONOMIC_DISCOVERY when queues are clear", () => {
      setupWorkspace();

      const evaluation = evaluatePerpetualCadence({
        taskQueuePath: taskQueueFile,
        feedbackQueuePath: feedbackQueueFile,
      });

      expect(evaluation.mode).toBe("MODE_A_AUTONOMIC_DISCOVERY");
      expect(evaluation.canEvolve).toBe(true);
      expect(evaluation.activeTasksCount).toBe(0);
      expect(evaluation.pendingFeedbackCount).toBe(0);
      expect(evaluation.closing_permitted).toBe(false);

      teardownWorkspace();
    });
  });

  describe("Self-Evolution Cycle Execution (runSelfEvolutionCycle)", () => {
    it("executes Mode B feedback intake cycle, updates feedback queue, and enqueues tasks", () => {
      setupWorkspace();

      appendFeedbackItem(
        {
          id: "fb-intake-test",
          title: "Intake Test",
          content: "Add intake feature",
          priority: "HIGH_ARCHITECTURAL_FEATURE",
          category: "ARCHITECTURE",
          status: "PENDING",
        },
        feedbackQueueFile,
      );

      const result = runSelfEvolutionCycle({
        taskQueuePath: taskQueueFile,
        feedbackQueuePath: feedbackQueueFile,
        historyPath: historyFile,
        charterPath: charterFile,
        generation: 1,
        cycleNumber: 1,
        autoEnqueue: true,
      });

      expect(result.mode).toBe("MODE_B_FEEDBACK_INTAKE");
      expect(result.admittedFeedbackIds).toContain("fb-intake-test");
      expect(result.synthesizedTasks.length).toBeGreaterThanOrEqual(1);
      expect(result.enqueuedTasks.length).toBeGreaterThanOrEqual(1);
      expect(result.candidateProposals.length).toBeGreaterThanOrEqual(1);

      // Verify feedback was drained to ADMITTED status
      const feedbacks = readFeedbackQueue(feedbackQueueFile);
      const fbItem = feedbacks.find((f) => f.id === "fb-intake-test");
      expect(fbItem?.status).toBe("ADMITTED");

      // Verify history recorded
      const history = readEvolutionHistory(historyFile);
      expect(history.length).toBe(1);
      expect(history[0]?.mode).toBe("MODE_B_FEEDBACK_INTAKE");

      const brief = formatSelfEvolutionBrief(result);
      expect(brief).toContain("Self-Evolution Cycle");
      expect(brief).toContain("MODE_B_FEEDBACK_INTAKE");

      teardownWorkspace();
    });

    it("executes Mode A discovery cycle on empty queues and updates ledger", () => {
      setupWorkspace();

      const result = runSelfEvolutionCycle({
        taskQueuePath: taskQueueFile,
        feedbackQueuePath: feedbackQueueFile,
        historyPath: historyFile,
        charterPath: charterFile,
        sourceRoots: [srcDir],
        testRoots: [testsDir],
        generation: 2,
        cycleNumber: 3,
        autoEnqueue: true,
      });

      expect(["MODE_A_AUTONOMIC_DISCOVERY", "MODE_C_INVARIANT_HARDENING"]).toContain(result.mode);
      expect(result.generation).toBe(2);
      expect(result.cycleNumber).toBe(3);
      expect(result.synthesizedTasks.length).toBeGreaterThanOrEqual(1);
      expect(result.enqueuedTasks.length).toBeGreaterThanOrEqual(1);
      expect(result.cadenceState.infiniteCadenceEnforced).toBe(true);

      const stats = getEvolutionStats(readEvolutionHistory(historyFile));
      expect(stats.totalCycles).toBe(1);
      expect(stats.totalTasks).toBe(result.synthesizedTasks.length);

      teardownWorkspace();
    });

    it("executeSelfEvolutionStep aliases runSelfEvolutionCycle", () => {
      expect(executeSelfEvolutionStep).toBe(runSelfEvolutionCycle);
    });
  });

  describe("Evolution History Ledger & Stats", () => {
    it("records and reads evolution ledger entries", () => {
      setupWorkspace();

      const entry: EvolutionLedgerEntry = {
        cycleId: "cycle-test-1",
        generation: 1,
        cycleNumber: 1,
        timestamp: new Date().toISOString(),
        mode: "MODE_A_AUTONOMIC_DISCOVERY",
        discoveriesCount: 3,
        taskIds: ["task-1", "task-2"],
        feedbackIds: [],
        durationMs: 150,
        summary: "Test cycle summary",
      };

      recordEvolutionCycle(entry, historyFile);

      const entries = readEvolutionHistory(historyFile);
      expect(entries.length).toBe(1);
      expect(entries[0]?.cycleId).toBe("cycle-test-1");
      expect(entries[0]?.taskIds).toEqual(["task-1", "task-2"]);

      const stats = getEvolutionStats(entries);
      expect(stats.totalCycles).toBe(1);
      expect(stats.totalTasks).toBe(2);
      expect(stats.cyclesByMode.MODE_A_AUTONOMIC_DISCOVERY).toBe(1);

      teardownWorkspace();
    });
  });

  describe("CLI Command Handler (mindSelfEvolveCommand)", () => {
    it("executes CLI self-evolve command and produces structured output", () => {
      setupWorkspace();

      const flags = {
        charter: charterFile,
        "feedback-queue": feedbackQueueFile,
        "task-queue": taskQueueFile,
        "history-file": historyFile,
        "max-tasks": "2",
        generation: "1",
        cycle: "1",
      };

      const result = mindSelfEvolveCommand(flags);

      expect(result).toBeDefined();
      expect(typeof result["markdown"]).toBe("string");
      expect(typeof result["cycle_id"]).toBe("string");
      expect(Array.isArray(result["synthesized_tasks"])).toBe(true);
      expect(MIND_SELF_EVOLVE_COMMAND_SPEC.name).toBe("mind:self-evolve");

      teardownWorkspace();
    });
  });
});

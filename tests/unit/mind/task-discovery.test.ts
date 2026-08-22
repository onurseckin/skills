import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  appendFeedbackItem,
  readFeedbackQueue,
} from "../../../orchestrating-long-tasks/scripts/src/mind/feedback-queue.ts";
import {
  CLOSING_FORBIDDEN_IDLE_MIND,
  enforcePerpetualNonStoppingCadence,
  evaluatePerpetualCadence,
  getEvolutionStats,
  NON_STOPPING_RULE,
  PERPETUAL_NON_STOPPING_CADENCE,
  readEvolutionHistory,
  recordEvolutionCycle,
  runSelfEvolutionCycle,
  type EvolutionLedgerEntry,
} from "../../../orchestrating-long-tasks/scripts/src/mind/self-evolution.ts";
import {
  discoverTasks,
  scanCodeQuality,
  scanDormantCriteria,
  scanTestCoverage,
  synthesizeTaskFromDiscovery,
  type DiscoveryItem,
} from "../../../orchestrating-long-tasks/scripts/src/mind/task-discovery.ts";
import {
  clearTaskQueue,
  enqueueTask,
  readTaskQueue,
} from "../../../orchestrating-long-tasks/scripts/src/mind/task-queue.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

describe("Autonomous Mind Task Discovery & Self-Evolution Engine", () => {
  const testDir = scratchRoot(import.meta.path, "test-task-discovery");
  const taskQueueFile = join(testDir, "TASK_QUEUE.jsonl");
  const feedbackQueueFile = join(testDir, "FEEDBACK_QUEUE.jsonl");
  const historyFile = join(testDir, "EVOLUTION_HISTORY.jsonl");
  const charterFile = join(testDir, "CHARTER.md");
  const srcDir = join(testDir, "src");
  const testsDir = join(testDir, "tests");

  function setupWorkspace() {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
    mkdirSync(srcDir, { recursive: true });
    mkdirSync(testsDir, { recursive: true });

    // Seed CHARTER.md
    const charterContent = `# CHARTER\n\n## identity\nTest Perpetual Mind System\n\n## goals\n- G1: Infinite Stability\n- G2: Continuous Evolution\n- G3: Strict Type Safety\n\n## non-goals\n- Self Termination\n\n## repo_roots\n- \`src/\`\n`;
    writeFileSync(charterFile, charterContent, "utf8");
  }

  function teardownWorkspace() {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  describe("Code Quality Scanner (scanCodeQuality)", () => {
    it("detects compiler suppressions, any annotations, oversized modules, and TODOs", () => {
      setupWorkspace();

      const defectiveFile = join(srcDir, "defective.ts");
      const codeLines: string[] = [
        "// Sample module",
        "export function doWork(param: any): any {",
        "  // @ts-ignore",
        "  const x = param.foo;",
        "  // TODO: Refactor this logic later",
        "  return x;",
        "}",
      ];
      // Add extra lines to test line counting
      for (let i = 0; i < 15; i++) {
        codeLines.push(`export const item_${i} = ${i};`);
      }
      writeFileSync(defectiveFile, codeLines.join("\n"), "utf8");

      const result = scanCodeQuality({
        sourceRoots: [srcDir],
        maxLineThreshold: 10, // Small threshold for testing
      });

      expect(result.filesScanned).toBe(1);
      expect(result.totalFindings).toBeGreaterThanOrEqual(3);

      const issueTypes = result.findings.map((f) => f.issueType);
      expect(issueTypes).toContain("TYPE_SAFETY_ANY");
      expect(issueTypes).toContain("COMPILER_SUPPRESSION");
      expect(issueTypes).toContain("TODO_FIXME_MARKER");
      expect(issueTypes).toContain("OVERSIZED_MODULE");

      teardownWorkspace();
    });

    it("returns zero findings on clean, strictly typed files", () => {
      setupWorkspace();

      const cleanFile = join(srcDir, "clean.ts");
      const cleanContent = `export function add(a: number, b: number): number {\n  return a + b;\n}\n`;
      writeFileSync(cleanFile, cleanContent, "utf8");

      const result = scanCodeQuality({
        sourceRoots: [srcDir],
        maxLineThreshold: 500,
      });

      expect(result.filesScanned).toBe(1);
      expect(result.totalFindings).toBe(0);
      expect(result.findings).toEqual([]);

      teardownWorkspace();
    });
  });

  describe("Test Coverage Scanner (scanTestCoverage)", () => {
    it("identifies source modules missing corresponding test suites", () => {
      setupWorkspace();

      writeFileSync(join(srcDir, "moduleA.ts"), "export const a = 1;", "utf8");
      writeFileSync(join(srcDir, "moduleB.ts"), "export const b = 2;", "utf8");
      writeFileSync(
        join(testsDir, "moduleA.test.ts"),
        "import { test, expect } from 'bun:test'; test('a', () => expect(1).toBe(1));",
        "utf8",
      );

      const result = scanTestCoverage({
        sourceRoots: [srcDir],
        testRoots: [testsDir],
      });

      expect(result.sourceFilesScanned).toBe(2);
      expect(result.testFilesScanned).toBe(1);
      expect(result.missingTestCount).toBe(1);

      const missing = result.findings.find((f) => f.issueType === "MISSING_TEST_FILE");
      expect(missing).toBeDefined();
      expect(missing?.sourceFile).toContain("moduleB.ts");

      teardownWorkspace();
    });

    it("detects skipped test suites and empty test suites", () => {
      setupWorkspace();

      writeFileSync(
        join(testsDir, "skipped.test.ts"),
        "import { test } from 'bun:test'; test.skip('disabled', () => {});",
        "utf8",
      );
      writeFileSync(
        join(testsDir, "empty.test.ts"),
        "// Just comments without any test() calls",
        "utf8",
      );

      const result = scanTestCoverage({
        sourceRoots: [srcDir],
        testRoots: [testsDir],
      });

      const types = result.findings.map((f) => f.issueType);
      expect(types).toContain("SKIPPED_TESTS");
      expect(types).toContain("EMPTY_TEST_SUITE");

      teardownWorkspace();
    });
  });

  describe("Dormant Criteria Scanner (scanDormantCriteria)", () => {
    it("identifies charter goals with zero existing tasks in queue", () => {
      setupWorkspace();

      // Seed task queue targeting only G1
      enqueueTask(
        {
          id: "task-g1-work",
          title: "Goal 1 Stability Work",
          write_scope: ["src/"],
          gate: "bun test",
          charter_goals: ["G1"],
        },
        taskQueueFile,
      );

      const result = scanDormantCriteria({
        charterPath: charterFile,
        taskQueuePath: taskQueueFile,
      });

      expect(result.goalsCheckedCount).toBe(3); // G1, G2, G3
      expect(result.dormantCount).toBe(2); // G2 and G3 are dormant

      const dormantIds = result.findings.map((f) => f.criteriaId);
      expect(dormantIds).toContain("G2");
      expect(dormantIds).toContain("G3");
      expect(dormantIds).not.toContain("G1");

      teardownWorkspace();
    });

    it("handles missing charter path gracefully", () => {
      const result = scanDormantCriteria({
        charterPath: "/non/existent/CHARTER.md",
      });

      expect(result.dormantCount).toBe(1);
      expect(result.findings[0]?.criteriaId).toBe("missing-charter");
    });
  });

  describe("Task Synthesis and Anti-Batching (synthesizeTaskFromDiscovery)", () => {
    it("synthesizes isolated tasks with dedicated implementer and validator roles", () => {
      const item: DiscoveryItem = {
        id: "cq-defective-any",
        category: "CODE_QUALITY",
        title: "Fix any type in defective.ts",
        description: "Replace unconstrained any with strict types",
        priority: "HIGH",
        targetFiles: ["src/defective.ts"],
        writeScope: ["src/defective.ts", "tests/defective.test.ts"],
        gate: "bun test tests/defective.test.ts && bun run typecheck",
        charterGoals: ["G3"],
        acceptanceCriteria: ["0 any in src/defective.ts", "Pass unit tests"],
        remediation: "Replace any with strict type guard",
        sourceType: "self_evolution",
      };

      const plan = synthesizeTaskFromDiscovery(item, 1);

      expect(plan.id).toBe("task-p49-discovery-1-cq-defective-any");
      expect(plan.label).toBe("Fix any type in defective.ts");
      expect(plan.write_scope).toEqual(["src/defective.ts", "tests/defective.test.ts"]);
      expect(plan.assigned_tier).toBe("Tier_3_Implementer");
      expect(plan.assigned_implementer).toBe("implementer-p49-discovery-cq-defective-any");
      expect(plan.assigned_validator).toBe("validator-p49-discovery-cq-defective-any");
      expect(plan.assigned_implementer).not.toBe(plan.assigned_validator); // 1:1 isolation
      expect(plan.charter_goals).toEqual(["G3"]);
    });
  });

  describe("Full Discovery Engine (discoverTasks)", () => {
    it("scans workspace and synthesizes tasks from multiple discovery dimensions", () => {
      setupWorkspace();

      // 1. Add defective code
      writeFileSync(
        join(srcDir, "buggy.ts"),
        "export function run(x: any) {\n  // @ts-ignore\n  return x.val;\n}\n",
        "utf8",
      );

      // 2. Add pending feedback item
      appendFeedbackItem(
        {
          id: "fb-stream-parser",
          title: "Implement Stream Parser",
          content: "Add streaming json parser support",
          priority: "HIGH_ARCHITECTURAL_FEATURE",
          category: "CORE_ENGINE",
          status: "PENDING",
        },
        feedbackQueueFile,
      );

      const result = discoverTasks({
        sourceRoots: [srcDir],
        testRoots: [testsDir],
        charterPath: charterFile,
        feedbackQueuePath: feedbackQueueFile,
        taskQueuePath: taskQueueFile,
        enableBlunderScan: false,
        maxTasks: 10,
        autoEnqueue: true,
      });

      expect(result.stats.totalFindings).toBeGreaterThan(0);
      expect(result.synthesizedPlans.length).toBeGreaterThan(0);
      expect(result.enqueuedTasks.length).toBe(result.synthesizedPlans.length);

      const queued = readTaskQueue(taskQueueFile);
      expect(queued.length).toBe(result.synthesizedPlans.length);

      teardownWorkspace();
    });

    it("synthesizes deterministic continuous hardening tasks on pristine workspace", () => {
      setupWorkspace();

      const result = discoverTasks({
        sourceRoots: [srcDir],
        testRoots: [testsDir],
        charterPath: charterFile,
        feedbackQueuePath: feedbackQueueFile,
        taskQueuePath: taskQueueFile,
        enableBlunderScan: false,
        autoEnqueue: false,
      });

      // Even on pristine workspace, must synthesize at least 1 task (fallback invariant hardening)
      expect(result.synthesizedPlans.length).toBeGreaterThanOrEqual(1);
      expect(result.synthesizedPlans[0]?.id).toContain("task-p49-discovery-");

      teardownWorkspace();
    });
  });

  describe("Perpetual Cadence & Non-Stopping Invariants (self-evolution)", () => {
    it("enforces perpetual non-stopping cadence invariants", () => {
      const guard = enforcePerpetualNonStoppingCadence({
        actor: "perpetual-mind",
        runRoot: ".capsules/test-run",
      });

      expect(guard.cadence).toBe(PERPETUAL_NON_STOPPING_CADENCE);
      expect(guard.allowed).toBe(true);
      expect(guard.closing_permitted).toBe(false);
      expect(guard.message).toBe(NON_STOPPING_RULE);
      expect(guard.nextInstruction).toContain("bun harness.ts mind:wake --run .capsules/test-run");
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

      // Verify feedback was drained to ADMITTED status
      const feedbacks = readFeedbackQueue(feedbackQueueFile);
      const fbItem = feedbacks.find((f) => f.id === "fb-intake-test");
      expect(fbItem?.status).toBe("ADMITTED");

      // Verify history recorded
      const history = readEvolutionHistory(historyFile);
      expect(history.length).toBe(1);
      expect(history[0]?.mode).toBe("MODE_B_FEEDBACK_INTAKE");

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

      expect(["MODE_A_AUTONOMIC_DISCOVERY", "MODE_C_INVARIANT_HARDENING"]).toContain(
        result.mode,
      );
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
  });
});

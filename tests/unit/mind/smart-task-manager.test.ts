import { afterAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertAntiBatchingRule,
  calculateScopeCollisions,
  compileSmartTasksToWavePlan,
  deriveGateForCategory,
  deriveWriteScopeForCategory,
  detectScopeCollisions,
  detectScopeOverlap,
  expandExternalPromptToPlan,
  expandExternalPromptToWavePlan,
  partitionCandidatesStrictly,
  partitionGroupedFeedbacksStrictly,
  partitionIntoDisjointWaves,
  planEnhance,
  planEnhanceToWavePlan,
  planWaveExecution,
  processAutonomousDualIntake,
  runAutonomousDualIntakeCycle,
  sanitizeSlug,
  synthesizeAutonomousTasks,
  synthesizeSmartTasksFromFeedbackQueue,
  synthesizeSmartTasksFromSelfEvolution,
  validateAntiBatchingIsolation,
  validateAntiBatchingRule,
  type SmartTaskPlan,
} from "../../../orchestrating-long-tasks/scripts/src/mind/smart-task-manager.ts";
import {
  admitFeedbackToQueue,
  appendFeedbackItem,
  backpropagateFeedbackResolution,
  clearFeedbackQueue,
  compareFeedbackPriority,
  drainPendingFeedbacks,
  getFeedbackStats,
  ingestFeedbackItem,
  readFeedbackQueue,
  resolveFeedbackQueuePath,
  sealFeedbackResolution,
  sortFeedbackByPriority,
  updateFeedbackItem,
  type FeedbackItem,
  type FeedbackResolutionProof,
} from "../../../orchestrating-long-tasks/scripts/src/mind/feedback-queue.ts";
import {
  clearTaskQueue,
  enqueueTasksBatch,
  getQueueStats,
  readTaskQueue,
} from "../../../orchestrating-long-tasks/scripts/src/mind/task-queue.ts";

describe("Smart Task Manager & Autonomic Benchmark Suite", () => {
  const testDir = join(tmpdir(), `test-bench-smart-task-${Date.now()}`);
  const feedbackFile = join(testDir, "FEEDBACK_QUEUE.jsonl");
  const taskQueueFile = join(testDir, "TASK_QUEUE.jsonl");

  function setup() {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
  }

  function teardown() {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  afterAll(() => {
    teardown();
  });

  describe("1. Anti-Batching Rule Enforcement & Violation Detection", () => {
    it("validates compliant isolated 1:1 smart task plans successfully", () => {
      const validPlans: readonly SmartTaskPlan[] = [
        {
          id: "task-1-fix-login",
          label: "Fix Login Session Expiry",
          write_scope: ["src/auth/session.ts", "tests/unit/auth/session.test.ts"],
          gate: "bun test tests/unit/auth/session.test.ts",
          charter_goals: ["G1"],
          acceptance_criteria: ["Fix expiry issue", "Pass test gate"],
          dependencies: [],
          source_type: "feedback_intake",
          priority: "HIGH",
          rationale: "Fix session expiry bug",
          assigned_implementer: "implementer-session",
          assigned_validator: "validator-session",
        },
        {
          id: "task-2-fix-tokens",
          label: "Harden Bearer Token Parser",
          write_scope: ["src/auth/tokens.ts", "tests/unit/auth/tokens.test.ts"],
          gate: "bun test tests/unit/auth/tokens.test.ts",
          charter_goals: ["G1"],
          acceptance_criteria: ["Verify token parser", "Pass gate"],
          dependencies: ["task-1-fix-login"],
          source_type: "plan_enhancement",
          priority: "CRITICAL",
          rationale: "Harden tokens parser",
          assigned_implementer: "implementer-tokens",
          assigned_validator: "validator-tokens",
        },
      ];

      const report = validateAntiBatchingRule(validPlans);
      expect(report.compliant).toBe(true);
      expect(report.violations).toHaveLength(0);
      expect(report.total_tasks).toBe(2);
      expect(report.isolated_task_count).toBe(2);

      // assertAntiBatchingRule must not throw
      expect(() => assertAntiBatchingRule(validPlans)).not.toThrow();
    });

    it("detects and rejects multi-feedback batching in metadata", () => {
      const batchedPlan: SmartTaskPlan = {
        id: "task-batched-fb",
        label: "Batched Feedback Fix",
        write_scope: ["src/mind/queue.ts"],
        gate: "bun test",
        charter_goals: ["G1"],
        acceptance_criteria: ["Fix all"],
        dependencies: [],
        source_type: "feedback_intake",
        rationale: "Merge multiple feedbacks",
        assigned_implementer: "implementer-1",
        assigned_validator: "validator-1",
        metadata: {
          batched_feedback_ids: ["fb-1", "fb-2", "fb-3"],
        },
      };

      const report = validateAntiBatchingRule([batchedPlan]);
      expect(report.compliant).toBe(false);
      expect(
        report.violations.some((v) => v.includes("illegally merges multiple feedback items")),
      ).toBe(true);
      expect(() => assertAntiBatchingRule([batchedPlan])).toThrow("Anti-Batching Rule violation");
    });

    it("detects and rejects multi-candidate defect batching", () => {
      const batchedCandidatePlan: SmartTaskPlan = {
        id: "task-batched-candidates",
        label: "Batched Candidates Remediation",
        write_scope: ["src/mind/core.ts"],
        gate: "bun test",
        charter_goals: ["G1"],
        acceptance_criteria: ["Fix both"],
        dependencies: [],
        source_type: "blunder_remediation",
        rationale: "Multi defect fix",
        assigned_implementer: "impl-1",
        assigned_validator: "val-1",
        metadata: {
          batched_candidate_ids: ["cand-A", "cand-B"],
        },
      };

      const report = validateAntiBatchingRule([batchedCandidatePlan]);
      expect(report.compliant).toBe(false);
      expect(
        report.violations.some((v) => v.includes("illegally merges multiple defect candidates")),
      ).toBe(true);
    });

    it("rejects multi-item feedback_id with delimiter (comma/semicolon)", () => {
      const delimitedPlan: SmartTaskPlan = {
        id: "task-delimited",
        label: "Delimited ID Task",
        write_scope: ["src/cli.ts"],
        gate: "bun test",
        charter_goals: ["G1"],
        acceptance_criteria: ["Pass"],
        dependencies: [],
        source_type: "feedback_intake",
        rationale: "R",
        assigned_implementer: "impl-1",
        assigned_validator: "val-1",
        feedback_id: "fb-1, fb-2",
      };

      const report = validateAntiBatchingRule([delimitedPlan]);
      expect(report.compliant).toBe(false);
      expect(report.violations.some((v) => v.includes("multi-item feedback_id"))).toBe(true);
    });

    it("rejects batch markers in label or rationale", () => {
      const taggedPlan: SmartTaskPlan = {
        id: "task-tagged",
        label: "[BATCH] Merge 5 Bug Fixes",
        write_scope: ["src/cli.ts"],
        gate: "bun test",
        charter_goals: ["G1"],
        acceptance_criteria: ["Pass"],
        dependencies: [],
        source_type: "direct_prompt",
        rationale: "R",
        assigned_implementer: "impl-1",
        assigned_validator: "val-1",
      };

      const report = validateAntiBatchingRule([taggedPlan]);
      expect(report.compliant).toBe(false);
      expect(report.violations.some((v) => v.includes("indicates batched execution"))).toBe(true);
    });

    it("rejects empty write scope and empty scope entries", () => {
      const emptyScopePlan: SmartTaskPlan = {
        id: "task-empty-scope",
        label: "Empty Scope Task",
        write_scope: [],
        gate: "bun test",
        charter_goals: ["G1"],
        acceptance_criteria: ["Pass"],
        dependencies: [],
        source_type: "direct_prompt",
        rationale: "R",
        assigned_implementer: "impl-1",
        assigned_validator: "val-1",
      };

      const blankScopeEntryPlan: SmartTaskPlan = {
        id: "task-blank-entry",
        label: "Blank Scope Entry Task",
        write_scope: ["   "],
        gate: "bun test",
        charter_goals: ["G1"],
        acceptance_criteria: ["Pass"],
        dependencies: [],
        source_type: "direct_prompt",
        rationale: "R",
        assigned_implementer: "impl-1",
        assigned_validator: "val-1",
      };

      expect(validateAntiBatchingRule([emptyScopePlan]).compliant).toBe(false);
      expect(validateAntiBatchingRule([blankScopeEntryPlan]).compliant).toBe(false);
    });

    it("enforces 1:1 implementer-validator isolation (no self-validation)", () => {
      const selfValidatingPlan: SmartTaskPlan = {
        id: "task-self-val",
        label: "Self Validating Task",
        write_scope: ["src/module.ts"],
        gate: "bun test",
        charter_goals: ["G1"],
        acceptance_criteria: ["Pass"],
        dependencies: [],
        source_type: "direct_prompt",
        rationale: "R",
        assigned_implementer: "agent-alice",
        assigned_validator: "agent-alice",
      };

      const report = validateAntiBatchingRule([selfValidatingPlan]);
      expect(report.compliant).toBe(false);
      expect(
        report.violations.some((v) =>
          v.includes("cannot act as independent validator for its own task"),
        ),
      ).toBe(true);
    });

    it("rejects missing implementer or missing validator", () => {
      const missingImplementerPlan: SmartTaskPlan = {
        id: "task-no-impl",
        label: "No Implementer Task",
        write_scope: ["src/module.ts"],
        gate: "bun test",
        charter_goals: ["G1"],
        acceptance_criteria: ["Pass"],
        dependencies: [],
        source_type: "direct_prompt",
        rationale: "R",
        assigned_validator: "val-1",
      };

      const missingValidatorPlan: SmartTaskPlan = {
        id: "task-no-val",
        label: "No Validator Task",
        write_scope: ["src/module.ts"],
        gate: "bun test",
        charter_goals: ["G1"],
        acceptance_criteria: ["Pass"],
        dependencies: [],
        source_type: "direct_prompt",
        rationale: "R",
        assigned_implementer: "impl-1",
      };

      expect(validateAntiBatchingRule([missingImplementerPlan]).compliant).toBe(false);
      expect(validateAntiBatchingRule([missingValidatorPlan]).compliant).toBe(false);
    });

    it("rejects duplicate task IDs in a plan set", () => {
      const planA: SmartTaskPlan = {
        id: "duplicate-task-id",
        label: "Task A",
        write_scope: ["src/a.ts"],
        gate: "bun test",
        charter_goals: ["G1"],
        acceptance_criteria: ["Pass"],
        dependencies: [],
        source_type: "direct_prompt",
        rationale: "R",
        assigned_implementer: "impl-a",
        assigned_validator: "val-a",
      };

      const planB: SmartTaskPlan = {
        id: "duplicate-task-id",
        label: "Task B",
        write_scope: ["src/b.ts"],
        gate: "bun test",
        charter_goals: ["G1"],
        acceptance_criteria: ["Pass"],
        dependencies: [],
        source_type: "direct_prompt",
        rationale: "R",
        assigned_implementer: "impl-b",
        assigned_validator: "val-b",
      };

      const report = validateAntiBatchingRule([planA, planB]);
      expect(report.compliant).toBe(false);
      expect(report.violations.some((v) => v.includes("Duplicate task ID"))).toBe(true);
    });
  });

  describe("2. Scope Collision Detection & Wave Partitioning", () => {
    it("detectScopeOverlap accurately flags exact matches and directory containment", () => {
      const scopeA = ["src/mind/smart-task-manager.ts", "docs/"];
      const scopeB = ["src/mind/smart-task-manager.ts"];
      const scopeC = ["src/mind/"];
      const scopeD = ["src/cli/other.ts"];

      expect(detectScopeOverlap(scopeA, scopeB)).toHaveLength(1);
      expect(detectScopeOverlap(scopeA, scopeC)).toHaveLength(1);
      expect(detectScopeOverlap(scopeA, scopeD)).toHaveLength(0);
    });

    it("calculateScopeCollisions finds all overlapping tasks across plans", () => {
      const plans: SmartTaskPlan[] = [
        {
          id: "t1",
          label: "Task 1",
          write_scope: ["src/shared/util.ts", "src/mod1.ts"],
          gate: "bun test",
          charter_goals: ["G1"],
          acceptance_criteria: ["P"],
          dependencies: [],
          source_type: "direct_prompt",
          rationale: "R",
          assigned_implementer: "impl-1",
          assigned_validator: "val-1",
        },
        {
          id: "t2",
          label: "Task 2",
          write_scope: ["src/shared/util.ts", "src/mod2.ts"],
          gate: "bun test",
          charter_goals: ["G1"],
          acceptance_criteria: ["P"],
          dependencies: [],
          source_type: "direct_prompt",
          rationale: "R",
          assigned_implementer: "impl-2",
          assigned_validator: "val-2",
        },
        {
          id: "t3",
          label: "Task 3",
          write_scope: ["src/isolated.ts"],
          gate: "bun test",
          charter_goals: ["G1"],
          acceptance_criteria: ["P"],
          dependencies: [],
          source_type: "direct_prompt",
          rationale: "R",
          assigned_implementer: "impl-3",
          assigned_validator: "val-3",
        },
      ];

      const collisions = calculateScopeCollisions(plans);
      expect(collisions.length).toBeGreaterThan(0);
      const sharedCol = collisions.find((c) => c.scope.includes("shared/util.ts"));
      expect(sharedCol).toBeDefined();
      expect(sharedCol?.task_ids).toEqual(["t1", "t2"]);

      // detectScopeCollisions alias
      const aliasCol = detectScopeCollisions(plans);
      expect(aliasCol).toEqual(collisions);
    });

    it("planWaveExecution partitions tasks with dependencies into ordered topological waves", () => {
      const tasks: SmartTaskPlan[] = [
        {
          id: "root-1",
          label: "Root 1",
          write_scope: ["src/a.ts"],
          gate: "bun test",
          charter_goals: ["G1"],
          acceptance_criteria: ["P"],
          dependencies: [],
          source_type: "direct_prompt",
          rationale: "R",
          assigned_implementer: "impl-1",
          assigned_validator: "val-1",
        },
        {
          id: "root-2",
          label: "Root 2",
          write_scope: ["src/b.ts"],
          gate: "bun test",
          charter_goals: ["G1"],
          acceptance_criteria: ["P"],
          dependencies: [],
          source_type: "direct_prompt",
          rationale: "R",
          assigned_implementer: "impl-2",
          assigned_validator: "val-2",
        },
        {
          id: "child-1",
          label: "Child 1",
          write_scope: ["src/c.ts"],
          gate: "bun test",
          charter_goals: ["G1"],
          acceptance_criteria: ["P"],
          dependencies: ["root-1", "root-2"],
          source_type: "direct_prompt",
          rationale: "R",
          assigned_implementer: "impl-3",
          assigned_validator: "val-3",
        },
      ];

      const wavePlan = planWaveExecution(tasks);
      expect(wavePlan.total_tasks).toBe(3);
      expect(wavePlan.total_waves).toBe(2);
      expect(wavePlan.waves[0]?.task_ids).toEqual(["root-1", "root-2"]);
      expect(wavePlan.waves[1]?.task_ids).toEqual(["child-1"]);
    });

    it("planWaveExecution partitions colliding scopes at same depth into consecutive disjoint sub-waves", () => {
      const collidingTasks: SmartTaskPlan[] = [
        {
          id: "task-A",
          label: "Task A",
          write_scope: ["src/common.ts"],
          gate: "bun test",
          charter_goals: ["G1"],
          acceptance_criteria: ["P"],
          dependencies: [],
          source_type: "direct_prompt",
          rationale: "R",
          assigned_implementer: "impl-a",
          assigned_validator: "val-a",
        },
        {
          id: "task-B",
          label: "Task B",
          write_scope: ["src/common.ts"], // Scope collision with task-A
          gate: "bun test",
          charter_goals: ["G1"],
          acceptance_criteria: ["P"],
          dependencies: [],
          source_type: "direct_prompt",
          rationale: "R",
          assigned_implementer: "impl-b",
          assigned_validator: "val-b",
        },
        {
          id: "task-C",
          label: "Task C",
          write_scope: ["src/independent.ts"], // Independent
          gate: "bun test",
          charter_goals: ["G1"],
          acceptance_criteria: ["P"],
          dependencies: [],
          source_type: "direct_prompt",
          rationale: "R",
          assigned_implementer: "impl-c",
          assigned_validator: "val-c",
        },
      ];

      const result = planWaveExecution(collidingTasks);
      expect(result.total_tasks).toBe(3);
      // Colliding tasks must NOT be in the same wave
      expect(result.total_waves).toBe(2);
      expect(result.waves[0]?.task_ids).toEqual(["task-A", "task-C"]);
      expect(result.waves[1]?.task_ids).toEqual(["task-B"]);

      // Verify no two tasks in the same wave touch overlapping write scopes
      for (const wave of result.waves) {
        for (let i = 0; i < wave.tasks.length; i++) {
          for (let j = i + 1; j < wave.tasks.length; j++) {
            const overlaps = detectScopeOverlap(
              wave.tasks[i]!.write_scope,
              wave.tasks[j]!.write_scope,
            );
            expect(overlaps).toHaveLength(0);
          }
        }
      }
    });

    it("planWaveExecution detects circular dependencies and throws INTEGRITY error", () => {
      const cycleTasks: SmartTaskPlan[] = [
        {
          id: "task-x",
          label: "Task X",
          write_scope: ["src/x.ts"],
          gate: "bun test",
          charter_goals: ["G1"],
          acceptance_criteria: ["P"],
          dependencies: ["task-y"],
          source_type: "direct_prompt",
          rationale: "R",
          assigned_implementer: "impl-x",
          assigned_validator: "val-x",
        },
        {
          id: "task-y",
          label: "Task Y",
          write_scope: ["src/y.ts"],
          gate: "bun test",
          charter_goals: ["G1"],
          acceptance_criteria: ["P"],
          dependencies: ["task-x"],
          source_type: "direct_prompt",
          rationale: "R",
          assigned_implementer: "impl-y",
          assigned_validator: "val-y",
        },
      ];

      expect(() => planWaveExecution(cycleTasks)).toThrow("Circular dependency detected");
    });

    it("expandExternalPromptToWavePlan and planEnhanceToWavePlan construct disjoint wave plans", () => {
      const prompt = `
        Step 1: Create base database types
        Step 2: Add queries and mutations
        Step 3: Add integration test suite
      `;
      const wavePlan = expandExternalPromptToWavePlan(prompt, { baseIdPrefix: "ext-wave" });
      expect(wavePlan.total_tasks).toBe(3);
      expect(wavePlan.total_waves).toBe(3);
      expect(wavePlan.waves[0]?.tasks[0]?.id).toContain("ext-wave-1");

      const feedbacks: FeedbackItem[] = [
        {
          id: "fb-1",
          title: "FB 1",
          content: "Content 1",
          priority: "NORMAL",
          category: "CORE_ENGINE",
          status: "PENDING",
        },
        {
          id: "fb-2",
          title: "FB 2",
          content: "Content 2",
          priority: "NORMAL",
          category: "CORE_ENGINE",
          status: "PENDING",
        },
      ];

      const fbWavePlan = planEnhanceToWavePlan(feedbacks, { baseIdPrefix: "fb-wave" });
      expect(fbWavePlan.total_tasks).toBe(2);
      expect(fbWavePlan.waves.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("3. Autonomous Dual Intake (Self-Evolution vs External Feedback)", () => {
    it("synthesizeSmartTasksFromFeedbackQueue strictly partitions pending feedback 1:1", () => {
      setup();
      appendFeedbackItem(
        {
          id: "fb-auth-1",
          title: "Fix Auth Header Parsing",
          content: "Ensure RFC 7235 compliance for auth headers",
          priority: "CRITICAL_USER_FEEDBACK",
          category: "CORE_ENGINE",
          status: "PENDING",
        },
        feedbackFile,
      );

      appendFeedbackItem(
        {
          id: "fb-docs-2",
          title: "Update API Reference Docs",
          content: "Add missing endpoints to swagger spec",
          priority: "NORMAL",
          category: "DOCUMENTATION",
          status: "PENDING",
        },
        feedbackFile,
      );

      const result = synthesizeSmartTasksFromFeedbackQueue({
        capsulesDir: feedbackFile,
        queuePath: taskQueueFile,
        autoEnqueue: true,
      });

      expect(result.mode).toBe("feedback_intake");
      expect(result.tasks).toHaveLength(2);
      expect(result.anti_batching_enforced).toBe(true);
      expect(result.enqueued_count).toBe(2);

      // Verify each task has dedicated implementer and independent validator
      for (const t of result.tasks) {
        expect(t.assigned_implementer).toBeDefined();
        expect(t.assigned_validator).toBeDefined();
        expect(t.assigned_implementer).not.toBe(t.assigned_validator);
      }

      // Verify feedback was drained to ADMITTED
      const remaining = readFeedbackQueue(feedbackFile);
      expect(remaining.filter((f) => f.status === "ADMITTED")).toHaveLength(2);
      teardown();
    });

    it("synthesizeSmartTasksFromSelfEvolution synthesizes invariant hardening and optimization on idle queue", () => {
      setup();
      const result = synthesizeSmartTasksFromSelfEvolution({
        capsulesDir: feedbackFile,
        queuePath: taskQueueFile,
        autoEnqueue: true,
      });

      expect(result.mode).toBe("self_evolution");
      expect(result.tasks.length).toBeGreaterThan(0);
      expect(result.anti_batching_enforced).toBe(true);

      const hardeningTask = result.tasks.find((t) => t.id.includes("invariant-hardening"));
      expect(hardeningTask).toBeDefined();
      expect(hardeningTask?.assigned_implementer).not.toBe(hardeningTask?.assigned_validator);
      expect(hardeningTask?.write_scope.length).toBeGreaterThan(0);

      const queue = readTaskQueue(taskQueueFile);
      expect(queue.length).toBe(result.tasks.length);
      teardown();
    });

    it("processAutonomousDualIntake dynamically switches between Mode B, Mode A, and Queue_Active", () => {
      setup();
      // Step 1: Pending feedback -> Mode B
      appendFeedbackItem(
        {
          id: "fb-intake-test",
          title: "Intake Test Feedback",
          content: "Test dual intake switching",
          priority: "HIGH_ARCHITECTURAL_FEATURE",
          category: "CORE_ENGINE",
          status: "PENDING",
        },
        feedbackFile,
      );

      const cycle1 = processAutonomousDualIntake({
        capsulesDir: feedbackFile,
        queuePath: taskQueueFile,
      });

      expect(cycle1.mode).toBe("Mode_B_External_Intake");
      expect(cycle1.synthesized_plans.length).toBeGreaterThan(0);
      expect(cycle1.enqueued_tasks.length).toBeGreaterThan(0);
      expect(cycle1.admitted_feedback_ids).toContain("fb-intake-test");

      // Step 2: Queue has active tasks, feedback queue empty -> Queue_Active
      const cycle2 = processAutonomousDualIntake({
        capsulesDir: feedbackFile,
        queuePath: taskQueueFile,
      });

      expect(cycle2.mode).toBe("Queue_Active");
      expect(cycle2.synthesized_plans).toHaveLength(0);

      // Step 3: Clear active task queue, feedback empty -> Mode A Self Evolution
      clearTaskQueue(taskQueueFile);
      const cycle3 = processAutonomousDualIntake({
        capsulesDir: feedbackFile,
        queuePath: taskQueueFile,
      });

      expect(cycle3.mode).toBe("Mode_A_Self_Evolution");
      expect(cycle3.synthesized_plans.length).toBeGreaterThan(0);
      expect(cycle3.enqueued_tasks.length).toBeGreaterThan(0);
      teardown();
    });

    it("partitionGroupedFeedbacksStrictly and partitionCandidatesStrictly enforce 1:1 partitioning", () => {
      const feedbacks: FeedbackItem[] = [
        {
          id: "fb-p1",
          title: "P1 Directive",
          content: "C1",
          priority: "CRITICAL_USER_FEEDBACK",
          category: "CORE_ENGINE",
          status: "PENDING",
        },
        {
          id: "fb-p2",
          title: "P2 Directive",
          content: "C2",
          priority: "NORMAL",
          category: "CLI_TOOLING",
          status: "PENDING",
        },
      ];

      const partitioned = partitionGroupedFeedbacksStrictly(feedbacks);
      expect(partitioned).toHaveLength(2);
      expect(partitioned[0]?.id).toContain("fb-p1");
      expect(partitioned[1]?.id).toContain("fb-p2");
      expect(partitioned[0]?.assigned_implementer).not.toBe(partitioned[0]?.assigned_validator);

      const candidates = [
        { id: "cand-1", title: "Defect 1", category: "CORE_ENGINE" },
        { id: "cand-2", title: "Defect 2", category: "CLI_TOOLING" },
      ];
      const candTasks = partitionCandidatesStrictly(candidates);
      expect(candTasks).toHaveLength(2);
      expect(candTasks[0]?.candidate_id).toBe("cand-1");
      expect(candTasks[1]?.candidate_id).toBe("cand-2");
    });
  });

  describe("4. Feedback Queue Ingestion, Drainage, Priority & Persistence", () => {
    it("ingests and sorts feedback items by strict priority hierarchy and timestamp", () => {
      setup();
      appendFeedbackItem(
        {
          id: "fb-low",
          title: "Low Priority",
          content: "Content",
          priority: "LOW",
          category: "DOCUMENTATION",
          status: "PENDING",
        },
        feedbackFile,
      );

      appendFeedbackItem(
        {
          id: "fb-crit",
          title: "Critical Priority",
          content: "Content",
          priority: "CRITICAL_USER_FEEDBACK",
          category: "CORE_ENGINE",
          status: "PENDING",
        },
        feedbackFile,
      );

      appendFeedbackItem(
        {
          id: "fb-high",
          title: "High Priority",
          content: "Content",
          priority: "HIGH_ARCHITECTURAL_FEATURE",
          category: "CORE_ENGINE",
          status: "PENDING",
        },
        feedbackFile,
      );

      const items = readFeedbackQueue(feedbackFile);
      expect(items).toHaveLength(3);
      expect(items[0]?.id).toBe("fb-crit");
      expect(items[1]?.id).toBe("fb-high");
      expect(items[2]?.id).toBe("fb-low");

      expect(compareFeedbackPriority("CRITICAL_USER_FEEDBACK", "LOW")).toBeLessThan(0);
      expect(compareFeedbackPriority("NORMAL", "NORMAL")).toBe(0);
      teardown();
    });

    it("admitFeedbackToQueue updates status to ADMITTED idempotently", () => {
      setup();
      appendFeedbackItem(
        {
          id: "fb-admit-target",
          title: "Admit Target",
          content: "Content",
          priority: "NORMAL",
          category: "CORE_ENGINE",
          status: "PENDING",
        },
        feedbackFile,
      );

      const admitted = admitFeedbackToQueue("fb-admit-target", feedbackFile);
      expect(admitted.status).toBe("ADMITTED");
      expect(admitted.processed_at).toBeDefined();

      // Read back
      const read = readFeedbackQueue(feedbackFile);
      expect(read[0]?.status).toBe("ADMITTED");

      // Admitting by object creates/updates cleanly
      const newAdmitted = admitFeedbackToQueue(
        {
          id: "fb-new-admitted",
          title: "Direct Admitted",
          content: "Direct",
          priority: "HIGH_ARCHITECTURAL_FEATURE",
          category: "CORE_ENGINE",
        },
        feedbackFile,
      );
      expect(newAdmitted.status).toBe("ADMITTED");
      teardown();
    });

    it("drainPendingFeedbacks drains matching items atomically with limits and category filters", () => {
      setup();
      appendFeedbackItem(
        {
          id: "fb-d1",
          title: "D1 Core",
          content: "C",
          priority: "NORMAL",
          category: "CORE_ENGINE",
          status: "PENDING",
        },
        feedbackFile,
      );
      appendFeedbackItem(
        {
          id: "fb-d2",
          title: "D2 Docs",
          content: "C",
          priority: "NORMAL",
          category: "DOCUMENTATION",
          status: "PENDING",
        },
        feedbackFile,
      );
      appendFeedbackItem(
        {
          id: "fb-d3",
          title: "D3 Core",
          content: "C",
          priority: "NORMAL",
          category: "CORE_ENGINE",
          status: "PENDING",
        },
        feedbackFile,
      );

      // Drain only CORE_ENGINE, limit 1
      const drained = drainPendingFeedbacks(
        { category: "CORE_ENGINE", limit: 1, markAs: "PROCESSED" },
        feedbackFile,
      );
      expect(drained).toHaveLength(1);
      expect(drained[0]?.id).toBe("fb-d1");
      expect(drained[0]?.status).toBe("PROCESSED");

      const stats = getFeedbackStats(readFeedbackQueue(feedbackFile));
      expect(stats.processed).toBe(1);
      expect(stats.pending).toBe(2);
      teardown();
    });

    it("seals resolution and backpropagates execution proof to feedback items", () => {
      setup();
      appendFeedbackItem(
        {
          id: "fb-seal-test",
          title: "Seal Test",
          content: "Content",
          priority: "CRITICAL_USER_FEEDBACK",
          category: "CORE_ENGINE",
          status: "ADMITTED",
        },
        feedbackFile,
      );

      const proof: FeedbackResolutionProof = {
        task_id: "task-seal-1",
        resolved_at: new Date().toISOString(),
        test_path: "tests/unit/mind/smart-task-manager.test.ts",
        proof_summary: "Empirically sealed and verified with 100% gate pass",
        commit_sha: "abcdef123456",
      };

      const sealed = sealFeedbackResolution("fb-seal-test", proof, { customPath: feedbackFile });
      expect(sealed.status).toBe("COMPLETED");
      expect(sealed.resolution?.task_id).toBe("task-seal-1");
      expect(sealed.commit_sha).toBe("abcdef123456");

      // Backpropagation
      appendFeedbackItem(
        {
          id: "fb-backprop-1",
          title: "Backprop 1",
          content: "C",
          priority: "NORMAL",
          category: "CORE_ENGINE",
          status: "ADMITTED",
          candidate_id: "defect-999",
        },
        feedbackFile,
      );

      const updated = backpropagateFeedbackResolution(
        [
          {
            id: "defect-999",
            commit_sha: "fedcba987654",
            proof_summary: "Resolved defect candidate 999",
            test_path: "tests/unit/core.test.ts",
          },
        ],
        feedbackFile,
      );

      expect(updated).toHaveLength(1);
      expect(updated[0]?.status).toBe("COMPLETED");
      expect(updated[0]?.commit_sha).toBe("fedcba987654");
      teardown();
    });

    it("ingestFeedbackItem and clearFeedbackQueue operate cleanly", () => {
      setup();
      const ingested = ingestFeedbackItem(
        {
          title: "Ingested Item",
          content: "Direct ingestion test",
          priority: "USER_DIRECTIVE",
          category: "CLI_TOOLING",
        },
        feedbackFile,
      );
      expect(ingested.id).toBeDefined();
      expect(ingested.status).toBe("PENDING");

      clearFeedbackQueue(feedbackFile);
      expect(readFeedbackQueue(feedbackFile)).toHaveLength(0);
      teardown();
    });
  });

  describe("5. Static Invariant Verification: 0 TypeScript any & 0 Suppressions", () => {
    it("proves 0 any and 0 compiler/linter suppressions across all leased modules", () => {
      const filesToAudit = [
        join(process.cwd(), "orchestrating-long-tasks/scripts/src/mind/smart-task-manager.ts"),
        join(process.cwd(), "orchestrating-long-tasks/scripts/src/mind/feedback-queue.ts"),
        join(process.cwd(), "tests/unit/mind/smart-task-manager.test.ts"),
      ];

      const anyRegex = new RegExp(":\\s*any\\b|as\\s+any\\b|<any>");
      const suppressionRegex = new RegExp(
        [
          "@ts" + "-ignore",
          "@ts" + "-expect-error",
          "@ts" + "-nocheck",
          "eslint" + "-disable",
          "oxlint" + "-disable",
        ].join("|"),
      );

      for (const filePath of filesToAudit) {
        expect(existsSync(filePath)).toBe(true);
        const content = readFileSync(filePath, "utf8");
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (line.includes("anyRegex") || line.includes("suppressionRegex")) {
            continue;
          }
          expect(anyRegex.test(line)).toBe(false);
          expect(suppressionRegex.test(line)).toBe(false);
        }
      }
    });
  });
});

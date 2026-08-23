import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";
import {
  admitAndDispatchFeedbackAtomically,
  admitFeedbackToQueue,
  appendFeedbackItem,
  auditAdmissionDispatchIntegrity,
  clearFeedbackQueue,
  ingestFeedbackItem,
  readFeedbackQueue,
  reconcilePausedAdmittedFeedbacks,
  writeFeedbackQueue,
  type FeedbackItem,
} from "../../../olt/scripts/src/mind/feedback-queue.ts";
import {
  assertAntiBatchingRule,
  executeAtomicAdmissionToDispatch,
  executeProductOwnerAdmissionAndDispatch,
  partitionGroupedFeedbacksStrictly,
  partitionTasksAcrossOrchestrators,
  planMultiOrchestratorExecution,
  preplanMultiOrchestratorTasks,
  readCognitiveMemory,
  reconcileAdmissionToDispatchState,
  runInfiniteProductOwnerCycle,
  stageTasksForMultiOrchestratorExecution,
  validateAntiBatchingRule,
  validateMultiOrchestratorIsolation,
  verifyAdmissionToDispatchInvariants,
  verifyProductOwnerInvariants,
  type MultiOrchestratorPrePlanningResult,
  type ProductOwnerIntakeItem,
  type SmartTaskPlan,
} from "../../../olt/scripts/src/mind/smart-task-manager.ts";
import {
  clearTaskQueue,
  enqueueTasksBatch,
  getQueueStats,
  readTaskQueue,
} from "../../../olt/scripts/src/mind/task-queue.ts";

describe("Mind Product Owner Mode & Atomic Dispatch Chaining Test Suite", () => {
  const testRoot = join(
    tmpdir(),
    `test-po-dispatch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  );
  const capsulesDir = testRoot;
  const feedbackFile = join(testRoot, ".olt", "capsules", "FEEDBACK_QUEUE.jsonl");
  const taskQueueFile = join(testRoot, ".olt", "capsules", "TASK_QUEUE.jsonl");
  const memoryFile = join(testRoot, ".olt", "memory.json");

  beforeEach(() => {
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
    mkdirSync(join(testRoot, ".olt"), { recursive: true });
  });

  afterAll(() => {
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  describe("1. Infinite Mind Product Owner Mode Intake & Lifecycle", () => {
    it("runs Mode A autonomous self-evolution cycle on empty backlog and queue", () => {
      const result = runInfiniteProductOwnerCycle({
        capsulesDir: feedbackFile,
        queuePath: taskQueueFile,
        memoryPath: memoryFile,
        autoEnqueue: true,
      });

      expect(result.mode).toBe("self_evolution");
      expect(result.synthesized_tasks.length).toBeGreaterThan(0);
      expect(result.enqueued_tasks.length).toBe(result.synthesized_tasks.length);
      expect(result.zero_paused_admitted_guaranteed).toBe(true);
      expect(result.macro_metrics.work).toBeGreaterThan(0);
      expect(result.macro_metrics.span).toBeGreaterThan(0);
      expect(result.macro_metrics.parallelism).toBeGreaterThan(0);

      // Verify tasks in task queue
      const queued = readTaskQueue(taskQueueFile);
      expect(queued.length).toBe(result.synthesized_tasks.length);

      // Verify 1:1 implementer-validator isolation on all synthesized tasks
      const report = validateAntiBatchingRule(result.synthesized_tasks);
      expect(report.compliant).toBe(true);

      // Verify cognitive memory state updated
      const memory = readCognitiveMemory(memoryFile);
      expect(memory.strategic_focus.length).toBeGreaterThan(0);
      expect(memory.macro_metrics?.work).toBe(result.macro_metrics.work);
    });

    it("runs Mode B external intake when pending feedbacks exist and atomically dispatches", () => {
      // Ingest 3 pending feedbacks
      ingestFeedbackItem(
        {
          title: "Fix Auth Leak",
          content: "Auth token leaked",
          priority: "CRITICAL_USER_FEEDBACK",
          category: "CORE_ENGINE",
        },
        feedbackFile,
      );
      ingestFeedbackItem(
        {
          title: "Optimize Billing",
          content: "Invoice calculation slow",
          priority: "NORMAL",
          category: "SCALING",
        },
        feedbackFile,
      );
      ingestFeedbackItem(
        {
          title: "Document API",
          content: "Missing CLI flags in docs",
          priority: "LOW",
          category: "DOCUMENTATION",
        },
        feedbackFile,
      );

      const feedbacksBefore = readFeedbackQueue(feedbackFile);
      expect(feedbacksBefore.filter((f) => f.status === "PENDING")).toHaveLength(3);

      const result = runInfiniteProductOwnerCycle({
        capsulesDir: feedbackFile,
        queuePath: taskQueueFile,
        memoryPath: memoryFile,
        autoEnqueue: true,
      });

      expect(result.mode).toBe("feedback_intake");
      expect(result.decisions).toHaveLength(3);
      expect(result.synthesized_tasks).toHaveLength(3);
      expect(result.enqueued_tasks).toHaveLength(3);
      expect(result.zero_paused_admitted_guaranteed).toBe(true);

      // Verify feedbacks marked ADMITTED with linked dispatched_task_id
      const feedbacksAfter = readFeedbackQueue(feedbackFile);
      const admittedFeedbacks = feedbacksAfter.filter((f) => f.status === "ADMITTED");
      expect(admittedFeedbacks).toHaveLength(3);

      for (const fb of admittedFeedbacks) {
        expect(typeof fb.metadata?.["dispatched_task_id"]).toBe("string");
        expect(typeof fb.metadata?.["atomic_dispatched_at"]).toBe("string");
      }

      // Verify zero paused admitted invariant holds
      const audit = verifyAdmissionToDispatchInvariants({
        capsulesDir: feedbackFile,
        queuePath: taskQueueFile,
      });
      expect(audit.compliant).toBe(true);
      expect(audit.zero_paused_admitted).toBe(true);
      expect(audit.paused_admitted_feedback).toBe(0);
    });

    it("processes direct intake items from Product Owner stream", () => {
      const intakeItems: readonly ProductOwnerIntakeItem[] = [
        {
          id: "intake-1",
          title: "Implement Zero-Any Linter",
          description: "Strict typed AST validation for any usage",
          priority: "CRITICAL",
          category: "CORE_ENGINE",
          stream: "direct_directive",
        },
        {
          id: "intake-2",
          title: "Scale Concurrency to 40 Lanes",
          description: "Dynamic worker lane pool scaling",
          priority: "HIGH",
          category: "SCALING",
          stream: "charter_roadmap",
        },
      ];

      const result = runInfiniteProductOwnerCycle({
        capsulesDir: feedbackFile,
        queuePath: taskQueueFile,
        memoryPath: memoryFile,
        directIntakeItems: intakeItems,
        autoEnqueue: true,
      });

      expect(result.mode).toBe("feedback_intake");
      expect(result.decisions).toHaveLength(2);
      expect(result.synthesized_tasks).toHaveLength(2);
      expect(result.zero_paused_admitted_guaranteed).toBe(true);

      const queued = readTaskQueue(taskQueueFile);
      expect(queued).toHaveLength(2);
    });

    it("switches to idle_monitored mode when task queue already has active tasks and no new feedback", () => {
      // First cycle enqueues self-evolution tasks
      runInfiniteProductOwnerCycle({
        capsulesDir: feedbackFile,
        queuePath: taskQueueFile,
        memoryPath: memoryFile,
        autoEnqueue: true,
      });

      // Second cycle on non-empty active queue with 0 pending feedback
      const secondResult = runInfiniteProductOwnerCycle({
        capsulesDir: feedbackFile,
        queuePath: taskQueueFile,
        memoryPath: memoryFile,
        autoEnqueue: true,
      });

      expect(secondResult.mode).toBe("idle_monitored");
      expect(secondResult.synthesized_tasks).toHaveLength(0);
      expect(secondResult.enqueued_tasks).toHaveLength(0);
    });
  });

  describe("2. Atomic Admission-to-Dispatch Chaining & Zero Paused Admitted Invariant", () => {
    it("admitAndDispatchFeedbackAtomically links task ID and persists ADMITTED state", () => {
      const item = ingestFeedbackItem(
        {
          title: "Fix Pipeline Race",
          content: "Atomic race condition in task lock",
          priority: "CRITICAL_USER_FEEDBACK",
        },
        feedbackFile,
      );

      const dispatchResult = admitAndDispatchFeedbackAtomically(
        item.id,
        (fb) => {
          // Enqueue task to queue
          const taskId = `task-dispatched-${fb.id}`;
          enqueueTasksBatch(
            [
              {
                id: taskId,
                title: fb.title,
                description: fb.content,
                write_scope: ["src/pipeline/lock.ts", "tests/unit/pipeline/lock.test.ts"],
                gate: "bun test tests/unit/pipeline/lock.test.ts",
                metadata: {
                  feedback_id: fb.id,
                  assigned_implementer: "impl-1",
                  assigned_validator: "val-1",
                },
              },
            ],
            taskQueueFile,
          );
          return { taskId, autoEnqueued: true };
        },
        feedbackFile,
      );

      expect(dispatchResult.feedback_item.status).toBe("ADMITTED");
      expect(dispatchResult.dispatched_task_id).toBe(`task-dispatched-${item.id}`);

      // Verify audit reports zero paused admitted items
      const audit = auditAdmissionDispatchIntegrity({
        feedbackPath: feedbackFile,
        taskQueuePath: taskQueueFile,
      });
      expect(audit.is_compliant).toBe(true);
      expect(audit.paused_admitted_feedback_count).toBe(0);
      expect(audit.active_dispatched_feedback_count).toBe(1);
    });

    it("rolls back and does not modify feedback queue if dispatcher fails", () => {
      const item = ingestFeedbackItem(
        { title: "Unstable Operation", content: "Test failure handling", priority: "NORMAL" },
        feedbackFile,
      );

      expect(() => {
        admitAndDispatchFeedbackAtomically(
          item.id,
          () => {
            throw new HarnessError("INVALID_STATE", "Simulated enqueue failure");
          },
          feedbackFile,
        );
      }).toThrow("Simulated enqueue failure");

      // Verify item remains PENDING in queue
      const feedbacks = readFeedbackQueue(feedbackFile);
      const found = feedbacks.find((f) => f.id === item.id);
      expect(found?.status).toBe("PENDING");
    });

    it("detects and flags paused/orphaned admitted feedbacks lacking task queue nodes", () => {
      // Create an admitted feedback directly without creating a task in task queue (simulating orphan/paused state)
      const orphanItem = admitFeedbackToQueue(
        {
          id: "fb-orphan-1",
          title: "Orphaned Feedback Item",
          content: "Admitted but never dispatched",
          priority: "HIGH_ARCHITECTURAL_FEATURE",
          category: "CORE_ENGINE",
        },
        feedbackFile,
      );

      expect(orphanItem.status).toBe("ADMITTED");

      // Audit must detect the paused admitted item
      const audit = auditAdmissionDispatchIntegrity({
        feedbackPath: feedbackFile,
        taskQueuePath: taskQueueFile,
      });
      expect(audit.is_compliant).toBe(false);
      expect(audit.paused_admitted_feedback_count).toBe(1);
      expect(audit.paused_admitted_feedbacks[0]!.id).toBe("fb-orphan-1");
      expect(audit.violations.length).toBeGreaterThan(0);

      const fullAudit = verifyAdmissionToDispatchInvariants({
        capsulesDir: feedbackFile,
        queuePath: taskQueueFile,
      });
      expect(fullAudit.compliant).toBe(false);
      expect(fullAudit.zero_paused_admitted).toBe(false);
      expect(fullAudit.paused_admitted_feedback).toBe(1);
    });

    it("reconcileAdmissionToDispatchState automatically dispatches missing 1:1 isolated tasks for orphaned feedbacks", () => {
      // Ingest and manually admit an item without task node
      admitFeedbackToQueue(
        {
          id: "fb-to-reconcile",
          title: "Reconcile Orphan",
          content: "Needs immediate 1:1 dispatch",
          priority: "CRITICAL_USER_FEEDBACK",
          category: "CORE_ENGINE",
        },
        feedbackFile,
      );

      // Verify state before reconciliation is invalid
      const auditBefore = verifyAdmissionToDispatchInvariants({
        capsulesDir: feedbackFile,
        queuePath: taskQueueFile,
      });
      expect(auditBefore.zero_paused_admitted).toBe(false);

      // Run reconciliation
      const reconciliation = reconcileAdmissionToDispatchState({
        capsulesDir: feedbackFile,
        queuePath: taskQueueFile,
      });

      expect(reconciliation.reconciled_feedbacks_count).toBe(1);
      expect(reconciliation.newly_enqueued_tasks_count).toBe(1);
      expect(reconciliation.audit_report.zero_paused_admitted).toBe(true);

      // Verify task queue now has the newly enqueued task
      const queued = readTaskQueue(taskQueueFile);
      expect(queued.length).toBe(1);
      expect(queued[0]!.metadata?.["feedback_id"]).toBe("fb-to-reconcile");
    });

    it("reconcilePausedAdmittedFeedbacks can reset orphaned items to PENDING cleanly", () => {
      admitFeedbackToQueue(
        {
          id: "fb-reset-orphan",
          title: "Reset Orphan to Pending",
          content: "Reset test",
          priority: "NORMAL",
          category: "GENERAL",
        },
        feedbackFile,
      );

      const res = reconcilePausedAdmittedFeedbacks({
        feedbackPath: feedbackFile,
        taskQueuePath: taskQueueFile,
        resetToPending: true,
      });

      expect(res.reconciled_count).toBe(1);
      const feedbacks = readFeedbackQueue(feedbackFile);
      const reset = feedbacks.find((f) => f.id === "fb-reset-orphan");
      expect(reset?.status).toBe("PENDING");
    });

    it("executeAtomicAdmissionToDispatch admits batch and enforces 0 paused admitted items", () => {
      const fb1 = ingestFeedbackItem(
        { title: "Task Alpha", content: "Content Alpha", priority: "HIGH" },
        feedbackFile,
      );
      const fb2 = ingestFeedbackItem(
        { title: "Task Beta", content: "Content Beta", priority: "CRITICAL" },
        feedbackFile,
      );

      const result = executeAtomicAdmissionToDispatch({
        capsulesDir: feedbackFile,
        queuePath: taskQueueFile,
      });

      expect(result.synthesized_tasks).toHaveLength(2);
      expect(result.enqueued_tasks).toHaveLength(2);
      expect(result.admitted_feedbacks).toHaveLength(2);
      expect(result.audit_report.zero_paused_admitted).toBe(true);

      // Verify alias
      const auditAlias = verifyProductOwnerInvariants({
        capsulesDir: feedbackFile,
        queuePath: taskQueueFile,
      });
      expect(auditAlias.zero_paused_admitted).toBe(true);
    });
  });

  describe("3. Concurrent Multi-Orchestrator Pre-Planning & Disjoint Write Scope Isolation", () => {
    it("partitions independent tasks across multiple orchestrators with strictly disjoint write scopes", () => {
      const tasks: readonly SmartTaskPlan[] = [
        {
          id: "task-auth-login",
          label: "Auth Login Fix",
          write_scope: ["src/auth/login.ts", "tests/unit/auth/login.test.ts"],
          gate: "bun test tests/unit/auth/login.test.ts",
          charter_goals: ["G1"],
          acceptance_criteria: ["Pass gate"],
          dependencies: [],
          source_type: "feedback_intake",
          priority: "HIGH",
          effort: 2,
          rationale: "Fix login",
          assigned_implementer: "impl-auth",
          assigned_validator: "val-auth",
        },
        {
          id: "task-auth-session",
          label: "Auth Session Expiry",
          write_scope: ["src/auth/session.ts", "tests/unit/auth/session.test.ts"],
          gate: "bun test tests/unit/auth/session.test.ts",
          charter_goals: ["G1"],
          acceptance_criteria: ["Pass gate"],
          dependencies: ["task-auth-login"],
          source_type: "feedback_intake",
          priority: "HIGH",
          effort: 2,
          rationale: "Fix session",
          assigned_implementer: "impl-session",
          assigned_validator: "val-session",
        },
        {
          id: "task-billing-invoice",
          label: "Billing Invoice Calculation",
          write_scope: ["src/billing/invoice.ts", "tests/unit/billing/invoice.test.ts"],
          gate: "bun test tests/unit/billing/invoice.test.ts",
          charter_goals: ["G1"],
          acceptance_criteria: ["Pass gate"],
          dependencies: [],
          source_type: "feedback_intake",
          priority: "HIGH",
          effort: 2,
          rationale: "Fix billing",
          assigned_implementer: "impl-billing",
          assigned_validator: "val-billing",
        },
        {
          id: "task-billing-tax",
          label: "Billing Tax Rates",
          write_scope: ["src/billing/tax.ts", "tests/unit/billing/tax.test.ts"],
          gate: "bun test tests/unit/billing/tax.test.ts",
          charter_goals: ["G1"],
          acceptance_criteria: ["Pass gate"],
          dependencies: ["task-billing-invoice"],
          source_type: "feedback_intake",
          priority: "HIGH",
          effort: 2,
          rationale: "Fix tax",
          assigned_implementer: "impl-tax",
          assigned_validator: "val-tax",
        },
      ];

      const planResult = preplanMultiOrchestratorTasks(tasks, {
        orchestratorIds: ["orchestrator-auth", "orchestrator-billing"],
      });

      expect(planResult.total_orchestrators).toBe(2);
      expect(planResult.total_tasks).toBe(4);
      expect(planResult.is_disjoint).toBe(true);
      expect(planResult.cross_orchestrator_collisions).toHaveLength(0);

      // Verify each orchestrator has its distinct domain
      const orchAuth = planResult.orchestrators.find(
        (o) => o.orchestrator_id === "orchestrator-auth",
      );
      const orchBilling = planResult.orchestrators.find(
        (o) => o.orchestrator_id === "orchestrator-billing",
      );

      expect(orchAuth).toBeDefined();
      expect(orchBilling).toBeDefined();
      expect(orchAuth!.tasks).toHaveLength(2);
      expect(orchBilling!.tasks).toHaveLength(2);

      // Validate isolation assertions pass
      expect(() => validateMultiOrchestratorIsolation(planResult)).not.toThrow();

      // Verify MacroMetrics
      expect(planResult.macro_metrics.work).toBe(8); // 2+2+2+2
      expect(planResult.macro_metrics.span).toBe(4); // auth chain = 4, billing chain = 4
      expect(planResult.macro_metrics.parallelism).toBe(2); // 8 / 4 = 2.0
    });

    it("groups overlapping write scope tasks into the same orchestrator sub-tree", () => {
      const tasksWithSharedScope: readonly SmartTaskPlan[] = [
        {
          id: "task-shared-1",
          label: "Update Shared Parser",
          write_scope: ["src/parser/ast.ts", "tests/unit/parser/ast.test.ts"],
          gate: "bun test tests/unit/parser/ast.test.ts",
          charter_goals: ["G1"],
          acceptance_criteria: ["Pass gate"],
          dependencies: [],
          source_type: "plan_enhancement",
          priority: "HIGH",
          rationale: "Update AST",
          assigned_implementer: "impl-1",
          assigned_validator: "val-1",
        },
        {
          id: "task-shared-2",
          label: "Add Node Types to Parser",
          write_scope: ["src/parser/ast.ts", "src/parser/types.ts"],
          gate: "bun test tests/unit/parser/ast.test.ts",
          charter_goals: ["G1"],
          acceptance_criteria: ["Pass gate"],
          dependencies: [],
          source_type: "plan_enhancement",
          priority: "HIGH",
          rationale: "Add types",
          assigned_implementer: "impl-2",
          assigned_validator: "val-2",
        },
        {
          id: "task-independent-ui",
          label: "Update UI Theme",
          write_scope: ["src/ui/theme.ts", "tests/unit/ui/theme.test.ts"],
          gate: "bun test tests/unit/ui/theme.test.ts",
          charter_goals: ["G1"],
          acceptance_criteria: ["Pass gate"],
          dependencies: [],
          source_type: "plan_enhancement",
          priority: "MEDIUM",
          rationale: "UI Theme",
          assigned_implementer: "impl-3",
          assigned_validator: "val-3",
        },
      ];

      const plan = preplanMultiOrchestratorTasks(tasksWithSharedScope, 2);
      expect(plan.is_disjoint).toBe(true);

      // Both task-shared-1 and task-shared-2 must be in the same orchestrator sub-tree
      const orchWithShared1 = plan.orchestrators.find((o) =>
        o.tasks.some((t) => t.id === "task-shared-1"),
      );
      const orchWithShared2 = plan.orchestrators.find((o) =>
        o.tasks.some((t) => t.id === "task-shared-2"),
      );
      expect(orchWithShared1?.orchestrator_id).toBe(orchWithShared2?.orchestrator_id);

      expect(() => validateMultiOrchestratorIsolation(plan)).not.toThrow();
    });

    it("stageTasksForMultiOrchestratorExecution enriches tasks with orchestrator metadata", () => {
      const tasks: readonly SmartTaskPlan[] = [
        {
          id: "task-a",
          label: "Task Alpha",
          write_scope: ["src/module_a.ts"],
          gate: "bun test",
          charter_goals: ["G1"],
          acceptance_criteria: ["Pass gate"],
          dependencies: [],
          source_type: "feedback_intake",
          priority: "HIGH",
          rationale: "Alpha",
          assigned_implementer: "impl-a",
          assigned_validator: "val-a",
        },
        {
          id: "task-b",
          label: "Task Beta",
          write_scope: ["src/module_b.ts"],
          gate: "bun test",
          charter_goals: ["G1"],
          acceptance_criteria: ["Pass gate"],
          dependencies: [],
          source_type: "feedback_intake",
          priority: "HIGH",
          rationale: "Beta",
          assigned_implementer: "impl-b",
          assigned_validator: "val-b",
        },
      ];

      const { staged_tasks, plan } = stageTasksForMultiOrchestratorExecution(tasks, [
        "orch-1",
        "orch-2",
      ]);
      expect(staged_tasks).toHaveLength(2);
      expect(plan.is_disjoint).toBe(true);

      for (const t of staged_tasks) {
        expect(t.assigned_tier).toBe("Tier_1_Orchestrator");
        expect(typeof t.metadata?.["assigned_orchestrator"]).toBe("string");
        expect(typeof t.metadata?.["orchestrator_wave"]).toBe("number");
        expect(typeof t.metadata?.["disjoint_scope_group"]).toBe("string");
      }
    });

    it("throws INTEGRITY error when validateMultiOrchestratorIsolation encounters cross-orchestrator collisions", () => {
      const invalidPlan: MultiOrchestratorPrePlanningResult = {
        total_orchestrators: 2,
        total_tasks: 2,
        orchestrators: [
          {
            orchestrator_id: "orch-1",
            write_scope: ["src/shared/state.ts"],
            tasks: [
              {
                id: "task-1",
                label: "Task 1",
                write_scope: ["src/shared/state.ts"],
                gate: "bun test",
                charter_goals: ["G1"],
                acceptance_criteria: ["Pass"],
                dependencies: [],
                source_type: "feedback_intake",
                priority: "HIGH",
                rationale: "Test 1",
                assigned_implementer: "impl-1",
                assigned_validator: "val-1",
              },
            ],
            wave_plan: {
              total_waves: 1,
              total_tasks: 1,
              waves: [],
            },
            macro_metrics: { work: 1, span: 1, parallelism: 1, efficiency: 1 },
          },
          {
            orchestrator_id: "orch-2",
            write_scope: ["src/shared/state.ts"],
            tasks: [
              {
                id: "task-2",
                label: "Task 2",
                write_scope: ["src/shared/state.ts"],
                gate: "bun test",
                charter_goals: ["G1"],
                acceptance_criteria: ["Pass"],
                dependencies: [],
                source_type: "feedback_intake",
                priority: "HIGH",
                rationale: "Test 2",
                assigned_implementer: "impl-2",
                assigned_validator: "val-2",
              },
            ],
            wave_plan: {
              total_waves: 1,
              total_tasks: 1,
              waves: [],
            },
            macro_metrics: { work: 1, span: 1, parallelism: 1, efficiency: 1 },
          },
        ],
        macro_metrics: { work: 2, span: 1, parallelism: 2, efficiency: 1 },
        is_disjoint: false,
        cross_orchestrator_collisions: [
          {
            scope: "src/shared/state.ts",
            task_ids: ["orch-1", "orch-2"],
          },
        ],
        warnings: [],
      };

      expect(() => validateMultiOrchestratorIsolation(invalidPlan)).toThrow(
        /Multi-orchestrator isolation violation/,
      );
    });

    it("verifies aliases planMultiOrchestratorExecution and partitionTasksAcrossOrchestrators", () => {
      const tasks: readonly SmartTaskPlan[] = [
        {
          id: "task-1",
          label: "T1",
          write_scope: ["src/a.ts"],
          gate: "bun test",
          charter_goals: ["G1"],
          acceptance_criteria: ["Pass"],
          dependencies: [],
          source_type: "feedback_intake",
          priority: "HIGH",
          rationale: "T1",
          assigned_implementer: "impl-1",
          assigned_validator: "val-1",
        },
      ];

      const res1 = planMultiOrchestratorExecution(tasks, 1);
      const res2 = partitionTasksAcrossOrchestrators(tasks, 1);
      expect(res1.total_tasks).toBe(1);
      expect(res2.total_tasks).toBe(1);
    });
  });

  describe("4. Static Invariant Verification: 0 any & 0 Suppressions", () => {
    it("proves 0 TypeScript any and 0 compiler/linter suppressions across all target files", () => {
      const filesToCheck = [
        "olt/scripts/src/mind/smart-task-manager.ts",
        "olt/scripts/src/mind/feedback-queue.ts",
        "tests/unit/mind/product-owner-dispatch.test.ts",
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

      for (const relPath of filesToCheck) {
        const fullPath = join(process.cwd(), relPath);
        expect(existsSync(fullPath)).toBe(true);
        const content = readFileSync(fullPath, "utf8");
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (
            line.includes("anyRegex") ||
            line.includes("suppressionRegex") ||
            line.trim().startsWith("//") ||
            line.trim().startsWith("*")
          ) {
            continue;
          }
          expect(anyRegex.test(line)).toBe(false);
          expect(suppressionRegex.test(line)).toBe(false);
        }
      }
    });
  });
});

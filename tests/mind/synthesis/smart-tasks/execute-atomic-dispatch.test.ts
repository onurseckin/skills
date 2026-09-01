import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  executeAtomicDispatch,
  executeAtomicAdmissionToDispatch,
  executeProductOwnerAdmissionAndDispatch,
  type AtomicDispatchOptions,
} from "../../../../olt/scripts/src/mind/tasks/smart/index.ts";
import { executeAtomicDispatch as dispatchFromModule } from "../../../../olt/scripts/src/mind/tasks/smart/executor/dispatch.ts";
import { executeAtomicDispatch as dispatchFromExecutorBarrel } from "../../../../olt/scripts/src/mind/tasks/smart/executor/index.ts";
import { executeAtomicDispatch as dispatchFromTasksBarrel } from "../../../../olt/scripts/src/mind/tasks/index.ts";
import {
  ingestFeedbackItem,
  readFeedbackQueue,
} from "../../../../olt/scripts/src/mind/feedback/queue/index.ts";
import { readTaskQueue } from "../../../../olt/scripts/src/task/queue/index.ts";
import {
  setupAtomicDispatchTestSession,
  type AtomicDispatchTestSession,
} from "./atomic-dispatch-fixture.ts";

describe("Smart Tasks Execute Atomic Dispatch Test Suite", () => {
  let session: AtomicDispatchTestSession;

  beforeEach(() => {
    session = setupAtomicDispatchTestSession();
  });

  afterEach(() => {
    session.cleanup();
  });

  it("exports executeAtomicDispatch across canonical module and barrels", () => {
    expect(typeof executeAtomicDispatch).toBe("function");
    expect(typeof dispatchFromModule).toBe("function");
    expect(typeof dispatchFromExecutorBarrel).toBe("function");
    expect(typeof dispatchFromTasksBarrel).toBe("function");
    expect(executeAtomicDispatch).toBe(dispatchFromModule);
    expect(executeAtomicDispatch).toBe(dispatchFromExecutorBarrel);
    expect(executeAtomicDispatch).toBe(dispatchFromTasksBarrel);
  });

  it("handles empty feedback queue by returning empty arrays and valid invariant report", () => {
    const opts: AtomicDispatchOptions = {
      capsulesDir: session.feedbackFile,
      queuePath: session.taskQueueFile,
    };
    const result = executeAtomicDispatch(opts);
    expect(result.synthesized_tasks).toHaveLength(0);
    expect(result.enqueued_tasks).toHaveLength(0);
    expect(result.admitted_feedbacks).toHaveLength(0);
    expect(result.audit_report.zero_paused_admitted).toBe(true);
    expect(result.summary).toContain("No pending feedback items");
  });

  it("atomically admits and dispatches pending feedback items into task queue", () => {
    ingestFeedbackItem(
      {
        title: "Remediate missing export",
        content: "Export executeAtomicDispatch cleanly",
        priority: "CRITICAL_USER_FEEDBACK",
        category: "CORE_ENGINE",
      },
      session.feedbackFile,
    );
    ingestFeedbackItem(
      {
        title: "Harden validation rules",
        content: "Enforce anti-batching 1:1 isolation",
        priority: "HIGH_ARCHITECTURAL_FEATURE",
        category: "SCALING",
      },
      session.feedbackFile,
    );

    const result = executeAtomicDispatch({
      capsulesDir: session.feedbackFile,
      queuePath: session.taskQueueFile,
      charterGoals: ["G1", "G2"],
    });
    expect(result.synthesized_tasks).toHaveLength(2);
    expect(result.enqueued_tasks).toHaveLength(2);
    expect(result.admitted_feedbacks).toHaveLength(2);
    expect(result.audit_report.zero_paused_admitted).toBe(true);

    const enqueued = readTaskQueue(session.taskQueueFile);
    expect(enqueued).toHaveLength(2);

    const feedbacks = readFeedbackQueue(session.feedbackFile);
    expect(feedbacks.filter((f) => f.status === "ADMITTED")).toHaveLength(2);
    for (const fb of feedbacks) {
      expect(typeof fb.metadata?.["dispatched_task_id"]).toBe("string");
      expect(typeof fb.metadata?.["atomic_dispatched_at"]).toBe("string");
      expect(fb.metadata?.["feedback_dispatch_state"]).toBe("COMMITTED");
    }
  });

  it("honors maxTasks and stages tasks when orchestratorIds are provided", () => {
    for (let i = 1; i <= 5; i++) {
      ingestFeedbackItem(
        {
          title: `Task item ${i}`,
          content: `Description for task ${i}`,
          priority: "NORMAL",
          category: "CORE_ENGINE",
        },
        session.feedbackFile,
      );
    }

    const result = executeAtomicDispatch({
      capsulesDir: session.feedbackFile,
      queuePath: session.taskQueueFile,
      maxTasks: 3,
      orchestratorIds: ["orch-alpha", "orch-beta"],
    });
    expect(result.synthesized_tasks).toHaveLength(3);
    expect(result.enqueued_tasks).toHaveLength(3);
    expect(result.admitted_feedbacks).toHaveLength(3);
    expect(result.audit_report.zero_paused_admitted).toBe(true);

    for (const task of result.synthesized_tasks) {
      expect(task.assigned_tier).toBe("Tier_1_Orchestrator");
      expect(typeof task.metadata?.["assigned_orchestrator"]).toBe("string");
    }
  });

  it("accepts explicitly passed feedbackItems in options without reading file", () => {
    const customFeedbacks = [
      {
        id: "direct-fb-1",
        title: "Direct Feedback 1",
        content: "Content 1",
        priority: "CRITICAL_USER_FEEDBACK" as const,
        status: "PENDING" as const,
        category: "CORE_ENGINE" as const,
        timestamp: new Date().toISOString(),
        candidate_id: null,
      },
    ];
    const result = executeAtomicDispatch({
      capsulesDir: session.feedbackFile,
      queuePath: session.taskQueueFile,
      feedbackItems: customFeedbacks,
    });
    expect(result.synthesized_tasks).toHaveLength(1);
    expect(result.enqueued_tasks).toHaveLength(1);
    expect(result.enqueued_tasks[0]?.id).toBe(result.synthesized_tasks[0]?.id);
  });

  it("verifies equivalence with executeAtomicAdmissionToDispatch and executeProductOwnerAdmissionAndDispatch", () => {
    const queue1 = join(session.testRoot, ".olt", "capsules", "TQ1.jsonl");
    const queue2 = join(session.testRoot, ".olt", "capsules", "TQ2.jsonl");
    const queue3 = join(session.testRoot, ".olt", "capsules", "TQ3.jsonl");
    const directItem = [
      {
        id: "fb-equiv-1",
        title: "Equivalence Task",
        content: "Equivalence check",
        priority: "NORMAL" as const,
        status: "PENDING" as const,
        category: "GENERAL" as const,
        timestamp: new Date().toISOString(),
        candidate_id: null,
      },
    ];

    const res1 = executeAtomicDispatch({
      capsulesDir: session.feedbackFile,
      queuePath: queue1,
      feedbackItems: directItem,
    });
    const res2 = executeAtomicAdmissionToDispatch({
      capsulesDir: session.feedbackFile,
      queuePath: queue2,
      feedbackItems: directItem,
    });
    const res3 = executeProductOwnerAdmissionAndDispatch({
      capsulesDir: session.feedbackFile,
      queuePath: queue3,
      feedbackItems: directItem,
    });

    expect(res1.synthesized_tasks.length).toBe(res2.synthesized_tasks.length);
    expect(res1.synthesized_tasks.length).toBe(res3.synthesized_tasks.length);
    expect(res1.audit_report.zero_paused_admitted).toBe(true);
    expect(res2.audit_report.zero_paused_admitted).toBe(true);
    expect(res3.audit_report.zero_paused_admitted).toBe(true);
  });
});

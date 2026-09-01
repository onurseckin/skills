import { describe, expect, it, spyOn, afterEach } from "bun:test";
import {
  runInfiniteProductOwnerCycle,
  drainBacklogOnRunCompletion,
} from "../../../olt/scripts/src/mind/tasks/smart/executor/product-owner.ts";
import * as feedbackQueueModule from "../../../olt/scripts/src/mind/feedback/queue/index.ts";
import * as completedModule from "../../../olt/scripts/src/mind/archival/completed/index.ts";
import * as memoryModule from "../../../olt/scripts/src/mind/tasks/smart/planner/memory.ts";
import * as invariantsModule from "../../../olt/scripts/src/mind/tasks/smart/executor/invariants.ts";
import * as evolutionModule from "../../../olt/scripts/src/mind/tasks/smart/executor/evolution/index.ts";
import * as taskQueueModule from "../../../olt/scripts/src/task/queue/index.ts";
import * as dispatchModule from "../../../olt/scripts/src/mind/tasks/smart/executor/dispatch.ts";
import type { FeedbackItem } from "../../../olt/scripts/src/mind/feedback/queue/index.ts";
import type { TaskQueueItem } from "../../../olt/scripts/src/task/queue/index.ts";
import type {
  MultiOrchestratorPrePlanningResult,
  AdmissionToDispatchAuditReport,
  CognitiveMemoryDocument,
} from "../../../olt/scripts/src/mind/tasks/smart/planner/models.ts";

describe("Product Owner Executor Test Suite (in-memory virtualized)", () => {
  const spies: Array<{ mockRestore: () => void }> = [];
  afterEach(() => {
    while (spies.length > 0) spies.pop()?.mockRestore();
  });

  const mockAudit: AdmissionToDispatchAuditReport = {
    compliant: true,
    total_feedback: 1,
    pending_feedback: 1,
    admitted_feedback: 0,
    paused_admitted_feedback: 0,
    total_tasks: 0,
    active_tasks: 0,
    zero_paused_admitted: true,
    violations: [],
  };

  const mockPlan: MultiOrchestratorPrePlanningResult = {
    plan_id: "plan-1",
    orchestrator_count: 2,
    is_disjoint: true,
    cross_orchestrator_collisions: [],
    orchestrator_assignments: [
      { orchestrator_id: "orch-1", assigned_tasks: [], isolated_write_scope: [] },
    ],
    macro_metrics: {
      total_tasks: 1,
      total_write_files: 1,
      critical_path_depth: 1,
      concurrency_factor: 1,
    },
  };

  it("handles feedback_intake cycle with pending feedbacks and direct intake items", () => {
    const item: FeedbackItem = {
      id: "fb-1",
      timestamp: new Date().toISOString(),
      priority: "CRITICAL_USER_FEEDBACK",
      status: "PENDING",
      category: "CORE_ENGINE",
      title: "Boot fix",
      content: "Details",
    };
    spies.push(spyOn(feedbackQueueModule, "readFeedbackQueue").mockReturnValue([item]));
    spies.push(
      spyOn(invariantsModule, "verifyAdmissionToDispatchInvariants").mockReturnValue(mockAudit),
    );
    spies.push(
      spyOn(dispatchModule, "executeAtomicAdmissionToDispatch").mockReturnValue({
        synthesized_tasks: [
          {
            id: "task-1",
            label: "Boot fix",
            rationale: "Fix",
            priority: "CRITICAL_USER_FEEDBACK",
            write_scope: ["src/boot.ts"],
            gate: "GATE_1_PRE_FLIGHT",
            charter_goals: ["G1"],
            acceptance_criteria: ["Clean"],
            dependencies: [],
          },
        ],
        enqueued_tasks: [
          { id: "task-1", title: "Boot fix", status: "PENDING" } as unknown as TaskQueueItem,
        ],
        admitted_feedbacks: [item],
        audit_report: mockAudit,
        summary: "Admitted",
      }),
    );
    spies.push(
      spyOn(memoryModule, "updateCognitiveMemory").mockImplementation((fn) => {
        fn({} as CognitiveMemoryDocument);
      }),
    );

    const result = runInfiniteProductOwnerCycle({
      directIntakeItems: [
        {
          id: "d-1",
          title: "Direct",
          description: "Desc",
          priority: 1 as unknown as string,
          category: 2 as unknown as string,
          candidate_id: "c-1",
        },
        {
          id: "d-2",
          title: "Direct 2",
          description: "Desc 2",
          priority: "USER_DIRECTIVE",
          category: "CORE_ENGINE",
        },
      ],
      maxTasks: 5,
    });
    expect(result.mode).toBe("feedback_intake");
    expect(result.decisions.length).toBe(3);
    expect(result.synthesized_tasks.length).toBe(1);
    expect(result.enqueued_tasks.length).toBe(1);
    expect(result.zero_paused_admitted_guaranteed).toBe(true);
  });

  it("handles multi_orchestrator_dispatch mode and autoEnqueue false in feedback intake", () => {
    const item: FeedbackItem = {
      id: "fb-m",
      timestamp: new Date().toISOString(),
      priority: "NORMAL",
      status: "PENDING",
      category: "CORE_ENGINE",
      title: "Multi",
      content: "Task",
    };
    spies.push(spyOn(feedbackQueueModule, "readFeedbackQueue").mockReturnValue([item]));
    spies.push(
      spyOn(invariantsModule, "verifyAdmissionToDispatchInvariants").mockReturnValue(mockAudit),
    );
    spies.push(
      spyOn(invariantsModule, "stageTasksForMultiOrchestratorExecution").mockReturnValue({
        staged_tasks: [
          {
            id: "t-orch",
            label: "Staged",
            rationale: "R",
            write_scope: ["a.ts"],
            gate: "GATE_1_PRE_FLIGHT",
            charter_goals: [],
            acceptance_criteria: [],
            dependencies: [],
          },
        ],
        plan: mockPlan,
      }),
    );
    spies.push(
      spyOn(memoryModule, "updateCognitiveMemory").mockImplementation((fn) => {
        fn({} as CognitiveMemoryDocument);
      }),
    );

    const result = runInfiniteProductOwnerCycle({
      orchestratorCount: 2,
      orchestratorIds: ["orch-1", "orch-2"],
      autoEnqueue: false,
    });
    expect(result.mode).toBe("multi_orchestrator_dispatch");
    expect(result.multi_orchestrator_plan).toBeDefined();
    expect(result.enqueued_tasks.length).toBe(0);
  });

  it("handles self_evolution mode with multi-orchestrator staging when queue is clear", () => {
    spies.push(spyOn(feedbackQueueModule, "readFeedbackQueue").mockReturnValue([]));
    spies.push(
      spyOn(taskQueueModule, "readTaskQueue").mockReturnValue([
        { id: "old-1", status: "COMPLETED" } as unknown as TaskQueueItem,
      ]),
    );
    spies.push(
      spyOn(evolutionModule, "synthesizeSmartTasksFromSelfEvolution").mockReturnValue({
        tasks: [
          {
            id: "evol-1",
            label: "Evol",
            rationale: "R",
            write_scope: ["src/e.ts"],
            gate: "GATE_2_CONCURRENCY",
            charter_goals: ["G2"],
            acceptance_criteria: ["P"],
            dependencies: [],
          },
        ],
        auditReport: {
          step1_baseline_hygiene: true,
          step2_ux_quality_audit: true,
          step3_autonomous_ideation: true,
          zero_any_clean: true,
          zero_suppressions_clean: true,
          all_files_under_300_lines: true,
        },
      }),
    );
    spies.push(
      spyOn(invariantsModule, "stageTasksForMultiOrchestratorExecution").mockReturnValue({
        staged_tasks: [
          {
            id: "evol-1",
            label: "Evol",
            rationale: "R",
            write_scope: ["src/e.ts"],
            gate: "GATE_2_CONCURRENCY",
            charter_goals: ["G2"],
            acceptance_criteria: ["P"],
            dependencies: [],
          },
        ],
        plan: mockPlan,
      }),
    );
    spies.push(
      spyOn(invariantsModule, "verifyAdmissionToDispatchInvariants").mockReturnValue(mockAudit),
    );
    spies.push(
      spyOn(memoryModule, "updateCognitiveMemory").mockImplementation((fn) => {
        fn({} as CognitiveMemoryDocument);
      }),
    );

    const result = runInfiniteProductOwnerCycle({
      orchestratorCount: 2,
      orchestratorIds: ["o1", "o2"],
    });
    expect(result.mode).toBe("self_evolution");
    expect(result.decisions.length).toBe(1);
    expect(result.decisions[0]?.assigned_task_id).toBe("evol-1");
    expect(result.multi_orchestrator_plan).toBeDefined();
  });

  it("handles idle_monitored mode when active tasks exist in queue and ignores memory error", () => {
    spies.push(spyOn(feedbackQueueModule, "readFeedbackQueue").mockReturnValue([]));
    spies.push(
      spyOn(taskQueueModule, "readTaskQueue").mockReturnValue([
        { id: "a-1", status: "IN_PROGRESS" } as unknown as TaskQueueItem,
      ]),
    );
    spies.push(
      spyOn(invariantsModule, "verifyAdmissionToDispatchInvariants").mockReturnValue(mockAudit),
    );
    spies.push(
      spyOn(memoryModule, "updateCognitiveMemory").mockImplementation(() => {
        throw new Error("memory fail");
      }),
    );

    const result = runInfiniteProductOwnerCycle();
    expect(result.mode).toBe("idle_monitored");
    expect(result.decisions.length).toBe(0);
    expect(result.synthesized_tasks.length).toBe(0);
  });

  describe("drainBacklogOnRunCompletion", () => {
    it("returns zero counts when backlog is empty", () => {
      spies.push(spyOn(feedbackQueueModule, "readFeedbackQueue").mockReturnValue([]));
      const res = drainBacklogOnRunCompletion({});
      expect(res.drainedCount).toBe(0);
      expect(res.remainingBacklogCount).toBe(0);
      expect(res.archivedRecords.length).toBe(0);
    });

    it("drains completed, processed, declined, and explicit candidate IDs", () => {
      const items: FeedbackItem[] = [
        {
          id: "fb-1",
          timestamp: "2026-08-20T00:00:00.000Z",
          priority: "NORMAL",
          status: "DECLINED",
          category: "CORE_ENGINE",
          title: "Declined",
          content: "C1",
          resolution_note: "Declined note",
          processed_at: "2026-08-20T01:00:00.000Z",
          candidate_id: "cand-1",
          commit_sha: "abc1234",
          test_path: "tests/a.test.ts",
          assertions: 5,
          runtime_ms: 120,
          resolution: { task_id: "t-1", resolved_at: "2026-08-20T01:00:00.000Z" },
          metadata: { note: "sample" },
        },
        {
          id: "fb-2",
          timestamp: "2026-08-20T00:00:00.000Z",
          priority: "HIGH_ARCHITECTURAL_FEATURE",
          status: "COMPLETED",
          category: "ARCHITECTURE",
          title: "Completed",
          content: "C2",
          resolution: {
            task_id: "t-2",
            resolved_at: "2026-08-20T02:00:00.000Z",
            proof_summary: "Proof",
            commit_sha: "def",
            test_path: "tests/b.ts",
            assertions: 10,
            runtime_ms: 250,
          },
        },
        {
          id: "fb-3",
          timestamp: "2026-08-20T00:00:00.000Z",
          priority: "USER_DIRECTIVE",
          status: "PROCESSED",
          category: "DOCUMENTATION",
          title: "Processed",
          content: "C3",
        },
        {
          id: "fb-4",
          timestamp: "2026-08-20T00:00:00.000Z",
          priority: "NORMAL",
          status: "PENDING",
          category: "GENERAL",
          title: "Pending completed",
          content: "C4",
        },
        {
          id: "fb-5",
          timestamp: "2026-08-20T00:00:00.000Z",
          priority: "NORMAL",
          status: "PENDING",
          category: "GENERAL",
          title: "Pending untouched",
          content: "C5",
        },
        {
          id: "fb-6",
          timestamp: "2026-08-20T00:00:00.000Z",
          priority: "NORMAL",
          status: "PENDING",
          category: "GENERAL",
          title: "Pending cand match",
          content: "C6",
          candidate_id: "cand-6",
        },
      ];

      let readCount = 0;
      spies.push(
        spyOn(feedbackQueueModule, "readFeedbackQueue").mockImplementation(() => {
          readCount++;
          return readCount === 1 ? items : [items[4]!];
        }),
      );
      spies.push(spyOn(completedModule, "recordCompletedTasksBatch").mockImplementation(() => []));
      spies.push(
        spyOn(feedbackQueueModule, "updateOrPruneFeedbackItems").mockImplementation((fn) => {
          fn(items[0]!);
          fn(items[4]!);
          return [];
        }),
      );

      const res = drainBacklogOnRunCompletion({
        repoRoot: "/virtual/repo",
        completedTasks: ["fb-4", "cand-6"],
        runId: "run-99",
        commitSha: "sha-global",
        testPath: "tests/global.test.ts",
      });

      expect(res.drainedCount).toBe(5);
      expect(res.remainingBacklogCount).toBe(1);
      expect(res.archivedRecords.length).toBe(5);
      expect(res.archivedRecords[0]?.status).toBe("RESOLVED");
      expect(res.archivedRecords[1]?.status).toBe("COMPLETED");
      expect(res.archivedRecords[2]?.proof_summary).toBe("Completed under run run-99");
    });

    it("handles backlog with items where none are eligible to drain", () => {
      const items: FeedbackItem[] = [
        {
          id: "fb-stay-1",
          timestamp: "2026-08-20T00:00:00.000Z",
          priority: "NORMAL",
          status: "PENDING",
          category: "CORE_ENGINE",
          title: "Stay",
          content: "K",
        },
      ];
      spies.push(spyOn(feedbackQueueModule, "readFeedbackQueue").mockReturnValue(items));
      const recordSpy = spyOn(completedModule, "recordCompletedTasksBatch");
      spies.push(recordSpy);

      const res = drainBacklogOnRunCompletion({});
      expect(res.drainedCount).toBe(0);
      expect(res.remainingBacklogCount).toBe(1);
      expect(recordSpy).not.toHaveBeenCalled();
    });
  });
});

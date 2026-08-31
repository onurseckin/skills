import { describe, expect, it } from "bun:test";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import {
  DEFAULT_LEASE_DURATION_MS,
  DEFAULT_LEASE_DURATION_SECONDS,
  DEFAULT_MAX_RETRIES,
  DEFAULT_TASK_QUEUE_FILE,
  PRIORITY_WEIGHTS,
  TASK_PRIORITIES,
  TASK_QUEUE_STATUSES,
  deserializeTaskQueueItem,
  resolveCanonicalTaskQueuePath,
  resolveTaskQueuePath,
  validateSourceType,
  type CompletionReceipts,
  type NewTaskQueueInput,
  type TaskLease,
  type TaskPriority,
  type TaskQueueItem,
  type TaskQueueStatus,
  type TaskQueueFilterOptions,
  type TaskQueueStats,
  type TaskSourceType,
} from "../../../../olt/scripts/src/task/queue/types.ts";

describe("Task Queue Types & Schema Validation", () => {
  it("defines standard task statuses and priorities", () => {
    expect(TASK_QUEUE_STATUSES).toEqual([
      "PENDING",
      "ADMITTED",
      "IN_PROGRESS",
      "RUNNING",
      "VALIDATING",
      "COMPLETED",
      "FAILED",
      "BLOCKED",
      "ESCALATED",
    ]);

    expect(TASK_PRIORITIES).toEqual(["CRITICAL", "HIGH", "MEDIUM", "LOW", "BACKGROUND"]);

    expect(PRIORITY_WEIGHTS.CRITICAL).toBe(100);
    expect(PRIORITY_WEIGHTS.HIGH).toBe(75);
    expect(PRIORITY_WEIGHTS.MEDIUM).toBe(50);
    expect(PRIORITY_WEIGHTS.LOW).toBe(25);
    expect(PRIORITY_WEIGHTS.BACKGROUND).toBe(10);
  });

  it("validates and falls back source types", () => {
    expect(validateSourceType("external_intake")).toBe("external_intake");
    expect(validateSourceType("feedback_intake")).toBe("feedback_intake");
    expect(validateSourceType("self_evolution")).toBe("self_evolution");
    expect(validateSourceType("defect_remediation")).toBe("defect_remediation");
    expect(validateSourceType("direct_prompt")).toBe("direct_prompt");
    expect(validateSourceType("plan_enhancement")).toBe("plan_enhancement");
    expect(validateSourceType("unknown_source")).toBe("self_evolution");
    expect(validateSourceType(null)).toBe("self_evolution");
    expect(validateSourceType(123)).toBe("self_evolution");
  });

  it("resolves default task queue paths and constants", () => {
    expect(DEFAULT_TASK_QUEUE_FILE).toBe(".olt/tasks.jsonl");
    expect(DEFAULT_LEASE_DURATION_MS).toBe(300_000);
    expect(DEFAULT_LEASE_DURATION_SECONDS).toBe(1800);
    expect(DEFAULT_MAX_RETRIES).toBe(3);

    const defaultResolved = resolveTaskQueuePath();
    expect(defaultResolved.endsWith(".olt/tasks.jsonl")).toBe(true);

    const customResolved = resolveTaskQueuePath("/tmp/custom-tasks.jsonl");
    expect(customResolved).toBe("/tmp/custom-tasks.jsonl");

    expect(resolveCanonicalTaskQueuePath("/tmp/custom.jsonl")).toBe("/tmp/custom.jsonl");
  });

  it("deserializes valid task item records correctly", () => {
    const raw: Record<string, unknown> = {
      id: "task-101",
      title: "Implement feature",
      description: "Feature details",
      priority: "HIGH",
      status: "PENDING",
      write_scope: ["src/feature.ts"],
      gate: "bun test",
      charter_goals: ["goal-1"],
      acceptance_criteria: ["crit-1"],
      dependencies: [],
      blocked_by: [],
      source_type: "external_intake",
      retry_count: 0,
      max_retries: 3,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const item = deserializeTaskQueueItem(raw);
    expect(item.id).toBe("task-101");
    expect(item.title).toBe("Implement feature");
    expect(item.priority).toBe("HIGH");
    expect(item.status).toBe("PENDING");
    expect(item.write_scope).toEqual(["src/feature.ts"]);
    expect(item.source_type).toBe("external_intake");
    expect(item.lease).toBeUndefined();
  });

  it("deserializes task item with active lease", () => {
    const raw: Record<string, unknown> = {
      id: "task-102",
      title: "Leased task",
      priority: "CRITICAL",
      status: "IN_PROGRESS",
      write_scope: ["src/leased.ts"],
      gate: "bun test",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      lease: {
        agent_id: "worker-1",
        token: "token-abc-123",
        leased_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        attempt: 1,
        lease_duration_seconds: 60,
      },
    };

    const item = deserializeTaskQueueItem(raw);
    expect(item.lease).toBeDefined();
    expect(item.lease?.agent_id).toBe("worker-1");
    expect(item.lease?.token).toBe("token-abc-123");
    expect(item.lease?.attempt).toBe(1);
    expect(item.lease?.lease_duration_seconds).toBe(60);
  });

  it("throws HarnessError on invalid task queue record structures", () => {
    expect(() => deserializeTaskQueueItem({} as Record<string, unknown>)).toThrow(HarnessError);
    expect(() => deserializeTaskQueueItem({ id: "", status: "PENDING" })).toThrow(HarnessError);
    expect(() =>
      deserializeTaskQueueItem({
        id: "task-1",
        status: "INVALID_STATUS",
        write_scope: ["a"],
      }),
    ).toThrow(HarnessError);
    expect(() =>
      deserializeTaskQueueItem({
        id: "task-1",
        status: "PENDING",
        priority: "INVALID_PRIORITY",
        write_scope: ["a"],
      }),
    ).toThrow(HarnessError);
    expect(() =>
      deserializeTaskQueueItem({
        id: "task-1",
        status: "PENDING",
        write_scope: "not-an-array",
      }),
    ).toThrow(HarnessError);
    expect(() =>
      deserializeTaskQueueItem({
        id: "task-1",
        status: "PENDING",
        write_scope: ["valid"],
        lease: { agent_id: "" },
      }),
    ).toThrow(HarnessError);
  });

  it("supports type-level shape verification for filter options and stats", () => {
    const stats: TaskQueueStats = {
      total: 10,
      pending: 3,
      admitted: 1,
      in_progress: 2,
      running: 0,
      validating: 1,
      completed: 2,
      failed: 1,
      blocked: 0,
      escalated: 0,
      active_leases: 3,
      expired_leases: 0,
    };
    expect(stats.total).toBe(10);
    expect(stats.active_leases).toBe(3);

    const filter: TaskQueueFilterOptions = {
      status: "PENDING",
      priority: "HIGH",
      limit: 5,
      agentId: "worker-1",
      search: "feature",
    };
    expect(filter.status).toBe("PENDING");
    expect(filter.priority).toBe("HIGH");
  });

  it("supports type-level shape verification for receipts and input", () => {
    const receipts: CompletionReceipts = {
      exit_code: 0,
      cognitive_verdict: "PASS",
      proof_summary: "All 10 unit tests pass",
      test_path: "tests/unit/feature.test.ts",
      assertions: 25,
      runtime_ms: 150,
      commit_sha: "abc1234",
    };
    expect(receipts.exit_code).toBe(0);
    expect(receipts.cognitive_verdict).toBe("PASS");

    const input: NewTaskQueueInput = {
      id: "task-new",
      title: "New feature",
      write_scope: ["src/new.ts"],
      gate: "bun test",
    };
    expect(input.id).toBe("task-new");
    expect(input.write_scope).toEqual(["src/new.ts"]);
  });
});

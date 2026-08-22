import { describe, expect, it } from "bun:test";
import type { HarnessEvent } from "../../../orchestrating-long-tasks/scripts/src/contracts/capsule.ts";
import {
  buildDynamicDagState,
  buildLivingTracerReport,
  buildStepTraceEntries,
  computeStepTracerSummary,
  renderAsciiTimeline,
  type LivingTracerOptions,
} from "../../../orchestrating-long-tasks/scripts/src/reporting/living-tracer.ts";
import { executeDagTraceCommand } from "../../../orchestrating-long-tasks/scripts/src/cli/commands/dag.ts";

function createMockEvent(
  sequence: number,
  kind: string,
  actor: string,
  payload: Record<string, unknown> = {},
  timestampOffsetMs = 0,
): HarnessEvent {
  const baseTime = new Date("2026-08-22T00:00:00.000Z").getTime();
  const timestamp = new Date(baseTime + timestampOffsetMs).toISOString();

  return {
    schema: "harness.event",
    version: 1,
    run_id: "test-run-123",
    capsule_id: "capsule-456",
    sequence,
    revision: 1,
    timestamp,
    actor,
    kind,
    payload,
    previous_hash: null,
    projection: null,
    hash: `hash_${sequence}`,
  };
}

describe("Living Dynamic DAG Expansion & Step Tracer (p27)", () => {
  describe("Dynamic DAG Expansion Engine", () => {
    it("tracks task creation, state transitions, and dynamic expansions", () => {
      const events: HarnessEvent[] = [
        createMockEvent(1, "task-created", "coordinator-1", {
          task_id: "task-1",
          label: "Base Task",
          write_scope: ["src/base"],
          dependencies: [],
        }),
        createMockEvent(2, "task-claimed", "impl-1", {
          task_id: "task-1",
          role: "implementer",
          lease_seconds: 1200,
        }),
        createMockEvent(3, "task-submitted", "impl-1", {
          task_id: "task-1",
          summary: "Base task completed",
        }),
        createMockEvent(4, "task-reviewed", "val-1", {
          task_id: "task-1",
          verdict: "passed",
        }),
        createMockEvent(5, "smart-task:plan", "coordinator-1", {
          task_id: "dyn-task-2",
          label: "Dynamic Subtask",
          dependencies: ["task-1"],
        }),
      ];

      const state = buildDynamicDagState(events, "test-run-123");
      expect(state.totalTasks).toBe(2);
      expect(state.staticTasksCount).toBe(0);
      expect(state.dynamicTasksCount).toBe(2);

      const task1 = state.tasks.get("task-1");
      expect(task1).toBeDefined();
      expect(task1?.status).toBe("satisfied");
      expect(task1?.assignedAgent).toBe("impl-1");

      const dynTask2 = state.tasks.get("dyn-task-2");
      expect(dynTask2).toBeDefined();
      expect(dynTask2?.status).toBe("ready");
      expect(dynTask2?.origin).toBe("dynamic_expansion");
      expect(dynTask2?.dependencies).toEqual(["task-1"]);

      expect(state.activeAgents.has("impl-1")).toBeTrue();
      expect(state.activeAgents.get("impl-1")?.role).toBe("implementer");
    });

    it("tracks dynamic branch lifecycle", () => {
      const events: HarnessEvent[] = [
        createMockEvent(1, "branch-opened", "coordinator-1", {
          branch_id: "branch-feature-x",
        }),
        createMockEvent(2, "task-created", "coordinator-1", {
          task_id: "branch-task-1",
          branch_id: "branch-feature-x",
        }),
        createMockEvent(3, "branch-collected", "coordinator-1", {
          branch_id: "branch-feature-x",
        }),
      ];

      const state = buildDynamicDagState(events, "test-run-123");
      expect(state.activeBranches.length).toBe(0);
      const bTask = state.tasks.get("branch-task-1");
      expect(bTask?.origin).toBe("branch");
      expect(bTask?.branchId).toBe("branch-feature-x");
    });
  });

  describe("Real-Time Step Tracer & Timeline", () => {
    it("parses events into chronological step trace entries with appropriate glyphs", () => {
      const events: HarnessEvent[] = [
        createMockEvent(1, "task-claimed", "impl-1", { task_id: "task-1", role: "implementer" }, 0),
        createMockEvent(2, "tool-exec", "impl-1", { task_id: "task-1", tool: "write_file", command: "write file.ts" }, 5000),
        createMockEvent(3, "gate:prove", "impl-1", { task_id: "task-1", command: "bun test", exit_code: 0 }, 12000),
        createMockEvent(4, "task-submitted", "impl-1", { task_id: "task-1", summary: "Ready for review" }, 15000),
        createMockEvent(5, "task-reviewed", "val-1", { task_id: "task-1", verdict: "passed" }, 20000),
      ];

      const steps = buildStepTraceEntries(events);
      expect(steps.length).toBe(5);

      expect(steps[0]!.glyph).toBe("🟢");
      expect(steps[0]!.title).toContain("TASK-CLAIMED");
      expect(steps[0]!.taskId).toBe("task-1");

      expect(steps[1]!.glyph).toBe("⚙️");
      expect(steps[1]!.tool).toBe("write_file");

      expect(steps[2]!.isGate).toBeTrue();
      expect(steps[2]!.glyph).toBe("🛡️✓");

      expect(steps[3]!.glyph).toBe("📦");
      expect(steps[4]!.glyph).toBe("✓");

      const timeline = renderAsciiTimeline(steps);
      expect(timeline).toContain("● [#001 +00:00.00] [impl-1] 🟢 TASK-CLAIMED (task-1)");
      expect(timeline).toContain("├─● [#003 +00:12.00] [impl-1] 🛡️✓ GATE:PROVE (task-1)");
      expect(timeline).toContain("└─● [#005 +00:20.00] [val-1] ✓ TASK-REVIEWED (task-1)");
    });

    it("handles error states, gate rejections, and failure glyphs", () => {
      const events: HarnessEvent[] = [
        createMockEvent(1, "gate:prove", "impl-1", { task_id: "task-1", command: "bun test", exit_code: 1 }, 0),
        createMockEvent(2, "task-rejected", "val-1", { task_id: "task-1", reason: "Lint errors found" }, 5000),
      ];

      const steps = buildStepTraceEntries(events);
      expect(steps[0]!.isGate).toBeTrue();
      expect(steps[0]!.isError).toBeTrue();
      expect(steps[0]!.glyph).toBe("🛡️❌");

      expect(steps[1]!.isError).toBeTrue();
      expect(steps[1]!.glyph).toBe("❌");
      expect(steps[1]!.details).toContain("Reason: Lint errors found");
    });

    it("filters step trace entries by task, actor, and kind", () => {
      const events: HarnessEvent[] = [
        createMockEvent(1, "task-claimed", "impl-1", { task_id: "task-1" }),
        createMockEvent(2, "task-claimed", "impl-2", { task_id: "task-2" }),
        createMockEvent(3, "gate:prove", "impl-1", { task_id: "task-1" }),
      ];

      const task1Steps = buildStepTraceEntries(events, { filterTask: "task-1" });
      expect(task1Steps.length).toBe(2);

      const actor2Steps = buildStepTraceEntries(events, { filterActor: "impl-2" });
      expect(actor2Steps.length).toBe(1);

      const gateSteps = buildStepTraceEntries(events, { filterKind: "gate:prove" });
      expect(gateSteps.length).toBe(1);
    });
  });

  describe("Summary Metrics & Full Report", () => {
    it("computes summary statistics and formats full report", () => {
      const events: HarnessEvent[] = [
        createMockEvent(1, "task-created", "coordinator-1", { task_id: "task-1" }, 0),
        createMockEvent(2, "gate:prove", "impl-1", { task_id: "task-1", exit_code: 0 }, 10000),
        createMockEvent(3, "gate:prove", "impl-1", { task_id: "task-1", exit_code: 1 }, 20000),
      ];

      const report = buildLivingTracerReport(events, { runId: "test-telemetry" });
      expect(report.summary.totalSteps).toBe(3);
      expect(report.summary.uniqueActors).toEqual(expect.arrayContaining(["coordinator-1", "impl-1"]));
      expect(report.summary.gateRunsCount).toBe(2);
      expect(report.summary.gatePassesCount).toBe(1);
      expect(report.summary.gateFailsCount).toBe(1);
      expect(report.summary.errorCount).toBe(1);

      expect(report.markdown).toContain("Real-Time Telemetry & Dynamic Step Tracer: test-telemetry");
      expect(report.markdown).toContain("Chronological Step Execution Timeline");
      expect(report.asciiTimeline).toContain("GATE:PROVE");
    });

    it("renders empty timeline gracefully", () => {
      const timeline = renderAsciiTimeline([]);
      expect(timeline).toContain("No telemetry events recorded");
    });
  });
});

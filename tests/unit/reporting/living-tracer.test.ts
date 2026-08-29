import { describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { HarnessEvent } from "../../../olt/scripts/src/core/contracts/index.ts";
import {
  buildDynamicDagState,
  buildLivingTracerReport,
  buildStepTraceEntries,
  computeStepTracerSummary,
  renderAsciiTimeline,
  renderDynamicDagAscii,
  inspectCapsuleAuxiliary,
  traceCapsuleRun,
  type LivingTracerOptions,
} from "../../../olt/scripts/src/reporting/living-tracer.ts";
import { executeDagTraceCommand } from "../../../olt/scripts/src/cli/commands/dag.ts";

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

describe("Living Dynamic DAG Expansion & Real-Time Step Tracer (p27 & defect-20260822-18)", () => {
  describe("Dynamic DAG Expansion & Rejection Branch Sprouting", () => {
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
      expect(task1?.executionState).toBe("[✓ PASSED - R1]");

      const dynTask2 = state.tasks.get("dyn-task-2");
      expect(dynTask2).toBeDefined();
      expect(dynTask2?.status).toBe("proposed");
      expect(dynTask2?.origin).toBe("dynamic_expansion");
      expect(dynTask2?.dependencies).toEqual(["task-1"]);

      expect(state.activeAgents.has("impl-1")).toBeTrue();
      expect(state.activeAgents.get("impl-1")?.role).toBe("implementer");
    });

    it("sprouts Round 2 Repair Implementer and Validator branch on Round 1 validator rejection", () => {
      const events: HarnessEvent[] = [
        createMockEvent(1, "task-created", "coordinator-1", {
          task_id: "task-1",
          label: "Auth Implementation",
          write_scope: ["src/auth"],
          dependencies: [],
        }),
        createMockEvent(2, "task-claimed", "impl-1", {
          task_id: "task-1",
          role: "implementer",
        }),
        createMockEvent(3, "tool-exec", "impl-1", {
          task_id: "task-1",
          tool: "write_file",
          command: "write src/auth/token.ts",
        }),
        createMockEvent(4, "task-submitted", "impl-1", {
          task_id: "task-1",
          summary: "Initial auth token implementation ready",
        }),
        createMockEvent(5, "begin-validation", "val-1", {
          task_id: "task-1",
        }),
        createMockEvent(6, "task-rejected", "val-1", {
          task_id: "task-1",
          reason: "Missing token expiration validation and unit tests",
          verdict: "reject",
        }),
      ];

      const state = buildDynamicDagState(events, "test-run-repair-sprout");
      expect(state.repairBranchesCount).toBe(2); // 1 repair task + 1 validator task
      expect(state.currentRound).toBe(2);

      // Verify Round 1 node is marked as rejected
      const task1 = state.tasks.get("task-1");
      expect(task1).toBeDefined();
      expect(task1?.status).toBe("changes_requested");
      expect(task1?.executionState).toBe("[❌ REJECTED - R1]");
      expect(task1?.rejectionReason).toContain("Missing token expiration");
      expect(task1?.sproutedChildren).toEqual(["task-1-repair-r2", "val-task-1-r2"]);

      // Verify Round 2 Repair Implementer was dynamically sprouted
      const repairTask = state.tasks.get("task-1-repair-r2");
      expect(repairTask).toBeDefined();
      expect(repairTask?.label).toBe("Auth Implementation (R2 Repair)");
      expect(repairTask?.role).toBe("repairer");
      expect(repairTask?.round).toBe(2);
      expect(repairTask?.origin).toBe("repair_branch");
      expect(repairTask?.status).toBe("ready");
      expect(repairTask?.executionState).toBe("[⏳ READY - R2 Repair]");
      expect(repairTask?.dependencies).toEqual(["task-1"]);

      // Verify Round 2 Validator was dynamically sprouted
      const valTask = state.tasks.get("val-task-1-r2");
      expect(valTask).toBeDefined();
      expect(valTask?.label).toBe("Validator for Auth Implementation (R2)");
      expect(valTask?.role).toBe("validator");
      expect(valTask?.round).toBe(2);
      expect(valTask?.origin).toBe("repair_branch");
      expect(valTask?.status).toBe("proposed");
      expect(valTask?.executionState).toBe("[⏳ PROPOSED - R2 Validator]");
      expect(valTask?.dependencies).toEqual(["task-1-repair-r2"]);

      // Verify sprouted repair pair record
      expect(state.sproutedRepairPairs.length).toBe(1);
      expect(state.sproutedRepairPairs[0]!.rejectedTaskId).toBe("task-1");
      expect(state.sproutedRepairPairs[0]!.round).toBe(2);
      expect(state.sproutedRepairPairs[0]!.repairTaskId).toBe("task-1-repair-r2");
      expect(state.sproutedRepairPairs[0]!.validatorTaskId).toBe("val-task-1-r2");

      // Verify ASCII DAG renders the sprouted branch
      const asciiDag = renderDynamicDagAscii(state);
      expect(asciiDag).toContain("[task-1] [❌ REJECTED - R1]");
      expect(asciiDag).toContain("├──► [task-1-repair-r2] [⏳ READY - R2 Repair]");
      expect(asciiDag).toContain("└──► [val-task-1-r2] [⏳ PROPOSED - R2 Validator]");
    });

    it("tracks subsequent repair execution in Round 2 through to successful resolution", () => {
      const events: HarnessEvent[] = [
        createMockEvent(1, "task-created", "coordinator-1", {
          task_id: "task-1",
          label: "Core Module",
        }),
        createMockEvent(2, "task-claimed", "impl-1", { task_id: "task-1" }),
        createMockEvent(3, "task-rejected", "val-1", {
          task_id: "task-1",
          reason: "Coverage test failure",
        }),
        // Round 2 events
        createMockEvent(4, "task-claimed", "impl-1", {
          task_id: "task-1-repair-r2",
          role: "repairer",
        }),
        createMockEvent(5, "tool-exec", "impl-1", {
          task_id: "task-1-repair-r2",
          tool: "run_command",
          command: "bun test tests/unit/auth.test.ts",
        }),
        createMockEvent(6, "gate:prove", "impl-1", {
          task_id: "task-1-repair-r2",
          command: "bun test tests/unit/auth.test.ts",
          exit_code: 0,
        }),
        createMockEvent(7, "task-submitted", "impl-1", { task_id: "task-1-repair-r2" }),
        createMockEvent(8, "task-reviewed", "val-1", {
          task_id: "task-1-repair-r2",
          verdict: "passed",
        }),
      ];

      const state = buildDynamicDagState(events, "test-run-round2-success");
      const repairTask = state.tasks.get("task-1-repair-r2");
      expect(repairTask).toBeDefined();
      expect(repairTask?.status).toBe("satisfied");
      expect(repairTask?.executionState).toBe("[✓ PASSED - R2]");

      const parentTask = state.tasks.get("task-1");
      expect(parentTask?.executionState).toBe("[✓ RESOLVED - R2]");
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

    it("handles replacement repairer assignment events", () => {
      const events: HarnessEvent[] = [
        createMockEvent(1, "task-created", "coordinator-1", {
          task_id: "task-1",
          label: "Task With Repair",
        }),
        createMockEvent(2, "task-rejected", "val-1", { task_id: "task-1", reason: "Flaky test" }),
        createMockEvent(3, "replacement-repairer-assigned", "coordinator-1", {
          task_id: "task-1-repair-r2",
          replacement_id: "impl-2",
          reason: "stale",
          evidence: "Original implementer unresponsive",
        }),
      ];

      const state = buildDynamicDagState(events, "test-replacement");
      const repairTask = state.tasks.get("task-1-repair-r2");
      expect(repairTask?.assignedAgent).toBe("impl-2");
      expect(repairTask?.executionState).toContain("REPAIRER ASSIGNED: impl-2");
    });
  });

  describe("Real-Time Step Tracer & Timeline", () => {
    it("parses events into chronological step trace entries with appropriate glyphs and live tool states", () => {
      const events: HarnessEvent[] = [
        createMockEvent(1, "task-claimed", "impl-1", { task_id: "task-1", role: "implementer" }, 0),
        createMockEvent(
          2,
          "tool-exec",
          "impl-1",
          { task_id: "task-1", tool: "write_file", command: "write file.ts" },
          5000,
        ),
        createMockEvent(
          3,
          "gate:prove",
          "impl-1",
          { task_id: "task-1", command: "bun test", exit_code: 0 },
          12000,
        ),
        createMockEvent(
          4,
          "task-submitted",
          "impl-1",
          { task_id: "task-1", summary: "Ready for review" },
          15000,
        ),
        createMockEvent(
          5,
          "task-reviewed",
          "val-1",
          { task_id: "task-1", verdict: "passed" },
          20000,
        ),
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

    it("displays live active tool in progress state on running nodes", () => {
      const events: HarnessEvent[] = [
        createMockEvent(1, "task-created", "coordinator-1", { task_id: "task-1", label: "Task 1" }),
        createMockEvent(2, "task-claimed", "impl-1", { task_id: "task-1" }),
        createMockEvent(3, "tool-exec", "impl-1", {
          task_id: "task-1",
          tool: "run_command",
          command: "bun test tests/unit/reporting/living-tracer.test.ts",
        }),
      ];

      const state = buildDynamicDagState(events, "test-active-tool");
      const task1 = state.tasks.get("task-1");
      expect(task1?.executionState).toBe(
        "[🟢 RUNNING: bun test tests/unit/reporting/living-tracer.test.ts]",
      );
      expect(task1?.activeTool).toBe("run_command");
      expect(task1?.activeCommand).toBe("bun test tests/unit/reporting/living-tracer.test.ts");
      expect(task1?.activeStepIndex).toBe(3);

      const agent = state.activeAgents.get("impl-1");
      expect(agent?.currentCommand).toBe("bun test tests/unit/reporting/living-tracer.test.ts");
      expect(agent?.activeStepIndex).toBe(3);
    });

    it("handles error states, gate rejections, and failure glyphs", () => {
      const events: HarnessEvent[] = [
        createMockEvent(
          1,
          "gate:prove",
          "impl-1",
          { task_id: "task-1", command: "bun test", exit_code: 1 },
          0,
        ),
        createMockEvent(
          2,
          "task-rejected",
          "val-1",
          { task_id: "task-1", reason: "Lint errors found" },
          5000,
        ),
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

  describe("Auxiliary Capsule Artifact Inspection", () => {
    it("inspects auxiliary rounds/ and leases/ directories when present", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "capsule-aux-test-"));
      try {
        mkdirSync(join(tempDir, "rounds", "round-1"), { recursive: true });
        mkdirSync(join(tempDir, "rounds", "round-2"), { recursive: true });
        mkdirSync(join(tempDir, "leases"), { recursive: true });
        writeFileSync(join(tempDir, "leases", "task-1.json"), JSON.stringify({ agent: "impl-1" }));

        const aux = inspectCapsuleAuxiliary(tempDir);
        expect(aux.roundsFound).toContain("round-1");
        expect(aux.roundsFound).toContain("round-2");
        expect(aux.activeLeaseFiles).toContain("task-1.json");
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe("Summary Metrics & Full Report", () => {
    it("computes summary statistics and formats full report with DAG and timeline", () => {
      const events: HarnessEvent[] = [
        createMockEvent(1, "task-created", "coordinator-1", { task_id: "task-1" }, 0),
        createMockEvent(2, "gate:prove", "impl-1", { task_id: "task-1", exit_code: 0 }, 10000),
        createMockEvent(3, "gate:prove", "impl-1", { task_id: "task-1", exit_code: 1 }, 20000),
      ];

      const report = buildLivingTracerReport(events, { runId: "test-telemetry" });
      expect(report.summary.totalSteps).toBe(3);
      expect(report.summary.uniqueActors).toEqual(
        expect.arrayContaining(["coordinator-1", "impl-1"]),
      );
      expect(report.summary.gateRunsCount).toBe(2);
      expect(report.summary.gatePassesCount).toBe(1);
      expect(report.summary.gateFailsCount).toBe(1);
      expect(report.summary.errorCount).toBe(1);

      expect(report.markdown).toContain(
        "Living Dynamic DAG Expansion & Real-Time Telemetry: test-telemetry",
      );
      expect(report.markdown).toContain("Chronological Step Execution Timeline");
      expect(report.markdown).toContain("Living Dynamic Round-by-Round DAG & Node States");
      expect(report.asciiTimeline).toContain("GATE:PROVE");
      expect(report.asciiDag).toContain("[task-1]");
    });

    it("renders empty timeline and DAG gracefully", () => {
      const timeline = renderAsciiTimeline([]);
      expect(timeline).toContain("No telemetry events recorded");

      const dag = renderDynamicDagAscii({
        runId: "empty",
        revision: 1,
        totalTasks: 0,
        staticTasksCount: 0,
        dynamicTasksCount: 0,
        repairBranchesCount: 0,
        currentRound: 1,
        tasks: new Map(),
        activeAgents: new Map(),
        activeBranches: [],
        sproutedRepairPairs: [],
      });
      expect(dag).toContain("No dynamic DAG tasks discovered");
    });

    it("traceCapsuleRun reads capsule files and produces full living tracer report", () => {
      const tempDir = join(tmpdir(), `harness-tracer-capsule-${Date.now()}`);
      mkdirSync(tempDir, { recursive: true });
      const events = [
        createMockEvent(1, "task-created", "coord-1", { task_id: "t-1", label: "Task 1" }),
        createMockEvent(2, "task-claimed", "impl-1", { task_id: "t-1", role: "implementer" }),
        createMockEvent(3, "task-released", "impl-1", { task_id: "t-1" }),
        createMockEvent(4, "branch-opened", "coord-1", { branch_id: "b-1" }),
        createMockEvent(5, "replacement-repairer-assigned", "coord-1", {
          task_id: "t-1",
          replacement_id: "rep-2",
        }),
        createMockEvent(6, "task-rejected", "val-1", {
          task_id: "t-1",
          reason: "Fails tests",
          round: 1,
        }),
      ];

      writeFileSync(
        join(tempDir, "events.jsonl"),
        events.map((e) => JSON.stringify(e)).join("\n") + "\n",
        "utf8",
      );

      try {
        const report = traceCapsuleRun(tempDir);
        expect(report.summary.totalSteps).toBe(6);
        expect(report.dynamicDag.tasks.has("t-1")).toBe(true);
        expect(report.markdown).toContain("Dynamically Sprouted Repair & Validator Branches");
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("renders dynamic DAG with expanded subtasks and coordinates", () => {
      const tasks = new Map();
      tasks.set("parent-task", {
        id: "parent-task",
        label: "Parent Task",
        status: "leased",
        role: "implementer",
        assignedAgent: "impl-1",
        validatorId: "val-1",
        coordinates: { wave: 1, lane: 2 },
        probeRound: 1,
        writeScope: ["src/file.ts"],
        rejectionReason: "Test failure",
        activeCommand: "bun test",
        dependencies: [],
        origin: "static",
        createdAtSeq: 1,
        updatedAtSeq: 2,
        round: 1,
        attempt: 1,
        executionState: "[🟢 RUNNING]",
        activeTool: "write_to_file",
        activeStepIndex: 2,
        sproutedChildren: ["child-task"],
        expandedSubtasks: [
          { id: "sub-1", status: "ready", role: "implementer", assignedAgent: "sub-impl" },
          { id: "sub-2", status: "validated", role: "validator", validatorId: "sub-val" },
        ],
      });

      tasks.set("child-task", {
        id: "child-task",
        label: "Child Task",
        status: "ready",
        dependencies: [],
        writeScope: [],
        assignedAgent: null,
        origin: "repair_branch",
        createdAtSeq: 3,
        updatedAtSeq: 3,
        round: 2,
        attempt: 1,
        executionState: "[⏳ READY]",
        activeTool: null,
        activeCommand: "git commit",
        activeStepIndex: 3,
        sproutedChildren: [],
        rejectionReason: "Child rejected",
      });

      const activeAgents = new Map();
      activeAgents.set("impl-1", {
        agentId: "impl-1",
        role: "implementer",
        taskId: "parent-task",
        activeStepIndex: 2,
        currentTool: "write_to_file",
        currentCommand: "bun test",
      });

      const dagAscii = renderDynamicDagAscii({
        runId: "expanded-run",
        revision: 1,
        totalTasks: 2,
        staticTasksCount: 1,
        dynamicTasksCount: 1,
        repairBranchesCount: 1,
        currentRound: 2,
        tasks,
        activeAgents,
        activeBranches: [],
        sproutedRepairPairs: [
          {
            rejectedTaskId: "parent-task",
            round: 1,
            repairTaskId: "child-task",
            validatorTaskId: "val-task",
            reason: "assertion failed",
          },
        ],
      });

      expect(dagAscii).toContain("parent-task");
      expect(dagAscii).toContain("sub-1");
      expect(dagAscii).toContain("child-task");
      expect(dagAscii).toContain("↳ Coordinates: [W1:L2]");
      expect(dagAscii).toContain("↳ Probe Round: P1");
    });
  });
});

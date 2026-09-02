import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildLivingTracerReport,
  renderDynamicDagAscii,
  traceCapsuleRun,
} from "../../../olt/scripts/src/reporting/living-tracer/render.ts";
import type {
  DynamicDagState,
  DynamicTaskState,
} from "../../../olt/scripts/src/reporting/living-tracer/types.ts";
import type { HarnessEvent } from "../../../olt/scripts/src/core/contracts/index.ts";

describe("living-tracer render coverage", () => {
  describe("renderDynamicDagAscii", () => {
    it("renders fallback message box when dynamic DAG tasks map is empty", () => {
      const emptyState: DynamicDagState = {
        runId: "run-0",
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
      };
      const rendered = renderDynamicDagAscii(emptyState);
      expect(rendered).toContain("(No dynamic DAG tasks discovered in telemetry events)");
    });

    it("renders complete hierarchy with coordinates, probe rounds, expanded subtasks, and sprouted children", () => {
      const rootTask: DynamicTaskState = {
        id: "task-root",
        label: "Root Task",
        status: "running",
        origin: "static",
        dependencies: [],
        writeScope: ["src/a.ts", "src/b.ts"],
        assignedAgent: "agent-alpha",
        validatorId: "val-omega",
        role: "implementer",
        createdAtSeq: 1,
        updatedAtSeq: 5,
        round: 1,
        attempt: 1,
        executionState: "RUNNING",
        activeStepIndex: 4,
        activeCommand: "bun test",
        probeRound: 2,
        rejectionReason: "Initial validation failed",
        coordinates: { wave: 1, lane: 1, rank: 0, order: 0 },
        expandedSubtasks: [
          { id: "sub-1", status: "completed", role: "implementer", assignedAgent: "agent-sub" },
          { id: "sub-2", status: "ready", role: "validator", validatorId: "val-sub" },
        ],
        sproutedChildren: ["task-sprouted"],
      };

      const sproutedTask: DynamicTaskState = {
        id: "task-sprouted",
        label: "Sprouted Repair",
        status: "leased",
        origin: "repair_branch",
        dependencies: ["task-root"],
        writeScope: [],
        assignedAgent: "agent-beta",
        createdAtSeq: 6,
        updatedAtSeq: 8,
        round: 2,
        attempt: 1,
        executionState: "LEASED",
        activeCommand: "git diff",
        rejectionReason: "Secondary defect",
      };

      const standaloneTask: DynamicTaskState = {
        id: "task-standalone",
        label: "Standalone Validator",
        status: "validating",
        origin: "static",
        dependencies: [],
        writeScope: [],
        validatorId: "val-solo",
        createdAtSeq: 9,
        updatedAtSeq: 10,
        round: 1,
        attempt: 1,
        executionState: "VALIDATING",
      };

      const tasksMap = new Map<string, DynamicTaskState>([
        ["task-root", rootTask],
        ["task-sprouted", sproutedTask],
        ["task-standalone", standaloneTask],
      ]);

      const dagState: DynamicDagState = {
        runId: "run-full",
        revision: 2,
        totalTasks: 3,
        staticTasksCount: 2,
        dynamicTasksCount: 1,
        repairBranchesCount: 1,
        currentRound: 2,
        tasks: tasksMap,
        activeAgents: new Map(),
        activeBranches: [],
        sproutedRepairPairs: [],
      };

      const rendered = renderDynamicDagAscii(dagState);
      expect(rendered).toContain("[task-root]");
      expect(rendered).toContain("agent-alpha ──► VALIDATOR: val-omega");
      expect(rendered).toContain("↳ Coordinates:");
      expect(rendered).toContain("↳ Probe Round: P2 (🔍 PROBING)");
      expect(rendered).toContain("↳ Scope: src/a.ts, src/b.ts");
      expect(rendered).toContain("↳ Rejection: Initial validation failed");
      expect(rendered).toContain("↳ Active Cmd: bun test");
      expect(rendered).toContain("[sub-1]");
      expect(rendered).toContain("[sub-2]");
      expect(rendered).toContain("[task-sprouted]");
      expect(rendered).toContain("[task-standalone]");
      expect(rendered).toContain("● VALIDATOR: val-solo");
    });
  });

  describe("buildLivingTracerReport and traceCapsuleRun", () => {
    it("generates full markdown report with sprouted repair table and active agents registry", () => {
      const events: HarnessEvent[] = [
        {
          sequence: 1,
          timestamp: "2026-09-01T20:00:00.000Z",
          actor: "mind-lead",
          kind: "run_initialized",
          payload: { run_id: "test-run" },
        },
        {
          sequence: 2,
          timestamp: "2026-09-01T20:00:01.000Z",
          actor: "orch-1",
          kind: "task_declared",
          payload: { task_id: "task-alpha", label: "Alpha" },
        },
        {
          sequence: 3,
          timestamp: "2026-09-01T20:00:02.000Z",
          actor: "impl-1",
          kind: "agent_tool_invoked",
          payload: { tool: "write_to_file", task_id: "task-alpha" },
        },
        {
          sequence: 4,
          timestamp: "2026-09-01T20:00:03.000Z",
          actor: "orch-1",
          kind: "task_rejected",
          payload: {
            task_id: "task-alpha",
            reason: "assertion failed",
            repair_task_id: "task-repair",
            validator_task_id: "task-val",
            round: 1,
          },
        },
        {
          sequence: 5,
          timestamp: "2026-09-01T20:00:04.000Z",
          actor: "val-1",
          kind: "gate_passed",
          payload: { gate: "final-validation" },
        },
      ];

      const report = buildLivingTracerReport(events, { runId: "test-run", maxSteps: 50 });
      expect(report.markdown).toContain(
        "### Living Dynamic DAG Expansion & Real-Time Telemetry: test-run",
      );
      expect(report.markdown).toContain("Dynamically Sprouted Repair & Validator Branches");
      expect(report.markdown).toContain("Active Agent Live Tool & Lease Registry");
      expect(report.markdown).toContain("Chronological Step Execution Timeline");
      expect(report.steps.length).toBeGreaterThan(0);
      expect(report.summary.totalSteps).toBe(5);
    });

    it("traces capsule run from disk directory", () => {
      const tempDir = join(tmpdir(), `test-living-tracer-run-${Date.now()}`);
      mkdirSync(tempDir, { recursive: true });
      try {
        const eventsPath = join(tempDir, "events.jsonl");
        const manifestPath = join(tempDir, "manifest.json");

        writeFileSync(manifestPath, JSON.stringify({ run_id: "disk-run-123" }));
        const ev1 = JSON.stringify({
          sequence: 1,
          timestamp: "2026-09-01T20:00:00.000Z",
          actor: "root",
          kind: "run_initialized",
          payload: {},
        });
        writeFileSync(eventsPath, `${ev1}\n`);

        const report = traceCapsuleRun(tempDir);
        expect(report.summary.totalSteps).toBe(1);
        expect(report.markdown).toContain("disk-run-123");
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });
});

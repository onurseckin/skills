import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  rebalanceTasksWithBrentLimits,
  integrateMacroMetricsIntoMemory,
  rebalanceTaskQueueWithBrentLimits,
} from "../../../olt/scripts/src/mind/tasks/smart/planner/rebalance.ts";
import { MindConcurrentLookaheadPipeline } from "../../../olt/scripts/src/mind/tasks/lookahead/index.ts";
import {
  parseNowMs,
  findLiveRunRoots,
} from "../../../olt/scripts/src/mind/lanes/rescue/helpers.ts";
import { executeRung1 } from "../../../olt/scripts/src/mind/lanes/rescue/rungs/rung1.ts";
import { initRun, transact } from "../../../olt/scripts/src/engine/store/index.ts";
import { writeAgentLedger } from "../../../olt/scripts/src/workflow/agents/ledger.ts";
import { systemClock } from "../../../olt/scripts/src/workflow/types.ts";
import type { SmartTaskPlan } from "../../../olt/scripts/src/mind/tasks/smart/planner/models.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {}
  }
  roots.length = 0;
});

describe("Tasks and Lanes - Exhaustive Unit Tests", () => {
  describe("Brent Limits & Task Rebalancing", () => {
    it("rebalances tasks with empty inputs, decoupled disjoint dependencies, and memory updates", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "task-rebalance-test-"));
      roots.push(tmpDir);
      const memoryPath = join(tmpDir, "cognitive-memory.json");

      // Empty tasks array
      const emptyRes = rebalanceTasksWithBrentLimits([], {
        autoUpdateMemory: true,
        cognitiveMemoryPath: memoryPath,
      });
      expect(emptyRes.total_tasks).toBe(0);
      expect(emptyRes.total_waves).toBe(0);

      // Tasks with decoupled dependencies (disjoint write scopes)
      const tasks: SmartTaskPlan[] = [
        {
          id: "t-1",
          tier: 3,
          dependencies: [],
          write_scope: ["src/a.ts"],
          rationale: "independent task",
          status: "ready",
          estimated_effort: 1,
          cognitive_profile: "implementer",
        },
        {
          id: "t-2",
          tier: 3,
          dependencies: ["t-1", "t-unknown"], // t-1 has disjoint scope and no justification; t-unknown is unknown
          write_scope: ["src/b.ts"],
          rationale: "another independent task",
          status: "ready",
          estimated_effort: 1,
          cognitive_profile: "implementer",
        },
        {
          id: "t-3",
          tier: 3,
          dependencies: ["t-1"],
          write_scope: ["src/c.ts"],
          rationale: "dataflow artifact dependency", // justified
          status: "ready",
          estimated_effort: 1,
          cognitive_profile: "implementer",
        },
      ];

      const rebalanced = rebalanceTasksWithBrentLimits(tasks, {
        autoUpdateMemory: true,
        cognitiveMemoryPath: memoryPath,
        preserveJustified: true,
      });
      expect(rebalanced.total_tasks).toBe(3);
      expect(rebalanced.decoupled_edges_count).toBe(1); // t-2 -> t-1 was decoupled
      expect(rebalanced.warnings.length).toBeGreaterThan(0);

      // integrateMacroMetricsIntoMemory
      const memState = integrateMacroMetricsIntoMemory(tasks, {
        cognitiveMemoryPath: memoryPath,
      });
      expect(memState.macro_metrics.parallelism).toBeGreaterThan(0);

      // rebalanceTaskQueueWithBrentLimits with mock queue
      const queuePath = join(tmpDir, "tasks.jsonl");
      writeFileSync(
        queuePath,
        JSON.stringify({
          id: "q-1",
          title: "Task 1",
          status: "PENDING",
          priority: "MEDIUM",
          dependencies: [],
          write_scope: ["src"],
        }) + "\n",
      );

      const qRes = rebalanceTaskQueueWithBrentLimits({
        queuePath,
        cognitiveMemoryPath: memoryPath,
      });
      expect(qRes.updated_tasks.length).toBe(1);
    });
  });

  describe("Lookahead Horizon & Rescue Helpers", () => {
    it("computes lookahead directives across concurrency limits, discovery triggers, and convergence waits", () => {
      // 1. Both 0 -> TRIGGER_MODE_A_DISCOVERY
      const d1 = MindConcurrentLookaheadPipeline.computeNextActions({
        activeRunCount: 0,
        defectCount: 0,
        concurrencyLimit: 2,
      });
      expect(d1.action).toBe("TRIGGER_MODE_A_DISCOVERY");
      expect(d1.allowConcurrentPlanning).toBe(false);

      // 2. activeRunCount >= limit -> AWAIT_CONVERGENCE
      const d2 = MindConcurrentLookaheadPipeline.computeNextActions({
        activeRunCount: 2,
        defectCount: 5,
        concurrencyLimit: 2,
      });
      expect(d2.action).toBe("AWAIT_CONVERGENCE");
      expect(d2.allowConcurrentPlanning).toBe(false);

      // 3. activeRunCount < limit && defectCount > 0 -> PRE_PLAN_NEXT_CAPSULE
      const d3 = MindConcurrentLookaheadPipeline.computeNextActions({
        activeRunCount: 1,
        defectCount: 3,
        concurrencyLimit: 2,
      });
      expect(d3.action).toBe("PRE_PLAN_NEXT_CAPSULE");
      expect(d3.allowConcurrentPlanning).toBe(true);

      // 4. Default fallback: activeRunCount > 0 && defectCount === 0 -> AWAIT_CONVERGENCE
      const d4 = MindConcurrentLookaheadPipeline.computeNextActions({
        activeRunCount: 1,
        defectCount: 0,
        concurrencyLimit: 2,
      });
      expect(d4.action).toBe("AWAIT_CONVERGENCE");
      expect(d4.allowConcurrentPlanning).toBe(false);
    });

    it("parses diverse nowMs formats and discovers live run roots", () => {
      const now = Date.now();
      expect(parseNowMs(now)).toBe(now);
      expect(parseNowMs(new Date(now))).toBe(now);
      expect(parseNowMs(new Date(now).toISOString())).toBe(now);
      expect(typeof parseNowMs("invalid")).toBe("number");
      expect(typeof parseNowMs()).toBe("number");

      const tmpDir = mkdtempSync(join(tmpdir(), "rescue-helpers-test-"));
      roots.push(tmpDir);

      // Nonexistent capsules dir
      expect(findLiveRunRoots("/nonexistent/dir", "mind-run")).toEqual([]);

      // Create valid child runs
      const childRun1 = initRun(tmpDir, "child-run-1", Buffer.from("charter"), "file", true);
      roots.push(childRun1);

      const childRun2 = initRun(tmpDir, "child-run-2", Buffer.from("charter"), "file", true);
      roots.push(childRun2);

      // Mark childRun2 complete
      transact(childRun2, "owner", "complete", {}, (state) => {
        state.completion_result = { status: "complete" } as any;
      });

      const capsulesDir = join(tmpDir, ".olt", "capsules");
      const liveRoots = findLiveRunRoots(capsulesDir, "mind-run");
      expect(liveRoots.length).toBe(1);
      expect(liveRoots[0]).toContain("child-run-1");
    });

    it("executes Rung 1 supervision ticks across live runs handling coordinators and escalations", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "rung1-test-"));
      roots.push(tmpDir);

      const runWithCoordinator = initRun(tmpDir, "run-coord", Buffer.from("charter"), "file", true);
      roots.push(runWithCoordinator);
      transact(runWithCoordinator, "owner", "add-agent", {}, (state) => {
        writeAgentLedger(state, [
          {
            id: "coord-1",
            role: "coordinator",
            parent_agent_id: null,
            parent_task_id: null,
            host: "local",
            granted_at: new Date().toISOString(),
            status: "active",
          },
        ]);
      });

      const runWithoutCoordinator = initRun(
        tmpDir,
        "run-no-coord",
        Buffer.from("charter"),
        "file",
        true,
      );
      roots.push(runWithoutCoordinator);
      transact(runWithoutCoordinator, "owner", "init-tasks", {}, (state) => {
        writeAgentLedger(state, [
          {
            id: "owner",
            role: "mind",
            parent_agent_id: null,
            parent_task_id: null,
            host: "local",
            granted_at: new Date().toISOString(),
            status: "active",
          },
        ]);
        state.tasks = {};
      });

      const actionsTaken: string[] = [];
      const res = executeRung1({
        liveRunRoots: [runWithCoordinator, runWithoutCoordinator],
        actor: "owner",
        graceSeconds: 10,
        clock: systemClock,
        actionsTaken,
      });

      expect(res.liveRunsChecked).toBe(2);
      expect(res.skippedDueToActiveCoordinator.length).toBe(1);
      expect(res.supervisionTicksRun).toBe(1);
    });
  });
});

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assessTaskStraggler,
  checkActiveTaskStragglers,
  evaluateActiveTasks,
  type MonitoredTask,
} from "../../../olt/scripts/src/watchdog/straggler-watchdog.ts";
import {
  cleanupVirtualWatchdogFS,
  scratchRoot,
  setupVirtualWatchdogFS,
} from "../watchdog-fixture.ts";

beforeEach(() => {
  setupVirtualWatchdogFS();
});

afterEach(() => {
  cleanupVirtualWatchdogFS();
});

describe("StragglerWatchdog Remediation & Defect Emission", () => {
  it("recommends RECLAIM_LEASE for dead or abandoned straggler tasks", () => {
    const now = 1700000500000;
    const taskDead: MonitoredTask = {
      id: "task-dead-1",
      agent_id: "agent-dead",
      status: "RUNNING",
      claimed_at: now - 350_000,
      last_progress: now - 200_000,
      is_dead: true,
    };
    const taskAbandoned: MonitoredTask = {
      id: "task-aband-1",
      agent_id: "agent-aband",
      status: "LEASED",
      claimed_at: now - 350_000,
      last_progress: now - 200_000,
      is_abandoned: true,
    };

    const resDead = assessTaskStraggler(taskDead, now);
    expect(resDead.is_straggler).toBe(true);
    expect(resDead.recommended_action).toBe("RECLAIM_LEASE");

    const resAband = assessTaskStraggler(taskAbandoned, now);
    expect(resAband.is_straggler).toBe(true);
    expect(resAband.recommended_action).toBe("RECLAIM_LEASE");
  });

  it("recommends DECOMPOSE_PARALLEL and generates Brent concurrency plan for overloaded tasks", () => {
    const now = 1700000500000;
    const taskOverburdened: MonitoredTask = {
      id: "task-heavy",
      agent_id: "agent-busy",
      status: "RUNNING",
      claimed_at: now - 350_000,
      last_progress: now - 200_000,
      scope_files: ["file1.ts", "file2.ts", "file3.ts", "file4.ts"],
      work_units: 4,
      span_length: 2,
    };

    const res = assessTaskStraggler(taskOverburdened, now, {
      minParallelism: 2,
      maxParallelism: 4,
    });
    expect(res.is_straggler).toBe(true);
    expect(res.recommended_action).toBe("DECOMPOSE_PARALLEL");
    expect(res.decomposition_plan).not.toBeUndefined();
    expect(res.decomposition_plan?.optimal_parallelism).toBeGreaterThanOrEqual(2);
    expect(res.decomposition_plan?.sub_partitions.length).toBeGreaterThan(0);
    expect(res.decomposition_plan?.sub_partitions[0]?.subtask_id).toContain("task-heavy");
  });

  it("evaluates active task lists and writes defects atomically to defects file", () => {
    const root = scratchRoot(import.meta.path, "straggler-defects");
    const defectsFile = join(root, "defects.jsonl");
    const now = 1700000500000;

    const tasks: MonitoredTask[] = [
      {
        id: "task-ok",
        status: "RUNNING",
        claimed_at: now - 50_000,
      },
      {
        id: "task-straggler",
        agent_id: "agent-slow",
        status: "RUNNING",
        claimed_at: now - 400_000,
        last_progress: now - 250_000,
      },
    ];

    const report = evaluateActiveTasks(tasks, now, {
      recordDefects: true,
      defectsFilePath: defectsFile,
    });

    expect(report.evaluated_count).toBe(2);
    expect(report.healthy_count).toBe(1);
    expect(report.straggler_count).toBe(1);
    expect(report.defects_emitted.length).toBe(1);
    expect(report.defects_emitted[0]?.error_code).toBe("TASK_STRAGGLER_OVERBURDEN_DEFECT");

    expect(existsSync(defectsFile)).toBe(true);
    const content = readFileSync(defectsFile, "utf-8");
    expect(content).toContain("task-straggler");
    expect(content).toContain("TASK_STRAGGLER_OVERBURDEN_DEFECT");

    const report2 = checkActiveTaskStragglers(tasks, now);
    expect(report2.evaluated_count).toBe(2);
  });
});

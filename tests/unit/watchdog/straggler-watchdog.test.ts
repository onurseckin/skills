import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assessTaskStraggler,
  evaluateActiveTasks,
  STRAGGLER_SLA_SECONDS,
  TASK_STRAGGLER_OVERBURDEN_DEFECT,
  type MonitoredTask,
} from "../../../olt/scripts/src/watchdog/straggler-watchdog.ts";

describe("Autonomic 5-Minute Straggler SLA Watchdog (Task 2.1)", () => {
  const baseTime = 1756460000000; // Fixed timestamp ms

  it("identifies healthy tasks within 5-minute boundary (< 300s)", () => {
    const task: MonitoredTask = {
      id: "task-normal-1",
      agent_id: "agent-1",
      status: "RUNNING",
      claimed_at: baseTime - 120_000, // 2 minutes ago
      scope_files: ["src/file1.ts", "src/file2.ts"],
    };

    const assessment = assessTaskStraggler(task, baseTime);
    expect(assessment.is_straggler).toBe(false);
    expect(assessment.elapsed_seconds).toBe(120);
    expect(assessment.recommended_action).toBe("CONTINUE");
    expect(assessment.decomposition_plan).toBeUndefined();
  });

  it("flags straggler tasks exceeding 300s and generates Brent concurrency plan", () => {
    const task: MonitoredTask = {
      id: "task-straggler-1",
      agent_id: "agent-2",
      status: "RUNNING",
      claimed_at: baseTime - 350_000, // 350s ago (> 300s SLA)
      scope_files: [
        "src/a.ts",
        "src/b.ts",
        "src/c.ts",
        "src/d.ts",
        "src/e.ts",
        "src/f.ts",
        "src/g.ts",
        "src/h.ts",
        "src/i.ts",
        "src/j.ts",
      ],
      work_units: 10,
      span_length: 1,
    };

    const assessment = assessTaskStraggler(task, baseTime);
    expect(assessment.is_straggler).toBe(true);
    expect(assessment.elapsed_seconds).toBe(350);
    expect(assessment.recommended_action).toBe("DECOMPOSE_PARALLEL");
    expect(assessment.decomposition_plan).toBeDefined();

    const plan = assessment.decomposition_plan!;
    expect(plan.optimal_parallelism).toBeGreaterThanOrEqual(5);
    expect(plan.optimal_parallelism).toBeLessThanOrEqual(15);
    expect(plan.sub_partitions.length).toBe(plan.optimal_parallelism);

    // Verify disjoint partition scopes
    const allFiles = plan.sub_partitions.flatMap((p) => p.assigned_scope);
    const uniqueFiles = new Set(allFiles);
    expect(allFiles.length).toBe(task.scope_files!.length);
    expect(uniqueFiles.size).toBe(task.scope_files!.length);
  });

  it("recommends RECLAIM_LEASE for dead or abandoned straggling tasks", () => {
    const deadTask: MonitoredTask = {
      id: "task-dead-1",
      agent_id: "agent-3",
      status: "LEASED",
      claimed_at: baseTime - 600_000, // 10 minutes ago
      is_dead: true,
    };

    const assessment = assessTaskStraggler(deadTask, baseTime);
    expect(assessment.is_straggler).toBe(true);
    expect(assessment.recommended_action).toBe("RECLAIM_LEASE");
  });

  it("evaluates a batch of active tasks and records defects when configured", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "straggler-watchdog-test-"));
    try {
      const defectsFile = join(tempDir, "defects.jsonl");

      const tasks: readonly MonitoredTask[] = [
        {
          id: "task-1",
          agent_id: "agent-1",
          status: "RUNNING",
          claimed_at: baseTime - 100_000,
        },
        {
          id: "task-2",
          agent_id: "agent-2",
          status: "RUNNING",
          claimed_at: baseTime - 400_000, // Straggler
          work_units: 8,
        },
        {
          id: "task-3",
          agent_id: "agent-3",
          status: "COMPLETED", // Not active
          claimed_at: baseTime - 500_000,
        },
      ];

      const report = evaluateActiveTasks(tasks, baseTime, {
        recordDefects: true,
        defectsFilePath: defectsFile,
      });

      expect(report.evaluated_count).toBe(3);
      expect(report.straggler_count).toBe(1);
      expect(report.healthy_count).toBe(2);
      expect(report.defects_emitted.length).toBe(1);
      expect(report.defects_emitted[0].error_code).toBe(TASK_STRAGGLER_OVERBURDEN_DEFECT);

      expect(existsSync(defectsFile)).toBe(true);
      const fileContent = readFileSync(defectsFile, "utf-8");
      expect(fileContent).toContain(TASK_STRAGGLER_OVERBURDEN_DEFECT);
      expect(fileContent).toContain("task-2");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

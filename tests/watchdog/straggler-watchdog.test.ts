import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assessTaskStraggler,
  assessTaskStragglerStatus,
  checkActiveTaskStragglers,
  evaluateActiveTasks,
  PROGRESS_SILENCE_THRESHOLD_SECONDS,
  STRAGGLER_SLA_SECONDS,
  TASK_STRAGGLER_OVERBURDEN_DEFECT,
  type MonitoredTask,
  type StragglerAssessment,
  type StragglerWatchdogReport,
} from "../../olt/scripts/src/watchdog/straggler-watchdog.ts";

describe("Autonomic 5-Minute Straggler SLA Watchdog (Task 1.1)", () => {
  const baseTime = 1756460000000; // Fixed timestamp ms

  it("identifies healthy tasks within 5-minute boundary (< 300s)", () => {
    const task: MonitoredTask = {
      id: "task-normal-1",
      agent_id: "agent-1",
      status: "RUNNING",
      claimed_at: baseTime - 120_000, // 2 minutes ago
      scope_files: ["src/file1.ts", "src/file2.ts"],
    };

    const assessment: StragglerAssessment = assessTaskStraggler(task, baseTime);
    expect(assessment.is_straggler).toBe(false);
    expect(assessment.elapsed_seconds).toBe(120);
    expect(assessment.recommended_action).toBe("CONTINUE");
    expect(assessment.decomposition_plan).toBeUndefined();

    // Verify assessTaskStragglerStatus parity
    const aliasAssessment = assessTaskStragglerStatus(task, baseTime);
    expect(aliasAssessment).toEqual(assessment);
  });

  it("does not flag active tasks exceeding 300s if recent progress within 120s (resolves hb-s7-coordinator-diagnosed-live-agent-as-dead)", () => {
    // Case 1: last_progress as numeric timestamp (40s ago, total elapsed 400s)
    const taskWithProgressNumber: MonitoredTask = {
      id: "task-live-1",
      agent_id: "agent-live-1",
      status: "RUNNING",
      claimed_at: baseTime - 400_000, // Claimed 400s ago (> 300s SLA)
      last_progress: baseTime - 40_000, // Progress 40s ago (<= 120s silence)
      scope_files: ["src/heavy1.ts", "src/heavy2.ts"],
    };

    const assessmentNumber = assessTaskStraggler(taskWithProgressNumber, baseTime);
    expect(assessmentNumber.is_straggler).toBe(false);
    expect(assessmentNumber.elapsed_seconds).toBe(400);
    expect(assessmentNumber.recommended_action).toBe("CONTINUE");
    expect(assessmentNumber.decomposition_plan).toBeUndefined();

    // Case 2: last_progress_at as ISO string (100s ago, total elapsed 600s)
    const taskWithProgressIso: MonitoredTask = {
      id: "task-live-2",
      agent_id: "agent-live-2",
      status: "LEASED",
      claimed_at: new Date(baseTime - 600_000).toISOString(),
      last_progress_at: new Date(baseTime - 100_000).toISOString(),
    };

    const assessmentIso = assessTaskStragglerStatus(taskWithProgressIso, baseTime);
    expect(assessmentIso.is_straggler).toBe(false);
    expect(assessmentIso.elapsed_seconds).toBe(600);
    expect(assessmentIso.recommended_action).toBe("CONTINUE");
  });

  it("flags straggler tasks exceeding 300s when silence > 120s and generates Brent concurrency plan", () => {
    // Case 1: No last_progress provided (silence = elapsed = 350s > 120s)
    const taskWithoutProgress: MonitoredTask = {
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

    const assessment = assessTaskStraggler(taskWithoutProgress, baseTime);
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
    expect(allFiles.length).toBe(taskWithoutProgress.scope_files!.length);
    expect(uniqueFiles.size).toBe(taskWithoutProgress.scope_files!.length);

    // Case 2: Explicit last_progress > 120s ago (last progress 150s ago, total elapsed 500s)
    const taskStaleProgress: MonitoredTask = {
      id: "task-straggler-stale",
      agent_id: "agent-stale",
      status: "IN_PROGRESS",
      claimed_at: baseTime - 500_000,
      last_progress: baseTime - 150_000,
    };

    const staleAssessment = assessTaskStraggler(taskStaleProgress, baseTime);
    expect(staleAssessment.is_straggler).toBe(true);
    expect(staleAssessment.recommended_action).toBe("DECOMPOSE_PARALLEL");
  });

  it("recommends RECLAIM_LEASE for dead or abandoned straggling tasks", () => {
    const deadTask: MonitoredTask = {
      id: "task-dead-1",
      agent_id: "agent-3",
      status: "LEASED",
      claimed_at: baseTime - 600_000, // 10 minutes ago
      is_dead: true,
    };

    const deadAssessment = assessTaskStraggler(deadTask, baseTime);
    expect(deadAssessment.is_straggler).toBe(true);
    expect(deadAssessment.recommended_action).toBe("RECLAIM_LEASE");
    expect(deadAssessment.decomposition_plan).toBeUndefined();

    const abandonedTask: MonitoredTask = {
      id: "task-abandoned-1",
      agent_id: "agent-4",
      status: "RUNNING",
      claimed_at: baseTime - 500_000,
      is_abandoned: true,
    };

    const abandonedAssessment = assessTaskStraggler(abandonedTask, baseTime);
    expect(abandonedAssessment.is_straggler).toBe(true);
    expect(abandonedAssessment.recommended_action).toBe("RECLAIM_LEASE");
  });

  it("treats non-active tasks (PENDING, COMPLETED, FAILED) as healthy", () => {
    const statuses = ["PENDING", "COMPLETED", "FAILED"] as const;
    for (const status of statuses) {
      const task: MonitoredTask = {
        id: `task-${status.toLowerCase()}`,
        status,
        claimed_at: baseTime - 800_000,
      };
      const assessment = assessTaskStraggler(task, baseTime);
      expect(assessment.is_straggler).toBe(false);
      expect(assessment.recommended_action).toBe("CONTINUE");
    }
  });

  it("evaluates a batch of active tasks with checkActiveTaskStragglers and evaluateActiveTasks", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "straggler-watchdog-test-"));
    try {
      const defectsFile = join(tempDir, "defects.jsonl");

      const tasks: readonly MonitoredTask[] = [
        {
          id: "task-healthy-short",
          agent_id: "agent-1",
          status: "RUNNING",
          claimed_at: baseTime - 100_000,
        },
        {
          id: "task-healthy-progress",
          agent_id: "agent-2",
          status: "RUNNING",
          claimed_at: baseTime - 450_000,
          last_progress: baseTime - 30_000, // Recent progress (< 120s)
        },
        {
          id: "task-straggler-overburden",
          agent_id: "agent-3",
          status: "RUNNING",
          claimed_at: baseTime - 400_000, // Straggler
          work_units: 8,
        },
        {
          id: "task-straggler-dead",
          agent_id: "agent-4",
          status: "LEASED",
          claimed_at: baseTime - 500_000,
          is_dead: true,
        },
        {
          id: "task-completed",
          agent_id: "agent-5",
          status: "COMPLETED",
          claimed_at: baseTime - 600_000,
        },
      ];

      const report: StragglerWatchdogReport = evaluateActiveTasks(tasks, baseTime, {
        recordDefects: true,
        defectsFilePath: defectsFile,
      });

      expect(report.evaluated_count).toBe(5);
      expect(report.straggler_count).toBe(2); // overburden + dead
      expect(report.healthy_count).toBe(3); // healthy-short + healthy-progress + completed
      expect(report.defects_emitted.length).toBe(2);
      expect(report.defects_emitted[0].error_code).toBe(TASK_STRAGGLER_OVERBURDEN_DEFECT);

      // Verify checkActiveTaskStragglers returns identical results
      const aliasReport = checkActiveTaskStragglers(tasks, baseTime);
      expect(aliasReport.evaluated_count).toBe(report.evaluated_count);
      expect(aliasReport.straggler_count).toBe(report.straggler_count);
      expect(aliasReport.healthy_count).toBe(report.healthy_count);

      expect(existsSync(defectsFile)).toBe(true);
      const fileContent = readFileSync(defectsFile, "utf-8");
      expect(fileContent).toContain(TASK_STRAGGLER_OVERBURDEN_DEFECT);
      expect(fileContent).toContain("task-straggler-overburden");
      expect(fileContent).toContain("task-straggler-dead");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("exports required constants with expected values", () => {
    expect(STRAGGLER_SLA_SECONDS).toBe(300);
    expect(PROGRESS_SILENCE_THRESHOLD_SECONDS).toBe(120);
    expect(TASK_STRAGGLER_OVERBURDEN_DEFECT).toBe("TASK_STRAGGLER_OVERBURDEN_DEFECT");
  });
});

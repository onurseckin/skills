import { describe, expect, test } from "bun:test";
import {
  auditPlanGranularity,
  DEFAULT_MAX_FILES_PER_TASK,
  DEFAULT_MAX_SUBSYSTEMS_PER_PLAN,
  DEFAULT_MAX_TASKS_PER_PLAN,
  EXCESSIVE_SCOPE_DEFECT,
  extractPlanSubsystems,
  MONOLITHIC_PLAN_DEFECT,
  PLAN_GRANULARITY_AUDIT,
  type TaskGranularityInput,
} from "../../../../olt/scripts/src/mind/auditing/plan-granularity-auditor.ts";

describe("Plan Granularity Auditor (Track 02)", () => {
  test("exports standard constants", () => {
    expect(PLAN_GRANULARITY_AUDIT).toBe("PLAN_GRANULARITY_AUDIT");
    expect(MONOLITHIC_PLAN_DEFECT).toBe("MONOLITHIC_PLAN_DEFECT");
    expect(EXCESSIVE_SCOPE_DEFECT).toBe("EXCESSIVE_SCOPE_DEFECT");
    expect(DEFAULT_MAX_SUBSYSTEMS_PER_PLAN).toBe(2);
    expect(DEFAULT_MAX_TASKS_PER_PLAN).toBe(6);
    expect(DEFAULT_MAX_FILES_PER_TASK).toBe(3);
  });

  test("AGP-1: flags MONOLITHIC_PLAN_DEFECT when plan spans > 2 subsystems", () => {
    const tasks: TaskGranularityInput[] = [
      {
        taskId: "task-1",
        writeScope: ["olt/scripts/src/mind/auditing/a.ts"],
      },
      {
        taskId: "task-2",
        writeScope: ["olt/scripts/src/authority/guards/b.ts"],
      },
      {
        taskId: "task-3",
        writeScope: ["olt/scripts/src/reporting/doctor/c.ts"],
      },
    ];

    const result = auditPlanGranularity(tasks);
    expect(result.is_compliant).toBe(false);
    expect(result.error_code).toBe(PLAN_GRANULARITY_AUDIT);
    expect(result.subsystem_count).toBe(3);
    const defect = result.findings.find((f) => f.violation_type === MONOLITHIC_PLAN_DEFECT);
    expect(defect).toBeDefined();
    expect(defect?.severity).toBe("ERROR");
    expect(defect?.subsystems_found).toContain("mind");
    expect(defect?.subsystems_found).toContain("authority");
    expect(defect?.subsystems_found).toContain("reporting");
  });

  test("AGP-2: flags EXCESSIVE_SCOPE_DEFECT when a single task has > 3 files in a 5+ file plan", () => {
    const tasks: TaskGranularityInput[] = [
      {
        taskId: "task-heavy",
        writeScope: ["src/mind/a.ts", "src/mind/b.ts", "src/mind/c.ts", "src/mind/d.ts"],
        files: ["src/mind/a.ts", "src/mind/b.ts", "src/mind/c.ts", "src/mind/d.ts"],
      },
      {
        taskId: "task-light",
        writeScope: ["src/mind/e.ts"],
        files: ["src/mind/e.ts"],
      },
    ];

    const result = auditPlanGranularity(tasks);
    expect(result.is_compliant).toBe(false);
    expect(result.error_code).toBe(PLAN_GRANULARITY_AUDIT);
    expect(result.total_files_count).toBe(5);
    const defect = result.findings.find((f) => f.violation_type === EXCESSIVE_SCOPE_DEFECT);
    expect(defect).toBeDefined();
    expect(defect?.task_ids).toEqual(["task-heavy"]);
  });

  test("flags MONOLITHIC_PLAN_DEFECT when plan has > 6 tasks", () => {
    const tasks: TaskGranularityInput[] = Array.from({ length: 7 }, (_, i) => ({
      taskId: `task-${i + 1}`,
      writeScope: [`src/mind/file-${i + 1}.ts`],
      files: [`src/mind/file-${i + 1}.ts`],
    }));

    const result = auditPlanGranularity(tasks);
    expect(result.is_compliant).toBe(false);
    expect(result.error_code).toBe(PLAN_GRANULARITY_AUDIT);
    const defect = result.findings.find((f) => f.violation_type === MONOLITHIC_PLAN_DEFECT);
    expect(defect).toBeDefined();
    expect(defect?.message).toContain("maximum allowable task count");
  });

  test("passes compliant plan within subsystem, task, and file limits", () => {
    const tasks: TaskGranularityInput[] = [
      {
        taskId: "task-1",
        writeScope: ["src/mind/a.ts", "src/mind/b.ts"],
        files: ["src/mind/a.ts", "src/mind/b.ts"],
      },
      {
        taskId: "task-2",
        writeScope: ["src/mind/c.ts", "src/mind/d.ts"],
        files: ["src/mind/c.ts", "src/mind/d.ts"],
      },
    ];

    const result = auditPlanGranularity(tasks);
    expect(result.is_compliant).toBe(true);
    expect(result.error_code).toBeUndefined();
    expect(result.findings.length).toBe(0);
    expect(result.subsystem_count).toBe(1);
    expect(result.task_count).toBe(2);
  });

  test("extractPlanSubsystems correctly extracts explicit and path-inferred subsystems", () => {
    const tasks: TaskGranularityInput[] = [
      {
        taskId: "task-1",
        writeScope: ["olt/scripts/src/mind/auditing/foo.ts"],
        targetSubsystems: ["mind"],
      },
      {
        taskId: "task-2",
        writeScope: ["packages/core/bar.ts"],
      },
    ];

    const subsystems = extractPlanSubsystems(tasks, ["reporting"]);
    expect(subsystems).toEqual(["core", "mind", "reporting"]);
  });
});

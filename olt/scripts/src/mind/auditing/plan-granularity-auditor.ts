import { expandWriteScope } from "../../graph/scope-expansion.ts";

export const PLAN_GRANULARITY_AUDIT = "PLAN_GRANULARITY_AUDIT" as const;
export const MONOLITHIC_PLAN_DEFECT = "MONOLITHIC_PLAN_DEFECT" as const;
export const EXCESSIVE_SCOPE_DEFECT = "EXCESSIVE_SCOPE_DEFECT" as const;

export const DEFAULT_MAX_SUBSYSTEMS_PER_PLAN = 2;
export const DEFAULT_MAX_TASKS_PER_PLAN = 6;
export const DEFAULT_MAX_FILES_PER_TASK = 3;
export const DEFAULT_MIN_FILES_FOR_TASK_SCOPE_CHECK = 5;

export type PlanGranularityViolationType =
  | typeof MONOLITHIC_PLAN_DEFECT
  | typeof EXCESSIVE_SCOPE_DEFECT;

export interface TaskGranularityInput {
  readonly taskId: string;
  readonly writeScope: readonly string[];
  readonly targetSubsystems?: readonly string[] | undefined;
  readonly files?: readonly string[] | undefined;
}

export interface PlanGranularityOptions {
  readonly planId?: string | undefined;
  readonly maxSubsystems?: number | undefined;
  readonly maxTasks?: number | undefined;
  readonly maxFilesPerTask?: number | undefined;
  readonly minFilesForTaskScopeCheck?: number | undefined;
  readonly targetSubsystems?: readonly string[] | undefined;
  readonly repoRoot?: string | undefined;
  readonly tasks?: readonly TaskGranularityInput[] | undefined;
}

export interface PlanGranularityFinding {
  readonly violation_type: PlanGranularityViolationType;
  readonly error_code: typeof PLAN_GRANULARITY_AUDIT;
  readonly severity: "ERROR" | "WARNING";
  readonly message: string;
  readonly task_ids?: readonly string[] | undefined;
  readonly subsystems_found?: readonly string[] | undefined;
}

export interface PlanGranularityReport {
  readonly is_compliant: boolean;
  readonly plan_id?: string | undefined;
  readonly task_count: number;
  readonly total_files_count: number;
  readonly subsystem_count: number;
  readonly subsystems: readonly string[];
  readonly findings: readonly PlanGranularityFinding[];
  readonly error_code?: typeof PLAN_GRANULARITY_AUDIT | undefined;
}

function inferSubsystemFromPath(path: string): string {
  const normalized = path.replace(/^[./\\]+/, "");
  const oltMatch = normalized.match(/^olt\/scripts\/src\/([^/]+)/);
  if (oltMatch?.[1]) {
    return oltMatch[1];
  }
  const srcMatch = normalized.match(/^src\/([^/]+)/);
  if (srcMatch?.[1]) {
    return srcMatch[1];
  }
  const pkgMatch = normalized.match(/^packages\/([^/]+)/);
  if (pkgMatch?.[1]) {
    return pkgMatch[1];
  }
  const parts = normalized.split(/[/\\]/);
  return parts[0] || "root";
}

export function extractPlanSubsystems(
  tasks: readonly TaskGranularityInput[],
  explicitSubsystems?: readonly string[] | undefined,
): readonly string[] {
  const subsystemSet = new Set<string>();

  if (explicitSubsystems) {
    for (const sub of explicitSubsystems) {
      if (typeof sub === "string" && sub.trim()) {
        subsystemSet.add(sub.trim());
      }
    }
  }

  for (const task of tasks) {
    if (task.targetSubsystems) {
      for (const sub of task.targetSubsystems) {
        if (typeof sub === "string" && sub.trim()) {
          subsystemSet.add(sub.trim());
        }
      }
    }
    for (const scopeEntry of task.writeScope) {
      if (typeof scopeEntry === "string" && scopeEntry.trim()) {
        subsystemSet.add(inferSubsystemFromPath(scopeEntry.trim()));
      }
    }
  }

  return Object.freeze([...subsystemSet].sort());
}

export function auditPlanGranularity(
  tasksOrOptions: readonly TaskGranularityInput[] | PlanGranularityOptions,
  maybeOptions?: PlanGranularityOptions,
): PlanGranularityReport {
  const isOptionsObject = !Array.isArray(tasksOrOptions);
  const options: PlanGranularityOptions = isOptionsObject
    ? (tasksOrOptions as PlanGranularityOptions)
    : (maybeOptions ?? {});
  const tasks: readonly TaskGranularityInput[] = isOptionsObject
    ? ((tasksOrOptions as PlanGranularityOptions).tasks ?? [])
    : (tasksOrOptions as readonly TaskGranularityInput[]);

  const planId = options.planId;
  const repoRoot = options.repoRoot ?? process.cwd();
  const maxSubsystems = options.maxSubsystems ?? DEFAULT_MAX_SUBSYSTEMS_PER_PLAN;
  const maxTasks = options.maxTasks ?? DEFAULT_MAX_TASKS_PER_PLAN;
  const maxFilesPerTask = options.maxFilesPerTask ?? DEFAULT_MAX_FILES_PER_TASK;
  const minFilesForTaskScopeCheck =
    options.minFilesForTaskScopeCheck ?? DEFAULT_MIN_FILES_FOR_TASK_SCOPE_CHECK;

  const subsystems = extractPlanSubsystems(tasks, options.targetSubsystems);
  const findings: PlanGranularityFinding[] = [];

  if (subsystems.length > maxSubsystems) {
    findings.push({
      violation_type: MONOLITHIC_PLAN_DEFECT,
      error_code: PLAN_GRANULARITY_AUDIT,
      severity: "ERROR",
      message: `Plan exceeds maximum allowable subsystems (${subsystems.length} > ${maxSubsystems}): ${subsystems.join(", ")}`,
      subsystems_found: subsystems,
    });
  }

  if (tasks.length > maxTasks) {
    findings.push({
      violation_type: MONOLITHIC_PLAN_DEFECT,
      error_code: PLAN_GRANULARITY_AUDIT,
      severity: "ERROR",
      message: `Plan exceeds maximum allowable task count (${tasks.length} > ${maxTasks})`,
      task_ids: tasks.map((t) => t.taskId),
    });
  }

  const taskFilesMap: { taskId: string; files: readonly string[] }[] = [];
  const allPlanFiles = new Set<string>();

  for (const task of tasks) {
    const files: readonly string[] = task.files
      ? task.files
      : expandWriteScope(repoRoot, task.writeScope);

    taskFilesMap.push({ taskId: task.taskId, files });
    for (const f of files) {
      allPlanFiles.add(f);
    }
  }

  if (allPlanFiles.size >= minFilesForTaskScopeCheck) {
    for (const item of taskFilesMap) {
      if (item.files.length > maxFilesPerTask) {
        findings.push({
          violation_type: EXCESSIVE_SCOPE_DEFECT,
          error_code: PLAN_GRANULARITY_AUDIT,
          severity: "ERROR",
          message: `Task ${item.taskId} exceeds maximum allowable files (${item.files.length} > ${maxFilesPerTask}) in a plan spanning ${allPlanFiles.size} files`,
          task_ids: [item.taskId],
        });
      }
    }
  }

  const isCompliant = findings.length === 0;

  return {
    is_compliant: isCompliant,
    plan_id: planId,
    task_count: tasks.length,
    total_files_count: allPlanFiles.size,
    subsystem_count: subsystems.length,
    subsystems,
    findings: Object.freeze(findings),
    ...(isCompliant ? {} : { error_code: PLAN_GRANULARITY_AUDIT }),
  };
}

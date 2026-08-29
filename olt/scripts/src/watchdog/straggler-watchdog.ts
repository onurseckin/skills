import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type {
  BrentConcurrencyPlan,
  RawDefectItem,
  StragglerAssessment,
} from "../mind/preplanning/types.ts";
import { calculateBrentDecomposition } from "../orchestrator/velocity-rebalancer.ts";

export const STRAGGLER_SLA_SECONDS = 300; // 5 minutes boundary
export const PROGRESS_SILENCE_THRESHOLD_SECONDS = 120; // 2 minutes progress heartbeat boundary
export const TASK_STRAGGLER_OVERBURDEN_DEFECT = "TASK_STRAGGLER_OVERBURDEN_DEFECT" as const;

export interface MonitoredTask {
  readonly id: string;
  readonly agent_id?: string | undefined;
  readonly status: "PENDING" | "RUNNING" | "LEASED" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
  readonly claimed_at: string | number; // ISO string or timestamp in ms
  readonly last_progress?: string | number | undefined;
  readonly last_progress_at?: string | number | undefined;
  readonly scope_files?: readonly string[] | undefined;
  readonly work_units?: number | undefined;
  readonly span_length?: number | undefined;
  readonly is_abandoned?: boolean | undefined;
  readonly is_dead?: boolean | undefined;
}

export interface StragglerWatchdogOptions {
  readonly slaSeconds?: number | undefined;
  readonly progressGraceSeconds?: number | undefined;
  readonly recordDefects?: boolean | undefined;
  readonly defectsFilePath?: string | undefined;
  readonly minParallelism?: number | undefined;
  readonly maxParallelism?: number | undefined;
}

export interface StragglerWatchdogReport {
  readonly evaluated_count: number;
  readonly straggler_count: number;
  readonly healthy_count: number;
  readonly stragglers: readonly StragglerAssessment[];
  readonly defects_emitted: readonly RawDefectItem[];
  readonly timestamp: string;
}

export function parseTimestampMs(time: string | number): number {
  if (typeof time === "number") {
    return time;
  }
  const parsed = Date.parse(time);
  return isNaN(parsed) ? Date.now() : parsed;
}

export function assessTaskStraggler(
  task: MonitoredTask,
  nowMs: number = Date.now(),
  options?: StragglerWatchdogOptions | undefined,
): StragglerAssessment {
  const slaSeconds = options?.slaSeconds ?? STRAGGLER_SLA_SECONDS;
  const progressGraceSeconds = options?.progressGraceSeconds ?? PROGRESS_SILENCE_THRESHOLD_SECONDS;
  const claimedAtMs = parseTimestampMs(task.claimed_at);
  const elapsedSeconds = Math.max(0, (nowMs - claimedAtMs) / 1000);

  const isActive =
    task.status === "RUNNING" || task.status === "LEASED" || task.status === "IN_PROGRESS";

  if (!isActive) {
    return {
      task_id: task.id,
      agent_id: task.agent_id ?? "unknown",
      elapsed_seconds: elapsedSeconds,
      is_straggler: false,
      recommended_action: "CONTINUE",
    };
  }

  if (elapsedSeconds > slaSeconds) {
    const lastProgressRaw = task.last_progress ?? task.last_progress_at;
    const lastProgressMs =
      lastProgressRaw !== undefined ? parseTimestampMs(lastProgressRaw) : claimedAtMs;
    const silenceSeconds = Math.max(0, (nowMs - lastProgressMs) / 1000);

    // If recent progress was reported within 120s, the task is active and not a straggler
    // Resolves: hb-s7-coordinator-diagnosed-live-agent-as-dead
    if (silenceSeconds <= progressGraceSeconds) {
      return {
        task_id: task.id,
        agent_id: task.agent_id ?? "unknown",
        elapsed_seconds: elapsedSeconds,
        is_straggler: false,
        recommended_action: "CONTINUE",
      };
    }

    const isDeadOrAbandoned = task.is_abandoned === true || task.is_dead === true;
    const recommendedAction = isDeadOrAbandoned ? "RECLAIM_LEASE" : "DECOMPOSE_PARALLEL";

    let decompositionPlan: BrentConcurrencyPlan | undefined = undefined;
    if (recommendedAction === "DECOMPOSE_PARALLEL") {
      const scopeFiles = task.scope_files ?? [];
      const workUnits = task.work_units ?? Math.max(1, scopeFiles.length);

      decompositionPlan = calculateBrentDecomposition({
        workUnits,
        spanLength: task.span_length ?? 1,
        minParallelism: options?.minParallelism,
        maxParallelism: options?.maxParallelism,
        scopeFiles,
        parentTaskId: task.id,
      });
    }

    return {
      task_id: task.id,
      agent_id: task.agent_id ?? "unknown",
      elapsed_seconds: elapsedSeconds,
      is_straggler: true,
      recommended_action: recommendedAction,
      decomposition_plan: decompositionPlan,
    };
  }

  return {
    task_id: task.id,
    agent_id: task.agent_id ?? "unknown",
    elapsed_seconds: elapsedSeconds,
    is_straggler: false,
    recommended_action: "CONTINUE",
  };
}

export function assessTaskStragglerStatus(
  task: MonitoredTask,
  nowMs: number = Date.now(),
  options?: StragglerWatchdogOptions | undefined,
): StragglerAssessment {
  return assessTaskStraggler(task, nowMs, options);
}

function appendDefectsAtomic(filePath: string, defects: readonly RawDefectItem[]): void {
  if (defects.length === 0) return;

  const parentDir = dirname(filePath);
  mkdirSync(parentDir, { recursive: true });

  const existingContent = existsSync(filePath) ? readFileSync(filePath, "utf-8") : "";
  const newLines = defects.map((d) => JSON.stringify(d)).join("\n") + "\n";
  const tempPath = `${filePath}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;

  writeFileSync(tempPath, existingContent + newLines, "utf-8");
  renameSync(tempPath, filePath);
}

export function evaluateActiveTasks(
  tasks: readonly MonitoredTask[],
  nowMs: number = Date.now(),
  options?: StragglerWatchdogOptions | undefined,
): StragglerWatchdogReport {
  const stragglers: StragglerAssessment[] = [];
  const emittedDefects: RawDefectItem[] = [];
  let healthyCount = 0;

  for (const task of tasks) {
    const assessment = assessTaskStraggler(task, nowMs, options);
    if (assessment.is_straggler) {
      stragglers.push(assessment);

      const defect: RawDefectItem = {
        id: `def-straggler-${task.id}-${Date.now()}`,
        title: `Task Straggler SLA Breach: Task ${task.id}`,
        message: `Task ${task.id} (Agent: ${task.agent_id ?? "unknown"}) exceeded 5-minute SLA (${assessment.elapsed_seconds.toFixed(1)}s elapsed)`,
        description: `Autonomic 5-minute SLA exceeded without task convergence. Recommended action: ${assessment.recommended_action}.`,
        error_code: TASK_STRAGGLER_OVERBURDEN_DEFECT,
        category: "WATCHDOG",
        severity: "high",
        status: "OPEN",
        timestamp: new Date(nowMs).toISOString(),
        domain: "engine",
      };
      emittedDefects.push(defect);
    } else {
      healthyCount++;
    }
  }

  if (options?.recordDefects && options?.defectsFilePath && emittedDefects.length > 0) {
    appendDefectsAtomic(options.defectsFilePath, emittedDefects);
  }

  return {
    evaluated_count: tasks.length,
    straggler_count: stragglers.length,
    healthy_count: healthyCount,
    stragglers: Object.freeze(stragglers),
    defects_emitted: Object.freeze(emittedDefects),
    timestamp: new Date(nowMs).toISOString(),
  };
}

export function checkActiveTaskStragglers(
  tasks: readonly MonitoredTask[],
  nowMs: number = Date.now(),
  options?: StragglerWatchdogOptions | undefined,
): StragglerWatchdogReport {
  return evaluateActiveTasks(tasks, nowMs, options);
}

export type { StragglerAssessment, BrentConcurrencyPlan, RawDefectItem };

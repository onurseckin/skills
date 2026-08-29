import type {
  SchedulerEngineOptions,
  GraphHealthAuditReport,
  SupervisoryWatchdogAuditReport,
  Supervisory5PointHealthReport,
  SupervisoryProbeDispatchResult,
  TaskRecoveryResult,
  ScheduledWaveResult,
  ScheduledTaskDispatch,
  BlockedTaskInfo,
} from "./types.ts";
import { auditGraphHealth, auditSupervisoryWatchdog, recoverStaleTasks } from "./state.ts";
import {
  auditSupervisory5PointHealth,
  dispatchSupervisoryHealthProbe,
  auditDoctorGate,
  assertDoctorGatePassed,
} from "./lifecycle.ts";
import {
  type ScriptBackedDiagnosticsOptions,
  type ScriptBackedDiagnosticsResult,
  runScriptBackedDiagnostics,
} from "../diagnostics/diagnostics.ts";
import { type WatchdogRecord, registerWatchdog } from "../../../authority/watchdog-manager.ts";
import { dependencyMap } from "../../../graph/dependency-map.ts";
import { type DoctorOptions } from "../../../reporting/doctor.ts";
import { type Clock, systemClock, type TransactionPort } from "../../../workflow/types.ts";
import { hasActiveOwnership } from "../conflict/conflicts.ts";
import {
  type MultiDomainBatchOptions,
  type MultiDomainBatchResult,
  evaluateMultiDomainBatch,
  type MultiDomainValidatorDispatchOptions,
  type MultiDomainValidatorDispatchResult,
  dispatchMultiDomainValidators,
  type MultiDomainWaveOptions,
  type MultiDomainWaveResult,
  proposeMultiDomainWave,
} from "../dispatch/multi-domain-dispatch.ts";
import { type ReadySetSelection, readySet } from "../dispatch/ready-set.ts";
import { proposeBatch } from "../dispatch/propose-batch.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class SchedulerEngine {
  private readonly maxParallel: number | null;
  private readonly timeoutMs: number;
  private readonly heartbeatCadenceMs: number;
  private readonly clock: Clock;
  private readonly watchdogTarget?: string | undefined;
  private readonly maxRepairRounds: number;

  public constructor(options: SchedulerEngineOptions = {}) {
    this.maxParallel = options.maxParallel ?? null;
    this.timeoutMs = options.timeoutMs ?? 360_000;
    this.heartbeatCadenceMs = options.heartbeatCadenceMs ?? 180_000;
    this.clock = options.clock ?? systemClock;
    this.watchdogTarget = options.watchdogTarget;
    this.maxRepairRounds = options.maxRepairRounds ?? 3;
  }

  public auditHealth(state: unknown): GraphHealthAuditReport {
    return auditGraphHealth(state, {
      now: this.clock.now(),
      timeoutMs: this.timeoutMs,
    });
  }

  public auditWatchdog(): SupervisoryWatchdogAuditReport {
    return auditSupervisoryWatchdog(this.watchdogTarget, {
      now: this.clock.now(),
      timeoutMs: this.timeoutMs,
    });
  }

  public auditSupervisory5Point(
    state: unknown,
    options: {
      runRoot?: string | undefined;
      doctorResult?: Record<string, unknown> | undefined;
    } = {},
  ): Supervisory5PointHealthReport {
    return auditSupervisory5PointHealth(state, {
      runRoot: options.runRoot,
      now: this.clock.now(),
      doctorResult: options.doctorResult,
    });
  }

  public dispatchTopLeaderProbe(
    state: unknown,
    options: {
      runRoot?: string | undefined;
      doctorResult?: Record<string, unknown> | undefined;
    } = {},
  ): SupervisoryProbeDispatchResult {
    return dispatchSupervisoryHealthProbe(state, {
      runRoot: options.runRoot,
      now: this.clock.now(),
      doctorResult: options.doctorResult,
    });
  }

  public async auditDoctor(
    runRoot: string,
    options: DoctorOptions = {},
  ): Promise<Record<string, unknown>> {
    return await auditDoctorGate(runRoot, options);
  }

  public async runDoctorGate(
    runRoot: string,
    options: DoctorOptions = {},
  ): Promise<Record<string, unknown>> {
    return await assertDoctorGatePassed(runRoot, options);
  }

  public recoverStale(port: TransactionPort): TaskRecoveryResult {
    // 1. Cleanup stale store watchdogs
    // watchdog cleanup is automatic or handled elsewhere

    // 2. Recover stale tasks in workflow state
    return recoverStaleTasks(port, {
      now: this.clock.now(),
      timeoutMs: this.timeoutMs,
      maxRepairRounds: this.maxRepairRounds,
      actor: "scheduler-engine",
    });
  }

  public evaluateReadyBatch(
    state: unknown,
    maxParallel?: number | null | undefined,
  ): ReadySetSelection {
    const limit = maxParallel !== undefined ? maxParallel : this.maxParallel;
    return readySet(state, limit ?? 10);
  }

  public evaluateWave(
    state: unknown,
    maxParallel?: number | null | undefined,
  ): ScheduledWaveResult {
    const limit = maxParallel !== undefined ? maxParallel : this.maxParallel;
    const batch = proposeBatch(state, limit);
    const readySelection = readySet(state, limit ?? 10);

    const readyTasks: ScheduledTaskDispatch[] = batch.map((task) => {
      const entry = readySelection.entries.find((e) => e.task_id === task.id);
      return {
        taskId: task.id,
        label: typeof task.label === "string" ? task.label : null,
        priority: task.priority,
        writeScope: [...task.write_scope],
        resourceScope: [...(task.resource_scope ?? [])],
        requirementIds: [...task.requirement_ids],
        wave: entry?.recorded_wave ?? null,
      };
    });

    const activeOccupiedTasks: string[] = [];
    const blockedTasks: BlockedTaskInfo[] = [];

    if (isRecord(state) && isRecord(state.tasks)) {
      const deps = isRecord(state.graph)
        ? dependencyMap(state.graph)
        : new Map<string, Set<string>>();
      const doneSet = new Set<string>();

      for (const [id, rawTask] of Object.entries(state.tasks)) {
        if (isRecord(rawTask) && rawTask.status === "done") {
          doneSet.add(id);
        }
      }

      for (const [taskId, rawTask] of Object.entries(state.tasks)) {
        if (!isRecord(rawTask)) continue;
        const status = String(rawTask.status);
        if (hasActiveOwnership(status) && !["proposed", "ready", "retry_ready"].includes(status)) {
          activeOccupiedTasks.push(taskId);
        } else if (status === "blocked" || status === "changes_requested" || status === "stale") {
          const prerequisites = Array.from(deps.get(taskId) ?? []);
          const unsatisfied = prerequisites.filter((p) => !doneSet.has(p));
          blockedTasks.push({
            taskId,
            status,
            blockingReason: `Task in status '${status}' is not eligible for batch dispatch.`,
            prerequisites,
            unsatisfiedPrerequisites: unsatisfied,
          });
        }
      }
    }

    return {
      readyTasks,
      blockedTasks,
      activeOccupiedTasks,
      totalEligible: readyTasks.length,
      maxParallel: limit,
      evaluatedAt: this.clock.now().toISOString(),
    };
  }

  public evaluateMultiDomainBatch(
    state: unknown,
    options: MultiDomainBatchOptions = {},
  ): MultiDomainBatchResult {
    const limit = options.maxParallel !== undefined ? options.maxParallel : this.maxParallel;
    return evaluateMultiDomainBatch(state, {
      ...options,
      maxParallel: limit,
    });
  }

  public dispatchMultiDomainValidators(
    state: unknown,
    options: MultiDomainValidatorDispatchOptions = {},
  ): MultiDomainValidatorDispatchResult {
    const limit = options.maxParallel !== undefined ? options.maxParallel : this.maxParallel;
    return dispatchMultiDomainValidators(state, {
      ...options,
      maxParallel: limit,
    });
  }

  public proposeMultiDomainWave(
    state: unknown,
    options: MultiDomainWaveOptions = {},
  ): MultiDomainWaveResult {
    const limit = options.maxParallel !== undefined ? options.maxParallel : this.maxParallel;
    return proposeMultiDomainWave(state, {
      clock: this.clock,
      ...options,
      maxParallel: limit,
    });
  }

  public async auditScriptBackedDiagnostics(
    options: ScriptBackedDiagnosticsOptions = {},
  ): Promise<ScriptBackedDiagnosticsResult> {
    return await runScriptBackedDiagnostics({
      clock: this.clock,
      ...options,
    });
  }

  public async runScriptBackedDiagnostics(
    options: ScriptBackedDiagnosticsOptions = {},
  ): Promise<ScriptBackedDiagnosticsResult> {
    return await runScriptBackedDiagnostics({
      clock: this.clock,
      ...options,
    });
  }

  public registerSupervisoryHeartbeat(agentId: string = "scheduler-engine"): WatchdogRecord {
    return registerWatchdog(
      {
        agent_id: agentId,
        phase: "scheduler-pulse",
        heartbeat_cadence_ms: this.heartbeatCadenceMs,
        timeout_ms: this.timeoutMs,
        now: this.clock.now(),
      },
      this.watchdogTarget,
    ).watchdog;
  }
}

export function createSchedulerEngine(options: SchedulerEngineOptions = {}): SchedulerEngine {
  return new SchedulerEngine(options);
}

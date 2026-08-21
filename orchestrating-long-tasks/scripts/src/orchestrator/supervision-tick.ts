import { escalateTask, type SupervisorEscalationReason } from "../workflow/lease/escalate.ts";
import { HarnessError } from "../errors/harness-error.ts";
import {
  systemClock,
  type Clock,
  type TransactionPort,
  type WorkflowState,
} from "../workflow/types.ts";
import type { TaskRecord } from "../workflow/types.ts";
import { reclaimDeadAgents, type DeadAgentEvent } from "./dead-agent-detector.ts";
import { classifyFailure, type FailureRecord } from "./failure-classifier.ts";

export interface SupervisionTickConfig {
  readonly recoveryEnabled?: boolean;
  readonly graceSeconds?: number;
  readonly deterministicRepeatThreshold?: number;
  readonly maxElapsedMs?: number;
  readonly clock?: Clock;
}

export interface EscalationRecord {
  readonly taskId: string;
  readonly reason: SupervisorEscalationReason;
  readonly evidence: string;
}

export interface SupervisionTickResult {
  readonly reclaimed: readonly DeadAgentEvent[];
  readonly escalatedNow: readonly EscalationRecord[];
  readonly state: WorkflowState;
  readonly occupied: number;
}

interface StaleStreak {
  readonly count: number;
  readonly history: readonly FailureRecord[];
  readonly current?: FailureRecord;
}

function staleStreak(task: TaskRecord): StaleStreak {
  const streak: FailureRecord[] = [];
  for (let index = task.attempts.length - 1; index >= 0; index--) {
    const attempt = task.attempts[index]!;
    if (typeof attempt.stale_at !== "string") break;
    streak.unshift({
      signal: "crash",
      detail: "lease expired with no submission",
      at: attempt.stale_at,
    });
  }
  if (streak.length === 0) return { count: 0, history: [] };
  const current = streak.at(-1)!;
  return { count: streak.length, history: streak.slice(0, -1), current };
}

function escalateDeterministicallyDeadTasks(
  port: TransactionPort,
  actor: string,
  state: WorkflowState,
  clock: Clock,
  config: SupervisionTickConfig,
): { state: WorkflowState; escalated: EscalationRecord[] } {
  const now = clock.now();
  const escalated: EscalationRecord[] = [];
  let current = state;
  for (const task of Object.values(state.tasks)) {
    if (task.lease !== undefined) continue;
    const streak = staleStreak(task);
    if (streak.current === undefined) continue;
    const classification = classifyFailure({
      signal: streak.current.signal,
      detail: streak.current.detail,
      priorFailures: streak.history,
      now,
      ...(config.deterministicRepeatThreshold === undefined
        ? {}
        : { deterministicRepeatThreshold: config.deterministicRepeatThreshold }),
      ...(config.maxElapsedMs === undefined ? {} : { maxElapsedMs: config.maxElapsedMs }),
    });
    if (classification.failureClass !== "deterministic") continue;
    const evidence = `${streak.count} consecutive lease(s) expired with no submission (${classification.reason})`;
    try {
      current = escalateTask(port, task.id, actor, "retry_budget_exhausted", evidence, clock);
      escalated.push({ taskId: task.id, reason: "retry_budget_exhausted", evidence });
    } catch (error) {
      if (!(error instanceof HarnessError) || error.code !== "INVALID_STATE") throw error;
    }
  }
  return { state: current, escalated };
}

export function runSupervisionTick(
  port: TransactionPort,
  actor: string,
  config: SupervisionTickConfig = {},
): SupervisionTickResult {
  const recoveryEnabled = config.recoveryEnabled ?? true;
  const clock = config.clock ?? systemClock;

  const reclaimed = recoveryEnabled
    ? reclaimDeadAgents(
        port,
        actor,
        clock,
        config.graceSeconds === undefined ? {} : { graceSeconds: config.graceSeconds },
      ).events
    : [];

  let state = port.read();
  let escalatedNow: EscalationRecord[] = [];
  if (recoveryEnabled) {
    const outcome = escalateDeterministicallyDeadTasks(port, actor, state, clock, config);
    state = outcome.state;
    escalatedNow = outcome.escalated;
  }

  const occupied = Object.values(state.tasks).filter((task) => task.lease !== undefined).length;

  return { reclaimed, escalatedNow, state, occupied };
}

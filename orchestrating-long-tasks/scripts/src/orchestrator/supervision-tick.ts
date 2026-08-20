import { escalateTask, type SupervisorEscalationReason } from "../workflow/lease/escalate.ts";
import { HarnessError } from "../errors/harness-error.ts";
import { systemClock, type Clock, type TransactionPort, type WorkflowState } from "../workflow/types.ts";
import type { TaskRecord } from "../workflow/types.ts";
import { reclaimDeadAgents, type DeadAgentEvent } from "./dead-agent-detector.ts";
import { classifyFailure, type FailureRecord } from "./failure-classifier.ts";

/**
 * The reclaim-and-escalate half of B28.2's supervisor loop: reclaim whatever died without being
 * told, and give up on whatever has clearly stopped being retriable (B28.3). Deliberately stateless
 * beyond the capsule itself — every input is either read fresh from the run or passed in by the
 * caller — so calling it again after a crash reaches the same answer a continuously-running process
 * would have (B28.2's "survives its own death").
 *
 * What is READY to dispatch is a separate question (`dispatch-selection.ts`): the scheduler needs
 * the full capsule's dependency graph, which this function's `TransactionPort` — deliberately scoped
 * to the narrower `WorkflowState` used for lease mutations — does not carry.
 */
export interface SupervisionTickConfig {
  /** B28.5: recovery is on by default. A caller must explicitly opt out, never the reverse. */
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

/**
 * The trailing run of dead-agent attempts at the tail of a task's history: consecutive attempts
 * `recoverStale` marked `stale_at` with no `submitted_at` after them. A voluntary release or a
 * still-active attempt breaks the run, because neither is evidence the task itself is unworkable.
 */
function staleStreak(task: TaskRecord): StaleStreak {
  const streak: FailureRecord[] = [];
  for (let index = task.attempts.length - 1; index >= 0; index--) {
    const attempt = task.attempts[index]!;
    if (typeof attempt.stale_at !== "string") break;
    streak.unshift({ signal: "crash", detail: "lease expired with no submission", at: attempt.stale_at });
  }
  if (streak.length === 0) return { count: 0, history: [] };
  const current = streak.at(-1)!;
  return { count: streak.length, history: streak.slice(0, -1), current };
}

/**
 * Escalates every task whose dead-agent streak has crossed into deterministic territory. A task
 * some other actor already moved out of an escalatable status (a concurrent human action, or an
 * earlier tick) is skipped rather than treated as a crash: the classifier's verdict about a task's
 * *history* does not override a state change the task has already undergone.
 */
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

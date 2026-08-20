import type { JsonObject } from "../contracts/json.ts";
import type { TransactionPort, WorkflowState } from "../workflow/types.ts";
import {
  type ClassificationResult,
  type FailureRecord,
  type FailureSignal,
} from "./failure-classifier.ts";

/**
 * Durable bookkeeping for B28.3's retry/backoff decisions, without a dedicated state field: a
 * dispatch failure can happen before any task lease exists, so there is nothing on the task record
 * to attach it to. Instead every attempt is its own event on the run's own hash chain — the harness's
 * existing durability, reused rather than duplicated — and a supervisor rebuilds the picture for a
 * task by reading its events back, which is what lets a restarted supervisor pick up exactly where a
 * dead one left off (B28.2).
 */
export const DISPATCH_OUTCOME_KIND = "supervisor-dispatch-outcome";

export type DispatchOutcome = "dispatched" | "failed";

export interface DispatchFailureReport {
  readonly signal: FailureSignal;
  readonly detail: string;
}

export interface RecordDispatchOutcomeInput {
  readonly taskId: string;
  readonly outcome: DispatchOutcome;
  readonly agentId?: string;
  readonly failure?: DispatchFailureReport;
  readonly classification?: ClassificationResult;
  /** ISO timestamp the task becomes eligible again; absent when there is nothing to wait for. */
  readonly retryAt?: string;
}

/**
 * Records one dispatch attempt's outcome. The mutation is deliberately a no-op: this event's
 * `payload` is the fact worth keeping, and no field on `WorkflowState` exists to hold it without
 * colliding with schema another agent owns.
 */
export function recordDispatchOutcome(
  port: TransactionPort,
  actor: string,
  input: RecordDispatchOutcomeInput,
): WorkflowState {
  return port.transact(
    actor,
    DISPATCH_OUTCOME_KIND,
    {
      task_id: input.taskId,
      outcome: input.outcome,
      ...(input.agentId === undefined ? {} : { agent_id: input.agentId }),
      ...(input.failure === undefined
        ? {}
        : { signal: input.failure.signal, detail: input.failure.detail }),
      ...(input.classification === undefined
        ? {}
        : {
            failure_class: input.classification.failureClass,
            classification_reason: input.classification.reason,
            repeat_count: input.classification.repeatCount,
          }),
      ...(input.retryAt === undefined ? {} : { retry_at: input.retryAt }),
    },
    () => {
      // Intentional no-op: see the module comment above.
    },
  );
}

export interface DispatchHistory {
  /** Every dispatch failure since the task's last successful dispatch, oldest first. */
  readonly failures: readonly FailureRecord[];
  /** When the task next becomes eligible, if the most recent outcome scheduled a retry. */
  readonly retryAt?: string;
}

/**
 * The slice of a recorded event this module actually reads. `HarnessEvent` satisfies it
 * structurally, so production callers pass `loadRun(runRoot).events` unchanged; tests can build the
 * three fields directly without assembling a full signed event.
 */
export interface DispatchLogEvent {
  readonly kind: string;
  readonly payload: JsonObject;
  readonly timestamp: string;
}

const KNOWN_SIGNALS: ReadonlySet<string> = new Set<FailureSignal>([
  "rate_limit",
  "network",
  "provider_5xx",
  "timeout",
  "auth",
  "gate_failure",
  "crash",
  "unknown",
]);

function isFailureSignal(value: unknown): value is FailureSignal {
  return typeof value === "string" && KNOWN_SIGNALS.has(value);
}

/**
 * Replays a task's dispatch-outcome events into the shape `classifyFailure` and the backoff
 * scheduler need. A successful dispatch clears the streak: the task made progress, so an earlier
 * run of failures no longer describes what is happening to it now.
 */
export function readDispatchHistory(
  events: readonly DispatchLogEvent[],
  taskId: string,
): DispatchHistory {
  const failures: FailureRecord[] = [];
  let retryAt: string | undefined;
  for (const event of events) {
    if (event.kind !== DISPATCH_OUTCOME_KIND || event.payload.task_id !== taskId) continue;
    if (event.payload.outcome === "dispatched") {
      failures.length = 0;
      retryAt = undefined;
      continue;
    }
    const { signal, detail } = event.payload;
    if (isFailureSignal(signal) && typeof detail === "string") {
      failures.push({ signal, detail, at: event.timestamp });
    }
    retryAt = typeof event.payload.retry_at === "string" ? event.payload.retry_at : undefined;
  }
  return { failures, ...(retryAt === undefined ? {} : { retryAt }) };
}

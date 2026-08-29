import type { JsonObject } from "../core/contracts/index.ts";
import type { TransactionPort, WorkflowState } from "../workflow/types.ts";
import {
  type ClassificationResult,
  type FailureRecord,
  type FailureSignal,
} from "./failure-classifier.ts";

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
  readonly retryAt?: string;
}

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
    () => {},
  );
}

export interface DispatchHistory {
  readonly failures: readonly FailureRecord[];
  readonly retryAt?: string;
}

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

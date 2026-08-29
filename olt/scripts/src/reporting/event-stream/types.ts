import type { HarnessEvent } from "../../core/contracts/index.ts";

export interface EventStreamOptions {
  readonly fromSeq?: number | undefined;
  readonly toSeq?: number | undefined;
  readonly maxEvents?: number | undefined;
  readonly filterType?: string | readonly string[] | undefined;
  readonly filterActor?: string | readonly string[] | undefined;
  readonly all?: boolean | undefined;
}

export interface CapsuleEventsResult {
  readonly runRoot: string;
  readonly runId: string;
  readonly capsuleId?: string | undefined;
  readonly totalAvailable: number;
  readonly matchingEvents: readonly HarnessEvent[];
  readonly fromSeq?: number | undefined;
  readonly toSeq?: number | undefined;
  readonly latestSeq: number;
  readonly hasMore: boolean;
}

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface WebhookDeliveryOptions {
  readonly customFetch?: FetchLike | undefined;
  readonly retries?: number | undefined;
  readonly timeoutMs?: number | undefined;
  readonly headers?: Readonly<Record<string, string>> | undefined;
  readonly batchSize?: number | undefined;
  readonly backoffBaseMs?: number | undefined;
}

export interface WebhookDeliveryResult {
  readonly success: boolean;
  readonly deliveredCount: number;
  readonly statusCode?: number | undefined;
  readonly receiptId?: string | undefined;
  readonly attempts: number;
  readonly error?: string | undefined;
  readonly durationMs: number;
}

export function isHarnessEvent(value: unknown): value is HarnessEvent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const rec = value as Record<string, unknown>;
  return (
    typeof rec.schema === "string" &&
    typeof rec.sequence === "number" &&
    typeof rec.timestamp === "string" &&
    typeof rec.actor === "string" &&
    typeof rec.kind === "string"
  );
}

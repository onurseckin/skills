import { randomUUID } from "node:crypto";
import type { HarnessEvent } from "../../core/contracts/index.ts";
import type { WebhookDeliveryOptions, WebhookDeliveryResult } from "./types.ts";

interface SingleBatchResult {
  readonly success: boolean;
  readonly statusCode?: number | undefined;
  readonly receiptId?: string | undefined;
  readonly attempts: number;
  readonly error?: string | undefined;
}

function parseRetryAfterMs(headerVal: string | null, defaultMs: number): number {
  if (!headerVal) {
    return defaultMs;
  }
  const numeric = Number.parseInt(headerVal, 10);
  if (!Number.isNaN(numeric) && numeric >= 0) {
    return numeric * 1000;
  }
  const dateParsed = Date.parse(headerVal);
  if (!Number.isNaN(dateParsed)) {
    const diff = dateParsed - Date.now();
    return Math.max(0, diff);
  }
  return defaultMs;
}

async function deliverSingleBatch(
  batch: readonly (HarnessEvent | Record<string, unknown>)[],
  webhookUrl: string,
  options: WebhookDeliveryOptions,
): Promise<SingleBatchResult> {
  const fetchFn = options.customFetch ?? fetch;
  const maxRetries = Math.max(0, options.retries ?? 3);
  const timeoutMs = options.timeoutMs ?? 5000;
  const backoffBase = options.backoffBaseMs ?? 50;

  const payload = {
    events: batch,
    count: batch.length,
    delivered_at: new Date().toISOString(),
    batch_id: `batch_${randomUUID().slice(0, 8)}`,
  };

  const bodyStr = JSON.stringify(payload);
  let lastError: string | undefined;
  let lastStatusCode: number | undefined;
  let attempts = 0;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    attempts = attempt;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let retryAfterDelay: number | undefined;

    try {
      const response = await fetchFn(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/plain",
          "User-Agent": "olt/event-stream-bridge",
          ...(options.headers ?? {}),
        },
        body: bodyStr,
        signal: controller.signal,
      });

      clearTimeout(timer);
      lastStatusCode = response.status;

      if (response.ok) {
        let receiptId =
          response.headers.get("x-receipt-id") ?? response.headers.get("x-delivery-receipt");
        if (!receiptId) {
          try {
            const resJson: unknown = await response.json();
            if (typeof resJson === "object" && resJson !== null) {
              const obj = resJson as Record<string, unknown>;
              if (typeof obj.receipt_id === "string") receiptId = obj.receipt_id;
              else if (typeof obj.receiptId === "string") receiptId = obj.receiptId;
              else if (typeof obj.id === "string") receiptId = obj.id;
            }
          } catch {
          }
        }
        if (!receiptId) {
          receiptId = `rcpt_${randomUUID().slice(0, 12)}`;
        }

        return {
          success: true,
          statusCode: response.status,
          receiptId,
          attempts,
        };
      }

      if (response.status === 429) {
        const retryHeader = response.headers.get("retry-after");
        const defaultBackoff = backoffBase * Math.pow(2, attempt - 1);
        retryAfterDelay = parseRetryAfterMs(retryHeader, defaultBackoff);
      } else if (response.status >= 400 && response.status < 500) {
        return {
          success: false,
          statusCode: response.status,
          attempts,
          error: `Webhook rejected payload with HTTP ${response.status}: ${response.statusText}`,
        };
      }

      lastError = `HTTP ${response.status}: ${response.statusText}`;
    } catch (err) {
      clearTimeout(timer);
      lastError = err instanceof Error ? err.message : String(err);
    }

    if (attempt <= maxRetries) {
      const delay =
        retryAfterDelay !== undefined
          ? retryAfterDelay
          : backoffBase * Math.pow(2, attempt - 1);
      await new Promise((resolveSleep) => setTimeout(resolveSleep, delay));
    }
  }

  return {
    success: false,
    ...(lastStatusCode !== undefined ? { statusCode: lastStatusCode } : {}),
    attempts,
    error: lastError !== undefined ? lastError : "Webhook delivery failed after maximum retries",
  };
}

export async function deliverEventsToWebhook(
  events: readonly (HarnessEvent | Record<string, unknown>)[],
  webhookUrl: string,
  options: WebhookDeliveryOptions = {},
): Promise<WebhookDeliveryResult> {
  const startTime = Date.now();
  if (events.length === 0) {
    return {
      success: true,
      deliveredCount: 0,
      attempts: 0,
      receiptId: "rcpt_empty_batch",
      durationMs: 0,
    };
  }

  const batchSize =
    options.batchSize !== undefined && options.batchSize > 0 ? options.batchSize : events.length;

  const batches: (readonly (HarnessEvent | Record<string, unknown>)[])[] = [];
  for (let i = 0; i < events.length; i += batchSize) {
    batches.push(events.slice(i, i + batchSize));
  }

  let deliveredCount = 0;
  let totalAttempts = 0;
  let lastReceiptId: string | undefined;
  let lastStatusCode: number | undefined;

  for (const batch of batches) {
    const result = await deliverSingleBatch(batch, webhookUrl, options);
    totalAttempts += result.attempts;
    lastStatusCode = result.statusCode;

    if (!result.success) {
      return {
        success: false,
        deliveredCount,
        ...(lastStatusCode !== undefined ? { statusCode: lastStatusCode } : {}),
        attempts: totalAttempts,
        error: result.error,
        durationMs: Date.now() - startTime,
      };
    }

    deliveredCount += batch.length;
    lastReceiptId = result.receiptId;
  }

  return {
    success: true,
    deliveredCount,
    ...(lastStatusCode !== undefined ? { statusCode: lastStatusCode } : {}),
    receiptId: lastReceiptId,
    attempts: totalAttempts,
    durationMs: Date.now() - startTime,
  };
}

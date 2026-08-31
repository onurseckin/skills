import { describe, expect, it } from "bun:test";
import type { HarnessEvent } from "../../../olt/scripts/src/core/contracts/index.ts";
import { deliverEventsToWebhook } from "../../../olt/scripts/src/reporting/event-stream/index.ts";

export const eventStreamEdgeSuiteName = "reporting/event-stream edge cases suite";

describe(eventStreamEdgeSuiteName, () => {
  it("handles HTTP 429 rate limit with Retry-After header", async () => {
    let callCount = 0;
    const timestamps: number[] = [];

    const mockFetch = async () => {
      callCount += 1;
      timestamps.push(Date.now());
      if (callCount === 1) {
        return new Response(JSON.stringify({ error: "rate limit exceeded" }), {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": "0",
          },
        });
      }
      return new Response(JSON.stringify({ receipt_id: "rcpt_429_recovered" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const events: HarnessEvent[] = [
      {
        schema: "harness-event-v1",
        sequence: 10,
        timestamp: "2026-08-29T12:00:00.000Z",
        actor: "validator_07",
        kind: "validation_pass",
      },
    ];

    const result = await deliverEventsToWebhook(events, "https://webhook.example.com/stream", {
      customFetch: mockFetch,
      retries: 2,
      backoffBaseMs: 10,
    });

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(2);
    expect(result.deliveredCount).toBe(1);
    expect(result.receiptId).toBe("rcpt_429_recovered");
    expect(callCount).toBe(2);
  });

  it("fails after exceeding max retries on persistent HTTP 500 error", async () => {
    let callCount = 0;
    const mockFetch = async () => {
      callCount += 1;
      return new Response(JSON.stringify({ error: "Internal server error" }), {
        status: 500,
        statusText: "Internal Server Error",
      });
    };

    const events: HarnessEvent[] = [
      {
        schema: "harness-event-v1",
        sequence: 1,
        timestamp: "2026-08-29T00:00:00.000Z",
        actor: "impl_13",
        kind: "task_start",
      },
    ];

    const result = await deliverEventsToWebhook(events, "https://webhook.example.com/stream", {
      customFetch: mockFetch,
      retries: 2,
      backoffBaseMs: 5,
    });

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(500);
    expect(result.attempts).toBe(3);
    expect(result.error).toContain("HTTP 500");
    expect(callCount).toBe(3);
  });

  it("splits large batches into sub-batches according to batchSize option", async () => {
    const deliveredBatches: number[] = [];
    const mockFetch = async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { count: number };
      deliveredBatches.push(body.count);
      return new Response(JSON.stringify({ receipt_id: `rcpt_${deliveredBatches.length}` }), {
        status: 200,
      });
    };

    const events: HarnessEvent[] = Array.from({ length: 7 }, (_, i) => ({
      schema: "harness-event-v1",
      sequence: i + 1,
      timestamp: "2026-08-29T00:00:00.000Z",
      actor: "agent",
      kind: "ping",
    }));

    const result = await deliverEventsToWebhook(events, "https://webhook.example.com/stream", {
      customFetch: mockFetch,
      batchSize: 3,
    });

    expect(result.success).toBe(true);
    expect(result.deliveredCount).toBe(7);
    expect(deliveredBatches).toEqual([3, 3, 1]);
  });
});

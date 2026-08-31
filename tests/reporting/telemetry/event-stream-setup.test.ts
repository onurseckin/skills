import { describe, expect, it } from "bun:test";
import type { HarnessEvent } from "../../../olt/scripts/src/core/contracts/index.ts";
import { deliverEventsToWebhook } from "../../../olt/scripts/src/reporting/event-stream/index.ts";

describe("reporting/event-stream setup suite", () => {
  it("delivers empty batch immediately with 0 network calls", async () => {
    let called = false;
    const mockFetch = async () => {
      called = true;
      return new Response("OK", { status: 200 });
    };

    const result = await deliverEventsToWebhook([], "https://webhook.example.com/events", {
      customFetch: mockFetch,
    });

    expect(result.success).toBe(true);
    expect(result.deliveredCount).toBe(0);
    expect(result.attempts).toBe(0);
    expect(called).toBe(false);
  });

  it("passes custom headers and user-agent in webhook requests", async () => {
    let sentHeaders: HeadersInit | undefined;
    const mockFetch = async (_url: string | URL | Request, init?: RequestInit) => {
      sentHeaders = init?.headers;
      return new Response(JSON.stringify({ receipt_id: "rcpt_custom_headers" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const events: HarnessEvent[] = [
      {
        schema: "harness-event-v1",
        sequence: 1,
        timestamp: "2026-08-29T00:00:00.000Z",
        actor: "validator_07",
        kind: "header_test",
      },
    ];

    const result = await deliverEventsToWebhook(events, "https://webhook.example.com/events", {
      customFetch: mockFetch,
      headers: {
        "X-Custom-Auth": "bearer-secret-token",
        "X-Capsule-Id": "cap-99",
      },
    });

    expect(result.success).toBe(true);
    expect(result.receiptId).toBe("rcpt_custom_headers");
    const headersObj = sentHeaders as Record<string, string>;
    expect(headersObj["X-Custom-Auth"]).toBe("bearer-secret-token");
    expect(headersObj["X-Capsule-Id"]).toBe("cap-99");
  });

  it("fails fast on 400 Bad Request without pointless retries", async () => {
    let callCount = 0;
    const mockFetch = async () => {
      callCount += 1;
      return new Response(JSON.stringify({ error: "malformed payload" }), {
        status: 400,
        statusText: "Bad Request",
      });
    };

    const events: HarnessEvent[] = [
      {
        schema: "harness-event-v1",
        sequence: 1,
        timestamp: "2026-08-29T00:00:00.000Z",
        actor: "impl_13",
        kind: "bad_request_test",
      },
    ];

    const result = await deliverEventsToWebhook(events, "https://webhook.example.com/events", {
      customFetch: mockFetch,
      retries: 5,
    });

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
    expect(result.attempts).toBe(1);
    expect(callCount).toBe(1);
  });
});

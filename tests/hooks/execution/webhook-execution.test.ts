import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { executeWebhookAction, type HookDefinition } from "../../../olt/scripts/src/hooks/index.ts";

export const webhookExecutionSuiteName = "Lifecycle Hooks - Webhook Action Execution";

const spies: Array<{ mockRestore: () => void }> = [];

afterEach(() => {
  for (const s of spies.splice(0)) s.mockRestore();
});

describe(webhookExecutionSuiteName, () => {
  test("dispatches HTTP webhook with JSON payload and custom headers", async () => {
    let receivedEvent: string | null = null;
    let receivedPayload: Record<string, unknown> | null = null;
    let receivedAuthHeader: string | null = null;

    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async (_req, init) => {
      const headers = new Headers(init?.headers);
      receivedAuthHeader = headers.get("Authorization");
      const body = JSON.parse(String(init?.body)) as {
        event: string;
        payload: Record<string, unknown>;
      };
      receivedEvent = body.event;
      receivedPayload = body.payload;
      return new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    spies.push(fetchSpy);

    const hook: HookDefinition = {
      id: "webhook-test-1",
      events: ["mind:pulse"],
      action: "webhook",
      url: "http://virtual.local/webhook",
      method: "POST",
      headers: { Authorization: "Bearer test-token-xyz" },
    };

    const result = await executeWebhookAction(hook, "mind:pulse", { pulse: 42 });
    expect(result.success).toBe(true);
    expect(result.output).toContain("HTTP 200");
    expect(receivedEvent).toBe("mind:pulse");
    expect(receivedPayload).toEqual({ pulse: 42 });
    expect(receivedAuthHeader).toBe("Bearer test-token-xyz");
  });

  test("handles HTTP server error responses gracefully", async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response("Internal Server Error", { status: 500 }),
    );
    spies.push(fetchSpy);

    const hook: HookDefinition = {
      id: "webhook-err-test",
      events: ["critic:reject"],
      action: "webhook",
      url: "http://virtual.local/fail",
    };

    const result = await executeWebhookAction(hook, "critic:reject");
    expect(result.success).toBe(false);
    expect(result.error).toContain("HTTP 500");
  });

  test("handles connection failure / unreachable endpoint without throwing", async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new Error("fetch failed: Connection refused");
    });
    spies.push(fetchSpy);

    const hook: HookDefinition = {
      id: "webhook-unreachable",
      events: ["gate:fail"],
      action: "webhook",
      url: "http://127.0.0.1:59999/unreachable",
      timeout_ms: 500,
    };

    const result = await executeWebhookAction(hook, "gate:fail");
    expect(result.success).toBe(false);
    expect(typeof result.error).toBe("string");
  });

  test("returns failure for missing webhook URL", async () => {
    const hook: HookDefinition = {
      id: "webhook-no-url",
      events: ["run:complete"],
      action: "webhook",
    };

    const result = await executeWebhookAction(hook, "run:complete");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing webhook URL");
  });
});

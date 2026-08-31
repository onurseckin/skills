import { describe, expect, test } from "bun:test";
import {
  executeCustomAction,
  type HookDefinition,
} from "../../../olt/scripts/src/hooks/index.ts";

describe("Lifecycle Hooks - Custom In-Process Handler", () => {
  test("executes custom handler and receives event and payload", async () => {
    let handledEvent: string | null = null;
    let handledPayload: Record<string, unknown> | null = null;

    const hook: HookDefinition = {
      id: "custom-handler-test",
      events: ["task:review"],
      action: "custom",
      handler: (event, payload) => {
        handledEvent = event;
        handledPayload = (payload as Record<string, unknown>) ?? null;
        return { processed: true };
      },
    };

    const result = await executeCustomAction(hook, "task:review", { reviewer: "critic-1" });
    expect(result.success).toBe(true);
    expect(result.output).toContain("processed");
    expect(handledEvent).toBe("task:review");
    expect(handledPayload).toEqual({ reviewer: "critic-1" });
  });

  test("catches throwing custom handler safely without crashing", async () => {
    const hook: HookDefinition = {
      id: "custom-throw-test",
      events: ["repair:start"],
      action: "custom",
      handler: () => {
        throw new Error("Simulated custom handler explosion");
      },
    };

    const result = await executeCustomAction(hook, "repair:start");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Simulated custom handler explosion");
  });

  test("returns failure for missing custom handler function", async () => {
    const hook: HookDefinition = {
      id: "custom-missing-handler",
      events: ["repair:complete"],
      action: "custom",
    };

    const result = await executeCustomAction(hook, "repair:complete");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing custom hook handler function");
  });
});

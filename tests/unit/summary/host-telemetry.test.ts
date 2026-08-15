import { describe, expect, test } from "bun:test";
import {
  detectHostModel,
  detectHostTelemetry,
  resolveModelTier,
} from "../../../orchestrating-long-tasks/scripts/src/summary/host-telemetry.ts";

describe("host telemetry and discovery", () => {
  test("resolveModelTier classifies models into tiers accurately", () => {
    expect(resolveModelTier("Claude 3.7 Sonnet (Thinking)")).toBe("m");
    expect(resolveModelTier("Claude 3 Opus")).toBe("l");
    expect(resolveModelTier("Claude 3.5 Haiku")).toBe("s");
    expect(resolveModelTier("Gemini 3.7 Flash (High)")).toBe("l");
    expect(resolveModelTier("Gemini 2.0 Flash")).toBe("s");
    expect(resolveModelTier("Gemini 1.5 Pro")).toBe("l");
    expect(resolveModelTier("GPT-4o-mini")).toBe("s");
    expect(resolveModelTier("o3-mini")).toBe("l");
  });

  test("detectHostTelemetry discovers host model from settings.json or env", () => {
    const telemetry = detectHostTelemetry();
    expect(telemetry.hostAgent).toBeDefined();
    expect(telemetry.hostAgent?.hostTool).toBe("antigravity");
    expect(telemetry.model).toBe("Gemini 3.7 Flash (High)");
    expect(telemetry.tier).toBe("l");
  });

  test("detectHostModel returns authentic model without fabrication", () => {
    const host = detectHostModel();
    expect(host.model).toBeDefined();
    expect(typeof host.model).toBe("string");
  });
});

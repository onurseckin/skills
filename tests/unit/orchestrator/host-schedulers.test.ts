import { describe, expect, it } from "bun:test";
import {
  HOST_SCHEDULERS_MATRIX,
  assertHostThinkingPolicy,
  getAllHostSchedulers,
  getHostSchedulerConfig,
  isHighThinkingEnforced,
  resolveModelForTier,
  validateHostSchedulerConfig,
} from "../../../olt/scripts/src/orchestrator/host-schedulers.ts";
import type {
  HostSchedulerConfig,
  HostSchedulerId,
} from "../../../olt/scripts/src/orchestrator/host-schedulers.ts";

describe("Host Schedulers Matrix & Thinking Configuration (Wave 3 Task 3.1)", () => {
  it("contains exactly 4 canonical host scheduler configurations", () => {
    const all = getAllHostSchedulers();
    expect(all.length).toBe(4);
    const hostIds = all.map((c) => c.host_id).sort();
    expect(hostIds).toEqual(["antigravity", "claude_code", "codex", "cursor"]);
  });

  it("exports HOST_SCHEDULERS_MATRIX as an immutable dictionary", () => {
    expect(Object.isFrozen(HOST_SCHEDULERS_MATRIX)).toBe(true);
    expect(Object.isFrozen(HOST_SCHEDULERS_MATRIX.antigravity)).toBe(true);
    expect(Object.isFrozen(HOST_SCHEDULERS_MATRIX.claude_code)).toBe(true);
    expect(Object.isFrozen(HOST_SCHEDULERS_MATRIX.codex)).toBe(true);
    expect(Object.isFrozen(HOST_SCHEDULERS_MATRIX.cursor)).toBe(true);
  });

  it("configures antigravity with 5m (300s) cadence, gemini-3.7-flash, high thinking, and 300s SLA", () => {
    const config = getHostSchedulerConfig("antigravity");
    expect(config.host_id).toBe("antigravity");
    expect(config.default_cadence_seconds).toBe(300);
    expect(config.tier_0_2_model).toBe("gemini-3.7-flash");
    expect(config.tier_0_2_thinking).toBe("high");
    expect(config.tier_3_model).toBe("gemini-3.7-flash");
    expect(config.tier_3_thinking).toBe("high");
    expect(config.max_single_task_seconds).toBe(300);
    expect(config.heartbeat_tick_seconds).toBe(60);
    expect(config.watchdog_timeout_seconds).toBe(300);
    expect(isHighThinkingEnforced(config)).toBe(true);
    expect(() => assertHostThinkingPolicy(config)).not.toThrow();

    const validation = validateHostSchedulerConfig(config);
    expect(validation.isValid).toBe(true);
    expect(validation.errors).toEqual([]);
  });

  it("configures claude_code with 15m (900s) cadence, claude-5-opus/sonnet, high thinking, and 300s SLA", () => {
    const config = getHostSchedulerConfig("claude_code");
    expect(config.host_id).toBe("claude_code");
    expect(config.default_cadence_seconds).toBe(900);
    expect(config.tier_0_2_model).toBe("claude-5-opus");
    expect(config.tier_0_2_thinking).toBe("high");
    expect(config.tier_3_model).toBe("claude-5-sonnet");
    expect(config.tier_3_thinking).toBe("high");
    expect(config.max_single_task_seconds).toBe(300);
    expect(config.heartbeat_tick_seconds).toBe(180);
    expect(config.watchdog_timeout_seconds).toBe(900);
    expect(isHighThinkingEnforced(config)).toBe(true);
    expect(() => assertHostThinkingPolicy(config)).not.toThrow();

    const validation = validateHostSchedulerConfig(config);
    expect(validation.isValid).toBe(true);
    expect(validation.errors).toEqual([]);
  });

  it("configures codex with 15m (900s) cadence, gpt-5.6-sol/terra, high thinking, and 300s SLA", () => {
    const config = getHostSchedulerConfig("codex");
    expect(config.host_id).toBe("codex");
    expect(config.default_cadence_seconds).toBe(900);
    expect(config.tier_0_2_model).toBe("gpt-5.6-sol");
    expect(config.tier_0_2_thinking).toBe("high");
    expect(config.tier_3_model).toBe("gpt-5.6-terra");
    expect(config.tier_3_thinking).toBe("high");
    expect(config.max_single_task_seconds).toBe(300);
    expect(config.heartbeat_tick_seconds).toBe(180);
    expect(config.watchdog_timeout_seconds).toBe(900);
    expect(isHighThinkingEnforced(config)).toBe(true);
    expect(() => assertHostThinkingPolicy(config)).not.toThrow();

    const validation = validateHostSchedulerConfig(config);
    expect(validation.isValid).toBe(true);
    expect(validation.errors).toEqual([]);
  });

  it("configures cursor with 5m (300s) cadence, cursor-latest, high thinking, and 300s SLA", () => {
    const config = getHostSchedulerConfig("cursor");
    expect(config.host_id).toBe("cursor");
    expect(config.default_cadence_seconds).toBe(300);
    expect(config.tier_0_2_model).toBe("cursor-latest");
    expect(config.tier_0_2_thinking).toBe("high");
    expect(config.tier_3_model).toBe("cursor-latest");
    expect(config.tier_3_thinking).toBe("high");
    expect(config.max_single_task_seconds).toBe(300);
    expect(config.heartbeat_tick_seconds).toBe(60);
    expect(config.watchdog_timeout_seconds).toBe(300);
    expect(isHighThinkingEnforced(config)).toBe(true);
    expect(() => assertHostThinkingPolicy(config)).not.toThrow();

    const validation = validateHostSchedulerConfig(config);
    expect(validation.isValid).toBe(true);
    expect(validation.errors).toEqual([]);
  });

  it("throws for unknown host scheduler ID in getHostSchedulerConfig", () => {
    const unknownHost = "nonexistent_host" as HostSchedulerId;
    expect(() => getHostSchedulerConfig(unknownHost)).toThrow(/Unknown host scheduler ID/);
  });

  it("assertHostThinkingPolicy throws if tier_0_2_thinking or tier_3_thinking is not high", () => {
    const nonHighT0: HostSchedulerConfig = {
      host_id: "antigravity",
      default_cadence_seconds: 300,
      tier_0_2_model: "gemini-3.7-flash",
      tier_0_2_thinking: "medium",
      tier_3_model: "gemini-3.7-flash",
      tier_3_thinking: "high",
      max_single_task_seconds: 300,
      heartbeat_tick_seconds: 60,
      watchdog_timeout_seconds: 300,
    };
    expect(() => assertHostThinkingPolicy(nonHighT0)).toThrow(/violates high thinking policy/);

    const nonHighT3: HostSchedulerConfig = {
      host_id: "antigravity",
      default_cadence_seconds: 300,
      tier_0_2_model: "gemini-3.7-flash",
      tier_0_2_thinking: "high",
      tier_3_model: "gemini-3.7-flash",
      tier_3_thinking: "low",
      max_single_task_seconds: 300,
      heartbeat_tick_seconds: 60,
      watchdog_timeout_seconds: 300,
    };
    expect(() => assertHostThinkingPolicy(nonHighT3)).toThrow(/violates high thinking policy/);
  });

  it("resolves models and high thinking accurately per tier across all hosts", () => {
    const antigravityT0 = resolveModelForTier("antigravity", "tier_0_2");
    expect(antigravityT0).toEqual({ model: "gemini-3.7-flash", thinking: "high" });

    const antigravityT3 = resolveModelForTier("antigravity", "tier_3");
    expect(antigravityT3).toEqual({ model: "gemini-3.7-flash", thinking: "high" });

    const claudeT0 = resolveModelForTier("claude_code", "tier_0_2");
    expect(claudeT0).toEqual({ model: "claude-5-opus", thinking: "high" });

    const claudeT3 = resolveModelForTier("claude_code", "tier_3");
    expect(claudeT3).toEqual({ model: "claude-5-sonnet", thinking: "high" });

    const codexT0 = resolveModelForTier("codex", "tier_0_2");
    expect(codexT0).toEqual({ model: "gpt-5.6-sol", thinking: "high" });

    const codexT3 = resolveModelForTier("codex", "tier_3");
    expect(codexT3).toEqual({ model: "gpt-5.6-terra", thinking: "high" });

    const cursorT0 = resolveModelForTier("cursor", "tier_0_2");
    expect(cursorT0).toEqual({ model: "cursor-latest", thinking: "high" });

    const cursorT3 = resolveModelForTier("cursor", "tier_3");
    expect(cursorT3).toEqual({ model: "cursor-latest", thinking: "high" });
  });

  it("validates all failure modes in validateHostSchedulerConfig", () => {
    const invalidConfig: HostSchedulerConfig = {
      host_id: "antigravity",
      default_cadence_seconds: 0,
      tier_0_2_model: "  ",
      tier_0_2_thinking: "low",
      tier_3_model: "",
      tier_3_thinking: "none",
      max_single_task_seconds: 600, // Breaches 5-minute boundary
      heartbeat_tick_seconds: 60,
      watchdog_timeout_seconds: 300,
    };

    const validation = validateHostSchedulerConfig(invalidConfig);
    expect(validation.isValid).toBe(false);
    expect(validation.errors.length).toBe(6);
    expect(validation.errors.some((e) => e.includes('Tier 0-2 thinking must be "high"'))).toBe(
      true,
    );
    expect(validation.errors.some((e) => e.includes('Tier 3 thinking must be "high"'))).toBe(true);
    expect(
      validation.errors.some((e) => e.includes("max_single_task_seconds must not exceed 300s")),
    ).toBe(true);
    expect(
      validation.errors.some((e) => e.includes("default_cadence_seconds must be positive")),
    ).toBe(true);
    expect(validation.errors.some((e) => e.includes("tier_0_2_model must not be empty"))).toBe(
      true,
    );
    expect(validation.errors.some((e) => e.includes("tier_3_model must not be empty"))).toBe(true);
  });
});

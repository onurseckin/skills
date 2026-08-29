import { describe, expect, it } from "bun:test";
import {
  getAllHostSchedulers,
  getHostSchedulerConfig,
  isHighThinkingEnforced,
  resolveModelForTier,
  validateHostSchedulerConfig,
} from "../../../olt/scripts/src/orchestrator/host-schedulers.ts";
import type { HostSchedulerConfig } from "../../../olt/scripts/src/mind/preplanning/types.ts";

describe("Host Schedulers Matrix & Thinking Configuration (Task 2.4)", () => {
  it("contains all 4 canonical host scheduler configurations", () => {
    const all = getAllHostSchedulers();
    expect(all.length).toBe(4);
    const hostIds = all.map((c) => c.host_id).sort();
    expect(hostIds).toEqual(["antigravity", "claude_code", "codex", "cursor"]);
  });

  it("configures antigravity with 5m cadence, gemini-3.7-flash, high thinking, and 5m SLA", () => {
    const config = getHostSchedulerConfig("antigravity");
    expect(config.default_cadence_seconds).toBe(300);
    expect(config.tier_0_2_model).toBe("gemini-3.7-flash");
    expect(config.tier_0_2_thinking).toBe("high");
    expect(config.tier_3_model).toBe("gemini-3.7-flash");
    expect(config.tier_3_thinking).toBe("high");
    expect(config.max_single_task_seconds).toBe(300);
    expect(isHighThinkingEnforced(config)).toBe(true);

    const validation = validateHostSchedulerConfig(config);
    expect(validation.isValid).toBe(true);
    expect(validation.errors).toEqual([]);
  });

  it("configures claude_code with 15m cadence, claude-5-opus/sonnet, high thinking, and 5m SLA", () => {
    const config = getHostSchedulerConfig("claude_code");
    expect(config.default_cadence_seconds).toBe(900);
    expect(config.tier_0_2_model).toBe("claude-5-opus");
    expect(config.tier_3_model).toBe("claude-5-sonnet");
    expect(config.tier_0_2_thinking).toBe("high");
    expect(config.tier_3_thinking).toBe("high");
    expect(config.max_single_task_seconds).toBe(300);
    expect(isHighThinkingEnforced(config)).toBe(true);

    const validation = validateHostSchedulerConfig(config);
    expect(validation.isValid).toBe(true);
  });

  it("configures codex with 15m cadence, gpt-5.6-sol/terra, high thinking, and 5m SLA", () => {
    const config = getHostSchedulerConfig("codex");
    expect(config.default_cadence_seconds).toBe(900);
    expect(config.tier_0_2_model).toBe("gpt-5.6-sol");
    expect(config.tier_3_model).toBe("gpt-5.6-terra");
    expect(config.tier_0_2_thinking).toBe("high");
    expect(config.tier_3_thinking).toBe("high");
    expect(config.max_single_task_seconds).toBe(300);
    expect(isHighThinkingEnforced(config)).toBe(true);

    const validation = validateHostSchedulerConfig(config);
    expect(validation.isValid).toBe(true);
  });

  it("configures cursor with 5m cadence, cursor-latest, high thinking, and 5m SLA", () => {
    const config = getHostSchedulerConfig("cursor");
    expect(config.default_cadence_seconds).toBe(300);
    expect(config.tier_0_2_model).toBe("cursor-latest");
    expect(config.tier_3_model).toBe("cursor-latest");
    expect(config.tier_0_2_thinking).toBe("high");
    expect(config.tier_3_thinking).toBe("high");
    expect(config.max_single_task_seconds).toBe(300);
    expect(isHighThinkingEnforced(config)).toBe(true);

    const validation = validateHostSchedulerConfig(config);
    expect(validation.isValid).toBe(true);
  });

  it("resolves models and high thinking accurately per tier", () => {
    const claudeT0 = resolveModelForTier("claude_code", "tier_0_2");
    expect(claudeT0.model).toBe("claude-5-opus");
    expect(claudeT0.thinking).toBe("high");

    const claudeT3 = resolveModelForTier("claude_code", "tier_3");
    expect(claudeT3.model).toBe("claude-5-sonnet");
    expect(claudeT3.thinking).toBe("high");

    const codexT0 = resolveModelForTier("codex", "tier_0_2");
    expect(codexT0.model).toBe("gpt-5.6-sol");

    const codexT3 = resolveModelForTier("codex", "tier_3");
    expect(codexT3.model).toBe("gpt-5.6-terra");
  });

  it("detects invalid configurations breaching high thinking or 5-minute SLA", () => {
    const invalidThinking: HostSchedulerConfig = {
      host_id: "antigravity",
      default_cadence_seconds: 300,
      tier_0_2_model: "gemini-3.7-flash",
      tier_0_2_thinking: "low",
      tier_3_model: "gemini-3.7-flash",
      tier_3_thinking: "none",
      max_single_task_seconds: 600, // Breaches 5-minute boundary
      heartbeat_tick_seconds: 60,
      watchdog_timeout_seconds: 300,
    };

    const validation = validateHostSchedulerConfig(invalidThinking);
    expect(validation.isValid).toBe(false);
    expect(validation.errors.length).toBe(3);
    expect(validation.errors.some((e) => e.includes('Tier 0-2 thinking must be "high"'))).toBe(
      true,
    );
    expect(validation.errors.some((e) => e.includes('Tier 3 thinking must be "high"'))).toBe(true);
    expect(
      validation.errors.some((e) => e.includes("max_single_task_seconds must not exceed 300s")),
    ).toBe(true);
  });
});

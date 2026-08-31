import { describe, expect, test } from "bun:test";
import {
  isAgentGrantRecord,
  isAgentModelTier,
  isAgentToolRef,
  isTelemetryFieldConflict,
  isThinkingLevel,
} from "../../olt/scripts/src/core/contracts/index.ts";
import { evidenced } from "../../olt/scripts/src/core/contracts/index.ts";

describe("core contracts/agents", () => {
  test("isThinkingLevel validates thinking levels", () => {
    expect(isThinkingLevel("low")).toBe(true);
    expect(isThinkingLevel("medium")).toBe(true);
    expect(isThinkingLevel("high")).toBe(true);
    expect(isThinkingLevel("xhigh")).toBe(true);
    expect(isThinkingLevel("unknown")).toBe(true);
    expect(isThinkingLevel("none")).toBe(false);
    expect(isThinkingLevel(123)).toBe(false);
    expect(isThinkingLevel(null)).toBe(false);
  });

  test("isAgentModelTier validates model tiers", () => {
    expect(isAgentModelTier("xs")).toBe(true);
    expect(isAgentModelTier("s")).toBe(true);
    expect(isAgentModelTier("m")).toBe(true);
    expect(isAgentModelTier("l")).toBe(true);
    expect(isAgentModelTier("unknown")).toBe(true);
    expect(isAgentModelTier("pro")).toBe(false);
    expect(isAgentModelTier(null)).toBe(false);
  });

  test("isAgentToolRef validates tool references", () => {
    expect(isAgentToolRef({ name: "bash" })).toBe(true);
    expect(isAgentToolRef({ name: "git", category: "terminal" })).toBe(true);
    expect(isAgentToolRef({ name: "test", extras: { timeout: 10 } })).toBe(true);
    expect(isAgentToolRef({ name: "" })).toBe(false);
    expect(isAgentToolRef(null)).toBe(false);
    expect(isAgentToolRef({ name: "bad", category: 123 })).toBe(false);
  });

  test("isTelemetryFieldConflict validates field conflicts", () => {
    const validConflict = {
      field: "model",
      recorded_value: "gpt-4",
      recorded_evidence_class: "harness_observed",
      probed_value: "claude-3",
      probed_evidence_class: "agent_reported",
    };
    expect(isTelemetryFieldConflict(validConflict)).toBe(true);
    expect(isTelemetryFieldConflict({ ...validConflict, field: "" })).toBe(false);
    expect(isTelemetryFieldConflict({ ...validConflict, recorded_value: undefined })).toBe(false);
    expect(isTelemetryFieldConflict({ ...validConflict, recorded_evidence_class: "invalid" })).toBe(
      false,
    );
    expect(isTelemetryFieldConflict(null)).toBe(false);
  });

  test("isAgentGrantRecord validates grant records and telemetry conflicts", () => {
    const validGrant = {
      id: "grant-1",
      role: "implementer",
      parent_agent_id: null,
      parent_task_id: "T-1",
      host: "darwin",
      granted_at: "2026-08-24T00:00:00.000Z",
      status: "active",
      provider: evidenced("google", "harness_observed"),
      model: evidenced("gemini-2.0", "harness_observed"),
      model_tier: evidenced("l", "harness_observed"),
      thinking_level: evidenced("high", "harness_observed"),
      context_window: evidenced(1000000, "harness_observed"),
      tools_granted: evidenced([{ name: "bun" }], "harness_observed"),
      tokens_in: evidenced(100, "agent_reported"),
      tokens_out: evidenced(200, "agent_reported"),
      token_extras: {
        cache_read: evidenced(50, "agent_reported"),
      },
      tools_used: [
        {
          name: "bun",
          evidence_class: "harness_observed",
          first_reported_at: "2026-08-24T00:00:01.000Z",
        },
      ],
      telemetry_conflicts: [
        {
          field: "tokens_in",
          recorded_value: 100,
          recorded_evidence_class: "agent_reported",
          probed_value: 105,
          probed_evidence_class: "derived",
        },
      ],
    };

    expect(isAgentGrantRecord(validGrant)).toBe(true);
    expect(isAgentGrantRecord({ ...validGrant, status: "invalid_status" })).toBe(false);
    expect(isAgentGrantRecord({ ...validGrant, id: "" })).toBe(false);
    expect(isAgentGrantRecord({ ...validGrant, telemetry_conflicts: [{ field: "" }] })).toBe(false);
    expect(isAgentGrantRecord(null)).toBe(false);
  });
});

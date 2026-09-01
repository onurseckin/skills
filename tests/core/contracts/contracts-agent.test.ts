import { describe, expect, it } from "bun:test";
import {
  isThinkingLevel,
  isAgentModelTier,
  isAgentToolRef,
  isTelemetryFieldConflict,
  isAgentGrantRecord,
  THINKING_LEVELS,
  AGENT_MODEL_TIERS,
} from "../../../olt/scripts/src/core/contracts/agents/agents.ts";
import {
  isValidatorDomain,
  textSignalsUiDomain,
  applicableValidatorDomains,
  uiDomainApplies,
  isCoordinatorPushbackCause,
  isMicroCycleRecord,
  isStructuredFinding,
  isCoordinatorPushback,
  VALIDATOR_DOMAINS,
} from "../../../olt/scripts/src/core/contracts/agents/workflow.ts";
import { evidenced } from "../../../olt/scripts/src/core/contracts/system/evidence.ts";
describe("core/contracts/agents/agents.ts", () => {
  it("validates thinking levels and model tiers", () => {
    for (const lvl of THINKING_LEVELS) {
      expect(isThinkingLevel(lvl)).toBe(true);
    }
    expect(isThinkingLevel("invalid")).toBe(false);

    for (const tier of AGENT_MODEL_TIERS) {
      expect(isAgentModelTier(tier)).toBe(true);
    }
    expect(isAgentModelTier("xl")).toBe(false);
  });

  it("validates agent tool refs and telemetry conflicts", () => {
    expect(isAgentToolRef({ name: "bash" })).toBe(true);
    expect(isAgentToolRef({ name: "bash", category: "shell", extras: { timeout: 100 } })).toBe(
      true,
    );
    expect(isAgentToolRef({ name: "  " })).toBe(false);
    expect(isAgentToolRef({ name: "bash", category: "  " })).toBe(false);
    expect(isAgentToolRef(null)).toBe(false);

    const conflict = {
      field: "model",
      recorded_value: "gpt-4o",
      recorded_evidence_class: "agent_reported" as const,
      probed_value: "gpt-4o-mini",
      probed_evidence_class: "harness_observed" as const,
    };
    expect(isTelemetryFieldConflict(conflict)).toBe(true);
    expect(isTelemetryFieldConflict({ ...conflict, field: "" })).toBe(false);
    expect(isTelemetryFieldConflict({ ...conflict, recorded_evidence_class: "bad" })).toBe(false);
    expect(isTelemetryFieldConflict(null)).toBe(false);
  });

  it("validates agent grant records comprehensively", () => {
    const grant = {
      id: "grant-1",
      role: "implementer" as const,
      parent_agent_id: null,
      parent_task_id: "task-0",
      host: "antigravity",
      granted_at: "2026-08-30T00:00:00Z",
      status: "active" as const,
      host_address: "agent-1",
      released_at: undefined,
      release_reason: undefined,
      provider: evidenced("anthropic", "agent_reported"),
      model: evidenced("claude-3-5-sonnet", "agent_reported"),
      model_tier: evidenced("l" as const, "derived"),
      thinking_level: evidenced("high" as const, "agent_reported"),
      context_window: evidenced(200000, "agent_reported"),
      tools_granted: evidenced([{ name: "bash" }], "agent_reported"),
      tools_used: [
        {
          name: "bash",
          evidence_class: "harness_observed" as const,
          first_reported_at: "2026-08-30T00:01:00Z",
        },
      ],
      tokens_in: evidenced(1000, "agent_reported"),
      tokens_out: evidenced(500, "agent_reported"),
      token_extras: { cache_read: evidenced(200, "agent_reported") },
      last_reported_at: "2026-08-30T00:02:00Z",
      report_count: 3,
      telemetry_conflicts: [],
    };
    expect(isAgentGrantRecord(grant)).toBe(true);
    expect(isAgentGrantRecord(null)).toBe(false);
    expect(isAgentGrantRecord({ ...grant, id: "" })).toBe(false);
    expect(isAgentGrantRecord({ ...grant, role: "bad-role" })).toBe(false);
    expect(isAgentGrantRecord({ ...grant, status: "unknown-status" })).toBe(false);
    expect(isAgentGrantRecord({ ...grant, report_count: "3" })).toBe(false);
    expect(
      isAgentGrantRecord({ ...grant, tokens_in: { value: "not-int", evidence_class: "derived" } }),
    ).toBe(false);
    expect(isAgentGrantRecord({ ...grant, token_extras: { bad: "not-evidenced" } })).toBe(false);
  });
});

describe("core/contracts/agents/workflow.ts", () => {
  it("validates validator domains and applicability heuristics", () => {
    for (const d of VALIDATOR_DOMAINS) {
      expect(isValidatorDomain(d)).toBe(true);
    }
    expect(isValidatorDomain("random")).toBe(false);

    expect(textSignalsUiDomain(["This updates the visual layout and DOM metrics"])).toBe(true);
    expect(textSignalsUiDomain(["Fix database query performance"])).toBe(false);

    const domainsUi = applicableValidatorDomains(["src/components/button.tsx"], []);
    expect(domainsUi).toContain("ui-design");
    expect(domainsUi).toContain("code-quality");

    const domainsSchema = applicableValidatorDomains(["schema/user.proto"], []);
    expect(domainsSchema).toContain("system-design");

    expect(uiDomainApplies(["src/view.vue"])).toBe(true);
    expect(uiDomainApplies(["src/api.ts"])).toBe(false);
    expect(uiDomainApplies(["src/api.ts"], ["Fix frontend button styling"])).toBe(true);
  });

  it("validates micro cycle, structured finding, and coordinator pushback", () => {
    expect(isCoordinatorPushbackCause("procedural")).toBe(true);
    expect(isCoordinatorPushbackCause("substantive")).toBe(true);
    expect(isCoordinatorPushbackCause("other")).toBe(false);

    const microCycle = {
      round: 1,
      validator_id: "val-1",
      critique: "Needs more assertion coverage",
      created_at: "2026-08-30T00:00:00Z",
      status: "open" as const,
      suggested_remediation: "Add edge case tests",
    };
    expect(isMicroCycleRecord(microCycle)).toBe(true);
    expect(isMicroCycleRecord({ ...microCycle, round: 0 })).toBe(false);
    expect(isMicroCycleRecord({ ...microCycle, status: "pending" })).toBe(false);
    expect(isMicroCycleRecord(null)).toBe(false);

    const finding = {
      id: "f-1",
      requirement_id: "req-1",
      severity: "critical" as const,
      observation: "Null pointer exception on empty input",
      evidence: [{ log: "stack trace" }],
      remediation: "Add null check",
      revalidation: "Run unit test with empty input",
      status: "open" as const,
    };
    expect(isStructuredFinding(finding)).toBe(true);
    expect(isStructuredFinding({ ...finding, severity: "low" })).toBe(false);
    expect(isStructuredFinding({ ...finding, evidence: "not-array" })).toBe(false);
    expect(isStructuredFinding(null)).toBe(false);

    const pushback = {
      id: "pb-1",
      validator_id: "val-1",
      domain: "code-quality" as const,
      cause: "procedural" as const,
      observation: "Missing probe execution",
      remediation: "Run adversarial probe",
      review_round: 1,
      created_at: "2026-08-30T00:00:00Z",
    };
    expect(isCoordinatorPushback(pushback)).toBe(true);
    expect(isCoordinatorPushback({ ...pushback, domain: "bad-domain" })).toBe(false);
    expect(isCoordinatorPushback({ ...pushback, cause: "invalid-cause" })).toBe(false);
    expect(isCoordinatorPushback(null)).toBe(false);
  });
});

import { describe, expect, it } from "bun:test";
import { checkTier0CompanionsHealth } from "../../../olt/scripts/src/reporting/doctor/tier0-companions-engine.ts";

export const tier0CompanionsEngineSuiteName =
  "Tier 0 Companion Auditors Health Engine (checkTier0CompanionsHealth)";

describe(tier0CompanionsEngineSuiteName, () => {
  it("passes cleanly when state is null or non-mind capsule", () => {
    const res1 = checkTier0CompanionsHealth({ state: null });
    expect(res1.passed).toBe(true);
    expect(res1.findings).toHaveLength(0);

    const res2 = checkTier0CompanionsHealth({ state: { run_id: "run-orchestrator-1", tasks: {} } });
    expect(res2.passed).toBe(true);
    expect(res2.findings).toHaveLength(0);
  });

  it("detects missing mind-auditor companion in Mind capsule", () => {
    const state = {
      mind: { generation: 1 },
      grants: [
        { id: "mind-1", role: "mind", status: "active" },
        { id: "mind-1-skill-auditor", role: "skill-auditor", status: "active" },
      ],
    };

    const res = checkTier0CompanionsHealth({ state });
    expect(res.passed).toBe(false);
    expect(res.findings.some((f) => f.code === "MISSING_MIND_AUDITOR_COMPANION")).toBe(true);
    expect(res.findings.some((f) => f.severity === "ERROR")).toBe(true);
  });

  it("detects missing skill-auditor companion in Mind capsule", () => {
    const state = {
      pulse: { counter: 1 },
      grants: [
        { id: "mind-1", role: "mind", status: "active" },
        { id: "mind-1-mind-auditor", role: "mind-auditor", status: "active" },
      ],
    };

    const res = checkTier0CompanionsHealth({ state });
    expect(res.passed).toBe(false);
    expect(res.findings.some((f) => f.code === "MISSING_SKILL_AUDITOR_COMPANION")).toBe(true);
    expect(res.findings.some((f) => f.severity === "ERROR")).toBe(true);
  });

  it("passes when both mandatory companion auditors are active", () => {
    const state = {
      mind: { generation: 1 },
      pulse: { counter: 5 },
      grants: [
        { id: "mind-1", role: "mind", status: "active" },
        { id: "mind-1-mind-auditor", role: "mind-auditor", status: "active" },
        { id: "mind-1-skill-auditor", role: "skill-auditor", status: "active" },
      ],
    };

    const res = checkTier0CompanionsHealth({ state });
    expect(res.passed).toBe(true);
    expect(res.findings).toHaveLength(0);
  });

  it("flags chronic idle stagnation warning when consecutive zero-delta >= 2", () => {
    const state = {
      mind: { generation: 1 },
      pulse: { counter: 3, consecutive_zero_delta: 2 },
      grants: [
        { id: "mind-1", role: "mind", status: "active" },
        { id: "mind-1-mind-auditor", role: "mind-auditor", status: "active" },
        { id: "mind-1-skill-auditor", role: "skill-auditor", status: "active" },
      ],
    };

    const res = checkTier0CompanionsHealth({ state });
    expect(res.passed).toBe(true);
    expect(res.findings.some((f) => f.code === "CHRONIC_IDLE_STAGNATION_DETECTED")).toBe(true);
    expect(res.findings.some((f) => f.severity === "WARN")).toBe(true);
  });

  it("detects multiple active skill-auditor companions as an error", () => {
    const state = {
      mind: { generation: 1 },
      grants: [
        { id: "mind-1", role: "mind", status: "active" },
        { id: "mind-1-mind-auditor", role: "mind-auditor", status: "active" },
        { id: "mind-1-skill-auditor-1", role: "skill-auditor", status: "active" },
        { id: "mind-1-skill-auditor-2", role: "skill-auditor", status: "active" },
      ],
    };

    const res = checkTier0CompanionsHealth({ state });
    expect(res.passed).toBe(false);
    expect(res.findings.some((f) => f.code === "MULTIPLE_SKILL_AUDITORS_DETECTED")).toBe(true);
    const finding = res.findings.find((f) => f.code === "MULTIPLE_SKILL_AUDITORS_DETECTED");
    expect(finding?.severity).toBe("ERROR");
    expect(finding?.message).toContain("Skill Auditor must be a singleton");
  });

  it("audits pulse interval and warns when cadence is not 5m or 15m", () => {
    const validState5m = {
      mind: { generation: 1 },
      pulse: { counter: 1, interval: "5m" },
      grants: [
        { id: "mind-1", role: "mind", status: "active" },
        { id: "mind-1-mind-auditor", role: "mind-auditor", status: "active" },
        { id: "mind-1-skill-auditor", role: "skill-auditor", status: "active" },
      ],
    };
    const res5m = checkTier0CompanionsHealth({ state: validState5m });
    expect(res5m.findings.some((f) => f.code === "INVALID_MIND_CADENCE_INTERVAL")).toBe(false);

    const validState15m = {
      mind: { generation: 1 },
      pulse: { counter: 1, cron: "15m" },
      grants: [
        { id: "mind-1", role: "mind", status: "active" },
        { id: "mind-1-mind-auditor", role: "mind-auditor", status: "active" },
        { id: "mind-1-skill-auditor", role: "skill-auditor", status: "active" },
      ],
    };
    const res15m = checkTier0CompanionsHealth({ state: validState15m });
    expect(res15m.findings.some((f) => f.code === "INVALID_MIND_CADENCE_INTERVAL")).toBe(false);

    const invalidState = {
      mind: { generation: 1 },
      pulse: { counter: 1, interval: "30m" },
      grants: [
        { id: "mind-1", role: "mind", status: "active" },
        { id: "mind-1-mind-auditor", role: "mind-auditor", status: "active" },
        { id: "mind-1-skill-auditor", role: "skill-auditor", status: "active" },
      ],
    };
    const resInvalid = checkTier0CompanionsHealth({ state: invalidState });
    expect(resInvalid.findings.some((f) => f.code === "INVALID_MIND_CADENCE_INTERVAL")).toBe(true);
    const finding = resInvalid.findings.find((f) => f.code === "INVALID_MIND_CADENCE_INTERVAL");
    expect(finding?.severity).toBe("WARN");
    expect(finding?.message).toContain("does not match expected 5m or 15m cadence");
  });

  it("detects missing charter policy files in repoRoot", () => {
    const state = {
      mind: { generation: 1 },
      grants: [
        { id: "mind-1", role: "mind", status: "active" },
        { id: "mind-1-mind-auditor", role: "mind-auditor", status: "active" },
        { id: "mind-1-skill-auditor", role: "skill-auditor", status: "active" },
      ],
    };

    const res = checkTier0CompanionsHealth({ state, repoRoot: "/non/existent/repo/dir" });
    expect(res.passed).toBe(false);
    expect(res.findings.some((f) => f.code === "MISSING_MIND_POLICY_CHARTER")).toBe(true);
    const finding = res.findings.find((f) => f.code === "MISSING_MIND_POLICY_CHARTER");
    expect(finding?.severity).toBe("ERROR");
  });
});

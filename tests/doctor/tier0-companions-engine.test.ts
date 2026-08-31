import { describe, expect, it } from "bun:test";
import { checkTier0CompanionsHealth } from "../../olt/scripts/src/reporting/doctor/tier0-companions-engine.ts";

describe("Tier 0 Companion Auditors Health Engine (checkTier0CompanionsHealth)", () => {
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
    expect(res.passed).toBe(true); // Warning does not block pass
    expect(res.findings.some((f) => f.code === "CHRONIC_IDLE_STAGNATION_DETECTED")).toBe(true);
    expect(res.findings.some((f) => f.severity === "WARN")).toBe(true);
  });
});

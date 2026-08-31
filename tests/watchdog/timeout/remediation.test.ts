import { describe, expect, it } from "bun:test";
import { buildRemediationGuidance } from "../../../olt/scripts/src/watchdog/process-timeout/remediation.ts";

describe("buildRemediationGuidance Role-Specific Routing", () => {
  it("builds remediation guidance for completeness critic with single-file scoped test directive", () => {
    const guidance = buildRemediationGuidance({
      role: "completeness_critic",
      errorClassification: "STALL_TIMEOUT",
    });

    expect(guidance.action).toBe("autonomous_repair_routing");
    expect(guidance.supervisorTarget).toBe("coordinator");
    expect(guidance.defectReference).toBe("defect-20260822-24");
    expect(guidance.fallbackDirective).toContain("Re-run only single-file scoped unit test");
    expect(guidance.prescribedSteps.some((s) => s.includes("SIGKILL"))).toBe(true);
  });

  it("builds remediation guidance for task implementer with bounded timeout re-dispatch", () => {
    const guidance = buildRemediationGuidance({
      role: "task_implementer",
      errorClassification: "STALL_TIMEOUT",
    });

    expect(guidance.action).toBe("autonomous_repair_routing");
    expect(guidance.supervisorTarget).toBe("coordinator");
    expect(guidance.defectReference).toBe("defect-20260822-28");
    expect(guidance.fallbackDirective).toContain("tightened scope or fresh subagent worker");
  });

  it("builds remediation guidance for coordinator escalating to orchestrator", () => {
    const guidance = buildRemediationGuidance({
      role: "coordinator",
      errorClassification: "STALL_TIMEOUT",
    });

    expect(guidance.action).toBe("escalate_to_supervisor");
    expect(guidance.supervisorTarget).toBe("orchestrator");
    expect(guidance.fallbackDirective).toContain("Orchestrator assumes direct lane coordination");
  });

  it("builds remediation guidance for orchestrator escalating to mind", () => {
    const guidance = buildRemediationGuidance({
      role: "orchestrator",
      errorClassification: "STALL_TIMEOUT",
    });

    expect(guidance.action).toBe("escalate_to_supervisor");
    expect(guidance.supervisorTarget).toBe("mind");
    expect(guidance.fallbackDirective).toContain("Mind initiates autonomous wave replanning");
  });

  it("builds default fallback guidance for unspecified or generic worker roles", () => {
    const guidance = buildRemediationGuidance({
      role: "generic_unknown",
      errorClassification: "WALL_TIMEOUT",
      supervisorTier: "custom_supervisor",
    });

    expect(guidance.action).toBe("autonomous_repair_routing");
    expect(guidance.supervisorTarget).toBe("custom_supervisor");
  });
});

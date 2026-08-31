import { describe, expect, it } from "bun:test";
import { buildRemediationGuidance } from "../../../olt/scripts/src/engine/runner/process/watchdog-remediation.ts";

describe("engine/runner/process/watchdog-remediation.ts", () => {
  it("builds remediation guidance for completeness_critic role with default defect reference", () => {
    const guidance = buildRemediationGuidance({
      role: "completeness_critic",
      errorClassification: "STALL_TIMEOUT",
    });

    expect(guidance.action).toBe("autonomous_repair_routing");
    expect(guidance.defectReference).toBe("defect-20260822-24");
    expect(guidance.supervisorTarget).toBe("coordinator");
    expect(guidance.fallbackDirective).toContain("Re-run only single-file scoped unit test");
    expect(guidance.prescribedSteps.length).toBe(5);
    expect(guidance.summary).toContain("Stalled completeness critic");
  });

  it("builds remediation guidance for critic role with custom defect reference and childRole override", () => {
    const guidance = buildRemediationGuidance({
      childRole: "critic",
      role: "implementer", // childRole takes precedence
      errorClassification: "STALL_TIMEOUT",
      defectReference: "defect-custom-1",
      taskId: "task-123",
      gateId: "gate-abc",
    });

    expect(guidance.action).toBe("autonomous_repair_routing");
    expect(guidance.defectReference).toBe("defect-custom-1");
    expect(guidance.supervisorTarget).toBe("coordinator");
    expect(guidance.prescribedSteps).toContain(
      "Enforce SIGKILL on stalled test runner / critic subprocess tree immediately.",
    );
  });

  it("builds remediation guidance for task_implementer role with default defect reference", () => {
    const guidance = buildRemediationGuidance({
      role: "task_implementer",
      errorClassification: "STALL_TIMEOUT",
    });

    expect(guidance.action).toBe("autonomous_repair_routing");
    expect(guidance.defectReference).toBe("defect-20260822-28");
    expect(guidance.supervisorTarget).toBe("coordinator");
    expect(guidance.fallbackDirective).toBe(
      "Reassign task with tightened scope or fresh subagent worker.",
    );
    expect(guidance.prescribedSteps.length).toBe(5);
    expect(guidance.summary).toContain("Stalled task implementer execution detected");
  });

  it("builds remediation guidance for implementer and worker roles", () => {
    const guidanceImpl = buildRemediationGuidance({
      role: "implementer",
      errorClassification: "STALL_TIMEOUT",
      defectReference: "defect-custom-2",
    });
    expect(guidanceImpl.defectReference).toBe("defect-custom-2");
    expect(guidanceImpl.supervisorTarget).toBe("coordinator");

    // Default when no role is specified defaults to "worker" which is implementer tier
    const guidanceWorker = buildRemediationGuidance({
      errorClassification: "STALL_TIMEOUT",
    });
    expect(guidanceWorker.action).toBe("autonomous_repair_routing");
    expect(guidanceWorker.defectReference).toBe("defect-20260822-28");
    expect(guidanceWorker.supervisorTarget).toBe("coordinator");
  });

  it("builds remediation guidance for coordinator role with default and custom defect references", () => {
    const guidance = buildRemediationGuidance({
      role: "coordinator",
      errorClassification: "STALL_TIMEOUT",
    });

    expect(guidance.action).toBe("escalate_to_supervisor");
    expect(guidance.defectReference).toBe("defect-20260822-24");
    expect(guidance.supervisorTarget).toBe("orchestrator");
    expect(guidance.fallbackDirective).toContain("Orchestrator assumes direct lane coordination");
    expect(guidance.prescribedSteps.length).toBe(4);

    const guidanceCustom = buildRemediationGuidance({
      role: "coordinator",
      errorClassification: "STALL_TIMEOUT",
      defectReference: "defect-coord-custom",
    });
    expect(guidanceCustom.defectReference).toBe("defect-coord-custom");
  });

  it("builds remediation guidance for orchestrator role with default and custom defect references", () => {
    const guidance = buildRemediationGuidance({
      role: "orchestrator",
      errorClassification: "STALL_TIMEOUT",
    });

    expect(guidance.action).toBe("escalate_to_supervisor");
    expect(guidance.defectReference).toBe("defect-20260822-24");
    expect(guidance.supervisorTarget).toBe("mind");
    expect(guidance.fallbackDirective).toContain("Mind initiates autonomous wave replanning");
    expect(guidance.prescribedSteps.length).toBe(3);

    const guidanceCustom = buildRemediationGuidance({
      role: "orchestrator",
      errorClassification: "STALL_TIMEOUT",
      defectReference: "defect-orch-custom",
    });
    expect(guidanceCustom.defectReference).toBe("defect-orch-custom");
  });

  it("builds fallback guidance for unknown roles with default and custom supervisor tiers", () => {
    const guidanceDefault = buildRemediationGuidance({
      role: "unknown_custom_role",
      errorClassification: "UNKNOWN_ERROR",
    });

    expect(guidanceDefault.action).toBe("autonomous_repair_routing");
    expect(guidanceDefault.defectReference).toBe("defect-20260822-28");
    expect(guidanceDefault.supervisorTarget).toBe("coordinator");
    expect(guidanceDefault.summary).toContain("Mechanical process timeout watchdog");
    expect(guidanceDefault.prescribedSteps.length).toBe(4);

    const guidanceCustom = buildRemediationGuidance({
      role: "unknown_custom_role",
      supervisorTier: "custom_tier_supervisor",
      errorClassification: "CRASH",
      defectReference: "defect-custom-unknown",
    });

    expect(guidanceCustom.supervisorTarget).toBe("custom_tier_supervisor");
    expect(guidanceCustom.defectReference).toBe("defect-custom-unknown");
  });
});

import { describe, expect, it } from "bun:test";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  assertCompanionAuditorsDoctor,
  auditCompanionAuditors,
  checkCompanionAuditorsDoctor,
  isCompanionAuditorCompliant,
} from "../../../olt/scripts/src/reporting/doctor/rules/companion-auditors.ts";

describe("Doctor Rule - Companion Auditors Coverage", () => {
  it("evaluates non-mandatory targets and worker-only grants cleanly", () => {
    const nonMandatory = auditCompanionAuditors({ repoRoot: "/tmp/custom-app" });
    expect(nonMandatory.length).toBe(0);

    const workerGrants = auditCompanionAuditors({
      grants: [
        { id: "worker-1", role: "implementer", status: "active" },
        { id: "worker-2", role: "tester", status: "active" },
        { id: "worker-3", role: "mind-auditor", status: "inactive" },
        null,
        "invalid-grant",
      ],
    });
    expect(workerGrants.length).toBe(0);
  });

  it("handles state resolution fallbacks, explicit mind, and orchestrator triggers", () => {
    const stateWithAgents = {
      agents: [
        { id: "sub-1", role: "mind", status: "active" },
        { id: "sub-2", role: "implementer", status: "active" },
      ],
    };
    const findingsWithAgents = auditCompanionAuditors({ state: stateWithAgents });
    expect(findingsWithAgents.some((f) => f.code === "MISSING_MIND_AUDITOR")).toBe(true);
    expect(findingsWithAgents.some((f) => f.code === "MISSING_SKILL_AUDITOR")).toBe(true);

    const stateWithGrants = {
      grants: [{ id: "orch-1", role: "orchestrator", status: "active" }],
    };
    const findingsWithGrants = auditCompanionAuditors({ state: stateWithGrants });
    expect(findingsWithGrants.some((f) => f.code === "MISSING_SKILL_AUDITOR")).toBe(true);

    const explicitMindState = auditCompanionAuditors({
      state: { pulse: "pulse-123", mind: true, run_id: "run-mind-001" },
    });
    expect(explicitMindState.some((f) => f.code === "MISSING_MIND_AUDITOR")).toBe(true);

    const explicitOrchState = auditCompanionAuditors({
      state: { orchestrator: true, run_id: "run-orchestrator-001" },
    });
    expect(explicitOrchState.some((f) => f.code === "MISSING_SKILL_AUDITOR")).toBe(true);

    const emptyCorruptState = auditCompanionAuditors({ state: { custom_flag: true } });
    expect(emptyCorruptState.length).toBe(0);
  });

  it("identifies companion roles, meta-auditors, and flags singleton conflicts", () => {
    const metaAuditorGrants = [
      { id: "meta-1", role: "meta-auditor", status: "active" },
      { id: "mind-lead", role: "mind", status: "active" },
      { id: "orch-lead", role: "orchestrator", status: "active" },
    ];
    const metaFindings = auditCompanionAuditors({ grants: metaAuditorGrants });
    expect(metaFindings.some((f) => f.severity === "ERROR")).toBe(false);

    const idBasedAuditors = [
      { id: "agent-mind-auditor-1", role: "custom-worker", status: "active" },
      { id: "agent-skill-auditor-1", role: "custom-worker", status: "active" },
      { id: "agent-mind-root", role: "supervisor", status: "active" },
    ];
    const idFindings = auditCompanionAuditors({ grants: idBasedAuditors });
    expect(idFindings.some((f) => f.severity === "ERROR")).toBe(false);

    const conflictingGrants = [
      { id: "mind-aud-1", role: "mind-auditor", status: "active" },
      { id: "mind-aud-2", role: "mind-auditor", status: "active" },
      { id: "skill-aud-1", role: "skill-auditor", status: "active" },
      { id: "skill-aud-2", role: "skill-auditor", status: "active" },
      { id: "mind-0", role: "mind", status: "active" },
    ];
    const conflictFindings = auditCompanionAuditors({ grants: conflictingGrants });
    const warnConflicts = conflictFindings.filter((f) => f.code === "COMPANION_AUDITOR_CONFLICT");
    expect(warnConflicts.length).toBe(2);
    expect(warnConflicts.every((f) => f.severity === "WARN")).toBe(true);
  });

  it("validates checkCompanionAuditorsDoctor, isCompanionAuditorCompliant, and assertCompanionAuditorsDoctor", () => {
    const failingOptions = { grants: [] };
    const checkResultFail = checkCompanionAuditorsDoctor(failingOptions);
    expect(checkResultFail.engine).toBe("checkCompanionAuditors");
    expect(checkResultFail.passed).toBe(false);
    expect(isCompanionAuditorCompliant(failingOptions)).toBe(false);
    expect(() => assertCompanionAuditorsDoctor(failingOptions)).toThrow(HarnessError);

    const passingOptions = {
      grants: [
        { id: "mind-auditor-1", role: "mind-auditor", status: "active" },
        { id: "skill-auditor-1", role: "skill-auditor", status: "active" },
      ],
    };
    const checkResultPass = checkCompanionAuditorsDoctor(passingOptions);
    expect(checkResultPass.passed).toBe(true);
    expect(isCompanionAuditorCompliant(passingOptions)).toBe(true);
    expect(() => assertCompanionAuditorsDoctor(passingOptions)).not.toThrow();

    const warnOnlyOptions = {
      grants: [
        { id: "mind-1", role: "mind-auditor", status: "active" },
        { id: "mind-2", role: "mind-auditor", status: "active" },
        { id: "skill-1", role: "skill-auditor", status: "active" },
      ],
    };
    expect(isCompanionAuditorCompliant(warnOnlyOptions)).toBe(true);
    expect(() => assertCompanionAuditorsDoctor(warnOnlyOptions)).not.toThrow();
  });
});

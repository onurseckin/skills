import { describe, expect, test } from "bun:test";
import {
  DEFECT_ID,
  ERROR_CODE,
  DEFECT_TITLE,
  DISALLOWED_SUPERVISOR_TOOLS,
  SUPERVISOR_ROLES,
  validateDefectPreconditions,
  verifyDefectRemediation,
  isSupervisorRole,
  isCodeModificationTool,
  interceptLiveToolCall,
  auditLiveToolInvocationStream,
  type DefectRemediationContext,
  type DefectRemediationResult,
  type LiveToolInvocation,
  type AuditStreamReport,
} from "../../../olt/scripts/src/validation/skill-auditor-missed-supervisor-direct-code-writes-post-hoc-capsule-audit-lacked-live-tool-call-interception-defect-skill-auditor-shallow-surveillance-missed-supervisor-edits.ts";

describe("Defect Remediation: SKILL_AUDITOR_SHALLOW_SURVEILLANCE", () => {
  test("exports constants and defect metadata", () => {
    expect(DEFECT_ID).toBe("defect-skill-auditor-shallow-surveillance-missed-supervisor-edits");
    expect(ERROR_CODE).toBe("SKILL_AUDITOR_SHALLOW_SURVEILLANCE");
    expect(DEFECT_TITLE).toContain("Skill Auditor Missed Supervisor Direct Code Writes");
    expect(DISALLOWED_SUPERVISOR_TOOLS).toContain("write_to_file");
    expect(DISALLOWED_SUPERVISOR_TOOLS).toContain("replace_file_content");
    expect(SUPERVISOR_ROLES).toContain("orchestrator");
    expect(SUPERVISOR_ROLES).toContain("coordinator");
  });

  test("correctly identifies supervisor roles and code tools", () => {
    expect(isSupervisorRole("orchestrator")).toBe(true);
    expect(isSupervisorRole("coordinator")).toBe(true);
    expect(isSupervisorRole("tier-1-orchestrator")).toBe(true);
    expect(isSupervisorRole("tier-2-coordinator")).toBe(true);
    expect(isSupervisorRole("implementer")).toBe(false);
    expect(isSupervisorRole("validator")).toBe(false);

    expect(isCodeModificationTool("write_to_file")).toBe(true);
    expect(isCodeModificationTool("replace_file_content")).toBe(true);
    expect(isCodeModificationTool("notebook_edit")).toBe(true);
    expect(isCodeModificationTool("view_file")).toBe(false);
    expect(isCodeModificationTool("send_message")).toBe(false);
  });

  test("validates compliant execution context cleanly", () => {
    const validCtx: DefectRemediationContext = {
      actor: "implementer_task_1_1",
      role: "implementer",
      taskId: "task-1_1",
      state: "validating",
      sessionToken: "tok_live_DEFECT_SKILL_AUDITOR_SHALLOW_SURVEILLANCE",
      scope: [
        "olt/scripts/src/validation/skill-auditor-missed-supervisor-direct-code-writes-post-hoc-capsule-audit-lacked-live-tool-call-interception-defect-skill-auditor-shallow-surveillance-missed-supervisor-edits.ts",
      ],
      gateCommand:
        "bun test tests/unit/validation/skill-auditor-missed-supervisor-direct-code-writes-post-hoc-capsule-audit-lacked-live-tool-call-interception-defect-skill-auditor-shallow-surveillance-missed-supervisor-edits.test.ts",
      isLiveInterception: true,
    };
    expect(validateDefectPreconditions(validCtx)).toBe(true);
    const result: DefectRemediationResult = verifyDefectRemediation(validCtx);
    expect(result.remediated).toBe(true);
    expect(result.allowed).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  test("rejects supervisor executing direct file write", () => {
    const invalidCtx: DefectRemediationContext = {
      role: "orchestrator",
      attemptedTool: "write_to_file",
    };
    expect(validateDefectPreconditions(invalidCtx)).toBe(false);
    const result: DefectRemediationResult = verifyDefectRemediation(invalidCtx);
    expect(result.remediated).toBe(true);
    expect(result.allowed).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test("intercepts live tool-call stream and catches supervisor boundary breach", () => {
    const stream: readonly LiveToolInvocation[] = [
      {
        actor: "tier-1-orchestrator-1",
        role: "orchestrator",
        toolName: "send_message",
        isLiveInterception: true,
      },
      {
        actor: "tier-1-orchestrator-1",
        role: "orchestrator",
        toolName: "write_to_file",
        targetFile: "src/critical.ts",
        isLiveInterception: true,
      },
      {
        actor: "tier-2-coordinator-1",
        role: "coordinator",
        toolName: "replace_file_content",
        targetFile: "src/engine.ts",
        isLiveInterception: true,
      },
    ];

    const report: AuditStreamReport = auditLiveToolInvocationStream(stream);
    expect(report.auditedLive).toBe(true);
    expect(report.breachDetected).toBe(true);
    expect(report.violations.length).toBe(2);
    expect(report.violations[0]).toContain("orchestrator");
    expect(report.violations[0]).toContain("write_to_file");
    expect(report.violations[1]).toContain("coordinator");
    expect(report.violations[1]).toContain("replace_file_content");
    expect(report.remediationAction).toContain("Halt supervisor execution");
  });

  test("rejects post-hoc audit when real-time interception flag is false", () => {
    const postHocCall: LiveToolInvocation = {
      actor: "tier-1-orchestrator-1",
      role: "orchestrator",
      toolName: "view_file",
      isLiveInterception: false,
    };
    const interception = interceptLiveToolCall(postHocCall);
    expect(interception.allowed).toBe(false);
    expect(interception.violation).toContain("Post-hoc inspection insufficient");
  });

  test("permits Tier 3 Implementer live tool call to write_to_file", () => {
    const implementerCall: LiveToolInvocation = {
      actor: "tier-3-implementer-1",
      role: "implementer",
      toolName: "write_to_file",
      targetFile: "src/component.ts",
      isLiveInterception: true,
    };
    const interception = interceptLiveToolCall(implementerCall);
    expect(interception.allowed).toBe(true);
    expect(interception.violation).toBeUndefined();
  });
});

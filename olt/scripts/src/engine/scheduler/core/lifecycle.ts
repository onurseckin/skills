import type { SupervisoryTopLeader, Supervisory5PointHealthReport, Supervisory5PointOptions, SupervisoryProbeDispatchResult } from "./types.ts";
import { probeWorkSpanParallelizationHealth } from "./tasks-advanced.ts";
import { probePlanEnhancementNeeds, probeAgentRegistryAccuracy, probeRoleBoundaryAdherence } from "./loop.ts";
import { probeDoctorErrorResolution } from "./loop-doctor.ts";
import { parseTimestamp } from "../../../authority/watchdog-manager";
import { HarnessError } from "../../../core/errors";
import { BehavioralFinding } from "../../../reporting/behavioral-auditor";
import { DoctorOptions, runDoctor } from "../../../reporting/doctor";
import { isRecord } from "../../store/layout/layout-json.ts";

export function determineTopLeader(state: unknown): SupervisoryTopLeader {
  if (isRecord(state) && Array.isArray(state.agents)) {
    // 1. Search for active Mind Lead (Tier 0)
    for (const grant of state.agents) {
      if (isRecord(grant) && grant.status === "active" && grant.role === "mind") {
        return {
          agentId: typeof grant.id === "string" ? grant.id : "mind-lead",
          role: "mind",
          tier: 0,
        };
      }
    }

    // 2. Search for active Orchestrator Lead (Tier 1)
    for (const grant of state.agents) {
      if (isRecord(grant) && grant.status === "active" && grant.role === "orchestrator") {
        return {
          agentId: typeof grant.id === "string" ? grant.id : "orch-lead",
          role: "orchestrator",
          tier: 1,
        };
      }
    }

    // 3. Search for active Coordinator (Tier 2)
    for (const grant of state.agents) {
      if (isRecord(grant) && grant.status === "active" && grant.role === "coordinator") {
        return {
          agentId: typeof grant.id === "string" ? grant.id : "coordinator-lead",
          role: "coordinator",
          tier: 2,
        };
      }
    }
  }

  return {
    agentId: "coordinator-lead",
    role: "coordinator",
    tier: 2,
  };
}
export function formatSupervisoryHealthMarkdown(report: Supervisory5PointHealthReport): string {
  const lines = [
    `### 🛡️ Two-Way Supervisory Watchdog 5-Point Health Probe`,
    `- **Checked At**: \`${report.checkedAt}\``,
    `- **Dispatched To Top Leader**: \`${report.topLeader.agentId}\` (Role: **${report.topLeader.role.toUpperCase()}**, Tier: ${report.topLeader.tier})`,
    `- **Overall Status**: ${report.healthy ? "🟢 HEALTHY (All 5 Supervisory Probes Passed)" : "⚠️ ACTION REQUIRED (Violations Detected)"}`,
    "",
    "#### 5-Point Audit Breakdown",
    `1. **(a) Work/Span Parallelization Health**: ${report.workSpanHealth.passed ? "🟢 PASS" : "❌ CONSTRAINED"} (Parallelism: ${report.workSpanHealth.workParallelismRatio.toFixed(2)}, Active Tasks: ${report.workSpanHealth.activeTasks}, Ready Tasks: ${report.workSpanHealth.readyTasks})`,
    ...report.workSpanHealth.details.map((d) => `   - ${d}`),
    `2. **(b) Plan Enhancement Needs**: ${report.planEnhancement.passed ? "🟢 PASS" : "⚠️ ENHANCEMENT NEEDED"} (${report.planEnhancement.totalRequirements} requirements, ${report.planEnhancement.unfulfilledRequirementsCount} unfulfilled)`,
    ...report.planEnhancement.details.map((d) => `   - ${d}`),
    `3. **(c) 100% Agent Registry Accuracy**: ${report.agentRegistryAccuracy.passed ? "🟢 PASS (100%)" : "❌ MISMATCH"} (${report.agentRegistryAccuracy.totalActiveGrants} active grants, ${report.agentRegistryAccuracy.totalActiveLeases} active leases)`,
    ...report.agentRegistryAccuracy.details.map((d) => `   - ${d}`),
    `4. **(d) Strict Role Boundary Adherence**: ${report.roleBoundaryAdherence.passed ? "🟢 PASS" : "❌ ROLE VIOLATION"} (${report.roleBoundaryAdherence.hierarchicalViolations.length + report.roleBoundaryAdherence.tierConfinementViolations.length} violations)`,
    ...report.roleBoundaryAdherence.details.map((d) => `   - ${d}`),
    `5. **(e) Doctor Error Resolution**: ${report.doctorResolution.passed ? "🟢 PASS" : "❌ DOCTOR ISSUES"} (${report.doctorResolution.totalIssues} unresolved issues)`,
    ...report.doctorResolution.details.map((d) => `   - ${d}`),
  ];

  if (report.overallIssues.length > 0) {
    lines.push("");
    lines.push("#### ⚠️ Required Supervisory Actions for Leader");
    for (const issue of report.overallIssues) {
      lines.push(`- ${issue}`);
    }
  }

  return lines.join("\n");
}
export function auditSupervisory5PointHealth(
  state: unknown,
  options: Supervisory5PointOptions = {},
): Supervisory5PointHealthReport {
  const topLeader = determineTopLeader(state);
  const nowIso = new Date(parseTimestamp(options.now)).toISOString();

  const workSpanHealth = probeWorkSpanParallelizationHealth(state);
  const planEnhancement = probePlanEnhancementNeeds(state);
  const agentRegistryAccuracy = probeAgentRegistryAccuracy(state);
  const roleBoundaryAdherence = probeRoleBoundaryAdherence(state, options.runRoot);
  const doctorResolution = probeDoctorErrorResolution(options.runRoot, options.doctorResult);

  const overallIssues: string[] = [];
  if (!workSpanHealth.passed) overallIssues.push(...workSpanHealth.details);
  if (!planEnhancement.passed) overallIssues.push(...planEnhancement.details);
  if (!agentRegistryAccuracy.passed) overallIssues.push(...agentRegistryAccuracy.details);
  if (!roleBoundaryAdherence.passed) overallIssues.push(...roleBoundaryAdherence.details);
  if (!doctorResolution.passed) overallIssues.push(...doctorResolution.details);

  const healthy =
    workSpanHealth.passed &&
    planEnhancement.passed &&
    agentRegistryAccuracy.passed &&
    roleBoundaryAdherence.passed &&
    doctorResolution.passed;

  const partialReport = {
    healthy,
    checkedAt: nowIso,
    topLeader,
    workSpanHealth,
    planEnhancement,
    agentRegistryAccuracy,
    roleBoundaryAdherence,
    doctorResolution,
    overallIssues,
  };

  const markdown = formatSupervisoryHealthMarkdown({
    ...partialReport,
    markdown: "",
  });

  return {
    ...partialReport,
    markdown,
  };
}
export function dispatchSupervisoryHealthProbe(
  state: unknown,
  options: Supervisory5PointOptions = {},
): SupervisoryProbeDispatchResult {
  const report = auditSupervisory5PointHealth(state, options);
  const targetAgentId = report.topLeader.agentId;
  const targetRole = report.topLeader.role;

  const promptForLeader = [
    `[SUPERVISORY WATCHDOG PROBE] Health check for top leader '${targetAgentId}' (${targetRole.toUpperCase()}):`,
    `Status: ${report.healthy ? "HEALTHY" : "ATTENTION REQUIRED"}`,
    report.overallIssues.length > 0
      ? `Issues to resolve:\n${report.overallIssues.map((i) => `• ${i}`).join("\n")}`
      : "All 5 health points (Work/Span, Plan Enhancement, Agent Registry, Role Boundaries, Doctor) are green.",
  ].join("\n");

  return {
    dispatched: true,
    targetAgentId,
    targetRole,
    report,
    promptForLeader,
    markdown: report.markdown,
  };
}
export async function auditDoctorGate(
  runRoot: string,
  options: DoctorOptions = {},
): Promise<Record<string, unknown>> {
  return await runDoctor(runRoot, options);
}
export async function assertDoctorGatePassed(
  runRoot: string,
  options: DoctorOptions = {},
): Promise<Record<string, unknown>> {
  const docResult = await runDoctor(runRoot, options);
  const healthy = docResult.healthy === true;
  const behavioralFindings = Array.isArray(docResult.behavioral_findings)
    ? (docResult.behavioral_findings as BehavioralFinding[])
    : [];
  const issues = Array.isArray(docResult.issues) ? (docResult.issues as string[]) : [];

  if (!healthy || behavioralFindings.length > 0 || issues.length > 0) {
    const errorPrefix =
      behavioralFindings.length > 0
        ? "DOCTOR GATE VIOLATION (Zero-Tolerance Boundary Auditing): Role confinement or behavioral policy breached"
        : "DOCTOR GATE REJECTION: System doctor discovered unresolved capsule failures";

    const fullMessage = `${errorPrefix}:\n${issues.map((i) => `  - ${i}`).join("\n")}`;

    if (behavioralFindings.length > 0) {
      throw new HarnessError("ROLE_CONFINEMENT_VIOLATION", fullMessage, issues);
    }
    throw new HarnessError("INVALID_STATE", fullMessage, issues);
  }

  return docResult;
}

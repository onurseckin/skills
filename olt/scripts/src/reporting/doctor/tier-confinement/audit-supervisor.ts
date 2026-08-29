import type {
  AgentGrantRecord,
  AgentToolRef,
  AgentToolUse,
  CommandRecord,
} from "../../../core/contracts/index.ts";
import type { TaskRecord } from "../../../workflow/types.ts";
import { roleToTier, validateTierSpawning } from "../../../authority/thread/index.ts";
import {
  CODE_EDIT_TOOLS,
  DOCTOR_SUPERVISOR_CODE_CONTAMINATION,
  inferRole,
  isCoordinatorRole,
  isFullTestSuiteCommand,
  isMindRole,
  isOrchestratorRole,
  isSourceCodeFile,
} from "./constants.ts";
import type { GitDiffRecord, TierConfinementFinding } from "./types.ts";

export function auditCrossTierSpawning(
  roleMap: Map<string, string>,
  grants: readonly AgentGrantRecord[],
  findings: TierConfinementFinding[],
): void {
  for (const grant of grants) {
    if (!grant.parent_agent_id) continue;
    const childRole = grant.role;
    const childTier = roleToTier(childRole);
    const parentRole =
      roleMap.get(grant.parent_agent_id) ?? inferRole(grant.parent_agent_id, roleMap, {});
    const parentTier = roleToTier(parentRole);
    const validation = validateTierSpawning(parentTier, childTier, parentRole, childRole);
    if (!validation.allowed) {
      findings.push({
        agent_id: grant.id,
        role: grant.role,
        tier: childTier,
        violation_type: "cross_tier_spawning_violation",
        severity: "critical",
        observation: `Illegal cross-tier spawning detected: Parent agent "${grant.parent_agent_id}" (Tier ${parentTier} ${parentRole}) directly spawned child agent "${grant.id}" (Tier ${childTier} ${childRole}). Violation: ${validation.reason ?? "Violates 4-tier hierarchy"}`,
        remediation:
          "Enforce strict 4-tier boundary confinement: Tier 0 Mind deploys Tier 1 Orchestrator; Tier 1 Orchestrator deploys Tier 2 Coordinators; Tier 2 Coordinator deploys Tier 3 Implementers and Validators.",
        evidence: {
          parent_agent_id: grant.parent_agent_id,
          parent_role: parentRole,
          parent_tier: parentTier,
          child_agent_id: grant.id,
          child_role: childRole,
          child_tier: childTier,
        },
      });
    }
  }
}

export function auditCoordinatorConfinement(
  roleMap: Map<string, string>,
  grants: readonly AgentGrantRecord[],
  commands: readonly CommandRecord[],
  tasks: readonly TaskRecord[],
  findings: TierConfinementFinding[],
): void {
  for (const grant of grants) {
    if (!isCoordinatorRole(grant.role)) continue;
    for (const tool of (grant.tools_used ?? []) as readonly AgentToolUse[]) {
      if (tool.category === "file-edit" || CODE_EDIT_TOOLS.has(tool.name)) {
        findings.push({
          agent_id: grant.id,
          role: grant.role,
          tier: 2,
          violation_type: "coordinator_code_writing",
          severity: "critical",
          observation: `Tier 2 Coordinator agent "${grant.id}" recorded usage of code-editing tool "${tool.name}" (category: ${tool.category ?? "file-edit"})`,
          remediation:
            "Coordinators must never write code or edit files directly. Delegate all implementation tasks to Tier 3 Implementers via host native subagents.",
          evidence: { tool_name: tool.name, category: tool.category, first_reported_at: tool.first_reported_at },
        });
      }
    }
    if (grant.tools_granted?.value) {
      for (const tool of grant.tools_granted.value as readonly AgentToolRef[]) {
        if (tool.category === "file-edit" || CODE_EDIT_TOOLS.has(tool.name)) {
          findings.push({
            agent_id: grant.id,
            role: grant.role,
            tier: 2,
            violation_type: "coordinator_code_writing",
            severity: "critical",
            observation: `Tier 2 Coordinator agent "${grant.id}" holds unauthorized grant for code-editing tool "${tool.name}"`,
            remediation:
              "Coordinators must not be provisioned with file-editing tools. Update coordinator capability manifest to omit file-edit tools.",
            evidence: { tool_name: tool.name, category: tool.category },
          });
        }
      }
    }
  }

  for (const cmd of commands) {
    const role = roleMap.get(cmd.actor) ?? (isCoordinatorRole(cmd.actor) ? "coordinator" : "");
    if (!isCoordinatorRole(role)) continue;
    const isEditTool = cmd.tool !== undefined && CODE_EDIT_TOOLS.has(cmd.tool);
    const isEditCat = cmd.tool_category === "file-edit";
    const hasEditArg = (cmd.argv ?? []).some((arg) => CODE_EDIT_TOOLS.has(arg));
    if (isEditTool || isEditCat || hasEditArg) {
      findings.push({
        agent_id: cmd.actor,
        role: "coordinator",
        tier: 2,
        violation_type: "coordinator_code_writing",
        severity: "critical",
        observation: `Tier 2 Coordinator agent "${cmd.actor}" executed file modification in command "${cmd.id}"`,
        remediation:
          "Coordinators must never execute file-editing commands or tools directly. Assign implementation tasks to Tier 3 Implementers.",
        evidence: { command_id: cmd.id, argv: [...(cmd.argv ?? [])], ...(cmd.tool ? { tool: cmd.tool } : {}) },
      });
    }
    if (isFullTestSuiteCommand(cmd.argv ?? [])) {
      findings.push({
        agent_id: cmd.actor,
        role: "coordinator",
        tier: 2,
        violation_type: "role_confinement_violation",
        severity: "critical",
        observation: `Tier 2 Coordinator agent "${cmd.actor}" executed prohibited full test suite command "${(cmd.argv ?? []).join(" ")}" in command "${cmd.id}"`,
        remediation:
          "Coordinators are strictly banned from running full test suites (`bun test`, `bun run test:unit`, `bun test --coverage`). Coordinators coordinate task evidence without running tests; full tests belong exclusively to Completeness Critics.",
        evidence: { command_id: cmd.id, argv: [...(cmd.argv ?? [])] },
      });
    }
  }

  for (const task of tasks) {
    if (!task.lease) continue;
    const leaseRole = task.lease.role;
    const agentRole = roleMap.get(task.lease.agent_id);
    if (isCoordinatorRole(leaseRole) || (agentRole && isCoordinatorRole(agentRole))) {
      findings.push({
        agent_id: task.lease.agent_id,
        role: "coordinator",
        tier: 2,
        violation_type: "coordinator_code_writing",
        severity: "critical",
        observation: `Tier 2 Coordinator agent "${task.lease.agent_id}" holds direct implementation lease for task "${task.id}"`,
        remediation:
          "Coordinators must not claim or lease implementation tasks. Implementation leases are exclusively for Tier 3 Implementers.",
        evidence: { task_id: task.id, lease_role: leaseRole, issued_at: task.lease.issued_at },
      });
    }
  }
}

export function auditSupervisorCodeContamination(
  roleMap: Map<string, string>,
  grants: readonly AgentGrantRecord[],
  commands: readonly CommandRecord[],
  tasks: readonly TaskRecord[],
  gitDiffs?: readonly (string | GitDiffRecord)[],
  findings?: TierConfinementFinding[],
): TierConfinementFinding[] {
  const resultFindings: TierConfinementFinding[] = findings ?? [];

  for (const grant of grants) {
    const role = grant.role;
    if (!isOrchestratorRole(role) && !isCoordinatorRole(role) && !isMindRole(role)) continue;
    const tier = roleToTier(role);
    for (const tool of (grant.tools_used ?? []) as readonly AgentToolUse[]) {
      if (tool.category === "file-edit" || CODE_EDIT_TOOLS.has(tool.name)) {
        resultFindings.push({
          agent_id: grant.id,
          role,
          tier,
          violation_type: "supervisor_code_contamination",
          severity: "critical",
          observation: `[${DOCTOR_SUPERVISOR_CODE_CONTAMINATION}] Tier ${tier} supervisor "${grant.id}" (${role}) used code-editing tool "${tool.name}"`,
          remediation:
            "Supervisors must maintain zero source code file mutations and delegate all implementation exclusively to Tier 3 Implementers.",
          evidence: { check: DOCTOR_SUPERVISOR_CODE_CONTAMINATION, tool_name: tool.name, category: tool.category },
        });
      }
    }
  }

  for (const cmd of commands) {
    const role = roleMap.get(cmd.actor) ?? inferRole(cmd.actor, roleMap, {});
    if (!isOrchestratorRole(role) && !isCoordinatorRole(role) && !isMindRole(role)) continue;
    const tier = roleToTier(role);
    const isEditTool = cmd.tool !== undefined && CODE_EDIT_TOOLS.has(cmd.tool);
    const isEditCat = cmd.tool_category === "file-edit";
    const hasEditArg = (cmd.argv ?? []).some((arg) => CODE_EDIT_TOOLS.has(arg));
    if (isEditTool || isEditCat || hasEditArg) {
      resultFindings.push({
        agent_id: cmd.actor,
        role,
        tier,
        violation_type: "supervisor_code_contamination",
        severity: "critical",
        observation: `[${DOCTOR_SUPERVISOR_CODE_CONTAMINATION}] Tier ${tier} supervisor "${cmd.actor}" executed file modification tool/command in "${cmd.id}"`,
        remediation:
          "Supervisors must never edit code directly. Delegate all file edits to Tier 3 Implementers.",
        evidence: { check: DOCTOR_SUPERVISOR_CODE_CONTAMINATION, command_id: cmd.id, argv: [...(cmd.argv ?? [])], ...(cmd.tool ? { tool: cmd.tool } : {}) },
      });
    }
    if (
      cmd.repository_before &&
      cmd.repository_after &&
      cmd.repository_before.content_sha256 !== cmd.repository_after.content_sha256
    ) {
      resultFindings.push({
        agent_id: cmd.actor,
        role,
        tier,
        violation_type: "supervisor_code_contamination",
        severity: "critical",
        observation: `[${DOCTOR_SUPERVISOR_CODE_CONTAMINATION}] Tier ${tier} supervisor "${cmd.actor}" caused direct repository content mutation in command "${cmd.id}" (before: ${cmd.repository_before.content_sha256.slice(0, 8)}, after: ${cmd.repository_after.content_sha256.slice(0, 8)})`,
        remediation:
          "Supervisors must not mutate repository source files during command execution.",
        evidence: { check: DOCTOR_SUPERVISOR_CODE_CONTAMINATION, command_id: cmd.id, repo_before_sha: cmd.repository_before.content_sha256, repo_after_sha: cmd.repository_after.content_sha256 },
      });
    }
  }

  for (const task of tasks) {
    if (!task.lease) continue;
    const leaseRole = task.lease.role;
    const agentRole = roleMap.get(task.lease.agent_id) ?? inferRole(task.lease.agent_id, roleMap, {});
    const isSup =
      isMindRole(leaseRole) ||
      isOrchestratorRole(leaseRole) ||
      isCoordinatorRole(leaseRole) ||
      isMindRole(agentRole) ||
      isOrchestratorRole(agentRole) ||
      isCoordinatorRole(agentRole);
    if (isSup) {
      const effectiveRole =
        isMindRole(leaseRole) || isMindRole(agentRole)
          ? "mind"
          : isOrchestratorRole(leaseRole) || isOrchestratorRole(agentRole)
            ? "orchestrator"
            : "coordinator";
      const tier = roleToTier(effectiveRole);
      resultFindings.push({
        agent_id: task.lease.agent_id,
        role: effectiveRole,
        tier,
        violation_type: "supervisor_code_contamination",
        severity: "critical",
        observation: `[${DOCTOR_SUPERVISOR_CODE_CONTAMINATION}] Tier ${tier} supervisor "${task.lease.agent_id}" holds active implementation lease for task "${task.id}"`,
        remediation:
          "Supervisors must not hold implementation task leases. Implementation tasks must be claimed only by Tier 3 Implementers.",
        evidence: { check: DOCTOR_SUPERVISOR_CODE_CONTAMINATION, task_id: task.id, lease_role: leaseRole },
      });
    }
  }

  if (gitDiffs && gitDiffs.length > 0) {
    for (const diff of gitDiffs) {
      const diffPath = typeof diff === "string" ? diff : diff.path;
      const diffActor = typeof diff === "object" && diff.actor ? diff.actor : undefined;
      const diffRole = typeof diff === "object" && diff.role ? diff.role : undefined;
      if (isSourceCodeFile(diffPath) && diffActor) {
        const actorRole = diffRole ?? roleMap.get(diffActor) ?? inferRole(diffActor, roleMap, {});
        if (isMindRole(actorRole) || isOrchestratorRole(actorRole) || isCoordinatorRole(actorRole)) {
          const tier = roleToTier(actorRole);
          resultFindings.push({
            agent_id: diffActor,
            role: actorRole,
            tier,
            violation_type: "supervisor_code_contamination",
            severity: "critical",
            observation: `[${DOCTOR_SUPERVISOR_CODE_CONTAMINATION}] Tier ${tier} supervisor "${diffActor}" modified source code file "${diffPath}" in git diff`,
            remediation:
              "Zero direct source code file mutations are permitted by supervisors. Revert changes and delegate to Tier 3 Implementers.",
            evidence: { check: DOCTOR_SUPERVISOR_CODE_CONTAMINATION, file_path: diffPath, actor: diffActor, role: actorRole },
          });
        }
      }
    }
  }

  return resultFindings;
}

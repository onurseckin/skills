import type {
  AgentGrantRecord,
  AgentToolRef,
  AgentToolUse,
  CommandRecord,
} from "../../../core/contracts/index.ts";
import type { TaskRecord } from "../../../workflow/types.ts";
import {
  isCoordinatorRole,
  isOrchestratorRole,
  roleToTier,
  validateTierSpawning,
} from "../../../authority/thread/index.ts";
import {
  CODE_EDIT_TOOLS,
  DOCTOR_SUPERVISOR_CODE_CONTAMINATION,
  inferRole,
  isFullTestSuiteCommand,
  isMindRole,
  isSourceCodeFile,
} from "./constants.ts";
import type { GitDiffRecord, TierConfinementFinding } from "./types.ts";

const isSupervisor = (role: string): boolean =>
  isMindRole(role) || isOrchestratorRole(role) || isCoordinatorRole(role);

const resolveRole = (roleMap: Map<string, string>, actorId: string): string =>
  roleMap.get(actorId) ?? inferRole(actorId, roleMap, {});

const isToolEdit = (tool: { readonly name: string; readonly category?: string }): boolean =>
  tool.category === "file-edit" || CODE_EDIT_TOOLS.has(tool.name);

function isCmdEdit(cmd: CommandRecord): boolean {
  return Boolean(
    (cmd.tool && CODE_EDIT_TOOLS.has(cmd.tool)) ||
    cmd.tool_category === "file-edit" ||
    cmd.argv?.some((arg) => CODE_EDIT_TOOLS.has(arg)),
  );
}

function cmdEvidence(cmd: CommandRecord): Record<string, unknown> {
  return {
    command_id: cmd.id,
    argv: [...(cmd.argv ?? [])],
    ...(cmd.tool ? { tool: cmd.tool } : {}),
  };
}

const effectiveSupervisorRole = (l: string, a: string): string =>
  isMindRole(l) || isMindRole(a)
    ? "mind"
    : isOrchestratorRole(l) || isOrchestratorRole(a)
      ? "orchestrator"
      : "coordinator";

function auditGrantTools(
  grant: AgentGrantRecord,
  onTool: (name: string, category?: string, firstReported?: string) => void,
): void {
  for (const t of (grant.tools_used ?? []) as readonly AgentToolUse[]) {
    if (isToolEdit(t)) onTool(t.name, t.category, t.first_reported_at);
  }
}

function addContamination(
  findings: TierConfinementFinding[],
  agentId: string,
  role: string,
  observation: string,
  evidence: Record<string, unknown>,
  remediation = "Supervisors must never edit code directly. Delegate all file edits to Tier 3 Implementers.",
): void {
  findings.push({
    agent_id: agentId,
    role,
    tier: roleToTier(role),
    violation_type: "supervisor_code_contamination",
    severity: "critical",
    observation: `[${DOCTOR_SUPERVISOR_CODE_CONTAMINATION}] ${observation}`,
    remediation,
    evidence: { check: DOCTOR_SUPERVISOR_CODE_CONTAMINATION, ...evidence },
  });
}

function addCoordWriting(
  findings: TierConfinementFinding[],
  agentId: string,
  observation: string,
  evidence: Record<string, unknown>,
  remediation = "Coordinators must never write code or edit files directly. Delegate all implementation tasks to Tier 3 Implementers via host native subagents.",
): void {
  findings.push({
    agent_id: agentId,
    role: "coordinator",
    tier: 2,
    violation_type: "coordinator_code_writing",
    severity: "critical",
    observation,
    remediation,
    evidence,
  });
}

export function auditCrossTierSpawning(
  roleMap: Map<string, string>,
  grants: readonly AgentGrantRecord[],
  findings: TierConfinementFinding[],
): void {
  for (const g of grants) {
    if (!g.parent_agent_id) continue;
    const parentRole = resolveRole(roleMap, g.parent_agent_id);
    const parentTier = roleToTier(parentRole);
    const childTier = roleToTier(g.role);
    const v = validateTierSpawning(parentTier, childTier, parentRole, g.role);
    if (v.allowed) continue;
    findings.push({
      agent_id: g.id,
      role: g.role,
      tier: childTier,
      violation_type: "cross_tier_spawning_violation",
      severity: "critical",
      observation: `Illegal cross-tier spawning detected: Parent agent "${g.parent_agent_id}" (Tier ${parentTier} ${parentRole}) directly spawned child agent "${g.id}" (Tier ${childTier} ${g.role}). Violation: ${v.reason ?? "Violates 4-tier hierarchy"}`,
      remediation:
        "Enforce strict 4-tier boundary confinement: Tier 0 Mind deploys Tier 1 Orchestrator; Tier 1 Orchestrator deploys Tier 2 Coordinators; Tier 2 Coordinator deploys Tier 3 Implementers and Validators.",
      evidence: {
        parent_agent_id: g.parent_agent_id,
        parent_role: parentRole,
        parent_tier: parentTier,
        child_agent_id: g.id,
        child_role: g.role,
        child_tier: childTier,
      },
    });
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
    auditGrantTools(grant, (name, category, first_reported_at) => {
      addCoordWriting(
        findings,
        grant.id,
        `Tier 2 Coordinator agent "${grant.id}" recorded usage of code-editing tool "${name}" (category: ${category ?? "file-edit"})`,
        { tool_name: name, category, first_reported_at },
      );
    });
    for (const t of (grant.tools_granted?.value ?? []) as readonly AgentToolRef[]) {
      if (isToolEdit(t)) {
        addCoordWriting(
          findings,
          grant.id,
          `Tier 2 Coordinator agent "${grant.id}" holds unauthorized grant for code-editing tool "${t.name}"`,
          { tool_name: t.name, category: t.category },
          "Coordinators must not be provisioned with file-editing tools. Update coordinator capability manifest to omit file-edit tools.",
        );
      }
    }
  }

  for (const cmd of commands) {
    if (!isCoordinatorRole(resolveRole(roleMap, cmd.actor))) continue;
    if (isCmdEdit(cmd)) {
      addCoordWriting(
        findings,
        cmd.actor,
        `Tier 2 Coordinator agent "${cmd.actor}" executed file modification in command "${cmd.id}"`,
        cmdEvidence(cmd),
        "Supervisors must never edit code directly. Delegate all file edits to Tier 3 Implementers.",
      );
    }
    const argv = cmd.argv ?? [];
    if (isFullTestSuiteCommand(argv)) {
      findings.push({
        agent_id: cmd.actor,
        role: "coordinator",
        tier: 2,
        violation_type: "role_confinement_violation",
        severity: "critical",
        observation: `Tier 2 Coordinator agent "${cmd.actor}" executed prohibited full test suite command "${argv.join(" ")}" in command "${cmd.id}"`,
        remediation:
          "Coordinators are strictly banned from running full test suites (`bun test`, `bun run test:unit`, `bun test --coverage`). Coordinators coordinate task evidence without running tests; full tests belong exclusively to Completeness Critics.",
        evidence: { command_id: cmd.id, argv: [...argv] },
      });
    }
  }

  for (const task of tasks) {
    if (!task.lease) continue;
    const { role: leaseRole, agent_id } = task.lease;
    const agentRole = roleMap.get(agent_id);
    if (isCoordinatorRole(leaseRole) || (agentRole && isCoordinatorRole(agentRole))) {
      addCoordWriting(
        findings,
        agent_id,
        `Tier 2 Coordinator agent "${agent_id}" holds direct implementation lease for task "${task.id}"`,
        { task_id: task.id, lease_role: leaseRole, issued_at: task.lease.issued_at },
        "Coordinators must not claim or lease implementation tasks. Implementation leases are exclusively for Tier 3 Implementers.",
      );
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
  const result: TierConfinementFinding[] = findings ?? [];

  for (const grant of grants) {
    if (!isSupervisor(grant.role)) continue;
    auditGrantTools(grant, (name, category) => {
      addContamination(
        result,
        grant.id,
        grant.role,
        `Tier ${roleToTier(grant.role)} supervisor "${grant.id}" (${grant.role}) used code-editing tool "${name}"`,
        { tool_name: name, category },
        "Supervisors must maintain zero source code file mutations and delegate all implementation exclusively to Tier 3 Implementers.",
      );
    });
  }

  for (const cmd of commands) {
    const role = resolveRole(roleMap, cmd.actor);
    if (!isSupervisor(role)) continue;
    if (isCmdEdit(cmd)) {
      addContamination(
        result,
        cmd.actor,
        role,
        `Tier ${roleToTier(role)} supervisor "${cmd.actor}" executed file modification tool/command in "${cmd.id}"`,
        cmdEvidence(cmd),
      );
    }
    const { repository_before: b, repository_after: a } = cmd;
    if (b && a && b.content_sha256 !== a.content_sha256) {
      addContamination(
        result,
        cmd.actor,
        role,
        `Tier ${roleToTier(role)} supervisor "${cmd.actor}" caused direct repository content mutation in command "${cmd.id}" (before: ${b.content_sha256.slice(0, 8)}, after: ${a.content_sha256.slice(0, 8)})`,
        { command_id: cmd.id, repo_before_sha: b.content_sha256, repo_after_sha: a.content_sha256 },
        "Supervisors must not mutate repository source files during command execution.",
      );
    }
  }

  for (const task of tasks) {
    if (!task.lease) continue;
    const { role: leaseRole, agent_id } = task.lease;
    const agentRole = resolveRole(roleMap, agent_id);
    if (isSupervisor(leaseRole) || isSupervisor(agentRole)) {
      const role = effectiveSupervisorRole(leaseRole, agentRole);
      addContamination(
        result,
        agent_id,
        role,
        `Tier ${roleToTier(role)} supervisor "${agent_id}" holds active implementation lease for task "${task.id}"`,
        { task_id: task.id, lease_role: leaseRole },
        "Supervisors must not hold implementation task leases. Implementation tasks must be claimed only by Tier 3 Implementers.",
      );
    }
  }

  for (const diff of gitDiffs ?? []) {
    const p = typeof diff === "string" ? diff : diff.path;
    const act = typeof diff === "object" ? diff.actor : undefined;
    const r = typeof diff === "object" ? diff.role : undefined;
    if (isSourceCodeFile(p) && act) {
      const actorRole = r ?? resolveRole(roleMap, act);
      if (isSupervisor(actorRole)) {
        addContamination(
          result,
          act,
          actorRole,
          `Tier ${roleToTier(actorRole)} supervisor "${act}" modified source code file "${p}" in git diff`,
          { file_path: p, actor: act, role: actorRole },
          "Zero direct source code file mutations are permitted by supervisors. Revert changes and delegate to Tier 3 Implementers.",
        );
      }
    }
  }

  return result;
}

import * as fs from "node:fs";
import * as path from "node:path";
import { roleToTier } from "../../../authority/guards/spawn-validator.ts";
import { inferRoleFromAgentId, normalizeRoleName } from "../../../authority/thread/index.ts";
import type { EvaluationContext, RoleDiagnosticProfile, SentinelViolation } from "../../types.ts";

function isTailingCommand(cmd: string): boolean {
  if (cmd.match(/\btail\b/) !== null) return true;
  if (cmd.includes("tail -n")) return true;
  if (cmd.includes("tail -f")) return true;
  if (cmd.includes("tailf")) return true;
  if (cmd.includes("less +F")) return true;
  return false;
}

function isAllowedMindChildRole(role: string): boolean {
  if (role === "mind-auditor") return true;
  if (role === "mind_auditor") return true;
  if (role === "skill-auditor") return true;
  if (role === "skill_auditor") return true;
  return false;
}

function isMindAuditorRoleOrId(roleOrId: string): boolean {
  if (roleOrId === "mind-auditor") return true;
  if (roleOrId === "mind_auditor") return true;
  if (roleOrId.includes("mind-auditor")) return true;
  if (roleOrId.includes("mind_auditor")) return true;
  return false;
}

function isMindRoleOrId(roleOrId: string): boolean {
  if (roleOrId === "mind") return true;
  if (roleOrId.startsWith("mind-")) return true;
  if (roleOrId.startsWith("mind_")) return true;
  return false;
}

export const mindProfile: RoleDiagnosticProfile = {
  role: "mind",
  tier: 0,
  can_edit: false,
  can_execute_shell: true,
  evaluate: (context: EvaluationContext): readonly SentinelViolation[] => {
    const violations: SentinelViolation[] = [];

    if (context.modified_files && context.modified_files.length > 0) {
      const sourceEdits = context.modified_files.filter(
        (f) =>
          !f.startsWith("docs/") &&
          !f.startsWith(".olt/capsules/") &&
          !f.startsWith(".olt/memory.json") &&
          !f.endsWith(".md"),
      );
      if (sourceEdits.length > 0) {
        const firstTarget = sourceEdits[0];
        violations.push({
          code: "MIND_DIRECT_CODE_MUTATION",
          severity: "CRITICAL",
          message: "Tier 0 Mind must never modify source code directly; delegate implementation.",
          target_file: firstTarget,
          remediation_cmd: "bun harness.ts task:brief --role orchestrator",
          documentation_ref: "docs/blueprints/agent-scoped-live-sentinel-profiles.md#section-21",
        });
      }
    }

    if (context.executed_commands && context.executed_commands.length > 0) {
      const isTailing = context.executed_commands.some(isTailingCommand);
      if (isTailing) {
        violations.push({
          code: "MIND_LOG_TAILING_FORBIDDEN",
          severity: "CRITICAL",
          message: "Mind must not act as a spectator log-tailing agent.",
          remediation_cmd: "Terminate tail process.",
          documentation_ref: "docs/blueprints/agent-scoped-live-sentinel-profiles.md#section-21",
        });
      }
    }

    if (
      context.wave_lane_count !== undefined &&
      context.wave_lane_count >= 2 &&
      context.wave_concurrency !== undefined &&
      context.wave_concurrency < 2
    ) {
      violations.push({
        code: "CONCURRENCY_SLA_BREACH",
        severity: "WARN",
        message: `Dynamic wave concurrency P must scale to >= 2 when lanes (${context.wave_lane_count}) >= 2.`,
        remediation_cmd: "bun harness.ts orchestrate --concurrency 2",
        documentation_ref: "docs/blueprints/agent-scoped-live-sentinel-profiles.md#section-21",
      });
    }

    const orchestratorDeficit =
      context.active_orchestrator_count === undefined
        ? true
        : context.active_orchestrator_count < 2;

    if (context.cluster_count !== undefined && context.cluster_count >= 2 && orchestratorDeficit) {
      violations.push({
        code: "SINGLE_ORCHESTRATOR_BOTTLENECK_VIOLATION",
        severity: "CRITICAL",
        message:
          "Mind multi-cluster preplanning requires >= 2 active orchestrators to prevent bottleneck.",
        remediation_cmd: "bun harness.ts orchestrate --tier orchestrator",
        documentation_ref: "docs/blueprints/agent-scoped-live-sentinel-profiles.md#section-21",
      });
    }

    if (context.pending_defects_count !== undefined && context.pending_defects_count > 0) {
      violations.push({
        code: "DEFECT_FIRST_PRIORITIZATION_BREACH",
        severity: "WARN",
        message: `Outstanding high-severity defects (${context.pending_defects_count}) must be prioritized before new tasks.`,
        remediation_cmd: "bun harness.ts report:defects",
        documentation_ref: "docs/blueprints/agent-scoped-live-sentinel-profiles.md#section-21",
      });
    }

    const candidateRoles: string[] = [];
    if (context.child_agent_roles) {
      candidateRoles.push(...context.child_agent_roles);
    }
    if (context.spawned_agent_roles) {
      candidateRoles.push(...context.spawned_agent_roles);
    }
    if (context.spawned_roles) {
      candidateRoles.push(...context.spawned_roles);
    }
    if (context.role_target) {
      candidateRoles.push(context.role_target);
    }

    const uniqueRoles = Array.from(new Set(candidateRoles));

    for (const childRole of uniqueRoles) {
      const normalizedRole = normalizeRoleName(childRole);
      const inferredRole = inferRoleFromAgentId(childRole);
      const resolved =
        normalizedRole !== undefined && normalizedRole !== null ? normalizedRole : inferredRole;
      const effectiveRole = resolved !== undefined && resolved !== null ? resolved : childRole;

      if (
        roleToTier(effectiveRole) !== 1 &&
        !isAllowedMindChildRole(childRole) &&
        !isAllowedMindChildRole(effectiveRole)
      ) {
        violations.push({
          code: "CROSS_TIER_SPAWNING_VIOLATION",
          severity: "CRITICAL",
          message:
            "Tier 0 Mind must only dispatch Tier 1 Orchestrator; direct Tier 3 worker or Tier 2 coordinator dispatch collapses the 4-tier hierarchy.",
          remediation_cmd: "bun harness.ts task:brief --role orchestrator",
          documentation_ref: "docs/blueprints/agent-scoped-live-sentinel-profiles.md#section-21",
        });
      }
    }

    // Inseparable Mind and Mind-Auditor co-deployment enforcement
    const rawContext = context as unknown as Record<string, unknown>;

    let flagInseparableViolation = false;

    if (rawContext.has_mind_auditor === false) {
      flagInseparableViolation = true;
    }
    if (rawContext.mind_auditor_active === false) {
      flagInseparableViolation = true;
    }

    if (Array.isArray(rawContext.active_roles)) {
      const roles = rawContext.active_roles as readonly string[];
      const hasActiveMind = roles.some(isMindRoleOrId);
      const hasActiveAuditor = roles.some(isMindAuditorRoleOrId);
      if (hasActiveMind && !hasActiveAuditor) {
        flagInseparableViolation = true;
      }
    }

    if (Array.isArray(rawContext.active_agents)) {
      const agents = rawContext.active_agents as readonly {
        role?: string;
        id?: string;
        status?: string;
      }[];
      const hasActiveMind = agents.some((a) => {
        if (a.status !== "active") return false;
        const role = typeof a.role === "string" ? a.role : "";
        const id = typeof a.id === "string" ? a.id : "";
        return isMindRoleOrId(role) ? true : isMindRoleOrId(id);
      });
      const hasActiveAuditor = agents.some((a) => {
        if (a.status !== "active") return false;
        const role = typeof a.role === "string" ? a.role : "";
        const id = typeof a.id === "string" ? a.id : "";
        return isMindAuditorRoleOrId(role) ? true : isMindAuditorRoleOrId(id);
      });
      if (hasActiveMind && !hasActiveAuditor) {
        flagInseparableViolation = true;
      }
    }

    if (
      !flagInseparableViolation &&
      context.run_root !== undefined &&
      typeof context.run_root === "string" &&
      context.run_root.length > 0
    ) {
      try {
        const statePath = path.join(context.run_root, "state.json");
        if (fs.existsSync(statePath)) {
          const rawData = fs.readFileSync(statePath, "utf-8");
          const parsed = JSON.parse(rawData) as { agents?: unknown[] };
          if (Array.isArray(parsed.agents)) {
            const agents = parsed.agents as { role?: string; id?: string; status?: string }[];
            const hasActiveMind = agents.some((a) => {
              if (a.status !== "active") return false;
              const role = typeof a.role === "string" ? a.role : "";
              const id = typeof a.id === "string" ? a.id : "";
              return isMindRoleOrId(role) ? true : isMindRoleOrId(id);
            });
            const hasActiveAuditor = agents.some((a) => {
              if (a.status !== "active") return false;
              const role = typeof a.role === "string" ? a.role : "";
              const id = typeof a.id === "string" ? a.id : "";
              return isMindAuditorRoleOrId(role) ? true : isMindAuditorRoleOrId(id);
            });
            if (hasActiveMind && !hasActiveAuditor) {
              flagInseparableViolation = true;
            }
          }
        }
      } catch {
        // Continue if state.json cannot be read
      }
    }

    if (flagInseparableViolation) {
      violations.push({
        code: "INSEPARABLE_MIND_AUDITOR_CO_DEPLOYMENT_VIOLATION",
        severity: "CRITICAL",
        message:
          "Mind and Mind-Auditor must be co-deployed inseparably; Tier 0 Mind cannot be active without active mind-auditor.",
        remediation_cmd: "bun harness.ts mind:bootstrap",
        documentation_ref: "docs/blueprints/agent-scoped-live-sentinel-profiles.md#section-21",
      });
    }

    return violations;
  },
};

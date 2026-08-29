import { PlanEnhancementAudit, AgentRegistryAccuracyAudit, RoleBoundaryAdherenceAudit } from "./types.ts";
import { isJsonObject } from "../../../core/contracts";
import { auditBehavioralHealth } from "../../../reporting/behavioral-auditor";
import { isRecord } from "../../store/layout/layout-json.ts";
import { boundedEvidenceCause } from "./tasks";

export function probePlanEnhancementNeeds(state: unknown): PlanEnhancementAudit {
  const details: string[] = [];
  const suggestedEnhancements: string[] = [];

  let totalRequirements = 0;
  let unfulfilledRequirementsCount = 0;
  let pendingCandidateCount = 0;

  if (!isRecord(state)) {
    return {
      passed: true,
      totalRequirements: 0,
      unfulfilledRequirementsCount: 0,
      pendingCandidateCount: 0,
      needsReplanning: false,
      suggestedEnhancements: [],
      details: ["No requirements record found."],
    };
  }

  // Count requirements
  const knownReqs = new Set<string>();
  if (isRecord(state.requirements)) {
    const list = Array.isArray(state.requirements.requirements)
      ? state.requirements.requirements
      : Array.isArray(state.requirements)
        ? state.requirements
        : [];
    for (const r of list) {
      if (isRecord(r) && typeof r.id === "string") {
        knownReqs.add(r.id);
        totalRequirements++;
      }
    }
  }

  // Check which requirements are covered by completed or active tasks
  const coveredReqs = new Set<string>();
  if (isRecord(state.tasks)) {
    for (const rawTask of Object.values(state.tasks)) {
      if (!isRecord(rawTask)) continue;
      const reqIds = Array.isArray(rawTask.requirement_ids) ? rawTask.requirement_ids : [];
      for (const req of reqIds) {
        if (typeof req === "string") {
          coveredReqs.add(req);
        }
      }
      if (rawTask.status === "changes_requested" || rawTask.status === "stale") {
        suggestedEnhancements.push(
          `Task '${String(rawTask.id)}' in '${String(rawTask.status)}' status requires repair or replan enhancement.`,
        );
      }
    }
  }

  for (const req of knownReqs) {
    if (!coveredReqs.has(req)) {
      unfulfilledRequirementsCount++;
      suggestedEnhancements.push(`Requirement '${req}' has no assigned tasks.`);
    }
  }

  // Check pending candidates in feedback or mind candidates array
  if (isRecord(state.mind) && Array.isArray(state.mind.candidates)) {
    pendingCandidateCount = state.mind.candidates.filter(
      (c) => isRecord(c) && c.status === "proposed",
    ).length;
    if (pendingCandidateCount > 0) {
      suggestedEnhancements.push(
        `${pendingCandidateCount} proposed mind candidate(s) pending admission.`,
      );
    }
  }

  const needsReplanning = unfulfilledRequirementsCount > 0 || suggestedEnhancements.length > 0;
  const passed = !needsReplanning;

  if (passed) {
    details.push(
      `Plan is coherent and complete (${totalRequirements} requirements fully covered, 0 pending enhancement blockers).`,
    );
  } else {
    details.push(...suggestedEnhancements);
  }

  return {
    passed,
    totalRequirements,
    unfulfilledRequirementsCount,
    pendingCandidateCount,
    needsReplanning,
    suggestedEnhancements,
    details,
  };
}
export function probeAgentRegistryAccuracy(state: unknown): AgentRegistryAccuracyAudit {
  const details: string[] = [];
  const unmappedLeaseAgents: string[] = [];
  const mismatchedRoleAgents: string[] = [];
  const ghostAgentIds: string[] = [];

  if (!isRecord(state)) {
    return {
      passed: true,
      totalRegistered: 0,
      totalActiveGrants: 0,
      totalActiveLeases: 0,
      accuracyPercentage: 100,
      unmappedLeaseAgents: [],
      mismatchedRoleAgents: [],
      ghostAgentIds: [],
      details: ["No agents or tasks record to audit."],
    };
  }

  // Read registered agents
  const registeredGrants = new Map<string, { role: string; status: string }>();
  if (Array.isArray(state.agents)) {
    for (const grant of state.agents) {
      if (isRecord(grant) && typeof grant.id === "string" && typeof grant.role === "string") {
        registeredGrants.set(grant.id, {
          role: grant.role,
          status: typeof grant.status === "string" ? grant.status : "active",
        });
      }
    }
  }

  const totalRegistered = registeredGrants.size;
  const totalActiveGrants = Array.from(registeredGrants.values()).filter(
    (g) => g.status === "active",
  ).length;

  let totalActiveLeases = 0;

  if (isRecord(state.tasks)) {
    for (const [taskId, rawTask] of Object.entries(state.tasks)) {
      if (!isRecord(rawTask)) continue;
      const status = String(rawTask.status);
      if (["leased", "running", "validating"].includes(status) && isRecord(rawTask.lease)) {
        totalActiveLeases++;
        const leaseAgentId =
          typeof rawTask.lease.agent_id === "string" ? rawTask.lease.agent_id : "unknown";
        const leaseRole = typeof rawTask.lease.role === "string" ? rawTask.lease.role : "unknown";

        const registered = registeredGrants.get(leaseAgentId);
        if (!registered) {
          unmappedLeaseAgents.push(leaseAgentId);
          ghostAgentIds.push(leaseAgentId);
          details.push(
            `Task '${taskId}' lease held by unregistered ghost agent '${leaseAgentId}'.`,
          );
        } else {
          if (registered.status !== "active") {
            unmappedLeaseAgents.push(leaseAgentId);
            details.push(
              `Task '${taskId}' lease held by released/inactive agent '${leaseAgentId}'.`,
            );
          }
          if (registered.role !== leaseRole) {
            mismatchedRoleAgents.push(leaseAgentId);
            details.push(
              `Task '${taskId}' lease role '${leaseRole}' mismatches registered grant role '${registered.role}' for agent '${leaseAgentId}'.`,
            );
          }
        }
      }
    }
  }

  const totalViolations =
    unmappedLeaseAgents.length + mismatchedRoleAgents.length + ghostAgentIds.length;
  const passed = totalViolations === 0;
  const accuracyPercentage =
    totalActiveLeases > 0
      ? Math.max(0, Math.round(((totalActiveLeases - totalViolations) / totalActiveLeases) * 100))
      : 100;

  if (passed) {
    details.push(
      `Agent registry has 100% accuracy: ${totalActiveGrants} active grants, ${totalActiveLeases} active leases verified with zero role mismatches.`,
    );
  }

  return {
    passed,
    totalRegistered,
    totalActiveGrants,
    totalActiveLeases,
    accuracyPercentage,
    unmappedLeaseAgents,
    mismatchedRoleAgents,
    ghostAgentIds,
    details,
  };
}
export function probeRoleBoundaryAdherence(
  state: unknown,
  runRoot?: string,
): RoleBoundaryAdherenceAudit {
  const details: string[] = [];
  const hierarchicalViolations: string[] = [];
  const tierConfinementViolations: string[] = [];

  if (runRoot !== undefined) {
    try {
      const findings = auditBehavioralHealth(runRoot, isJsonObject(state) ? state : undefined);
      for (const finding of findings) {
        const msg = `[${finding.severity.toUpperCase()}] ${finding.violation_type} (${finding.role}/${finding.agent_id}): ${finding.observation}`;
        tierConfinementViolations.push(msg);
        details.push(msg);
      }
    } catch (error) {
      const msg = `[CRITICAL] behavioral_evidence_unavailable (auditor/system): ${boundedEvidenceCause(error)}`;
      tierConfinementViolations.push(msg);
      details.push(msg);
    }
  }

  // Cross-check tasks in state for role-tier conformance
  if (isRecord(state) && isRecord(state.tasks)) {
    for (const [taskId, rawTask] of Object.entries(state.tasks)) {
      if (!isRecord(rawTask)) continue;
      if (isRecord(rawTask.lease)) {
        const leaseRole = String(rawTask.lease.role);
        const taskStatus = String(rawTask.status);
        if (taskStatus === "validating" && leaseRole !== "validator") {
          const vMsg = `Task '${taskId}' in validating status held by non-validator role '${leaseRole}'.`;
          hierarchicalViolations.push(vMsg);
          details.push(vMsg);
        } else if (
          (taskStatus === "leased" || taskStatus === "running") &&
          leaseRole !== "implementer"
        ) {
          const vMsg = `Task '${taskId}' in ${taskStatus} status held by non-implementer role '${leaseRole}'.`;
          hierarchicalViolations.push(vMsg);
          details.push(vMsg);
        }
      }
    }
  }

  const passed = hierarchicalViolations.length === 0 && tierConfinementViolations.length === 0;
  if (passed) {
    details.push(
      "All active agents and tasks strictly adhere to hierarchical tier confinement and role boundaries.",
    );
  }

  return {
    passed,
    hierarchicalViolations,
    tierConfinementViolations,
    details,
  };
}

/**
 * @file role-boundaries.ts
 * Behavioral heuristics for detecting role boundary deviations and supervisory isolation breaches.
 */

import { createIncident } from "./incident-generator.ts";
import type { BehavioralForensicsContext } from "./types.ts";

export const PERMITTED_VALIDATOR_TOOLS: ReadonlySet<string> = new Set([
  "view_file",
  "list_dir",
  "find_by_name",
  "grep_search",
  "read_resource",
  "read_url_content",
  "read_browser_page",
  "list_resources",
  "list_console_messages",
  "list_network_requests",
  "get_console_message",
  "get_network_request",
  "send_message",
]);

export interface RoleBoundaryAnalysisResult {
  readonly coordinatorWriteViolations: number;
  readonly validatorExecutionViolations: number;
  readonly ledgerBoundaryEvents: number;
  readonly totalBoundaryViolations: number;
}

export function isSupervisorRole(role: string): boolean {
  const norm = role.toLowerCase().replace(/[^a-z0-9_-]/g, "");
  return (
    norm.includes("coord") ||
    norm.includes("orchestrat") ||
    norm.includes("superv") ||
    norm.includes("planner") ||
    norm.includes("lead")
  );
}

export function isValidatorRole(role: string): boolean {
  const norm = role.toLowerCase().replace(/[^a-z0-9_-]/g, "");
  return norm.includes("validat") || norm.includes("critic") || norm.includes("auditor");
}

export function evaluateRoleBoundaryHeuristics(
  ctx: BehavioralForensicsContext,
): RoleBoundaryAnalysisResult {
  const { allToolCalls, events, agents, addIncident } = ctx;
  let coordinatorWriteViolations = 0;
  let validatorExecutionViolations = 0;
  let ledgerBoundaryEvents = 0;

  const roleByAgentId = new Map<string, string>();
  if (agents) {
    for (const a of agents) {
      if (a.role) {
        roleByAgentId.set(a.id, a.role);
      }
    }
  }

  for (const call of allToolCalls) {
    const aid = call.agentId ?? "unknown";
    const explicitRole = call.agentRole ?? roleByAgentId.get(aid) ?? aid;
    const tool = (call.toolName ?? call.name ?? "").toLowerCase();

    if (isSupervisorRole(explicitRole) && call.isWrite) {
      coordinatorWriteViolations++;
      addIncident(
        createIncident({
          category: "ROLE_BOUNDARY_DEVIATION",
          target: `coord_write_${tool}_${aid}`,
          title: "Role Boundary Deviation: Supervisor Direct Code Modification",
          observation: `Supervisor role '${explicitRole}' (agent '${aid}') executed direct code modification tool '${tool}'.`,
          severity: "CRITICAL",
          agentId: aid,
          metricsSnapshot: { agentId: aid, role: explicitRole, tool },
        }),
      );
    }

    if (isValidatorRole(explicitRole)) {
      const toolBase = tool.replace(/^mcp_[^_]+_/, "");
      const isPermitted = PERMITTED_VALIDATOR_TOOLS.has(toolBase) || call.isRead;
      if (!isPermitted || call.isWrite) {
        validatorExecutionViolations++;
        addIncident(
          createIncident({
            category: "ROLE_BOUNDARY_DEVIATION",
            target: `validator_violation_${tool}_${aid}`,
            title: "Role Boundary Deviation: Validator Execution/Write Tool Call",
            observation: `Validator agent '${aid}' (role '${explicitRole}') attempted forbidden execution or write tool '${tool}'.`,
            severity: "HIGH",
            agentId: aid,
            metricsSnapshot: { agentId: aid, role: explicitRole, tool },
          }),
        );
      }
    }
  }

  for (const evt of events) {
    const isViolation =
      evt["type"] === "boundary_violation" ||
      evt["error_code"] === "ROLE_BOUNDARY_DEVIATION" ||
      evt["category"] === "ROLE_BOUNDARY_DEVIATION" ||
      evt["kind"] === "role-boundary-violation";

    if (isViolation) {
      ledgerBoundaryEvents++;
      const commandId = typeof evt["command_id"] === "string" ? evt["command_id"] : undefined;
      const message =
        typeof evt["message"] === "string"
          ? evt["message"]
          : "Supervisory boundary violation logged in ledger.";
      const actor = typeof evt["actor"] === "string" ? evt["actor"] : "unknown";
      const target = commandId ?? actor;

      addIncident(
        createIncident({
          category: "ROLE_BOUNDARY_DEVIATION",
          target: `ledger_violation_${target}`,
          title: "Role Boundary Deviation: Recorded Invariant Breach",
          observation: message,
          severity: "CRITICAL",
          agentId: actor,
          metricsSnapshot: { actor, target },
        }),
      );
    }
  }

  const totalBoundaryViolations =
    coordinatorWriteViolations + validatorExecutionViolations + ledgerBoundaryEvents;

  return {
    coordinatorWriteViolations,
    validatorExecutionViolations,
    ledgerBoundaryEvents,
    totalBoundaryViolations,
  };
}

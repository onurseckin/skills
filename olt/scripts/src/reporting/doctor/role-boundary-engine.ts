import type { DoctorCheckEngineResult, DoctorDiagnosticFinding } from "./types.ts";

export interface RoleBoundaryInterlockOptions {
  readonly state?: Readonly<Record<string, unknown>> | null | undefined;
  readonly commands?: Readonly<Record<string, unknown>> | readonly unknown[] | null | undefined;
  readonly events?: readonly Readonly<Record<string, unknown>>[] | null | undefined;
  readonly grants?: readonly unknown[] | null | undefined;
}

const SUPERVISOR_ROLES = new Set([
  "mind",
  "orchestrator",
  "coordinator",
  "supervisor",
  "lead",
  "architect",
]);
const IMPLEMENTER_ROLES = new Set(["implementer", "developer", "coder", "repairer"]);

const CODE_EDIT_TOOLS = new Set([
  "write_to_file",
  "replace_file_content",
  "edit_file",
  "apply_diff",
  "patch_file",
]);

const PLANNING_MUTATION_EVENTS = new Set([
  "plan-brainstormed",
  "plan-initialized",
  "plan-compiled",
  "graph-mutated",
  "planning-updated",
]);

function normalizeRole(role: string): string {
  return role.trim().toLowerCase().replace(/_/gu, "-");
}

function isSupervisorRole(role: string): boolean {
  return SUPERVISOR_ROLES.has(normalizeRole(role));
}

function isImplementerRole(role: string): boolean {
  return IMPLEMENTER_ROLES.has(normalizeRole(role));
}

export function checkRoleBoundaryInterlock(
  options: RoleBoundaryInterlockOptions = {},
): DoctorCheckEngineResult {
  const findings: DoctorDiagnosticFinding[] = [];
  const agentRoleMap = new Map<string, string>();

  const rawGrants = options.grants ?? (options.state?.grants as readonly unknown[] | undefined);
  if (Array.isArray(rawGrants)) {
    for (const grant of rawGrants) {
      if (grant && typeof grant === "object") {
        const g = grant as Record<string, unknown>;
        const id =
          typeof g.id === "string" ? g.id : typeof g.agent_id === "string" ? g.agent_id : undefined;
        const role = typeof g.role === "string" ? g.role : undefined;
        const toolsUsed = Array.isArray(g.tools_used)
          ? g.tools_used.filter((t): t is string => typeof t === "string")
          : [];
        if (id && role) {
          agentRoleMap.set(id, role);

          if (isSupervisorRole(role)) {
            for (const tool of toolsUsed) {
              if (CODE_EDIT_TOOLS.has(tool)) {
                findings.push({
                  code: "ROLE_BOUNDARY_SUPERVISOR_CODE_EDIT",
                  severity: "ERROR",
                  engine: "checkRoleBoundaryInterlock",
                  message: `Supervisor role violation: Agent "${id}" with role "${role}" used forbidden code edit tool "${tool}"`,
                  details: { agentId: id, role, tool },
                });
              }
            }
          }
        }
      }
    }
  }

  const rawAgents = options.state?.agents as Record<string, unknown> | undefined;
  if (rawAgents && typeof rawAgents === "object") {
    for (const [id, agent] of Object.entries(rawAgents)) {
      if (agent && typeof agent === "object") {
        const role =
          typeof (agent as Record<string, unknown>).role === "string"
            ? ((agent as Record<string, unknown>).role as string)
            : undefined;
        if (role) {
          agentRoleMap.set(id, role);
        }
      }
    }
  }

  function resolveRole(agentId?: string, explicitRole?: string): string {
    if (explicitRole) return explicitRole;
    if (!agentId) return "";
    if (agentRoleMap.has(agentId)) return agentRoleMap.get(agentId)!;
    const lower = agentId.toLowerCase();
    if (lower.startsWith("orch") || lower.startsWith("orchestrator")) return "orchestrator";
    if (lower.startsWith("coord") || lower.startsWith("coordinator")) return "coordinator";
    if (lower.startsWith("impl") || lower.startsWith("implementer")) return "implementer";
    return "";
  }

  if (Array.isArray(options.events)) {
    for (const event of options.events) {
      if (event && typeof event === "object") {
        const evt = event as Record<string, unknown>;
        const eventName =
          typeof evt.name === "string" ? evt.name : typeof evt.type === "string" ? evt.type : "";
        const actor = typeof evt.actor === "string" ? evt.actor : undefined;
        const payload =
          evt.payload && typeof evt.payload === "object"
            ? (evt.payload as Record<string, unknown>)
            : {};
        const agentId = typeof payload.agent_id === "string" ? payload.agent_id : actor;
        const role = resolveRole(
          agentId,
          typeof payload.role === "string" ? payload.role : undefined,
        );
        const toolName =
          typeof payload.tool === "string"
            ? payload.tool
            : typeof payload.tool_name === "string"
              ? payload.tool_name
              : undefined;

        if (isSupervisorRole(role) && toolName && CODE_EDIT_TOOLS.has(toolName)) {
          findings.push({
            code: "ROLE_BOUNDARY_SUPERVISOR_CODE_EDIT",
            severity: "ERROR",
            engine: "checkRoleBoundaryInterlock",
            message: `Supervisor role violation: Agent "${agentId ?? "unknown"}" with role "${role}" executed code edit tool "${toolName}"`,
            details: { agentId, role, tool: toolName, eventName },
          });
        }

        if (isImplementerRole(role) && PLANNING_MUTATION_EVENTS.has(eventName)) {
          findings.push({
            code: "ROLE_BOUNDARY_IMPLEMENTER_PLAN_MUTATION",
            severity: "ERROR",
            engine: "checkRoleBoundaryInterlock",
            message: `Implementer role boundary violation: Agent "${agentId ?? "unknown"}" with role "${role}" attempted planning graph mutation in event "${eventName}"`,
            details: { agentId, role, eventName },
          });
        }

        if (
          eventName === "task-satisfied" ||
          eventName === "task-approved" ||
          eventName === "gate-approved"
        ) {
          const taskImplementer =
            typeof payload.implementer_id === "string"
              ? payload.implementer_id
              : typeof payload.implementer === "string"
                ? payload.implementer
                : undefined;
          const approvingActor = agentId ?? actor;
          if (taskImplementer && approvingActor && taskImplementer === approvingActor) {
            findings.push({
              code: "ROLE_BOUNDARY_IMPLEMENTER_SELF_APPROVAL",
              severity: "ERROR",
              engine: "checkRoleBoundaryInterlock",
              message: `Implementer self-approval violation: Agent "${approvingActor}" self-approved task "${payload.task_id ?? "unknown"}"`,
              details: { agentId: approvingActor, taskId: payload.task_id },
            });
          }
        }
      }
    }
  }

  const rawTasks = options.state?.tasks as Record<string, unknown> | undefined;
  if (rawTasks && typeof rawTasks === "object") {
    for (const [key, val] of Object.entries(rawTasks)) {
      if (val && typeof val === "object") {
        const task = val as Record<string, unknown>;
        const implementer =
          typeof task.assigned_agent === "string" ? task.assigned_agent : undefined;
        const validator =
          typeof task.validator_agent === "string"
            ? task.validator_agent
            : typeof task.validator_id === "string"
              ? task.validator_id
              : undefined;
        const isSatisfied = task.status === "satisfied" || task.status === "completed";
        if (isSatisfied && implementer && validator && implementer === validator) {
          findings.push({
            code: "ROLE_BOUNDARY_IMPLEMENTER_SELF_APPROVAL",
            severity: "ERROR",
            engine: "checkRoleBoundaryInterlock",
            message: `Implementer self-approval violation in task state: Task "${key}" has identical implementer and validator ("${implementer}")`,
            details: { taskId: key, implementer, validator },
          });
        }
      }
    }
  }

  return {
    engine: "checkRoleBoundaryInterlock",
    passed: findings.length === 0,
    findings,
  };
}

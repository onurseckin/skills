import { inferRoleFromAgentId } from "../../authority/thread/index.ts";
import { isJsonObject } from "../../core/contracts/index.ts";
import {
  computeDoctorEnginePassed,
  type DoctorCheckEngineResult,
  type DoctorDiagnosticFinding,
} from "./types.ts";

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
const IMPLEMENTER_ROLES = new Set(["implementer", "developer", "coder"]);

export const CODE_EDIT_TOOLS = new Set([
  "write_to_file",
  "replace_file_content",
  "edit_file",
  "apply_diff",
  "patch_file",
  "run_command",
  "execute_command",
  "shell",
  "exec",
]);

const PLANNING_MUTATION_EVENTS = new Set([
  "plan-brainstormed",
  "plan-initialized",
  "plan-compiled",
  "graph-mutated",
  "planning-updated",
]);

const WORKER_COMMANDS = new Set(["task:claim", "task:submit", "task:check"]);
const COORDINATOR_COMMANDS = new Set(["plan:compile", "plan:enhance", "plan:add"]);

function normalizeRole(role: string): string {
  return role.trim().toLowerCase().replace(/_/gu, "-");
}

function isSupervisorRole(role: string): boolean {
  return SUPERVISOR_ROLES.has(normalizeRole(role));
}

function isImplementerRole(role: string): boolean {
  return IMPLEMENTER_ROLES.has(normalizeRole(role));
}

function isRestrictedMainThreadCommand(commandName: string): boolean {
  if (WORKER_COMMANDS.has(commandName)) return true;
  if (COORDINATOR_COMMANDS.has(commandName)) return true;
  return false;
}

function isMainThreadOrUnauthenticatedActor(
  actor: string | undefined,
  agentRoleMap: Map<string, string>,
): boolean {
  if (actor === undefined) return true;
  const trimmed = actor.trim();
  if (trimmed.length === 0) return true;
  const lower = trimmed.toLowerCase();
  if (lower === "main") return true;
  if (lower === "main-thread") return true;
  if (lower === "main_thread") return true;
  if (lower === "user") return true;
  if (lower.startsWith("user-")) return true;
  if (lower.startsWith("user_")) return true;
  if (lower === "human") return true;
  if (lower.startsWith("human-")) return true;
  if (lower.startsWith("human_")) return true;

  if (agentRoleMap.has(trimmed) === false) {
    const inferred: unknown = inferRoleFromAgentId(trimmed);
    if (inferred === undefined) return true;
    if (inferred === null) return true;
    if (typeof inferred === "string") {
      if (inferred.length === 0) return true;
      if (inferred === "user") return true;
    }
  }
  return false;
}

export function checkRoleBoundaryInterlock(
  options: RoleBoundaryInterlockOptions = {},
): DoctorCheckEngineResult {
  const findings: DoctorDiagnosticFinding[] = [];
  const agentRoleMap = new Map<string, string>();

  let rawGrants: readonly unknown[] | undefined = undefined;
  if (Array.isArray(options.grants)) {
    rawGrants = options.grants;
  } else if (options.state !== undefined && options.state !== null) {
    if (Array.isArray(options.state.grants)) {
      rawGrants = options.state.grants;
    }
  }

  if (rawGrants !== undefined) {
    for (const grant of rawGrants) {
      if (isJsonObject(grant)) {
        const g = grant as Record<string, unknown>;
        let id: string | undefined = undefined;
        if (typeof g.id === "string") {
          id = g.id;
        } else if (typeof g.agent_id === "string") {
          id = g.agent_id;
        }
        const role = typeof g.role === "string" ? g.role : undefined;
        let toolsUsed: string[] = [];
        if (Array.isArray(g.tools_used)) {
          const list: readonly unknown[] = g.tools_used;
          toolsUsed = list.filter((t): t is string => typeof t === "string");
        }
        if (id !== undefined && role !== undefined) {
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

  const rawAgents =
    options.state !== undefined && options.state !== null && isJsonObject(options.state.agents)
      ? options.state.agents
      : undefined;
  if (rawAgents !== undefined) {
    for (const [id, agent] of Object.entries(rawAgents)) {
      if (isJsonObject(agent)) {
        const role =
          typeof (agent as Record<string, unknown>).role === "string"
            ? ((agent as Record<string, unknown>).role as string)
            : undefined;
        if (role !== undefined) {
          agentRoleMap.set(id, role);
        }
      }
    }
  }

  function resolveRole(agentId?: string, explicitRole?: string): string {
    if (explicitRole !== undefined) return explicitRole;
    if (agentId === undefined) return "";
    if (agentId.length === 0) return "";
    const mapped = agentRoleMap.get(agentId);
    if (mapped !== undefined) return mapped;
    const lower = agentId.toLowerCase();
    if (lower.startsWith("user")) return "user";
    if (lower.startsWith("human")) return "user";
    const inferred: unknown = inferRoleFromAgentId(agentId);
    if (inferred !== undefined && inferred !== null && typeof inferred === "string") return inferred;
    return "";
  }

  let rawCommands: unknown = options.commands;
  if (rawCommands === undefined) {
    if (options.state !== undefined && options.state !== null) {
      rawCommands = options.state.commands;
    }
  }

  if (rawCommands !== undefined && rawCommands !== null) {
    let commandEntries: readonly unknown[] = [];
    if (Array.isArray(rawCommands)) {
      commandEntries = rawCommands;
    } else if (isJsonObject(rawCommands)) {
      commandEntries = Object.values(rawCommands);
    }

    for (const cmdEntry of commandEntries) {
      if (isJsonObject(cmdEntry)) {
        let commandName = "";
        if (typeof cmdEntry.command === "string") {
          commandName = cmdEntry.command;
        } else if (typeof cmdEntry.cmd === "string") {
          commandName = cmdEntry.cmd;
        } else if (typeof cmdEntry.name === "string") {
          commandName = cmdEntry.name;
        }

        let actor: string | undefined = undefined;
        if (typeof cmdEntry.actor === "string") {
          actor = cmdEntry.actor;
        } else if (typeof cmdEntry.agent_id === "string") {
          actor = cmdEntry.agent_id;
        } else if (typeof cmdEntry.agentId === "string") {
          actor = cmdEntry.agentId;
        }

        if (isRestrictedMainThreadCommand(commandName)) {
          if (isMainThreadOrUnauthenticatedActor(actor, agentRoleMap)) {
            const actorName =
              actor !== undefined && actor.trim().length > 0 ? actor : "unauthenticated";
            findings.push({
              code: "ROLE_BOUNDARY_MAIN_THREAD_EXECUTION",
              severity: "ERROR",
              engine: "checkRoleBoundaryInterlock",
              message: `Main-thread / unauthenticated execution violation: Command "${commandName}" executed by unauthorized actor "${actorName}". Worker and coordinator commands must execute within an authenticated agent lease.`,
              details: { actor: actorName, command: commandName },
            });
          }
        }
      }
    }
  }

  if (Array.isArray(options.events)) {
    for (const event of options.events) {
      if (isJsonObject(event)) {
        const evt = event as Record<string, unknown>;
        let eventName = "";
        if (typeof evt.name === "string") {
          eventName = evt.name;
        } else if (typeof evt.type === "string") {
          eventName = evt.type;
        }
        const actor = typeof evt.actor === "string" ? evt.actor : undefined;
        let payload: Record<string, unknown> = {};
        if (isJsonObject(evt.payload)) {
          payload = evt.payload;
        }
        let agentId: string | undefined = undefined;
        if (typeof payload.agent_id === "string") {
          agentId = payload.agent_id;
        } else if (typeof payload.agentId === "string") {
          agentId = payload.agentId;
        } else if (actor !== undefined) {
          agentId = actor;
        }

        let eventCommand = "";
        if (typeof payload.command === "string") {
          eventCommand = payload.command;
        } else if (typeof payload.cmd === "string") {
          eventCommand = payload.cmd;
        } else if (typeof evt.command === "string") {
          eventCommand = evt.command;
        } else if (isRestrictedMainThreadCommand(eventName)) {
          eventCommand = eventName;
        }

        if (isRestrictedMainThreadCommand(eventCommand)) {
          const effectiveActor = agentId !== undefined ? agentId : actor;
          if (isMainThreadOrUnauthenticatedActor(effectiveActor, agentRoleMap)) {
            const actorName =
              effectiveActor !== undefined && effectiveActor.trim().length > 0
                ? effectiveActor
                : "unauthenticated";
            findings.push({
              code: "ROLE_BOUNDARY_MAIN_THREAD_EXECUTION",
              severity: "ERROR",
              engine: "checkRoleBoundaryInterlock",
              message: `Main-thread / unauthenticated execution violation: Command "${eventCommand}" executed by unauthorized actor "${actorName}". Worker and coordinator commands must execute within an authenticated agent lease.`,
              details: { actor: actorName, command: eventCommand, eventName },
            });
          }
        }

        const explicitRole = typeof payload.role === "string" ? payload.role : undefined;
        const role = resolveRole(agentId, explicitRole);
        let toolName: string | undefined = undefined;
        if (typeof payload.tool === "string") {
          toolName = payload.tool;
        } else if (typeof payload.tool_name === "string") {
          toolName = payload.tool_name;
        }

        if (isSupervisorRole(role) && toolName !== undefined && CODE_EDIT_TOOLS.has(toolName)) {
          findings.push({
            code: "ROLE_BOUNDARY_SUPERVISOR_CODE_EDIT",
            severity: "ERROR",
            engine: "checkRoleBoundaryInterlock",
            message: `Supervisor role violation: Agent "${agentId !== undefined ? agentId : "unknown"}" with role "${role}" executed code edit tool "${toolName}"`,
            details: { agentId, role, tool: toolName, eventName },
          });
        }

        if (isImplementerRole(role) && PLANNING_MUTATION_EVENTS.has(eventName)) {
          findings.push({
            code: "ROLE_BOUNDARY_IMPLEMENTER_PLAN_MUTATION",
            severity: "ERROR",
            engine: "checkRoleBoundaryInterlock",
            message: `Implementer role boundary violation: Agent "${agentId !== undefined ? agentId : "unknown"}" with role "${role}" attempted planning graph mutation in event "${eventName}"`,
            details: { agentId, role, eventName },
          });
        }

        let isApprovalEvent = false;
        if (eventName === "task-satisfied") {
          isApprovalEvent = true;
        } else if (eventName === "task-approved") {
          isApprovalEvent = true;
        } else if (eventName === "gate-approved") {
          isApprovalEvent = true;
        }

        if (isApprovalEvent) {
          let taskImplementer: string | undefined = undefined;
          if (typeof payload.implementer_id === "string") {
            taskImplementer = payload.implementer_id;
          } else if (typeof payload.implementer === "string") {
            taskImplementer = payload.implementer;
          }
          let approvingActor: string | undefined = agentId;
          if (approvingActor === undefined) {
            approvingActor = actor;
          }
          if (
            taskImplementer !== undefined &&
            approvingActor !== undefined &&
            taskImplementer === approvingActor
          ) {
            const taskIdVal = typeof payload.task_id === "string" ? payload.task_id : "unknown";
            findings.push({
              code: "ROLE_BOUNDARY_IMPLEMENTER_SELF_APPROVAL",
              severity: "ERROR",
              engine: "checkRoleBoundaryInterlock",
              message: `Implementer self-approval violation: Agent "${approvingActor}" self-approved task "${taskIdVal}"`,
              details: { agentId: approvingActor, taskId: payload.task_id },
            });
          }
        }
      }
    }
  }

  const rawTasks =
    options.state !== undefined && options.state !== null && isJsonObject(options.state.tasks)
      ? options.state.tasks
      : undefined;
  if (rawTasks !== undefined) {
    for (const [key, val] of Object.entries(rawTasks)) {
      if (isJsonObject(val)) {
        const task = val as Record<string, unknown>;
        const implementer =
          typeof task.assigned_agent === "string" ? task.assigned_agent : undefined;
        let validator: string | undefined = undefined;
        if (typeof task.validator_agent === "string") {
          validator = task.validator_agent;
        } else if (typeof task.validator_id === "string") {
          validator = task.validator_id;
        }
        let isSatisfied = false;
        if (task.status === "satisfied") {
          isSatisfied = true;
        } else if (task.status === "completed") {
          isSatisfied = true;
        }
        if (
          isSatisfied &&
          implementer !== undefined &&
          validator !== undefined &&
          implementer === validator
        ) {
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
    passed: computeDoctorEnginePassed(findings),
    findings,
  };
}

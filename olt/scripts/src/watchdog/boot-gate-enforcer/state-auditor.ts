import type { JsonObject } from "../../core/contracts/index.ts";
import type { SubagentBootGateRecord, SubagentRegistrationOptions } from "./types.ts";

export function auditBootGatesFromState(
  state: JsonObject | null | undefined,
  records: Map<string, SubagentBootGateRecord>,
  registerFn: (
    options: SubagentRegistrationOptions,
    now?: string | number | Date,
  ) => SubagentBootGateRecord,
  recordCommandFn: (
    agentId: string,
    argv: readonly string[],
    now?: string | number | Date,
    exitCode?: number,
    pid?: number,
    outputSnippet?: string,
  ) => SubagentBootGateRecord | undefined,
  now?: string | number | Date,
): readonly SubagentBootGateRecord[] {
  if (!state) return Array.from(records.values());

  const timestamp = now !== undefined ? new Date(now).toISOString() : new Date().toISOString();

  const agentsRaw = state.agents;
  if (Array.isArray(agentsRaw)) {
    for (const ag of agentsRaw) {
      if (typeof ag === "object" && ag !== null) {
        const entry = ag as Record<string, unknown>;
        const id = typeof entry.id === "string" ? entry.id : undefined;
        const role = typeof entry.role === "string" ? entry.role : "subagent";
        const parentId = typeof entry.parent_agent_id === "string" ? entry.parent_agent_id : null;
        const taskId = typeof entry.parent_task_id === "string" ? entry.parent_task_id : null;
        const pid = typeof entry.pid === "number" ? entry.pid : undefined;
        const ppid = typeof entry.ppid === "number" ? entry.ppid : undefined;
        const grantedAt = typeof entry.granted_at === "string" ? entry.granted_at : timestamp;

        if (id && !records.has(id)) {
          registerFn(
            {
              agentId: id,
              role,
              parentAgentId: parentId,
              taskId,
              pid,
              ppid,
              spawnedAt: grantedAt,
            },
            timestamp,
          );
        }
      }
    }
  }

  const commandsRaw = state.commands;
  if (typeof commandsRaw === "object" && commandsRaw !== null) {
    for (const cmd of Object.values(commandsRaw)) {
      if (typeof cmd === "object" && cmd !== null) {
        const entry = cmd as Record<string, unknown>;
        const actor = typeof entry.actor === "string" ? entry.actor : undefined;
        const argv = Array.isArray(entry.argv) ? entry.argv.map(String) : [];
        const startedAt = typeof entry.started_at === "string" ? entry.started_at : timestamp;
        const exitCode = typeof entry.exit_code === "number" ? entry.exit_code : undefined;
        const pid = typeof entry.pid === "number" ? entry.pid : undefined;

        if (actor && argv.length > 0) {
          recordCommandFn(actor, argv, startedAt, exitCode, pid);
        }
      }
    }
  }

  return Array.from(records.values());
}

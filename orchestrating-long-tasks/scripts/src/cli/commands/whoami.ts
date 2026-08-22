import { integerFlag, textFlag, type Flags } from "../options.ts";
import { enforceLineLimit } from "../formatters/line-limiter.ts";
import { loadRun } from "../../store/index.ts";
import { readAgentLedger } from "../../workflow/agents/ledger.ts";
import { identifyExecutionContext } from "../../authority/thread-identifier.ts";
import { isJsonObject } from "../../contracts/json.ts";
import type { AgentGrantRecord } from "../../contracts/agents.ts";

export interface TaskLeaseSummary {
  task_id: string;
  agent_id: string;
  role: string;
  expires_at: string;
  status: string;
}

function parseOptionalInt(flags: Flags, name: string, minimum = 0): number | undefined {
  const raw: unknown = flags[name];
  if (raw === undefined) return undefined;
  if (typeof raw === "number" && Number.isSafeInteger(raw) && raw >= minimum) return raw;
  return integerFlag(flags, name, { minimum });
}

function parseOptionalText(flags: Flags, name: string): string | undefined {
  const raw: unknown = flags[name];
  if (raw === undefined) return undefined;
  if (typeof raw === "string") return textFlag(flags, name, false);
  return undefined;
}

export function whoamiCommand(flags: Flags): Record<string, unknown> {
  const run = parseOptionalText(flags, "run") ?? null;
  const agentOverride = parseOptionalText(flags, "agent");
  const pidOverride = parseOptionalInt(flags, "pid", 1);
  const ppidOverride = parseOptionalInt(flags, "ppid", 0);

  const thread = identifyExecutionContext({
    ...(pidOverride !== undefined ? { pid: pidOverride } : {}),
    ...(ppidOverride !== undefined ? { ppid: ppidOverride } : {}),
    ...(agentOverride !== undefined ? { agentId: agentOverride } : {}),
    ...(run !== null ? { runRoot: run } : {}),
  });

  const activeAgentId = agentOverride ?? thread.agent_id;

  let activeGrants: AgentGrantRecord[] = [];
  const activeLeases: TaskLeaseSummary[] = [];

  if (run !== null) {
    try {
      const loaded = loadRun(run);
      const state = loaded.state;
      const ledger = readAgentLedger(state);
      activeGrants = ledger.filter((grant) => grant.status === "active");

      if (isJsonObject(state.tasks)) {
        for (const [taskId, rawTask] of Object.entries(state.tasks)) {
          if (!isJsonObject(rawTask)) continue;
          const lease = rawTask.lease;
          if (isJsonObject(lease)) {
            const leaseAgentId = typeof lease.agent_id === "string" ? lease.agent_id : "";
            const leaseRole = typeof lease.role === "string" ? lease.role : "";
            const leaseExpires = typeof lease.expires_at === "string" ? lease.expires_at : "";
            const taskStatus = typeof rawTask.status === "string" ? rawTask.status : "leased";
            activeLeases.push({
              task_id: taskId,
              agent_id: leaseAgentId,
              role: leaseRole,
              expires_at: leaseExpires,
              status: taskStatus,
            });
          }
        }
      }
    } catch {
      // If run fails to load or does not exist, proceed with thread info alone
    }
  }

  const filteredGrants = activeAgentId
    ? activeGrants.filter((grant) => grant.id === activeAgentId)
    : activeGrants;

  const filteredLeases = activeAgentId
    ? activeLeases.filter((lease) => lease.agent_id === activeAgentId)
    : activeLeases;

  const mdLines: string[] = [
    `### Thread Authority Identification (\`whoami\`)`,
    `- **PID / PPID**: \`${thread.pid}\` / \`${thread.ppid}\``,
    `- **Execution Tier**: \`${thread.is_main_thread ? "Main Interactive Agent Thread" : `Tier ${thread.tier}`}\` (${thread.tier_name})`,
    `- **Active Agent**: \`${activeAgentId ?? thread.agent_id ?? "none"}\`${thread.role ? ` (role: \`${thread.role}\`)` : ""}`,
    `- **Compliance**: \`${thread.compliance_state.toUpperCase()}\``,
  ];

  if (thread.advisory) {
    mdLines.push(`- **Advisory**: ⚠️ ${thread.advisory}`);
  }

  if (thread.blunder) {
    mdLines.push(`- **Blunder Logged**: \`${thread.blunder.id}\` (${thread.blunder.type})`);
  }

  if (run !== null) {
    mdLines.push(`- **Run Root**: \`${run}\``);
    mdLines.push(`- **Active Grants**: \`${filteredGrants.length}\` active (total run active: \`${activeGrants.length}\`)`);
    mdLines.push(`- **Active Leases**: \`${filteredLeases.length}\` held (total run leases: \`${activeLeases.length}\`)`);

    if (filteredLeases.length > 0) {
      mdLines.push(`- **Held Tasks**: ${filteredLeases.map((l) => `\`${l.task_id}\``).join(", ")}`);
    }
  }

  return {
    markdown: enforceLineLimit(mdLines.join("\n"), 30),
    run_root: run,
    thread,
    pid: thread.pid,
    ppid: thread.ppid,
    tier: thread.tier,
    tier_name: thread.tier_name,
    agent_id: activeAgentId ?? thread.agent_id,
    role: thread.role,
    is_main_thread: thread.is_main_thread,
    compliance_state: thread.compliance_state,
    advisory: thread.advisory,
    active_grants: filteredGrants,
    active_leases: filteredLeases,
    blunder: thread.blunder,
  };
}

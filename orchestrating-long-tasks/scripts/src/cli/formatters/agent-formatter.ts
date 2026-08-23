import type { AgentGrantRecord, AgentToolRef } from "../../contracts/agents.ts";
import type { Evidenced } from "../../contracts/evidence.ts";
import { isKnownToolCategory } from "../../contracts/taxonomy.ts";
import type { TaskLineage } from "../../workflow/agents/lineage.ts";
import { enforceLineLimit, formatTable } from "./line-limiter.ts";
import {
  agentListNextActions,
  agentRegisterNextActions,
  nextActionsBlock,
  type NextActionItem,
} from "./next-actions.ts";

export interface AgentBriefParams {
  agentId: string;
  role: string;
  parentAgentId?: string | null;
  parentTaskId?: string | null;
  model?: string;
  thinkingLevel?: string;
  tools?: readonly string[];
  writeScope?: readonly string[];
  recommendedCommands?: readonly string[];
}

export function formatAgentBrief(params: AgentBriefParams): string {
  const parent = params.parentAgentId ? `\`${params.parentAgentId}\`` : "root";
  const task = params.parentTaskId ? `task \`${params.parentTaskId}\`` : "no task";
  const toolsStr =
    params.tools && params.tools.length > 0
      ? params.tools.map((t) => `\`${t}\``).join(", ")
      : "none";
  const scopeStr =
    params.writeScope && params.writeScope.length > 0
      ? params.writeScope.map((s) => `\`${s}\``).join(", ")
      : undefined;

  const mdLines: string[] = [
    `### 🌌 Zero-Exploration Briefing: Agent ${params.agentId} (${params.role})`,
    `- **Under**: ${parent} / ${task}`,
    `- **Model**: \`${params.model ?? "unknown"}\` · **Thinking**: \`${params.thinkingLevel ?? "unknown"}\``,
    `- **Tools Granted**: ${toolsStr}`,
  ];

  if (scopeStr) {
    mdLines.push(`- **Assigned Write Scope**: ${scopeStr}`);
  }
  if (params.recommendedCommands && params.recommendedCommands.length > 0) {
    mdLines.push(`- **Recommended Commands**:`);
    for (const cmd of params.recommendedCommands) {
      mdLines.push(`  - \`${cmd}\``);
    }
  }

  const nextActions: NextActionItem[] = [];
  if (params.parentTaskId) {
    nextActions.push({
      command: `bun harness.ts task:brief --task ${params.parentTaskId} --agent ${params.agentId} --role ${params.role}`,
      role: params.role,
      description: "Inspect task briefing and exact write scope",
    });
    if (params.role === "implementer" || params.role === "repairer") {
      nextActions.push({
        command: `bun harness.ts task:claim --task ${params.parentTaskId} --agent ${params.agentId} --role ${params.role}`,
        role: params.role,
        description: "Claim task lease",
      });
    } else if (params.role === "validator") {
      nextActions.push({
        command: `bun harness.ts task:validate-start --task ${params.parentTaskId} --validator ${params.agentId}`,
        role: "Validator",
        description: "Start validation lease",
      });
    }
  }
  if (nextActions.length > 0) {
    mdLines.push(...nextActionsBlock(nextActions));
  }

  return enforceLineLimit(mdLines.join("\n"), 30);
}

function cell(value: Evidenced<number | string> | undefined): string {
  if (value === undefined) return "unknown";
  const estimate = value.is_estimated === true ? ", estimated" : "";
  return `\`${String(value.value)}\` (${value.evidence_class}${estimate})`;
}

function toolCell(tool: AgentToolRef): string {
  if (tool.category === undefined) return `\`${tool.name}\` (uncategorised)`;
  const marker = isKnownToolCategory(tool.category) ? "" : ", unrecognised category";
  return `\`${tool.name}\` (${tool.category}${marker})`;
}

function listCell(value: Evidenced<AgentToolRef[]> | undefined): string {
  if (value === undefined) return "unknown";
  if (value.value.length === 0) return `none (${value.evidence_class})`;
  return `${value.value.map(toolCell).join(", ")} (${value.evidence_class})`;
}

function parentCell(grant: AgentGrantRecord): string {
  const parent = grant.parent_agent_id === null ? "root" : `\`${grant.parent_agent_id}\``;
  const task = grant.parent_task_id === null ? "no task" : `task \`${grant.parent_task_id}\``;
  return `${parent} / ${task}`;
}

export function formatAgentRegisterBrief(grant: AgentGrantRecord, runId: string): string {
  const md = [
    `### Agent Granted: ${grant.id} (${grant.role})`,
    `- **Under**: ${parentCell(grant)}`,
    `- **Host**: \`${grant.host}\` · **Provider**: ${cell(grant.provider)}`,
    `- **Model**: ${cell(grant.model)} · **Tier**: ${cell(grant.model_tier)}`,
    `- **Thinking**: ${cell(grant.thinking_level)} · **Context Window**: ${cell(grant.context_window)}`,
    `- **Tools Granted**: ${listCell(grant.tools_granted)}`,
    "",
    "#### Close The Grant:",
    "```bash",
    `bun harness.ts agent:release --run ${runId} --agent ${grant.id} --reason "<why>"`,
    "```",
    ...nextActionsBlock(agentRegisterNextActions(runId, grant.id)),
  ].join("\n");
  return enforceLineLimit(md);
}

export function formatAgentReportBrief(grant: AgentGrantRecord, runId: string): string {
  const tools = grant.tools_used ?? [];
  const toolList =
    tools.length === 0
      ? "none reported"
      : tools.map((tool) => `${toolCell(tool)} [${tool.evidence_class}]`).join(", ");
  const extras = Object.entries(grant.token_extras ?? {});
  const extraList =
    extras.length === 0
      ? "none reported"
      : extras.map(([name, counter]) => `\`${name}\` ${cell(counter)}`).join(", ");
  const md = [
    `### Agent Report: ${grant.id} (${grant.role})`,
    `- **Reports Ingested**: ${grant.report_count ?? 0} (latest ${grant.last_reported_at ?? "unknown"})`,
    `- **Tools Used**: ${toolList}`,
    `- **Tokens In**: ${cell(grant.tokens_in)} · **Tokens Out**: ${cell(grant.tokens_out)}`,
    `- **Other Counters**: ${extraList}`,
    `- **Grant**: ${grant.status}, under ${parentCell(grant)}`,
    `- **Run**: \`${runId}\``,
    ...nextActionsBlock([
      {
        command: `bun harness.ts agent:list --run ${runId}`,
        role: "Coordinator",
        description: "Inspect all active agent grants",
      },
    ]),
  ].join("\n");
  return enforceLineLimit(md);
}

export function formatAgentReleaseBrief(grant: AgentGrantRecord, runId: string): string {
  const md = [
    `### Agent Released: ${grant.id} (${grant.role})`,
    `- **Granted At**: ${grant.granted_at}`,
    `- **Released At**: ${grant.released_at ?? "unknown"}`,
    `- **Reason**: ${grant.release_reason ?? "none recorded"}`,
    `- **Tokens In**: ${cell(grant.tokens_in)} · **Tokens Out**: ${cell(grant.tokens_out)}`,
    "",
    `Remaining deployment: \`bun harness.ts agent:list --run ${runId}\``,
    ...nextActionsBlock(agentListNextActions(runId)),
  ].join("\n");
  return enforceLineLimit(md);
}

export function formatAgentListBrief(
  grants: readonly AgentGrantRecord[],
  runId: string,
  includeReleased: boolean,
): string {
  const active = grants.filter((grant) => grant.status === "active");
  const shown = includeReleased ? grants : active;
  if (shown.length === 0) {
    return enforceLineLimit(
      [
        `### Deployed Agents: ${runId}`,
        `- **Active Grants**: 0`,
        `- **Released Grants**: ${grants.length - active.length}`,
        `- **Action**: \`bun harness.ts agent:register --run ${runId} --agent <ID> --role <ROLE> --host <HOST>\``,
        ...nextActionsBlock(agentListNextActions(runId)),
      ].join("\n"),
    );
  }
  const rows = shown.map((grant) => [
    `\`${grant.id}\``,
    grant.role,
    grant.parent_agent_id === null ? "root" : `\`${grant.parent_agent_id}\``,
    grant.parent_task_id === null ? "-" : `\`${grant.parent_task_id}\``,
    grant.status,
    cell(grant.model),
    cell(grant.thinking_level),
  ]);
  const md = [
    `### Deployed Agents: ${runId}`,
    "",
    ...formatTable(["Agent", "Role", "Under", "Task", "Status", "Model", "Thinking"], rows),
    "",
    `- **Active**: ${active.length} · **Released**: ${grants.length - active.length}`,
    ...nextActionsBlock(agentListNextActions(runId)),
  ].join("\n");
  return enforceLineLimit(md);
}

export function formatAgentLineageBrief(lineage: TaskLineage): string {
  if (lineage.agents.length === 0) {
    return enforceLineLimit(
      [
        `### Task Lineage: ${lineage.task_id}`,
        `- **Agents**: none registered against this task.`,
      ].join("\n"),
    );
  }
  const rows = lineage.agents.map((node) => [
    String(node.depth),
    `\`${node.agent_id}\``,
    node.role,
    node.ancestors.length === 0 ? "root" : node.ancestors.map((id) => `\`${id}\``).join(" ← "),
    node.status,
  ]);
  const md = [
    `### Task Lineage: ${lineage.task_id}`,
    "",
    ...formatTable(["Depth", "Agent", "Role", "Under", "Status"], rows),
    ...nextActionsBlock([
      {
        command: `bun harness.ts task:claim --task ${lineage.task_id} --agent <AGENT>`,
        role: "Implementer",
        description: "Inspect or claim task",
      },
    ]),
  ].join("\n");
  return enforceLineLimit(md);
}

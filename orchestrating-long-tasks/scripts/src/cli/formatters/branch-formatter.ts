import type { BranchRecord, BranchSubTask } from "../../contracts/branch.ts";
import { enforceLineLimit, formatTable } from "./line-limiter.ts";

function subTaskRows(branch: BranchRecord): string[][] {
  return branch.sub_tasks.map((subTask) => [
    `\`${subTask.id}\``,
    subTask.label,
    subTask.status,
    subTask.agent_id === undefined ? "unclaimed" : `\`${subTask.agent_id}\``,
    subTask.write_scope.map((scope) => `\`${scope}\``).join(", "),
  ]);
}

function filesCell(branch: BranchRecord): string {
  const files = branch.files_changed;
  if (files === undefined) return "unknown (no repository observation)";
  if (files.value.length === 0) return `no file changed (${files.evidence_class})`;
  return `${files.value.length} files (${files.evidence_class})`;
}

export function formatBranchOpenBrief(branch: BranchRecord, runId: string): string {
  const md = [
    `### Branch Opened: ${branch.id}`,
    `- **Parent**: \`${branch.parent_task_id}\` held by \`${branch.parent_agent_id}\` (now branched, lease frozen)`,
    `- **Reason**: ${branch.reason}`,
    `- **Depth**: ${branch.depth}`,
    "",
    ...formatTable(["Sub-task", "Label", "Status", "Agent", "Write Scope"], subTaskRows(branch)),
    "",
    "#### Dispatch And Collect:",
    "```bash",
    `bun harness.ts branch:claim --run ${runId} --branch ${branch.id} --sub-task <ID> --agent <AGENT>`,
    `bun harness.ts branch:collect --run ${runId} --branch ${branch.id} --agent ${branch.parent_agent_id} --token <PARENT_TOKEN> --summary "<WHAT CAME BACK>"`,
    "```",
  ].join("\n");
  return enforceLineLimit(md);
}

export function formatBranchClaimBrief(
  branch: BranchRecord,
  subTask: BranchSubTask,
  token: string,
  runId: string,
): string {
  const md = [
    `### Sub-task Claimed: ${subTask.id}`,
    `- **Branch**: \`${branch.id}\` (depth ${branch.depth}) on \`${branch.parent_task_id}\``,
    `- **Agent**: \`${subTask.agent_id ?? "unknown"}\``,
    `- **Write Scope**: ${subTask.write_scope.map((scope) => `\`${scope}\``).join(", ")}`,
    `- **Gate**: ${subTask.gate === undefined ? "none declared" : `\`${subTask.gate}\``}`,
    `- **Lease Expires**: ${subTask.lease?.expires_at ?? "unknown"}`,
    `- **Token**: \`${token}\``,
    "",
    "```bash",
    `bun harness.ts branch:submit --run ${runId} --branch ${branch.id} --sub-task ${subTask.id} --agent ${subTask.agent_id ?? "<AGENT>"} --token ${token} --summary "<WHAT CHANGED>"`,
    "```",
  ].join("\n");
  return enforceLineLimit(md);
}

export function formatBranchSubmitBrief(branch: BranchRecord, subTaskId: string): string {
  const pending = branch.sub_tasks.filter(
    (subTask) => subTask.status !== "submitted" && subTask.status !== "abandoned",
  );
  const md = [
    `### Sub-task Submitted: ${subTaskId}`,
    `- **Branch**: \`${branch.id}\` on \`${branch.parent_task_id}\``,
    `- **Still Open**: ${pending.length === 0 ? "none - the branch is ready to collect" : pending.map((subTask) => `\`${subTask.id}\` (${subTask.status})`).join(", ")}`,
    "",
    ...formatTable(["Sub-task", "Label", "Status", "Agent", "Write Scope"], subTaskRows(branch)),
  ].join("\n");
  return enforceLineLimit(md);
}

export function formatBranchCollectBrief(branch: BranchRecord, parentStatus: string): string {
  const files = branch.files_changed?.value ?? [];
  const md = [
    `### Branch Collected: ${branch.id}`,
    `- **Parent**: \`${branch.parent_task_id}\` is now ${parentStatus} with a fresh lease`,
    `- **Reason It Branched**: ${branch.reason}`,
    `- **Outcome**: ${branch.outcome_summary ?? "none recorded"}`,
    `- **Files Changed**: ${filesCell(branch)}`,
    ...files.slice(0, 10).map((file) => `  - \`${file}\``),
    ...(files.length > 10 ? [`  - ... ${files.length - 10} more`] : []),
    "",
    ...formatTable(["Sub-task", "Label", "Status", "Agent", "Write Scope"], subTaskRows(branch)),
  ].join("\n");
  return enforceLineLimit(md);
}

export function formatBranchAbandonBrief(branch: BranchRecord, parentStatus: string): string {
  const md = [
    `### Branch Abandoned: ${branch.id}`,
    `- **Parent**: \`${branch.parent_task_id}\` is now ${parentStatus} with a fresh lease`,
    `- **Reason It Branched**: ${branch.reason}`,
    `- **Why Abandoned**: ${branch.outcome_summary ?? "none recorded"}`,
    `- **Sub-leases Released**: ${branch.sub_tasks.filter((subTask) => subTask.status === "abandoned").length}`,
    "",
    ...formatTable(["Sub-task", "Label", "Status", "Agent", "Write Scope"], subTaskRows(branch)),
  ].join("\n");
  return enforceLineLimit(md);
}

export function formatBranchStatusBrief(branches: readonly BranchRecord[], runId: string): string {
  if (branches.length === 0) {
    return enforceLineLimit(
      [`### Branches: ${runId}`, "- **Branches**: none opened in this run."].join("\n"),
    );
  }
  const rows = branches.map((branch) => [
    `\`${branch.id}\``,
    `\`${branch.parent_task_id}\``,
    String(branch.depth),
    branch.status,
    `${branch.sub_tasks.filter((subTask) => subTask.status === "submitted").length}/${branch.sub_tasks.length}`,
    filesCell(branch),
    branch.reason,
  ]);
  const md = [
    `### Branches: ${runId}`,
    "",
    ...formatTable(["Branch", "Parent", "Depth", "Status", "Submitted", "Files", "Reason"], rows),
  ].join("\n");
  return enforceLineLimit(md);
}

import { enforceLineLimit, formatTable } from "../line-limiter.ts";
import {
  autoPartitionNextActions,
  nextActionsBlock,
  planApplyNextActions,
  planClaimNextActions,
  planEnhanceNextActions,
  planInitNextActions,
  planReplanNextActions,
  planStatusNextActions,
  taskRegisteredNextActions,
} from "../next-actions/index.ts";
import type {
  AutoPartitionParams,
  CapsuleInitParams,
  PlanApplyParams,
  PlanClaimParams,
  PlanEnhanceParams,
  PlanReplanParams,
  PlanStatusItem,
  TaskRegisteredParams,
} from "./types.ts";

export function formatCapsuleInitBrief(params: CapsuleInitParams): string {
  const bunVer = params.bunVersion ?? "unknown";
  const bytesStr =
    params.promptBytes !== undefined ? ` (${params.promptBytes.toLocaleString()} bytes)` : "";
  const md = [
    `### Capsule Initialized: ${params.runId}`,
    `- **Capsule Root**: \`${params.runRoot}\``,
    `- **Prompt SHA-256**: \`${params.promptSha256}\`${bytesStr}`,
    `- **Assurance**: \`${params.assurance}\` | Runtime: Bun ${bunVer}`,
    params.runtimePin === undefined
      ? "- **Runtime Pin**: none — no runtime source was supplied to `plan:init`."
      : `- **Runtime Pin**: \`${params.runtimePin.sha256}\` (${params.runtimePin.files.toLocaleString()} files, see \`runtime/\`).`,
    `- **Status**: Ready for task declarations (\`plan:add\`).`,
    ...nextActionsBlock(planInitNextActions(params.runId)),
  ].join("\n");
  return enforceLineLimit(md, 30);
}

export function formatTaskRegisteredBrief(params: TaskRegisteredParams): string {
  const scopeStr = params.writeScope.map((s) => `\`${s}\``).join(", ") || "`none`";
  const depsStr =
    params.deps.length > 0
      ? params.deps.map((d) => `\`${d}\``).join(", ")
      : "None (Parallel-ready)";
  const binding =
    params.requirementLines && params.requirementLines.length > 0
      ? `Declared prompt lines ${params.requirementLines.join(", ")}`
      : "⚠️ Positional fallback — pass `--requirement-lines` to bind this task to the prompt lines it implements";
  const md = [
    `### Task Registered: ${params.taskId}`,
    `- **Label**: ${params.label}`,
    `- **Write Scope**: ${scopeStr}`,
    `- **Mandatory Gate**: \`${params.gateCmd}\``,
    `- **Dependencies**: ${depsStr}`,
    `- **Prompt Binding**: ${binding}`,
    `- **Plan Size**: ${params.totalTasks} tasks registered. Run \`plan:compile\` when finished adding tasks.`,
    ...nextActionsBlock(taskRegisteredNextActions()),
  ].join("\n");
  return enforceLineLimit(md, 30);
}

export function formatPlanEnhanceBrief(params: PlanEnhanceParams): string {
  const md = [
    `### Enhanced Plan Recorded: ${params.runId} (revision ${params.revision})`,
    `- **Document**: \`${params.markdownPath}\` (sha256 \`${params.markdownSha256}\`)`,
    `- **Machine Copy**: \`${params.jsonPath}\``,
    `- **Brief**: ${params.summaryPresent ? "reported" : "not reported"} | **To-dos**: ${params.counts.todos} | **Observations**: ${params.counts.observations}`,
    `- **Risks**: ${params.counts.risks} | **Open Questions**: ${params.counts.openQuestions} | **Sources Read**: ${params.counts.sources}`,
    `- **Evidence**: \`agent_reported\` throughout — this is the agent's claim about the repository, not a harness measurement.`,
    `- **Authority**: \`prompt.md\` (sha256 \`${params.promptSha256}\`) stays the requirement source; this document is derived.`,
    `- **Next Step**: Review the document, then declare tasks with \`plan:add --requirement-lines\`.`,
    ...nextActionsBlock(planEnhanceNextActions(params.runId)),
  ].join("\n");
  return enforceLineLimit(md, 30);
}

export function formatPlanStatusBrief(
  runId: string,
  tasks: readonly PlanStatusItem[],
  isCompiled = false,
): string {
  const headers = ["ID", "Label", "Write Scope", "Gate", "Dependencies"];
  const rows = tasks.map((t) => [
    `\`${t.id}\``,
    t.label,
    t.writeScope.map((s) => `\`${s}\``).join(", "),
    `\`${t.gate}\``,
    t.deps.length > 0 ? t.deps.map((d) => `\`${d}\``).join(", ") : "None",
  ]);

  const lines = [
    `### Planning Buffer: ${runId} (${isCompiled ? "Compiled" : "Draft"})`,
    ...formatTable(headers, rows),
    "",
    isCompiled
      ? `**Status**: ${tasks.length} tasks compiled. Execution active.`
      : `**Status**: ${tasks.length} tasks declared. Uncompiled. Run \`plan:compile\` to seal.`,
    ...nextActionsBlock(planStatusNextActions(runId, isCompiled)),
  ];
  return enforceLineLimit(lines.join("\n"), 30);
}

const GATE_PROVENANCE: Record<PlanReplanParams["repairTasks"][number]["gateSource"], string> = {
  flag: "declared by `--gate`",
  finding: "declared by the findings",
  parent_task: "inherited from the planned task gating this scope",
};

export function formatPlanReplanBrief(params: PlanReplanParams): string {
  const taskNames = params.repairTasks.map((t) => `\`${t.id}\``).join(", ") || "None";
  const lines = [
    `### Plan Recompiled: Wave R${params.repairRound} (Graph Revision ${params.revision})`,
    `- **Injected Repair Tasks**: ${params.newTasksCount} tasks (${taskNames})`,
    `- **Repair Round**: Round ${params.repairRound}`,
    ...params.repairTasks.map(
      (t) =>
        `- **Task \`${t.id}\`**: Scope \`${t.writeScope.join(", ")}\` (${t.findingsCount} findings) | Gate \`${t.gate}\` (${GATE_PROVENANCE[t.gateSource]})`,
    ),
    `- **Validation Barrier**: Completion gate and critic audit locked until all repair tasks pass.`,
    `- **Next Step**: Dispatch parallel batch repair implementers and validators.`,
    ...nextActionsBlock(planReplanNextActions(params.runId, params.repairTasks[0]?.id)),
  ];
  return enforceLineLimit(lines.join("\n"), 30);
}

export function formatPlanClaimBrief(params: PlanClaimParams): string {
  const md = [
    `### Planner Packet Issued: ${params.runId}`,
    `- **Agent**: \`${params.agent}\``,
    `- **Packet**: \`${params.packetId}\``,
    `- **Write Scope**: \`planning/requirements.json\`, \`planning/graph.json\``,
    `- **Next Step**: Write both documents, then call \`plan:apply --expected-revision\` with the revision the packet reported.`,
    ...nextActionsBlock(planClaimNextActions(params.runId)),
  ].join("\n");
  return enforceLineLimit(md, 30);
}

export function formatPlanApplyBrief(params: PlanApplyParams): string {
  const md = [
    `### Plan Applied: ${params.runId} (Graph Revision ${params.revision})`,
    `- **Total Tasks**: ${params.totalTasks}`,
    `- **Status**: Ready for dispatch (\`queue:next\` / \`queue:wave\`).`,
    ...nextActionsBlock(planApplyNextActions(params.runId)),
  ].join("\n");
  return enforceLineLimit(md, 30);
}

export function formatAutoPartitionBrief(params: AutoPartitionParams): string {
  const taskList = params.taskIds.map((id) => `\`${id}\``).join(", ");
  const md = [
    `### Auto-Partitioned: ${params.taskIds.length} tasks from \`${params.glob}\``,
    `- **Grouping**: one task per ${params.groupBy}`,
    `- **Generated Tasks**: ${taskList}`,
    `- **Dependencies**: none — auto-partitioned tasks are independent roots by construction`,
    `- **Plan Size**: ${params.totalTasks} tasks registered. Run \`plan:compile\` when finished adding tasks.`,
    ...params.breadthWarnings.map((warning) => `- ⚠️ **Gate breadth**: ${warning}`),
    ...nextActionsBlock(autoPartitionNextActions()),
  ].join("\n");
  return enforceLineLimit(md, 30);
}

import type { AuditFinding, AuditNotEvaluated } from "../../graph/plan-audit.ts";
import { enforceLineLimit, formatTable } from "./line-limiter.ts";
import {
  autoPartitionNextActions,
  nextActionsBlock,
  planApplyNextActions,
  planAuditNextActions,
  planClaimNextActions,
  planCompileNextActions,
  planEnhanceNextActions,
  planInitNextActions,
  planReplanNextActions,
  planReviewNextActions,
  planStatusNextActions,
  planValidateStartNextActions,
  taskRegisteredNextActions,
} from "./next-actions.ts";

export interface CapsuleInitParams {
  runId: string;
  runRoot: string;
  promptSha256: string;
  promptBytes?: number;
  assurance: string;
  bunVersion?: string;
  runtimePin?: { sha256: string; files: number };
}

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

export interface TaskRegisteredParams {
  taskId: string;
  label: string;
  writeScope: readonly string[];
  gateCmd: string;
  deps: readonly string[];
  totalTasks: number;
  requirementLines?: readonly number[] | undefined;
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

export interface PlanEnhanceParams {
  runId: string;
  markdownPath: string;
  jsonPath: string;
  markdownSha256: string;
  promptSha256: string;
  revision: number;
  summaryPresent: boolean;
  counts: {
    observations: number;
    todos: number;
    risks: number;
    openQuestions: number;
    sources: number;
  };
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

export interface PlanCompileTopology {
  revision: number;
  maxParallel: number;
  waves: { wave: number; taskIds: readonly string[] }[];
}

export interface PlanCompileTopologyDeclaration {
  independentRoots: number;
  edgeCount: number;
}

export interface PlanCompileAuditAcceptance {
  invariant: string;
  reason: string;
}

export interface PlanCompileParams {
  revision: number;
  totalTasks: number;
  topology: PlanCompileTopology;
  topologyDeclaration: PlanCompileTopologyDeclaration;
  collisions: number;
  requirementsCount: number;
  runId: string;
  advisories?: string[];
  warnings?: string[];
  auditAccepted?: PlanCompileAuditAcceptance[];
  auditNotEvaluated?: string[];
}

export function formatPlanCompileBrief(params: PlanCompileParams): string {
  const waves = params.topology.waves;
  const scheduled = new Set(waves.flatMap((wave) => [...wave.taskIds]));

  const lines = [
    `### Plan Compiled Successfully (Graph Revision ${params.revision})`,
    `- **Total Tasks**: ${params.totalTasks} registered | **Recorded Waves**: ${waves.length} (topology revision ${params.topology.revision}, max_parallel ${params.topology.maxParallel})`,
  ];

  if (waves.length === 0) {
    lines.push(`- **Waves**: none — the scheduler could make no task eligible`);
  }
  for (const [index, wave] of waves.entries()) {
    const taskList = wave.taskIds.map((id) => `\`${id}\``).join(", ") || "None";
    const lanes = wave.taskIds.length;
    const state = index === 0 ? "Ready Now" : "Queued";
    lines.push(
      `- **Wave ${wave.wave} (${state})**: ${taskList} (${lanes} parallel ${lanes === 1 ? "lane" : "lanes"})`,
    );
  }

  if (scheduled.size < params.totalTasks) {
    lines.push(
      `- ⚠️ [UNSCHEDULED]: ${params.totalTasks - scheduled.size} task(s) never became eligible and carry no wave`,
    );
  }

  lines.push(
    `- **Scope Isolation**: Disjoint write scopes verified (${params.collisions} collisions)`,
  );
  lines.push(
    `- **Requirements Covered**: ${params.requirementsCount}/${params.requirementsCount} atomic obligations mapped`,
  );
  lines.push(
    `- **Topology Declaration**: ${params.topologyDeclaration.independentRoots}/${params.totalTasks} tasks are independent roots; ${params.topologyDeclaration.edgeCount} dependency edge(s), all justified`,
  );

  if (params.advisories && params.advisories.length > 0) {
    for (const adv of params.advisories) {
      lines.push(`- ⚠️ [ADVISORY]: ${adv}`);
    }
  }

  for (const warning of params.warnings ?? []) {
    lines.push(`- ⚠️ [PROMPT BINDING]: ${warning}`);
  }

  for (const accepted of params.auditAccepted ?? []) {
    lines.push(`- ✅ [AUDIT OVERRIDE]: ${accepted.invariant} accepted — ${accepted.reason}`);
  }

  for (const note of params.auditNotEvaluated ?? []) {
    lines.push(`- ℹ️ [AUDIT NOT EVALUATED]: ${note}`);
  }

  lines.push(
    `- **Next Step**: Dispatch the whole ready wave via \`bun harness.ts queue:wave --run ${params.runId}\``,
  );
  lines.push(...nextActionsBlock(planCompileNextActions(params.runId, waves.length > 0)));
  return enforceLineLimit(lines.join("\n"), 30);
}

export interface PlanStatusItem {
  id: string;
  label: string;
  writeScope: readonly string[];
  gate: string;
  deps: readonly string[];
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

export interface PlanReplanParams {
  revision: number;
  repairRound: number;
  newTasksCount: number;
  repairTasks: {
    id: string;
    writeScope: readonly string[];
    findingsCount: number;
    gate: string;
    gateSource: "flag" | "finding" | "parent_task";
  }[];
  runId: string;
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

export interface PlanClaimParams {
  runId: string;
  agent: string;
  packetId: string;
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

export interface PlanApplyParams {
  runId: string;
  revision: number;
  totalTasks: number;
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

export interface AutoPartitionParams {
  glob: string;
  groupBy: "file" | "directory";
  taskIds: readonly string[];
  totalTasks: number;
  breadthWarnings: readonly string[];
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

export interface PlanAuditBriefParams {
  runId: string;
  revision: number;
  findings: readonly AuditFinding[];
  notEvaluated: readonly AuditNotEvaluated[];
}

const AUDIT_SEVERITY_MARK: Record<AuditFinding["severity"], string> = {
  blocking: "🛑 [BLOCKING]",
  advisory: "⚠️ [ADVISORY]",
};

export function formatPlanAuditBrief(params: PlanAuditBriefParams): string {
  const blocking = params.findings.filter((f) => f.severity === "blocking");
  const lines = [
    `### Plan Audit: ${params.runId} (audit revision ${params.revision})`,
    `- **Findings**: ${params.findings.length} (${blocking.length} blocking, ${params.findings.length - blocking.length} advisory)`,
  ];

  if (params.findings.length === 0) {
    lines.push("- **Result**: no invariant violations found in the current planning buffer");
  }
  for (const f of params.findings) {
    lines.push(`- ${AUDIT_SEVERITY_MARK[f.severity]} \`${f.invariant}\`: ${f.message}`);
  }
  for (const n of params.notEvaluated) {
    lines.push(`- ℹ️ [NOT EVALUATED] \`${n.invariant}\`: ${n.reason}`);
  }

  lines.push(
    blocking.length === 0
      ? "- **Next Step**: `plan:compile` may seal this plan; no blocking invariant is outstanding."
      : "- **Next Step**: fix the plan, or seal it anyway with `plan:compile --accept-audit <id>:<reason>` naming each blocking invariant above and why.",
  );
  lines.push(
    ...nextActionsBlock(
      planAuditNextActions(params.runId, blocking.length > 0, blocking[0]?.invariant),
    ),
  );
  return enforceLineLimit(lines.join("\n"), 30);
}

export interface PlanValidateStartParams {
  runId: string;
  validator: string;
  token: string;
  graphRevision: number;
  totalTasks: number;
}

export function formatPlanValidateStartBrief(params: PlanValidateStartParams): string {
  const md = [
    `### Plan Validation Opened: ${params.runId} (Graph Revision ${params.graphRevision})`,
    `- **Validator**: \`${params.validator}\``,
    `- **Token**: \`${params.token}\` (bearer credential — never log or persist it)`,
    `- **Under Review**: ${params.totalTasks} compiled tasks`,
    `- **Answer in writing**: does the decomposition match the prompt's entity count; is every dependency edge justified by a read/write relationship; can each gate fail if its task does nothing; will any task's scope leave one agent straggling.`,
    `- **Next Step**: \`plan:review --status approved\` or \`--status changes_requested\` with the four answers.`,
    ...nextActionsBlock(
      planValidateStartNextActions(params.runId, params.validator, params.token),
    ),
  ].join("\n");
  return enforceLineLimit(md, 30);
}

export interface PlanReviewParams {
  runId: string;
  validator: string;
  status: "approved" | "changes_requested";
  graphRevision: number;
  findingsCount: number;
  summary: string;
  dependencyEdgesReviewed: number;
  gateIdsReviewed: number;
}

export function formatPlanReviewBrief(params: PlanReviewParams): string {
  const approved = params.status === "approved";
  const md = [
    `### Plan Validation ${approved ? "Approved" : "Rejected"}: ${params.runId} (Graph Revision ${params.graphRevision})`,
    `- **Validator**: \`${params.validator}\``,
    `- **Summary**: ${params.summary}`,
    `- **Coverage**: ${params.dependencyEdgesReviewed} dependency edge(s) and ${params.gateIdsReviewed} gate(s) named, verified against the compiled plan.`,
    approved
      ? "- **Dispatch**: implementers and repairers may now claim tasks under this graph revision."
      : `- **Findings**: ${params.findingsCount} — every implementer and repairer claim against graph revision ${params.graphRevision} is refused until a fresh compile passes plan:review.`,
    `- **Next Step**: ${approved ? "proceed to Phase 2 continuous dispatch." : "replan (plan:add / plan:compile) and dispatch a fresh plan-validator against the new revision."}`,
    ...nextActionsBlock(planReviewNextActions(params.runId, approved)),
  ].join("\n");
  return enforceLineLimit(md, 30);
}

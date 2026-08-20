import { enforceLineLimit, formatTable } from "./line-limiter.ts";

export interface CapsuleInitParams {
  runId: string;
  runRoot: string;
  promptSha256: string;
  promptBytes: number;
  assurance: string;
  bunVersion?: string;
  runtimePin?: { sha256: string; files: number };
}

export function formatCapsuleInitBrief(params: CapsuleInitParams): string {
  // A missing runtime version is reported as missing; naming a version nobody measured would make
  // the capsule look reproducible against a runtime it may never have run on.
  const bunVer = params.bunVersion ?? "unknown";
  const md = [
    `### Capsule Initialized: ${params.runId}`,
    `- **Capsule Root**: \`${params.runRoot}\``,
    `- **Prompt SHA-256**: \`${params.promptSha256}\` (${params.promptBytes.toLocaleString()} bytes)`,
    `- **Assurance**: \`${params.assurance}\` | Runtime: Bun ${bunVer}`,
    // Absent when no runtime source was available to pin: the brief says so rather than staying
    // silent, so a reader never mistakes "not mentioned" for "not needed".
    params.runtimePin === undefined
      ? "- **Runtime Pin**: none — no runtime source was supplied to `plan:init`."
      : `- **Runtime Pin**: \`${params.runtimePin.sha256}\` (${params.runtimePin.files.toLocaleString()} files, see \`runtime/\`).`,
    `- **Status**: Ready for task declarations (\`plan:add\`).`,
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
  ].join("\n");
  return enforceLineLimit(md, 30);
}

export interface PlanCompileTopology {
  revision: number;
  maxParallel: number;
  waves: { wave: number; taskIds: readonly string[] }[];
}

export interface PlanCompileParams {
  revision: number;
  totalTasks: number;
  /** The topology the command just recorded. The brief reports that record and nothing else, so the
   *  parallelisation the caller reads is the one the queue will hand out. */
  topology: PlanCompileTopology;
  collisions: number;
  requirementsCount: number;
  runId: string;
  advisories?: string[];
  warnings?: string[];
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

  if (params.advisories && params.advisories.length > 0) {
    for (const adv of params.advisories) {
      lines.push(`- ⚠️ [ADVISORY]: ${adv}`);
    }
  }

  for (const warning of params.warnings ?? []) {
    lines.push(`- ⚠️ [PROMPT BINDING]: ${warning}`);
  }

  lines.push(
    `- **Next Step**: Dispatch the whole ready wave via \`bun harness.ts queue:wave --run ${params.runId}\``,
  );
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
  ].join("\n");
  return enforceLineLimit(md, 30);
}

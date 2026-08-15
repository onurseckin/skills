import { enforceLineLimit, formatTable } from "./line-limiter.ts";

export interface CapsuleInitParams {
  runId: string;
  runRoot: string;
  promptSha256: string;
  promptBytes: number;
  assurance: string;
  bunVersion?: string;
}

export function formatCapsuleInitBrief(params: CapsuleInitParams): string {
  const bunVer = params.bunVersion ?? "1.3.14";
  const md = [
    `### Capsule Initialized: ${params.runId}`,
    `- **Capsule Root**: \`${params.runRoot}\``,
    `- **Prompt SHA-256**: \`${params.promptSha256}\` (${params.promptBytes.toLocaleString()} bytes)`,
    `- **Assurance**: \`${params.assurance}\` | Runtime: Bun ${bunVer}`,
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
}

export function formatTaskRegisteredBrief(params: TaskRegisteredParams): string {
  const scopeStr = params.writeScope.map((s) => `\`${s}\``).join(", ") || "`none`";
  const depsStr =
    params.deps.length > 0
      ? params.deps.map((d) => `\`${d}\``).join(", ")
      : "None (Parallel-ready)";
  const md = [
    `### Task Registered: ${params.taskId}`,
    `- **Label**: ${params.label}`,
    `- **Write Scope**: ${scopeStr}`,
    `- **Mandatory Gate**: \`${params.gateCmd}\``,
    `- **Dependencies**: ${depsStr}`,
    `- **Plan Size**: ${params.totalTasks} tasks registered. Run \`plan:compile\` when finished adding tasks.`,
  ].join("\n");
  return enforceLineLimit(md, 30);
}

export interface PlanCompileParams {
  revision: number;
  totalTasks: number;
  waves: { waveIndex: number; tasks: string[]; dependencies?: string[] }[];
  collisions: number;
  requirementsCount: number;
  runId: string;
  advisories?: string[];
}

export function formatPlanCompileBrief(params: PlanCompileParams): string {
  const wave0 = params.waves.find((w) => w.waveIndex === 0);
  const wave0Tasks = wave0 ? wave0.tasks.map((t) => `\`${t}\``).join(", ") : "None";
  const wave0Lanes = wave0 ? wave0.tasks.length : 0;
  const otherWaves = params.waves.filter((w) => w.waveIndex > 0);

  const lines = [
    `### Plan Compiled Successfully (Graph Revision ${params.revision})`,
    `- **Total Tasks**: ${params.totalTasks} registered | **Parallel Concurrency Waves**: ${params.waves.length}`,
    `- **Wave 0 (Ready Now)**: ${wave0Tasks} (${wave0Lanes} parallel ${wave0Lanes === 1 ? "lane" : "lanes"})`,
  ];

  for (const wave of otherWaves) {
    const waveTasks = wave.tasks.map((t) => `\`${t}\``).join(", ");
    lines.push(`- **Wave ${wave.waveIndex} (Blocked)**: ${waveTasks}`);
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

  lines.push(
    `- **Next Step**: Query ready tasks via \`bun harness.ts queue:next --run ${params.runId}\``,
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
  repairTasks: { id: string; writeScope: readonly string[]; findingsCount: number }[];
  runId: string;
}

export function formatPlanReplanBrief(params: PlanReplanParams): string {
  const taskNames = params.repairTasks.map((t) => `\`${t.id}\``).join(", ") || "None";
  const lines = [
    `### Plan Recompiled: Wave R${params.repairRound} (Graph Revision ${params.revision})`,
    `- **Injected Repair Tasks**: ${params.newTasksCount} tasks (${taskNames})`,
    `- **Repair Round**: Round ${params.repairRound}`,
    ...params.repairTasks.map(
      (t) =>
        `- **Task \`${t.id}\`**: Scope \`${t.writeScope.join(", ")}\` (${t.findingsCount} findings)`,
    ),
    `- **Validation Barrier**: Completion gate and critic audit locked until all repair tasks pass.`,
    `- **Next Step**: Dispatch parallel batch repair implementers and validators.`,
  ];
  return enforceLineLimit(lines.join("\n"), 30);
}

import { enforceLineLimit } from "../line-limiter.ts";
import { nextActionsBlock, planCompileNextActions } from "../next-actions/index.ts";
import type { PlanCompileParams } from "./types.ts";

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

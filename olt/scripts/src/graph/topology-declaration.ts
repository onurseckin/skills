import { HarnessError } from "../errors/harness-error.ts";
import type { TaskDeclaration } from "../requirements/compiler.ts";

export interface TopologyDeclarationEdge {
  readonly task: string;
  readonly dependsOn: string;
  readonly justification: string;
}

export interface UnjustifiedEdge {
  readonly task: string;
  readonly dependsOn: string;
}

export interface TopologyDeclarationResult {
  readonly independentRoots: readonly string[];
  readonly totalTasks: number;
  readonly edges: readonly TopologyDeclarationEdge[];
  readonly unjustifiedEdges: readonly UnjustifiedEdge[];
}

export function analyzeTopologyDeclaration(
  tasks: readonly TaskDeclaration[],
): TopologyDeclarationResult {
  const independentRoots = tasks.filter((task) => (task.deps ?? []).length === 0).map((t) => t.id);
  const edges: TopologyDeclarationEdge[] = [];
  const unjustifiedEdges: UnjustifiedEdge[] = [];
  for (const task of tasks) {
    for (const dependsOn of task.deps ?? []) {
      const reason = task.depReasons?.[dependsOn];
      if (typeof reason === "string" && reason.trim().length > 0) {
        edges.push({ task: task.id, dependsOn, justification: reason.trim() });
      } else {
        unjustifiedEdges.push({ task: task.id, dependsOn });
      }
    }
  }
  return { independentRoots, totalTasks: tasks.length, edges, unjustifiedEdges };
}

export function assertTopologyJustified(result: TopologyDeclarationResult): void {
  if (result.unjustifiedEdges.length === 0) return;
  const listing = result.unjustifiedEdges
    .map((edge) => `${edge.task} -> ${edge.dependsOn}`)
    .join(", ");
  throw new HarnessError(
    "INVALID_ARGUMENT",
    `dependency edge(s) without a declared justification: ${listing}. Pass ` +
      `plan:add --dep-reason <dep-id>:"<why this edge exists>" for each one before compiling.`,
  );
}

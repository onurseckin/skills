export interface DiscoveryProposal {
  readonly id: string;
  readonly title: string;
  readonly category:
    | "zero_any_audit"
    | "charter_gap_audit"
    | "work_span_optimization"
    | "blunder_regression";
  readonly priority: number;
  readonly candidateGoal: string;
}

export class MindAutonomousDiscoveryEngine {
  public static generateProposals(context: {
    backlogCount: number;
    activeRunCount: number;
    unresolvedDefects: number;
  }): readonly DiscoveryProposal[] {
    if (context.backlogCount > 0 || context.activeRunCount > 0) return [];

    return [
      {
        id: `disc-typecheck-${Date.now()}`,
        title: "Autonomous Zero-Any & Compiler Suppression Audit",
        category: "zero_any_audit",
        priority: 100,
        candidateGoal:
          "Audit the codebase for explicit/implicit any types and unauthorized suppressions using tsc --noEmit.",
      },
      {
        id: `disc-charter-${Date.now()}`,
        title: "Autonomous Charter Gap Analysis",
        category: "charter_gap_audit",
        priority: 90,
        candidateGoal: "Audit unfulfilled charter milestones and align public API documentation.",
      },
      {
        id: `disc-workspan-${Date.now()}`,
        title: "Autonomous Work/Span DAG Concurrency Optimization",
        category: "work_span_optimization",
        priority: 80,
        candidateGoal:
          "Analyze topological dependency critical paths and recommend P = ceil(W/S) concurrency decoupling.",
      },
    ];
  }
}

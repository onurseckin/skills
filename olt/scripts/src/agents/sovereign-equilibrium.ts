import { type AgentTier, normalizeAgentRole } from "./fleet/index.ts";

export type TaskComplexityLevel = 1 | 2 | 3 | 4;
export type TaskScopeEstimate = "trivial" | "component" | "subsystem" | "architectural";

export interface TaskComplexityInput {
  readonly changedFilesCount?: number;
  readonly targetFiles?: readonly string[];
  readonly description?: string;
  readonly scopeEstimate?: TaskScopeEstimate;
  readonly dependenciesCount?: number;
  readonly riskScore?: number;
  readonly isUiTask?: boolean;
}

export interface ComplexityMetrics {
  readonly fileCount: number;
  readonly estimatedTokens?: number;
  readonly risk: "low" | "medium" | "high" | "critical";
}

export interface ComplexityClassificationResult {
  readonly level: TaskComplexityLevel;
  readonly label: "Trivial" | "Component" | "Subsystem" | "Architectural";
  readonly maxRecommendedAgents: number;
  readonly requiredTiers: readonly AgentTier[];
  readonly allowsSubDecomposition: boolean;
  readonly rationale: string;
  readonly metrics: ComplexityMetrics;
}

export interface SwarmDispatchPlan {
  readonly id: string;
  readonly complexity: ComplexityClassificationResult;
  readonly primaryLead: string;
  readonly workers: readonly string[];
  readonly validators: readonly string[];
  readonly maxConcurrency: number;
  readonly worktreeStrategy: "in-tree" | "ephemeral-worktree" | "shard-pool";
  readonly telemetryCadenceMinutes: number;
}

export function classifyTaskComplexity(input: TaskComplexityInput): ComplexityClassificationResult {
  const fileCount = input.changedFilesCount ?? (input.targetFiles ? input.targetFiles.length : 0);
  const dependenciesCount = input.dependenciesCount ?? 0;
  const riskScore = input.riskScore ?? 0;
  const scopeEstimate = input.scopeEstimate;

  let risk: "low" | "medium" | "high" | "critical" = "low";
  if (riskScore >= 75 || dependenciesCount >= 10) risk = "critical";
  else if (riskScore >= 50 || dependenciesCount >= 5) risk = "high";
  else if (riskScore >= 25 || dependenciesCount >= 2) risk = "medium";

  // Check explicit scope estimate or infer from file count and metrics
  if (scopeEstimate === "architectural" || fileCount >= 16 || risk === "critical") {
    return {
      level: 4,
      label: "Architectural",
      maxRecommendedAgents: 12,
      requiredTiers: [0, 1, 2, 3],
      allowsSubDecomposition: true,
      rationale: `Architectural task affecting ${fileCount} files across broad subsystems with ${risk} risk. Requires multi-tier governance, coordinator, and specialized validation critics.`,
      metrics: {
        fileCount,
        estimatedTokens: fileCount * 1200,
        risk,
      },
    };
  }

  if (scopeEstimate === "subsystem" || fileCount >= 6 || (fileCount >= 4 && risk === "high")) {
    return {
      level: 3,
      label: "Subsystem",
      maxRecommendedAgents: 6,
      requiredTiers: [2, 3],
      allowsSubDecomposition: true,
      rationale: `Subsystem-level task impacting ${fileCount} files with moderate cross-module dependencies. Requires coordinator orchestration and tactical execution swarm.`,
      metrics: {
        fileCount,
        estimatedTokens: fileCount * 800,
        risk,
      },
    };
  }

  if (scopeEstimate === "component" || fileCount >= 3 || risk === "medium") {
    return {
      level: 2,
      label: "Component",
      maxRecommendedAgents: 2,
      requiredTiers: [3],
      allowsSubDecomposition: false,
      rationale: `Component-level task bounded to ${fileCount || "3-5"} files. Requires 1 implementer and 1 dedicated independent validator. Multi-agent sub-hierarchies are prohibited.`,
      metrics: {
        fileCount,
        estimatedTokens: fileCount * 500,
        risk,
      },
    };
  }

  // Default: Level 1 Trivial
  return {
    level: 1,
    label: "Trivial",
    maxRecommendedAgents: 1,
    requiredTiers: [3],
    allowsSubDecomposition: false,
    rationale: `Trivial/isolated task targeting ${fileCount || "1-2"} files. Dispatched directly to a single implementer without coordinator or validator swarm overhead.`,
    metrics: {
      fileCount,
      estimatedTokens: Math.max(fileCount * 300, 300),
      risk: "low",
    },
  };
}

// ---------------------------------------------------------------------------
// AntiOverheadWatchdog
// ---------------------------------------------------------------------------

export interface DecompositionEvaluationResult {
  readonly allowed: boolean;
  readonly vetoed: boolean;
  readonly reason?: string;
  readonly flattenedPlan?: SwarmDispatchPlan;
}

export class AntiOverheadWatchdog {
  public evaluateDecomposition(
    taskLevel: TaskComplexityLevel,
    proposedAgents: readonly string[],
    isUiTask: boolean = false,
  ): DecompositionEvaluationResult {
    const normalized = proposedAgents.map(normalizeAgentRole);
    const agentCount = normalized.length;

    // Check Level 1 Trivial
    if (taskLevel === 1) {
      const hasSupervisors = normalized.some((a) =>
        ["sovereign-mind", "domain-orchestrator", "feature-coordinator"].includes(a),
      );
      const hasSubagents = normalized.some((a) =>
        ["sub-implementer", "sub-validator", "sub-investigator"].includes(a),
      );

      if (agentCount > 1 || hasSupervisors || hasSubagents) {
        const flattenedPlan = generateSwarmDispatchPlan({
          changedFilesCount: 1,
          scopeEstimate: "trivial",
          isUiTask,
        });

        return {
          allowed: false,
          vetoed: true,
          reason: `AntiOverheadWatchdog VETO: Level 1 (Trivial) tasks are strictly limited to a single implementer. Proposed ${agentCount} agents with over-decomposition. Flattened to 1 agent.`,
          flattenedPlan,
        };
      }
    }

    // Check Level 2 Component
    if (taskLevel === 2) {
      const hasSupervisors = normalized.some((a) =>
        ["sovereign-mind", "domain-orchestrator", "feature-coordinator"].includes(a),
      );
      const hasSubImplementers = normalized.some((a) => a === "sub-implementer");

      if (agentCount > 2 || hasSupervisors || hasSubImplementers) {
        const flattenedPlan = generateSwarmDispatchPlan({
          changedFilesCount: 3,
          scopeEstimate: "component",
          isUiTask,
        });

        return {
          allowed: false,
          vetoed: true,
          reason: `AntiOverheadWatchdog VETO: Level 2 (Component) tasks are strictly limited to 1 implementer + 1 validator. Proposed ${agentCount} agents. Hierarchy flattened.`,
          flattenedPlan,
        };
      }
    }

    return { allowed: true, vetoed: false };
  }

  /**
   * Asserts sovereign equilibrium, throwing an error if over-decomposition is detected.
   */
  public assertSovereignEquilibrium(
    taskLevel: TaskComplexityLevel,
    proposedAgents: readonly string[],
    isUiTask: boolean = false,
  ): void {
    const evalResult = this.evaluateDecomposition(taskLevel, proposedAgents, isUiTask);
    if (evalResult.vetoed) {
      throw new Error(
        evalResult.reason ?? "Sovereign Equilibrium Violation: Over-decomposition vetoed.",
      );
    }
  }
}

export const defaultAntiOverheadWatchdog = new AntiOverheadWatchdog();

// ---------------------------------------------------------------------------
// Swarm Dispatch Plan Generator
// ---------------------------------------------------------------------------

let dispatchPlanCounter = 0;

export function generateSwarmDispatchPlan(
  input: TaskComplexityInput,
  overrides?: Partial<SwarmDispatchPlan>,
): SwarmDispatchPlan {
  const complexity = classifyTaskComplexity(input);
  const isUi = Boolean(input.isUiTask);
  const planId = `plan-${complexity.label.toLowerCase()}-${++dispatchPlanCounter}-${Date.now()}`;

  let primaryLead: string;
  let workers: readonly string[];
  let validators: readonly string[];
  let maxConcurrency: number;
  let worktreeStrategy: "in-tree" | "ephemeral-worktree" | "shard-pool";

  switch (complexity.level) {
    case 1: // Trivial
      primaryLead = "primary-implementer";
      workers = [];
      validators = [];
      maxConcurrency = 1;
      worktreeStrategy = "in-tree";
      break;

    case 2: // Component
      primaryLead = "primary-implementer";
      workers = [];
      validators = isUi ? ["ui-visual-reviewer"] : ["general-validator"];
      maxConcurrency = 2;
      worktreeStrategy = "in-tree";
      break;

    case 3: // Subsystem
      primaryLead = "feature-coordinator";
      workers = ["primary-implementer", "sub-implementer"];
      validators = isUi
        ? ["ui-headless-debugger", "ui-visual-reviewer"]
        : ["mechanic-validator", "completeness-critic"];
      maxConcurrency = 4;
      worktreeStrategy = "ephemeral-worktree";
      break;

    case 4: // Architectural
      primaryLead = "domain-orchestrator";
      workers = ["primary-implementer", "sub-implementer", "autonomous-repairer"];
      validators = isUi
        ? ["ui-headless-debugger", "ui-visual-reviewer", "completeness-critic", "system-critic"]
        : ["general-validator", "mechanic-validator", "completeness-critic", "system-critic"];
      maxConcurrency = 8;
      worktreeStrategy = "shard-pool";
      break;
  }

  const basePlan: SwarmDispatchPlan = {
    id: planId,
    complexity,
    primaryLead,
    workers,
    validators,
    maxConcurrency,
    worktreeStrategy,
    telemetryCadenceMinutes: 15,
  };

  if (!overrides) return basePlan;

  return {
    ...basePlan,
    ...overrides,
    complexity: overrides.complexity ?? basePlan.complexity,
  };
}

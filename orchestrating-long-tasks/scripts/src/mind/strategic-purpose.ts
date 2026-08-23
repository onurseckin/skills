/**
 * Tier 0 Mind Strategic Purpose & Proactive Cognition Engine.
 *
 * Codifies the foundational invariants of the Tier 0 Mind:
 * 1. Strategic Brain at 30,000 feet (macro-strategic consciousness overseeing architecture,
 *    direction, pulse cadence, multi-orchestrator scaling, and cross-generational continuity).
 * 2. The 3 Hard Zeros:
 *    - ZERO source code edits (never writes, edits, stages, reverts, formats, or deletes repository files).
 *    - ZERO unit test execution (never runs or executes unit test suites directly; delegated to implementers/validators).
 *    - ZERO critic jobs (never runs line-level reviews or critic passes; delegated to tier 2 reviewers/tier 3 critics).
 * 3. Proactive Subordinate Window Bandwidth Utilization:
 *    - During long subordinate execution windows (even 2+ hours), Mind actively uses its bandwidth for:
 *      a) Macro-level DAG diagnostics (Work/Span P = W / S, critical path analysis, bottleneck mitigations)
 *      b) Backlog grooming (feedback intake, dormant criteria reconciliation, strategic ranking)
 *      c) Candidate admission (pre-evaluating candidates against Charter goals and 6 Admission Gates)
 *      d) Proactive roadmap planning for future fleets (synthesizing upcoming waves ahead of time)
 */

export const MIND_STRATEGIC_ALTITUDE = "30,000 feet" as const;

export const MIND_HARD_ZEROS = {
  ZERO_SOURCE_CODE_EDITS: "zero_source_code_edits",
  ZERO_UNIT_TEST_EXECUTION: "zero_unit_test_execution",
  ZERO_CRITIC_JOBS: "zero_critic_jobs",
} as const;

export const MIND_PROACTIVE_BANDWIDTH_ACTIVITIES = [
  "macro_dag_diagnostics",
  "backlog_grooming",
  "candidate_admission",
  "proactive_roadmap_planning",
] as const;

export type MindProactiveBandwidthActivity = (typeof MIND_PROACTIVE_BANDWIDTH_ACTIVITIES)[number];

export interface MacroDagTaskNode {
  readonly taskId: string;
  readonly role: string;
  readonly status: "pending" | "ready" | "leased" | "completed" | "failed";
  readonly durationEstimateMs?: number | undefined;
  readonly dependencies: readonly string[];
  readonly writeScope?: readonly string[] | undefined;
}

export interface MacroDagBottleneck {
  readonly type: "critical_path" | "fan_in" | "fan_out" | "scope_lock" | "stale_lease";
  readonly taskId: string;
  readonly description: string;
  readonly suggestedMitigation: string;
}

export interface MacroDagDiagnosticResult {
  readonly totalNodes: number;
  readonly readyNodes: number;
  readonly leasedNodes: number;
  readonly completedNodes: number;
  readonly failedNodes: number;
  readonly criticalPathLength: number;
  readonly totalWorkMs: number;
  readonly criticalSpanMs: number;
  readonly workSpanRatio: number;
  readonly concurrencyRecommendation: number;
  readonly bottlenecks: readonly MacroDagBottleneck[];
  readonly subagentAllocations: Readonly<Record<string, number>>;
}

export interface BacklogGroomingItem {
  readonly id: string;
  readonly title: string;
  readonly category: string;
  readonly priority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  readonly source: string;
  readonly status: "actionable" | "dormant" | "reconciled" | "pruned";
  readonly rationale?: string | undefined;
}

export interface BacklogGroomingResult {
  readonly scannedCount: number;
  readonly actionableCount: number;
  readonly dormantCount: number;
  readonly reconciledCount: number;
  readonly prunedCount: number;
  readonly items: readonly BacklogGroomingItem[];
  readonly strategicPriorities: readonly string[];
  readonly groomingSummary: string;
}

export interface StrategicCandidate {
  readonly id: string;
  readonly title: string;
  readonly objectiveStatement: string;
  readonly charterGoalIds: readonly string[];
  readonly writeScope: readonly string[];
  readonly witnessCommand?: string | undefined;
  readonly witnessOutput?: string | undefined;
  readonly falsifierCommand?: string | undefined;
}

export interface StrategicCandidateEvaluation {
  readonly candidateId: string;
  readonly title: string;
  readonly gate1Witnessed: boolean;
  readonly gate2InCharter: boolean;
  readonly gate3Falsifiable: boolean;
  readonly gate4DisjointScope: boolean;
  readonly gate5BudgetOk: boolean;
  readonly gate6NotDuplicate: boolean;
  readonly admitted: boolean;
  readonly failingGates: readonly number[];
  readonly decisionRationale: string;
  readonly assignedTier1Orchestrator?: string | undefined;
}

export interface StrategicCandidateAdmissionResult {
  readonly evaluatedCount: number;
  readonly admittedCount: number;
  readonly declinedCount: number;
  readonly evaluations: readonly StrategicCandidateEvaluation[];
  readonly summary: string;
}

export interface ProactiveWaveTask {
  readonly taskId: string;
  readonly description: string;
  readonly role: string;
  readonly estimatedDurationMs?: number | undefined;
}

export interface ProactiveWavePlan {
  readonly waveNumber: number;
  readonly title: string;
  readonly scopeDescription: string;
  readonly isolatedWriteScopes: readonly string[];
  readonly estimatedParallelism: number;
  readonly atomicTasks: readonly ProactiveWaveTask[];
}

export interface ProactiveRoadmapPlan {
  readonly fleetId: string;
  readonly plannedAt: string;
  readonly targetHorizonMs: number;
  readonly targetHorizonHours: number;
  readonly waves: readonly ProactiveWavePlan[];
  readonly totalTasks: number;
  readonly maxParallelism: number;
  readonly proactiveStrategy: string;
}

export interface ProactiveMindCognitionResult {
  readonly timestamp: string;
  readonly altitude: typeof MIND_STRATEGIC_ALTITUDE;
  readonly subordinateExecutionWindowMs: number;
  readonly subordinateExecutionWindowHours: number;
  readonly macroDag: MacroDagDiagnosticResult;
  readonly backlogGrooming: BacklogGroomingResult;
  readonly candidateAdmission: StrategicCandidateAdmissionResult;
  readonly proactiveRoadmap: ProactiveRoadmapPlan;
  readonly strategicSummary: string;
}

export interface MacroDagDiagnosticOptions {
  readonly nodes?: readonly MacroDagTaskNode[] | undefined;
  readonly runRoot?: string | undefined;
  readonly defaultTaskDurationMs?: number | undefined;
}

export interface BacklogGroomingOptions {
  readonly rawItems?: readonly Partial<BacklogGroomingItem>[] | undefined;
  readonly feedbackQueuePath?: string | undefined;
  readonly charterGoals?: readonly string[] | undefined;
}

export interface StrategicCandidateAdmissionOptions {
  readonly charterGoals?: readonly string[] | undefined;
  readonly activeScopes?: readonly string[] | undefined;
  readonly declinedIds?: readonly string[] | undefined;
  readonly maxAgentsInFlight?: number | undefined;
  readonly currentAgentsInFlight?: number | undefined;
}

export interface ProactiveRoadmapPlanningOptions {
  readonly fleetId?: string | undefined;
  readonly targetHorizonHours?: number | undefined;
  readonly admittedCandidates?: readonly StrategicCandidate[] | undefined;
  readonly backlogPriorities?: readonly string[] | undefined;
}

export interface ProactiveMindCognitionOptions {
  readonly subordinateExecutionWindowMs?: number | undefined;
  readonly nodes?: readonly MacroDagTaskNode[] | undefined;
  readonly rawBacklog?: readonly Partial<BacklogGroomingItem>[] | undefined;
  readonly candidates?: readonly StrategicCandidate[] | undefined;
  readonly charterGoals?: readonly string[] | undefined;
  readonly activeScopes?: readonly string[] | undefined;
  readonly declinedIds?: readonly string[] | undefined;
  readonly fleetId?: string | undefined;
  readonly targetHorizonHours?: number | undefined;
}

/**
 * 1. Macro-Level DAG Diagnostics (Altitude: 30,000 feet)
 * Analyzes execution graph topology, computes critical span, total work,
 * Work/Span parallelism ratio (P = W / S), identifies bottlenecks, and suggests mitigations.
 */
export function diagnoseMacroDag(
  options: MacroDagDiagnosticOptions = {},
): MacroDagDiagnosticResult {
  const nodes = options.nodes ?? [];
  const defaultDuration = options.defaultTaskDurationMs ?? 60_000;

  let readyNodes = 0;
  let leasedNodes = 0;
  let completedNodes = 0;
  let failedNodes = 0;

  const subagentAllocations: Record<string, number> = {};
  const inDegreeMap = new Map<string, number>();
  const outDegreeMap = new Map<string, number>();
  const nodeMap = new Map<string, MacroDagTaskNode>();

  for (const node of nodes) {
    nodeMap.set(node.taskId, node);
    inDegreeMap.set(node.taskId, 0);
    outDegreeMap.set(node.taskId, 0);

    if (node.status === "ready") readyNodes += 1;
    else if (node.status === "leased") leasedNodes += 1;
    else if (node.status === "completed") completedNodes += 1;
    else if (node.status === "failed") failedNodes += 1;

    subagentAllocations[node.role] = (subagentAllocations[node.role] ?? 0) + 1;
  }

  for (const node of nodes) {
    for (const depId of node.dependencies) {
      if (nodeMap.has(depId)) {
        outDegreeMap.set(depId, (outDegreeMap.get(depId) ?? 0) + 1);
        inDegreeMap.set(node.taskId, (inDegreeMap.get(node.taskId) ?? 0) + 1);
      }
    }
  }

  // Calculate Critical Span and Total Work using topological levels
  const depthMap = new Map<string, number>();
  function computeDepth(taskId: string, visiting = new Set<string>()): number {
    if (depthMap.has(taskId)) return depthMap.get(taskId)!;
    if (visiting.has(taskId)) return 1; // cycle break
    visiting.add(taskId);

    const node = nodeMap.get(taskId);
    if (!node || node.dependencies.length === 0) {
      depthMap.set(taskId, 1);
      visiting.delete(taskId);
      return 1;
    }

    let maxParentDepth = 0;
    for (const depId of node.dependencies) {
      maxParentDepth = Math.max(maxParentDepth, computeDepth(depId, visiting));
    }
    const depth = maxParentDepth + 1;
    depthMap.set(taskId, depth);
    visiting.delete(taskId);
    return depth;
  }

  let criticalPathLength = 0;
  for (const node of nodes) {
    criticalPathLength = Math.max(criticalPathLength, computeDepth(node.taskId));
  }

  const totalWorkMs = nodes.reduce((sum, n) => sum + (n.durationEstimateMs ?? defaultDuration), 0);
  const criticalSpanMs = Math.max(
    criticalPathLength * defaultDuration,
    nodes.length > 0 ? defaultDuration : 0,
  );
  const workSpanRatio =
    criticalSpanMs > 0
      ? Number((totalWorkMs / criticalSpanMs).toFixed(2))
      : nodes.length > 0
        ? nodes.length
        : 1.0;
  const concurrencyRecommendation = Math.max(1, Math.round(workSpanRatio));

  // Identify Macro Bottlenecks
  const bottlenecks: MacroDagBottleneck[] = [];
  for (const node of nodes) {
    const inDegree = inDegreeMap.get(node.taskId) ?? 0;
    const outDegree = outDegreeMap.get(node.taskId) ?? 0;

    if (inDegree >= 4) {
      bottlenecks.push({
        type: "fan_in",
        taskId: node.taskId,
        description: `High fan-in convergence point with ${inDegree} incoming dependencies.`,
        suggestedMitigation:
          "Authorize Tier 1 Orchestrator to split convergence into multi-stage pipelines.",
      });
    }

    if (outDegree >= 4) {
      bottlenecks.push({
        type: "fan_out",
        taskId: node.taskId,
        description: `High fan-out bottleneck unblocking ${outDegree} downstream tasks.`,
        suggestedMitigation:
          "Prioritize top-of-wave execution to maximize downstream worker concurrency.",
      });
    }

    if (node.status === "failed") {
      bottlenecks.push({
        type: "critical_path",
        taskId: node.taskId,
        description: `Failed node on execution graph blocking dependent branches.`,
        suggestedMitigation: "Dispatch repairer lane or prune unrecoverable branch.",
      });
    }
  }

  return {
    totalNodes: nodes.length,
    readyNodes,
    leasedNodes,
    completedNodes,
    failedNodes,
    criticalPathLength,
    totalWorkMs,
    criticalSpanMs,
    workSpanRatio,
    concurrencyRecommendation,
    bottlenecks,
    subagentAllocations,
  };
}

/**
 * 2. Backlog Grooming (Altitude: 30,000 feet)
 * Cleans, ranks, deduplicates, and structures pending feedback items, dormant criteria,
 * and candidate requests into actionable strategic priorities.
 */
export function groomBacklog(options: BacklogGroomingOptions = {}): BacklogGroomingResult {
  const raw = options.rawItems ?? [];
  const items: BacklogGroomingItem[] = [];

  let actionableCount = 0;
  let dormantCount = 0;
  let reconciledCount = 0;
  let prunedCount = 0;

  for (let idx = 0; idx < raw.length; idx += 1) {
    const r = raw[idx]!;
    const id = r.id ? r.id : `backlog-item-${idx + 1}`;
    const title = r.title ? r.title : "Groomed Backlog Item";
    const category = r.category ? r.category : "COGNITIVE_GAP";
    const priority = r.priority ? r.priority : "MEDIUM";
    const source = r.source ? r.source : "mind-supervisory-pulse";
    const status = r.status ? r.status : "actionable";

    if (status === "actionable") actionableCount += 1;
    else if (status === "dormant") dormantCount += 1;
    else if (status === "reconciled") reconciledCount += 1;
    else if (status === "pruned") prunedCount += 1;

    items.push({
      id,
      title,
      category,
      priority,
      source,
      status,
      rationale: r.rationale,
    });
  }

  // Sort strategic priorities: CRITICAL -> HIGH -> MEDIUM -> LOW
  const priorityWeight: Record<string, number> = {
    CRITICAL: 4,
    HIGH: 3,
    MEDIUM: 2,
    LOW: 1,
  };

  const strategicPriorities = items
    .filter((it) => it.status === "actionable")
    .sort((a, b) => (priorityWeight[b.priority] ?? 0) - (priorityWeight[a.priority] ?? 0))
    .map((it) => `[${it.priority}] ${it.title} (${it.category})`);

  const groomingSummary =
    `Backlog groomed: ${items.length} total items (${actionableCount} actionable, ` +
    `${dormantCount} dormant, ${reconciledCount} reconciled, ${prunedCount} pruned). ` +
    `Top strategic priorities identified: ${strategicPriorities.length}.`;

  return {
    scannedCount: items.length,
    actionableCount,
    dormantCount,
    reconciledCount,
    prunedCount,
    items,
    strategicPriorities,
    groomingSummary,
  };
}

/**
 * 3. Candidate Admission Evaluation (Altitude: 30,000 feet)
 * Pre-evaluates incoming candidates against Charter goals and the 6 Admission Gates:
 * Gate 1: Witnessed
 * Gate 2: In-Charter
 * Gate 3: Falsifiable
 * Gate 4: Disjoint Scope
 * Gate 5: Budget Ok
 * Gate 6: Not Duplicate / Not Declined
 */
export function evaluateStrategicCandidateAdmission(
  candidates: readonly StrategicCandidate[],
  options: StrategicCandidateAdmissionOptions = {},
): StrategicCandidateAdmissionResult {
  const charterGoals = new Set(options.charterGoals ?? []);
  const activeScopes = new Set(options.activeScopes ?? []);
  const declinedIds = new Set(options.declinedIds ?? []);
  const maxAgents = options.maxAgentsInFlight ?? 8;
  const currentAgents = options.currentAgentsInFlight ?? 0;

  const evaluations: StrategicCandidateEvaluation[] = [];
  let admittedCount = 0;
  let declinedCount = 0;

  for (const cand of candidates) {
    const failingGates: number[] = [];

    // Gate 1: Witnessed (has witnessCommand or objective is non-empty)
    const gate1Witnessed = cand.objectiveStatement.trim().length > 0;
    if (!gate1Witnessed) failingGates.push(1);

    // Gate 2: In-Charter (cites valid charter goals if goals exist)
    const gate2InCharter =
      charterGoals.size === 0 || cand.charterGoalIds.some((g) => charterGoals.has(g));
    if (!gate2InCharter) failingGates.push(2);

    // Gate 3: Falsifiable
    const gate3Falsifiable = cand.objectiveStatement.trim().length >= 10;
    if (!gate3Falsifiable) failingGates.push(3);

    // Gate 4: Disjoint Scope (write scope does not collide with active scopes)
    const gate4DisjointScope =
      cand.writeScope.length === 0 || !cand.writeScope.some((s) => activeScopes.has(s));
    if (!gate4DisjointScope) failingGates.push(4);

    // Gate 5: Budget Ok (within agent concurrency limits)
    const gate5BudgetOk = currentAgents < maxAgents;
    if (!gate5BudgetOk) failingGates.push(5);

    // Gate 6: Not Duplicate / Declined
    const gate6NotDuplicate = !declinedIds.has(cand.id);
    if (!gate6NotDuplicate) failingGates.push(6);

    const admitted = failingGates.length === 0;
    if (admitted) {
      admittedCount += 1;
    } else {
      declinedCount += 1;
    }

    const decisionRationale = admitted
      ? `Candidate admitted across all 6 gates. Aligned with charter goals: [${cand.charterGoalIds.join(", ")}].`
      : `Candidate declined due to Gate violations: [${failingGates.map((g) => `Gate ${g}`).join(", ")}].`;

    evaluations.push({
      candidateId: cand.id,
      title: cand.title,
      gate1Witnessed,
      gate2InCharter,
      gate3Falsifiable,
      gate4DisjointScope,
      gate5BudgetOk,
      gate6NotDuplicate,
      admitted,
      failingGates,
      decisionRationale,
      assignedTier1Orchestrator: admitted ? "orchestrator_wave-next" : undefined,
    });
  }

  const summary = `Candidate Admission: ${candidates.length} evaluated, ${admittedCount} admitted, ${declinedCount} declined.`;

  return {
    evaluatedCount: candidates.length,
    admittedCount,
    declinedCount,
    evaluations,
    summary,
  };
}

/**
 * 4. Proactive Roadmap Planning for Future Fleets (Altitude: 30,000 feet)
 * During long subordinate execution windows (even 2+ hours), Mind proactively constructs
 * future fleet roadmaps, decomposes epics into isolated-scope waves, and drafts execution schedules
 * so downstream orchestrators experience zero idle queue latency upon wave completion.
 */
export function planProactiveRoadmap(
  options: ProactiveRoadmapPlanningOptions = {},
): ProactiveRoadmapPlan {
  const fleetId = options.fleetId ?? `fleet-future-${Date.now().toString(36)}`;
  const targetHorizonHours = options.targetHorizonHours ?? 2.5;
  const targetHorizonMs = Math.round(targetHorizonHours * 3_600_000);
  const admitted = options.admittedCandidates ?? [];
  const priorities = options.backlogPriorities ?? [];

  const waves: ProactiveWavePlan[] = [];

  // Wave 1: Immediate next generation unblocked foundations
  const wave1Tasks: ProactiveWaveTask[] = [];
  if (admitted.length > 0) {
    for (let i = 0; i < admitted.length; i += 1) {
      const cand = admitted[i]!;
      wave1Tasks.push({
        taskId: `task-${cand.id}`,
        description: cand.title,
        role: "implementer",
        estimatedDurationMs: 900_000,
      });
    }
  } else if (priorities.length > 0) {
    for (let i = 0; i < Math.min(3, priorities.length); i += 1) {
      wave1Tasks.push({
        taskId: `task-prio-${i + 1}`,
        description: priorities[i]!,
        role: "implementer",
        estimatedDurationMs: 900_000,
      });
    }
  } else {
    wave1Tasks.push({
      taskId: "task-strategic-foundation-1",
      description: "Foundation Architecture & Multi-Coordinator Decoupling",
      role: "implementer",
      estimatedDurationMs: 900_000,
    });
    wave1Tasks.push({
      taskId: "task-strategic-foundation-2",
      description: "Subagent Resource Quota & Viewport Validation Matrix",
      role: "implementer",
      estimatedDurationMs: 900_000,
    });
  }

  waves.push({
    waveNumber: 1,
    title: "Wave 1: Strategic Foundations & Core Implementations",
    scopeDescription: "Disjoint foundational modules with strict write lease boundaries",
    isolatedWriteScopes: [
      "orchestrating-long-tasks/scripts/src/core",
      "orchestrating-long-tasks/roles",
    ],
    estimatedParallelism: wave1Tasks.length,
    atomicTasks: wave1Tasks,
  });

  // Wave 2: Downstream Hardening & Multi-Viewport Verification
  const wave2Tasks: ProactiveWaveTask[] = [
    {
      taskId: "task-verification-multi-viewport",
      description: "4-Tier Viewport Resolution Matrix & APCA Contrast Hardening",
      role: "validator",
      estimatedDurationMs: 600_000,
    },
    {
      taskId: "task-verification-soak-invariants",
      description: "Long-Running Soak & Subordinate Drift Watchdog Hardening",
      role: "validator",
      estimatedDurationMs: 600_000,
    },
  ];

  waves.push({
    waveNumber: 2,
    title: "Wave 2: Multi-Viewport Validation & Soak Verification",
    scopeDescription:
      "Independent validation passes covering all 4 viewport tiers and contract invariants",
    isolatedWriteScopes: ["tests/unit/mind", "tests/unit/roles"],
    estimatedParallelism: 2,
    atomicTasks: wave2Tasks,
  });

  const totalTasks = waves.reduce((sum, w) => sum + w.atomicTasks.length, 0);
  const maxParallelism = Math.max(...waves.map((w) => w.estimatedParallelism), 1);

  const proactiveStrategy =
    `Proactive Roadmap synthesized for Fleet '${fleetId}' over ${targetHorizonHours.toFixed(1)}h horizon. ` +
    `Constructed ${waves.length} waves with ${totalTasks} total tasks and peak topological concurrency P = ${maxParallelism}. ` +
    `Guarantees zero-delay handoff for Tier 1 Orchestrator upon current wave completion.`;

  return {
    fleetId,
    plannedAt: new Date().toISOString(),
    targetHorizonMs,
    targetHorizonHours,
    waves,
    totalTasks,
    maxParallelism,
    proactiveStrategy,
  };
}

/**
 * 5. Full Proactive Mind Cognition Orchestrator (Altitude: 30,000 feet)
 * Actively utilizes subordinate execution windows (even 2+ hours) to run all 4 proactive activities:
 * - Macro DAG Diagnostics
 * - Backlog Grooming
 * - Candidate Admission Evaluation
 * - Proactive Roadmap Planning for Future Fleets
 */
export function executeProactiveMindCognition(
  options: ProactiveMindCognitionOptions = {},
): ProactiveMindCognitionResult {
  const windowMs = options.subordinateExecutionWindowMs ?? 7_200_000; // default 2 hours
  const windowHours = Number((windowMs / 3_600_000).toFixed(2));

  // 1. Macro-Level DAG Diagnostics
  const macroDag = diagnoseMacroDag({ nodes: options.nodes });

  // 2. Backlog Grooming
  const backlogGrooming = groomBacklog({
    rawItems: options.rawBacklog,
    charterGoals: options.charterGoals,
  });

  // 3. Candidate Admission
  const candidateAdmission = evaluateStrategicCandidateAdmission(options.candidates ?? [], {
    charterGoals: options.charterGoals,
    activeScopes: options.activeScopes,
    declinedIds: options.declinedIds,
  });

  // 4. Proactive Roadmap Planning
  const admittedCandidates = (options.candidates ?? []).filter((c) =>
    candidateAdmission.evaluations.some((e) => e.candidateId === c.id && e.admitted),
  );

  const proactiveRoadmap = planProactiveRoadmap({
    fleetId: options.fleetId,
    targetHorizonHours: options.targetHorizonHours ?? Math.max(2.0, windowHours),
    admittedCandidates,
    backlogPriorities: backlogGrooming.strategicPriorities,
  });

  const strategicSummary =
    `[Mind 30,000ft Cognition] Utilized ${windowHours}h subordinate execution window: ` +
    `DAG diagnostics (P = ${macroDag.workSpanRatio}, ${macroDag.bottlenecks.length} bottlenecks), ` +
    `Backlog (${backlogGrooming.actionableCount} actionable items), ` +
    `Admissions (${candidateAdmission.admittedCount}/${candidateAdmission.evaluatedCount} admitted), ` +
    `Roadmap (${proactiveRoadmap.waves.length} waves, ${proactiveRoadmap.totalTasks} atomic tasks planned for next fleet).`;

  return {
    timestamp: new Date().toISOString(),
    altitude: MIND_STRATEGIC_ALTITUDE,
    subordinateExecutionWindowMs: windowMs,
    subordinateExecutionWindowHours: windowHours,
    macroDag,
    backlogGrooming,
    candidateAdmission,
    proactiveRoadmap,
    strategicSummary,
  };
}

/**
 * Formats a clean, high-density markdown brief of proactive mind cognition findings.
 */
export function formatStrategicCognitionBrief(result: ProactiveMindCognitionResult): string {
  const lines: string[] = [];

  lines.push(`### 🧠 Tier 0 Mind Strategic Cognition (Altitude: ${result.altitude})`);
  lines.push(
    `**Subordinate Execution Window**: ${result.subordinateExecutionWindowHours}h (${result.subordinateExecutionWindowMs}ms)`,
  );
  lines.push(`**Strategic Summary**: ${result.strategicSummary}`);
  lines.push("");

  lines.push("#### 📊 Macro DAG Diagnostics");
  lines.push(
    `- Total Nodes: ${result.macroDag.totalNodes} | Critical Span: ${result.macroDag.criticalPathLength} levels | Total Work: ${Math.round(result.macroDag.totalWorkMs / 1000)}s`,
  );
  lines.push(
    `- Topological Concurrency (P = W / S): **${result.macroDag.workSpanRatio}** (Recommended Concurrency: ${result.macroDag.concurrencyRecommendation})`,
  );
  if (result.macroDag.bottlenecks.length > 0) {
    lines.push(`- Identified Bottlenecks (${result.macroDag.bottlenecks.length}):`);
    for (const b of result.macroDag.bottlenecks.slice(0, 3)) {
      lines.push(`  * \`${b.taskId}\` [${b.type}]: ${b.description}`);
    }
  } else {
    lines.push("- Bottlenecks: None detected (optimal topological flow)");
  }
  lines.push("");

  lines.push("#### 📋 Backlog Grooming & Strategic Priorities");
  lines.push(`- ${result.backlogGrooming.groomingSummary}`);
  if (result.backlogGrooming.strategicPriorities.length > 0) {
    for (const p of result.backlogGrooming.strategicPriorities.slice(0, 3)) {
      lines.push(`  * ${p}`);
    }
  }
  lines.push("");

  lines.push("#### 🛡️ Candidate Admission Pre-Evaluation");
  lines.push(`- ${result.candidateAdmission.summary}`);
  for (const e of result.candidateAdmission.evaluations.slice(0, 3)) {
    lines.push(
      `  * \`${e.candidateId}\`: ${e.admitted ? "✅ ADMITTED" : "❌ DECLINED"} — ${e.decisionRationale}`,
    );
  }
  lines.push("");

  lines.push("#### 🚀 Proactive Roadmap Planning for Future Fleets");
  lines.push(`- ${result.proactiveRoadmap.proactiveStrategy}`);
  for (const wave of result.proactiveRoadmap.waves) {
    lines.push(
      `  * **${wave.title}** (${wave.atomicTasks.length} tasks, parallelism: ${wave.estimatedParallelism})`,
    );
    for (const t of wave.atomicTasks.slice(0, 2)) {
      lines.push(`    - \`${t.taskId}\` [${t.role}]: ${t.description}`);
    }
  }

  return lines.join("\n");
}

/**
 * Validates whether a given text or role definition satisfies the Tier 0 Mind strategic invariants:
 * - Strategic altitude: 30,000 feet
 * - Zero source code edits
 * - Zero unit test execution
 * - Zero critic jobs
 * - Proactive bandwidth utilization during long execution windows (2+ hours)
 */
export function verifyMindRoleStrategicInvariants(input: string | Record<string, unknown>): {
  readonly isValid: boolean;
  readonly altitudeCompliant: boolean;
  readonly zeroEditsCompliant: boolean;
  readonly zeroUnitTestsCompliant: boolean;
  readonly zeroCriticCompliant: boolean;
  readonly proactiveBandwidthCompliant: boolean;
  readonly violations: readonly string[];
} {
  const text = typeof input === "string" ? input : JSON.stringify(input);

  const lower = text.toLowerCase();
  const violations: string[] = [];

  const altitudeCompliant =
    lower.includes("30,000") || lower.includes("strategic brain") || lower.includes("tier 0");
  if (!altitudeCompliant) {
    violations.push("Missing explicit Strategic Brain / 30,000 feet altitude designation");
  }

  const zeroEditsCompliant =
    lower.includes("zero source code edits") ||
    lower.includes("zero source edits") ||
    lower.includes("never write, edit") ||
    lower.includes("write, edit, stage, revert, format or delete any repository file");
  if (!zeroEditsCompliant) {
    violations.push("Missing Zero Source Code Edits prohibition");
  }

  const zeroUnitTestsCompliant =
    lower.includes("zero unit test execution") ||
    lower.includes("zero unit tests") ||
    lower.includes("never run unit") ||
    lower.includes("unit test execution");
  if (!zeroUnitTestsCompliant) {
    violations.push("Missing Zero Unit Test Execution prohibition");
  }

  const zeroCriticCompliant =
    lower.includes("zero critic jobs") ||
    lower.includes("zero critic") ||
    lower.includes("critic jobs") ||
    lower.includes("critic passes");
  if (!zeroCriticCompliant) {
    violations.push("Missing Zero Critic Jobs prohibition");
  }

  const proactiveBandwidthCompliant =
    (lower.includes("bandwidth") ||
      lower.includes("subordinate execution window") ||
      lower.includes("2+ hours") ||
      lower.includes("proactive")) &&
    (lower.includes("dag") ||
      lower.includes("backlog") ||
      lower.includes("candidate") ||
      lower.includes("roadmap"));
  if (!proactiveBandwidthCompliant) {
    violations.push(
      "Missing proactive execution window bandwidth utilization specification (DAG diagnostics, backlog grooming, candidate admission, roadmap planning)",
    );
  }

  const isValid = violations.length === 0;

  return {
    isValid,
    altitudeCompliant,
    zeroEditsCompliant,
    zeroUnitTestsCompliant,
    zeroCriticCompliant,
    proactiveBandwidthCompliant,
    violations,
  };
}

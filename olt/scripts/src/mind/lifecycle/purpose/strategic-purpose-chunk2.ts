

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

import type { TaskQueueItem } from "../../../task/queue/index.ts";
import { DEFAULT_SCALING_THRESHOLDS } from "./types.ts";
import type {
  HierarchyCapacityMetrics,
  HierarchyScalingDecision,
  HierarchyScalingDirection,
  LoadBalancingPlan,
  OrchestratorNodeInfo,
  ScalingThresholds,
  SupervisoryRoleTier,
} from "./types.ts";

export function calculateHierarchyCapacity(params: {
  readonly taskQueue?: readonly TaskQueueItem[] | undefined;
  readonly orchestrators?: readonly OrchestratorNodeInfo[] | undefined;
  readonly activeWorkersCount?: number | undefined;
  readonly maxWorkersCapacity?: number | undefined;
  readonly thresholds?: Partial<ScalingThresholds> | undefined;
}): HierarchyCapacityMetrics {
  const thresholds: ScalingThresholds = {
    ...DEFAULT_SCALING_THRESHOLDS,
    ...params.thresholds,
  };

  const tasks = params.taskQueue ?? [];
  const pendingTasks = tasks.filter(
    (t) => t.status === "PENDING" || t.status === "ADMITTED",
  ).length;
  const inProgressTasks = tasks.filter(
    (t) => t.status === "IN_PROGRESS" || t.status === "RUNNING",
  ).length;
  const totalActiveTasks = pendingTasks + inProgressTasks;

  const orchestratorList = params.orchestrators ?? [];
  const tier1Orchestrators = orchestratorList.filter(
    (o) => o.tier === 1 && o.status !== "DRAINING",
  );
  const tier2Coordinators = orchestratorList.filter((o) => o.tier === 2 && o.status !== "DRAINING");

  const activeTier1Count = Math.max(tier1Orchestrators.length, 1);
  const activeTier2Count = Math.max(tier2Coordinators.length, 1);
  const activeTier3Workers = params.activeWorkersCount ?? inProgressTasks;
  const maxTier3 = params.maxWorkersCapacity ?? 10;

  const tier1LoadRatio = Number((totalActiveTasks / activeTier1Count).toFixed(2));
  const tier2LoadRatio = Number((totalActiveTasks / activeTier2Count).toFixed(2));
  const tier3Utilization = Number((activeTier3Workers / Math.max(maxTier3, 1)).toFixed(2));

  const recommendedTier1Count = Math.min(
    thresholds.maxTier1Limit,
    Math.max(
      thresholds.minTier1Limit,
      Math.ceil(totalActiveTasks / thresholds.maxTasksPerTier1Orchestrator),
    ),
  );

  const recommendedTier2Count = Math.min(
    thresholds.maxTier2Limit,
    Math.max(
      thresholds.minTier2Limit,
      Math.ceil(totalActiveTasks / thresholds.maxTasksPerTier2Coordinator),
    ),
  );

  const reasons: string[] = [];
  let scalingDirection: HierarchyScalingDirection = "STEADY";

  if (
    tier1LoadRatio > thresholds.scaleOutLoadThreshold ||
    recommendedTier1Count > activeTier1Count
  ) {
    scalingDirection = "SCALE_OUT";
    reasons.push(
      `Tier 1 orchestrator load ratio (${tier1LoadRatio}) exceeds scale-out threshold (${thresholds.scaleOutLoadThreshold}); recommend scaling to ${recommendedTier1Count} orchestrator(s)`,
    );
  } else if (totalActiveTasks === 0 && activeTier1Count > thresholds.minTier1Limit) {
    scalingDirection = "SCALE_IN";
    reasons.push(
      `Queue is quiescent with ${activeTier1Count} active orchestrator(s); recommend scaling in to baseline ${thresholds.minTier1Limit}`,
    );
  } else if (
    tier1LoadRatio < thresholds.scaleInLoadThreshold &&
    activeTier1Count > thresholds.minTier1Limit &&
    recommendedTier1Count < activeTier1Count
  ) {
    scalingDirection = "SCALE_IN";
    reasons.push(
      `Tier 1 orchestrator load ratio (${tier1LoadRatio}) is below scale-in threshold (${thresholds.scaleInLoadThreshold}); recommend scaling down to ${recommendedTier1Count} orchestrator(s)`,
    );
  } else {
    if (orchestratorList.length > 1) {
      const loads = orchestratorList.map((o) => o.currentLoad);
      const minLoad = Math.min(...loads);
      const maxLoad = Math.max(...loads);
      if (maxLoad - minLoad >= 3) {
        scalingDirection = "REBALANCE";
        reasons.push(
          `Load imbalance detected (min: ${minLoad}, max: ${maxLoad}); rebalancing recommended`,
        );
      } else {
        reasons.push(
          `Hierarchy capacity steady (${activeTier1Count} T1, ${activeTier2Count} T2; load ratio ${tier1LoadRatio})`,
        );
      }
    } else {
      reasons.push(
        `Hierarchy capacity steady (${activeTier1Count} T1, ${activeTier2Count} T2; load ratio ${tier1LoadRatio})`,
      );
    }
  }

  return {
    activeTier1Count,
    activeTier2Count,
    activeTier3Workers,
    totalPendingTasks: pendingTasks,
    totalInProgressTasks: inProgressTasks,
    tier1LoadRatio,
    tier2LoadRatio,
    tier3Utilization,
    recommendedTier1Count,
    recommendedTier2Count,
    scalingDirection,
    reasons,
  };
}

export function evaluateHierarchyScaling(
  metrics: HierarchyCapacityMetrics,
  customThresholds?: Partial<ScalingThresholds>,
): HierarchyScalingDecision {
  const thresholds: ScalingThresholds = {
    ...DEFAULT_SCALING_THRESHOLDS,
    ...customThresholds,
  };

  const spawns: { readonly role: "orchestrator" | "coordinator"; readonly domainSlug: string }[] =
    [];
  const drains: string[] = [];

  if (metrics.scalingDirection === "SCALE_OUT") {
    const neededTier1 = Math.max(0, metrics.recommendedTier1Count - metrics.activeTier1Count);
    for (let i = 0; i < neededTier1; i++) {
      spawns.push({
        role: "orchestrator",
        domainSlug: `orchestrator_scaled-t1-${Date.now().toString().slice(-4)}-${i + 1}`,
      });
    }

    const neededTier2 = Math.max(0, metrics.recommendedTier2Count - metrics.activeTier2Count);
    for (let i = 0; i < neededTier2; i++) {
      spawns.push({
        role: "coordinator",
        domainSlug: `coordinator_scaled-t2-${Date.now().toString().slice(-4)}-${i + 1}`,
      });
    }

    return {
      action: "SCALE_OUT",
      newTier1Count: metrics.recommendedTier1Count,
      newTier2Count: metrics.recommendedTier2Count,
      spawnsRecommended: spawns,
      drainsRecommended: [],
      reason: metrics.reasons.join("; "),
    };
  }

  if (metrics.scalingDirection === "SCALE_IN") {
    return {
      action: "SCALE_IN",
      newTier1Count: metrics.recommendedTier1Count,
      newTier2Count: metrics.recommendedTier2Count,
      spawnsRecommended: [],
      drainsRecommended: drains,
      reason: metrics.reasons.join("; "),
    };
  }

  return {
    action: metrics.scalingDirection,
    newTier1Count: metrics.activeTier1Count,
    newTier2Count: metrics.activeTier2Count,
    spawnsRecommended: [],
    drainsRecommended: [],
    reason: metrics.reasons.join("; "),
  };
}

import { HarnessError } from "../../core/errors/index.ts";
import { clusterBacklogAndDefects, generatePlanPath } from "./backlog-clusterer.ts";
import type { ClusterOptions, RawBacklogItem, RawDefectItem, ThematicCluster } from "./types.ts";

export const DEFAULT_SINGLE_ORCHESTRATOR_CAPACITY = 5;

export function assertDisjointClusters(clusters: readonly ThematicCluster[]): void {
  const seenItemIds = new Set<string>();
  const seenDefectIds = new Set<string>();

  for (const cluster of clusters) {
    for (const itemId of cluster.backlog_item_ids) {
      if (seenItemIds.has(itemId)) {
        throw new HarnessError(
          "INTEGRITY",
          `Overlap violation: item '${itemId}' appears in multiple clusters including '${cluster.cluster_id}'.`,
        );
      }
      seenItemIds.add(itemId);
    }

    for (const defectId of cluster.defect_ids) {
      if (seenDefectIds.has(defectId)) {
        throw new HarnessError(
          "INTEGRITY",
          `Overlap violation: defect '${defectId}' appears in multiple clusters including '${cluster.cluster_id}'.`,
        );
      }
      seenDefectIds.add(defectId);
    }
  }
}

export function shardClusterByCapacity(
  cluster: ThematicCluster,
  capacity: number,
  targetDir?: string,
): readonly ThematicCluster[] {
  const totalCount = cluster.backlog_item_ids.length + cluster.defect_ids.length;
  if (totalCount <= capacity || capacity <= 0) {
    return [cluster];
  }

  const allItems = [...cluster.backlog_item_ids];
  const allDefects = [...cluster.defect_ids];
  const shards: ThematicCluster[] = [];

  let itemIdx = 0;
  let defectIdx = 0;
  let shardNum = 1;

  while (itemIdx < allItems.length || defectIdx < allDefects.length) {
    const shardItemIds: string[] = [];
    const shardDefectIds: string[] = [];
    let allocated = 0;

    while (itemIdx < allItems.length && allocated < capacity) {
      shardItemIds.push(allItems[itemIdx]!);
      itemIdx++;
      allocated++;
    }

    while (defectIdx < allDefects.length && allocated < capacity) {
      shardDefectIds.push(allDefects[defectIdx]!);
      defectIdx++;
      allocated++;
    }

    const shardClusterId = `${cluster.cluster_id}-shard-${shardNum}`;
    const shardPlanPath = generatePlanPath(shardClusterId, targetDir);

    shards.push({
      cluster_id: shardClusterId,
      domain: cluster.domain,
      title: `${cluster.title} (Shard ${shardNum})`,
      plan_path: shardPlanPath,
      backlog_item_ids: Object.freeze(shardItemIds),
      defect_ids: Object.freeze(shardDefectIds),
      planned_at: cluster.planned_at,
      description: `Disjoint partition shard ${shardNum} for ${cluster.domain} capacity control`,
    });

    shardNum++;
  }

  return shards;
}

export function partitionDisjointClusters(
  items: readonly RawBacklogItem[],
  defects: readonly RawDefectItem[],
  options?: ClusterOptions,
): readonly ThematicCluster[] {
  const rawClusters = clusterBacklogAndDefects(items, defects, options);
  if (rawClusters.length === 0) {
    return [];
  }

  const capacity =
    options !== undefined && options.singleOrchestratorCapacity !== undefined
      ? options.singleOrchestratorCapacity
      : options !== undefined && options.maxItemsPerCluster !== undefined
        ? options.maxItemsPerCluster
        : DEFAULT_SINGLE_ORCHESTRATOR_CAPACITY;

  const targetDir = options !== undefined ? options.targetDir : undefined;
  const partitionedClusters: ThematicCluster[] = [];

  for (const cluster of rawClusters) {
    const sharded = shardClusterByCapacity(cluster, capacity, targetDir);
    for (const s of sharded) {
      partitionedClusters.push(s);
    }
  }

  assertDisjointClusters(partitionedClusters);
  return Object.freeze(partitionedClusters);
}

import { join } from "node:path";
import type {
  MultiOrchestratorDispatchPlan,
  OrchestratorAllocationMetadata,
  OrchestratorWorktreeAllocation,
  ThematicCluster,
} from "../index.ts";

export interface ProvisioningOptions {
  readonly rootDir?: string | undefined;
  readonly worktreeBaseDir?: string | undefined;
  readonly timestamp?: string | undefined;
}

export function triggerOrchestratorWorktreeProvisioning(
  clusters: readonly ThematicCluster[],
  options?: ProvisioningOptions,
): readonly OrchestratorWorktreeAllocation[] {
  if (clusters.length < 2) {
    return [];
  }

  const root = options?.rootDir !== undefined ? options.rootDir : process.cwd();
  const baseWorktreeDir =
    options?.worktreeBaseDir !== undefined
      ? options.worktreeBaseDir
      : join(root, ".olt", "worktrees");
  const allocatedAt =
    options?.timestamp !== undefined ? options.timestamp : new Date().toISOString();

  const allocations: OrchestratorWorktreeAllocation[] = [];

  for (const cluster of clusters) {
    const slug = cluster.cluster_id.replace(/^cluster-/, "");
    const trackId = `orch-${cluster.domain}-${slug}`;
    const worktreePath = join(baseWorktreeDir, trackId);
    const capacity = cluster.backlog_item_ids.length + cluster.defect_ids.length;

    allocations.push({
      orchestrator_id: trackId,
      cluster_id: cluster.cluster_id,
      domain: cluster.domain,
      track_id: trackId,
      worktree_path: worktreePath,
      status: "PROVISIONED",
      assigned_cluster_ids: Object.freeze([cluster.cluster_id]),
      capacity,
      allocated_at: allocatedAt,
    });
  }

  return Object.freeze(allocations);
}

export function mapClustersToOrchestrators(
  clusters: readonly ThematicCluster[],
  allocations?: readonly OrchestratorWorktreeAllocation[],
): readonly OrchestratorAllocationMetadata[] {
  const allocationMap = new Map<string, OrchestratorWorktreeAllocation>();
  if (allocations !== undefined) {
    for (const alloc of allocations) {
      allocationMap.set(alloc.cluster_id, alloc);
    }
  }

  const mappings: OrchestratorAllocationMetadata[] = [];

  for (const cluster of clusters) {
    const slug = cluster.cluster_id.replace(/^cluster-/, "").replace(/[^a-zA-Z0-9_]/g, "_");
    const orchestratorId = `orchestrator_${cluster.domain}_${slug}`;
    const role = `orchestrator_${cluster.domain}`;
    const alloc = allocationMap.get(cluster.cluster_id);

    mappings.push({
      orchestrator_id: orchestratorId,
      role,
      cluster_count: 1,
      domain: cluster.domain,
      clusters: Object.freeze([cluster.cluster_id]),
      worktree_required: clusters.length >= 2,
      worktree_allocation: alloc,
    });
  }

  return Object.freeze(mappings);
}

export function dispatchMultiOrchestratorClusters(
  clusters: readonly ThematicCluster[],
  options?: ProvisioningOptions,
): MultiOrchestratorDispatchPlan {
  const allocations = triggerOrchestratorWorktreeProvisioning(clusters, options);
  const dispatchMappings = mapClustersToOrchestrators(clusters, allocations);

  return {
    cluster_count: clusters.length,
    orchestrator_count: dispatchMappings.length,
    worktrees_provisioned: allocations.length > 0,
    allocations,
    dispatch_mappings: dispatchMappings,
    disjoint: true,
  };
}

import type {
  DomainCategory,
  RawBacklogItem,
  RawDefectItem,
  ThematicCluster,
} from "../../olt/scripts/src/mind/preplanning/types.ts";

export function createTestBacklogItem(id: string, domain: string, title?: string): RawBacklogItem {
  return {
    id,
    title: title !== undefined ? title : `Item ${id}`,
    domain,
    status: "PENDING",
  };
}

export function createTestDefectItem(id: string, domain: string, title?: string): RawDefectItem {
  return {
    id,
    title: title !== undefined ? title : `Defect ${id}`,
    domain,
    status: "OPEN",
  };
}

export function createTestThematicCluster(
  cluster_id: string,
  domain: DomainCategory,
  backlog_item_ids: readonly string[] = [],
  defect_ids: readonly string[] = [],
): ThematicCluster {
  return {
    cluster_id,
    domain,
    title: `${domain} Test Cluster`,
    plan_path: `docs/planning/${cluster_id}/PLAN.md`,
    backlog_item_ids,
    defect_ids,
    planned_at: new Date().toISOString(),
  };
}

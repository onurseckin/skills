import { join } from "node:path";
import {
  clusterBacklogAndDefects,
  loadBacklogItems,
  loadDefectItems,
} from "./backlog-clusterer.ts";
import { resolveLedgerPath, updateBridgeState } from "./bridge-state.ts";
import { generateAndWritePlan, generatePlanMarkdown } from "./plan-factory.ts";
import type {
  ClusterOptions,
  PreplanningRunResult,
  RawBacklogItem,
  RawDefectItem,
  ThematicCluster,
} from "./types.ts";

export interface PreplannerOptions extends ClusterOptions {
  readonly rootDir?: string | undefined;
  readonly backlogFile?: string | undefined;
  readonly defectsFile?: string | undefined;
  readonly dryRun?: boolean | undefined;
  readonly explicitBacklog?: readonly RawBacklogItem[] | undefined;
  readonly explicitDefects?: readonly RawDefectItem[] | undefined;
}

export function isPreplanningNeeded(options?: PreplannerOptions): boolean {
  const root = options?.rootDir ?? process.cwd();
  const backlogPath = resolveLedgerPath(join(".olt", "backlog.jsonl"), options?.backlogFile, root);
  const defectsPath = resolveLedgerPath(join(".olt", "defects.jsonl"), options?.defectsFile, root);

  const backlogItems = options?.explicitBacklog ?? loadBacklogItems(backlogPath);
  const defectItems = options?.explicitDefects ?? loadDefectItems(defectsPath);

  const clusters = clusterBacklogAndDefects(backlogItems, defectItems, options);
  return clusters.length > 0;
}

export function runPreplanningTick(options?: PreplannerOptions): PreplanningRunResult {
  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  const root = options?.rootDir ?? process.cwd();
  const backlogPath = resolveLedgerPath(join(".olt", "backlog.jsonl"), options?.backlogFile, root);
  const defectsPath = resolveLedgerPath(join(".olt", "defects.jsonl"), options?.defectsFile, root);

  const backlogItems = options?.explicitBacklog ?? loadBacklogItems(backlogPath);
  const defectItems = options?.explicitDefects ?? loadDefectItems(defectsPath);

  const clusters = clusterBacklogAndDefects(backlogItems, defectItems, options);

  if (clusters.length === 0) {
    const completedAt = new Date().toISOString();
    return {
      clusters: [],
      items_planned: 0,
      defects_planned: 0,
      plan_files_written: [],
      started_at: startedAt,
      completed_at: completedAt,
      duration_ms: Date.now() - startMs,
    };
  }

  const writtenPlanFiles: string[] = [];
  let totalItemsPlanned = 0;
  let totalDefectsPlanned = 0;

  for (const cluster of clusters) {
    if (options?.dryRun) {
      writtenPlanFiles.push(cluster.plan_path);
      totalItemsPlanned += cluster.backlog_item_ids.length;
      totalDefectsPlanned += cluster.defect_ids.length;
    } else {
      const planResult = generateAndWritePlan(cluster, backlogItems, defectItems, root);
      writtenPlanFiles.push(planResult.planPath);

      const bridgeResult = updateBridgeState(cluster, {
        ...(options?.backlogFile !== undefined ? { backlogFile: options.backlogFile } : {}),
        ...(options?.defectsFile !== undefined ? { defectsFile: options.defectsFile } : {}),
        rootDir: root,
      });

      totalItemsPlanned += bridgeResult.itemsUpdated;
      totalDefectsPlanned += bridgeResult.defectsUpdated;
    }
  }

  const completedAt = new Date().toISOString();

  return {
    clusters,
    items_planned: totalItemsPlanned,
    defects_planned: totalDefectsPlanned,
    plan_files_written: Object.freeze(writtenPlanFiles),
    started_at: startedAt,
    completed_at: completedAt,
    duration_ms: Date.now() - startMs,
  };
}

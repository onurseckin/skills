import { join } from "node:path";
import {
  clusterBacklogAndDefects,
  loadBacklogItems,
  loadDefectItems,
} from "./backlog-clusterer.ts";
import { resolveLedgerPath, updateBridgeState } from "./bridge-state.ts";
import { generateAndWritePlan } from "./plan-factory.ts";
import type {
  ClusterOptions,
  PreplanningRunResult,
  RawBacklogItem,
  RawDefectItem,
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
  const root = options !== undefined && options.rootDir !== undefined ? options.rootDir : process.cwd();
  const customBacklog = options !== undefined ? options.backlogFile : undefined;
  const customDefects = options !== undefined ? options.defectsFile : undefined;

  const backlogPath = resolveLedgerPath(join(".olt", "backlog.jsonl"), customBacklog, root);
  const defectsPath = resolveLedgerPath(join(".olt", "defects.jsonl"), customDefects, root);

  const backlogItems =
    options !== undefined && options.explicitBacklog !== undefined
      ? options.explicitBacklog
      : loadBacklogItems(backlogPath);
  const defectItems =
    options !== undefined && options.explicitDefects !== undefined
      ? options.explicitDefects
      : loadDefectItems(defectsPath);

  const clusters = clusterBacklogAndDefects(backlogItems, defectItems, options);
  return clusters.length > 0;
}

export function runPreplanningTick(options?: PreplannerOptions): PreplanningRunResult {
  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  const root = options !== undefined && options.rootDir !== undefined ? options.rootDir : process.cwd();
  const customBacklog = options !== undefined ? options.backlogFile : undefined;
  const customDefects = options !== undefined ? options.defectsFile : undefined;

  const backlogPath = resolveLedgerPath(join(".olt", "backlog.jsonl"), customBacklog, root);
  const defectsPath = resolveLedgerPath(join(".olt", "defects.jsonl"), customDefects, root);

  const backlogItems =
    options !== undefined && options.explicitBacklog !== undefined
      ? options.explicitBacklog
      : loadBacklogItems(backlogPath);
  const defectItems =
    options !== undefined && options.explicitDefects !== undefined
      ? options.explicitDefects
      : loadDefectItems(defectsPath);

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
    if (options !== undefined && options.dryRun) {
      writtenPlanFiles.push(cluster.plan_path);
      totalItemsPlanned += cluster.backlog_item_ids.length;
      totalDefectsPlanned += cluster.defect_ids.length;
    } else {
      const planResult = generateAndWritePlan(cluster, backlogItems, defectItems, root);
      writtenPlanFiles.push(planResult.planPath);

      const bridgeResult = updateBridgeState(cluster, {
        ...(options !== undefined && options.backlogFile !== undefined ? { backlogFile: options.backlogFile } : {}),
        ...(options !== undefined && options.defectsFile !== undefined ? { defectsFile: options.defectsFile } : {}),
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

export const runContinuousPreplanningTick = runPreplanningTick;

export interface DaemonOptions extends PreplannerOptions {
  readonly intervalMs?: number | undefined;
  readonly maxTicks?: number | undefined;
}

export async function startPreplanningDaemon(
  options?: DaemonOptions | undefined,
): Promise<{ totalTicks: number; totalPlanned: number }> {
  const interval =
    options !== undefined && options.intervalMs !== undefined ? options.intervalMs : 5000;
  const maxTicks =
    options !== undefined && options.maxTicks !== undefined ? options.maxTicks : 1;
  let totalTicks = 0;
  let totalPlanned = 0;

  for (let i = 0; i < maxTicks; i++) {
    totalTicks++;
    const res = runPreplanningTick(options);
    totalPlanned += res.items_planned + res.defects_planned;
    if (i < maxTicks - 1) {
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }

  return { totalTicks, totalPlanned };
}

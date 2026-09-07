import { join } from "node:path";
import {
  filterEligibleBacklogItems,
  filterEligibleDefects,
  loadBacklogItems,
  loadDefectItems,
} from "./backlog-clusterer.ts";
import { partitionDisjointClusters } from "./cluster-partitioner.ts";
import { dispatchMultiOrchestratorClusters } from "./multi-orchestrator-dispatch.ts";
import { resolveLedgerPath, updateBridgeStateBatch } from "./bridge-state.ts";
import { generateAndWritePlan } from "./orchestration/index.ts";
import type {
  ClusterOptions,
  PreplanningRunResult,
  RawBacklogItem,
  RawDefectItem,
} from "./types.ts";
import {
  clusterTasks,
  provisionTaskClusters,
  type PlanTaskInput,
  type ProvisionedCluster,
  type TaskCluster,
} from "../planning/index.ts";
import type { CreateWorktreeOptions, TrackWorktreeInfo } from "../../workflow/worktree/index.ts";

export interface PreplannerOptions extends ClusterOptions {
  readonly rootDir?: string | undefined;
  readonly backlogFile?: string | undefined;
  readonly defectsFile?: string | undefined;
  readonly dryRun?: boolean | undefined;
  readonly explicitBacklog?: readonly RawBacklogItem[] | undefined;
  readonly explicitDefects?: readonly RawDefectItem[] | undefined;
  readonly maxTracks?: number | undefined;
  readonly baseBranch?: string | undefined;
  readonly provisionWorktrees?: boolean | undefined;
  readonly lockTimeoutMs?: number | undefined;
  readonly worktreeCreator?: ((options: CreateWorktreeOptions) => TrackWorktreeInfo) | undefined;
}

export function extractPlanTasksFromBacklog(
  items: readonly RawBacklogItem[],
  defects: readonly RawDefectItem[],
): readonly PlanTaskInput[] {
  const tasks: PlanTaskInput[] = [];
  for (const item of items) {
    const rawScope = item.write_scope ?? item.scope;
    const writeScope = Array.isArray(rawScope)
      ? (rawScope.filter((s): s is string => typeof s === "string") as readonly string[])
      : undefined;
    const rawDeps = item.dependencies;
    const dependencies = Array.isArray(rawDeps)
      ? (rawDeps.filter((d): d is string => typeof d === "string") as readonly string[])
      : undefined;
    tasks.push({
      id: item.id,
      title: typeof item.title === "string" ? item.title : item.id,
      write_scope: writeScope,
      dependencies,
    });
  }
  for (const defect of defects) {
    const rawScope = defect.write_scope ?? defect.scope;
    const writeScope = Array.isArray(rawScope)
      ? (rawScope.filter((s): s is string => typeof s === "string") as readonly string[])
      : undefined;
    const rawDeps = defect.dependencies;
    const dependencies = Array.isArray(rawDeps)
      ? (rawDeps.filter((d): d is string => typeof d === "string") as readonly string[])
      : undefined;
    tasks.push({
      id: defect.id,
      title: typeof defect.title === "string" ? defect.title : defect.id,
      write_scope: writeScope,
      dependencies,
    });
  }
  return Object.freeze(tasks);
}

export function clusterBacklogTasks(
  items: readonly RawBacklogItem[],
  defects: readonly RawDefectItem[],
  maxTracks: number = 5,
  options?: { readonly rootDir?: string | undefined },
): readonly TaskCluster[] {
  const eligibleItems = filterEligibleBacklogItems(items, options);
  const eligibleDefects = filterEligibleDefects(defects, options);
  const tasks = extractPlanTasksFromBacklog(eligibleItems, eligibleDefects);
  return clusterTasks(tasks, maxTracks);
}

export function provisionBacklogTracks(options: PreplannerOptions): readonly ProvisionedCluster[] {
  const root = options.rootDir !== undefined ? options.rootDir : process.cwd();
  const backlogPath = resolveLedgerPath(join(".olt", "backlog.jsonl"), options.backlogFile, root);
  const defectsPath = resolveLedgerPath(join(".olt", "defects.jsonl"), options.defectsFile, root);

  const backlogItems =
    options.explicitBacklog !== undefined ? options.explicitBacklog : loadBacklogItems(backlogPath);
  const defectItems =
    options.explicitDefects !== undefined ? options.explicitDefects : loadDefectItems(defectsPath);

  const eligibleItems = filterEligibleBacklogItems(backlogItems, { rootDir: root });
  const eligibleDefects = filterEligibleDefects(defectItems, { rootDir: root });
  const tasks = extractPlanTasksFromBacklog(eligibleItems, eligibleDefects);

  return provisionTaskClusters({
    repoRoot: root,
    tasks,
    maxTracks: options.maxTracks !== undefined ? options.maxTracks : 5,
    baseBranch: options.baseBranch,
    lockTimeoutMs: options.lockTimeoutMs,
    worktreeCreator: options.worktreeCreator,
  });
}

export function isPreplanningNeeded(options?: PreplannerOptions): boolean {
  const root =
    options !== undefined && options.rootDir !== undefined ? options.rootDir : process.cwd();
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

  const clusters = partitionDisjointClusters(backlogItems, defectItems, options);
  return clusters.length > 0;
}

export function runPreplanningTick(options?: PreplannerOptions): PreplanningRunResult {
  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  const root =
    options !== undefined && options.rootDir !== undefined ? options.rootDir : process.cwd();
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

  const eligibleItems = filterEligibleBacklogItems(backlogItems, { rootDir: root });
  const eligibleDefects = filterEligibleDefects(defectItems, { rootDir: root });
  const planTasks = extractPlanTasksFromBacklog(eligibleItems, eligibleDefects);
  const maxTracks =
    options !== undefined && options.maxTracks !== undefined ? options.maxTracks : 5;
  const taskClusters = planTasks.length > 0 ? clusterTasks(planTasks, maxTracks) : [];

  let provisionedClusters: readonly ProvisionedCluster[] | undefined;
  if (options !== undefined && options.provisionWorktrees && planTasks.length > 0) {
    provisionedClusters = provisionTaskClusters({
      repoRoot: root,
      tasks: planTasks,
      maxTracks,
      baseBranch: options.baseBranch,
      lockTimeoutMs: options.lockTimeoutMs,
      worktreeCreator: options.worktreeCreator,
    });
  }

  const clusters = partitionDisjointClusters(backlogItems, defectItems, options);

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
      task_clusters: [],
      ...(provisionedClusters !== undefined
        ? { provisioned_clusters: Object.freeze(provisionedClusters) }
        : {}),
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
    }
  }

  if (!(options !== undefined && options.dryRun)) {
    const bridgeResult = updateBridgeStateBatch(clusters, {
      ...(options !== undefined && options.backlogFile !== undefined
        ? { backlogFile: options.backlogFile }
        : {}),
      ...(options !== undefined && options.defectsFile !== undefined
        ? { defectsFile: options.defectsFile }
        : {}),
      rootDir: root,
    });
    totalItemsPlanned = bridgeResult.itemsUpdated;
    totalDefectsPlanned = bridgeResult.defectsUpdated;
  }

  const dispatchPlan = dispatchMultiOrchestratorClusters(clusters, {
    rootDir: root,
    worktreeBaseDir: options?.orchestratorWorktreeBaseDir,
  });

  const completedAt = new Date().toISOString();

  return {
    clusters,
    items_planned: totalItemsPlanned,
    defects_planned: totalDefectsPlanned,
    plan_files_written: Object.freeze(writtenPlanFiles),
    started_at: startedAt,
    completed_at: completedAt,
    duration_ms: Date.now() - startMs,
    multi_orchestrator_dispatch: dispatchPlan,
    orchestrator_worktrees: dispatchPlan.allocations,
    task_clusters: Object.freeze(taskClusters),
    ...(provisionedClusters !== undefined
      ? { provisioned_clusters: Object.freeze(provisionedClusters) }
      : {}),
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
  const maxTicks = options !== undefined && options.maxTicks !== undefined ? options.maxTicks : 1;
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

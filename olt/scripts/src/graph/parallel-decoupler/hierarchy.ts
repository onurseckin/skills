import { isRecord } from "../../requirements/predicates.ts";
import type { TaskScopeInput } from "../scope-analyzer.ts";
import {
  FAST_PATH_TASK_COUNT,
  MAX_LANES_PER_COORDINATOR,
  type CoordinatorPartition,
  type DynamicLaneTaskInput,
  type HierarchyScalingResult,
  type MultiCoordinatorPartitionOptions,
  type MultiCoordinatorWavePartitionResult,
  type SubagentDispatchFormatOptions,
  type SubagentDispatchItem,
} from "./types.ts";

export function isFastPathCompactionEligible(taskCount: number | readonly unknown[]): boolean {
  const count =
    typeof taskCount === "number" ? taskCount : Array.isArray(taskCount) ? taskCount.length : 0;
  return count === FAST_PATH_TASK_COUNT;
}

export function evaluateHierarchyScaling(options: {
  readonly taskCount: number | readonly unknown[];
  readonly waveLanes?: number | undefined;
  readonly multiStack?: boolean | undefined;
  readonly maxLanesPerCoordinator?: number | undefined;
  readonly domainCount?: number | undefined;
}): HierarchyScalingResult {
  const count =
    typeof options.taskCount === "number"
      ? options.taskCount
      : Array.isArray(options.taskCount)
        ? options.taskCount.length
        : 0;
  const maxLanes = options.maxLanesPerCoordinator ?? MAX_LANES_PER_COORDINATOR;
  const lanes =
    typeof options.waveLanes === "number" && options.waveLanes > 0 ? options.waveLanes : count;

  if (count === FAST_PATH_TASK_COUNT) {
    return {
      path: "fast_path_compaction",
      fastPath: true,
      isMultiCoordinator: false,
      requiredCoordinators: 0,
      maxLanesPerCoordinator: maxLanes,
      optimalLanes: 1,
      reason:
        "Fast-Path Compaction active: single task ($N = 1$) supervised directly by Orchestrator without coordinator middleman.",
    };
  }

  if (
    lanes > maxLanes ||
    options.multiStack ||
    (typeof options.domainCount === "number" && options.domainCount > 1)
  ) {
    const requiredCoordinators = Math.max(2, Math.ceil(lanes / maxLanes));
    return {
      path: "multi_coordinator_expansion",
      fastPath: false,
      isMultiCoordinator: true,
      requiredCoordinators,
      maxLanesPerCoordinator: maxLanes,
      optimalLanes: lanes,
      reason: `Multi-Coordinator Expansion active: ${lanes} parallel lane(s) partitioned across ${requiredCoordinators} specialized Tier 2 Coordinators (max ${maxLanes} lanes per coordinator).`,
    };
  }

  return {
    path: "standard_coordinator",
    fastPath: false,
    isMultiCoordinator: false,
    requiredCoordinators: 1,
    maxLanesPerCoordinator: maxLanes,
    optimalLanes: lanes,
    reason: `Standard Hierarchy active: single Tier 2 Coordinator managing ${lanes} wave lane(s) (<= ${maxLanes} lanes).`,
  };
}

export function inferStackOrDomain(filePathOrScope: string | readonly string[]): string {
  const items = typeof filePathOrScope === "string" ? [filePathOrScope] : filePathOrScope;
  for (const item of items) {
    const lower = item.toLowerCase();
    if (
      lower.endsWith(".tsx") ||
      lower.endsWith(".jsx") ||
      lower.endsWith(".css") ||
      lower.endsWith(".html") ||
      lower.endsWith(".svg") ||
      lower.includes("/ui/") ||
      lower.includes("/components/") ||
      lower.includes("/views/")
    )
      return "ui";
    if (lower.includes("/cli/") || lower.includes("/commands/") || lower.includes("/scripts/"))
      return "cli";
    if (
      lower.endsWith(".sql") ||
      lower.endsWith(".prisma") ||
      lower.includes("prisma") ||
      lower.includes("database") ||
      lower.includes("/db/") ||
      lower.startsWith("db/")
    )
      return "database";
    if (
      lower.includes("/mind/") ||
      lower.includes("/engine/") ||
      lower.includes("/core/") ||
      lower.includes("/graph/")
    )
      return "core";
    if (lower.endsWith(".py")) return "python";
    if (lower.endsWith(".rs")) return "rust";
    if (lower.endsWith(".go")) return "go";
    if (
      lower.endsWith(".ts") ||
      lower.endsWith(".mts") ||
      lower.endsWith(".cts") ||
      lower.endsWith(".js") ||
      lower.endsWith(".mjs")
    )
      return "typescript";
  }
  return "core";
}

export function partitionWaveCoordinators(
  tasks: readonly (DynamicLaneTaskInput | TaskScopeInput | string | Record<string, unknown>)[],
  options: MultiCoordinatorPartitionOptions = {},
): MultiCoordinatorWavePartitionResult {
  const maxLanes = options.maxLanesPerCoordinator ?? MAX_LANES_PER_COORDINATOR;
  const waveIdx = options.waveIndex ?? 1;
  if (tasks.length === 0) {
    return {
      waveIndex: waveIdx,
      totalLanes: 0,
      coordinatorCount: 0,
      partitions: [],
      isMultiCoordinator: false,
      summary: "Empty wave: 0 coordinators required.",
    };
  }

  const normalized = tasks.map((t, idx) => {
    let id = `task-${idx + 1}`;
    let scope: string[] = [];
    if (typeof t === "string") id = t;
    else if (isRecord(t)) {
      if (typeof t.id === "string" && t.id.trim()) id = t.id.trim();
      else if (typeof t.taskId === "string" && t.taskId.trim()) id = t.taskId.trim();
      if (Array.isArray(t.write_scope))
        scope = t.write_scope.filter((s): s is string => typeof s === "string");
      else if (Array.isArray(t.writeScope))
        scope = t.writeScope.filter((s): s is string => typeof s === "string");
    }
    const domainHint = options.domainHints?.[id];
    const domain = domainHint ?? inferStackOrDomain(scope.length > 0 ? scope : id);
    return { id, writeScope: scope, domain, originalIndex: idx };
  });

  const partitions: CoordinatorPartition[] = [];
  if (options.stackPartitioning) {
    const byDomain = new Map<string, typeof normalized>();
    for (const entry of normalized) {
      const list = byDomain.get(entry.domain) ?? [];
      list.push(entry);
      byDomain.set(entry.domain, list);
    }
    for (const [domain, domainEntries] of byDomain.entries()) {
      for (let i = 0; i < domainEntries.length; i += maxLanes) {
        const chunk = domainEntries.slice(i, i + maxLanes);
        const partIdx = Math.floor(i / maxLanes) + 1;
        const coordId =
          domainEntries.length <= maxLanes
            ? `coordinator_${domain}`
            : `coordinator_${domain}_part${partIdx}`;
        const coordName = `Coordinator [${domain.toUpperCase()}] (Wave ${waveIdx}${domainEntries.length > maxLanes ? ` Part ${partIdx}` : ""})`;
        const chunkScopes = new Set<string>();
        for (const c of chunk) {
          for (const s of c.writeScope) chunkScopes.add(s);
        }
        partitions.push({
          coordinatorId: coordId,
          coordinatorName: coordName,
          domainOrStack: domain,
          taskIds: chunk.map((c) => c.id),
          laneIndices: chunk.map((c) => c.originalIndex),
          writeScope: Array.from(chunkScopes),
        });
      }
    }
  } else {
    for (let i = 0; i < normalized.length; i += maxLanes) {
      const chunk = normalized.slice(i, i + maxLanes);
      const partIdx = Math.floor(i / maxLanes) + 1;
      const primaryDomain = chunk[0]?.domain ?? "core";
      const coordId =
        normalized.length <= maxLanes
          ? `coordinator_${primaryDomain}`
          : `coordinator_w${waveIdx}_c${partIdx}_${primaryDomain}`;
      const coordName = `Coordinator ${partIdx} [${primaryDomain}] (Lanes ${i + 1}-${Math.min(i + maxLanes, normalized.length)})`;
      const chunkScopes = new Set<string>();
      for (const c of chunk) {
        for (const s of c.writeScope) chunkScopes.add(s);
      }
      partitions.push({
        coordinatorId: coordId,
        coordinatorName: coordName,
        domainOrStack: primaryDomain,
        taskIds: chunk.map((c) => c.id),
        laneIndices: chunk.map((c) => c.originalIndex),
        writeScope: Array.from(chunkScopes),
      });
    }
  }

  const isMultiCoordinator = partitions.length > 1;
  const summary = isMultiCoordinator
    ? `Wave ${waveIdx}: ${normalized.length} parallel lanes partitioned across ${partitions.length} specialized Coordinators (max ${maxLanes} lanes per coordinator).`
    : `Wave ${waveIdx}: ${normalized.length} parallel lanes managed by single Coordinator (${partitions[0]?.coordinatorId ?? "coordinator_core"}).`;

  return {
    waveIndex: waveIdx,
    totalLanes: normalized.length,
    coordinatorCount: partitions.length,
    partitions,
    isMultiCoordinator,
    summary,
  };
}

export function formatParallelSubagentsDispatchArray(
  tasks: readonly (DynamicLaneTaskInput | TaskScopeInput | string | Record<string, unknown>)[],
  options: SubagentDispatchFormatOptions = {},
): readonly SubagentDispatchItem[] {
  const typeName = options.defaultTypeName ?? "self";
  const workspace = options.defaultWorkspace ?? "share";
  const prefix = options.rolePrefix ?? "Implementer Lane";

  return tasks.map((t, idx) => {
    let taskId = `task-${idx + 1}`;
    let label = `Task ${idx + 1}`;
    let prompt =
      options.basePromptTemplate ?? `Execute assigned task ${taskId} within disjoint write scope.`;
    if (typeof t === "string") {
      taskId = t;
      label = t;
    } else if (isRecord(t)) {
      const rec = t as Record<string, unknown>;
      if (typeof rec["id"] === "string" && rec["id"].trim()) taskId = rec["id"].trim();
      else if (typeof rec["taskId"] === "string" && rec["taskId"].trim())
        taskId = rec["taskId"].trim();
      if (typeof rec["label"] === "string" && rec["label"].trim()) label = rec["label"].trim();
      else if (typeof rec["title"] === "string" && rec["title"].trim()) label = rec["title"].trim();
      else label = taskId;
      if (
        typeof rec["zero_exploration_prompt"] === "string" &&
        rec["zero_exploration_prompt"].trim()
      ) {
        prompt = rec["zero_exploration_prompt"].trim();
      } else if (
        isRecord(rec["metadata"]) &&
        typeof (rec["metadata"] as Record<string, unknown>)["zero_exploration_1shot_brief"] ===
          "string"
      ) {
        prompt = String(
          (rec["metadata"] as Record<string, unknown>)["zero_exploration_1shot_brief"],
        ).trim();
      }
    }
    return {
      TypeName: typeName,
      Role: `${prefix} ${idx + 1}: ${label}`,
      Prompt: prompt,
      Workspace: workspace,
    };
  });
}

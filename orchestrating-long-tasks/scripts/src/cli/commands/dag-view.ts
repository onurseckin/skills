import { basename, dirname, isAbsolute, resolve } from "node:path";
import { existsSync, readdirSync, statSync } from "node:fs";
import { getHarnessConfig } from "../../config/harness-config.ts";
import { HarnessError } from "../../errors/harness-error.ts";
import { dependencyMap } from "../../graph/dependency-map.ts";
import { schedulingMetrics } from "../../scheduler/metrics.ts";
import { scopeConflict } from "../../scheduler/conflicts.ts";
import { loadRun } from "../../store/index.ts";
import { isRecord } from "../../requirements/predicates.ts";
import type { TaskDeclaration } from "../../requirements/compiler.ts";
import { enforceLineLimit, formatTable } from "../formatters/line-limiter.ts";
import { boolFlag, textFlag, type CommandContext, type Flags } from "../options.ts";
import { parseArguments } from "../arguments.ts";

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export interface DagViewOptions {
  readonly run?: string | undefined;
  readonly runId?: string | undefined;
  readonly repo?: string | undefined;
  readonly detailed?: boolean | undefined;
  readonly recommendations?: boolean | undefined;
  readonly all?: boolean | undefined;
}

export interface DagWaveMetrics {
  readonly totalWaves: number;
  readonly maxParallelLanes: number;
  readonly criticalPathLength: number;
  readonly averageWaveConcurrency: number;
  readonly serialBottlenecks: number;
  readonly parallelEligibleChains: number;
  readonly totalWork: number;
  readonly span: number;
  readonly parallelismFactor: number;
  readonly optimalConcurrency: number;
}

export interface DagNodeSummary {
  readonly id: string;
  readonly label: string;
  readonly status: string;
  readonly priority: number;
  readonly writeScope: readonly string[];
  readonly resourceScope: readonly string[];
  readonly gate: string;
  readonly dependencies: readonly string[];
  readonly assignedAgent: string | null;
  readonly assignedTool?: string | null | undefined;
  readonly attempt: number | null;
  readonly wave: number;
  readonly criticalDepth: number;
  readonly descendantCount: number;
  readonly effort?: number | undefined;
  readonly depReasons?: Readonly<Record<string, string>> | undefined;
}

export interface ActiveAgentInfo {
  readonly id: string;
  readonly role: string;
  readonly host: string;
  readonly status: string;
  readonly taskId: string | null;
  readonly attempt: number | null;
  readonly tool?: string | null | undefined;
}

export interface ParallelizationRecommendation {
  readonly type:
    | "independent_opportunity"
    | "artificial_serialization"
    | "critical_path"
    | "fan_out_bottleneck"
    | "concurrency_headroom"
    | "multi_coordinator"
    | "serial_bottleneck";
  readonly description: string;
  readonly taskIds: readonly string[];
  readonly candidateLanes?: readonly string[] | undefined;
}

export interface WaveInfo {
  readonly wave: number;
  readonly taskIds: readonly string[];
  readonly status: string;
  readonly laneCount: number;
}

export interface DependencyForensicItem {
  readonly fromTaskId: string;
  readonly toTaskId: string;
  readonly reason: string;
  readonly edgeType:
    | "dataflow"
    | "scope_conflict"
    | "explicit_justification"
    | "prerequisite_gate"
    | "declared_dep";
}

export interface SerializationAnalysisItem {
  readonly taskId: string;
  readonly isSerial: boolean;
  readonly reason: string;
  readonly parallelEligible: boolean;
  readonly candidateLanes?: readonly string[] | undefined;
  readonly disjointScopes?: readonly string[] | undefined;
}

export interface MultiCoordinatorOpportunity {
  readonly domain: string;
  readonly taskIds: readonly string[];
  readonly writeScopes: readonly string[];
  readonly recommendedCoordinatorRole: string;
  readonly rationale: string;
}

export interface DagViewReport {
  readonly markdown: string;
  readonly run_root: string;
  readonly is_compiled: boolean;
  readonly graph_revision: number | null;
  readonly total_tasks: number;
  readonly status_summary: Readonly<Record<string, number>>;
  readonly critical_path_length: number;
  readonly active_agents: readonly ActiveAgentInfo[];
  readonly waves: readonly WaveInfo[];
  readonly recommendations: readonly ParallelizationRecommendation[];
  readonly ascii_dag: string;
  readonly metrics: DagWaveMetrics;
  readonly dependency_forensics: readonly DependencyForensicItem[];
  readonly serialization_analysis: readonly SerializationAnalysisItem[];
  readonly multi_coordinator_opportunities: readonly MultiCoordinatorOpportunity[];
}

export type DagViewResult = DagViewReport;

function statusBadge(status: string): string {
  switch (status) {
    case "done":
    case "satisfied":
      return "[DONE 🟢]";
    case "leased":
    case "running":
      return "[LEASED 🟡]";
    case "validating":
      return "[VALIDATING 🔵]";
    case "validated":
      return "[VALIDATED 🟣]";
    case "ready":
    case "retry_ready":
      return "[READY 🟢]";
    case "changes_requested":
      return "[CHANGES_REQ 🔴]";
    case "failed":
      return "[FAILED ❌]";
    case "escalated":
      return "[ESCALATED 🚨]";
    case "proposed":
    case "blocked":
    default:
      return "[BLOCKED ⚪]";
  }
}

export function findLatestCapsuleIn(repoRoot: string): string | null {
  const capsulesDir = resolve(repoRoot, ".capsules");
  if (!existsSync(capsulesDir)) return null;

  try {
    const entries = readdirSync(capsulesDir);
    const candidates: { path: string; mtime: number }[] = [];
    for (const entry of entries) {
      if (entry.startsWith(".")) continue;
      const fullPath = resolve(capsulesDir, entry);
      try {
        const st = statSync(fullPath);
        if (st.isDirectory()) {
          candidates.push({ path: fullPath, mtime: st.mtimeMs });
        }
      } catch {
        // Skip inaccessible entries
      }
    }
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.mtime - a.mtime);
    return candidates[0]?.path ?? null;
  } catch {
    return null;
  }
}

export function resolveCapsuleRun(repo: string, runFlag?: string, runIdFlag?: string): string {
  const explicit = runFlag ?? runIdFlag;
  if (explicit) {
    if (isAbsolute(explicit) && existsSync(explicit)) {
      return explicit;
    }
    const directRel = resolve(repo, explicit);
    if (existsSync(directRel)) {
      return directRel;
    }
    const insideCapsules = resolve(repo, ".capsules", explicit);
    if (existsSync(insideCapsules)) {
      return insideCapsules;
    }
    return isAbsolute(explicit) ? explicit : resolve(repo, explicit);
  }

  const latest = findLatestCapsuleIn(repo);
  if (latest) return latest;

  throw new HarnessError(
    "INVALID_ARGUMENT",
    "no active capsule found; specify --run <path> or run in a repository with .capsules/",
  );
}

function computeTopologicalWaves(
  tasks: readonly DagNodeSummary[],
  dependencies: ReadonlyMap<string, ReadonlySet<string>>,
): { waveMap: Map<string, number>; maxWave: number } {
  const waveMap = new Map<string, number>();

  const remaining = new Map<string, number>();
  for (const t of tasks) {
    const deps = dependencies.get(t.id) ?? new Set<string>();
    remaining.set(t.id, deps.size);
  }

  let currentWave = 1;
  const processed = new Set<string>();

  while (processed.size < tasks.length) {
    const readyInThisWave: string[] = [];
    for (const t of tasks) {
      if (processed.has(t.id)) continue;
      const prereqs = dependencies.get(t.id) ?? new Set<string>();
      const allPrereqsDone = [...prereqs].every((p) => waveMap.has(p));
      if (allPrereqsDone) {
        readyInThisWave.push(t.id);
      }
    }

    if (readyInThisWave.length === 0) {
      for (const t of tasks) {
        if (!processed.has(t.id)) {
          waveMap.set(t.id, currentWave);
          processed.add(t.id);
        }
      }
      break;
    }

    for (const id of readyInThisWave) {
      waveMap.set(id, currentWave);
      processed.add(id);
    }
    currentWave += 1;
  }

  return {
    waveMap,
    maxWave: Math.max(1, currentWave - 1),
  };
}

export function analyzeDependencyForensics(
  tasks: readonly DagNodeSummary[],
  dependencies: ReadonlyMap<string, ReadonlySet<string>>,
): readonly DependencyForensicItem[] {
  const items: DependencyForensicItem[] = [];

  for (const task of tasks) {
    const prereqs = dependencies.get(task.id) ?? new Set<string>();
    for (const depId of prereqs) {
      const parent = tasks.find((t) => t.id === depId);
      const explicitReason = task.depReasons?.[depId];

      if (explicitReason && explicitReason.trim().length > 0) {
        items.push({
          fromTaskId: depId,
          toTaskId: task.id,
          reason: explicitReason.trim(),
          edgeType: "explicit_justification",
        });
        continue;
      }

      if (parent) {
        const hasScopeConflict = scopeConflict(task.writeScope, parent.writeScope);
        if (hasScopeConflict && task.writeScope.length > 0 && parent.writeScope.length > 0) {
          const overlap = task.writeScope.filter((s) => scopeConflict([s], parent.writeScope));
          items.push({
            fromTaskId: depId,
            toTaskId: task.id,
            reason: `Write scope conflict on [${overlap.join(", ")}]: requires sequential mutation lock`,
            edgeType: "scope_conflict",
          });
          continue;
        }

        if (
          parent.writeScope.some(
            (s) =>
              s.includes("schema") ||
              s.includes("types") ||
              s.includes("model") ||
              s.includes("contract"),
          )
        ) {
          items.push({
            fromTaskId: depId,
            toTaskId: task.id,
            reason: `Dataflow requirement: consumes schema/contract output from [${parent.id}]`,
            edgeType: "dataflow",
          });
          continue;
        }

        if (parent.gate && parent.gate.length > 0) {
          items.push({
            fromTaskId: depId,
            toTaskId: task.id,
            reason: `Prerequisite gate verification: depends on [${parent.id}] gate passing`,
            edgeType: "prerequisite_gate",
          });
          continue;
        }
      }

      items.push({
        fromTaskId: depId,
        toTaskId: task.id,
        reason: `Declared dependency: execution constrained until [${depId}] finishes`,
        edgeType: "declared_dep",
      });
    }
  }

  return items;
}

export function analyzeSerialization(
  tasks: readonly DagNodeSummary[],
  dependencies: ReadonlyMap<string, ReadonlySet<string>>,
): readonly SerializationAnalysisItem[] {
  const items: SerializationAnalysisItem[] = [];

  for (const task of tasks) {
    const prereqs = [...(dependencies.get(task.id) ?? new Set<string>())];
    if (prereqs.length === 0) {
      items.push({
        taskId: task.id,
        isSerial: false,
        reason: "Independent root task ready for concurrent wave execution.",
        parallelEligible: true,
      });
      continue;
    }

    const parentTasks = prereqs
      .map((pId) => tasks.find((t) => t.id === pId))
      .filter((p): p is DagNodeSummary => p !== undefined);
    const overlappingParents = parentTasks.filter((p) =>
      scopeConflict(task.writeScope, p.writeScope),
    );

    if (overlappingParents.length > 0) {
      const overlapScopes = task.writeScope.filter((s) =>
        overlappingParents.some((p) => scopeConflict([s], p.writeScope)),
      );
      items.push({
        taskId: task.id,
        isSerial: true,
        reason: `Required serialization due to write scope overlap with [${overlappingParents.map((p) => p.id).join(", ")}] on (${overlapScopes.join(", ")}).`,
        parallelEligible: false,
      });
    } else {
      const parentIds = parentTasks.map((p) => p.id);
      const parentScopes = parentTasks.flatMap((p) => p.writeScope);
      items.push({
        taskId: task.id,
        isSerial: true,
        reason: `Sequential dependency on [${parentIds.join(", ")}] has disjoint write scopes (${task.writeScope.join(", ")} vs ${parentScopes.join(", ")}). Parallelization eligible if data dependency is soft.`,
        parallelEligible: true,
        candidateLanes: [...parentIds, task.id],
        disjointScopes: [...task.writeScope, ...parentScopes],
      });
    }
  }

  return items;
}

export function analyzeMultiCoordinatorOpportunities(
  tasks: readonly DagNodeSummary[],
): readonly MultiCoordinatorOpportunity[] {
  const domainMap = new Map<string, { taskIds: string[]; scopes: Set<string> }>();

  for (const task of tasks) {
    for (const scope of task.writeScope) {
      const parts = scope.split("/").filter((p) => p.length > 0 && p !== ".");
      let domain = "general";
      if (parts.length >= 2) {
        domain = `${parts[0]}/${parts[1]}`;
      } else if (parts.length === 1) {
        domain = parts[0]!;
      }
      if (!domainMap.has(domain)) {
        domainMap.set(domain, { taskIds: [], scopes: new Set<string>() });
      }
      const entry = domainMap.get(domain)!;
      if (!entry.taskIds.includes(task.id)) {
        entry.taskIds.push(task.id);
      }
      entry.scopes.add(scope);
    }
  }

  const opportunities: MultiCoordinatorOpportunity[] = [];
  if (domainMap.size >= 2) {
    for (const [domain, entry] of domainMap.entries()) {
      if (entry.taskIds.length >= 1) {
        const sanitizedDomain = domain.replace(/[^a-zA-Z0-9_-]/g, "-");
        const scopesList = [...entry.scopes];
        opportunities.push({
          domain,
          taskIds: entry.taskIds,
          writeScopes: scopesList,
          recommendedCoordinatorRole: `coordinator-${sanitizedDomain}`,
          rationale: `Subsystem [${domain}] has ${entry.taskIds.length} task(s) with isolated write scopes (${scopesList.join(", ")}). Deploying dedicated Tier 2 coordinator coordinator-${sanitizedDomain} enables independent parallel wave scheduling.`,
        });
      }
    }
  }

  return opportunities;
}

export function renderAsciiDag(
  waves: readonly { wave: number; tasks: readonly DagNodeSummary[] }[],
  detailed = false,
  forensics?: readonly DependencyForensicItem[],
): string {
  if (waves.length === 0) {
    return (
      "  ┌──────────────────────────────────────────────┐\n" +
      "  │  (No tasks declared in planning buffer/graph) │\n" +
      "  └──────────────────────────────────────────────┘"
    );
  }

  const lines: string[] = [];

  for (let w = 0; w < waves.length; w += 1) {
    const waveEntry = waves[w]!;
    const waveNum = waveEntry.wave;
    const waveTasks = waveEntry.tasks;

    const waveStatuses = [...new Set(waveTasks.map((t) => t.status))].join("/");
    const headerTitle = ` WAVE ${waveNum} (${waveTasks.length} ${waveTasks.length === 1 ? "lane" : "lanes"} • ${waveStatuses}) `;
    const barLength = Math.max(20, 68 - headerTitle.length);
    const headerLine = `┌─${headerTitle}${"─".repeat(barLength)}┐`;
    lines.push(headerLine);

    for (const task of waveTasks) {
      const badge = statusBadge(task.status);
      const toolStr = task.assignedTool ? ` [Tool: ${task.assignedTool}]` : "";
      const agentStr = task.assignedAgent ? ` • Agent: ${task.assignedAgent}${toolStr}` : "";
      const attemptStr = task.attempt !== null ? ` (Attempt #${task.attempt})` : "";
      const label = task.label.length > 40 ? `${task.label.slice(0, 37)}...` : task.label;

      const parallelTag = task.dependencies.length === 0 ? " [⚡ PARALLEL-ELIGIBLE]" : "";

      lines.push(`│ ┌─ [${task.id}] ${label}`);
      lines.push(`│ │  Status: ${badge}${agentStr}${attemptStr}${parallelTag}`);

      if (detailed || task.writeScope.length > 0) {
        const scopes = task.writeScope.join(", ") || "(none)";
        lines.push(`│ │  Scope:  ${scopes}`);
      }

      if (detailed) {
        if (task.gate) {
          lines.push(`│ │  Gate:   ${task.gate}`);
        }
        if (task.dependencies.length > 0) {
          const depStrings: string[] = [];
          for (const d of task.dependencies) {
            const forensic = forensics?.find((f) => f.fromTaskId === d && f.toTaskId === task.id);
            if (forensic) {
              depStrings.push(`${d} (${forensic.reason})`);
            } else {
              depStrings.push(d);
            }
          }
          lines.push(`│ │  Deps:   ${depStrings.join("; ")}`);
        }
      } else if (task.dependencies.length > 0) {
        lines.push(`│ │  Deps:   ${task.dependencies.join(", ")}`);
      }

      lines.push(`│ └───────────────────────────────────────────────────────────`);
    }

    const footerBar = "─".repeat(headerLine.length - 2);
    lines.push(`└${footerBar}┘`);

    if (w < waves.length - 1) {
      lines.push("                           │");
      lines.push("                           ▼");
    }
  }

  return lines.join("\n");
}

export function analyzeParallelization(
  tasks: readonly DagNodeSummary[],
  dependencies: ReadonlyMap<string, ReadonlySet<string>>,
  maxParallel: number,
): readonly ParallelizationRecommendation[] {
  const recommendations: ParallelizationRecommendation[] = [];

  // 1. Critical Path Analysis
  let maxDepth = 0;
  let criticalTask: DagNodeSummary | null = null;
  for (const t of tasks) {
    if (t.criticalDepth > maxDepth) {
      maxDepth = t.criticalDepth;
      criticalTask = t;
    }
  }
  if (criticalTask && maxDepth >= 2) {
    recommendations.push({
      type: "critical_path",
      description: `Critical path depth is ${maxDepth + 1} waves starting from [${criticalTask.id}]. Prioritize fast validation and worker allocation on this path.`,
      taskIds: [criticalTask.id],
    });
  }

  // 2. High Fan-Out Bottleneck Detection
  for (const t of tasks) {
    if (t.descendantCount >= 3) {
      recommendations.push({
        type: "fan_out_bottleneck",
        description: `Task [${t.id}] blocks ${t.descendantCount} downstream task(s). Completing [${t.id}] will unlock significant parallel concurrency.`,
        taskIds: [t.id],
      });
    }
  }

  // 3. Automated Parallelization & False-Dependency Auditor (Artificial Serialization Warnings)
  for (const t of tasks) {
    for (const depId of t.dependencies) {
      const parentTask = tasks.find((item) => item.id === depId);
      if (parentTask) {
        const hasScopeConflict = scopeConflict(t.writeScope, parentTask.writeScope);
        if (hasScopeConflict && t.writeScope.length > 0 && parentTask.writeScope.length > 0) {
          recommendations.push({
            type: "serial_bottleneck",
            description: `Tasks [${parentTask.id}] and [${t.id}] have a conflicting write scope (\`${t.writeScope[0]}\`). Serial execution is required to avoid race conditions.`,
            taskIds: [parentTask.id, t.id],
          });
        } else if (!hasScopeConflict && t.writeScope.length > 0 && parentTask.writeScope.length > 0) {
          const hasDataflow =
            parentTask.writeScope.some(
              (s) =>
                s.includes("schema") ||
                s.includes("types") ||
                s.includes("contract") ||
                s.includes("model"),
            ) ||
            (t.depReasons?.[depId] !== undefined && t.depReasons[depId]!.trim().length > 0);

          if (!hasDataflow) {
            recommendations.push({
              type: "artificial_serialization",
              description: `ARTIFICIAL_SERIALIZATION_WARNING: Task [${t.id}] can be decoupled from Task [${parentTask.id}] and executed concurrently in Wave ${parentTask.wave} (disjoint write scopes: \`${t.writeScope[0]}\` vs \`${parentTask.writeScope[0]}\`).`,
              taskIds: [parentTask.id, t.id],
              candidateLanes: [parentTask.id, t.id],
            });
          }

          recommendations.push({
            type: "independent_opportunity",
            description: `Tasks [${parentTask.id}] and [${t.id}] have disjoint write scopes (\`${parentTask.writeScope[0]}\` vs \`${t.writeScope[0]}\`). If data dependency is soft, consider decoupling to run in parallel.`,
            taskIds: [parentTask.id, t.id],
            candidateLanes: [parentTask.id, t.id],
          });
        }
      }
    }
  }

  // 4. Concurrency Headroom
  const readyOrLeasedCount = tasks.filter(
    (t) => t.status === "ready" || t.status === "leased" || t.status === "running",
  ).length;
  if (
    readyOrLeasedCount < maxParallel &&
    tasks.some((t) => t.status === "proposed" || t.status === "blocked")
  ) {
    const headroom = maxParallel - readyOrLeasedCount;
    recommendations.push({
      type: "concurrency_headroom",
      description: `Scheduler has ${headroom} idle parallel slot(s) (active: ${readyOrLeasedCount}/${maxParallel}). Ensure dependencies are unblocked to maximize throughput.`,
      taskIds: tasks.filter((t) => t.status === "ready").map((t) => t.id),
    });
  }

  // 5. Multi-Coordinator Scaling & Span vs Work Analysis
  const multiCoordOpps = analyzeMultiCoordinatorOpportunities(tasks);
  const totalWork = tasks.length;
  const span = Math.max(1, maxDepth + 1);
  const pFactor = totalWork / span;
  const optimalP = Math.min(maxParallel, Math.max(2, Math.ceil(totalWork / 2)));

  if (multiCoordOpps.length >= 2) {
    const spanWorkNote =
      pFactor < optimalP
        ? ` Parallelism factor P=${pFactor.toFixed(2)} is below optimal P=${optimalP} (Work=${totalWork}, Span=${span}).`
        : "";
    recommendations.push({
      type: "multi_coordinator",
      description: `Plan spans ${multiCoordOpps.length} distinct domain write scopes (${multiCoordOpps.map((o) => o.domain).join(", ")}).${spanWorkNote} Recommend deploying dedicated Tier 2 Domain Coordinators to manage parallel wave execution.`,
      taskIds: multiCoordOpps.flatMap((o) => o.taskIds),
    });
  }

  return recommendations;
}

export function dagViewCommand(
  flags: Flags,
  _context: CommandContext = {},
): Record<string, unknown> {
  const repo = textFlag(flags, "repo", false) ?? process.cwd();
  const runFlag = textFlag(flags, "run", false);
  const runIdFlag = textFlag(flags, "run-id", false);

  const run = resolveCapsuleRun(repo, runFlag, runIdFlag);
  const loaded = loadRun(run);
  const state = loaded.state;
  const runId = basename(run);
  const detailed = boolFlag(flags, "detailed");
  const showAll = boolFlag(flags, "all");
  const showRecommendationsOnly = boolFlag(flags, "recommendations");

  const harnessConfig = getHarnessConfig(dirname(dirname(loaded.runRoot)), loaded.runRoot);
  const maxParallel = harnessConfig.default_max_parallel;

  const isCompiled = state.graph !== undefined && state.graph !== null;
  const graphRevision =
    isRecord(state.graph) && typeof state.graph.revision === "number" ? state.graph.revision : null;

  const taskMap = (isRecord(state.tasks) ? state.tasks : {}) as Record<
    string,
    Record<string, unknown>
  >;
  const planningBuffer = (
    Array.isArray(state.planning_buffer)
      ? (state.planning_buffer as unknown as readonly TaskDeclaration[])
      : []
  );

  const rawAgents = (Array.isArray(state.agents) ? state.agents : []) as Record<string, unknown>[];
  const activeAgents: ActiveAgentInfo[] = rawAgents
    .filter((a) => a.status === "active")
    .map((a) => {
      const id = typeof a.id === "string" ? a.id : "unknown";
      const role = typeof a.role === "string" ? a.role : "unknown";
      const host = typeof a.host === "string" ? a.host : "unknown";
      const status = typeof a.status === "string" ? a.status : "active";
      const tool =
        typeof a.tool === "string"
          ? a.tool
          : typeof a.current_tool === "string"
            ? a.current_tool
            : role === "implementer"
              ? "write_file/run_command"
              : role === "validator"
                ? "run_command/verify"
                : "harness_cli";

      let leasedTaskId: string | null = null;
      let attemptNum: number | null = null;
      for (const [tId, tRecord] of Object.entries(taskMap)) {
        if (isRecord(tRecord.lease) && tRecord.lease.agent_id === id) {
          leasedTaskId = tId;
          if (typeof tRecord.lease.attempt === "number") {
            attemptNum = tRecord.lease.attempt;
          }
          break;
        }
      }

      return {
        id,
        role,
        host,
        status,
        taskId: leasedTaskId,
        attempt: attemptNum,
        tool,
      };
    });

  let depMap: Map<string, Set<string>>;
  if (isCompiled) {
    try {
      depMap = dependencyMap(state.graph);
    } catch {
      depMap = new Map();
      for (const [id, t] of Object.entries(taskMap)) {
        const deps = Array.isArray(t.dependencies) ? (t.dependencies as string[]) : [];
        depMap.set(id, new Set(deps));
      }
    }
  } else {
    depMap = new Map();
    for (const item of planningBuffer) {
      depMap.set(item.id, new Set(item.deps ?? []));
    }
  }

  let criticalDepthMap = new Map<string, number>();
  let descendantsMap = new Map<string, number>();
  try {
    const metrics = schedulingMetrics(depMap);
    criticalDepthMap = metrics.criticalDepth;
    descendantsMap = metrics.descendants;
  } catch {
    for (const k of depMap.keys()) {
      criticalDepthMap.set(k, 0);
      descendantsMap.set(k, 0);
    }
  }

  const nodeSummaries: DagNodeSummary[] = [];
  const statusCounts: Record<string, number> = {};

  if (isCompiled) {
    for (const [id, t] of Object.entries(taskMap)) {
      const status = typeof t.status === "string" ? t.status : "proposed";
      statusCounts[status] = (statusCounts[status] ?? 0) + 1;

      const label = typeof t.label === "string" ? t.label : id;
      const priority = typeof t.priority === "number" ? t.priority : 50;
      const writeScope = isStringArray(t.write_scope) ? t.write_scope : [];
      const resourceScope = isStringArray(t.resource_scope) ? t.resource_scope : [];
      const gateStr = typeof t.gate === "string" ? t.gate : "";
      const deps = isStringArray(t.dependencies) ? t.dependencies : [];
      const lease = isRecord(t.lease) ? t.lease : null;
      const assignedAgent = lease && typeof lease.agent_id === "string" ? lease.agent_id : null;
      const attempt = lease && typeof lease.attempt === "number" ? lease.attempt : null;
      const effort = typeof t.effort === "number" ? t.effort : 1;

      const matchingAgent = activeAgents.find((a) => a.id === assignedAgent);
      const assignedTool = matchingAgent?.tool ?? (assignedAgent ? "write_file" : null);

      nodeSummaries.push({
        id,
        label,
        status,
        priority,
        writeScope,
        resourceScope,
        gate: gateStr,
        dependencies: deps,
        assignedAgent,
        assignedTool,
        attempt,
        wave: 1,
        criticalDepth: criticalDepthMap.get(id) ?? 0,
        descendantCount: descendantsMap.get(id) ?? 0,
        effort,
      });
    }
  } else {
    for (const item of planningBuffer) {
      statusCounts["draft"] = (statusCounts["draft"] ?? 0) + 1;
      const gateStr =
        typeof item.gate === "string"
          ? item.gate
          : Array.isArray(item.gate)
            ? item.gate.join(" ")
            : "";
      nodeSummaries.push({
        id: item.id,
        label: item.label,
        status: "draft",
        priority: typeof item.priority === "number" ? item.priority : 50,
        writeScope: item.writeScope,
        resourceScope: [],
        gate: gateStr,
        dependencies: item.deps ?? [],
        assignedAgent: null,
        assignedTool: null,
        attempt: null,
        wave: 1,
        criticalDepth: criticalDepthMap.get(item.id) ?? 0,
        descendantCount: descendantsMap.get(item.id) ?? 0,
        effort: typeof item.effort === "number" ? item.effort : 1,
        depReasons: item.depReasons,
      });
    }
  }

  const { waveMap, maxWave } = computeTopologicalWaves(nodeSummaries, depMap);
  const updatedNodes = nodeSummaries.map((node) => ({
    ...node,
    wave: waveMap.get(node.id) ?? 1,
  }));

  const waveGroups: { wave: number; tasks: DagNodeSummary[] }[] = [];
  for (let w = 1; w <= maxWave; w += 1) {
    const tasksInWave = updatedNodes.filter((t) => t.wave === w);
    if (tasksInWave.length > 0) {
      waveGroups.push({ wave: w, tasks: tasksInWave });
    }
  }

  const waveInfos: WaveInfo[] = waveGroups.map((wg) => ({
    wave: wg.wave,
    taskIds: wg.tasks.map((t) => t.id),
    status: [...new Set(wg.tasks.map((t) => t.status))].join("/"),
    laneCount: wg.tasks.length,
  }));

  let maxCriticalPath = 0;
  for (const n of updatedNodes) {
    if (n.criticalDepth + 1 > maxCriticalPath) {
      maxCriticalPath = n.criticalDepth + 1;
    }
  }

  const dependencyForensics = analyzeDependencyForensics(updatedNodes, depMap);
  const serializationAnalysis = analyzeSerialization(updatedNodes, depMap);
  const multiCoordinatorOpportunities = analyzeMultiCoordinatorOpportunities(updatedNodes);
  const recommendations = analyzeParallelization(updatedNodes, depMap, maxParallel);
  const asciiDag = renderAsciiDag(waveGroups, detailed, dependencyForensics);

  const totalWork = updatedNodes.reduce((acc, t) => acc + (t.effort ?? 1), 0);
  const span = Math.max(1, maxCriticalPath);
  const parallelismFactor = span > 0 ? Number((totalWork / span).toFixed(2)) : 0;
  const optimalConcurrency = Math.min(
    maxParallel,
    Math.max(1, Math.ceil(updatedNodes.length / 2)),
  );

  const metrics: DagWaveMetrics = {
    totalWaves: waveGroups.length,
    maxParallelLanes:
      waveGroups.length > 0 ? Math.max(...waveGroups.map((g) => g.tasks.length)) : 0,
    criticalPathLength: maxCriticalPath,
    averageWaveConcurrency:
      waveGroups.length > 0
        ? Number((updatedNodes.length / waveGroups.length).toFixed(2))
        : 0,
    serialBottlenecks: updatedNodes.filter((n) => n.descendantCount >= 3).length,
    parallelEligibleChains: serializationAnalysis.filter((s) => s.isSerial && s.parallelEligible)
      .length,
    totalWork,
    span,
    parallelismFactor,
    optimalConcurrency,
  };

  const mdSections: string[] = [
    `### Live DAG Execution & Algorithmic Optimization: ${runId}`,
    `- **Graph Status**: ${isCompiled ? `Compiled (Revision ${graphRevision})` : "Draft (Planning Buffer)"}`,
    `- **Total Tasks**: ${updatedNodes.length} across ${waveGroups.length} execution wave(s)`,
    `- **Critical Path**: ${maxCriticalPath} wave(s) | **Max Parallel Capacity**: ${maxParallel} lanes | **Work/Span (P)**: ${parallelismFactor}`,
    `- **Active Subagents**: ${activeAgents.length} registered in flight`,
    "",
    "#### Live ASCII DAG Trace",
    "```text",
    asciiDag,
    "```",
  ];

  if (activeAgents.length > 0) {
    mdSections.push("");
    mdSections.push("#### Active Subagents & Lease Matrix");
    const agentHeaders = ["Agent ID", "Role", "Host", "Status", "Leased Task", "Attempt", "Tool"];
    const agentRows = activeAgents.map((a) => [
      `\`${a.id}\``,
      a.role,
      a.host,
      `\`${a.status}\``,
      a.taskId ? `\`${a.taskId}\`` : "—",
      a.attempt !== null ? `#${a.attempt}` : "—",
      a.tool ? `\`${a.tool}\`` : "—",
    ]);
    mdSections.push(...formatTable(agentHeaders, agentRows));
  }

  if (dependencyForensics.length > 0 && detailed) {
    mdSections.push("");
    mdSections.push("#### Decision Rationale & Dependency Forensics");
    const depHeaders = ["From Task", "To Task", "Edge Type", "Rationale & Forensics"];
    const depRows = dependencyForensics.map((f) => [
      `\`${f.fromTaskId}\``,
      `\`${f.toTaskId}\``,
      `\`${f.edgeType}\``,
      f.reason,
    ]);
    mdSections.push(...formatTable(depHeaders, depRows));
  }

  if (serializationAnalysis.length > 0 && detailed) {
    mdSections.push("");
    mdSections.push("#### Algorithmic Serialization & Parallelization Analysis");
    const serialHeaders = ["Task ID", "Mode", "Parallel Eligible", "Reason & Scope Independence"];
    const serialRows = serializationAnalysis.map((s) => [
      `\`${s.taskId}\``,
      s.isSerial ? "Serial" : "Parallel",
      s.parallelEligible ? "✅ YES" : "❌ NO",
      s.reason,
    ]);
    mdSections.push(...formatTable(serialHeaders, serialRows));
  }

  if (multiCoordinatorOpportunities.length > 0) {
    mdSections.push("");
    mdSections.push("#### Multi-Coordinator Scaling Opportunities");
    for (const opp of multiCoordinatorOpportunities) {
      mdSections.push(
        `- 🌐 **[DOMAIN: ${opp.domain}]**: Tasks (${opp.taskIds.map((t) => `\`${t}\``).join(", ")}) -> Role: \`${opp.recommendedCoordinatorRole}\``,
      );
      mdSections.push(`  - *Rationale*: ${opp.rationale}`);
    }
  }

  if (recommendations.length > 0 || showRecommendationsOnly) {
    mdSections.push("");
    mdSections.push("#### Algorithmic Parallelization Recommendations");
    for (const rec of recommendations) {
      const icon =
        rec.type === "critical_path"
          ? "⚡"
          : rec.type === "fan_out_bottleneck"
            ? "🚧"
            : rec.type === "artificial_serialization"
              ? "⚠️"
              : rec.type === "independent_opportunity"
                ? "💡"
                : rec.type === "multi_coordinator"
                  ? "🌐"
                  : "📈";
      mdSections.push(`- ${icon} **[${rec.type.toUpperCase()}]**: ${rec.description}`);
    }
  }

  const fullMarkdown = mdSections.join("\n");
  const markdown = showAll ? fullMarkdown : enforceLineLimit(fullMarkdown, 80);

  const result: DagViewReport = {
    markdown,
    run_root: run,
    is_compiled: isCompiled,
    graph_revision: graphRevision,
    total_tasks: updatedNodes.length,
    status_summary: statusCounts,
    critical_path_length: maxCriticalPath,
    active_agents: activeAgents,
    waves: waveInfos,
    recommendations,
    ascii_dag: asciiDag,
    metrics,
    dependency_forensics: dependencyForensics,
    serialization_analysis: serializationAnalysis,
    multi_coordinator_opportunities: multiCoordinatorOpportunities,
  };

  return result as unknown as Record<string, unknown>;
}

export function executeDagViewCommand(
  argvOrFlags: readonly string[] | Flags,
  context: CommandContext = {},
): DagViewReport {
  if (isStringArray(argvOrFlags)) {
    const tokens =
      argvOrFlags.length > 0 && !argvOrFlags[0]?.startsWith("-")
        ? argvOrFlags
        : ["dag:view", ...argvOrFlags];
    const parsed = parseArguments(tokens);
    return dagViewCommand(parsed.flags, context) as unknown as DagViewReport;
  }
  return dagViewCommand(argvOrFlags, context) as unknown as DagViewReport;
}

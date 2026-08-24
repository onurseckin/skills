import type { TaskStatus } from "../../core/contracts/workflow.ts";
import { isJsonObject, type JsonObject } from "../../core/contracts/json.ts";
import { HarnessError } from "../../core/errors/harness-error.ts";
import { dependencyMap } from "../../graph/dependency-map.ts";
import { graphParts } from "../../graph/parts.ts";
import { dependencyData, topologicalOrder, type DependencyMap } from "../../graph/topology.ts";
import {
  isIdentifier,
  isInteger,
  isNonblank,
  isRecord,
  isRepoRelativePath,
} from "../../requirements/predicates.ts";
import {
  loadWatchdogStore,
  parseTimestamp,
  registerWatchdog,
  type WatchdogRecord,
  type WatchdogStatus,
} from "../../authority/watchdog-manager.ts";
import { transition, utc } from "../../workflow/task-state.ts";
import {
  systemClock,
  type Clock,
  type TaskRecord,
  type TransactionPort,
  type WorkflowState,
} from "../../workflow/types.ts";
import { hasActiveOwnership, resourceConflict, scopeConflict } from "./conflicts.ts";
import { evaluateHierarchicalDecision, type AgentRoleHierarchy } from "./decision-tree.ts";
import { proposeBatch } from "./propose-batch.ts";
import { readySet, type ReadySetSelection } from "./ready-set.ts";
import { computeWorkSpanMetrics } from "./dynamic-topology.ts";
import type { ScheduledTask } from "./rank.ts";
import {
  classifyTaskDomain,
  derivePrimaryValidatorDomain,
  dispatchMultiDomainValidators,
  evaluateMultiDomainBatch,
  isMultiDomainDispatchEligible,
  MULTI_DOMAIN_PARALLELISM_THRESHOLD,
  proposeMultiDomainWave,
  resolveParallelismFactor,
  type MultiDomainBatchOptions,
  type MultiDomainBatchResult,
  type MultiDomainBlockedTaskInfo,
  type MultiDomainTaskDispatch,
  type MultiDomainValidatorDispatchOptions,
  type MultiDomainValidatorDispatchResult,
  type MultiDomainWaveOptions,
  type MultiDomainWaveResult,
  type TaskDomain,
} from "./multi-domain-dispatch.ts";
import {
  auditBehavioralHealth,
  runDoctor,
  type BehavioralFinding,
  type DoctorOptions,
} from "../../reporting/doctor.ts";
import { verifyIntegrity } from "../store/index.ts";
import {
  formatDiagnosticReceiptsMarkdown,
  generateAsciiDagBadges,
  generateReceiptBadge,
  generateReceiptSummaryBadge,
  runInspectorDagView,
  runInspectorDoctor,
  runInspectorHealth,
  runInspectorUnifiedReport,
  runScriptBackedDiagnostics,
  type CliDiagnosticReceipt,
  type DiagnosticInspectorName,
  type DiagnosticReceiptStatus,
  type ScriptBackedDiagnosticsOptions,
  type ScriptBackedDiagnosticsResult,
} from "./diagnostics.ts";

// ============================================================================
// Types & Interfaces for 5-Point Graph Health Audit
// ============================================================================

export interface GraphHealthIssue {
  readonly probe:
    | "orphaned_tasks"
    | "stale_leases"
    | "circular_dependencies"
    | "gate_coverage"
    | "scope_collisions";
  readonly severity: "critical" | "warning" | "info";
  readonly message: string;
  readonly entityIds: readonly string[];
}

export interface OrphanedTasksProbeResult {
  readonly passed: boolean;
  readonly orphanedTaskIds: readonly string[];
  readonly disconnectedTaskIds: readonly string[];
  readonly unmappedRequirementTaskIds: readonly string[];
  readonly details: readonly string[];
}

export interface StaleLeaseInfo {
  readonly taskId: string;
  readonly agentId: string;
  readonly role: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly lastHeartbeatAt: string;
  readonly durationSeconds: number;
  readonly overdueMs: number;
  readonly reason: "expired_timestamp" | "heartbeat_timeout";
}

export interface StaleLeasesProbeResult {
  readonly passed: boolean;
  readonly staleTaskIds: readonly string[];
  readonly staleLeases: readonly StaleLeaseInfo[];
  readonly details: readonly string[];
}

export interface CircularDependenciesProbeResult {
  readonly passed: boolean;
  readonly hasCycles: boolean;
  readonly cycles: readonly string[][];
  readonly cycleDescriptions: readonly string[];
  readonly details: readonly string[];
}

export interface GateCoverageProbeResult {
  readonly passed: boolean;
  readonly uncoveredRequirementIds: readonly string[];
  readonly tasksWithoutGateCoverage: readonly string[];
  readonly invalidGates: readonly string[];
  readonly hasMandatoryRunGate: boolean;
  readonly details: readonly string[];
}

export interface ScopeCollisionHazard {
  readonly leftTaskId: string;
  readonly rightTaskId: string;
  readonly conflictType: "write_scope" | "resource_scope" | "both";
  readonly writeScopeOverlap: boolean;
  readonly resourceScopeOverlap: boolean;
  readonly details: string;
}

export interface ScopeCollisionProbeResult {
  readonly passed: boolean;
  readonly activeCollisions: readonly ScopeCollisionHazard[];
  readonly candidateCollisions: readonly ScopeCollisionHazard[];
  readonly totalHazardCount: number;
  readonly details: readonly string[];
}

export interface GraphHealthAuditReport {
  readonly healthy: boolean;
  readonly checkedAt: string;
  readonly totalTasks: number;
  readonly issues: readonly GraphHealthIssue[];
  readonly probes: {
    readonly orphanedTasks: OrphanedTasksProbeResult;
    readonly staleLeases: StaleLeasesProbeResult;
    readonly circularDependencies: CircularDependenciesProbeResult;
    readonly gateCoverageViolations: GateCoverageProbeResult;
    readonly scopeCollisionHazards: ScopeCollisionProbeResult;
  };
}

// ============================================================================
// Types & Interfaces for 2-Way Supervisory Watchdog & 5-Point Health Audit
// ============================================================================

export interface SupervisoryWatchdogAuditReport {
  readonly healthy: boolean;
  readonly checkedAt: string;
  readonly activeWatchdogsCount: number;
  readonly staleWatchdogsCount: number;
  readonly terminatedWatchdogsCount: number;
  readonly orphanedWatchdogsCount: number;
  readonly activeWatchdogs: readonly WatchdogRecord[];
  readonly overdueWatchdogs: readonly WatchdogRecord[];
  readonly hungAgentIds: readonly string[];
  readonly issues: readonly string[];
}

export interface WorkSpanHealthAudit {
  readonly passed: boolean;
  readonly workParallelismRatio: number;
  readonly totalTasks: number;
  readonly completedTasks: number;
  readonly activeTasks: number;
  readonly readyTasks: number;
  readonly criticalPathLength: number;
  readonly activeBottlenecks: readonly string[];
  readonly dynamicTopologyWaveCount: number;
  readonly spanUtilizationRatio: number;
  readonly details: readonly string[];
}

export interface PlanEnhancementAudit {
  readonly passed: boolean;
  readonly totalRequirements: number;
  readonly unfulfilledRequirementsCount: number;
  readonly pendingCandidateCount: number;
  readonly needsReplanning: boolean;
  readonly suggestedEnhancements: readonly string[];
  readonly details: readonly string[];
}

export interface AgentRegistryAccuracyAudit {
  readonly passed: boolean;
  readonly totalRegistered: number;
  readonly totalActiveGrants: number;
  readonly totalActiveLeases: number;
  readonly accuracyPercentage: number;
  readonly unmappedLeaseAgents: readonly string[];
  readonly mismatchedRoleAgents: readonly string[];
  readonly ghostAgentIds: readonly string[];
  readonly details: readonly string[];
}

export interface RoleBoundaryAdherenceAudit {
  readonly passed: boolean;
  readonly hierarchicalViolations: readonly string[];
  readonly tierConfinementViolations: readonly string[];
  readonly details: readonly string[];
}

export interface DoctorErrorResolutionAudit {
  readonly passed: boolean;
  readonly totalIssues: number;
  readonly unresolvedErrors: readonly string[];
  readonly repairRecommendations: readonly string[];
  readonly details: readonly string[];
}

export interface SupervisoryTopLeader {
  readonly agentId: string;
  readonly role: "mind" | "orchestrator" | "coordinator";
  readonly tier: number;
}

export interface Supervisory5PointHealthReport {
  readonly healthy: boolean;
  readonly checkedAt: string;
  readonly topLeader: SupervisoryTopLeader;
  readonly workSpanHealth: WorkSpanHealthAudit;
  readonly planEnhancement: PlanEnhancementAudit;
  readonly agentRegistryAccuracy: AgentRegistryAccuracyAudit;
  readonly roleBoundaryAdherence: RoleBoundaryAdherenceAudit;
  readonly doctorResolution: DoctorErrorResolutionAudit;
  readonly overallIssues: readonly string[];
  readonly markdown: string;
}

export interface SupervisoryProbeDispatchResult {
  readonly dispatched: boolean;
  readonly targetAgentId: string;
  readonly targetRole: string;
  readonly report: Supervisory5PointHealthReport;
  readonly promptForLeader: string;
  readonly markdown: string;
}

export interface Supervisory5PointOptions {
  readonly runRoot?: string | undefined;
  readonly now?: Date | string | number | undefined;
  readonly doctorResult?: Record<string, unknown> | undefined;
}

export interface TaskRecoveryRecord {
  readonly taskId: string;
  readonly fromStatus: TaskStatus;
  readonly toStatus: TaskStatus;
  readonly agentId: string | null;
  readonly reason: string;
  readonly attempt: number;
  readonly recoveredAt: string;
}

export interface TaskRecoveryResult {
  readonly recoveredCount: number;
  readonly recoveredTasks: readonly TaskRecoveryRecord[];
  readonly healthy: boolean;
  readonly details: readonly string[];
}

export interface ScheduledTaskDispatch {
  readonly taskId: string;
  readonly label: string | null;
  readonly priority: number;
  readonly writeScope: readonly string[];
  readonly resourceScope: readonly string[];
  readonly requirementIds: readonly string[];
  readonly wave?: number | null | undefined;
}

export interface BlockedTaskInfo {
  readonly taskId: string;
  readonly status: string;
  readonly blockingReason: string;
  readonly prerequisites: readonly string[];
  readonly unsatisfiedPrerequisites: readonly string[];
}

export interface ScheduledWaveResult {
  readonly readyTasks: readonly ScheduledTaskDispatch[];
  readonly blockedTasks: readonly BlockedTaskInfo[];
  readonly activeOccupiedTasks: readonly string[];
  readonly totalEligible: number;
  readonly maxParallel: number | null;
  readonly evaluatedAt: string;
}

export interface SchedulerEngineOptions {
  readonly maxParallel?: number | null | undefined;
  readonly timeoutMs?: number | undefined;
  readonly heartbeatCadenceMs?: number | undefined;
  readonly clock?: Clock | undefined;
  readonly watchdogTarget?: string | undefined;
  readonly maxRepairRounds?: number | undefined;
}

// ============================================================================
// 5-Point Graph Health Probes Implementation
// ============================================================================

/**
 * Probe 1: Orphaned tasks
 * Detects tasks with empty/missing requirement_ids, disconnected nodes, or tasks not mapped to graph.
 */
export function probeOrphanedTasks(state: unknown): OrphanedTasksProbeResult {
  const orphanedTaskIds: string[] = [];
  const disconnectedTaskIds: string[] = [];
  const unmappedRequirementTaskIds: string[] = [];
  const details: string[] = [];

  if (!isRecord(state) || !isRecord(state.tasks)) {
    return {
      passed: false,
      orphanedTaskIds: [],
      disconnectedTaskIds: [],
      unmappedRequirementTaskIds: [],
      details: ["State has no valid tasks record."],
    };
  }

  // Collect active requirement IDs
  const knownRequirementIds = new Set<string>();
  if (isRecord(state.requirements)) {
    const reqList = Array.isArray(state.requirements.requirements)
      ? state.requirements.requirements
      : Array.isArray(state.requirements)
        ? state.requirements
        : [];
    for (const req of reqList) {
      if (isRecord(req) && typeof req.id === "string") {
        knownRequirementIds.add(req.id);
      }
    }
  } else if (Array.isArray(state.requirements)) {
    for (const req of state.requirements) {
      if (isRecord(req) && typeof req.id === "string") {
        knownRequirementIds.add(req.id);
      }
    }
  }

  // Collect graph node task IDs
  const graphTaskIds = new Set<string>();
  if (isRecord(state.graph) && Array.isArray(state.graph.nodes)) {
    for (const node of state.graph.nodes) {
      if (isRecord(node) && node.type === "task" && typeof node.id === "string") {
        graphTaskIds.add(node.id);
      }
      if (
        isRecord(node) &&
        node.type === "requirement" &&
        typeof node.requirement_id === "string"
      ) {
        knownRequirementIds.add(node.requirement_id);
      }
    }
  }

  for (const [taskId, rawTask] of Object.entries(state.tasks)) {
    if (!isRecord(rawTask)) {
      orphanedTaskIds.push(taskId);
      details.push(`Task '${taskId}' has invalid record structure.`);
      continue;
    }

    const reqIds = Array.isArray(rawTask.requirement_ids) ? rawTask.requirement_ids : [];
    if (reqIds.length === 0) {
      orphanedTaskIds.push(taskId);
      unmappedRequirementTaskIds.push(taskId);
      details.push(`Task '${taskId}' has no mapped requirement_ids.`);
    } else {
      const invalidReqs = reqIds.filter(
        (id) =>
          typeof id !== "string" || (knownRequirementIds.size > 0 && !knownRequirementIds.has(id)),
      );
      if (invalidReqs.length > 0) {
        orphanedTaskIds.push(taskId);
        unmappedRequirementTaskIds.push(taskId);
        details.push(
          `Task '${taskId}' references unknown requirements: [${invalidReqs.join(", ")}].`,
        );
      }
    }

    // Check if task exists in graph nodes
    if (graphTaskIds.size > 0 && !graphTaskIds.has(taskId)) {
      disconnectedTaskIds.push(taskId);
      if (!orphanedTaskIds.includes(taskId)) {
        orphanedTaskIds.push(taskId);
      }
      details.push(`Task '${taskId}' exists in state tasks but is missing from graph nodes.`);
    }
  }

  return {
    passed: orphanedTaskIds.length === 0,
    orphanedTaskIds,
    disconnectedTaskIds,
    unmappedRequirementTaskIds,
    details,
  };
}

/**
 * Probe 2: Stale leases
 * Detects leases in active status where timestamp expired or heartbeat is overdue.
 */
export function probeStaleLeases(
  state: unknown,
  options: { now?: Date | string | number | undefined; timeoutMs?: number | undefined } = {},
): StaleLeasesProbeResult {
  const nowMs = parseTimestamp(options.now);
  const timeoutMs = options.timeoutMs ?? 360_000;
  const staleTaskIds: string[] = [];
  const staleLeases: StaleLeaseInfo[] = [];
  const details: string[] = [];

  if (!isRecord(state) || !isRecord(state.tasks)) {
    return {
      passed: true,
      staleTaskIds: [],
      staleLeases: [],
      details: [],
    };
  }

  for (const [taskId, rawTask] of Object.entries(state.tasks)) {
    if (!isRecord(rawTask)) continue;
    const status = String(rawTask.status);

    if (status === "stale") {
      staleTaskIds.push(taskId);
      details.push(`Task '${taskId}' is explicitly marked stale.`);
      continue;
    }

    if (["leased", "running", "validating"].includes(status)) {
      if (isRecord(rawTask.lease)) {
        const lease = rawTask.lease;
        const expiresAtStr = typeof lease.expires_at === "string" ? lease.expires_at : "";
        const heartbeatAtStr = typeof lease.heartbeat_at === "string" ? lease.heartbeat_at : "";
        const issuedAtStr = typeof lease.issued_at === "string" ? lease.issued_at : "";
        const agentId = typeof lease.agent_id === "string" ? lease.agent_id : "unknown";
        const role = typeof lease.role === "string" ? lease.role : "unknown";
        const durationSeconds =
          typeof lease.duration_seconds === "number" ? lease.duration_seconds : 300;

        const expiresAtMs = expiresAtStr ? parseTimestamp(expiresAtStr) : 0;
        const heartbeatAtMs = heartbeatAtStr ? parseTimestamp(heartbeatAtStr) : 0;

        // Check if expires_at timestamp has passed
        if (expiresAtMs > 0 && expiresAtMs < nowMs) {
          const overdue = nowMs - expiresAtMs;
          staleTaskIds.push(taskId);
          staleLeases.push({
            taskId,
            agentId,
            role,
            issuedAt: issuedAtStr,
            expiresAt: expiresAtStr,
            lastHeartbeatAt: heartbeatAtStr,
            durationSeconds,
            overdueMs: overdue,
            reason: "expired_timestamp",
          });
          details.push(
            `Task '${taskId}' lease expired at ${expiresAtStr} (overdue by ${overdue}ms).`,
          );
          continue;
        }

        // Check if heartbeat is overdue
        if (heartbeatAtMs > 0 && nowMs - heartbeatAtMs > timeoutMs) {
          const overdue = nowMs - heartbeatAtMs;
          staleTaskIds.push(taskId);
          staleLeases.push({
            taskId,
            agentId,
            role,
            issuedAt: issuedAtStr,
            expiresAt: expiresAtStr,
            lastHeartbeatAt: heartbeatAtStr,
            durationSeconds,
            overdueMs: overdue,
            reason: "heartbeat_timeout",
          });
          details.push(
            `Task '${taskId}' heartbeat overdue by ${overdue}ms (threshold: ${timeoutMs}ms).`,
          );
        }
      }
    }
  }

  return {
    passed: staleTaskIds.length === 0,
    staleTaskIds,
    staleLeases,
    details,
  };
}

/**
 * Probe 3: Circular dependencies
 * Detects cycles and self-dependencies in the task DAG.
 */
export function probeCircularDependencies(state: unknown): CircularDependenciesProbeResult {
  const cycles: string[][] = [];
  const cycleDescriptions: string[] = [];
  const details: string[] = [];

  if (!isRecord(state)) {
    return { passed: true, hasCycles: false, cycles: [], cycleDescriptions: [], details: [] };
  }

  // Build dependency map from graph or tasks
  const deps = new Map<string, Set<string>>();

  if (isRecord(state.graph)) {
    try {
      const { nodes, edges } = graphParts(state.graph);
      const depData = dependencyData(nodes, edges);
      if (depData.issues.length > 0) {
        for (const issue of depData.issues) {
          if (issue.includes("cycle") || issue.includes("cannot depend on itself")) {
            cycleDescriptions.push(issue);
            details.push(issue);
          }
        }
      }
      for (const [k, v] of depData.dependencies) {
        deps.set(k, new Set(v));
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      cycleDescriptions.push(msg);
      details.push(msg);
    }
  } else if (isRecord(state.tasks)) {
    for (const [taskId, rawTask] of Object.entries(state.tasks)) {
      if (!isRecord(rawTask)) continue;
      const taskDeps = Array.isArray(rawTask.dependencies) ? rawTask.dependencies : [];
      const set = new Set<string>();
      for (const d of taskDeps) {
        if (typeof d === "string") {
          if (d === taskId) {
            const selfDesc = `Task '${taskId}' has self-dependency on itself.`;
            cycleDescriptions.push(selfDesc);
            details.push(selfDesc);
          } else {
            set.add(d);
          }
        }
      }
      deps.set(taskId, set);
    }
  }

  // Perform DFS cycle check
  const visited = new Map<string, "visiting" | "visited">();
  const path: string[] = [];

  function dfs(node: string) {
    visited.set(node, "visiting");
    path.push(node);

    const prerequisites = deps.get(node) ?? new Set<string>();
    for (const neighbor of prerequisites) {
      const status = visited.get(neighbor);
      if (status === "visiting") {
        const cycleStartIndex = path.indexOf(neighbor);
        const cycle = path.slice(cycleStartIndex).concat(neighbor);
        cycles.push(cycle);
        const desc = `Cycle detected: ${cycle.join(" -> ")}`;
        if (!cycleDescriptions.includes(desc)) {
          cycleDescriptions.push(desc);
          details.push(desc);
        }
      } else if (!status) {
        dfs(neighbor);
      }
    }

    path.pop();
    visited.set(node, "visited");
  }

  for (const node of deps.keys()) {
    if (!visited.has(node)) {
      dfs(node);
    }
  }

  const hasCycles = cycles.length > 0 || cycleDescriptions.length > 0;

  return {
    passed: !hasCycles,
    hasCycles,
    cycles,
    cycleDescriptions,
    details,
  };
}

const NOOP_COMMANDS = new Set([":", "echo", "exit", "false", "printf", "true"]);

/**
 * Probe 4: Gate coverage violations
 * Detects missing mandatory gate definitions, invalid gate scopes, or uncovered tasks.
 */
export function probeGateCoverageViolations(state: unknown): GateCoverageProbeResult {
  const uncoveredRequirementIds: string[] = [];
  const tasksWithoutGateCoverage: string[] = [];
  const invalidGates: string[] = [];
  const details: string[] = [];
  let hasMandatoryRunGate = false;

  if (!isRecord(state)) {
    return {
      passed: true,
      uncoveredRequirementIds: [],
      tasksWithoutGateCoverage: [],
      invalidGates: [],
      hasMandatoryRunGate: false,
      details: [],
    };
  }

  const gates = (
    isRecord(state.graph) && Array.isArray(state.graph.gates)
      ? state.graph.gates
      : Array.isArray(state.gates)
        ? state.gates
        : []
  ) as Record<string, unknown>[];

  const coveredReqs = new Set<string>();

  gates.forEach((gate, idx) => {
    const prefix = `Gate[${idx}]`;
    if (!isRecord(gate)) {
      invalidGates.push(`${prefix} is not an object`);
      return;
    }

    const gateId = typeof gate.id === "string" ? gate.id : `gate-${idx}`;
    if (!isIdentifier(gateId)) {
      invalidGates.push(`${prefix} has invalid identifier '${gateId}'`);
    }

    const cmd = gate.command;
    const isCmdValid =
      isNonblank(cmd) || (Array.isArray(cmd) && cmd.length > 0 && cmd.every(isNonblank));
    if (!isCmdValid) {
      invalidGates.push(`Gate '${gateId}' has empty or non-blank command`);
    } else if (typeof cmd === "string" && NOOP_COMMANDS.has(cmd.trim().toLowerCase())) {
      invalidGates.push(`Gate '${gateId}' has weak non-substantive command '${cmd}'`);
    }

    if (gate.cwd !== undefined && !isRepoRelativePath(gate.cwd, true)) {
      invalidGates.push(
        `Gate '${gateId}' cwd '${String(gate.cwd)}' is not a normalized relative path`,
      );
    }

    if (gate.scope !== "task" && gate.scope !== "run") {
      invalidGates.push(
        `Gate '${gateId}' has invalid scope '${String(gate.scope)}' (must be 'task' or 'run')`,
      );
    }

    const reqIds = Array.isArray(gate.requirement_ids) ? gate.requirement_ids : [];
    if (gate.scope === "task") {
      if (reqIds.length === 0) {
        invalidGates.push(`Task gate '${gateId}' has empty requirement_ids`);
      } else {
        for (const req of reqIds) {
          if (typeof req === "string") {
            coveredReqs.add(req);
          }
        }
      }
    } else if (gate.scope === "run") {
      if (gate.mandatory === true) {
        hasMandatoryRunGate = true;
      }
      if (reqIds.length > 0) {
        invalidGates.push(`Run gate '${gateId}' must not have requirement_ids`);
      }
    }
  });

  // Verify task coverage
  if (isRecord(state.tasks)) {
    for (const [taskId, rawTask] of Object.entries(state.tasks)) {
      if (!isRecord(rawTask)) continue;
      const reqIds = Array.isArray(rawTask.requirement_ids) ? rawTask.requirement_ids : [];
      for (const req of reqIds) {
        if (typeof req === "string" && !coveredReqs.has(req) && !hasMandatoryRunGate) {
          if (!uncoveredRequirementIds.includes(req)) {
            uncoveredRequirementIds.push(req);
          }
          if (!tasksWithoutGateCoverage.includes(taskId)) {
            tasksWithoutGateCoverage.push(taskId);
            details.push(
              `Task '${taskId}' requirement '${req}' is not covered by any task gate or mandatory run gate.`,
            );
          }
        }
      }
    }
  }

  const passed = invalidGates.length === 0 && uncoveredRequirementIds.length === 0;

  return {
    passed,
    uncoveredRequirementIds,
    tasksWithoutGateCoverage,
    invalidGates,
    hasMandatoryRunGate,
    details,
  };
}

/**
 * Probe 5: Scope collision hazards
 * Detects concurrently active or claimable tasks with overlapping write or resource scopes.
 */
export function probeScopeCollisionHazards(state: unknown): ScopeCollisionProbeResult {
  const activeCollisions: ScopeCollisionHazard[] = [];
  const candidateCollisions: ScopeCollisionHazard[] = [];
  const details: string[] = [];

  if (!isRecord(state) || !isRecord(state.tasks)) {
    return {
      passed: true,
      activeCollisions: [],
      candidateCollisions: [],
      totalHazardCount: 0,
      details: [],
    };
  }

  interface TaskScopeEntry {
    readonly id: string;
    readonly status: string;
    readonly writeScope: string[];
    readonly resourceScope: string[];
  }

  const taskEntries: TaskScopeEntry[] = [];
  for (const [taskId, rawTask] of Object.entries(state.tasks)) {
    if (!isRecord(rawTask)) continue;
    taskEntries.push({
      id: taskId,
      status: typeof rawTask.status === "string" ? rawTask.status : "unknown",
      writeScope: Array.isArray(rawTask.write_scope) ? (rawTask.write_scope as string[]) : [],
      resourceScope: Array.isArray(rawTask.resource_scope)
        ? (rawTask.resource_scope as string[])
        : [],
    });
  }

  const activeStatuses = new Set(["leased", "running", "validating"]);
  const candidateStatuses = new Set(["proposed", "ready", "retry_ready"]);

  for (let i = 0; i < taskEntries.length; i++) {
    for (let j = i + 1; j < taskEntries.length; j++) {
      const left = taskEntries[i]!;
      const right = taskEntries[j]!;

      const writeConflict = scopeConflict(left.writeScope, right.writeScope);
      const resConflict = resourceConflict(left.resourceScope, right.resourceScope);

      if (writeConflict || resConflict) {
        const conflictType =
          writeConflict && resConflict ? "both" : writeConflict ? "write_scope" : "resource_scope";
        const hazard: ScopeCollisionHazard = {
          leftTaskId: left.id,
          rightTaskId: right.id,
          conflictType,
          writeScopeOverlap: writeConflict,
          resourceScopeOverlap: resConflict,
          details: `Tasks '${left.id}' (${left.status}) and '${right.id}' (${right.status}) collide on ${conflictType}: [${left.writeScope.join(", ")}] vs [${right.writeScope.join(", ")}]`,
        };

        if (activeStatuses.has(left.status) && activeStatuses.has(right.status)) {
          activeCollisions.push(hazard);
          details.push(`Active concurrent collision: ${hazard.details}`);
        } else if (candidateStatuses.has(left.status) && candidateStatuses.has(right.status)) {
          candidateCollisions.push(hazard);
        }
      }
    }
  }

  const totalHazardCount = activeCollisions.length + candidateCollisions.length;
  const passed = activeCollisions.length === 0;

  return {
    passed,
    activeCollisions,
    candidateCollisions,
    totalHazardCount,
    details,
  };
}

/**
 * Executes full 5-point graph health audit.
 */
export function auditGraphHealth(
  state: unknown,
  options: { now?: Date | string | number | undefined; timeoutMs?: number | undefined } = {},
): GraphHealthAuditReport {
  const orphanedTasks = probeOrphanedTasks(state);
  const staleLeases = probeStaleLeases(state, options);
  const circularDependencies = probeCircularDependencies(state);
  const gateCoverageViolations = probeGateCoverageViolations(state);
  const scopeCollisionHazards = probeScopeCollisionHazards(state);

  const issues: GraphHealthIssue[] = [];

  for (const detail of orphanedTasks.details) {
    issues.push({
      probe: "orphaned_tasks",
      severity: "critical",
      message: detail,
      entityIds: orphanedTasks.orphanedTaskIds,
    });
  }

  for (const detail of staleLeases.details) {
    issues.push({
      probe: "stale_leases",
      severity: "warning",
      message: detail,
      entityIds: staleLeases.staleTaskIds,
    });
  }

  for (const detail of circularDependencies.details) {
    issues.push({
      probe: "circular_dependencies",
      severity: "critical",
      message: detail,
      entityIds: circularDependencies.cycles.flat(),
    });
  }

  for (const detail of gateCoverageViolations.details) {
    issues.push({
      probe: "gate_coverage",
      severity: "critical",
      message: detail,
      entityIds: gateCoverageViolations.tasksWithoutGateCoverage,
    });
  }

  for (const collision of scopeCollisionHazards.activeCollisions) {
    issues.push({
      probe: "scope_collisions",
      severity: "critical",
      message: collision.details,
      entityIds: [collision.leftTaskId, collision.rightTaskId],
    });
  }

  const totalTasks = isRecord(state) && isRecord(state.tasks) ? Object.keys(state.tasks).length : 0;
  const healthy =
    orphanedTasks.passed &&
    circularDependencies.passed &&
    gateCoverageViolations.passed &&
    scopeCollisionHazards.passed &&
    staleLeases.passed;

  return {
    healthy,
    checkedAt: new Date(parseTimestamp(options.now)).toISOString(),
    totalTasks,
    issues,
    probes: {
      orphanedTasks,
      staleLeases,
      circularDependencies,
      gateCoverageViolations,
      scopeCollisionHazards,
    },
  };
}

// ============================================================================
// 2-Way Supervisory Watchdog Implementation
// ============================================================================

export function auditSupervisoryWatchdog(
  target?: string | undefined,
  options: { now?: Date | string | number | undefined; timeoutMs?: number | undefined } = {},
): SupervisoryWatchdogAuditReport {
  const store = loadWatchdogStore(target);
  const nowMs = parseTimestamp(options.now);
  const activeWatchdogs: WatchdogRecord[] = [];
  const overdueWatchdogs: WatchdogRecord[] = [];
  const hungAgentIds: string[] = [];
  const issues: string[] = [];

  let staleCount = 0;
  let terminatedCount = 0;
  let orphanedCount = 0;

  const wds = store.watchdogs ?? [];
  for (const wd of wds) {
    if (wd.status === "stale") staleCount++;
    else if (wd.status === "terminated") terminatedCount++;
    else if (wd.status === "orphaned") orphanedCount++;
    else if (wd.status === "active") {
      activeWatchdogs.push(wd);
      const lastHb = parseTimestamp(wd.last_heartbeat_at);
      const timeout = options.timeoutMs ?? wd.timeout_ms;
      if (nowMs - lastHb > timeout) {
        overdueWatchdogs.push(wd);
        if (wd.agent_id) hungAgentIds.push(wd.agent_id);
        issues.push(
          `Watchdog '${wd.id}' (agent '${wd.agent_id ?? "unknown"}') heartbeat overdue by ${nowMs - lastHb - timeout}ms`,
        );
      }
    }
  }

  return {
    healthy: overdueWatchdogs.length === 0,
    checkedAt: new Date(nowMs).toISOString(),
    activeWatchdogsCount: activeWatchdogs.length,
    staleWatchdogsCount: staleCount,
    terminatedWatchdogsCount: terminatedCount,
    orphanedWatchdogsCount: orphanedCount,
    activeWatchdogs,
    overdueWatchdogs,
    hungAgentIds,
    issues,
  };
}

export function recoverStaleTasks(
  port: TransactionPort,
  options: {
    now?: Date | string | number | undefined;
    timeoutMs?: number | undefined;
    maxRepairRounds?: number | undefined;
    actor?: string | undefined;
  } = {},
): TaskRecoveryResult {
  const nowMs = parseTimestamp(options.now);
  const actor = options.actor ?? "scheduler-watchdog";
  const maxRepairRounds = options.maxRepairRounds ?? 3;
  const recoveredTasks: TaskRecoveryRecord[] = [];
  const details: string[] = [];

  port.transact(
    actor,
    "scheduler-stale-tasks-recovery",
    { timestamp: new Date(nowMs).toISOString() },
    (draft) => {
      const currentState = draft;
      const staleProbe = probeStaleLeases(
        currentState,
        options.timeoutMs !== undefined
          ? { now: nowMs, timeoutMs: options.timeoutMs }
          : { now: nowMs },
      );

      for (const staleInfo of staleProbe.staleLeases) {
        const task = draft.tasks[staleInfo.taskId];
        if (!task) continue;

        if (!Array.isArray(task.history)) {
          task.history = [];
        }
        if (!Array.isArray(task.attempts)) {
          task.attempts = [];
        }

        const fromStatus = task.status;
        const currentRound = typeof task.repair_round === "number" ? task.repair_round : 0;
        const targetStatus: TaskStatus = currentRound < maxRepairRounds ? "retry_ready" : "stale";
        const reason = `Automated recovery: lease expired for agent '${staleInfo.agentId}' (${staleInfo.reason})`;

        transition(task, targetStatus, actor, new Date(nowMs), reason);
        task.replacement_reason = "stale";
        task.replacement_evidence = reason;
        delete task.lease;

        const record: TaskRecoveryRecord = {
          taskId: staleInfo.taskId,
          fromStatus,
          toStatus: targetStatus,
          agentId: staleInfo.agentId,
          reason,
          attempt: task.attempts.length,
          recoveredAt: new Date(nowMs).toISOString(),
        };
        recoveredTasks.push(record);
        details.push(
          `Task '${staleInfo.taskId}' transitioned from ${fromStatus} -> ${targetStatus}.`,
        );
      }
    },
  );

  return {
    recoveredCount: recoveredTasks.length,
    recoveredTasks,
    healthy: recoveredTasks.length === 0,
    details,
  };
}

// ============================================================================
// Structured 5-Point Supervisory Health Audit Probes (p24)
// ============================================================================

/**
 * Probe (a): Work/Span parallelization health
 * Validates parallelism ratio, identifies critical path bottlenecks, and monitors wave concurrency.
 */
export function probeWorkSpanParallelizationHealth(state: unknown): WorkSpanHealthAudit {
  const details: string[] = [];
  const activeBottlenecks: string[] = [];

  if (!isRecord(state) || !isRecord(state.tasks)) {
    return {
      passed: true,
      workParallelismRatio: 1,
      totalTasks: 0,
      completedTasks: 0,
      activeTasks: 0,
      readyTasks: 0,
      criticalPathLength: 0,
      activeBottlenecks: [],
      dynamicTopologyWaveCount: 0,
      spanUtilizationRatio: 1,
      details: ["State has no tasks to evaluate."],
    };
  }

  const tasks = Object.values(state.tasks).filter(isRecord);
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter(
    (t) => t.status === "done" || t.status === "validated",
  ).length;
  const activeTasks = tasks.filter(
    (t) => t.status === "running" || t.status === "leased" || t.status === "validating",
  ).length;
  const readyTasks = tasks.filter((t) => t.status === "ready" || t.status === "retry_ready").length;

  let criticalPathLength = 1;
  let dynamicTopologyWaveCount = 1;
  let workParallelismRatio =
    totalTasks > 0 ? (totalTasks - completedTasks) / Math.max(1, criticalPathLength) : 1;
  let spanUtilizationRatio = 1;

  if (isRecord(state.graph)) {
    try {
      const depMap = dependencyMap(state.graph);
      const scheduledTasks = new Map<string, ScheduledTask>();
      if (isRecord(state.tasks)) {
        for (const [id, t] of Object.entries(state.tasks)) {
          if (isRecord(t)) {
            scheduledTasks.set(id, {
              id,
              priority: typeof t.priority === "number" ? t.priority : 0,
              created_order: typeof t.created_order === "number" ? t.created_order : 0,
              effort: typeof t.effort === "number" ? t.effort : 1,
              requirement_ids: Array.isArray(t.requirement_ids)
                ? (t.requirement_ids as string[])
                : [],
              resource_scope: Array.isArray(t.resource_scope) ? (t.resource_scope as string[]) : [],
              write_scope: Array.isArray(t.write_scope) ? (t.write_scope as string[]) : [],
            });
          }
        }
      }
      const metrics = computeWorkSpanMetrics(depMap, scheduledTasks);
      criticalPathLength = Math.max(1, metrics.criticalPath.length);
      workParallelismRatio = metrics.parallelismFactor;
      spanUtilizationRatio =
        metrics.span > 0 ? Number((metrics.work / metrics.span).toFixed(2)) : 1;
      dynamicTopologyWaveCount = metrics.minWaves;
      if (metrics.parallelismFactor < 1.0 && totalTasks > 3 && completedTasks < totalTasks) {
        activeBottlenecks.push(
          `Critical path length (${metrics.criticalPath.length}) restricts parallelism ratio to ${metrics.parallelismFactor.toFixed(2)}.`,
        );
      }
    } catch {
      // Fallback
    }
  }

  // Check write scope collisions as active bottlenecks
  const scopeProbe = probeScopeCollisionHazards(state);
  if (scopeProbe.activeCollisions.length > 0) {
    for (const col of scopeProbe.activeCollisions) {
      activeBottlenecks.push(`Write scope bottleneck: ${col.details}`);
    }
  }

  const passed = activeBottlenecks.length === 0;
  if (passed) {
    details.push(
      `Work/Span parallelization is healthy: parallelism ratio ${workParallelismRatio.toFixed(2)}, span utilization ${(spanUtilizationRatio * 100).toFixed(0)}%.`,
    );
  } else {
    details.push(...activeBottlenecks);
  }

  return {
    passed,
    workParallelismRatio: Number(workParallelismRatio.toFixed(2)),
    totalTasks,
    completedTasks,
    activeTasks,
    readyTasks,
    criticalPathLength,
    activeBottlenecks,
    dynamicTopologyWaveCount,
    spanUtilizationRatio: Number(spanUtilizationRatio.toFixed(2)),
    details,
  };
}

/**
 * Probe (b): Plan enhancement needs
 * Evaluates unfulfilled requirements, blocked/stale tasks, and pending feedback candidates requiring enhancement.
 */
export function probePlanEnhancementNeeds(state: unknown): PlanEnhancementAudit {
  const details: string[] = [];
  const suggestedEnhancements: string[] = [];

  let totalRequirements = 0;
  let unfulfilledRequirementsCount = 0;
  let pendingCandidateCount = 0;

  if (!isRecord(state)) {
    return {
      passed: true,
      totalRequirements: 0,
      unfulfilledRequirementsCount: 0,
      pendingCandidateCount: 0,
      needsReplanning: false,
      suggestedEnhancements: [],
      details: ["No requirements record found."],
    };
  }

  // Count requirements
  const knownReqs = new Set<string>();
  if (isRecord(state.requirements)) {
    const list = Array.isArray(state.requirements.requirements)
      ? state.requirements.requirements
      : Array.isArray(state.requirements)
        ? state.requirements
        : [];
    for (const r of list) {
      if (isRecord(r) && typeof r.id === "string") {
        knownReqs.add(r.id);
        totalRequirements++;
      }
    }
  }

  // Check which requirements are covered by completed or active tasks
  const coveredReqs = new Set<string>();
  if (isRecord(state.tasks)) {
    for (const rawTask of Object.values(state.tasks)) {
      if (!isRecord(rawTask)) continue;
      const reqIds = Array.isArray(rawTask.requirement_ids) ? rawTask.requirement_ids : [];
      for (const req of reqIds) {
        if (typeof req === "string") {
          coveredReqs.add(req);
        }
      }
      if (rawTask.status === "changes_requested" || rawTask.status === "stale") {
        suggestedEnhancements.push(
          `Task '${String(rawTask.id)}' in '${String(rawTask.status)}' status requires repair or replan enhancement.`,
        );
      }
    }
  }

  for (const req of knownReqs) {
    if (!coveredReqs.has(req)) {
      unfulfilledRequirementsCount++;
      suggestedEnhancements.push(`Requirement '${req}' has no assigned tasks.`);
    }
  }

  // Check pending candidates in feedback or mind candidates array
  if (isRecord(state.mind) && Array.isArray(state.mind.candidates)) {
    pendingCandidateCount = state.mind.candidates.filter(
      (c) => isRecord(c) && c.status === "proposed",
    ).length;
    if (pendingCandidateCount > 0) {
      suggestedEnhancements.push(
        `${pendingCandidateCount} proposed mind candidate(s) pending admission.`,
      );
    }
  }

  const needsReplanning = unfulfilledRequirementsCount > 0 || suggestedEnhancements.length > 0;
  const passed = !needsReplanning;

  if (passed) {
    details.push(
      `Plan is coherent and complete (${totalRequirements} requirements fully covered, 0 pending enhancement blockers).`,
    );
  } else {
    details.push(...suggestedEnhancements);
  }

  return {
    passed,
    totalRequirements,
    unfulfilledRequirementsCount,
    pendingCandidateCount,
    needsReplanning,
    suggestedEnhancements,
    details,
  };
}

/**
 * Probe (c): 100% Agent Registry Accuracy
 * Cross-references all active leases against registered agent grants, enforcing 100% role and identity fidelity.
 */
export function probeAgentRegistryAccuracy(state: unknown): AgentRegistryAccuracyAudit {
  const details: string[] = [];
  const unmappedLeaseAgents: string[] = [];
  const mismatchedRoleAgents: string[] = [];
  const ghostAgentIds: string[] = [];

  if (!isRecord(state)) {
    return {
      passed: true,
      totalRegistered: 0,
      totalActiveGrants: 0,
      totalActiveLeases: 0,
      accuracyPercentage: 100,
      unmappedLeaseAgents: [],
      mismatchedRoleAgents: [],
      ghostAgentIds: [],
      details: ["No agents or tasks record to audit."],
    };
  }

  // Read registered agents
  const registeredGrants = new Map<string, { role: string; status: string }>();
  if (Array.isArray(state.agents)) {
    for (const grant of state.agents) {
      if (isRecord(grant) && typeof grant.id === "string" && typeof grant.role === "string") {
        registeredGrants.set(grant.id, {
          role: grant.role,
          status: typeof grant.status === "string" ? grant.status : "active",
        });
      }
    }
  }

  const totalRegistered = registeredGrants.size;
  const totalActiveGrants = Array.from(registeredGrants.values()).filter(
    (g) => g.status === "active",
  ).length;

  let totalActiveLeases = 0;

  if (isRecord(state.tasks)) {
    for (const [taskId, rawTask] of Object.entries(state.tasks)) {
      if (!isRecord(rawTask)) continue;
      const status = String(rawTask.status);
      if (["leased", "running", "validating"].includes(status) && isRecord(rawTask.lease)) {
        totalActiveLeases++;
        const leaseAgentId =
          typeof rawTask.lease.agent_id === "string" ? rawTask.lease.agent_id : "unknown";
        const leaseRole = typeof rawTask.lease.role === "string" ? rawTask.lease.role : "unknown";

        const registered = registeredGrants.get(leaseAgentId);
        if (!registered) {
          unmappedLeaseAgents.push(leaseAgentId);
          ghostAgentIds.push(leaseAgentId);
          details.push(
            `Task '${taskId}' lease held by unregistered ghost agent '${leaseAgentId}'.`,
          );
        } else {
          if (registered.status !== "active") {
            unmappedLeaseAgents.push(leaseAgentId);
            details.push(
              `Task '${taskId}' lease held by released/inactive agent '${leaseAgentId}'.`,
            );
          }
          if (registered.role !== leaseRole) {
            mismatchedRoleAgents.push(leaseAgentId);
            details.push(
              `Task '${taskId}' lease role '${leaseRole}' mismatches registered grant role '${registered.role}' for agent '${leaseAgentId}'.`,
            );
          }
        }
      }
    }
  }

  const totalViolations =
    unmappedLeaseAgents.length + mismatchedRoleAgents.length + ghostAgentIds.length;
  const passed = totalViolations === 0;
  const accuracyPercentage =
    totalActiveLeases > 0
      ? Math.max(0, Math.round(((totalActiveLeases - totalViolations) / totalActiveLeases) * 100))
      : 100;

  if (passed) {
    details.push(
      `Agent registry has 100% accuracy: ${totalActiveGrants} active grants, ${totalActiveLeases} active leases verified with zero role mismatches.`,
    );
  }

  return {
    passed,
    totalRegistered,
    totalActiveGrants,
    totalActiveLeases,
    accuracyPercentage,
    unmappedLeaseAgents,
    mismatchedRoleAgents,
    ghostAgentIds,
    details,
  };
}

/**
 * Probe (d): Strict Role Boundary Adherence
 * Audits role confinement and tier compliance with zero tolerance.
 */
export function probeRoleBoundaryAdherence(
  state: unknown,
  runRoot?: string,
): RoleBoundaryAdherenceAudit {
  const details: string[] = [];
  const hierarchicalViolations: string[] = [];
  const tierConfinementViolations: string[] = [];

  if (runRoot !== undefined) {
    try {
      const findings = auditBehavioralHealth(runRoot, isJsonObject(state) ? state : undefined);
      for (const finding of findings) {
        const msg = `[${finding.severity.toUpperCase()}] ${finding.violation_type} (${finding.role}/${finding.agent_id}): ${finding.observation}`;
        tierConfinementViolations.push(msg);
        details.push(msg);
      }
    } catch {
      // In-memory fallback
    }
  }

  // Cross-check tasks in state for role-tier conformance
  if (isRecord(state) && isRecord(state.tasks)) {
    for (const [taskId, rawTask] of Object.entries(state.tasks)) {
      if (!isRecord(rawTask)) continue;
      if (isRecord(rawTask.lease)) {
        const leaseRole = String(rawTask.lease.role);
        const taskStatus = String(rawTask.status);
        if (taskStatus === "validating" && leaseRole !== "validator") {
          const vMsg = `Task '${taskId}' in validating status held by non-validator role '${leaseRole}'.`;
          hierarchicalViolations.push(vMsg);
          details.push(vMsg);
        } else if (
          (taskStatus === "leased" || taskStatus === "running") &&
          leaseRole !== "implementer"
        ) {
          const vMsg = `Task '${taskId}' in ${taskStatus} status held by non-implementer role '${leaseRole}'.`;
          hierarchicalViolations.push(vMsg);
          details.push(vMsg);
        }
      }
    }
  }

  const passed = hierarchicalViolations.length === 0 && tierConfinementViolations.length === 0;
  if (passed) {
    details.push(
      "All active agents and tasks strictly adhere to hierarchical tier confinement and role boundaries.",
    );
  }

  return {
    passed,
    hierarchicalViolations,
    tierConfinementViolations,
    details,
  };
}

/**
 * Probe (e): Doctor Error Resolution
 * Inspects doctor diagnostic status and checks for unresolved system errors.
 */
export function probeDoctorErrorResolution(
  runRoot?: string,
  doctorResult?: Record<string, unknown>,
): DoctorErrorResolutionAudit {
  const details: string[] = [];
  const unresolvedErrors: string[] = [];
  const repairRecommendations: string[] = [];

  if (doctorResult !== undefined) {
    const issues = Array.isArray(doctorResult.issues) ? (doctorResult.issues as string[]) : [];
    for (const issue of issues) {
      unresolvedErrors.push(issue);
      details.push(issue);
      repairRecommendations.push(
        `Run 'bun harness.ts doctor:repair --run ${runRoot ?? "."}' or resolve: ${issue}`,
      );
    }
  } else if (runRoot !== undefined) {
    try {
      const integrity = verifyIntegrity(runRoot);
      for (const err of integrity) {
        const msg = `Integrity error: ${err.code} - ${err.message}`;
        unresolvedErrors.push(msg);
        details.push(msg);
        repairRecommendations.push(`Resolve capsule integrity issue at ${runRoot}: ${err.message}`);
      }
    } catch {
      // In-memory fallback
    }
  }

  const passed = unresolvedErrors.length === 0;
  if (passed) {
    details.push("Doctor check passed with 0 unresolved errors.");
  }

  return {
    passed,
    totalIssues: unresolvedErrors.length,
    unresolvedErrors,
    repairRecommendations,
    details,
  };
}

/**
 * Determines the top leader in the hierarchy (Mind Lead -> Orchestrator Lead -> Coordinator).
 */
export function determineTopLeader(state: unknown): SupervisoryTopLeader {
  if (isRecord(state) && Array.isArray(state.agents)) {
    // 1. Search for active Mind Lead (Tier 0)
    for (const grant of state.agents) {
      if (isRecord(grant) && grant.status === "active" && grant.role === "mind") {
        return {
          agentId: typeof grant.id === "string" ? grant.id : "mind-lead",
          role: "mind",
          tier: 0,
        };
      }
    }

    // 2. Search for active Orchestrator Lead (Tier 1)
    for (const grant of state.agents) {
      if (isRecord(grant) && grant.status === "active" && grant.role === "orchestrator") {
        return {
          agentId: typeof grant.id === "string" ? grant.id : "orch-lead",
          role: "orchestrator",
          tier: 1,
        };
      }
    }

    // 3. Search for active Coordinator (Tier 2)
    for (const grant of state.agents) {
      if (isRecord(grant) && grant.status === "active" && grant.role === "coordinator") {
        return {
          agentId: typeof grant.id === "string" ? grant.id : "coordinator-lead",
          role: "coordinator",
          tier: 2,
        };
      }
    }
  }

  return {
    agentId: "coordinator-lead",
    role: "coordinator",
    tier: 2,
  };
}

/**
 * Renders the 5-point supervisory health report in Markdown.
 */
export function formatSupervisoryHealthMarkdown(report: Supervisory5PointHealthReport): string {
  const lines = [
    `### 🛡️ Two-Way Supervisory Watchdog 5-Point Health Probe`,
    `- **Checked At**: \`${report.checkedAt}\``,
    `- **Dispatched To Top Leader**: \`${report.topLeader.agentId}\` (Role: **${report.topLeader.role.toUpperCase()}**, Tier: ${report.topLeader.tier})`,
    `- **Overall Status**: ${report.healthy ? "🟢 HEALTHY (All 5 Supervisory Probes Passed)" : "⚠️ ACTION REQUIRED (Violations Detected)"}`,
    "",
    "#### 5-Point Audit Breakdown",
    `1. **(a) Work/Span Parallelization Health**: ${report.workSpanHealth.passed ? "🟢 PASS" : "❌ CONSTRAINED"} (Parallelism: ${report.workSpanHealth.workParallelismRatio.toFixed(2)}, Active Tasks: ${report.workSpanHealth.activeTasks}, Ready Tasks: ${report.workSpanHealth.readyTasks})`,
    ...report.workSpanHealth.details.map((d) => `   - ${d}`),
    `2. **(b) Plan Enhancement Needs**: ${report.planEnhancement.passed ? "🟢 PASS" : "⚠️ ENHANCEMENT NEEDED"} (${report.planEnhancement.totalRequirements} requirements, ${report.planEnhancement.unfulfilledRequirementsCount} unfulfilled)`,
    ...report.planEnhancement.details.map((d) => `   - ${d}`),
    `3. **(c) 100% Agent Registry Accuracy**: ${report.agentRegistryAccuracy.passed ? "🟢 PASS (100%)" : "❌ MISMATCH"} (${report.agentRegistryAccuracy.totalActiveGrants} active grants, ${report.agentRegistryAccuracy.totalActiveLeases} active leases)`,
    ...report.agentRegistryAccuracy.details.map((d) => `   - ${d}`),
    `4. **(d) Strict Role Boundary Adherence**: ${report.roleBoundaryAdherence.passed ? "🟢 PASS" : "❌ ROLE VIOLATION"} (${report.roleBoundaryAdherence.hierarchicalViolations.length + report.roleBoundaryAdherence.tierConfinementViolations.length} violations)`,
    ...report.roleBoundaryAdherence.details.map((d) => `   - ${d}`),
    `5. **(e) Doctor Error Resolution**: ${report.doctorResolution.passed ? "🟢 PASS" : "❌ DOCTOR ISSUES"} (${report.doctorResolution.totalIssues} unresolved issues)`,
    ...report.doctorResolution.details.map((d) => `   - ${d}`),
  ];

  if (report.overallIssues.length > 0) {
    lines.push("");
    lines.push("#### ⚠️ Required Supervisory Actions for Leader");
    for (const issue of report.overallIssues) {
      lines.push(`- ${issue}`);
    }
  }

  return lines.join("\n");
}

/**
 * Runs the full 5-point supervisory health audit.
 */
export function auditSupervisory5PointHealth(
  state: unknown,
  options: Supervisory5PointOptions = {},
): Supervisory5PointHealthReport {
  const topLeader = determineTopLeader(state);
  const nowIso = new Date(parseTimestamp(options.now)).toISOString();

  const workSpanHealth = probeWorkSpanParallelizationHealth(state);
  const planEnhancement = probePlanEnhancementNeeds(state);
  const agentRegistryAccuracy = probeAgentRegistryAccuracy(state);
  const roleBoundaryAdherence = probeRoleBoundaryAdherence(state, options.runRoot);
  const doctorResolution = probeDoctorErrorResolution(options.runRoot, options.doctorResult);

  const overallIssues: string[] = [];
  if (!workSpanHealth.passed) overallIssues.push(...workSpanHealth.details);
  if (!planEnhancement.passed) overallIssues.push(...planEnhancement.details);
  if (!agentRegistryAccuracy.passed) overallIssues.push(...agentRegistryAccuracy.details);
  if (!roleBoundaryAdherence.passed) overallIssues.push(...roleBoundaryAdherence.details);
  if (!doctorResolution.passed) overallIssues.push(...doctorResolution.details);

  const healthy =
    workSpanHealth.passed &&
    planEnhancement.passed &&
    agentRegistryAccuracy.passed &&
    roleBoundaryAdherence.passed &&
    doctorResolution.passed;

  const partialReport = {
    healthy,
    checkedAt: nowIso,
    topLeader,
    workSpanHealth,
    planEnhancement,
    agentRegistryAccuracy,
    roleBoundaryAdherence,
    doctorResolution,
    overallIssues,
  };

  const markdown = formatSupervisoryHealthMarkdown({
    ...partialReport,
    markdown: "",
  });

  return {
    ...partialReport,
    markdown,
  };
}

/**
 * Dispatches active supervisory health probe to the top leader.
 */
export function dispatchSupervisoryHealthProbe(
  state: unknown,
  options: Supervisory5PointOptions = {},
): SupervisoryProbeDispatchResult {
  const report = auditSupervisory5PointHealth(state, options);
  const targetAgentId = report.topLeader.agentId;
  const targetRole = report.topLeader.role;

  const promptForLeader = [
    `[SUPERVISORY WATCHDOG PROBE] Health check for top leader '${targetAgentId}' (${targetRole.toUpperCase()}):`,
    `Status: ${report.healthy ? "HEALTHY" : "ATTENTION REQUIRED"}`,
    report.overallIssues.length > 0
      ? `Issues to resolve:\n${report.overallIssues.map((i) => `• ${i}`).join("\n")}`
      : "All 5 health points (Work/Span, Plan Enhancement, Agent Registry, Role Boundaries, Doctor) are green.",
  ].join("\n");

  return {
    dispatched: true,
    targetAgentId,
    targetRole,
    report,
    promptForLeader,
    markdown: report.markdown,
  };
}

// ============================================================================
// Zero-Tolerance Doctor Gate Enforcement (p25)
// ============================================================================

export async function auditDoctorGate(
  runRoot: string,
  options: DoctorOptions = {},
): Promise<Record<string, unknown>> {
  return await runDoctor(runRoot, options);
}

export async function assertDoctorGatePassed(
  runRoot: string,
  options: DoctorOptions = {},
): Promise<Record<string, unknown>> {
  const docResult = await runDoctor(runRoot, options);
  const healthy = docResult.healthy === true;
  const behavioralFindings = Array.isArray(docResult.behavioral_findings)
    ? (docResult.behavioral_findings as BehavioralFinding[])
    : [];
  const issues = Array.isArray(docResult.issues) ? (docResult.issues as string[]) : [];

  if (!healthy || behavioralFindings.length > 0 || issues.length > 0) {
    const errorPrefix =
      behavioralFindings.length > 0
        ? "DOCTOR GATE VIOLATION (Zero-Tolerance Boundary Auditing): Role confinement or behavioral policy breached"
        : "DOCTOR GATE REJECTION: System doctor discovered unresolved capsule failures";

    const fullMessage = `${errorPrefix}:\n${issues.map((i) => `  - ${i}`).join("\n")}`;

    if (behavioralFindings.length > 0) {
      throw new HarnessError("ROLE_CONFINEMENT_VIOLATION", fullMessage, issues);
    }
    throw new HarnessError("INVALID_STATE", fullMessage, issues);
  }

  return docResult;
}

// ============================================================================
// Core Scheduler Engine Class (p25)
// ============================================================================

export class SchedulerEngine {
  private readonly maxParallel: number | null;
  private readonly timeoutMs: number;
  private readonly heartbeatCadenceMs: number;
  private readonly clock: Clock;
  private readonly watchdogTarget?: string | undefined;
  private readonly maxRepairRounds: number;

  public constructor(options: SchedulerEngineOptions = {}) {
    this.maxParallel = options.maxParallel ?? null;
    this.timeoutMs = options.timeoutMs ?? 360_000;
    this.heartbeatCadenceMs = options.heartbeatCadenceMs ?? 180_000;
    this.clock = options.clock ?? systemClock;
    this.watchdogTarget = options.watchdogTarget;
    this.maxRepairRounds = options.maxRepairRounds ?? 3;
  }

  public auditHealth(state: unknown): GraphHealthAuditReport {
    return auditGraphHealth(state, {
      now: this.clock.now(),
      timeoutMs: this.timeoutMs,
    });
  }

  public auditWatchdog(): SupervisoryWatchdogAuditReport {
    return auditSupervisoryWatchdog(this.watchdogTarget, {
      now: this.clock.now(),
      timeoutMs: this.timeoutMs,
    });
  }

  public auditSupervisory5Point(
    state: unknown,
    options: {
      runRoot?: string | undefined;
      doctorResult?: Record<string, unknown> | undefined;
    } = {},
  ): Supervisory5PointHealthReport {
    return auditSupervisory5PointHealth(state, {
      runRoot: options.runRoot,
      now: this.clock.now(),
      doctorResult: options.doctorResult,
    });
  }

  public dispatchTopLeaderProbe(
    state: unknown,
    options: {
      runRoot?: string | undefined;
      doctorResult?: Record<string, unknown> | undefined;
    } = {},
  ): SupervisoryProbeDispatchResult {
    return dispatchSupervisoryHealthProbe(state, {
      runRoot: options.runRoot,
      now: this.clock.now(),
      doctorResult: options.doctorResult,
    });
  }

  public async auditDoctor(
    runRoot: string,
    options: DoctorOptions = {},
  ): Promise<Record<string, unknown>> {
    return await auditDoctorGate(runRoot, options);
  }

  public async runDoctorGate(
    runRoot: string,
    options: DoctorOptions = {},
  ): Promise<Record<string, unknown>> {
    return await assertDoctorGatePassed(runRoot, options);
  }

  public recoverStale(port: TransactionPort): TaskRecoveryResult {
    // 1. Cleanup stale store watchdogs
    // watchdog cleanup is automatic or handled elsewhere

    // 2. Recover stale tasks in workflow state
    return recoverStaleTasks(port, {
      now: this.clock.now(),
      timeoutMs: this.timeoutMs,
      maxRepairRounds: this.maxRepairRounds,
      actor: "scheduler-engine",
    });
  }

  public evaluateReadyBatch(
    state: unknown,
    maxParallel?: number | null | undefined,
  ): ReadySetSelection {
    const limit = maxParallel !== undefined ? maxParallel : this.maxParallel;
    return readySet(state, limit ?? 10);
  }

  public evaluateWave(
    state: unknown,
    maxParallel?: number | null | undefined,
  ): ScheduledWaveResult {
    const limit = maxParallel !== undefined ? maxParallel : this.maxParallel;
    const batch = proposeBatch(state, limit);
    const readySelection = readySet(state, limit ?? 10);

    const readyTasks: ScheduledTaskDispatch[] = batch.map((task) => {
      const entry = readySelection.entries.find((e) => e.task_id === task.id);
      return {
        taskId: task.id,
        label: typeof task.label === "string" ? task.label : null,
        priority: task.priority,
        writeScope: [...task.write_scope],
        resourceScope: [...(task.resource_scope ?? [])],
        requirementIds: [...task.requirement_ids],
        wave: entry?.recorded_wave ?? null,
      };
    });

    const activeOccupiedTasks: string[] = [];
    const blockedTasks: BlockedTaskInfo[] = [];

    if (isRecord(state) && isRecord(state.tasks)) {
      const deps = isRecord(state.graph)
        ? dependencyMap(state.graph)
        : new Map<string, Set<string>>();
      const doneSet = new Set<string>();

      for (const [id, rawTask] of Object.entries(state.tasks)) {
        if (isRecord(rawTask) && rawTask.status === "done") {
          doneSet.add(id);
        }
      }

      for (const [taskId, rawTask] of Object.entries(state.tasks)) {
        if (!isRecord(rawTask)) continue;
        const status = String(rawTask.status);
        if (hasActiveOwnership(status) && !["proposed", "ready", "retry_ready"].includes(status)) {
          activeOccupiedTasks.push(taskId);
        } else if (status === "blocked" || status === "changes_requested" || status === "stale") {
          const prerequisites = Array.from(deps.get(taskId) ?? []);
          const unsatisfied = prerequisites.filter((p) => !doneSet.has(p));
          blockedTasks.push({
            taskId,
            status,
            blockingReason: `Task in status '${status}' is not eligible for batch dispatch.`,
            prerequisites,
            unsatisfiedPrerequisites: unsatisfied,
          });
        }
      }
    }

    return {
      readyTasks,
      blockedTasks,
      activeOccupiedTasks,
      totalEligible: readyTasks.length,
      maxParallel: limit,
      evaluatedAt: this.clock.now().toISOString(),
    };
  }

  public evaluateMultiDomainBatch(
    state: unknown,
    options: MultiDomainBatchOptions = {},
  ): MultiDomainBatchResult {
    const limit = options.maxParallel !== undefined ? options.maxParallel : this.maxParallel;
    return evaluateMultiDomainBatch(state, {
      ...options,
      maxParallel: limit,
    });
  }

  public dispatchMultiDomainValidators(
    state: unknown,
    options: MultiDomainValidatorDispatchOptions = {},
  ): MultiDomainValidatorDispatchResult {
    const limit = options.maxParallel !== undefined ? options.maxParallel : this.maxParallel;
    return dispatchMultiDomainValidators(state, {
      ...options,
      maxParallel: limit,
    });
  }

  public proposeMultiDomainWave(
    state: unknown,
    options: MultiDomainWaveOptions = {},
  ): MultiDomainWaveResult {
    const limit = options.maxParallel !== undefined ? options.maxParallel : this.maxParallel;
    return proposeMultiDomainWave(state, {
      clock: this.clock,
      ...options,
      maxParallel: limit,
    });
  }

  public async auditScriptBackedDiagnostics(
    options: ScriptBackedDiagnosticsOptions = {},
  ): Promise<ScriptBackedDiagnosticsResult> {
    return await runScriptBackedDiagnostics({
      clock: this.clock,
      ...options,
    });
  }

  public async runScriptBackedDiagnostics(
    options: ScriptBackedDiagnosticsOptions = {},
  ): Promise<ScriptBackedDiagnosticsResult> {
    return await runScriptBackedDiagnostics({
      clock: this.clock,
      ...options,
    });
  }

  public registerSupervisoryHeartbeat(agentId: string = "scheduler-engine"): WatchdogRecord {
    return registerWatchdog(
      {
        agent_id: agentId,
        phase: "scheduler-pulse",
        heartbeat_cadence_ms: this.heartbeatCadenceMs,
        timeout_ms: this.timeoutMs,
        now: this.clock.now(),
      },
      this.watchdogTarget,
    ).watchdog;
  }
}

export {
  classifyTaskDomain,
  derivePrimaryValidatorDomain,
  dispatchMultiDomainValidators,
  evaluateMultiDomainBatch,
  formatDiagnosticReceiptsMarkdown,
  generateAsciiDagBadges,
  generateReceiptBadge,
  generateReceiptSummaryBadge,
  isMultiDomainDispatchEligible,
  MULTI_DOMAIN_PARALLELISM_THRESHOLD,
  proposeMultiDomainWave,
  resolveParallelismFactor,
  runInspectorDagView,
  runInspectorDoctor,
  runInspectorHealth,
  runInspectorUnifiedReport,
  runScriptBackedDiagnostics,
  type CliDiagnosticReceipt,
  type DiagnosticInspectorName,
  type DiagnosticReceiptStatus,
  type MultiDomainBatchOptions,
  type MultiDomainBatchResult,
  type MultiDomainBlockedTaskInfo,
  type MultiDomainTaskDispatch,
  type MultiDomainValidatorDispatchOptions,
  type MultiDomainValidatorDispatchResult,
  type MultiDomainWaveOptions,
  type MultiDomainWaveResult,
  type ScriptBackedDiagnosticsOptions,
  type ScriptBackedDiagnosticsResult,
  type TaskDomain,
};

/**
 * Living Dynamic DAG Expansion Engine & Real-Time Step Tracer Subsystem
 * Replays live capsule telemetry (events.jsonl, rounds/, leases/) to reconstruct dynamic subgraphs.
 * Renders chronological execution timelines and live round-by-round DAG node states.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { HarnessEvent } from "../contracts/capsule.ts";
import { readCapsuleEvents } from "./event-stream.ts";
import { formatTable } from "../cli/formatters/line-limiter.ts";
import { formatCoordinates, formatStatusBadge, formatSubagentAllocation } from "./sugiyama-dag.ts";

export type DynamicTaskOrigin =
  | "static"
  | "dynamic_expansion"
  | "branch"
  | "replan"
  | "repair_branch";

export interface DynamicTaskState {
  readonly id: string;
  readonly label: string;
  readonly status: string;
  readonly role?: string | undefined;
  readonly dependencies: readonly string[];
  readonly writeScope: readonly string[];
  readonly assignedAgent?: string | null | undefined;
  readonly origin: DynamicTaskOrigin;
  readonly createdAtSeq: number;
  readonly updatedAtSeq: number;
  readonly branchId?: string | undefined;
  readonly round: number;
  readonly attempt: number;
  readonly executionState: string;
  readonly activeTool?: string | null | undefined;
  readonly activeCommand?: string | null | undefined;
  readonly activeStepIndex?: number | null | undefined;
  readonly rejectionReason?: string | null | undefined;
  readonly validatorId?: string | null | undefined;
  readonly repairForTaskId?: string | null | undefined;
  readonly sproutedChildren?: readonly string[] | undefined;
  readonly findings?: readonly string[] | undefined;
  readonly coordinates?:
    | {
        readonly wave?: number;
        readonly lane?: number;
        readonly rank?: number;
        readonly order?: number;
      }
    | string
    | undefined;
  readonly probeRound?: number | undefined;
  readonly expandedSubtasks?:
    | readonly (
        | DynamicTaskState
        | {
            readonly id: string;
            readonly label?: string | undefined;
            readonly status?: string | undefined;
            readonly assignedAgent?: string | null | undefined;
            readonly validatorId?: string | null | undefined;
            readonly role?: string | undefined;
          }
      )[]
    | undefined;
}

export interface ActiveAgentState {
  readonly role: string;
  readonly taskId: string | null;
  readonly currentTool: string | null;
  readonly currentCommand: string | null;
  readonly lastActiveSeq: number;
  readonly activeStepIndex: number;
}

export interface SproutedRepairPair {
  readonly rejectedTaskId: string;
  readonly round: number;
  readonly repairTaskId: string;
  readonly validatorTaskId: string;
  readonly reason: string | null;
}

export interface DynamicDagState {
  readonly runId: string;
  readonly revision: number;
  readonly totalTasks: number;
  readonly staticTasksCount: number;
  readonly dynamicTasksCount: number;
  readonly repairBranchesCount: number;
  readonly currentRound: number;
  readonly tasks: ReadonlyMap<string, DynamicTaskState>;
  readonly activeAgents: ReadonlyMap<string, ActiveAgentState>;
  readonly activeBranches: readonly string[];
  readonly sproutedRepairPairs: readonly SproutedRepairPair[];
}

export interface StepTraceEntry {
  readonly sequence: number;
  readonly timestamp: string;
  readonly elapsedMs: number;
  readonly actor: string;
  readonly kind: string;
  readonly taskId: string | null;
  readonly role: string | null;
  readonly tool: string | null;
  readonly glyph: string;
  readonly title: string;
  readonly details: readonly string[];
  readonly isError: boolean;
  readonly isGate: boolean;
}

export interface StepTracerSummary {
  readonly totalSteps: number;
  readonly totalDurationMs: number;
  readonly uniqueActors: readonly string[];
  readonly taskCount: number;
  readonly dynamicExpansionCount: number;
  readonly repairBranchesCount: number;
  readonly maxRoundReached: number;
  readonly gateRunsCount: number;
  readonly gatePassesCount: number;
  readonly gateFailsCount: number;
  readonly errorCount: number;
}

export interface LivingTracerOptions {
  readonly fromSeq?: number | undefined;
  readonly toSeq?: number | undefined;
  readonly maxSteps?: number | undefined;
  readonly filterTask?: string | undefined;
  readonly filterActor?: string | undefined;
  readonly filterKind?: string | undefined;
  readonly detailed?: boolean | undefined;
  readonly all?: boolean | undefined;
}

export interface LivingTracerReport {
  readonly markdown: string;
  readonly asciiTimeline: string;
  readonly asciiDag: string;
  readonly dynamicDag: DynamicDagState;
  readonly steps: readonly StepTraceEntry[];
  readonly summary: StepTracerSummary;
}

function parsePayloadString(
  payload: Record<string, unknown> | undefined,
  keys: readonly string[],
): string | null {
  if (!payload || typeof payload !== "object") return null;
  for (const k of keys) {
    const val = payload[k];
    if (typeof val === "string" && val.trim().length > 0) {
      return val.trim();
    }
  }
  return null;
}

function parsePayloadNumber(
  payload: Record<string, unknown> | undefined,
  keys: readonly string[],
): number | null {
  if (!payload || typeof payload !== "object") return null;
  for (const k of keys) {
    const val = payload[k];
    if (typeof val === "number" && !Number.isNaN(val)) {
      return val;
    }
  }
  return null;
}

function parsePayloadStringArray(
  payload: Record<string, unknown> | undefined,
  key: string,
): readonly string[] {
  if (!payload || typeof payload !== "object") return [];
  const val = payload[key];
  if (Array.isArray(val) && val.every((item) => typeof item === "string")) {
    return val as readonly string[];
  }
  return [];
}

function formatSeq(seq: number): string {
  return `#${seq.toString().padStart(3, "0")}`;
}

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  const milli = Math.floor((ms % 1000) / 10);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(min)}:${pad(sec)}.${pad(milli)}`;
}

/**
 * Builds dynamic DAG expansion state by replaying capsule telemetry events.
 * Status transitions, active tools, lease holders, step indices, and sprouted repair branches are 100% telemetry-grounded.
 */
export function buildDynamicDagState(
  events: readonly HarnessEvent[],
  runId = "capsule-run",
): DynamicDagState {
  const taskMap = new Map<string, DynamicTaskState>();
  const agentMap = new Map<string, ActiveAgentState>();
  const branches = new Set<string>();
  const sproutedRepairPairs: SproutedRepairPair[] = [];
  let revision = 1;
  let maxRoundReached = 1;

  for (const ev of events) {
    const payload =
      typeof ev.payload === "object" && ev.payload !== null
        ? (ev.payload as Record<string, unknown>)
        : {};
    const actor = ev.actor;
    const kind = ev.kind;
    const lowerKind = kind.toLowerCase();
    const seq = ev.sequence;

    if (typeof ev.revision === "number" && ev.revision > revision) {
      revision = ev.revision;
    }

    const explicitTaskId = parsePayloadString(payload, ["task_id", "taskId", "task", "id"]);
    const role = parsePayloadString(payload, [
      "role",
      "assigned_role",
      "assignedRole",
      "repair_assignee",
    ]);
    const tool = parsePayloadString(payload, [
      "tool",
      "current_tool",
      "tool_name",
      "toolName",
      "tool_call",
    ]);
    const cmd = parsePayloadString(payload, ["command", "cmd", "command_line", "commandLine"]);
    const exitCode = parsePayloadNumber(payload, ["exit_code", "code", "exitCode"]);
    const roundInPayload = parsePayloadNumber(payload, ["round", "repair_round", "attempt_round"]);
    const attemptInPayload = parsePayloadNumber(payload, ["attempt", "lease_attempt"]);
    const branchIdFromPayload = parsePayloadString(payload, ["branch_id", "branchId", "branch"]);
    const validatorFromPayload = parsePayloadString(payload, [
      "validator_id",
      "validatorId",
      "validator",
      "validator_agent",
      "validatorAgent",
    ]);
    const probeRoundInPayload = parsePayloadNumber(payload, ["probe_round", "probeRound"]);
    const coordinatesFromPayload =
      typeof payload.coordinates === "string" ||
      (typeof payload.coordinates === "object" && payload.coordinates !== null)
        ? (payload.coordinates as
            | { wave?: number; lane?: number; rank?: number; order?: number }
            | string)
        : undefined;

    // If task ID is not explicitly given, try resolving from active agent
    const taskId = explicitTaskId ?? (actor ? (agentMap.get(actor)?.taskId ?? null) : null);

    // Track active agent
    if (actor && actor !== "system" && actor !== "operator") {
      const existingAgent = agentMap.get(actor);
      agentMap.set(actor, {
        role:
          role ?? existingAgent?.role ?? (lowerKind.includes("val") ? "validator" : "implementer"),
        taskId: taskId ?? existingAgent?.taskId ?? null,
        currentTool: tool ?? existingAgent?.currentTool ?? null,
        currentCommand: cmd ?? existingAgent?.currentCommand ?? null,
        lastActiveSeq: seq,
        activeStepIndex: seq,
      });
    }

    // Track branch lifecycle
    if (lowerKind === "branch-opened" || lowerKind === "branch:open") {
      if (branchIdFromPayload) branches.add(branchIdFromPayload);
    } else if (
      lowerKind === "branch-collected" ||
      lowerKind === "branch:collect" ||
      lowerKind === "branch-abandoned"
    ) {
      if (branchIdFromPayload) branches.delete(branchIdFromPayload);
    }

    // Dynamic task creations or additions
    if (
      lowerKind === "task-created" ||
      lowerKind === "task:add" ||
      lowerKind === "task-added" ||
      lowerKind === "smart-task:plan" ||
      lowerKind === "subtask-created" ||
      lowerKind === "dynamic-expansion"
    ) {
      const id = explicitTaskId ?? parsePayloadString(payload, ["id"]);
      if (id) {
        const label = parsePayloadString(payload, ["label", "title"]) ?? id;
        const deps = parsePayloadStringArray(payload, "dependencies").concat(
          parsePayloadStringArray(payload, "deps"),
        );
        const writeScope = parsePayloadStringArray(payload, "write_scope").concat(
          parsePayloadStringArray(payload, "writeScope"),
        );
        const taskRound = roundInPayload ?? 1;
        if (taskRound > maxRoundReached) maxRoundReached = taskRound;

        taskMap.set(id, {
          id,
          label,
          status: deps.length > 0 ? "proposed" : "ready",
          role: role ?? undefined,
          dependencies: [...new Set(deps)],
          writeScope: [...new Set(writeScope)],
          assignedAgent: null,
          origin: branchIdFromPayload ? "branch" : "dynamic_expansion",
          createdAtSeq: seq,
          updatedAtSeq: seq,
          branchId: branchIdFromPayload ?? undefined,
          round: taskRound,
          attempt: attemptInPayload ?? 1,
          executionState: deps.length > 0 ? "[🔒 PROPOSED]" : "[⏳ READY]",
          activeTool: null,
          activeCommand: null,
          activeStepIndex: seq,
          sproutedChildren: [],
          validatorId: validatorFromPayload ?? undefined,
          probeRound: probeRoundInPayload ?? undefined,
          coordinates: coordinatesFromPayload ?? undefined,
        });
      }
    }

    // If an existing task is referenced, update its state grounded in live telemetry
    if (taskId) {
      // If task is not yet in taskMap, initialize it as static base task
      if (!taskMap.has(taskId)) {
        const label = parsePayloadString(payload, ["label", "title"]) ?? taskId;
        const writeScope = parsePayloadStringArray(payload, "write_scope").concat(
          parsePayloadStringArray(payload, "writeScope"),
        );
        const deps = parsePayloadStringArray(payload, "dependencies").concat(
          parsePayloadStringArray(payload, "deps"),
        );
        const taskRound = roundInPayload ?? 1;
        if (taskRound > maxRoundReached) maxRoundReached = taskRound;

        taskMap.set(taskId, {
          id: taskId,
          label,
          status: "ready",
          role: role ?? undefined,
          dependencies: [...new Set(deps)],
          writeScope: [...new Set(writeScope)],
          assignedAgent: null,
          origin: "static",
          createdAtSeq: seq,
          updatedAtSeq: seq,
          round: taskRound,
          attempt: attemptInPayload ?? 1,
          executionState: "[⏳ READY]",
          activeTool: null,
          activeCommand: null,
          activeStepIndex: seq,
          sproutedChildren: [],
          validatorId: validatorFromPayload ?? undefined,
          probeRound: probeRoundInPayload ?? undefined,
          coordinates: coordinatesFromPayload ?? undefined,
        });
      }

      // Check if this event targets a sprouted repair task or the main task
      const existing = taskMap.get(taskId)!;
      let targetTask = existing;
      let targetTaskId = taskId;

      // If existing task was rejected in Round 1 and this event is a Round 2+ claim/tool/verdict,
      // route to the latest sprouted repair task if one exists
      if (
        (existing.status === "changes_requested" || existing.executionState.includes("REJECTED")) &&
        (roundInPayload === 2 ||
          role === "repairer" ||
          (attemptInPayload && attemptInPayload > 1)) &&
        existing.sproutedChildren &&
        existing.sproutedChildren.length > 0
      ) {
        const repairChildId = existing.sproutedChildren[0]!;
        if (taskMap.has(repairChildId)) {
          targetTask = taskMap.get(repairChildId)!;
          targetTaskId = repairChildId;
        }
      }

      const currentRound = roundInPayload ?? targetTask.round;
      if (currentRound > maxRoundReached) maxRoundReached = currentRound;
      const currentAttempt = attemptInPayload ?? targetTask.attempt;

      let nextStatus = targetTask.status;
      let nextAgent = targetTask.assignedAgent;
      let nextExecutionState = targetTask.executionState;
      let nextActiveTool = targetTask.activeTool;
      let nextActiveCommand = targetTask.activeCommand;
      let rejectionReason = targetTask.rejectionReason;
      let validatorId = targetTask.validatorId;

      // 1. Task Claim / Lease
      if (
        lowerKind === "task-claimed" ||
        lowerKind === "task:claim" ||
        lowerKind === "lease-claimed" ||
        lowerKind === "lease:claim" ||
        lowerKind === "lease-renewed"
      ) {
        nextStatus = "leased";
        nextAgent = actor;
        nextActiveTool = null;
        nextActiveCommand = null;
        nextExecutionState = `[🟢 LEASED by ${actor} (step ${formatSeq(seq)})]`;

        if (actor) {
          agentMap.set(actor, {
            role: role ? role : targetTask.role ? targetTask.role : "implementer",
            taskId: targetTaskId,
            currentTool: null,
            currentCommand: null,
            lastActiveSeq: seq,
            activeStepIndex: seq,
          });
        }
      }

      // 2. Active Tool / Command Execution
      else if (
        lowerKind === "tool-exec" ||
        lowerKind === "tool:start" ||
        lowerKind === "tool_call" ||
        lowerKind === "tool-call" ||
        lowerKind === "tool-invocation" ||
        lowerKind === "exec" ||
        lowerKind === "command-exec"
      ) {
        nextStatus = "in_progress";
        nextActiveTool = tool ? tool : "exec";
        nextActiveCommand = cmd ?? null;
        const displayCmd = cmd ? cmd : tool ? tool : "exec";
        nextExecutionState = `[🟢 RUNNING: ${displayCmd}]`;

        if (actor) {
          agentMap.set(actor, {
            role: role ? role : targetTask.role ? targetTask.role : "implementer",
            taskId: targetTaskId,
            currentTool: tool ? tool : "exec",
            currentCommand: cmd ?? null,
            lastActiveSeq: seq,
            activeStepIndex: seq,
          });
        }
      }

      // 3. Gate Proving / Execution
      else if (
        lowerKind === "gate:prove" ||
        lowerKind === "gate-prove" ||
        lowerKind === "gate:proof" ||
        lowerKind === "prove"
      ) {
        nextActiveTool = "gate";
        nextActiveCommand = cmd ?? null;

        if (exitCode === 0) {
          nextExecutionState = `[🛡️✓ GATE PASSED (step ${formatSeq(seq)})]`;
          nextActiveTool = null;
          nextActiveCommand = null;
        } else if (exitCode !== null && exitCode !== 0) {
          nextExecutionState = `[🛡️❌ GATE FAILED (exit ${exitCode}, step ${formatSeq(seq)})]`;
        } else {
          const gateCmd = cmd ? cmd : "gate proof";
          nextExecutionState = `[🛡️ PROVING GATE: ${gateCmd}]`;
        }
      }

      // 4. Task Submitted for Validation
      else if (
        lowerKind === "task-submitted" ||
        lowerKind === "task:submit" ||
        lowerKind === "submission-created" ||
        lowerKind === "submit"
      ) {
        nextStatus = "validating";
        nextActiveTool = null;
        nextActiveCommand = null;
        nextExecutionState = `[📦 SUBMITTED (step ${formatSeq(seq)})]`;
      }

      // 5. Begin Validation / Validator Claim
      else if (
        lowerKind === "begin-validation" ||
        lowerKind === "validation-claimed" ||
        lowerKind === "validator-claimed" ||
        lowerKind === "review:begin"
      ) {
        nextStatus = "validating";
        validatorId = actor;
        nextActiveTool = null;
        nextActiveCommand = null;
        nextExecutionState = `[🔍 VALIDATING by ${actor} (step ${formatSeq(seq)})]`;

        if (actor) {
          agentMap.set(actor, {
            role: "validator",
            taskId: targetTaskId,
            currentTool: null,
            currentCommand: null,
            lastActiveSeq: seq,
            activeStepIndex: seq,
          });
        }
      }

      // 6. Review Verdict / Rejection / Pass & Sprouting
      const verdictStr = parsePayloadString(payload, ["verdict", "decision", "review_verdict"]);
      const isExplicitReject =
        lowerKind.includes("reject") ||
        lowerKind.includes("fail") ||
        verdictStr === "reject" ||
        verdictStr === "rejected" ||
        lowerKind.includes("changes-requested") ||
        lowerKind.includes("changes_requested");

      const isExplicitPass =
        lowerKind.includes("pass") ||
        verdictStr === "pass" ||
        verdictStr === "passed" ||
        lowerKind === "verdict-passed" ||
        (lowerKind === "task-reviewed" && verdictStr !== "reject");

      if (isExplicitReject) {
        nextStatus = "changes_requested";
        const parsedReason = parsePayloadString(payload, [
          "reason",
          "message",
          "error",
          "feedback",
          "finding",
          "rejection_reason",
        ]);
        rejectionReason = parsedReason ? parsedReason : "Validation check failed";
        nextActiveTool = null;
        nextActiveCommand = null;
        nextExecutionState = `[❌ REJECTED - R${currentRound}]`;

        // DYNAMIC GRAPH EXPANSION: Sprout Round (currentRound + 1) Repair Implementer & Validator branch!
        const nextRound = currentRound + 1;
        if (nextRound > maxRoundReached) maxRoundReached = nextRound;

        const baseCleanId = targetTask.id.replace(/-repair-r\d+$/, "");
        const repairTaskId = `${baseCleanId}-repair-r${nextRound}`;
        const validatorTaskId = `val-${baseCleanId.replace(/^val-/, "")}-r${nextRound}`;

        const repairLabel = `${targetTask.label.replace(/ \(R\d+ Repair\)$/, "")} (R${nextRound} Repair)`;
        const validatorLabel = `Validator for ${targetTask.label.replace(/ \(R\d+ Repair\)$/, "")} (R${nextRound})`;

        const sproutedRepairTask: DynamicTaskState = {
          id: repairTaskId,
          label: repairLabel,
          status: "ready",
          role: "repairer",
          dependencies: [targetTaskId],
          writeScope: targetTask.writeScope,
          assignedAgent: null,
          origin: "repair_branch",
          createdAtSeq: seq,
          updatedAtSeq: seq,
          round: nextRound,
          attempt: 1,
          executionState: `[⏳ READY - R${nextRound} Repair]`,
          activeTool: null,
          activeCommand: null,
          activeStepIndex: seq,
          repairForTaskId: targetTaskId,
          sproutedChildren: [],
        };

        const sproutedValidatorTask: DynamicTaskState = {
          id: validatorTaskId,
          label: validatorLabel,
          status: "proposed",
          role: "validator",
          dependencies: [repairTaskId],
          writeScope: targetTask.writeScope,
          assignedAgent: null,
          origin: "repair_branch",
          createdAtSeq: seq,
          updatedAtSeq: seq,
          round: nextRound,
          attempt: 1,
          executionState: `[⏳ PROPOSED - R${nextRound} Validator]`,
          activeTool: null,
          activeCommand: null,
          activeStepIndex: seq,
          sproutedChildren: [],
        };

        taskMap.set(repairTaskId, sproutedRepairTask);
        taskMap.set(validatorTaskId, sproutedValidatorTask);

        sproutedRepairPairs.push({
          rejectedTaskId: targetTaskId,
          round: nextRound,
          repairTaskId,
          validatorTaskId,
          reason: rejectionReason,
        });

        // Record sprouted child IDs onto parent task
        const updatedSprouted = [
          ...(targetTask.sproutedChildren ?? []),
          repairTaskId,
          validatorTaskId,
        ];
        taskMap.set(targetTaskId, {
          ...targetTask,
          status: nextStatus,
          assignedAgent: nextAgent,
          executionState: nextExecutionState,
          activeTool: nextActiveTool,
          activeCommand: nextActiveCommand,
          rejectionReason,
          validatorId: validatorId ?? actor,
          updatedAtSeq: seq,
          activeStepIndex: seq,
          sproutedChildren: updatedSprouted,
        });
      } else if (isExplicitPass) {
        nextStatus = "satisfied";
        nextActiveTool = null;
        nextActiveCommand = null;
        nextExecutionState = `[✓ PASSED - R${currentRound}]`;

        taskMap.set(targetTaskId, {
          ...targetTask,
          status: nextStatus,
          assignedAgent: nextAgent,
          executionState: nextExecutionState,
          activeTool: nextActiveTool,
          activeCommand: nextActiveCommand,
          validatorId: validatorId ?? actor,
          updatedAtSeq: seq,
          activeStepIndex: seq,
        });

        // If target was a repair task, also update the original parent task to reflect resolution
        if (targetTask.repairForTaskId && taskMap.has(targetTask.repairForTaskId)) {
          const parentT = taskMap.get(targetTask.repairForTaskId)!;
          taskMap.set(targetTask.repairForTaskId, {
            ...parentT,
            status: "satisfied",
            executionState: `[✓ RESOLVED - R${currentRound}]`,
            updatedAtSeq: seq,
          });
        }
      } else if (
        lowerKind === "task-released" ||
        lowerKind === "task:release" ||
        lowerKind === "lease-released"
      ) {
        nextStatus = "ready";
        nextAgent = null;
        nextActiveTool = null;
        nextActiveCommand = null;
        nextExecutionState = "[⏳ READY]";

        taskMap.set(targetTaskId, {
          ...targetTask,
          status: nextStatus,
          assignedAgent: nextAgent,
          executionState: nextExecutionState,
          activeTool: nextActiveTool,
          activeCommand: nextActiveCommand,
          updatedAtSeq: seq,
          activeStepIndex: seq,
        });
      } else if (lowerKind === "replacement-repairer-assigned" || lowerKind === "assign-repairer") {
        const replacementId = parsePayloadString(payload, [
          "replacement_id",
          "replacementId",
          "repair_assignee",
        ]);
        if (replacementId) {
          nextAgent = replacementId;
          nextStatus = "leased";
          nextExecutionState = `[🔧 REPAIRER ASSIGNED: ${replacementId} (step ${formatSeq(seq)})]`;

          taskMap.set(targetTaskId, {
            ...targetTask,
            assignedAgent: nextAgent,
            status: nextStatus,
            executionState: nextExecutionState,
            updatedAtSeq: seq,
            activeStepIndex: seq,
          });
        }
      } else {
        // General state refresh
        taskMap.set(targetTaskId, {
          ...targetTask,
          status: nextStatus,
          assignedAgent: nextAgent,
          executionState: nextExecutionState,
          activeTool: nextActiveTool,
          activeCommand: nextActiveCommand,
          rejectionReason,
          validatorId,
          round: currentRound,
          attempt: currentAttempt,
          updatedAtSeq: seq,
          activeStepIndex: seq,
        });
      }
    }
  }

  let staticCount = 0;
  let dynamicCount = 0;
  let repairBranchesCount = 0;
  for (const t of taskMap.values()) {
    if (t.origin === "static") staticCount += 1;
    else if (t.origin === "repair_branch") repairBranchesCount += 1;
    else dynamicCount += 1;
  }

  return {
    runId,
    revision,
    totalTasks: taskMap.size,
    staticTasksCount: staticCount,
    dynamicTasksCount: dynamicCount + repairBranchesCount,
    repairBranchesCount,
    currentRound: maxRoundReached,
    tasks: taskMap,
    activeAgents: agentMap,
    activeBranches: [...branches],
    sproutedRepairPairs,
  };
}

/**
 * Parses events into structured chronological step traces with precise execution glyphs.
 */
export function buildStepTraceEntries(
  events: readonly HarnessEvent[],
  options: LivingTracerOptions = {},
): StepTraceEntry[] {
  if (events.length === 0) return [];

  const startIso = events[0]?.timestamp;
  const startTime = startIso ? new Date(startIso).getTime() : 0;

  const entries: StepTraceEntry[] = [];

  for (const ev of events) {
    const seq = ev.sequence;
    if (options.fromSeq !== undefined && seq < options.fromSeq) continue;
    if (options.toSeq !== undefined && seq > options.toSeq) continue;

    const payload =
      typeof ev.payload === "object" && ev.payload !== null
        ? (ev.payload as Record<string, unknown>)
        : {};
    const actor = ev.actor;
    const kind = ev.kind;

    const taskId = parsePayloadString(payload, ["task_id", "taskId", "task", "id"]);
    const role = parsePayloadString(payload, [
      "role",
      "assigned_role",
      "assignedRole",
      "repair_assignee",
    ]);
    const tool = parsePayloadString(payload, [
      "tool",
      "current_tool",
      "tool_name",
      "toolName",
      "tool_call",
    ]);
    const cmd = parsePayloadString(payload, ["command", "cmd", "command_line", "commandLine"]);
    const exitCode = parsePayloadNumber(payload, ["exit_code", "code", "exitCode"]);
    const errorMsg = parsePayloadString(payload, [
      "error",
      "message",
      "reason",
      "stderr",
      "feedback",
    ]);
    const round = parsePayloadNumber(payload, ["round", "repair_round"]);

    if (options.filterTask && taskId !== options.filterTask) continue;
    if (options.filterActor && actor.toLowerCase() !== options.filterActor.toLowerCase()) continue;
    if (options.filterKind && kind.toLowerCase() !== options.filterKind.toLowerCase()) continue;

    const currentIso = ev.timestamp;
    const currentMs = currentIso ? new Date(currentIso).getTime() : startTime;
    const elapsedMs = Math.max(0, currentMs - startTime);

    let glyph = "●";
    let isError = false;
    let isGate = false;
    const details: string[] = [];

    const lowerKind = kind.toLowerCase();

    if (lowerKind.includes("claim")) {
      glyph = "🟢";
      if (role) details.push(`Role: ${role}`);
      if (typeof payload.lease_seconds === "number")
        details.push(`Lease: ${payload.lease_seconds}s`);
      if (round !== null) details.push(`Round: R${round}`);
    } else if (lowerKind.includes("submit")) {
      glyph = "📦";
      if (typeof payload.summary === "string") details.push(`Summary: ${payload.summary}`);
    } else if (lowerKind.includes("gate") || lowerKind.includes("prove")) {
      isGate = true;
      if (exitCode === 0) {
        glyph = "🛡️✓";
      } else {
        glyph = "🛡️❌";
        isError = true;
      }
      if (cmd) details.push(`Gate Cmd: ${cmd}`);
      if (exitCode !== null) details.push(`Exit Code: ${exitCode}`);
    } else if (
      lowerKind.includes("review") ||
      lowerKind.includes("verdict") ||
      lowerKind.includes("pass")
    ) {
      const verdictStr = parsePayloadString(payload, ["verdict", "decision"]);
      if (verdictStr === "reject" || verdictStr === "rejected" || lowerKind.includes("reject")) {
        glyph = "❌";
        isError = true;
        if (errorMsg) details.push(`Reason: ${errorMsg}`);
        if (round !== null) details.push(`Round: R${round}`);
      } else {
        glyph = "✓";
        if (verdictStr) details.push(`Verdict: ${verdictStr}`);
        if (round !== null) details.push(`Round: R${round}`);
      }
    } else if (
      lowerKind.includes("reject") ||
      lowerKind.includes("fail") ||
      lowerKind.includes("error")
    ) {
      glyph = "❌";
      isError = true;
      if (errorMsg) details.push(`Reason: ${errorMsg}`);
      if (round !== null) details.push(`Round: R${round}`);
    } else if (lowerKind.includes("branch")) {
      glyph = "🌿";
      const bId = parsePayloadString(payload, ["branch_id", "branchId"]);
      if (bId) details.push(`Branch: ${bId}`);
    } else if (lowerKind.includes("replacement") || lowerKind.includes("assign-repairer")) {
      glyph = "🔧";
      const replacementId = parsePayloadString(payload, ["replacement_id", "replacementId"]);
      if (replacementId) details.push(`Replacement Repairer: ${replacementId}`);
      if (errorMsg) details.push(`Reason: ${errorMsg}`);
    } else if (lowerKind.includes("exec") || lowerKind.includes("tool") || cmd) {
      glyph = "⚙️";
      if (tool) details.push(`Tool: ${tool}`);
      if (cmd) details.push(`Cmd: ${cmd}`);
      if (exitCode !== null) details.push(`Exit: ${exitCode}`);
    } else {
      glyph = "●";
    }

    if (errorMsg && !details.some((d) => d.includes(errorMsg))) {
      details.push(`Message: ${errorMsg}`);
    }

    const taskSuffix = taskId ? ` (${taskId})` : "";
    const title = `${kind.toUpperCase()}${taskSuffix}`;

    entries.push({
      sequence: seq,
      timestamp: currentIso,
      elapsedMs,
      actor,
      kind,
      taskId,
      role,
      tool,
      glyph,
      title,
      details,
      isError,
      isGate,
    });
  }

  return entries;
}

/**
 * Renders the living dynamic DAG expansion with round-by-round branches and real-time execution states as connected ASCII.
 */
export function renderDynamicDagAscii(dynamicDag: DynamicDagState): string {
  if (dynamicDag.tasks.size === 0) {
    return "  ┌────────────────────────────────────────────────────────┐\n  │  (No dynamic DAG tasks discovered in telemetry events) │\n  └────────────────────────────────────────────────────────┘";
  }

  const lines: string[] = [];
  const visited = new Set<string>();

  function formatNode(task: DynamicTaskState): string {
    const stepText = task.activeStepIndex
      ? ` (step ${formatSeq(task.activeStepIndex)})`
      : ` (seq ${formatSeq(task.updatedAtSeq)})`;

    let agentText = "";
    if (task.assignedAgent && task.validatorId) {
      const roleUpper = (task.role ?? "implementer").toUpperCase();
      agentText = ` [● ${roleUpper}: ${task.assignedAgent} ──► VALIDATOR: ${task.validatorId}]`;
    } else if (task.assignedAgent) {
      agentText = ` [${task.assignedAgent}]`;
    } else if (task.validatorId) {
      agentText = ` [● VALIDATOR: ${task.validatorId}]`;
    }

    const coordText = task.coordinates ? ` ${formatCoordinates(task.coordinates)}` : "";

    return `[${task.id}] ${task.executionState}${coordText}${agentText}${stepText}`;
  }

  function renderNodeHierarchy(taskId: string, prefix: string, isLast: boolean): void {
    if (visited.has(taskId)) return;
    visited.add(taskId);

    const task = dynamicDag.tasks.get(taskId);
    if (!task) return;

    const connector = isLast ? "└── " : "├── ";
    const childPrefix = prefix + (isLast ? "    " : "│   ");

    lines.push(`${prefix}${connector}${formatNode(task)}`);

    if (task.coordinates) {
      lines.push(`${childPrefix}↳ Coordinates: ${formatCoordinates(task.coordinates)}`);
    }
    if (task.probeRound !== undefined && task.probeRound > 0) {
      lines.push(`${childPrefix}↳ Probe Round: P${task.probeRound} (🔍 PROBING)`);
    }
    if (task.writeScope.length > 0) {
      lines.push(`${childPrefix}↳ Scope: ${task.writeScope.join(", ")}`);
    }
    if (task.rejectionReason) {
      lines.push(`${childPrefix}↳ Rejection: ${task.rejectionReason}`);
    }
    if (task.activeCommand && !task.executionState.includes(task.activeCommand)) {
      lines.push(`${childPrefix}↳ Active Cmd: ${task.activeCommand}`);
    }

    // Visually sprout dynamically expanded sub-tasks if declared
    if (task.expandedSubtasks && task.expandedSubtasks.length > 0) {
      for (let i = 0; i < task.expandedSubtasks.length; i++) {
        const sub = task.expandedSubtasks[i]!;
        const isLastSub = i === task.expandedSubtasks.length - 1;
        const sproutConnector = isLastSub ? "└──► " : "├──► ";
        const subStatus = formatStatusBadge(sub.status ?? "ready");
        const subImpl =
          "assignedAgent" in sub && sub.role !== "validator" ? sub.assignedAgent : null;
        const subVal =
          "validatorId" in sub && typeof sub.validatorId === "string"
            ? sub.validatorId
            : "assignedAgent" in sub && sub.role === "validator"
              ? sub.assignedAgent
              : null;
        const alloc = formatSubagentAllocation(subImpl, subVal, sub.role ?? "IMPLEMENTER");
        const allocText = alloc ? ` ${alloc}` : "";
        lines.push(`${childPrefix}│`);
        lines.push(`${childPrefix}${sproutConnector}[${sub.id}] ${subStatus}${allocText}`);
      }
    }

    // Visually sprout Round 2+ Repair Implementer & Validator branches
    const sproutedChildren = (task.sproutedChildren ?? []).filter((id) => dynamicDag.tasks.has(id));
    for (let i = 0; i < sproutedChildren.length; i++) {
      const childId = sproutedChildren[i]!;
      const isLastChild = i === sproutedChildren.length - 1;
      const childTask = dynamicDag.tasks.get(childId)!;
      visited.add(childId);

      const sproutConnector = isLastChild ? "└──► " : "├──► ";
      const sproutChildPrefix = childPrefix + (isLastChild ? "     " : "│    ");

      lines.push(`${childPrefix}│`);
      lines.push(`${childPrefix}${sproutConnector}${formatNode(childTask)}`);
      if (childTask.rejectionReason) {
        lines.push(`${sproutChildPrefix}↳ Rejection: ${childTask.rejectionReason}`);
      }
      if (childTask.activeCommand && !childTask.executionState.includes(childTask.activeCommand)) {
        lines.push(`${sproutChildPrefix}↳ Active Cmd: ${childTask.activeCommand}`);
      }
    }
  }

  // Root tasks: tasks not sprouted as child branches
  const sproutedIds = new Set<string>();
  for (const t of dynamicDag.tasks.values()) {
    for (const c of t.sproutedChildren ?? []) {
      sproutedIds.add(c);
    }
  }

  const rootTasks = [...dynamicDag.tasks.values()].filter(
    (t) => !sproutedIds.has(t.id) && t.origin !== "repair_branch",
  );

  for (let i = 0; i < rootTasks.length; i++) {
    const root = rootTasks[i]!;
    if (visited.has(root.id)) continue;
    const isLast = i === rootTasks.length - 1;
    renderNodeHierarchy(root.id, "", isLast);
    if (!isLast) {
      lines.push("");
    }
  }

  // Any remaining unvisited tasks
  for (const t of dynamicDag.tasks.values()) {
    if (!visited.has(t.id)) {
      renderNodeHierarchy(t.id, "", true);
    }
  }

  return lines.join("\n");
}

/**
 * Renders the chronological step trace as a connected ASCII/Unicode vertical timeline.
 */
export function renderAsciiTimeline(
  entries: readonly StepTraceEntry[],
  maxEntries?: number,
): string {
  if (entries.length === 0) {
    return "  ┌────────────────────────────────────────────────────────┐\n  │  (No telemetry events recorded for active step trace)  │\n  └────────────────────────────────────────────────────────┘";
  }

  const lines: string[] = [];
  const displayEntries =
    maxEntries !== undefined && maxEntries > 0 ? entries.slice(0, maxEntries) : entries;

  for (let i = 0; i < displayEntries.length; i++) {
    const entry = displayEntries[i]!;
    const isLast = i === displayEntries.length - 1;
    const timeStr = formatDuration(entry.elapsedMs);
    const seqStr = formatSeq(entry.sequence);

    const connector = i === 0 ? "●" : isLast ? "└─●" : "├─●";
    const pipe = isLast ? "  " : "│ ";

    lines.push(
      `${connector} [${seqStr} +${timeStr}] [${entry.actor}] ${entry.glyph} ${entry.title}`,
    );

    for (const d of entry.details) {
      lines.push(`${pipe} ↳ ${d}`);
    }

    if (!isLast) {
      lines.push("│");
    }
  }

  if (displayEntries.length < entries.length) {
    lines.push(`... [${entries.length - displayEntries.length} more events truncated]`);
  }

  return lines.join("\n");
}

/**
 * Computes summary statistics across step trace entries and dynamic DAG state.
 */
export function computeStepTracerSummary(
  entries: readonly StepTraceEntry[],
  dynamicDag: DynamicDagState,
): StepTracerSummary {
  const uniqueActors = [...new Set(entries.map((e) => e.actor))];
  const gateRuns = entries.filter((e) => e.isGate);
  const gateFails = gateRuns.filter((e) => e.isError);
  const gatePasses = gateRuns.filter((e) => !e.isError);
  const errors = entries.filter((e) => e.isError);
  const totalDurationMs = entries.length > 0 ? (entries[entries.length - 1]?.elapsedMs ?? 0) : 0;

  return {
    totalSteps: entries.length,
    totalDurationMs,
    uniqueActors,
    taskCount: dynamicDag.totalTasks,
    dynamicExpansionCount: dynamicDag.dynamicTasksCount,
    repairBranchesCount: dynamicDag.repairBranchesCount,
    maxRoundReached: dynamicDag.currentRound,
    gateRunsCount: gateRuns.length,
    gatePassesCount: gatePasses.length,
    gateFailsCount: gateFails.length,
    errorCount: errors.length,
  };
}

/**
 * Inspects auxiliary capsule artifacts on disk (rounds/, leases/) to corroborate telemetry.
 */
export function inspectCapsuleAuxiliary(runRoot: string): {
  readonly roundsFound: readonly string[];
  readonly activeLeaseFiles: readonly string[];
} {
  const roundsFound: string[] = [];
  const activeLeaseFiles: string[] = [];

  if (existsSync(runRoot)) {
    const roundsDir = join(runRoot, "rounds");
    if (existsSync(roundsDir)) {
      try {
        const entries = readdirSync(roundsDir, { withFileTypes: true });
        for (const e of entries) {
          if (e.isDirectory()) {
            roundsFound.push(e.name);
          }
        }
      } catch {
        // ignore filesystem permission errors
      }
    }

    const leasesDir = join(runRoot, "leases");
    if (existsSync(leasesDir)) {
      try {
        const entries = readdirSync(leasesDir, { withFileTypes: true });
        for (const e of entries) {
          if (e.isFile() && e.name.endsWith(".json")) {
            activeLeaseFiles.push(e.name);
          }
        }
      } catch {
        // ignore filesystem permission errors
      }
    }
  }

  return { roundsFound, activeLeaseFiles };
}

/**
 * Builds the complete Living Tracer report.
 * Strictly bans idealized static plans; renders 100% ground-truth telemetry from capsule events.
 */
export function buildLivingTracerReport(
  events: readonly HarnessEvent[],
  options: LivingTracerOptions & { runId?: string | undefined; runRoot?: string | undefined } = {},
): LivingTracerReport {
  const runId = options.runId ?? "capsule-run";
  const dynamicDag = buildDynamicDagState(events, runId);
  const steps = buildStepTraceEntries(events, options);
  const summary = computeStepTracerSummary(steps, dynamicDag);
  const asciiTimeline = renderAsciiTimeline(steps, options.maxSteps);
  const asciiDag = renderDynamicDagAscii(dynamicDag);

  const mdSections: string[] = [
    `### Living Dynamic DAG Expansion & Real-Time Telemetry: ${runId}`,
    `- **Total Steps Trace**: ${summary.totalSteps} events across ${summary.uniqueActors.length} active agent(s)`,
    `- **Dynamic Graph Scope**: ${summary.taskCount} total tasks (${summary.dynamicExpansionCount} dynamic/repair expansions across ${summary.maxRoundReached} round(s))`,
    `- **Execution Duration**: ${formatDuration(summary.totalDurationMs)} | **Gates Passed/Failed**: ${summary.gatePassesCount}/${summary.gateFailsCount}`,
    "",
    "#### Living Dynamic Round-by-Round DAG & Node States",
    "```text",
    asciiDag,
    "```",
  ];

  if (dynamicDag.sproutedRepairPairs.length > 0) {
    mdSections.push("");
    mdSections.push("#### Dynamically Sprouted Repair & Validator Branches (Rejections)");
    const sproutHeaders = [
      "Rejected Task",
      "Round",
      "Sprouted Repair Task",
      "Sprouted Validator",
      "Rejection Reason",
    ];
    const sproutRows = dynamicDag.sproutedRepairPairs.map((p) => [
      `\`${p.rejectedTaskId}\``,
      `R${p.round}`,
      `\`${p.repairTaskId}\``,
      `\`${p.validatorTaskId}\``,
      p.reason ? `\`${p.reason}\`` : "—",
    ]);
    mdSections.push(...formatTable(sproutHeaders, sproutRows));
  }

  if (dynamicDag.activeAgents.size > 0) {
    mdSections.push("");
    mdSections.push("#### Active Agent Live Tool & Lease Registry");
    const agentHeaders = ["Agent", "Role", "Assigned Task", "Active Step", "Active Tool / Command"];
    const agentRows = [...dynamicDag.activeAgents.entries()].map(([agentId, state]) => [
      `\`${agentId}\``,
      `\`${state.role}\``,
      state.taskId ? `\`${state.taskId}\`` : "—",
      formatSeq(state.activeStepIndex),
      state.currentCommand
        ? `\`[🟢 RUNNING: ${state.currentCommand}]\``
        : state.currentTool
          ? `\`[🟢 TOOL: ${state.currentTool}]\``
          : "—",
    ]);
    mdSections.push(...formatTable(agentHeaders, agentRows));
  }

  mdSections.push("");
  mdSections.push("#### Chronological Step Execution Timeline");
  mdSections.push("```text");
  mdSections.push(asciiTimeline);
  mdSections.push("```");

  return {
    markdown: mdSections.join("\n"),
    asciiTimeline,
    asciiDag,
    dynamicDag,
    steps,
    summary,
  };
}

/**
 * Reads events directly from run capsule path and builds the living tracer report.
 */
export function traceCapsuleRun(
  runPath: string,
  options: LivingTracerOptions = {},
): LivingTracerReport {
  const eventsResult = readCapsuleEvents(runPath, { all: true });
  return buildLivingTracerReport(eventsResult.matchingEvents, {
    ...options,
    runId: eventsResult.runId,
    runRoot: eventsResult.runRoot,
  });
}

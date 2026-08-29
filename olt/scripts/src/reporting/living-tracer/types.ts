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

export interface ReplayContext {
  readonly taskMap: Map<string, DynamicTaskState>;
  readonly agentMap: Map<string, ActiveAgentState>;
  readonly branches: Set<string>;
  readonly sproutedRepairPairs: SproutedRepairPair[];
  revision: number;
  maxRoundReached: number;
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

export function parsePayloadString(
  payload: Record<string, unknown> | undefined | null,
  keys: string | readonly string[],
): string | null {
  if (!payload || typeof payload !== "object") return null;
  const keyList = typeof keys === "string" ? [keys] : keys;
  for (const k of keyList) {
    const val = payload[k];
    if (typeof val === "string" && val.trim().length > 0) {
      return val.trim();
    }
  }
  return null;
}

export function parsePayloadNumber(
  payload: Record<string, unknown> | undefined | null,
  keys: string | readonly string[],
): number | null {
  if (!payload || typeof payload !== "object") return null;
  const keyList = typeof keys === "string" ? [keys] : keys;
  for (const k of keyList) {
    const val = payload[k];
    if (typeof val === "number" && !Number.isNaN(val)) {
      return val;
    }
  }
  return null;
}

export function parsePayloadStringArray(
  payload: Record<string, unknown> | undefined | null,
  key: string,
): readonly string[] {
  if (!payload || typeof payload !== "object") return [];
  const val = payload[key];
  if (Array.isArray(val) && val.every((item) => typeof item === "string")) {
    return val as readonly string[];
  }
  return [];
}

export function formatSeq(seq: number): string {
  return `#${seq.toString().padStart(3, "0")}`;
}

export function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  const milli = Math.floor((ms % 1000) / 10);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(min)}:${pad(sec)}.${pad(milli)}`;
}

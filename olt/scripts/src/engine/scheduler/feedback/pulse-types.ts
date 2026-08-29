import { ScriptBackedDiagnosticsResult, ScriptBackedDiagnosticsOptions, GraphHealthAuditReport, Supervisory5PointHealthReport, SupervisoryProbeDispatchResult, TaskRecoveryResult, ScheduledTaskDispatch, CliDiagnosticReceipt } from "..";
import { Clock } from "../../../workflow/types";

export interface PulseTickOptions {
  readonly tickNumber?: number | undefined;
  readonly maxParallel?: number | null | undefined;
  readonly timeoutMs?: number | undefined;
  readonly heartbeatCadenceMs?: number | undefined;
  readonly clock?: Clock | undefined;
  readonly watchdogTarget?: string | undefined;
  readonly watchdogId?: string | undefined;
  readonly maxRepairRounds?: number | undefined;
  readonly autoRecoverStale?: boolean | undefined;
  readonly runRoot?: string | undefined;
  readonly dispatchLeaderProbe?: boolean | undefined;
  readonly assertDoctorGate?: boolean | undefined;
  readonly runDiagnostics?: boolean | undefined;
  readonly diagnosticsResult?: ScriptBackedDiagnosticsResult | undefined;
  readonly diagnosticsOptions?: ScriptBackedDiagnosticsOptions | undefined;
}
export interface PulseTickResult {
  readonly tickNumber: number;
  readonly timestamp: string;
  readonly graphHealthy: boolean;
  readonly auditReport: GraphHealthAuditReport;
  readonly supervisoryReport?: Supervisory5PointHealthReport | undefined;
  readonly probeDispatch?: SupervisoryProbeDispatchResult | undefined;
  readonly recoveryResult?: TaskRecoveryResult | undefined;
  readonly readyTasks: readonly ScheduledTaskDispatch[];
  readonly activeOccupiedTasks: readonly string[];
  readonly workflowCompleted: boolean;
  readonly diagnostics?: ScriptBackedDiagnosticsResult | undefined;
  readonly cliReceipts?: readonly CliDiagnosticReceipt[] | undefined;
  readonly cliReceiptSummaryBadge?: string | undefined;
  readonly dagBadges?: readonly string[] | undefined;
  readonly error?: string | undefined;
}
export interface PulseLoopOptions extends PulseTickOptions {
  readonly intervalMs?: number | undefined;
  readonly maxTicks?: number | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly stopWhenDone?: boolean | undefined;
  readonly onTick?: ((result: PulseTickResult) => void) | undefined;
  readonly onError?: ((error: Error, tickNumber: number) => void) | undefined;
  readonly onStop?: ((reason: string, totalTicks: number) => void) | undefined;
}
export interface PulseLoopResult {
  readonly totalTicks: number;
  readonly totalRecovered: number;
  readonly totalDispatched: number;
  readonly stoppedReason: "max_ticks_reached" | "workflow_completed" | "aborted" | "error";
  readonly durationMs: number;
  readonly lastTickResult?: PulseTickResult | undefined;
  readonly lastDiagnostics?: ScriptBackedDiagnosticsResult | undefined;
  readonly errors: readonly string[];
}

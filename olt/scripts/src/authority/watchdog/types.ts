export type WatchdogStatus = "active" | "stale" | "terminated" | "orphaned";

export interface WatchdogRecord {
  readonly id: string;
  readonly generation: number;
  readonly pulse_id: string | null;
  readonly phase: string;
  readonly run_id: string | null;
  readonly run_root: string | null;
  readonly pid: number;
  readonly ppid: number;
  readonly agent_id: string | null;
  readonly started_at: string;
  readonly last_heartbeat_at: string;
  readonly heartbeat_cadence_ms: number;
  readonly timeout_ms: number;
  readonly status: WatchdogStatus;
  readonly terminated_at: string | null;
  readonly termination_reason: string | null;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface WatchdogStore {
  readonly schema: "harness.watchdog_store";
  readonly version: 1;
  readonly updated_at: string;
  readonly watchdogs: readonly WatchdogRecord[];
}

export interface RegisterWatchdogOptions {
  readonly id?: string | undefined;
  readonly generation?: number | undefined;
  readonly pulse_id?: string | null | undefined;
  readonly phase?: string | undefined;
  readonly run_id?: string | null | undefined;
  readonly run_root?: string | null | undefined;
  readonly pid?: number | undefined;
  readonly ppid?: number | undefined;
  readonly agent_id?: string | null | undefined;
  readonly heartbeat_cadence_ms?: number | undefined;
  readonly timeout_ms?: number | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  readonly now?: string | number | Date | undefined;
}

export interface RegisterWatchdogResult {
  readonly watchdog: WatchdogRecord;
  readonly supersededWatchdogs: readonly WatchdogRecord[];
  readonly store: WatchdogStore;
}

export interface HeartbeatOptions {
  readonly now?: string | number | Date | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
  readonly phase?: string | undefined;
}

export interface TerminateOptions {
  readonly now?: string | number | Date | undefined;
  readonly reason?: string | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface ListWatchdogOptions {
  readonly generation?: number | undefined;
  readonly pulse_id?: string | null | undefined;
  readonly phase?: string | undefined;
  readonly status?: readonly WatchdogStatus[] | WatchdogStatus | undefined;
  readonly run_id?: string | null | undefined;
  readonly agent_id?: string | null | undefined;
}

export interface CleanupStaleOptions {
  readonly now?: string | number | Date | undefined;
  readonly maxAgeMs?: number | undefined;
  readonly markAs?: WatchdogStatus | undefined;
  readonly dryRun?: boolean | undefined;
  readonly reason?: string | undefined;
}

export interface CleanupStaleResult {
  readonly cleanedCount: number;
  readonly activeCount: number;
  readonly cleanedWatchdogs: readonly WatchdogRecord[];
  readonly dryRun: boolean;
  readonly store: WatchdogStore;
}

export interface TerminatePhaseOptions {
  readonly phase: string;
  readonly generation?: number | undefined;
  readonly pulse_id?: string | null | undefined;
  readonly excludeId?: string | undefined;
  readonly reason?: string | undefined;
  readonly dryRun?: boolean | undefined;
  readonly now?: string | number | Date | undefined;
}

export interface TerminatePhaseResult {
  readonly terminatedCount: number;
  readonly activeCount: number;
  readonly terminatedWatchdogs: readonly WatchdogRecord[];
  readonly dryRun: boolean;
  readonly store: WatchdogStore;
}

export interface CleanupPreviousPhaseOptions {
  readonly currentPhase: string;
  readonly generation?: number | undefined;
  readonly pulse_id?: string | null | undefined;
  readonly excludeId?: string | undefined;
  readonly dryRun?: boolean | undefined;
  readonly now?: string | number | Date | undefined;
}

export interface WatchdogViolation {
  readonly rule: string;
  readonly message: string;
  readonly watchdog_id?: string | undefined;
}

export interface VerifyWatchdogResult {
  readonly valid: boolean;
  readonly violations: readonly string[];
  readonly violationDetails: readonly WatchdogViolation[];
  readonly activeCount: number;
  readonly totalCount: number;
}

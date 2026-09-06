/**
 * Type definitions for the Liaison Daemon subsystem.
 *
 * Covers heartbeat payloads, freeze states, peer liveness states,
 * single-definition state projection schema, transition push notification events,
 * and daemon configuration and snapshot schemas.
 */

export type FreezeKind = "quota_freeze" | "graceful_shutdown" | "maintenance";

export interface FreezeState {
  readonly kind: FreezeKind;
  readonly reason: string;
  readonly entered_at: string;
  readonly expected_resume_at?: string | undefined;
}

export interface HeartbeatPayload {
  readonly sender_id: string;
  readonly sequence: number;
  readonly timestamp: string;
  readonly next_beat_interval_ms: number;
  readonly active_run_ids: readonly string[];
  readonly status: string;
  readonly freeze_state?: FreezeState | null | undefined;
}

export type PeerLivenessState = "alive" | "unreachable" | "frozen" | "unknown";

export interface PeerLivenessStatus {
  readonly peer_id: string;
  readonly state: PeerLivenessState;
  readonly last_heartbeat: HeartbeatPayload | null;
  readonly last_received_at: string | null;
  readonly consecutive_missed_beats: number;
  readonly declared_interval_ms: number;
  readonly freeze_state: FreezeState | null;
  readonly reason?: string | undefined;
}

export interface LivenessMonitorConfig {
  readonly missed_beat_threshold?: number | undefined;
  readonly default_interval_ms?: number | undefined;
  readonly clock?: (() => number) | undefined;
}

export interface TaskStateSummary {
  readonly id: string;
  readonly status: string;
  readonly label?: string | undefined;
  readonly write_scope?: readonly string[] | undefined;
  readonly lease_holder?: string | null | undefined;
  readonly lease_expires_at?: string | null | undefined;
}

export interface LeaseSummary {
  readonly task_id: string;
  readonly agent_id: string;
  readonly role: string;
  readonly issued_at: string;
  readonly expires_at: string;
  readonly heartbeat_at: string;
  readonly write_scope: readonly string[];
}

export interface GitStateSummary {
  readonly head: string | null;
  readonly branch: string | null;
  readonly dirty_count: number;
  readonly ahead: number;
  readonly behind: number;
  readonly available: boolean;
}

export interface RatchetMetric {
  readonly name: string;
  readonly value: number | string | boolean;
  readonly definition: string;
  readonly passed: boolean;
  readonly direction?: "increasing" | "decreasing" | "fixed" | undefined;
}

export interface LaneConcurrencyMetric {
  readonly lane_count: number;
  readonly distinct_implementer_count: number;
  readonly distinct_implementers: readonly string[];
  readonly ratio: number;
}

export interface StateProjection {
  readonly run_id: string;
  readonly projected_at: string;
  readonly run_state: string;
  readonly task_states: Readonly<Record<string, string>>;
  readonly tasks: readonly TaskStateSummary[];
  readonly lease_holders: readonly LeaseSummary[];
  readonly distinct_implementer_identities: readonly string[];
  readonly concurrency: LaneConcurrencyMetric;
  readonly capsule_event_count: number;
  readonly last_event_timestamp: string | null;
  readonly last_event_sequence: number | null;
  readonly git: GitStateSummary;
  readonly metrics: readonly RatchetMetric[];
}

export type TransitionEventType =
  | "task_state_changed"
  | "run_completed"
  | "verdict_recorded"
  | "heartbeat_lapse"
  | "freeze_state_changed";

export interface TaskStateChangeEvent {
  readonly type: "task_state_changed";
  readonly timestamp: string;
  readonly run_id: string;
  readonly task_id: string;
  readonly from_state: string;
  readonly to_state: string;
  readonly lease_holder?: string | null | undefined;
}

export interface RunCompletedEvent {
  readonly type: "run_completed";
  readonly timestamp: string;
  readonly run_id: string;
  readonly final_state: string;
}

export interface VerdictRecordedEvent {
  readonly type: "verdict_recorded";
  readonly timestamp: string;
  readonly run_id: string;
  readonly task_id?: string | undefined;
  readonly verdict: string;
  readonly passed: boolean;
  readonly actor: string;
}

export interface HeartbeatLapseEvent {
  readonly type: "heartbeat_lapse";
  readonly timestamp: string;
  readonly peer_id: string;
  readonly missed_beats: number;
  readonly declared_interval_ms: number;
}

export interface FreezeStateChangedEvent {
  readonly type: "freeze_state_changed";
  readonly timestamp: string;
  readonly peer_id: string;
  readonly previous_state: FreezeState | null;
  readonly current_state: FreezeState | null;
}

export type TransitionEvent =
  | TaskStateChangeEvent
  | RunCompletedEvent
  | VerdictRecordedEvent
  | HeartbeatLapseEvent
  | FreezeStateChangedEvent;

export type SubscriberCallback = (event: TransitionEvent) => void | Promise<void>;
export type UnsubscribeFunction = () => void;

export type GitRunner = (
  args: readonly string[],
  cwd: string,
) => {
  ok: boolean;
  stdout: string;
  stderr: string;
};

export interface DaemonConfig {
  readonly daemon_id: string;
  readonly capsule_dir: string;
  readonly repo_root: string;
  readonly heartbeat_interval_ms?: number | undefined;
  readonly missed_beat_threshold?: number | undefined;
  readonly active_run_ids?: readonly string[] | undefined;
  readonly peer_ids?: readonly string[] | undefined;
  readonly status?: string | undefined;
  readonly gitRunner?: GitRunner | undefined;
  readonly clock?: (() => number) | undefined;
}

export interface DaemonSnapshot {
  readonly daemon_id: string;
  readonly is_running: boolean;
  readonly last_emitted_heartbeat: HeartbeatPayload | null;
  readonly projection: StateProjection | null;
  readonly peer_liveness: Readonly<Record<string, PeerLivenessStatus>>;
  readonly degraded: boolean;
  readonly degraded_reason?: string | undefined;
}

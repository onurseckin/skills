export type DaemonLivenessState = "LIVE" | "IDLE" | "BACKPRESSURED" | "WEDGED" | "STOPPED";

export type DaemonWakesBySource = {
  readonly watch: number;
  readonly poll: number;
  readonly tick: number;
  readonly token: number;
};

export interface DaemonHealthRecord {
  readonly v: 1;
  readonly room: string;
  readonly reader: string;
  readonly pid: number;
  readonly start_time: string;
  readonly boot_id: string;
  readonly state: DaemonLivenessState;
  readonly last_wake_at: string;
  readonly last_wake_source: string;
  readonly last_delivered_seq: number;
  readonly room_head_seq: number;
  readonly lag_seqs: number;
  readonly watch_active: boolean;
  readonly watch_failures: number;
  readonly poll_interval_ms: number;
  readonly wakes_by_source?: DaemonWakesBySource;
  readonly spool_bytes: number;
  readonly spool_lines: number;
  readonly consumer_last_ack_at: string | null;
  readonly consumer_last_delivered_seq?: number | null;
  readonly consumer_lag_ms: number | null;
  readonly respawns_this_hour: number;
  readonly errors_recent: readonly string[];
  readonly updated_at?: string;
}

export type CursorAckProvenance = {
  readonly last_ack_at: string | null;
  readonly last_ack_kind: "spooled" | "explicit" | null;
};

export interface HealthComputeOptions {
  readonly wedgeAfterMs?: number;
  readonly heartbeatIntervalMs?: number;
  readonly isProcessAlive?: (pid: number) => boolean;
  readonly lagStuckSinceMs?: number | null;
  readonly isExplicitlyStopped?: boolean;
  readonly isBackpressured?: boolean;
  readonly cursor?: CursorAckProvenance | null;
}

export interface HealthPorts {
  readonly existsSync?: (path: string) => boolean;
  readonly readFileSync?: (path: string, encoding: string) => string;
  readonly writeAtomic?: (path: string, content: string) => void;
  readonly writeFileSync?: (path: string, content: string) => void;
  readonly fs?: { readonly existsSync?: (path: string) => boolean };
  readonly isProcessAlive?: (pid: number) => boolean;
  readonly daemonRespawnPath?: (room: string, reader: string) => string;
}

export interface HealthClaimOptions {
  readonly room: string;
  readonly reader: string;
  readonly pid: number;
  readonly startTime: string;
  readonly bootId?: string;
  readonly pollIntervalMs?: number;
  readonly isProcessAlive?: (pid: number) => boolean;
}

export type HealthMetrics = Pick<
  DaemonHealthRecord,
  "watch_active" | "watch_failures" | "poll_interval_ms"
> & {
  readonly wakes_by_source?: DaemonWakesBySource;
};

export interface HealthSyncInput {
  readonly healthPath: string;
  readonly nowIso: string;
  readonly metrics: HealthMetrics;
  readonly source?: string;
  readonly claim: HealthClaimOptions;
  readonly compute?: HealthComputeOptions;
  readonly ports?: HealthPorts;
  readonly cursor?: CursorAckProvenance | null;
}

export interface DaemonInspectionResult {
  readonly room: string;
  readonly reader: string;
  readonly state: DaemonLivenessState;
  readonly health: DaemonHealthRecord | null;
  readonly watch_active: boolean;
}

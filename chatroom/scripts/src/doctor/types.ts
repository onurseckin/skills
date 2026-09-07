import type { DaemonLivenessState } from "../daemon/index.ts";

export type { DaemonLivenessState };

export interface LeaseInfo {
  readonly lease: string;
  readonly from: number;
  readonly to: number;
  readonly issued_at: string;
  readonly expires_at: string;
  readonly attempt: number;
  readonly is_expired: boolean;
}

export interface ReaderHealthReport {
  readonly reader: string;
  readonly contiguous_seq: number;
  readonly head_seq: number;
  readonly lag: number;
  readonly held_leases: readonly LeaseInfo[];
  readonly expired_leases: readonly LeaseInfo[];
  readonly daemon_state: DaemonLivenessState;
  readonly daemon_pid: number | null;
  readonly is_daemon_alive: boolean;
  readonly last_heartbeat: string | null;
  readonly heartbeat_age_ms: number | null;
  readonly spool_bytes: number;
  readonly spool_lines: number;
  readonly is_orphan: boolean;
  readonly watch_active: boolean;
}

export interface LockReport {
  readonly path: string;
  readonly name: string;
  readonly pid: number | null;
  readonly holder: string | null;
  readonly is_stale: boolean;
  readonly reason: string | null;
  readonly mtime_ms: number;
}

export interface ManifestReport {
  readonly exists: boolean;
  readonly is_valid: boolean;
  readonly id: string | null;
  readonly title: string | null;
  readonly visibility: string | null;
  readonly key_fingerprint: string | null;
  readonly created_at: string | null;
  readonly errors: readonly string[];
}

export interface ProvisionReport {
  readonly host: string;
  readonly member: string;
  readonly path: string;
  readonly is_valid: boolean;
  readonly agent_exists: boolean;
  readonly daemon_alive: boolean;
  readonly cron_verified?: boolean;
  readonly cron_mechanism?: string;
  readonly drift_detected: boolean;
  readonly issues: readonly string[];
}

export interface RoomHealthReport {
  readonly room: string;
  readonly room_dir: string;
  readonly manifest: ManifestReport;
  readonly head_seq: number;
  readonly members: readonly string[];
  readonly readers: readonly ReaderHealthReport[];
  readonly locks: readonly LockReport[];
  readonly quarantined: number;
  readonly quarantined_lines: readonly string[];
  readonly quarantined_count: number;
  readonly orphan_cursors: readonly string[];
  readonly orphan_members: readonly string[];
  readonly provisioning: readonly ProvisionReport[];
  readonly provisioning_drift: boolean;
  readonly has_corrupt_layout: boolean;
  readonly is_healthy: boolean;
  readonly issues: readonly string[];
}

export interface DoctorInspectOptions {
  readonly room?: string;
  readonly as?: string;
  readonly reader?: string;
  readonly baseDir?: string;
  readonly now?: () => number;
  readonly isProcessAlive?: (pid: number) => boolean;
}

export interface DoctorInspectionResult {
  readonly rooms: readonly RoomHealthReport[];
  readonly is_healthy: boolean;
  readonly total_issues: number;
  readonly summary: string;
}

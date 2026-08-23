export const DEFAULT_WATCHDOG_HEARTBEAT_INTERVAL_MS = 180_000; // 3 minutes
export const DEFAULT_WATCHDOG_TIMEOUT_MS = 360_000; // 6 minutes (2x heartbeat interval)
export const DEFAULT_HEALTH_AUDIT_INTERVAL_MS = 180_000; // 3 minutes
export const DEFAULT_PROCESS_HEALTH_CHECK_INTERVAL_MS = 60_000; // 1 minute

export const DEFAULT_ADAPTIVE_MIN_INTERVAL_MS = 5_000; // 5 seconds
export const DEFAULT_ADAPTIVE_MAX_INTERVAL_MS = 180_000; // 3 minutes
export const DEFAULT_ADAPTIVE_BACKOFF_FACTOR = 1.5; // 1.5x idle backoff
export const DEFAULT_ADAPTIVE_ACTIVITY_BOOST = 0.5; // 0.5x interval reduction on activity burst

export const DEFAULT_MIN_HEARTBEAT_INTERVAL_MS = DEFAULT_ADAPTIVE_MIN_INTERVAL_MS;
export const DEFAULT_MAX_HEARTBEAT_INTERVAL_MS = DEFAULT_ADAPTIVE_MAX_INTERVAL_MS;
export const DEFAULT_BACKOFF_FACTOR = DEFAULT_ADAPTIVE_BACKOFF_FACTOR;
export const DEFAULT_ACTIVITY_BOOST = DEFAULT_ADAPTIVE_ACTIVITY_BOOST;

export const MANDATORY_BOOT_GATES = ["whoami", "doctor"] as const;
export type MandatoryBootGate = (typeof MANDATORY_BOOT_GATES)[number];

export const WATCHDOG_SEVERITIES = ["critical", "important", "warning", "info"] as const;
export type WatchdogSeverity = (typeof WATCHDOG_SEVERITIES)[number];

export const WATCHDOG_VIOLATION_TYPES = [
  "boot_gate_missing",
  "invalid_boot_gate_proof",
  "stalled_agent",
  "process_health_failure",
  "zombie_process_detected",
  "lease_expired",
  "tier_confinement_breach",
  "supervisor_code_contamination",
  "unresponsive_subagent",
] as const;
export type WatchdogViolationType = (typeof WATCHDOG_VIOLATION_TYPES)[number];

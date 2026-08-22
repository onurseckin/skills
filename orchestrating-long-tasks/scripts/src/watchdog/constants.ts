export const DEFAULT_WATCHDOG_HEARTBEAT_INTERVAL_MS = 180_000; // 3 minutes
export const DEFAULT_WATCHDOG_TIMEOUT_MS = 360_000; // 6 minutes (2x heartbeat interval)
export const DEFAULT_HEALTH_AUDIT_INTERVAL_MS = 180_000; // 3 minutes
export const DEFAULT_PROCESS_HEALTH_CHECK_INTERVAL_MS = 60_000; // 1 minute

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

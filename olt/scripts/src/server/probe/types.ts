/**
 * Type definitions for high-speed TCP port probing and socket conflict detection.
 */

export type IpFamily = "IPv4" | "IPv6";

export type ProbeStatus = "listening" | "free" | "timeout" | "refused" | "error";

export type SocketConflictStatus = "available" | "occupied" | "blocked" | "error";

/**
 * Structured result of a TCP port connection probe.
 */
export interface TcpProbeResult {
  readonly port: number;
  readonly inUse: boolean;
  readonly address: string;
  readonly family: IpFamily;
  readonly latencyMs: number;
  readonly status: ProbeStatus;
  readonly error?: string | undefined;
}

/**
 * Options for configuring a single TCP port probe.
 */
export interface ProbeOptions {
  readonly host?: string | undefined;
  readonly timeoutMs?: number | undefined;
}

/**
 * Options for multi-port batch probing.
 */
export interface MultiProbeOptions extends ProbeOptions {
  readonly concurrency?: number | undefined;
}

/**
 * Structured result of a socket binding conflict check.
 */
export interface SocketConflictResult {
  readonly port: number;
  readonly address: string;
  readonly family: IpFamily;
  readonly status: SocketConflictStatus;
  readonly inUse: boolean;
  readonly available: boolean;
  readonly error?: string | undefined;
}

/**
 * Options for socket conflict detection.
 */
export interface ConflictDetectionOptions {
  readonly host?: string | undefined;
}

/**
 * Result of comprehensive multi-interface port inspection.
 */
export interface ComprehensivePortStatus {
  readonly port: number;
  readonly inUse: boolean;
  readonly available: boolean;
  readonly probeResults: readonly TcpProbeResult[];
  readonly conflictResults: readonly SocketConflictResult[];
}

/**
 * TCP Port Probe & Socket Conflict Detector Subsystem.
 *
 * Provides high-speed non-blocking TCP port probing, socket binding conflict detection,
 * IPv4 / IPv6 interface checks, timeout resilience, and rich diagnostic occupancy info.
 */

export type {
  ComprehensivePortStatus,
  ConflictDetectionOptions,
  IpFamily,
  MultiProbeOptions,
  ProbeOptions,
  ProbeStatus,
  SocketConflictResult,
  SocketConflictStatus,
  TcpProbeResult,
} from "./types.ts";

export {
  COMMON_INTERFACES,
  DEFAULT_PROBE_HOST,
  DEFAULT_PROBE_TIMEOUT_MS,
  chunkArray,
  isIpv6,
  normalizeHost,
  resolveFamily,
  validatePort,
} from "./utils.ts";

export {
  isPortInUse,
  probeAddressFamilies,
  probeAllInterfaces,
  probePorts,
  probeTcpPort,
} from "./tcp-probe.ts";

export {
  checkPortAvailability,
  detectInterfaceConflicts,
  detectSocketConflict,
  findAvailablePort,
  inspectComprehensivePort,
} from "./conflict-detector.ts";

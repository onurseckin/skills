/**
 * Local Node/Bun PID & Zombie Process Reclaimer Subsystem.
 *
 * Provides PID ownership inspection on ports, process tree inspection,
 * orphaned/zombie detection, and safe reclamation with graceful SIGTERM/SIGKILL escalation.
 */

export type {
  CommandExecutionResult,
  CommandExecutor,
  PortProcessOccupancy,
  ProcessDetails,
  ProcessInspectorOptions,
  ReclaimOptions,
  ReclaimResult,
  ReclaimSignal,
} from "./types.ts";

export {
  defaultCommandExecutor,
  extractProcessName,
  findPidsOnPort,
  getProcessDetails,
  inspectPortOccupancy,
  inspectProcessesOnPorts,
  isRuntimeProcessCommand,
  parseFuserOutput,
  parseLsofOutput,
  parsePsOutput,
  parseSsOutput,
  RUNTIME_IDENTIFIERS,
} from "./inspector.ts";

export {
  defaultIsProcessAlive,
  defaultSignalSender,
  defaultSleep,
  ProcessReclaimer,
  reclaimPort,
  reclaimProcess,
  reclaimZombieProcesses,
} from "./reclaimer.ts";

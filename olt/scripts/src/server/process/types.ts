/**
 * Core type definitions for PID ownership inspection and process reclaiming.
 */

export interface ProcessDetails {
  readonly pid: number;
  readonly ppid: number;
  readonly name: string;
  readonly command: string;
  readonly memoryBytes: number;
  readonly startTime: string;
  readonly isZombie: boolean;
  readonly isOrphaned: boolean;
  readonly isRuntimeProcess: boolean;
}

export interface PortProcessOccupancy {
  readonly port: number;
  readonly pids: readonly number[];
  readonly processes: readonly ProcessDetails[];
}

export type ReclaimSignal = "SIGTERM" | "SIGKILL" | "NONE";

export interface ReclaimResult {
  readonly pid: number;
  readonly name: string;
  readonly port: number;
  readonly reclaimed: boolean;
  readonly signalSent: ReclaimSignal;
  readonly durationMs: number;
  readonly error?: string | undefined;
}

export interface ReclaimOptions {
  readonly dryRun?: boolean | undefined;
  readonly force?: boolean | undefined;
  readonly gracePeriodMs?: number | undefined;
  readonly pollIntervalMs?: number | undefined;
  readonly signalSender?: ((pid: number, signal: "SIGTERM" | "SIGKILL") => boolean) | undefined;
  readonly isAliveChecker?: ((pid: number) => boolean) | undefined;
  readonly sleepFn?: ((ms: number) => Promise<void>) | undefined;
}

export interface CommandExecutionResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export type CommandExecutor = (
  command: string,
  args: readonly string[],
) => Promise<CommandExecutionResult>;

export interface ProcessInspectorOptions {
  readonly execCommand?: CommandExecutor | undefined;
}

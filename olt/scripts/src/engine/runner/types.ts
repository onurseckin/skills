import type {
  CommandAttemptRecord,
  CommandLogMetadata,
  CommandRecord,
} from "../../core/contracts/commands.ts";
import type { pumpOutput } from "./output-pump.ts";
import type { OutputBudget } from "./output-budget.ts";

export type FailureClass =
  | "authorization"
  | "evidence_failure"
  | "host_interruption"
  | "network_transient"
  | "test_failure"
  | "timeout"
  | "unknown";

export interface CommandOptions {
  argv: string[];
  cwd: string;
  repositoryRoot?: string;
  commandDir: string;
  runRoot?: string;
  actor: string;
  taskId?: string;
  gateId?: string;
  toolCategory?: string;
  tool?: string;
  toolExtras?: Record<string, string>;
  wallTimeoutMs?: number;
  idleTimeoutMs?: number;
  graceMs?: number;
  drainTimeoutMs?: number;
  heartbeatIntervalMs?: number;
  maxOutputBytes?: number;
  retries?: number;
  idempotent?: boolean;
  signal?: AbortSignal;
  pump?: typeof pumpOutput;
}

export interface NormalizedCommandOptions extends CommandOptions {
  repositoryRoot: string;
  runRoot: string;
  wallTimeoutMs: number;
  idleTimeoutMs: number;
  graceMs: number;
  drainTimeoutMs: number;
  heartbeatIntervalMs: number;
  maxOutputBytes: number;
  retries: number;
  idempotent: boolean;
  environment: Record<string, string>;
}

export interface PreparedCommand {
  options: NormalizedCommandOptions;
  record: CommandRecord;
  commandRoot: string;
  recordPath: string;
}

export interface AttemptResult {
  record: CommandAttemptRecord;
  attempt: number;
  failureClass?: FailureClass;
  stdoutPath: string;
  stderrPath: string;
  activityPath: string;
  outputTail: string;
}

export interface CommandResult {
  record: CommandRecord;
  attempts: AttemptResult[];
  recordPath: string;
}

export interface AttemptDependencies {
  pump?: typeof pumpOutput;
}

export interface OutputPumpOptions {
  signal?: AbortSignal;
  budget?: OutputBudget;
}

export interface OutputSummary extends CommandLogMetadata {}

export interface BunSubprocess {
  pid: number;
  exited: Promise<number>;
  signalCode?: null | string;
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
}

export interface BunSpawnApi {
  spawn(options: {
    cmd: string[];
    cwd: string;
    detached: boolean;
    stdout: "pipe";
    stderr: "pipe";
    stdin: "ignore";
    env: Record<string, string | undefined>;
  }): BunSubprocess;
}

import type { CommandRecord } from "../../contracts/commands.ts";
import type { CommandSigningCapability } from "./attempt-disposition-capability.ts";
import type { pumpOutput } from "./output-pump.ts";
import type { NormalizedCommandOptions } from "./types.ts";

export interface CommandRuntimeCapability {
  commandRoot: string;
  recordPath: string;
  commandDir: string;
  runRoot: string;
  attemptSigner: CommandSigningCapability;
  signal?: AbortSignal;
  pump?: typeof pumpOutput;
}

function frozenEnvironment(value: Readonly<Record<string, string>>): Record<string, string> {
  return Object.freeze({ ...value });
}

export function commandExecutionSnapshot(
  record: CommandRecord,
  runtime: CommandRuntimeCapability,
): Readonly<NormalizedCommandOptions> {
  const policy = record.policy!;
  return Object.freeze({
    argv: Object.freeze([...record.argv]) as unknown as string[],
    cwd: record.cwd,
    repositoryRoot: record.repository_root,
    commandDir: runtime.commandDir,
    runRoot: runtime.runRoot,
    actor: record.actor,
    ...(record.task_id === null ? {} : { taskId: record.task_id }),
    ...(record.gate_id === null ? {} : { gateId: record.gate_id }),
    wallTimeoutMs: policy.wall_timeout_ms,
    idleTimeoutMs: policy.idle_timeout_ms,
    graceMs: policy.grace_ms,
    drainTimeoutMs: policy.drain_timeout_ms,
    heartbeatIntervalMs: policy.heartbeat_interval_ms,
    maxOutputBytes: policy.max_output_bytes,
    retries: policy.max_retries,
    idempotent: policy.idempotent,
    ...(runtime.signal === undefined ? {} : { signal: runtime.signal }),
    ...(runtime.pump === undefined ? {} : { pump: runtime.pump }),
    environment: frozenEnvironment(record.environment!),
  });
}

export function gateExecutionSnapshot(
  snapshot: Readonly<NormalizedCommandOptions>,
  argv: string[],
  environment: Record<string, string>,
): NormalizedCommandOptions {
  return Object.freeze({
    ...snapshot,
    argv: Object.freeze(argv) as unknown as string[],
    environment: frozenEnvironment(environment),
  });
}

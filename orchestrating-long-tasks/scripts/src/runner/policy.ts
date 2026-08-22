import { realpathSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, relative, resolve, sep } from "node:path";
import type { CommandPolicyRecord } from "../contracts/commands.ts";
import { safeRepoPath } from "../core/paths.ts";
import { HarnessError } from "../errors/harness-error.ts";
import type { CommandOptions, NormalizedCommandOptions } from "./types.ts";
import { captureGateEnvironment } from "./gate-environment.ts";

const DEFAULTS = {
  wallTimeoutMs: 600_000,
  idleTimeoutMs: 300_000,
  graceMs: 1_000,
  drainTimeoutMs: 5_000,
  heartbeatIntervalMs: 1_000,
  maxOutputBytes: 64 * 1024 * 1024,
} as const;

const MAXIMUMS = {
  wallTimeoutMs: 86_400_000,
  idleTimeoutMs: 86_400_000,
  graceMs: 60_000,
  drainTimeoutMs: 60_000,
  heartbeatIntervalMs: 60_000,
  maxOutputBytes: 256 * 1024 * 1024,
} as const;
export const MAX_COMMAND_RETRIES = 5;
export const MAX_COMMAND_ARGUMENTS = 1_024;
export const MAX_COMMAND_ARGV_BYTES = 8 * 1024 * 1024;

function bounded(value: number | undefined, field: keyof typeof DEFAULTS): number {
  const result = value ?? DEFAULTS[field];
  if (!Number.isSafeInteger(result) || result <= 0 || result > MAXIMUMS[field]) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `${field} must be a positive integer no greater than ${MAXIMUMS[field]}`,
    );
  }
  return result;
}

export function assertCommandArgv(argv: readonly string[]): void {
  if (
    !Array.isArray(argv) ||
    argv.length === 0 ||
    argv.length > MAX_COMMAND_ARGUMENTS ||
    argv.some((part) => typeof part !== "string" || !part)
  ) {
    throw new HarnessError("INVALID_ARGUMENT", "argv must contain non-empty strings");
  }
  let bytes = 0;
  for (const argument of argv) {
    bytes += Buffer.byteLength(argument, "utf8");
    if (bytes > MAX_COMMAND_ARGV_BYTES)
      throw new HarnessError("INVALID_ARGUMENT", "argv size exceeds aggregate UTF-8 byte limit");
  }
}

export function assertCommandIdentities(
  input: Pick<CommandOptions, "actor" | "taskId" | "gateId">,
): void {
  if (typeof input.actor !== "string" || !input.actor.trim())
    throw new HarnessError("INVALID_ARGUMENT", "actor must be a nonblank string");
  for (const [label, value] of [
    ["taskId", input.taskId],
    ["gateId", input.gateId],
  ] as const) {
    if (value !== undefined && value !== null && (typeof value !== "string" || !value.trim()))
      throw new HarnessError("INVALID_ARGUMENT", `${label} must be a nonblank string when set`);
  }
}

export function assertCommandActor(actor: unknown): asserts actor is string {
  assertCommandIdentities({ actor } as Pick<CommandOptions, "actor">);
}

export async function normalizeCommandOptions(
  input: CommandOptions,
): Promise<NormalizedCommandOptions> {
  assertCommandArgv(input.argv);
  assertCommandIdentities(input);
  const retries = input.retries ?? 0;
  if (!Number.isSafeInteger(retries) || retries < 0 || retries > MAX_COMMAND_RETRIES) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `retries must be an integer from 0 to ${MAX_COMMAND_RETRIES}`,
    );
  }
  const cwd = realpathSync(resolve(input.cwd));
  const repositoryRoot = realpathSync(resolve(input.repositoryRoot ?? cwd));
  const cwdFromRepository = relative(repositoryRoot, cwd);
  if (
    cwdFromRepository === ".." ||
    cwdFromRepository.startsWith(`..${sep}`) ||
    resolve(repositoryRoot, cwdFromRepository) !== cwd
  ) {
    throw new HarnessError("PATH_SAFETY", "cwd must be within repositoryRoot");
  }
  const requestedCommandDir = resolve(input.commandDir);
  const requestedRunRoot = resolve(input.runRoot ?? dirname(requestedCommandDir));
  const requestedFromRun = relative(requestedRunRoot, requestedCommandDir);
  if (!requestedFromRun || requestedFromRun === ".." || requestedFromRun.startsWith(`..${sep}`)) {
    throw new HarnessError("PATH_SAFETY", "commandDir must be a child of runRoot");
  }
  const runRoot = realpathSync(requestedRunRoot);
  if (input.gateId !== undefined && input.gateId !== null) {
    const runFromRepository = relative(repositoryRoot, runRoot);
    if (runFromRepository !== ".capsules" && !runFromRepository.startsWith(`.capsules${sep}`)) {
      throw new HarnessError(
        "PATH_SAFETY",
        "gate command artifacts must be stored under the repository .capsules directory",
      );
    }
  }
  const commandDir = resolve(runRoot, requestedFromRun);
  safeRepoPath(runRoot, requestedFromRun);
  await mkdir(commandDir, { recursive: true, mode: 0o700 });
  safeRepoPath(runRoot, requestedFromRun);
  const ownershipToken = randomUUID();
  const inheritedEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  return {
    ...input,
    argv: [...input.argv],
    cwd,
    repositoryRoot,
    runRoot,
    commandDir,
    wallTimeoutMs: bounded(input.wallTimeoutMs, "wallTimeoutMs"),
    idleTimeoutMs: bounded(input.idleTimeoutMs, "idleTimeoutMs"),
    graceMs: bounded(input.graceMs, "graceMs"),
    drainTimeoutMs: bounded(input.drainTimeoutMs, "drainTimeoutMs"),
    heartbeatIntervalMs: bounded(input.heartbeatIntervalMs, "heartbeatIntervalMs"),
    maxOutputBytes: bounded(input.maxOutputBytes, "maxOutputBytes"),
    retries,
    idempotent: input.idempotent ?? false,
    environment: captureGateEnvironment(inheritedEnvironment, ownershipToken),
  };
}

export function policyRecord(options: NormalizedCommandOptions): CommandPolicyRecord {
  return {
    wall_timeout_ms: options.wallTimeoutMs,
    idle_timeout_ms: options.idleTimeoutMs,
    grace_ms: options.graceMs,
    drain_timeout_ms: options.drainTimeoutMs,
    heartbeat_interval_ms: options.heartbeatIntervalMs,
    max_output_bytes: options.maxOutputBytes,
    max_retries: options.retries,
    idempotent: options.idempotent,
  };
}

export function policyRecordIssues(policy: CommandPolicyRecord): string[] {
  const fields: Array<readonly [number, number]> = [
    [policy.wall_timeout_ms, MAXIMUMS.wallTimeoutMs],
    [policy.idle_timeout_ms, MAXIMUMS.idleTimeoutMs],
    [policy.grace_ms, MAXIMUMS.graceMs],
    [policy.drain_timeout_ms, MAXIMUMS.drainTimeoutMs],
    [policy.heartbeat_interval_ms, MAXIMUMS.heartbeatIntervalMs],
    [policy.max_output_bytes, MAXIMUMS.maxOutputBytes],
  ];
  const issues: string[] = [];
  if (
    fields.some(([value, maximum]) => !Number.isSafeInteger(value) || value <= 0 || value > maximum)
  )
    issues.push("command policy contains an invalid bound");
  if (
    !Number.isSafeInteger(policy.max_retries) ||
    policy.max_retries < 0 ||
    policy.max_retries > MAX_COMMAND_RETRIES
  )
    issues.push("command retry policy is invalid");
  if (typeof policy.idempotent !== "boolean") issues.push("command idempotency policy is invalid");
  return issues;
}

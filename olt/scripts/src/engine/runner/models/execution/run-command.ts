import { inspectRepositoryBinding } from "../../../../packets/repository-identity.ts";
import {
  createInternalCommandRunner,
  type InternalCommandRunner,
} from "./internal-command-runner.ts";
import { runAttempt } from "../attempt/run-attempt.ts";
import type { CommandOptions, CommandResult, PreparedCommand } from "../../types/types.ts";
import { readAgentMetadata } from "../../../../runtime/index.ts";
import { verifyCommandAuthorization } from "../../../../policy/rbac-engine.ts";
import { loadRepoPolicy } from "../../../../policy/repo-policy.ts";
import { resolveScratchDir } from "../../../../core/shared/paths.ts";
import { HarnessError } from "../../../../core/errors/index.ts";
import { releaseFlock, tryExclusiveFlock } from "../../../../platform/index.ts";
import { join, resolve } from "node:path";
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  type Stats,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { acquireMutexLock } from "./run-command-lock.ts";

const authoritativeRunner = createInternalCommandRunner({
  inspectRepository: inspectRepositoryBinding,
  attempt: runAttempt,
});

function isBroadScopeTest(argv: string[]): boolean {
  if (argv.length === 0) return false;
  const executable = argv[0];
  if (
    !executable ||
    !["bun", "npm", "pytest", "cargo", "vitest", "pnpm", "yarn"].includes(executable)
  ) {
    return false;
  }
  const isTestOrBuild =
    argv.includes("test") ||
    argv.includes("build") ||
    executable === "pytest" ||
    executable === "vitest";
  if (!isTestOrBuild) return false;

  const hasFilePath = argv
    .slice(1)
    .some(
      (arg) =>
        !arg.startsWith("-") &&
        arg !== "test" &&
        arg !== "build" &&
        arg !== "run" &&
        (arg.includes(".") || arg.includes("/")),
    );
  return !hasFilePath;
}

function readOwnDataString(error: unknown, property: "code" | "message"): string | null {
  if (error === null || (typeof error !== "object" && typeof error !== "function")) {
    return null;
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, property);
    return descriptor && "value" in descriptor && typeof descriptor.value === "string"
      ? descriptor.value
      : null;
  } catch {
    return null;
  }
}

function isTrustedEnoent(error: unknown): boolean {
  try {
    return error instanceof Error && readOwnDataString(error, "code") === "ENOENT";
  } catch {
    return false;
  }
}

export { isBroadScopeTest };

export async function prepareCommand(
  input: CommandOptions,
  runner: InternalCommandRunner = authoritativeRunner,
): Promise<PreparedCommand> {
  const repositoryRoot = input.repositoryRoot ?? process.cwd();
  // Load and validate exactly the target repository policy before any runner
  // preparation can create command artifacts or a receipt is emitted.
  const policy = loadRepoPolicy(repositoryRoot);
  // normalizeCommandOptions owns timeout defaults and establishes the canonical
  // run root before any metadata path is read.
  const prepared = await runner.prepareCommand(input);
  const metadata = readAgentMetadata(input.actor, prepared.options.runRoot);
  if (!metadata) {
    throw new Error(
      `[ROLE_BOUNDARY_VIOLATION] Cannot find AgentMetadata for actor: ${input.actor}`,
    );
  }

  const argv = prepared.options?.argv ?? input.argv ?? [];
  const auth = verifyCommandAuthorization(metadata, argv, policy);
  if (!auth.authorized) {
    throw new Error(auth.message || `[${auth.error_code}] Command authorization failed`);
  }

  // Emit signed receipt to .olt/scratch/evidence/ for non-gate commands
  if (!input.gateId && !prepared.options.gateId) {
    const scratchDir = resolveScratchDir(prepared.options?.repositoryRoot ?? repositoryRoot);
    const evidenceDir = join(scratchDir, "evidence");
    if (!existsSync(evidenceDir)) {
      mkdirSync(evidenceDir, { recursive: true });
    }

    const receipt = {
      actor: metadata.agent_id,
      role: metadata.role,
      command: argv.join(" "),
      timestamp: new Date().toISOString(),
      authorized: true,
    };

    const receiptStr = JSON.stringify(receipt, null, 2);
    const digest = createHash("sha256").update(receiptStr).digest("hex");
    writeFileSync(join(evidenceDir, `${digest}.json`), receiptStr);
  }

  return prepared;
}

export async function executePreparedCommand(
  prepared: PreparedCommand,
  runner: InternalCommandRunner = authoritativeRunner,
): Promise<CommandResult> {
  const cleanup = acquireMutexLock(prepared.options.repositoryRoot, prepared.options.argv);
  let result!: CommandResult;
  let hasPrimary = false;
  let primary: unknown;
  let hasCleanupFailure = false;
  let cleanupFailure: unknown;
  try {
    result = await runner.executePreparedCommand(prepared);
  } catch (error) {
    hasPrimary = true;
    primary = error;
  }
  try {
    cleanup();
  } catch (error) {
    hasCleanupFailure = true;
    cleanupFailure = error;
  }
  if (hasPrimary) throw primary;
  if (hasCleanupFailure) throw cleanupFailure;
  return result;
}

export async function runCommand(
  options: CommandOptions,
  runner: InternalCommandRunner = authoritativeRunner,
): Promise<CommandResult> {
  const prepared = await prepareCommand(options, runner);
  return executePreparedCommand(prepared, runner);
}

export { acquireMutexLock, setExecutionLockDependenciesForTesting } from "./run-command-lock.ts";

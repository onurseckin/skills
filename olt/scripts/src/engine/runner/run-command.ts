import { inspectRepositoryBinding } from "../../packets/repository-identity.ts";
import {
  createInternalCommandRunner,
  type InternalCommandRunner,
} from "./internal-command-runner.ts";
import { runAttempt } from "./run-attempt.ts";
import type { CommandOptions, CommandResult, PreparedCommand } from "./types.ts";
import { readAgentMetadata } from "../../runtime/agent-metadata.ts";
import { verifyCommandAuthorization } from "../../policy/rbac-engine.ts";
import { loadRepoPolicy } from "../../policy/repo-policy.ts";
import { resolveScratchDir } from "../../core/shared/paths.ts";
import { HarnessError } from "../../core/errors/harness-error.ts";
import { releaseFlock, tryExclusiveFlock } from "../../platform/flock-ffi.ts";
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

const authoritativeRunner = createInternalCommandRunner({
  inspectRepository: inspectRepositoryBinding,
  attempt: runAttempt,
});

interface ExecutionLockDependencies {
  readonly mkdirLockDirectory: (
    path: string,
    options: { readonly recursive: true; readonly mode: number },
  ) => void;
  readonly lstat: (path: string) => Stats;
  readonly openRepositoryRoot: (path: string, flags: number) => number;
  readonly openLockFile: (path: string, flags: number, mode: number) => number;
  readonly fstat: (descriptor: number) => Stats;
  readonly close: (descriptor: number) => void;
  readonly tryExclusiveFlock: (descriptor: number) => boolean;
  readonly releaseFlock: (descriptor: number) => void;
}

const defaultExecutionLockDependencies: ExecutionLockDependencies = {
  mkdirLockDirectory: mkdirSync,
  lstat: lstatSync,
  openRepositoryRoot: openSync,
  openLockFile: openSync,
  fstat: fstatSync,
  close: closeSync,
  tryExclusiveFlock,
  releaseFlock,
};

let executionLockDependencies = defaultExecutionLockDependencies;
const activeExecutionLockPaths = new Set<string>();
const activeExecutionRootInodes = new Set<string>();

/** Test-only seam for deterministic lock filesystem and flock failures. */
export function setExecutionLockDependenciesForTesting(
  overrides: Partial<ExecutionLockDependencies>,
): () => void {
  const previous = executionLockDependencies;
  executionLockDependencies = { ...executionLockDependencies, ...overrides };
  return () => {
    executionLockDependencies = previous;
  };
}

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

function safeLockCause(error: unknown): string {
  const message = readOwnDataString(error, "message");
  if (message !== null) return message;
  if (error === null || (typeof error !== "object" && typeof error !== "function")) {
    try {
      return String(error);
    } catch {
      return "unknown error";
    }
  }
  return "unknown error";
}

function lockFailure(operation: string, path: string, error: unknown): HarnessError {
  if (error instanceof HarnessError) return error;
  return new HarnessError(
    "INTEGRITY",
    `failed to ${operation} execution lock '${path}': ${safeLockCause(error)}`,
  );
}

function requiredNoFollowFlag(): number {
  const noFollow = constants.O_NOFOLLOW;
  if (!Number.isInteger(noFollow) || noFollow === 0) {
    throw new HarnessError(
      "UNSUPPORTED_PLATFORM",
      "execution locking requires final-component O_NOFOLLOW protection",
    );
  }
  return noFollow;
}

function lstatLockPath(path: string): Stats | undefined {
  try {
    return executionLockDependencies.lstat(path);
  } catch (error) {
    if (isTrustedEnoent(error)) return undefined;
    throw lockFailure("inspect", path, error);
  }
}

function assertRealDirectory(path: string, label: string): Stats {
  const metadata = lstatLockPath(path);
  if (metadata === undefined) {
    throw new HarnessError("INTEGRITY", `${label} disappeared: ${path}`);
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new HarnessError("PATH_SAFETY", `${label} is not a real directory: ${path}`);
  }
  return metadata;
}

function assertRegularLockFile(path: string): void {
  const metadata = lstatLockPath(path);
  if (metadata === undefined) return;
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new HarnessError("PATH_SAFETY", `execution lock is not a regular file: ${path}`);
  }
}

function sameDirectoryIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function acquireMutexLock(repositoryRoot: string, argv: string[]): () => void {
  if (!isBroadScopeTest(argv)) return () => {};

  const resolvedRepositoryRoot = resolve(repositoryRoot);
  const lockDir = join(resolvedRepositoryRoot, ".olt", ".locks");
  const lockFile = join(lockDir, "execution.lock");
  const identity = resolve(lockFile);
  if (activeExecutionLockPaths.has(identity)) {
    throw new HarnessError(
      "LOCK_TIMEOUT",
      `execution lock is already active in this process: ${lockFile}`,
    );
  }

  let rootDescriptor: number | undefined;
  let rootAcquired = false;
  let rootInodeIdentity: string | undefined;
  let rootInodeTracked = false;
  let descriptor: number | undefined;
  let acquired = false;
  activeExecutionLockPaths.add(identity);
  try {
    const repositoryBefore = assertRealDirectory(resolvedRepositoryRoot, "repository root");
    rootDescriptor = executionLockDependencies.openRepositoryRoot(
      resolvedRepositoryRoot,
      constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | requiredNoFollowFlag(),
    );
    const openedRepository = executionLockDependencies.fstat(rootDescriptor);
    if (!openedRepository.isDirectory()) {
      throw new HarnessError(
        "PATH_SAFETY",
        `opened repository root is not a directory: ${resolvedRepositoryRoot}`,
      );
    }
    if (!sameDirectoryIdentity(repositoryBefore, openedRepository)) {
      throw new HarnessError(
        "INTEGRITY",
        `repository root changed while opening execution authority: ${resolvedRepositoryRoot}`,
      );
    }
    const repositoryAfter = assertRealDirectory(resolvedRepositoryRoot, "repository root");
    if (!sameDirectoryIdentity(openedRepository, repositoryAfter)) {
      throw new HarnessError(
        "INTEGRITY",
        `repository root changed while opening execution authority: ${resolvedRepositoryRoot}`,
      );
    }
    rootInodeIdentity = `${openedRepository.dev}:${openedRepository.ino}`;
    if (activeExecutionRootInodes.has(rootInodeIdentity)) {
      throw new HarnessError(
        "LOCK_TIMEOUT",
        `repository execution authority is already active in this process: ${resolvedRepositoryRoot}`,
      );
    }
    activeExecutionRootInodes.add(rootInodeIdentity);
    rootInodeTracked = true;
    rootAcquired = executionLockDependencies.tryExclusiveFlock(rootDescriptor);
    if (!rootAcquired) {
      throw new HarnessError(
        "LOCK_TIMEOUT",
        `repository execution authority is already held: ${resolvedRepositoryRoot}`,
      );
    }
    try {
      executionLockDependencies.mkdirLockDirectory(lockDir, { recursive: true, mode: 0o700 });
    } catch (error) {
      throw lockFailure("create directory for", lockDir, error);
    }
    const directoryBefore = assertRealDirectory(lockDir, "execution lock directory");
    assertRegularLockFile(lockFile);
    descriptor = executionLockDependencies.openLockFile(
      lockFile,
      constants.O_RDWR | constants.O_CREAT | requiredNoFollowFlag(),
      0o600,
    );
    const opened = executionLockDependencies.fstat(descriptor);
    if (!opened.isFile()) {
      throw new HarnessError(
        "PATH_SAFETY",
        `opened execution lock is not a regular file: ${lockFile}`,
      );
    }
    const directoryAfter = assertRealDirectory(lockDir, "execution lock directory");
    if (!sameDirectoryIdentity(directoryBefore, directoryAfter)) {
      throw new HarnessError(
        "INTEGRITY",
        `execution lock directory changed while opening: ${lockDir}`,
      );
    }
    acquired = executionLockDependencies.tryExclusiveFlock(descriptor);
    if (!acquired) {
      throw new HarnessError("LOCK_TIMEOUT", `execution lock is already held: ${lockFile}`);
    }
  } catch (error) {
    if (descriptor !== undefined) {
      if (acquired) {
        try {
          executionLockDependencies.releaseFlock(descriptor);
        } catch {
          // A pre-existing acquisition failure remains authoritative; descriptor close still runs.
        }
      }
      try {
        executionLockDependencies.close(descriptor);
      } catch {
        // A pre-existing acquisition failure remains authoritative.
      }
    }
    if (rootDescriptor !== undefined) {
      if (rootAcquired) {
        try {
          executionLockDependencies.releaseFlock(rootDescriptor);
        } catch {
          // A pre-existing acquisition failure remains authoritative; descriptor close still runs.
        }
      }
      try {
        executionLockDependencies.close(rootDescriptor);
      } catch {
        // A pre-existing acquisition failure remains authoritative.
      }
    }
    activeExecutionLockPaths.delete(identity);
    if (rootInodeTracked && rootInodeIdentity !== undefined) {
      activeExecutionRootInodes.delete(rootInodeIdentity);
    }
    throw lockFailure("acquire", lockFile, error);
  }

  if (descriptor === undefined || rootDescriptor === undefined || rootInodeIdentity === undefined) {
    activeExecutionLockPaths.delete(identity);
    if (rootInodeTracked && rootInodeIdentity !== undefined) {
      activeExecutionRootInodes.delete(rootInodeIdentity);
    }
    throw new HarnessError("INTEGRITY", `execution lock opened without a descriptor: ${lockFile}`);
  }
  const heldDescriptor: number = descriptor;
  const heldRootDescriptor: number = rootDescriptor;
  const heldRootInodeIdentity: string = rootInodeIdentity;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    let hasReleaseError = false;
    let releaseError: unknown;
    try {
      executionLockDependencies.releaseFlock(heldDescriptor);
    } catch (error) {
      hasReleaseError = true;
      releaseError = error;
    }
    try {
      executionLockDependencies.close(heldDescriptor);
    } catch (error) {
      if (!hasReleaseError) {
        hasReleaseError = true;
        releaseError = error;
      }
    }
    try {
      executionLockDependencies.releaseFlock(heldRootDescriptor);
    } catch (error) {
      if (!hasReleaseError) {
        hasReleaseError = true;
        releaseError = error;
      }
    }
    try {
      executionLockDependencies.close(heldRootDescriptor);
    } catch (error) {
      if (!hasReleaseError) {
        hasReleaseError = true;
        releaseError = error;
      }
    }
    activeExecutionLockPaths.delete(identity);
    activeExecutionRootInodes.delete(heldRootInodeIdentity);
    if (hasReleaseError) throw lockFailure("release", lockFile, releaseError);
  };
}

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

  const auth = verifyCommandAuthorization(metadata, prepared.options.argv, policy);
  if (!auth.authorized) {
    throw new Error(auth.message || `[${auth.error_code}] Command authorization failed`);
  }

  // Emit signed receipt to .olt/scratch/evidence/
  const scratchDir = resolveScratchDir(prepared.options.repositoryRoot);
  const evidenceDir = join(scratchDir, "evidence");
  if (!existsSync(evidenceDir)) {
    mkdirSync(evidenceDir, { recursive: true });
  }

  const receipt = {
    actor: metadata.agent_id,
    role: metadata.role,
    command: prepared.options.argv.join(" "),
    timestamp: new Date().toISOString(),
    authorized: true,
  };

  const receiptStr = JSON.stringify(receipt, null, 2);
  const digest = createHash("sha256").update(receiptStr).digest("hex");
  writeFileSync(join(evidenceDir, `${digest}.json`), receiptStr);

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

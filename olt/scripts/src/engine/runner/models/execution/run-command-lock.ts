import { HarnessError } from "../../../../core/errors/index.ts";
import { join, resolve } from "node:path";
import { constants } from "node:fs";
import {
  getExecutionLockDependencies,
  activeExecutionLockPaths,
  activeExecutionRootInodes,
  requiredNoFollowFlag,
  assertRealDirectory,
  assertRegularLockFile,
  sameDirectoryIdentity,
  lockFailure,
  setExecutionLockDependenciesForTesting,
  type ExecutionLockDependencies,
} from "./run-command-lock-deps.ts";

export { setExecutionLockDependenciesForTesting, type ExecutionLockDependencies };

export function isBroadScopeTest(argv: string[]): boolean {
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

export function acquireMutexLock(repositoryRoot: string, argv: string[]): () => void {
  if (!isBroadScopeTest(argv)) return () => {};

  const deps = getExecutionLockDependencies();
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
    rootDescriptor = deps.openRepositoryRoot(
      resolvedRepositoryRoot,
      constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | requiredNoFollowFlag(),
    );
    const openedRepository = deps.fstat(rootDescriptor);
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
    rootAcquired = deps.tryExclusiveFlock(rootDescriptor);
    if (!rootAcquired) {
      throw new HarnessError(
        "LOCK_TIMEOUT",
        `repository execution authority is already held: ${resolvedRepositoryRoot}`,
      );
    }
    try {
      deps.mkdirLockDirectory(lockDir, { recursive: true, mode: 0o700 });
    } catch (error) {
      throw lockFailure("create directory for", lockDir, error);
    }
    const directoryBefore = assertRealDirectory(lockDir, "execution lock directory");
    assertRegularLockFile(lockFile);
    descriptor = deps.openLockFile(
      lockFile,
      constants.O_RDWR | constants.O_CREAT | requiredNoFollowFlag(),
      0o600,
    );
    const opened = deps.fstat(descriptor);
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
    acquired = deps.tryExclusiveFlock(descriptor);
    if (!acquired) {
      throw new HarnessError("LOCK_TIMEOUT", `execution lock is already held: ${lockFile}`);
    }
  } catch (error) {
    if (descriptor !== undefined) {
      if (acquired) {
        try {
          deps.releaseFlock(descriptor);
        } catch {
          // A pre-existing acquisition failure remains authoritative.
        }
      }
      try {
        deps.close(descriptor);
      } catch {
        // A pre-existing acquisition failure remains authoritative.
      }
    }
    if (rootDescriptor !== undefined) {
      if (rootAcquired) {
        try {
          deps.releaseFlock(rootDescriptor);
        } catch {
          // A pre-existing acquisition failure remains authoritative.
        }
      }
      try {
        deps.close(rootDescriptor);
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
      deps.releaseFlock(heldDescriptor);
    } catch (error) {
      hasReleaseError = true;
      releaseError = error;
    }
    try {
      deps.close(heldDescriptor);
    } catch (error) {
      if (!hasReleaseError) {
        hasReleaseError = true;
        releaseError = error;
      }
    }
    try {
      deps.releaseFlock(heldRootDescriptor);
    } catch (error) {
      if (!hasReleaseError) {
        hasReleaseError = true;
        releaseError = error;
      }
    }
    try {
      deps.close(heldRootDescriptor);
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

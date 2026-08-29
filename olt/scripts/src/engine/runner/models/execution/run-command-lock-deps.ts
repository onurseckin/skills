import { releaseFlock, tryExclusiveFlock } from "../../../../platform/index.ts";
import { HarnessError } from "../../../../core/errors/index.ts";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  type Stats,
} from "node:fs";

export interface ExecutionLockDependencies {
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
export const activeExecutionLockPaths = new Set<string>();
export const activeExecutionRootInodes = new Set<string>();

export function getExecutionLockDependencies(): ExecutionLockDependencies {
  return executionLockDependencies;
}

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

export function readOwnDataString(error: unknown, property: "code" | "message"): string | null {
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

export function isTrustedEnoent(error: unknown): boolean {
  try {
    return error instanceof Error && readOwnDataString(error, "code") === "ENOENT";
  } catch {
    return false;
  }
}

export function safeLockCause(error: unknown): string {
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

export function lockFailure(operation: string, path: string, error: unknown): HarnessError {
  if (error instanceof HarnessError) return error;
  return new HarnessError(
    "INTEGRITY",
    `failed to ${operation} execution lock '${path}': ${safeLockCause(error)}`,
  );
}

export function requiredNoFollowFlag(): number {
  const noFollow = constants.O_NOFOLLOW;
  if (!Number.isInteger(noFollow) || noFollow === 0) {
    throw new HarnessError(
      "UNSUPPORTED_PLATFORM",
      "execution locking requires final-component O_NOFOLLOW protection",
    );
  }
  return noFollow;
}

export function lstatLockPath(path: string): Stats | undefined {
  try {
    return executionLockDependencies.lstat(path);
  } catch (error) {
    if (isTrustedEnoent(error)) return undefined;
    throw lockFailure("inspect", path, error);
  }
}

export function assertRealDirectory(path: string, label: string): Stats {
  const metadata = lstatLockPath(path);
  if (metadata === undefined) {
    throw new HarnessError("INTEGRITY", `${label} disappeared: ${path}`);
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new HarnessError("PATH_SAFETY", `${label} is not a real directory: ${path}`);
  }
  return metadata;
}

export function assertRegularLockFile(path: string): void {
  const metadata = lstatLockPath(path);
  if (metadata === undefined) return;
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new HarnessError("PATH_SAFETY", `execution lock is not a regular file: ${path}`);
  }
}

export function sameDirectoryIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

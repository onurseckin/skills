import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  type Stats,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { HarnessError } from "../core/errors/index.ts";
import { tryExclusiveFlock } from "../platform/index.ts";

export function requiredNoFollowFlag(): number {
  const flag = constants.O_NOFOLLOW;
  if (!Number.isInteger(flag) || flag === 0)
    throw new HarnessError("UNSUPPORTED_PLATFORM", "agent metadata storage requires O_NOFOLLOW");
  return flag;
}

export function delay(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

export function sameInode(
  left: Pick<Stats, "dev" | "ino">,
  right: Pick<Stats, "dev" | "ino">,
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

export function safeFailureCause(error: unknown): string {
  return readOwnDataString(error, "message") ?? "unknown error";
}

export function assertRealDirectory(path: string, label: string): Stats {
  let metadata: Stats;
  try {
    metadata = lstatSync(path);
  } catch (error) {
    throw new HarnessError("INTEGRITY", `${label} is unavailable: ${safeFailureCause(error)}`);
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink())
    throw new HarnessError("PATH_SAFETY", `${label} must be a real directory: ${path}`);
  return metadata;
}

export function openVerifiedDirectory(
  path: string,
  create: boolean,
  label: string,
): { descriptor: number; metadata: Stats } {
  if (!existsSync(path)) {
    if (!create) throw new HarnessError("INTEGRITY", `${label} is unavailable: ${path}`);
    try {
      mkdirSync(path, { recursive: true, mode: 0o700 });
    } catch (error) {
      throw new HarnessError("INTEGRITY", `failed to create ${label}: ${safeFailureCause(error)}`);
    }
  }
  const before = assertRealDirectory(path, label);
  let descriptor: number | undefined;
  try {
    descriptor = openSync(
      path,
      constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | requiredNoFollowFlag(),
    );
    const opened = fstatSync(descriptor);
    const after = assertRealDirectory(path, label);
    if (!opened.isDirectory() || !sameInode(before, opened) || !sameInode(opened, after))
      throw new HarnessError("INTEGRITY", `${label} changed while opening: ${path}`);
    return { descriptor, metadata: opened };
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    throw error;
  }
}

export function acquireExclusiveLock(descriptor: number, path: string): void {
  const deadline = performance.now() + 10_000;
  while (!tryExclusiveFlock(descriptor)) {
    const remaining = deadline - performance.now();
    if (remaining <= 0)
      throw new HarnessError("LOCK_TIMEOUT", `timed out waiting for agent metadata lock: ${path}`);
    delay(Math.min(10, remaining));
  }
}

export function assertActiveMetadataAuthority(filePath: string): void {
  const parent = resolve(dirname(filePath));
  const root = activeAgentMetadataAuthority.get(parent);
  const expectedParent = activeAgentMetadataParentIdentity.get(parent);
  const expectedRoot = root === undefined ? undefined : activeAgentMetadataRootIdentity.get(root);
  if (
    root === undefined ||
    expectedParent === undefined ||
    expectedRoot === undefined ||
    !sameInode(expectedParent, assertRealDirectory(parent, "agent metadata runtime directory")) ||
    !sameInode(expectedRoot, assertRealDirectory(root, "agent metadata root"))
  ) {
    throw new HarnessError(
      "INTEGRITY",
      `agent metadata authority changed before write: ${filePath}`,
    );
  }
}

export function assertRegularMetadataFile(filePath: string): void {
  if (!existsSync(filePath)) return;
  const metadata = lstatSync(filePath);
  if (metadata.isSymbolicLink() || !metadata.isFile())
    throw new HarnessError("PATH_SAFETY", `agent metadata must be a regular file: ${filePath}`);
  if (metadata.nlink > 1) {
    throw new HarnessError(
      "INTEGRITY",
      `agent metadata must not have multiple hard links: ${filePath}`,
    );
  }
}

export function assertExistingMetadataAuthorityFiles(filePath: string): void {
  assertRegularMetadataFile(filePath);
  const name = filePath.slice(filePath.lastIndexOf("/") + 1);
  const canonical = /^agent-(.+)\.json$/.exec(name);
  if (canonical?.[1]) {
    assertRegularMetadataFile(join(dirname(filePath), `${canonical[1]}.json`));
  }
}

export function fsyncDirectory(path: string): void {
  const descriptor = openSync(
    path,
    constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | requiredNoFollowFlag(),
  );
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

export const activeAgentMetadataParents = new Set<string>();
export const activeAgentMetadataParentInodes = new Set<string>();
export const activeAgentMetadataRoots = new Set<string>();
export const activeAgentMetadataRootInodes = new Set<string>();
export const activeAgentMetadataParentIdentity = new Map<string, Pick<Stats, "dev" | "ino">>();
export const activeAgentMetadataRootIdentity = new Map<string, Pick<Stats, "dev" | "ino">>();
export const activeAgentMetadataAuthority = new Map<string, string>();

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

export function formatSafeErrorCause(error: unknown): string {
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

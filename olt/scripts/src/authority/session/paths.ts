import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  type Stats,
} from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";
import {
  findRepoRoot,
  isTestEnvironment,
  resolveCapsulesDir,
  resolveScratchDir,
} from "../../core/shared/paths.ts";

let inMemorySessionStore: Map<string, string> | undefined;

export const enableInMemorySessionStore = (init?: Record<string, string>): Map<string, string> =>
  (inMemorySessionStore = new Map(Object.entries(init ?? {})));
export const disableInMemorySessionStore = (): void => {
  inMemorySessionStore = undefined;
};
export const clearInMemorySessionStore = (): void => inMemorySessionStore?.clear();
export const isInMemorySessionStoreEnabled = (): boolean => inMemorySessionStore !== undefined;
export const getInMemorySessionStore = (): Map<string, string> | undefined => inMemorySessionStore;
export const setInMemorySessionData = (path: string, payload: string): void => {
  inMemorySessionStore?.set(path, payload);
};
export const getInMemorySessionData = (path: string): string | undefined =>
  inMemorySessionStore?.get(path);
export const deleteInMemorySessionData = (path: string): boolean =>
  inMemorySessionStore?.delete(path) ?? false;

export function resolveGlobalSessionsDir(repoRoot?: string): string {
  if (repoRoot) {
    const resolved = resolve(repoRoot);
    if (!isInMemorySessionStoreEnabled() && isTestEnvironment() && resolved === findRepoRoot()) {
      return join(resolveScratchDir(), ".sessions");
    }
    return join(resolved, ".olt", ".sessions");
  }
  if (isInMemorySessionStoreEnabled()) {
    return "/virtual/repo/.olt/.sessions";
  }
  if (isTestEnvironment()) {
    return join(resolveScratchDir(), ".sessions");
  }
  return join(findRepoRoot(), ".olt", ".sessions");
}

export function resolveSessionRepositoryRoot(runRoot: string | undefined, cwd: string): string {
  if (runRoot !== undefined && runRoot.trim() !== "") {
    const raw = runRoot.trim();
    const anchor = isAbsolute(raw) ? resolve(raw) : resolve(cwd, raw);
    try {
      return findRepoRoot(anchor);
    } catch {
      return anchor;
    }
  }
  try {
    return findRepoRoot(cwd);
  } catch {
    return cwd;
  }
}

export function noFollow(): number {
  const flag = constants.O_NOFOLLOW;
  if (!Number.isInteger(flag) || flag === 0) {
    throw new HarnessError("UNSUPPORTED_PLATFORM", "session authority requires O_NOFOLLOW");
  }
  return flag;
}

export function sameInode(
  left: Pick<Stats, "dev" | "ino">,
  right: Pick<Stats, "dev" | "ino">,
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

export function assertRealDirectory(path: string, label: string): Stats {
  const metadata = lstatSync(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new HarnessError("PATH_SAFETY", `${label} must be a real directory: ${path}`);
  }
  return metadata;
}

export function openVerifiedDirectory(
  path: string,
  create: boolean,
  label: string,
): { fd: number; stat: Stats } {
  if (!existsSync(path)) {
    if (!create) throw new HarnessError("INTEGRITY", `${label} is unavailable: ${path}`);
    mkdirSync(path, { recursive: true, mode: 0o700 });
  }
  const before = assertRealDirectory(path, label);
  const fd = openSync(path, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | noFollow());
  try {
    const opened = fstatSync(fd);
    const after = assertRealDirectory(path, label);
    if (!opened.isDirectory() || !sameInode(before, opened) || !sameInode(opened, after)) {
      throw new HarnessError("INTEGRITY", `${label} changed while opening: ${path}`);
    }
    return { fd, stat: opened };
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

export function assertSingleLinkRegular(path: string): Stats | undefined {
  if (!existsSync(path)) return undefined;
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new HarnessError("PATH_SAFETY", `session authority must be a regular file: ${path}`);
  }
  if (stat.nlink !== 1) {
    throw new HarnessError(
      "INTEGRITY",
      `session authority must have exactly one hard link: ${path}`,
    );
  }
  return stat;
}

export function assertSafeSessionComponent(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "." || trimmed === ".." || /[\\/\0]/.test(trimmed)) {
    throw new HarnessError("INVALID_ARGUMENT", `${field} must be a safe single path component`);
  }
  return trimmed;
}

export function assertSessionPid(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new HarnessError("INVALID_ARGUMENT", `${field} must be a positive safe integer`);
  }
  return value;
}

export function resolveCapsuleStateCandidate(
  runId: string,
  customCwd?: string,
): string | undefined {
  const trimmed = runId.trim();
  const statePath = join(trimmed, "state.json");
  if (
    existsSync(statePath) ||
    (isInMemorySessionStoreEnabled() && getInMemorySessionData(statePath))
  )
    return resolve(statePath);
  const cwd = customCwd ?? (typeof process !== "undefined" ? process.cwd() : ".");
  const candidates = [join(cwd, ".olt", "capsules", trimmed), join(cwd, "capsules", trimmed)];
  try {
    const repoRoot = findRepoRoot(trimmed);
    candidates.push(
      join(resolveCapsulesDir(repoRoot), trimmed),
      join(repoRoot, ".olt", "capsules", trimmed),
    );
  } catch {}
  try {
    const defaultRepo = findRepoRoot(cwd);
    candidates.push(
      join(resolveCapsulesDir(defaultRepo), trimmed),
      join(defaultRepo, ".olt", "capsules", trimmed),
    );
  } catch {}
  for (const cand of candidates) {
    const candState = join(cand, "state.json");
    if (
      existsSync(candState) ||
      (isInMemorySessionStoreEnabled() && getInMemorySessionData(candState))
    )
      return resolve(candState);
  }
  return undefined;
}

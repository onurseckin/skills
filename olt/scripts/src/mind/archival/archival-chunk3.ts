import { releaseFlock } from "../../platform/index.ts";
import {
  realpathSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";
import {
  hasOwnErrorCode,
  invokeArchivedObjectivesPersistenceHook,
  noFollowFlag,
  resolveArchivedObjectivesPath,
  type ArchivedObjectiveRecord,
} from "./archival-chunk1.ts";
import { acquireArchivedObjectivesFlock, assertUniqueArchivedObjectives, readArchivedObjectives, readArchivedObjectivesFile, parseArchivedObjectives, validateArchivedObjectiveRecord } from "./archival-chunk2.ts";


function assertStableArchivedObjectivesDirectory(
  path: string,
  descriptor: number,
  label: string,
): void {
  const pathStat = lstatSync(path);
  const opened = fstatSync(descriptor);
  if (
    !pathStat.isDirectory() ||
    !opened.isDirectory() ||
    pathStat.dev !== opened.dev ||
    pathStat.ino !== opened.ino
  ) {
    throw new HarnessError("INTEGRITY", `${label} directory changed while being opened`);
  }
}


interface StableArchivedObjectivesDirectoryChain {
  readonly paths: readonly string[];
  readonly descriptors: readonly number[];
}


/** Opens every absolute path component with O_DIRECTORY|O_NOFOLLOW and revalidates it by inode. */
function safeRealpath(p: string): string {
  if (existsSync(p)) return realpathSync(p);
  const par = dirname(p);
  if (existsSync(par)) return join(realpathSync(par), basename(p));
  return resolve(p);
}

function openStableArchivedObjectivesDirectoryChain(
  directory: string,
  label: string,
): StableArchivedObjectivesDirectoryChain {
  const paths: string[] = [];
  const descriptors: number[] = [];
  try {
    let current = "/";
    paths.push(current);
    const resolvedTarget = safeRealpath(directory);
    for (const component of resolvedTarget.split("/").filter(Boolean)) {
      current = join(current, component);
      paths.push(current);
    }
    for (const path of paths) {
      const before = lstatSync(path);
      if (!before.isDirectory()) {
        throw new HarnessError(
          "PATH_SAFETY",
          `${label} path component is not a directory: ${path}`,
        );
      }
      const descriptor = openSync(
        path,
        constants.O_RDONLY | constants.O_DIRECTORY | noFollowFlag(),
      );
      descriptors.push(descriptor);
      assertStableArchivedObjectivesDirectory(path, descriptor, label);
      for (let index = 0; index < descriptors.length; index++) {
        assertStableArchivedObjectivesDirectory(paths[index]!, descriptors[index]!, label);
      }
    }
    return { paths, descriptors };
  } catch (error) {
    for (const descriptor of descriptors.reverse()) {
      try {
        closeSync(descriptor);
      } catch {}
    }
    if (error instanceof HarnessError) throw error;
    throw new HarnessError("PATH_SAFETY", `${label} cannot be securely traversed: ${error instanceof Error ? error.message : String(error)}`);
  }
}


function assertStableArchivedObjectivesDirectoryChain(
  chain: StableArchivedObjectivesDirectoryChain,
  label: string,
): void {
  for (let index = 0; index < chain.descriptors.length; index++) {
    assertStableArchivedObjectivesDirectory(chain.paths[index]!, chain.descriptors[index]!, label);
  }
}


function closeStableArchivedObjectivesDirectoryChain(
  chain: StableArchivedObjectivesDirectoryChain | undefined,
): void {
  if (!chain) return;
  let cleanup: unknown;
  for (const descriptor of [...chain.descriptors].reverse()) {
    try {
      closeSync(descriptor);
    } catch (error) {
      cleanup ??= error;
    }
  }
  if (cleanup !== undefined) throw cleanup;
}


export function withArchivedObjectivesTransaction<T>(
  customPath: string | undefined,
  mutation: (items: readonly ArchivedObjectiveRecord[]) => {
    readonly items: readonly ArchivedObjectiveRecord[];
    readonly result: T;
  },
): T {
  const rawFilePath = resolveArchivedObjectivesPath(undefined, customPath);
  const rawParent = dirname(rawFilePath);
  if (!existsSync(rawParent)) mkdirSync(rawParent, { recursive: true, mode: 0o700 });
  const parent = existsSync(rawParent) ? realpathSync(rawParent) : rawParent;
  const filePath = join(parent, basename(rawFilePath));
  const rawRoot = dirname(parent);
  const root = existsSync(rawRoot) ? realpathSync(rawRoot) : rawRoot;
  let rootChain: StableArchivedObjectivesDirectoryChain | undefined;
  let parentChain: StableArchivedObjectivesDirectoryChain | undefined;
  let rootLocked = false;
  let parentLocked = false;
  let result!: T;
  let primary: unknown;
  try {
    if (!existsSync(parent)) mkdirSync(parent, { recursive: true, mode: 0o700 });
    rootChain = openStableArchivedObjectivesDirectoryChain(root, "archived objectives root");
    const rootFd = rootChain.descriptors.at(-1)!;
    acquireArchivedObjectivesFlock(rootFd, "archived objectives root");
    rootLocked = true;
    assertStableArchivedObjectivesDirectoryChain(rootChain, "archived objectives root");
    parentChain = openStableArchivedObjectivesDirectoryChain(parent, "archived objectives parent");
    const parentFd = parentChain.descriptors.at(-1)!;
    acquireArchivedObjectivesFlock(parentFd, "archived objectives parent");
    parentLocked = true;
    assertStableArchivedObjectivesDirectoryChain(rootChain, "archived objectives root");
    assertStableArchivedObjectivesDirectoryChain(parentChain, "archived objectives parent");
    const snapshot = readArchivedObjectivesFile(filePath);
    const next = mutation(parseArchivedObjectives(snapshot.raw));
    atomicWriteArchivedObjectives(filePath, next.items, snapshot.identity);
    result = next.result;
  } catch (error) {
    primary = error;
  }
  let cleanup: unknown;
  const tryCleanup = (action: () => void): void => {
    try {
      action();
    } catch (error) {
      if (cleanup === undefined) cleanup = error;
    }
  };
  if (parentLocked && parentChain) tryCleanup(() => releaseFlock(parentChain!.descriptors.at(-1)!));
  if (rootLocked && rootChain) tryCleanup(() => releaseFlock(rootChain!.descriptors.at(-1)!));
  tryCleanup(() => closeStableArchivedObjectivesDirectoryChain(parentChain));
  tryCleanup(() => closeStableArchivedObjectivesDirectoryChain(rootChain));
  if (primary !== undefined) throw primary;
  if (cleanup !== undefined) throw cleanup;
  return result;
}


function atomicWriteArchivedObjectives(
  filePath: string,
  items: readonly ArchivedObjectiveRecord[],
  expectedPrevious: { readonly dev: number; readonly ino: number } | undefined,
): void {
  const canonical = assertUniqueArchivedObjectives(items);
  const raw =
    canonical.map((item) => JSON.stringify(item)).join("\n") + (canonical.length ? "\n" : "");
  const parent = dirname(filePath);
  const temporary = join(
    parent,
    `.archived-objectives.${process.pid}.${randomBytes(12).toString("hex")}.tmp`,
  );
  let tempFd: number | undefined;
  let parentChain: StableArchivedObjectivesDirectoryChain | undefined;
  let renamed = false;
  try {
    tempFd = openSync(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollowFlag(),
      0o600,
    );
    const bytes = Buffer.from(raw, "utf8");
    for (let offset = 0; offset < bytes.length;) {
      invokeArchivedObjectivesPersistenceHook("before_write");
      const written = writeSync(tempFd, bytes, offset, bytes.length - offset);
      if (written <= 0)
        throw new HarnessError("INTEGRITY", "could not write archived objectives ledger");
      offset += written;
    }
    invokeArchivedObjectivesPersistenceHook("before_file_fsync");
    fsyncSync(tempFd);
    closeSync(tempFd);
    tempFd = undefined;
    try {
      const current = lstatSync(filePath);
      if (
        !expectedPrevious ||
        !current.isFile() ||
        current.nlink !== 1 ||
        current.dev !== expectedPrevious.dev ||
        current.ino !== expectedPrevious.ino
      ) {
        throw new HarnessError(
          "INTEGRITY",
          "archived objectives ledger changed before replacement",
        );
      }
    } catch (error) {
      if (!(expectedPrevious === undefined && hasOwnErrorCode(error, "ENOENT"))) throw error;
    }
    invokeArchivedObjectivesPersistenceHook("before_rename");
    parentChain = openStableArchivedObjectivesDirectoryChain(parent, "archived objectives parent");
    renameSync(temporary, filePath);
    renamed = true;
    invokeArchivedObjectivesPersistenceHook("after_rename");
    assertStableArchivedObjectivesDirectoryChain(parentChain, "archived objectives parent");
    invokeArchivedObjectivesPersistenceHook("before_directory_fsync");
    fsyncSync(parentChain.descriptors.at(-1)!);
  } catch (error) {
    if (renamed) {
      throw new HarnessError(
        "INTEGRITY",
        "archived objectives ledger mutation outcome is uncertain and possibly committed after rename",
      );
    }
    if (error instanceof HarnessError) throw error;
    throw new HarnessError("INTEGRITY", `archived objectives ledger mutation failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (tempFd !== undefined) closeSync(tempFd);
    closeStableArchivedObjectivesDirectoryChain(parentChain);
    if (!renamed) {
      try {
        unlinkSync(temporary);
      } catch (error) {
        if (!hasOwnErrorCode(error, "ENOENT")) throw error;
      }
    }
  }
}


/**
 * Writes records atomically to ARCHIVED_OBJECTIVES.jsonl.
 */
export function writeArchivedObjectives(
  items: readonly ArchivedObjectiveRecord[],
  customPath?: string,
): void {
  withArchivedObjectivesTransaction(customPath, () => ({ items, result: undefined }));
}

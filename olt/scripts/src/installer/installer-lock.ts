import { closeSync, constants, fstatSync, lstatSync, openSync } from "node:fs";
import { HarnessError } from "../core/errors/harness-error.ts";
import { releaseFlock, tryExclusiveFlock } from "../platform/flock-ffi.ts";
import type { PathIdentity } from "./path-safety.ts";

export interface InstallerLock {
  identity: PathIdentity;
  release(): void;
}

function directoryIdentity(stat: ReturnType<typeof fstatSync>): PathIdentity {
  if (!stat.isDirectory())
    throw new HarnessError("PATH_SAFETY", "installer lock is not a directory");
  return { device: BigInt(stat.dev), inode: BigInt(stat.ino), kind: "directory" };
}

export function acquireInstallerLock(parent: string): InstallerLock {
  const before = lstatSync(parent, { bigint: true });
  if (!before.isDirectory() || before.isSymbolicLink())
    throw new HarnessError("PATH_SAFETY", `installer parent is not a real directory: ${parent}`);
  const descriptor = openSync(
    parent,
    constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0),
  );
  let acquired = false;
  try {
    const opened = fstatSync(descriptor, { bigint: true });
    if (!opened.isDirectory() || before.dev !== opened.dev || before.ino !== opened.ino)
      throw new HarnessError("INVALID_STATE", "installer parent changed while acquiring lock");
    acquired = tryExclusiveFlock(descriptor);
    if (!acquired)
      throw new HarnessError("LOCK_TIMEOUT", `installer parent is already owned: ${parent}`);
    const identity = directoryIdentity(opened);
    let released = false;
    return {
      identity,
      release() {
        if (released) return;
        released = true;
        try {
          releaseFlock(descriptor);
        } finally {
          closeSync(descriptor);
        }
      },
    };
  } catch (error) {
    if (acquired) releaseFlock(descriptor);
    closeSync(descriptor);
    throw error;
  }
}

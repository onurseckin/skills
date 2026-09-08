import { closeSync, unlinkSync } from "node:fs";
import { daemonLockPath } from "../core/index.ts";

export function releaseDaemonLock(roomId: string, readerId: string, lockFd: number | null): void {
  try {
    if (lockFd !== null) closeSync(lockFd);
  } catch {}
  try {
    unlinkSync(daemonLockPath(roomId, readerId));
  } catch {}
}

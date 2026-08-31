import * as fs from "node:fs";
import type { LockPayload } from "../types.ts";
import { getInMemoryLock } from "./in-memory-locks.ts";

export function delay(milliseconds: number): void {
  if (milliseconds > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    return (error as { code?: string })?.code === "EPERM";
  }
}

export function parseLockPayload(content: string): LockPayload | null {
  const t = content.trim();
  if (!t.startsWith("{") || !t.endsWith("}")) return null;
  try {
    const p = JSON.parse(t) as Record<string, unknown>;
    if (
      typeof p["pid"] === "number" &&
      Number.isInteger(p["pid"]) &&
      typeof p["holder"] === "string" &&
      typeof p["created_at"] === "string"
    ) {
      return { pid: p["pid"], holder: p["holder"], created_at: p["created_at"] };
    }
    return null;
  } catch {
    return null;
  }
}

export function readHolderPid(lockPath: string): number | null {
  const mem = getInMemoryLock(lockPath);
  if (mem) return mem.pid;
  try {
    return parseLockPayload(fs.readFileSync(lockPath, "utf8"))?.pid ?? null;
  } catch {
    return null;
  }
}

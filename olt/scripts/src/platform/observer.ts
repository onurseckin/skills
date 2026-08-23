import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { hostname } from "node:os";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { atomicWriteJson, fsyncDirectory } from "../core/durable-write.ts";
import { LOCKS_DIRECTORY } from "../engine/store/layout.ts";

interface Observer {
  path: string;
  device: number;
  inode: number;
  token: string;
}

function sameDirectory(observer: Observer): boolean {
  try {
    const stat = lstatSync(observer.path);
    return (
      stat.isDirectory() &&
      !stat.isSymbolicLink() &&
      stat.dev === observer.device &&
      stat.ino === observer.inode
    );
  } catch {
    return false;
  }
}

export function observerDirectory(runRoot: string): string {
  return join(dirname(runRoot), LOCKS_DIRECTORY, basename(runRoot));
}

export function publishObserver(runRoot: string): Observer {
  const path = observerDirectory(runRoot);
  if (!existsSync(path)) mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error(`unsafe observer directory: ${path}`);
  chmodSync(path, 0o700);
  const token = randomUUID().replaceAll("-", "");
  const observer = { path, device: stat.dev, inode: stat.ino, token };
  atomicWriteJson(
    join(path, "owner.json"),
    {
      schema: "harness.lock-owner",
      version: 1,
      token,
      pid: process.pid,
      hostname: hostname(),
      acquired_at: new Date().toISOString(),
    },
    0o600,
  );
  return observer;
}

export function clearObserver(observer: Observer): void {
  if (!sameDirectory(observer)) return;
  const ownerPath = join(observer.path, "owner.json");
  let owner: unknown;
  try {
    const stat = lstatSync(ownerPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024) return;
    owner = JSON.parse(readFileSync(ownerPath, "utf8"));
  } catch {
    return;
  }
  if (
    typeof owner !== "object" ||
    owner === null ||
    (owner as { token?: unknown }).token !== observer.token
  )
    return;
  if (!sameDirectory(observer)) return;
  try {
    rmSync(ownerPath);
    fsyncDirectory(observer.path);
  } catch {}
}

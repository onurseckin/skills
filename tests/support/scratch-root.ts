import { afterEach } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { tmpdir } from "node:os";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const SCRATCH_BASE = join(REPO_ROOT, "coverage", "scratch");
const OWNERS_DIR = join(SCRATCH_BASE, ".owners");
const MAX_SLOT_ATTEMPTS = 1000;

function slug(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned.length > 0 ? cleaned.slice(0, 60) : "root";
}

function shortDigest(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 10);
}

const callsPerKey = new Map<string, number>();

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function ownerMarkerPath(dirName: string): string {
  return join(OWNERS_DIR, `${dirName}.json`);
}

function claimedByLiveOwner(dirName: string): boolean {
  try {
    const raw = readFileSync(ownerMarkerPath(dirName), "utf-8");
    const parsed = JSON.parse(raw) as { pid?: unknown };
    return typeof parsed.pid === "number" && isPidAlive(parsed.pid);
  } catch {
    return false;
  }
}

export function scratchRoot(callerPath: string, label: string): string {
  const fileTag = slug(relative(REPO_ROOT, callerPath).split(sep).join("-"));
  const key = `${fileTag}::${label}`;
  const digest = shortDigest(key);
  mkdirSync(SCRATCH_BASE, { recursive: true });
  mkdirSync(OWNERS_DIR, { recursive: true });

  for (let attempt = 0; attempt < MAX_SLOT_ATTEMPTS; attempt += 1) {
    const call = (callsPerKey.get(key) ?? 0) + 1;
    const dirName = `${fileTag}--${slug(label)}--${call}--${digest}`;
    const root = join(SCRATCH_BASE, dirName);

    try {
      mkdirSync(root);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (claimedByLiveOwner(dirName)) {
        callsPerKey.set(key, call);
        continue;
      }
      rmSync(root, { recursive: true, force: true });
      continue;
    }

    callsPerKey.set(key, call);
    const markerPath = ownerMarkerPath(dirName);
    writeFileSync(markerPath, JSON.stringify({ pid: process.pid }), "utf-8");
    afterEach(() => {
      rmSync(root, { recursive: true, force: true });
      rmSync(markerPath, { force: true });
    });
    return root;
  }

  throw new Error(`scratchRoot: exhausted ${MAX_SLOT_ATTEMPTS} slot attempts for key ${key}`);
}

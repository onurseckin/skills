import { afterEach } from "bun:test";
import { createHash } from "node:crypto";
import { join, relative, sep } from "node:path";
import { VirtualMemoryFS } from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

export const scratchVirtualFs = new VirtualMemoryFS();
const REPO_ROOT = join(import.meta.dir, "..", "..");
const SCRATCH_BASE = "/virtual/coverage/scratch";
const MAX_SLOT_ATTEMPTS = 1000;

export interface ScratchClaim {
  readonly root: string;
  readonly key: string;
  readonly call: number;
  readonly pid: number;
  readonly claimedAt: number;
}

function slug(value: string): string {
  const cleaned = value
    .replace(/\.+/g, "-")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned.length > 0 ? cleaned.slice(0, 60) : "root";
}

function shortDigest(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 10);
}

const callsPerKey = new Map<string, number>();
const activeClaims = new Map<string, ScratchClaim>();

export function scratchRoot(callerPath: string, label: string): string {
  const fileTag = slug(relative(REPO_ROOT, callerPath).split(sep).join("-"));
  const key = `${fileTag}::${label}`;
  const digest = shortDigest(key);

  for (let attempt = 0; attempt < MAX_SLOT_ATTEMPTS; attempt += 1) {
    const call = (callsPerKey.get(key) ?? 0) + 1;
    callsPerKey.set(key, call);

    const dirName = `${fileTag}--${slug(label)}--${call}--${digest}`;
    const root = `${SCRATCH_BASE}/${dirName}`;

    if (activeClaims.has(root)) {
      continue;
    }

    try {
      scratchVirtualFs.rmSync(root, { recursive: true, force: true });
    } catch {
      // Ignore if absent
    }
    scratchVirtualFs.mkdirSync(root, { recursive: true });

    const claim: ScratchClaim = {
      root,
      key,
      call,
      pid: process.pid,
      claimedAt: Date.now(),
    };
    activeClaims.set(root, claim);

    try {
      afterEach(() => {
        activeClaims.delete(root);
        try {
          scratchVirtualFs.rmSync(root, { recursive: true, force: true });
        } catch {
          // ignore cleanup errors
        }
      });
    } catch {
      // Intentionally ignored when invoked outside a bun:test context
    }

    return root;
  }

  throw new Error(`scratchRoot: exhausted ${MAX_SLOT_ATTEMPTS} slot attempts for key ${key}`);
}

export function isScratchRootActive(root: string): boolean {
  return activeClaims.has(root);
}

export function releaseScratchRoot(root: string): boolean {
  return activeClaims.delete(root);
}

export function getActiveScratchClaims(): readonly ScratchClaim[] {
  return Array.from(activeClaims.values());
}

export function resetScratchRegistry(): void {
  callsPerKey.clear();
  activeClaims.clear();
  try {
    scratchVirtualFs.reset();
  } catch {
    // Ignore reset error
  }
}

export { scratchRoot as createScratchRoot };

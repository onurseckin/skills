/**
 * @file critic-fixture.ts
 * In-memory test sandbox fixture for tests/critic domain
 */

import { afterEach } from "bun:test";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { virtualFS } from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

const SCRATCH_BASE = "/virtual/critic-scratch";
const rootsToClean: string[] = [];

afterEach(() => {
  for (const root of rootsToClean) {
    try {
      virtualFS.rmSync(root, { recursive: true, force: true });
    } catch {}
  }
  rootsToClean.length = 0;
});

function slug(value: string): string {
  const cleaned = value
    .replace(/\.+/g, "-")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const trimmed = cleaned.slice(0, 20).replace(/-+$/, "");
  return trimmed.length > 0 ? trimmed : "root";
}

function shortDigest(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

let counter = 0;

export function scratchRoot(callerPath = "critic-test", label = "test"): string {
  counter += 1;
  const fileTag = slug(callerPath);
  const labelTag = slug(label);
  const digest = shortDigest(`${fileTag}:${labelTag}:${counter}`);
  const raw = `${fileTag}-${labelTag}-${counter}-${digest}`
    .replace(/--+/g, "-")
    .replace(/^-+|-+$/g, "");
  const dirName = raw.slice(0, 50).replace(/-+$/, "");
  const root = join(SCRATCH_BASE, dirName);

  try {
    virtualFS.rmSync(root, { recursive: true, force: true });
  } catch {}

  virtualFS.mkdirSync(root, { recursive: true });
  rootsToClean.push(root);
  return root;
}

export function createSandboxDir(label = "sandbox"): string {
  return scratchRoot("sandbox", label);
}

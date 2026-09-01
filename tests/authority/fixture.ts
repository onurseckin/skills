import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { setDefectLogDependenciesForTesting } from "../../olt/scripts/src/logging/lock.ts";
import { generateCanonicalDefaultPolicy } from "../../olt/scripts/src/policy/generator/index.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../olt/scripts/src/testing/virtual-fs/index.ts";

let vfs = new VirtualMemoryFS();
let session: VirtualFSSession | undefined;
let restoreDefectDeps: (() => void) | undefined;
let counter = 0;

function normPath(p: string): string {
  return path.resolve(String(p)).replace(/\\/g, "/");
}

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

export function setupVirtualAuthorityFS(): VirtualMemoryFS {
  cleanupVirtualAuthorityFS();
  vfs = new VirtualMemoryFS();
  const repoRoot = normPath(process.cwd());
  vfs.mkdirSync(repoRoot, { recursive: true });
  vfs.mkdirSync(path.join(repoRoot, ".olt"), { recursive: true });
  vfs.writeFileSync(
    path.join(repoRoot, ".olt", "policy.json"),
    JSON.stringify(generateCanonicalDefaultPolicy(repoRoot, "bun")),
  );
  vfs.chdir(repoRoot);

  session = createVirtualFSSession(vfs);
  restoreDefectDeps = setDefectLogDependenciesForTesting({
    readFile: (p, opt) => {
      const np = normPath(String(p));
      const enc = typeof opt === "string" ? opt : opt?.encoding;
      return vfs.readFileSync(np, enc as BufferEncoding);
    },
  });
  return vfs;
}

export function cleanupVirtualAuthorityFS(): void {
  if (session) {
    session.cleanup();
    session = undefined;
  }
  if (restoreDefectDeps) {
    restoreDefectDeps();
    restoreDefectDeps = undefined;
  }
  vfs.reset();
}

export function getVirtualAuthorityFS(): VirtualMemoryFS {
  return vfs;
}

export function scratchRoot(callerPath = "authority-test", label = "test"): string {
  const currentFs = setupVirtualAuthorityFS();
  counter += 1;
  const fileTag = slug(callerPath);
  const labelTag = slug(label);
  const digest = shortDigest(`${fileTag}:${labelTag}:${counter}`);
  const raw = `${fileTag}-${labelTag}-${counter}-${digest}`
    .replace(/--+/g, "-")
    .replace(/^-+|-+$/g, "");
  const dirName = raw.slice(0, 50).replace(/-+$/, "");
  const root = `/virtual/authority-scratch/${dirName}`;
  currentFs.mkdirSync(root, { recursive: true });
  return root;
}

export function createSandboxDir(label = "sandbox"): string {
  return scratchRoot("sandbox", label);
}

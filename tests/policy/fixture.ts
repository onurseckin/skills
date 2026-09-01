import { createHash } from "node:crypto";
import * as path from "node:path";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../olt/scripts/src/testing/virtual-fs/index.ts";

import { generateCanonicalDefaultPolicy } from "../../olt/scripts/src/policy/generator/index.ts";

import {
  enableInMemorySessionStore,
  disableInMemorySessionStore,
} from "../../olt/scripts/src/authority/session/paths.ts";

let vfs = new VirtualMemoryFS();
let session: VirtualFSSession | undefined;
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

export function setupVirtualPolicyFS(): VirtualMemoryFS {
  cleanupVirtualPolicyFS();
  enableInMemorySessionStore();
  vfs = new VirtualMemoryFS();
  vfs.mkdirSync("/virtual", { recursive: true });
  vfs.writeFileSync("/virtual/package.json", JSON.stringify({ name: "virtual-root" }));
  vfs.mkdirSync("/virtual/.git", { recursive: true });
  const repoRoot = normPath(process.cwd());
  vfs.mkdirSync(repoRoot, { recursive: true });
  vfs.mkdirSync(path.join(repoRoot, ".olt"), { recursive: true });
  vfs.writeFileSync(
    path.join(repoRoot, "package.json"),
    JSON.stringify({ name: "@onurseckin/skills" }),
  );
  vfs.writeFileSync(
    path.join(repoRoot, ".olt", "policy.json"),
    JSON.stringify(generateCanonicalDefaultPolicy(repoRoot, "bun")),
  );
  vfs.chdir(repoRoot);
  session = createVirtualFSSession(vfs);
  return vfs;
}

export function cleanupVirtualPolicyFS(): void {
  disableInMemorySessionStore();
  if (session) {
    session.cleanup();
    session = undefined;
  }
  vfs.reset();
}

export function getVirtualPolicyFS(): VirtualMemoryFS {
  return vfs;
}

export function scratchRoot(callerPath = "policy-test", label = "test"): string {
  const currentFs = setupVirtualPolicyFS();
  counter += 1;
  const fileTag = slug(callerPath);
  const labelTag = slug(label);
  const digest = shortDigest(`${fileTag}:${labelTag}:${counter}`);
  const raw = `${fileTag}-${labelTag}-${counter}-${digest}`
    .replace(/--+/g, "-")
    .replace(/^-+|-+$/g, "");
  const dirName = raw.slice(0, 50).replace(/-+$/, "");
  const root = `/virtual/policy-scratch/${dirName}`;
  currentFs.mkdirSync(root, { recursive: true });
  return root;
}

export function createSandboxDir(label = "sandbox"): string {
  return scratchRoot("sandbox", label);
}

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

function normPath(p: string): string {
  return path.resolve(String(p)).replace(/\\/g, "/");
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

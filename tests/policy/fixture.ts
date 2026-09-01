import * as path from "node:path";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../olt/scripts/src/testing/virtual-fs/index.ts";

import { generateCanonicalDefaultPolicy } from "../../olt/scripts/src/policy/generator/index.ts";

let vfs = new VirtualMemoryFS();
let session: VirtualFSSession | undefined;

function normPath(p: string): string {
  return path.resolve(String(p)).replace(/\\/g, "/");
}

export function setupVirtualPolicyFS(): VirtualMemoryFS {
  cleanupVirtualPolicyFS();
  vfs = new VirtualMemoryFS();
  const repoRoot = normPath(process.cwd());
  vfs.mkdirSync(repoRoot, { recursive: true });
  vfs.mkdirSync(path.join(repoRoot, ".olt"), { recursive: true });
  vfs.writeFileSync(
    path.join(repoRoot, ".olt", "policy.json"),
    JSON.stringify(generateCanonicalDefaultPolicy(repoRoot, "bun")),
  );
  session = createVirtualFSSession(vfs);
  return vfs;
}

export function cleanupVirtualPolicyFS(): void {
  if (session) {
    session.cleanup();
    session = undefined;
  }
  vfs.reset();
}

export function getVirtualPolicyFS(): VirtualMemoryFS {
  return vfs;
}

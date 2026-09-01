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

function normPath(p: string): string {
  return path.resolve(String(p)).replace(/\\/g, "/");
}

export function setupVirtualEngineFS(): VirtualMemoryFS {
  cleanupVirtualEngineFS();
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

export function cleanupVirtualEngineFS(): void {
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

export function getVirtualEngineFS(): VirtualMemoryFS {
  return vfs;
}

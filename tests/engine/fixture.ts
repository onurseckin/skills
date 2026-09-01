import * as path from "node:path";
import {
  setGitRunnerForTesting,
  type GitRunner,
} from "../../olt/scripts/src/engine/worktree/index.ts";
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
let restoreGitRunner: (() => void) | undefined;

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

  const defaultMockGitRunner: GitRunner = (_cwd, argv) => {
    if (argv[0] === "rev-parse") return { status: 0, stdout: "main\n", stderr: "" };
    if (argv[0] === "worktree") return { status: 0, stdout: "", stderr: "" };
    if (argv[0] === "show-ref") return { status: 1, stdout: "", stderr: "" };
    if (argv[0] === "branch") return { status: 0, stdout: "main\n", stderr: "" };
    if (argv[0] === "status") return { status: 0, stdout: "", stderr: "" };
    if (argv[0] === "diff") return { status: 0, stdout: "", stderr: "" };
    if (argv[0] === "commit") return { status: 0, stdout: "[main 1234567] commit\n", stderr: "" };
    return { status: 0, stdout: "", stderr: "" };
  };
  restoreGitRunner = setGitRunnerForTesting(defaultMockGitRunner);

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
  if (restoreGitRunner) {
    restoreGitRunner();
    restoreGitRunner = undefined;
  }
  vfs.reset();
}

export function getVirtualEngineFS(): VirtualMemoryFS {
  return vfs;
}

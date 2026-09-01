import * as fs from "node:fs";
import { join, resolve } from "node:path";
import { spyOn } from "bun:test";
import * as childProcess from "node:child_process";
import ts from "typescript";
import { setDefectLogDependenciesForTesting } from "../../../../olt/scripts/src/logging/lock.ts";
import { generateCanonicalDefaultPolicy } from "../../../../olt/scripts/src/policy/generator/index.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../../olt/scripts/src/testing/virtual-fs/index.ts";
import {
  disableInMemoryAgentMetadata,
  enableInMemoryAgentMetadata,
} from "../../../../olt/scripts/src/runtime/session.ts";
import * as processTree from "../../../../olt/scripts/src/engine/runner/process/process-tree.ts";
import { mockGitSpawnSync } from "./plan-workflow-fixture.ts";

let vfs = new VirtualMemoryFS();
let session: VirtualFSSession | undefined;
let restoreDefectDeps: (() => void) | undefined;
let execFileSpy: { mockRestore: () => void } | undefined,
  spawnSyncSpy: { mockRestore: () => void } | undefined,
  execSyncSpy: { mockRestore: () => void } | undefined,
  bunSpawnSpy: { mockRestore: () => void } | undefined,
  processSnapshotSpy: { mockRestore: () => void } | undefined,
  fetchSpy: { mockRestore: () => void } | undefined;
const origTs = {
  readFile: ts.sys.readFile,
  fileExists: ts.sys.fileExists,
  directoryExists: ts.sys.directoryExists,
  getCurrentDirectory: ts.sys.getCurrentDirectory,
};

function normPath(p: string): string {
  return resolve(String(p)).replace(/\\/g, "/");
}

function mockStream(text: string) {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      if (text) c.enqueue(enc.encode(text));
      c.close();
    },
  });
}

function createMockChildProcess(exitCode = 0, stdoutText = "", stderrText = "") {
  return {
    pid: 99999,
    exitCode,
    exited: Promise.resolve(exitCode),
    stdout: mockStream(stdoutText),
    stderr: mockStream(stderrText),
    stdin: undefined,
    kill: () => {},
    ref: () => {},
    unref: () => {},
  };
}

export function setupVirtualCliFS(): VirtualMemoryFS {
  cleanupVirtualCliFS();
  enableInMemoryAgentMetadata();
  vfs = new VirtualMemoryFS();
  const repoRoot = normPath(process.cwd());
  for (const d of [
    repoRoot,
    join(repoRoot, ".olt"),
    join(repoRoot, ".git"),
    "/virtual/coverage/scratch",
  ]) {
    vfs.mkdirSync(d, { recursive: true });
  }
  vfs.writeFileSync(
    join(repoRoot, "package.json"),
    JSON.stringify({ name: "skills", version: "1.0.0" }),
  );
  vfs.writeFileSync(
    join(repoRoot, ".olt", "policy.json"),
    JSON.stringify(generateCanonicalDefaultPolicy(repoRoot, "bun")),
  );

  restoreDefectDeps = setDefectLogDependenciesForTesting({
    readFile: (p, opt) => fs.readFileSync(p, opt),
  });
  execFileSpy = spyOn(childProcess, "execFile").mockImplementation(((_c, a, o, cb) => {
    const fn =
      typeof cb === "function"
        ? cb
        : typeof o === "function"
          ? o
          : typeof a === "function"
            ? a
            : undefined;
    if (fn)
      queueMicrotask(() =>
        (fn as (err: null, out: string, errOut: string) => void)(
          null,
          `${process.pid} 1 ${process.pid}\n`,
          "",
        ),
      );
    return {} as never;
  }) as never);

  session = createVirtualFSSession(vfs);
  vfs.chdir(repoRoot);

  const committedBlobs = new Map<string, string>();
  spawnSyncSpy = spyOn(childProcess, "spawnSync").mockImplementation(
    ((cmd: string, args?: string[], opts?: { cwd?: string; encoding?: string }) =>
      mockGitSpawnSync(cmd, args, opts, repoRoot, committedBlobs, fs, resolve) as never) as never,
  );

  execSyncSpy = spyOn(childProcess, "execSync").mockImplementation((() =>
    Buffer.from("")) as never);
  bunSpawnSpy = spyOn(Bun, "spawn").mockImplementation(((...args: unknown[]) => {
    const first = args[0],
      cmd = Array.isArray(first)
        ? first
        : typeof first === "object" &&
            first !== null &&
            "cmd" in first &&
            Array.isArray((first as { cmd: unknown }).cmd)
          ? (first as { cmd: string[] }).cmd
          : [];
    const cmdStr = cmd.join(" ") + " " + JSON.stringify(args);
    if (
      cmdStr.includes("missing-shell-input") ||
      cmdStr.includes("false") ||
      cmdStr.includes("exit 1") ||
      cmdStr.includes("gate-red")
    ) {
      return createMockChildProcess(1, "", "mock command error");
    }
    return createMockChildProcess(0, "", "");
  }) as never);

  processSnapshotSpy = spyOn(processTree, "processSnapshot").mockImplementation(
    async () =>
      new Map([
        [process.pid, { pid: process.pid, parent: 1, group: process.pid }],
        [99999, { pid: 99999, parent: process.pid, group: 99999 }],
      ]),
  );
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation((() =>
    Promise.reject(new Error("network disabled in tests"))) as never);
  ts.sys.readFile = (p: string, encoding?: string) => {
    try {
      return fs.readFileSync(p, (encoding as BufferEncoding) || "utf8");
    } catch {
      return origTs.readFile(p, encoding);
    }
  };
  ts.sys.fileExists = (p: string) => fs.existsSync(p) || origTs.fileExists(p);
  ts.sys.directoryExists = (p: string) => {
    try {
      return fs.statSync(p).isDirectory();
    } catch {
      return origTs.directoryExists(p);
    }
  };
  ts.sys.getCurrentDirectory = () => normPath(process.cwd());
  return vfs;
}

export function cleanupVirtualCliFS(): void {
  ts.sys.readFile = origTs.readFile;
  ts.sys.fileExists = origTs.fileExists;
  ts.sys.directoryExists = origTs.directoryExists;
  ts.sys.getCurrentDirectory = origTs.getCurrentDirectory;
  for (const s of [
    processSnapshotSpy,
    bunSpawnSpy,
    execSyncSpy,
    spawnSyncSpy,
    fetchSpy,
    execFileSpy,
  ]) {
    try {
      s?.mockRestore();
    } catch {}
  }
  processSnapshotSpy =
    bunSpawnSpy =
    execSyncSpy =
    spawnSyncSpy =
    fetchSpy =
    execFileSpy =
      undefined;
  if (session) {
    session.cleanup();
    session = undefined;
  }
  if (restoreDefectDeps) {
    restoreDefectDeps();
    restoreDefectDeps = undefined;
  }
  disableInMemoryAgentMetadata();
  vfs.reset();
}

export function getVirtualCliFS(): VirtualMemoryFS {
  return vfs;
}
export {
  GATE_SCRIPT,
  cleanCompletionReview,
  cleanupRoots,
  runStateAssertion,
  successfulCommand,
  writeJson,
} from "./plan-workflow-fixture.ts";

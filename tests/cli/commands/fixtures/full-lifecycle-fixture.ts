import * as fs from "node:fs";
import { writeFile } from "node:fs/promises";
import * as path from "node:path";
import { basename, join } from "node:path";
import { execute } from "../../../../olt/scripts/src/cli/execute.ts";
import { setDefectLogDependenciesForTesting } from "../../../../olt/scripts/src/logging/lock.ts";
import { generateCanonicalDefaultPolicy } from "../../../../olt/scripts/src/policy/generator/index.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../../olt/scripts/src/testing/virtual-fs/index.ts";

import { spyOn } from "bun:test";
import * as childProcess from "node:child_process";

import {
  disableInMemoryAgentMetadata,
  enableInMemoryAgentMetadata,
} from "../../../../olt/scripts/src/runtime/session.ts";
import * as processTree from "../../../../olt/scripts/src/engine/runner/process/process-tree.ts";

let vfs = new VirtualMemoryFS();
let session: VirtualFSSession | undefined;
let restoreDefectDeps: (() => void) | undefined;
let execFileSpy: { mockRestore: () => void } | undefined;
let spawnSyncSpy: { mockRestore: () => void } | undefined;
let execSyncSpy: { mockRestore: () => void } | undefined;
let bunSpawnSpy: { mockRestore: () => void } | undefined;
let processSnapshotSpy: { mockRestore: () => void } | undefined;
let fetchSpy: { mockRestore: () => void } | undefined;

function normPath(p: string): string {
  return path.resolve(String(p)).replace(/\\/g, "/");
}

function createMockChildProcess(exitCode = 0, stdoutText = "", stderrText = "") {
  const encoder = new TextEncoder();
  const stdoutStream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (stdoutText) controller.enqueue(encoder.encode(stdoutText));
      controller.close();
    },
  });
  const stderrStream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (stderrText) controller.enqueue(encoder.encode(stderrText));
      controller.close();
    },
  });
  return {
    pid: 99999,
    exitCode,
    exited: Promise.resolve(exitCode),
    stdout: stdoutStream,
    stderr: stderrStream,
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
  vfs.mkdirSync(repoRoot, { recursive: true });
  vfs.mkdirSync(path.join(repoRoot, ".olt"), { recursive: true });
  vfs.mkdirSync(path.join(repoRoot, ".git"), { recursive: true });
  vfs.writeFileSync(
    path.join(repoRoot, "package.json"),
    JSON.stringify({ name: "skills", version: "1.0.0" }),
  );
  vfs.writeFileSync(
    path.join(repoRoot, ".olt", "policy.json"),
    JSON.stringify(generateCanonicalDefaultPolicy(repoRoot, "bun")),
  );
  vfs.mkdirSync("/virtual/coverage/scratch", { recursive: true });

  restoreDefectDeps = setDefectLogDependenciesForTesting({
    readFile: (p, opt) => fs.readFileSync(p, opt),
  });
  execFileSpy = spyOn(childProcess, "execFile").mockImplementation(((
    _cmd: string,
    argsOrCallback?: unknown,
    optionsOrCallback?: unknown,
    callback?: unknown,
  ) => {
    const cb =
      typeof callback === "function"
        ? (callback as (err: null, stdout: string, stderr: string) => void)
        : typeof optionsOrCallback === "function"
          ? (optionsOrCallback as (err: null, stdout: string, stderr: string) => void)
          : typeof argsOrCallback === "function"
            ? (argsOrCallback as (err: null, stdout: string, stderr: string) => void)
            : undefined;
    if (cb) {
      queueMicrotask(() => cb(null, `${process.pid} 1 ${process.pid}\n`, ""));
    }
    return {} as never;
  }) as never);

  spawnSyncSpy = spyOn(childProcess, "spawnSync").mockImplementation(((
    cmd: string,
    args?: string[],
  ) => {
    const argStr = Array.isArray(args) ? args.join(" ") : "";
    if (
      argStr.includes("missing-shell-input") ||
      argStr.includes("false") ||
      argStr.includes("exit 1")
    ) {
      return { status: 1, stdout: "", stderr: "mock command error" };
    }
    if (argStr.includes("rev-parse --show-toplevel")) {
      return { status: 0, stdout: repoRoot, stderr: "" };
    }
    if (argStr.includes("rev-parse HEAD")) {
      return { status: 0, stdout: "0123456789abcdef0123456789abcdef01234567\n", stderr: "" };
    }
    return { status: 0, stdout: "", stderr: "" };
  }) as never);

  execSyncSpy = spyOn(childProcess, "execSync").mockImplementation((() => {
    return Buffer.from("");
  }) as never);

  bunSpawnSpy = spyOn(Bun, "spawn").mockImplementation(((...args: unknown[]) => {
    const first = args[0];
    let cmd: string[] = [];
    if (Array.isArray(first)) {
      cmd = first as string[];
    } else if (
      typeof first === "object" &&
      first !== null &&
      "cmd" in first &&
      Array.isArray((first as { cmd: unknown }).cmd)
    ) {
      cmd = (first as { cmd: string[] }).cmd;
    }
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

  processSnapshotSpy = spyOn(processTree, "processSnapshot").mockImplementation(async () => {
    return new Map([
      [process.pid, { pid: process.pid, parent: 1, group: process.pid }],
      [99999, { pid: 99999, parent: process.pid, group: 99999 }],
    ]);
  });

  fetchSpy = spyOn(globalThis, "fetch").mockImplementation((() =>
    Promise.reject(new Error("network disabled in tests"))) as never);
  session = createVirtualFSSession(vfs);
  vfs.chdir(repoRoot);
  return vfs;
}

export function cleanupVirtualCliFS(): void {
  if (processSnapshotSpy) {
    try {
      processSnapshotSpy.mockRestore();
    } catch {}
    processSnapshotSpy = undefined;
  }
  if (bunSpawnSpy) {
    try {
      bunSpawnSpy.mockRestore();
    } catch {}
    bunSpawnSpy = undefined;
  }
  if (execSyncSpy) {
    try {
      execSyncSpy.mockRestore();
    } catch {}
    execSyncSpy = undefined;
  }
  if (spawnSyncSpy) {
    try {
      spawnSyncSpy.mockRestore();
    } catch {}
    spawnSyncSpy = undefined;
  }
  if (fetchSpy) {
    try {
      fetchSpy.mockRestore();
    } catch {}
    fetchSpy = undefined;
  }
  if (execFileSpy) {
    try {
      execFileSpy.mockRestore();
    } catch {}
    execFileSpy = undefined;
  }
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

export const GATE_SCRIPT = "gate-check.ts";

export function runStateAssertion(): string[] {
  return ["bun", GATE_SCRIPT];
}

export async function cleanupRoots(roots: string[]): Promise<void> {
  roots.splice(0);
}

export async function writeJson(root: string, name: string, value: unknown): Promise<string> {
  const path = join(root, name);
  await writeFile(path, JSON.stringify(value));
  return path;
}

export function cleanCompletionReview(
  packetSha256: unknown,
  readinessSha256: unknown,
  repositoryBinding: unknown,
  runGate: string,
  criticCheck: string,
) {
  return {
    packet_id: "critic-1",
    packet_sha256: packetSha256,
    readiness_sha256: readinessSha256,
    repository_binding: repositoryBinding,
    graph_revision: 1,
    status: "clean",
    unresolved_finding_ids: [],
    findings: [],
    integrity_evidence: [{ status: "passed", issues: [] }],
    repository_command_ids: [runGate],
    checks: [{ command_id: criticCheck }],
    requirement_proofs: [
      {
        requirement_id: "R-001",
        status: "satisfied",
        evidence: [
          {
            kind: "state",
            reference: "requirement:R-001",
            observation: "task validation and mandatory gate satisfied the requirement",
          },
        ],
      },
    ],
    residual_risks: [],
  };
}

export async function successfulCommand(
  run: string,
  repo: string,
  actor: string,
  task?: string,
  gate?: string,
): Promise<string> {
  const result = await execute([
    "run",
    "--run",
    run,
    "--actor",
    actor,
    "--cwd",
    repo,
    ...(task ? ["--task", task] : []),
    ...(gate ? ["--gate", gate] : []),
    "--",
    ...runStateAssertion(basename(run)),
  ]);
  return (result.record as { id: string }).id;
}

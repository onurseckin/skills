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

let vfs = new VirtualMemoryFS();
let session: VirtualFSSession | undefined;
let restoreDefectDeps: (() => void) | undefined;
let execFileSpy: { mockRestore: () => void } | undefined;
let fetchSpy: { mockRestore: () => void } | undefined;

function normPath(p: string): string {
  return path.resolve(String(p)).replace(/\\/g, "/");
}

export function setupVirtualCliFS(): VirtualMemoryFS {
  cleanupVirtualCliFS();
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
      queueMicrotask(() => cb(null, "", ""));
    }
    return {} as never;
  }) as never);
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation((() =>
    Promise.reject(new Error("network disabled in tests"))) as never);
  session = createVirtualFSSession(vfs);
  vfs.chdir(repoRoot);
  return vfs;
}

export function cleanupVirtualCliFS(): void {
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

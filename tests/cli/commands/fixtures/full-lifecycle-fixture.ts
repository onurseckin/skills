import * as fs from "node:fs";
import { chmodSync, readdirSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
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

let vfs = new VirtualMemoryFS();
let session: VirtualFSSession | undefined;
let restoreDefectDeps: (() => void) | undefined;

function normPath(p: string): string {
  return path.resolve(String(p)).replace(/\\/g, "/");
}

export function setupVirtualCliFS(): VirtualMemoryFS {
  cleanupVirtualCliFS();
  vfs = new VirtualMemoryFS();
  const repoRoot = normPath(process.cwd());
  vfs.mkdirSync(repoRoot, { recursive: true });
  vfs.mkdirSync(path.join(repoRoot, ".olt"), { recursive: true });
  vfs.writeFileSync(
    path.join(repoRoot, ".olt", "policy.json"),
    JSON.stringify(generateCanonicalDefaultPolicy(repoRoot, "bun")),
  );

  restoreDefectDeps = setDefectLogDependenciesForTesting({
    readFile: (p, opt) => fs.readFileSync(p, opt),
  });
  session = createVirtualFSSession(vfs);
  return vfs;
}

export function cleanupVirtualCliFS(): void {
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

function makeWritable(path: string): void {
  try {
    chmodSync(path, 0o700);
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) makeWritable(child);
      else chmodSync(child, 0o600);
    }
  } catch {}
}

export async function cleanupRoots(roots: string[]): Promise<void> {
  const toClean = roots.splice(0);
  await Promise.all(
    toClean.map(async (root) => {
      try {
        makeWritable(root);
        await rm(root, { recursive: true, force: true });
      } catch {}
    }),
  );
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

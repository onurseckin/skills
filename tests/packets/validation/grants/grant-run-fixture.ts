import { afterAll } from "bun:test";
import { join } from "node:path";
import type { CommandRecord } from "../../../../olt/scripts/src/core/contracts/index.ts";
import type { RepositoryBinding } from "../../../../olt/scripts/src/core/contracts/index.ts";
import { initRun, transact } from "../../../../olt/scripts/src/engine/store/index.ts";
import { workflowPort } from "../../../../olt/scripts/src/integration/store-ports.ts";
import { recordRepositoryInspection } from "../../../../olt/scripts/src/packets/repository-inspection.ts";
import { inspectRepositoryBinding } from "../../../../olt/scripts/src/packets/repository-identity.ts";
import { captureGateEnvironment } from "../../../../olt/scripts/src/engine/runner/index.ts";
import { captureGatePathBindings } from "../../../../olt/scripts/src/engine/runner/index.ts";
import { canonicalCommandFingerprint } from "../../../../olt/scripts/src/engine/runner/index.ts";
import type { TransactionPort } from "../../../../olt/scripts/src/workflow/types.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../../olt/scripts/src/testing/virtual-fs/index.ts";

import {
  disableInMemorySessionStore,
  enableInMemorySessionStore,
  isInMemorySessionStoreEnabled,
} from "../../../../olt/scripts/src/authority/session/paths.ts";

const vfs = new VirtualMemoryFS();
let session: VirtualFSSession | undefined;

function ensureSession(): VirtualMemoryFS {
  if (!isInMemorySessionStoreEnabled()) {
    enableInMemorySessionStore();
  }
  if (!session) {
    session = createVirtualFSSession(vfs);
  }
  return vfs;
}

export function getGrantRunFS(): VirtualMemoryFS {
  return ensureSession();
}

export function getGrantRunSession(): VirtualFSSession {
  ensureSession();
  return session!;
}

afterAll(() => {
  disableInMemorySessionStore();
  if (session) {
    session.cleanup();
    session = undefined;
  }
  vfs.reset();
});

export interface GrantRun {
  repo: string;
  run: string;
  port: TransactionPort;
}

export async function emptyGrantRun(prefix: string): Promise<GrantRun> {
  const memFs = ensureSession();
  const root = `/virtual/${prefix}-${Math.random().toString(36).slice(2)}`;
  const repo = join(root, "repo");
  memFs.mkdirSync(repo, { recursive: true });
  memFs.mkdirSync(join(repo, ".git"), { recursive: true });
  memFs.mkdirSync(join(repo, ".olt"), { recursive: true });
  memFs.mkdirSync(join(root, ".git"), { recursive: true });
  memFs.mkdirSync(join(root, ".olt"), { recursive: true });
  const run = initRun(repo, "grant-run", new TextEncoder().encode("Build the thing"), "file", true);
  return { repo, run, port: workflowPort(run) };
}

export interface SeedTaskOptions {
  taskId?: string;
  requirementId?: string;
  gateId?: string;
}

export function seedSingleTaskGraph(
  run: string,
  { taskId = "T-1", requirementId = "R-1", gateId = "G-1" }: SeedTaskOptions = {},
): void {
  transact(run, "test-setup", "seed-graph", {}, (draft) => {
    draft.graph = {
      revision: 1,
      gates: [
        {
          id: gateId,
          command: ["bun", "gate.ts"],
          cwd: ".",
          scope: "task",
          requirement_ids: [requirementId],
          mandatory: true,
        },
      ],
    };
    draft.requirements = {
      requirements: [
        {
          id: requirementId,
          status: "planned",
          evidence: [],
          disposition: "actionable",
          dependencies: [],
        },
      ],
    };
    draft.tasks = {
      [taskId]: {
        id: taskId,
        status: "ready",
        requirement_ids: [requirementId],
        write_scope: ["src/owned"],
        dependencies: [],
        attempts: [],
        history: [],
        repair_round: 0,
      },
    };
  });
}

export async function seedRepositoryInspection(
  run: string,
  actor: string,
  { current = true }: { current?: boolean } = {},
): Promise<void> {
  recordRepositoryInspection(run, actor, "baseline");
  if (current) recordRepositoryInspection(run, actor, "current");
}

const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const FIXTURE_OWNERSHIP_TOKEN = "00000000-0000-4000-8000-000000000000";
const FIXTURE_SIGNING_PUBLIC_KEY = "MCowBQYDK2VwAyEAebJY5kfIxE+SBdW0wwTb+c0PuvZ21w9gpaa9L86ygKc=";

function runGateCommandRecord(
  repo: string,
  binding: RepositoryBinding,
  id: string,
  argv: string[],
  gateId: string,
  actor: string,
): CommandRecord {
  const cwd = repo;
  const environment = captureGateEnvironment(process.env, FIXTURE_OWNERSHIP_TOKEN);
  const startedAt = "2026-01-01T00:00:00.000Z";
  const finishedAt = "2026-01-01T00:00:01.000Z";
  const logs = {
    stdout: { path: `commands/${id}/attempts/1/stdout.log`, bytes: 0, sha256: EMPTY_SHA256 },
    stderr: { path: `commands/${id}/attempts/1/stderr.log`, bytes: 0, sha256: EMPTY_SHA256 },
  };
  return {
    id,
    argv,
    cwd,
    cwd_relative: ".",
    repository_root: repo,
    status: "succeeded",
    task_id: null,
    gate_id: gateId,
    actor,
    attempt_signing_public_key: FIXTURE_SIGNING_PUBLIC_KEY,
    started_at: startedAt,
    finished_at: finishedAt,
    exit_code: 0,
    signal: null,
    timeout_kind: null,
    signals_sent: [],
    fingerprint: canonicalCommandFingerprint(cwd, argv),
    environment,
    path_bindings: captureGatePathBindings(repo, cwd, argv, environment.PATH),
    record_path: `commands/${id}/record.json`,
    policy: {
      wall_timeout_ms: 60_000,
      idle_timeout_ms: 30_000,
      grace_ms: 1_000,
      drain_timeout_ms: 1_000,
      heartbeat_interval_ms: 1_000,
      max_output_bytes: 1_000_000,
      max_retries: 0,
      idempotent: false,
    },
    logs,
    retry_exhausted: false,
    assurance: "trusted_host_observed_v1",
    repository_before: structuredClone(binding),
    repository_after: structuredClone(binding),
    attempts: [
      {
        id,
        attempt: 1,
        status: "succeeded",
        started_at: startedAt,
        finished_at: finishedAt,
        exit_code: 0,
        signal: null,
        signals_sent: [],
        timeout_kind: null,
        failure_class: null,
        activity_path: `commands/${id}/attempts/1/activity.jsonl`,
        activity: {
          path: `commands/${id}/attempts/1/activity.jsonl`,
          bytes: 0,
          sha256: EMPTY_SHA256,
        },
        logs,
        gate_finalized_at: finishedAt,
        repository_after: structuredClone(binding),
      },
    ],
  };
}

export async function seedRunGateCommand(
  repo: string,
  run: string,
  options: { gateId?: string; commandId?: string; actor?: string } = {},
): Promise<string> {
  const gateId = options.gateId !== undefined ? options.gateId : "gate-run-completion";
  const commandId = options.commandId !== undefined ? options.commandId : "C-RUN-GATE-EVIDENCE";
  const actor = options.actor !== undefined ? options.actor : "coordinator";
  const argv = ["bun", "run-gate.ts"];
  ensureSession().writeFileSync(join(repo, "run-gate.ts"), "console.log('run gate');\n");
  const binding = inspectRepositoryBinding(repo);
  const record = runGateCommandRecord(repo, binding, commandId, argv, gateId, actor);
  transact(run, "test-setup", "seed-run-gate", {}, (draft) => {
    const graph = draft.graph as { gates?: unknown[] };
    const existingGates =
      graph.gates !== undefined && Array.isArray(graph.gates) ? graph.gates : [];
    graph.gates = [
      ...existingGates,
      { id: gateId, command: argv, cwd: ".", scope: "run", requirement_ids: [], mandatory: true },
    ];
    draft.current_repository_binding = structuredClone(binding);
    draft.commands = { ...(draft.commands as Record<string, unknown>), [commandId]: record };
  });
  return commandId;
}

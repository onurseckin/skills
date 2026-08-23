import { afterAll } from "bun:test";
import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CommandRecord } from "../../../olt/scripts/src/contracts/commands.ts";
import type { RepositoryBinding } from "../../../olt/scripts/src/contracts/repository.ts";
import { initRun, transact } from "../../../olt/scripts/src/store/index.ts";
import { workflowPort } from "../../../olt/scripts/src/integration/store-ports.ts";
import { recordRepositoryInspection } from "../../../olt/scripts/src/packets/repository-inspection.ts";
import { inspectRepositoryBinding } from "../../../olt/scripts/src/packets/repository-identity.ts";
import { captureGateEnvironment } from "../../../olt/scripts/src/runner/gate-environment.ts";
import { captureGatePathBindings } from "../../../olt/scripts/src/runner/gate-path-bindings.ts";
import { canonicalCommandFingerprint } from "../../../olt/scripts/src/runner/command-id.ts";
import type { TransactionPort } from "../../../olt/scripts/src/workflow/types.ts";

/**
 * Non-CLI, non-git capsule + graph fixture shared by the packet-grant unit tests
 * (role-grant, critic-grant, plan-validator-grant, planner-packet). loadRun's integrity
 * verification and the repository inspection walk both need a real capsule on disk, but
 * nothing here spawns a subprocess: initRun/transact are pure fs, and the fixture repo is
 * never git-initialized so repository-snapshot's git probing short-circuits to unavailable.
 */

const roots: string[] = [];
afterAll(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

export interface GrantRun {
  repo: string;
  run: string;
  port: TransactionPort;
}

/** Creates an empty capsule (no graph/tasks yet) under a disposable repo directory. */
export async function emptyGrantRun(prefix: string): Promise<GrantRun> {
  const root = realpathSync(await mkdtemp(join(tmpdir(), prefix)));
  roots.push(root);
  const repo = join(root, "repo");
  await mkdir(repo);
  const run = initRun(repo, "grant-run", new TextEncoder().encode("Build the thing"), "file", true);
  return { repo, run, port: workflowPort(run) };
}

export interface SeedTaskOptions {
  taskId?: string;
  requirementId?: string;
  gateId?: string;
}

/**
 * Writes a minimal one-task graph (graph/tasks/requirements) directly onto the capsule state,
 * bypassing plan:init/plan:add/plan:compile — those are structural CLI calls with no subprocess
 * of their own, but writing the shape by hand keeps these fixtures single-purpose and fast.
 */
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

/** Records baseline (and, unless current=false, current) repository inspections for the run. */
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

/**
 * Builds a CommandRecord that structurally satisfies commandMatchesGate/embeddedCommandIssues
 * for a run-scoped gate, the same way tests/unit/cli/critic-ready-fixture.ts does: computed
 * with the runner's own fingerprint/environment/path-binding/repository-binding functions
 * against a real (but never executed) repo, rather than by actually spawning the gate command.
 */
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

/**
 * Registers one authoritative run-gate command directly on the capsule state: the shape that
 * critic-grant.ts's repositoryEvidenceCommandIds requires before a completeness-critic packet
 * can be published (at least one succeeded, structurally-matching command run against a
 * run-scoped gate). Writes the gate's target file so the real path-binding capture can open it.
 */
export async function seedRunGateCommand(
  repo: string,
  run: string,
  options: { gateId?: string; commandId?: string; actor?: string } = {},
): Promise<string> {
  const gateId = options.gateId ?? "gate-run-completion";
  const commandId = options.commandId ?? "C-RUN-GATE-EVIDENCE";
  const actor = options.actor ?? "coordinator";
  const argv = ["bun", "run-gate.ts"];
  await writeFile(join(repo, "run-gate.ts"), "console.log('run gate');\n");
  const binding = inspectRepositoryBinding(repo);
  const record = runGateCommandRecord(repo, binding, commandId, argv, gateId, actor);
  transact(run, "test-setup", "seed-run-gate", {}, (draft) => {
    const graph = draft.graph as { gates?: unknown[] };
    graph.gates = [
      ...(graph.gates ?? []),
      { id: gateId, command: argv, cwd: ".", scope: "run", requirement_ids: [], mandatory: true },
    ];
    draft.current_repository_binding = structuredClone(binding);
    draft.commands = { ...(draft.commands as Record<string, unknown>), [commandId]: record };
  });
  return commandId;
}

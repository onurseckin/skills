import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  CommandRecord,
  JsonObject,
  RepositoryBinding,
} from "../../../../olt/scripts/src/core/contracts/index.ts";
import { execute } from "../../../../olt/scripts/src/cli/execute.ts";
import { inspectRepositoryBinding } from "../../../../olt/scripts/src/packets/repository-identity.ts";
import {
  captureGateEnvironment,
  captureGatePathBindings,
  canonicalCommandFingerprint,
} from "../../../../olt/scripts/src/engine/runner/index.ts";
import { transact } from "../../../../olt/scripts/src/engine/store/index.ts";
import {
  establishSupervisorChain,
  registerUnderChain,
} from "../../../shared/chains/agent-supervisor-chain.ts";
import { setupVirtualCliFS } from "./full-lifecycle-fixture.ts";

/**
 * critic:start readiness gate fixture. Synthesizes task-done / requirement-satisfied /
 * authoritative-command records without spawning redundant subprocesses.
 */

const FIXTURE_STARTED_AT = "2026-01-01T00:00:00.000Z";
const FIXTURE_FINISHED_AT = "2026-01-01T00:00:01.000Z";
const FIXTURE_DEADLINE_AT = "2026-01-01T01:00:00.000Z";
const FIXTURE_OWNERSHIP_TOKEN = "00000000-0000-4000-8000-000000000000";
const FIXTURE_SIGNING_PUBLIC_KEY = "MCowBQYDK2VwAyEAebJY5kfIxE+SBdW0wwTb+c0PuvZ21w9gpaa9L86ygKc=";
// sha256 of the empty string: every fixture command claims zero-byte logs, so this is the one
// digest every log/activity metadata entry below can honestly carry.
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export const REQUIREMENT_ID = "req-1";
export const TASK_ID = "task-1";
export const TASK_GATE_ID = "gate-1";
export const RUN_GATE_ID = "gate-run-completion";

const CRITIC_ID_BY_FIXTURE_NAME: Readonly<Record<string, string>> = {
  "critic-approve-run": "critic-alpha",
  "critic-changes-run": "critic-beta",
  "critic-no-findings": "critic-delta",
  "critic-integrity-evidence": "critic-epsilon",
  "critic-reject-flow": "critic-gamma",
  "critic-repo-ids-widen": "critic-zeta",
  "critic-repo-ids-bogus": "critic-theta",
  "critic-review-approve-findings": "critic-kappa",
  "critic-review-empty-findings": "critic-lambda",
  "critic-review-no-assignment": "critic-never-started",
  "critic-review-file": "critic-file",
  "run-complete-bad-token": "critic-2",
};

const PLANNER_COORDINATOR_FIXTURE_NAMES: ReadonlySet<string> = new Set(["critic-reject-flow"]);

export interface ReadyRun {
  repo: string;
  run: string;
  /** task-1's own authoritative gate command (task-scoped, satisfies task readiness). */
  taskGateCommandId: string;
  /** gate-run-completion's authoritative command (run-scoped, satisfies run-gate readiness). */
  runGateCommandId: string;
}

function commandLogMetadata(id: string, stream: "stdout" | "stderr") {
  return { path: `commands/${id}/attempts/1/${stream}.log`, bytes: 0, sha256: EMPTY_SHA256 };
}

function buildCommandRecord(
  repo: string,
  binding: RepositoryBinding | undefined,
  id: string,
  options: { argv: string[]; taskId: string | null; gateId: string | null; actor: string },
): CommandRecord {
  const { argv, taskId, gateId, actor } = options;
  const cwd = repo;
  const environment = captureGateEnvironment(process.env, FIXTURE_OWNERSHIP_TOKEN);
  const logs = {
    stdout: commandLogMetadata(id, "stdout"),
    stderr: commandLogMetadata(id, "stderr"),
  };
  const activity = {
    path: `commands/${id}/attempts/1/activity.jsonl`,
    bytes: 0,
    sha256: EMPTY_SHA256,
  };
  if (gateId !== null && !binding) {
    throw new Error("gate commands require a repository binding");
  }
  return {
    id,
    argv,
    cwd,
    cwd_relative: ".",
    repository_root: repo,
    status: "succeeded",
    task_id: taskId,
    gate_id: gateId,
    actor,
    attempt_signing_public_key: FIXTURE_SIGNING_PUBLIC_KEY,
    started_at: FIXTURE_STARTED_AT,
    finished_at: FIXTURE_FINISHED_AT,
    exit_code: 0,
    signal: null,
    timeout_kind: null,
    signals_sent: [],
    fingerprint: canonicalCommandFingerprint(cwd, argv),
    environment,
    ...(gateId !== null
      ? { path_bindings: captureGatePathBindings(repo, cwd, argv, environment.PATH) }
      : {}),
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
    ...(gateId !== null
      ? {
          assurance: "trusted_host_observed_v1" as const,
          repository_before: structuredClone(binding!),
          repository_after: structuredClone(binding!),
        }
      : {}),
    attempts: [
      {
        id,
        attempt: 1,
        status: "succeeded",
        started_at: FIXTURE_STARTED_AT,
        finished_at: FIXTURE_FINISHED_AT,
        exit_code: 0,
        signal: null,
        signals_sent: [],
        timeout_kind: null,
        failure_class: null,
        activity_path: activity.path,
        activity,
        logs,
        ...(gateId !== null
          ? { gate_finalized_at: FIXTURE_FINISHED_AT, repository_after: structuredClone(binding!) }
          : {}),
      },
    ],
  };
}

// Sets up a ready run for completeness critic testing
export async function setupReadyRun(name: string, roots: string[]): Promise<ReadyRun> {
  setupVirtualCliFS();
  const repo = `/virtual/cli/critic-ready-${name}-${Math.random().toString(36).slice(2)}`;
  roots.push(repo);
  await mkdir(join(repo, ".git"), { recursive: true });
  const promptPath = join(repo, "prompt.txt");
  await writeFile(promptPath, "Single task run");
  await mkdir(join(repo, "tests/t1"), { recursive: true });
  await writeFile(join(repo, "gate-t1.ts"), "console.log('gate-t1');\n");
  await writeFile(
    join(repo, "tests/run.test.ts"),
    "import { test } from 'bun:test'; test('all', () => {});\n",
  );
  // Task-1 implemented content for readiness checks
  await writeFile(join(repo, "tests/t1/impl.ts"), "export const implemented = true;\n");

  const init = await execute([
    "plan:init",
    "--repo",
    repo,
    "--run",
    name,
    "--prompt-file",
    promptPath,
  ]);
  const run = init.run_root as string;

  await execute([
    "plan:add",
    "--run",
    run,
    "--id",
    TASK_ID,
    "--label",
    "Task 1",
    "--scope",
    "tests/t1",
    "--gate",
    "bun gate-t1.ts",
    "--actor",
    "planner",
  ]);

  await execute(["plan:brainstorm", "--run", run, "--actor", "planner"]);

  await execute([
    "plan:compile",
    "--run",
    run,
    "--actor",
    "planner",
    "--completion-gate",
    "bun test tests",
  ]);
  const chain = await establishSupervisorChain(run);
  await registerUnderChain(
    run,
    chain,
    "coordinator",
    PLANNER_COORDINATOR_FIXTURE_NAMES.has(name) ? "planner" : "coordinator",
  );
  const criticId = CRITIC_ID_BY_FIXTURE_NAME[name];
  if (criticId !== undefined) {
    await registerUnderChain(run, chain, criticId, "completeness-critic");
  }

  // Computed once, after every fixture file is in place and before any CLI call that would read
  // it back (critic:review re-derives this live from disk and refuses if it has drifted).
  const binding = inspectRepositoryBinding(repo);

  const taskGateCommandId = "C-READY-TASK-GATE";
  const runGateCommandId = "C-READY-RUN-GATE";

  transact(run, "test-setup", "critic-ready-fixture", {}, (draft) => {
    draft.current_repository_binding = structuredClone(binding);

    const requirementsDoc = draft.requirements as JsonObject;
    const requirements = requirementsDoc.requirements as JsonObject[];
    const requirement = requirements.find((entry) => entry.id === REQUIREMENT_ID);
    if (!requirement) throw new Error(`requirement ${REQUIREMENT_ID} not found`);
    requirement.status = "satisfied";
    requirement.evidence = [`task:${TASK_ID}`];

    const tasks = draft.tasks as JsonObject;
    const task = tasks[TASK_ID] as JsonObject;
    task.status = "done";
    task.report = { summary: "Implemented the task under test" };
    task.validations = [
      {
        validator_id: "v1",
        domain: "code-quality",
        token_digest: "fixture-validation-token-digest",
        attempt: 1,
        started_at: FIXTURE_STARTED_AT,
        deadline_at: FIXTURE_DEADLINE_AT,
        verdict: "pass",
        reviewed_requirement_ids: [REQUIREMENT_ID],
        checks: [{ command_id: taskGateCommandId }],
      },
    ] as JsonObject[];
    task.gate_results = [
      { gate_id: TASK_GATE_ID, command_id: taskGateCommandId, status: "passed" },
    ];

    draft.commands ??= {};
    const commands = draft.commands as JsonObject;
    commands[taskGateCommandId] = buildCommandRecord(repo, binding, taskGateCommandId, {
      argv: ["bun", "gate-t1.ts"],
      taskId: TASK_ID,
      gateId: TASK_GATE_ID,
      actor: "v1",
    });
    commands[runGateCommandId] = buildCommandRecord(repo, binding, runGateCommandId, {
      argv: ["bun", "test", "tests"],
      taskId: null,
      gateId: RUN_GATE_ID,
      actor: "coordinator",
    });
  });

  return { repo, run, taskGateCommandId, runGateCommandId };
}

// Register bare authoritative inspection command
export function registerInspectionCommand(
  run: string,
  repo: string,
  id: string,
  actor: string,
  argv: string[] = ["echo", "repository-inspection"],
): void {
  transact(run, "test-setup", "critic-inspection-fixture", {}, (draft) => {
    draft.commands ??= {};
    const commands = draft.commands as JsonObject;
    commands[id] = buildCommandRecord(repo, undefined, id, {
      argv,
      taskId: null,
      gateId: null,
      actor,
    });
  });
}

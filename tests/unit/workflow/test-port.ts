import type { JsonObject } from "../../../orchestrating-long-tasks/scripts/src/contracts/json.ts";
import type { CommandRecord } from "../../../orchestrating-long-tasks/scripts/src/contracts/commands.ts";
import { realpathSync } from "node:fs";
import { commandFingerprint } from "../../../orchestrating-long-tasks/scripts/src/workflow/gates/gate-policy.ts";
import { captureGatePathBindings } from "../../../orchestrating-long-tasks/scripts/src/runner/gate-path-bindings.ts";
import { captureGateEnvironment } from "../../../orchestrating-long-tasks/scripts/src/runner/gate-environment.ts";
import type {
  TransactionPort,
  WorkflowState,
} from "../../../orchestrating-long-tasks/scripts/src/workflow/types.ts";

export const repositoryBinding = {
  schema: "harness.repository-binding" as const,
  version: 1 as const,
  inspection_sha256: "596d88454b9d42821169d3f3923f095f44aa1af867ce29367a6df595c36e50e1",
  git_identity_sha256: "d".repeat(64),
  content_sha256: "e".repeat(64),
  file_count: 2,
  total_bytes: 128,
};

export const TEST_GATE_ARGV = ["bun", "test", "tests/unit/runner/output-evidence.test.ts"];
export const SECOND_TEST_GATE_ARGV = ["bun", "test", "tests/unit/runner/gate-path-binding.test.ts"];

export class TestPort implements TransactionPort {
  public events: { actor: string; kind: string; payload: JsonObject }[] = [];
  private failingKind?: string;
  public constructor(private state: WorkflowState) {}
  public read(): WorkflowState {
    return structuredClone(this.state);
  }
  public transact(
    actor: string,
    kind: string,
    payload: JsonObject,
    mutate: (draft: WorkflowState) => void,
  ) {
    if (this.failingKind === kind) {
      delete this.failingKind;
      throw new Error(`injected ${kind} failure`);
    }
    const draft = structuredClone(this.state);
    mutate(draft);
    this.events.push({ actor, kind, payload: structuredClone(payload) });
    this.state = draft;
    return this.read();
  }
  public failNext(kind: string): void {
    this.failingKind = kind;
  }
}

export function registerTaskPacket(
  port: TestPort,
  role: string,
  agentId: string,
  attempt: number,
  taskId = "T-1",
): void {
  const id = `${role}-${agentId}-${attempt}`;
  port.transact("test", "packet-published", { packet_id: id }, (draft) => {
    draft.packets ??= {};
    draft.packets[id] = {
      id,
      status: "published",
      role,
      agent_id: agentId,
      task_id: taskId,
      attempt,
      graph_revision: draft.graph_revision ?? 1,
      markdown_path: `packets/${id}/packet.md`,
      metadata_path: `packets/${id}/metadata.json`,
      packet_sha256: "a".repeat(64),
      published_at: "2026-08-13T12:00:00.000Z",
    };
  });
}

export function workflowState() {
  return {
    tasks: {
      "T-1": {
        id: "T-1",
        status: "ready",
        requirement_ids: ["R-1"],
        write_scope: ["src/owned"],
        dependencies: [],
        attempts: [],
        history: [],
        repair_round: 0,
      },
    },
    requirements: [
      { id: "R-1", status: "planned", evidence: [], disposition: "actionable", dependencies: [] },
    ],
    gates: [
      {
        id: "G-1",
        command: TEST_GATE_ARGV,
        cwd: ".",
        scope: "task",
        requirement_ids: ["R-1"],
        mandatory: true,
      },
    ],
    commands: {},
    orphan_evidence: [],
    graph_revision: 1,
    current_repository_binding: structuredClone(repositoryBinding),
  } as WorkflowState;
}

export const at = (iso: string) => ({ now: () => new Date(iso) });

export function commandRecord(id: string, overrides: Partial<CommandRecord> = {}): CommandRecord {
  const root = realpathSync(process.cwd());
  const repositoryRoot = overrides.repository_root ?? root;
  const argv = overrides.argv ?? TEST_GATE_ARGV;
  const cwd = overrides.cwd ?? root;
  const taskId = overrides.task_id === undefined ? "T-1" : overrides.task_id;
  const actor = overrides.actor ?? "validator";
  const gateId =
    overrides.gate_id === undefined && taskId !== null && actor.startsWith("validator")
      ? "G-1"
      : (overrides.gate_id ?? null);
  const environment = captureGateEnvironment(process.env, "00000000-0000-4000-8000-000000000000");
  const emptySha = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  const logs = {
    stdout: { path: `commands/${id}/attempts/1/stdout.log`, bytes: 0, sha256: emptySha },
    stderr: { path: `commands/${id}/attempts/1/stderr.log`, bytes: 0, sha256: emptySha },
  };
  const activity = {
    path: `commands/${id}/attempts/1/activity.jsonl`,
    bytes: 0,
    sha256: emptySha,
  };
  return {
    id,
    argv,
    cwd,
    cwd_relative: ".",
    repository_root: repositoryRoot,
    status: "succeeded",
    task_id: taskId,
    gate_id: gateId,
    actor,
    attempt_signing_public_key: "MCowBQYDK2VwAyEAebJY5kfIxE+SBdW0wwTb+c0PuvZ21w9gpaa9L86ygKc=",
    started_at: "2026-08-13T12:00:00.000Z",
    finished_at: "2026-08-13T12:00:01.000Z",
    exit_code: 0,
    signal: null,
    timeout_kind: null,
    signals_sent: [],
    fingerprint: commandFingerprint(cwd, argv),
    environment,
    ...(gateId
      ? {
          path_bindings: captureGatePathBindings(repositoryRoot, cwd, argv, environment.PATH),
        }
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
    ...(gateId
      ? {
          assurance: "trusted_host_observed_v1" as const,
          repository_before: structuredClone(repositoryBinding),
          repository_after: structuredClone(repositoryBinding),
        }
      : {}),
    attempts: [
      {
        id,
        attempt: 1,
        status: "succeeded",
        started_at: "2026-08-13T12:00:00.000Z",
        finished_at: "2026-08-13T12:00:01.000Z",
        exit_code: 0,
        signal: null,
        signals_sent: [],
        timeout_kind: null,
        failure_class: null,
        activity_path: activity.path,
        activity,
        logs,
        ...(gateId
          ? {
              gate_finalized_at: "2026-08-13T12:00:01.000Z",
              repository_after: structuredClone(repositoryBinding),
            }
          : {}),
      },
    ],
    ...overrides,
  };
}

export function registerCommand(
  port: TestPort,
  id: string,
  actor: string,
  overrides: Partial<CommandRecord> = {},
): void {
  port.transact("test", "command-recorded", { command_id: id }, (draft) => {
    draft.commands[id] = commandRecord(id, { actor, ...overrides });
  });
}

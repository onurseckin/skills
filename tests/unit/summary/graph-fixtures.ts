import type { AgentGrantRecord } from "../../../olt/scripts/src/contracts/agents.ts";
import type { HarnessEvent } from "../../../olt/scripts/src/contracts/capsule.ts";
import type { CommandRecord } from "../../../olt/scripts/src/contracts/commands.ts";
import type { TaskRecord, WorkflowState } from "../../../olt/scripts/src/workflow/types.ts";

export function makeTask(id: string, overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id,
    label: `Task ${id}`,
    status: "done",
    requirement_ids: [`REQ-${id}`],
    write_scope: [`src/${id}.ts`],
    dependencies: [],
    attempts: [],
    history: [],
    repair_round: 0,
    ...overrides,
  };
}

export function makeCommand(id: string, overrides: Partial<CommandRecord> = {}): CommandRecord {
  return {
    id,
    argv: ["bun", "test"],
    cwd: "/repo",
    cwd_relative: ".",
    repository_root: "/repo",
    status: "succeeded",
    task_id: null,
    gate_id: null,
    started_at: "2026-08-14T20:00:00.000Z",
    finished_at: "2026-08-14T20:00:01.000Z",
    exit_code: 0,
    signal: null,
    fingerprint: `fp-${id}`,
    attempt_signing_public_key: `pk-${id}`,
    record_path: `commands/${id}/record.json`,
    actor: "worker-1",
    ...overrides,
  };
}

export function makeState(
  tasks: TaskRecord[],
  overrides: Partial<WorkflowState> = {},
): WorkflowState {
  return {
    tasks: Object.fromEntries(tasks.map((task) => [task.id, task])),
    requirements: [],
    gates: [],
    commands: {},
    orphan_evidence: [],
    ...overrides,
  };
}

export function makeGrant(id: string, overrides: Partial<AgentGrantRecord> = {}): AgentGrantRecord {
  return {
    id,
    role: "implementer",
    parent_agent_id: null,
    parent_task_id: null,
    host: "claude-code",
    granted_at: "2026-08-14T19:59:00.000Z",
    status: "active",
    ...overrides,
  };
}

export function makeEvent(
  kind: string,
  sequence: number,
  timestamp: string,
  actor: string,
  payload: Record<string, unknown>,
): HarnessEvent {
  return {
    schema: "harness.event",
    version: 1,
    run_id: "run-fixture",
    capsule_id: "capsule-fixture",
    sequence,
    revision: sequence,
    timestamp,
    actor,
    kind,
    payload: payload as HarnessEvent["payload"],
    previous_hash: null,
    projection: {
      schema: "harness.state",
      version: 1,
      revision: sequence,
      event_sequence: sequence,
      event_head: null,
    },
    hash: `hash-${sequence}`,
  };
}

/** Every asset url that appears anywhere in the dataset, with how many times it appears. */
export function assetUrlCounts(dataset: {
  nodes: Array<{ assets?: Array<{ url: string }> | undefined }>;
}): Map<string, number> {
  const counts = new Map<string, number>();
  for (const node of dataset.nodes) {
    for (const asset of node.assets ?? []) {
      counts.set(asset.url, (counts.get(asset.url) ?? 0) + 1);
    }
  }
  return counts;
}

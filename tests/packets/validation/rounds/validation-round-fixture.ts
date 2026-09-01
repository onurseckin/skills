import { afterAll } from "bun:test";
import { join } from "node:path";
import type { RunState, JsonObject } from "../../../../olt/scripts/src/core/contracts/index.ts";
import type { RepositoryGitCommand } from "../../../../olt/scripts/src/packets/repository-git-command.ts";
import type { TaskRecord, WorkflowState } from "../../../../olt/scripts/src/workflow/types.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../../olt/scripts/src/testing/virtual-fs/index.ts";
import {
  disableInMemorySessionStore,
  enableInMemorySessionStore,
} from "../../../../olt/scripts/src/authority/session/paths.ts";
import { inspection } from "../../payloads/slicing/inspection-fixture.ts";

let vfs = new VirtualMemoryFS();
let session: VirtualFSSession | undefined;

function ensureSession(): VirtualMemoryFS {
  enableInMemorySessionStore();
  if (!session) session = createVirtualFSSession(vfs);
  return vfs;
}

afterAll(() => {
  disableInMemorySessionStore();
  if (session) {
    session.cleanup();
    session = undefined;
  }
  vfs.reset();
});

export const DIFF = "diff --git a/src/owned/a.ts b/src/owned/a.ts\n+const fixed = true;\n";
export const REVALIDATION = "bun test tests/owned/a.test.ts";
export const OBSERVATION = "the empty payload path is unhandled";

export function finding(overrides: JsonObject = {}): JsonObject {
  return {
    id: "F-1",
    requirement_id: "R-1",
    severity: "critical",
    class: "defect",
    observation: OBSERVATION,
    remediation: "handle the empty payload before the insert",
    revalidation: REVALIDATION,
    evidence: [{ path: "src/owned/a.ts", observation: "line 12 drops the row" }],
    status: "open",
    resolved_by: "validator-r1",
    ...overrides,
  };
}

export function rejectedTask(state: WorkflowState): TaskRecord {
  const task = state.tasks["T-1"]!;
  Object.assign(task, {
    status: "submitted",
    repair_round: 1,
    original_implementer: "worker",
    findings: [finding()],
    gate_results: [{ gate_id: "G-1", command_id: "C-gate", status: "passed" }],
    validation_history: [
      {
        validator_id: "validator-r1",
        token_digest: "a".repeat(64),
        attempt: 1,
        started_at: "2026-08-13T12:05:00.000Z",
        deadline_at: "2026-08-13T12:25:00.000Z",
        verdict: "reject",
      },
    ],
    history: [
      {
        at: "2026-08-13T12:10:00.000Z",
        actor: "validator-r1",
        from: "validating",
        to: "changes_requested",
        reason: "validator requested changes",
        attempt: 1,
      },
    ],
  });
  return task;
}

export const capsuleState = (): RunState => ({
  schema: "harness.state",
  version: 1,
  revision: 4,
  event_sequence: 4,
  event_head: null,
  repository_inspections: {
    older: inspection("current", "2026-08-13T12:04:00.000Z"),
    early: inspection("current", "2026-08-13T12:06:00.000Z"),
    late: inspection("current", "2026-08-13T12:30:00.000Z"),
  },
});

export const gitReturning =
  (text: string): RepositoryGitCommand =>
  () => ({
    status: 0,
    bytes: Buffer.from(text, "utf8"),
  });

export function contextWith(root: string): JsonObject {
  return {
    baseline_repository_state: { ...inspection("baseline"), repository_root: root },
    current_repository_state: {
      ...inspection("current", "2026-08-13T12:31:00.000Z"),
      repository_root: root,
      repository_content_sha256: "f".repeat(64),
    },
  };
}

export async function capsuleWithLog(name: string, text: string): Promise<string> {
  const memFs = ensureSession();
  const root = `/virtual/harness-round-${name}-${Math.random().toString(36).slice(2)}`;
  memFs.mkdirSync(join(root, "commands/C-gate/attempts/1"), { recursive: true });
  memFs.writeFileSync(join(root, "commands/C-gate/attempts/1/stdout.log"), text);
  return root;
}

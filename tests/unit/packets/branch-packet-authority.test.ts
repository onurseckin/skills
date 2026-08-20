import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BranchRecord } from "../../../orchestrating-long-tasks/scripts/src/contracts/branch.ts";
import type { AgentRole } from "../../../orchestrating-long-tasks/scripts/src/contracts/packets.ts";
import { criticIntegrityDigest } from "../../../orchestrating-long-tasks/scripts/src/packets/critic-integrity-digest.ts";
import { publishPacket } from "../../../orchestrating-long-tasks/scripts/src/packets/persist-packet.ts";
import { buildPacket } from "../../../orchestrating-long-tasks/scripts/src/packets/render-packet.ts";
import type { BuiltPacket } from "../../../orchestrating-long-tasks/scripts/src/packets/types.ts";
import { tokenDigest } from "../../../orchestrating-long-tasks/scripts/src/workflow/lease/token.ts";
import type { WorkflowState } from "../../../orchestrating-long-tasks/scripts/src/workflow/types.ts";
import { at, TestPort, workflowState } from "../workflow/test-port.ts";
import { inspectionContext } from "./inspection-fixture.ts";

const clock = at("2026-08-13T12:30:00.000Z");
const TOKEN = "sub-task-token";
const commonBytes = new TextEncoder().encode("Preserve unrelated changes. Run focused tests.");
const commonInstructions = {
  bytes: commonBytes,
  sha256: createHash("sha256").update(commonBytes).digest("hex"),
};

function root(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), "branch-packet-")));
}

function branch(overrides: Partial<BranchRecord> = {}): BranchRecord {
  return {
    id: "B-1",
    parent_task_id: "T-1",
    parent_agent_id: "implementer",
    reason: "the parser blocks the API change",
    depth: 1,
    status: "open",
    opened_at: "2026-08-13T12:00:00.000Z",
    sub_tasks: [
      {
        id: "S-1",
        label: "Measure the parser",
        write_scope: ["src/owned/parser"],
        status: "claimed",
        agent_id: "sub-1",
        claimed_at: "2026-08-13T12:05:00.000Z",
        lease: {
          agent_id: "sub-1",
          token_digest: tokenDigest(TOKEN),
          issued_at: "2026-08-13T12:05:00.000Z",
          expires_at: "2026-08-13T13:00:00.000Z",
          duration_seconds: 3300,
        },
      },
    ],
    ...overrides,
  };
}

function branched(overrides: Partial<BranchRecord> = {}): WorkflowState {
  const state = workflowState();
  state.branches = [branch(overrides)];
  return state;
}

function subTaskOf(state: WorkflowState) {
  return state.branches![0]!.sub_tasks[0]!;
}

function packetInput(state: WorkflowState, role: AgentRole, token = TOKEN) {
  return {
    runId: "run-1",
    graphRevision: 1,
    role,
    agentId: "sub-1",
    subTask: subTaskOf(state),
    state,
    commonInstructions,
    authoritativeContext: { ...inspectionContext() },
    evidenceSchema: { required: ["evidence"] },
    targetedCommands: [["bun", "harness.ts", "branch:submit"]],
    leaseToken: token,
    attempt: 1,
    clock,
  };
}

function published(state: WorkflowState, role: AgentRole, token = TOKEN) {
  const packet: BuiltPacket = buildPacket(packetInput(state, role, token));
  return publishPacket(
    root(),
    `pkt-${role}`,
    packet,
    new TestPort(state),
    { agentId: "sub-1", attempt: 1, token },
    clock,
  );
}

describe("a branch sub-agent packet is bound to its sub-task lease", () => {
  for (const role of ["sub-implementer", "sub-investigator", "sub-validator"] as const) {
    test(`${role} builds and publishes against the claimed sub-task`, async () => {
      const state = branched();
      const record = (await published(state, role)).record;
      expect(record.role).toBe(role);
      expect(record.task_id).toBe("S-1");
    });
  }

  test("the sub-task, not a plan task, is the packet's binding", () => {
    const packet = buildPacket(packetInput(branched(), "sub-implementer"));
    expect(packet.metadata.task_id).toBe("S-1");
    expect(packet.markdown).toContain('"id": "S-1"');
    expect(packet.markdown).toContain('"write_scope": [\n    "src/owned/parser"\n  ]');
  });

  test("a read-only branch role is handed resources, never a write scope", () => {
    for (const role of ["sub-investigator", "sub-validator"] as const) {
      const packet = buildPacket(packetInput(branched(), role));
      expect(packet.markdown).toContain(
        '"write_scope": [],\n  "resource_scope": [\n    "src/owned/parser"',
      );
    }
  });

  test("a sub-validator's context is isolated exactly as the parent validator's is", () => {
    const packet = buildPacket(packetInput(branched(), "sub-validator"));
    expect(packet.metadata.excluded_fields).not.toEqual([]);
  });

  test.each([
    ["a wrong token", () => branched(), "wrong-token"],
    ["a lease held by another agent", () => branchedWith({ agent: "sub-2" }), TOKEN],
    ["an expired lease", () => branchedWith({ expires: "2026-08-13T12:10:00.000Z" }), TOKEN],
    ["a sub-task that is not claimed", () => branchedWith({ status: "open" }), TOKEN],
    ["a branch that is no longer open", () => branched({ status: "collected" }), TOKEN],
  ])("refuses authentication with %s", (_case, build, token) => {
    expect(() => buildPacket(packetInput(build(), "sub-implementer", token))).toThrow(
      "branch sub-task packet authentication is invalid",
    );
  });

  test("refuses a sub-task the ledger does not hold", () => {
    const state = branched();
    const input = packetInput(state, "sub-implementer");
    input.subTask = { ...input.subTask, id: "S-missing" };
    expect(() => buildPacket(input)).toThrow("branch sub-task packet authentication is invalid");
  });

  test("refuses a supplied sub-task that differs from the recorded one", () => {
    const state = branched();
    const input = packetInput(state, "sub-implementer");
    input.subTask = { ...input.subTask, write_scope: ["src/owned/everything"] };
    expect(() => buildPacket(input)).toThrow("branch sub-task packet authentication is invalid");
  });

  test("refuses a run-level role that carries a sub-task", () => {
    expect(() => buildPacket(packetInput(branched(), "coordinator"))).toThrow(
      "run-level packet cannot include a sub-task",
    );
  });

  test("refuses a plan-task role that carries a sub-task", () => {
    const state = branched();
    expect(() =>
      buildPacket({ ...packetInput(state, "implementer"), task: state.tasks["T-1"] }),
    ).toThrow("a plan-task packet cannot include a sub-task");
  });
});

function branchedWith(options: {
  agent?: string;
  expires?: string;
  status?: "claimed" | "open";
}): WorkflowState {
  const state = branched();
  const subTask = subTaskOf(state);
  if (options.agent !== undefined) subTask.lease!.agent_id = options.agent;
  if (options.expires !== undefined) subTask.lease!.expires_at = options.expires;
  if (options.status !== undefined) subTask.status = options.status;
  return state;
}

describe("publication authority for a branch sub-task", () => {
  function bareSubTaskPacket(role: string): BuiltPacket {
    return {
      markdown: "# Packet Markdown",
      metadata: {
        schema: "harness.packet-metadata",
        version: 1,
        role,
        agent_id: "sub-1",
        task_id: "S-1",
        attempt: 1,
        graph_revision: 1,
        packet_sha256: "0".repeat(64),
      },
    };
  }

  function publishBare(state: WorkflowState, role: string, token?: string) {
    return publishPacket(
      root(),
      `bare-${role}`,
      bareSubTaskPacket(role),
      new TestPort(state),
      { agentId: "sub-1", attempt: 1, ...(token === undefined ? {} : { token }) },
      clock,
    );
  }

  test("a plan-task role cannot publish against an id the task table does not hold", async () => {
    await expect(publishBare(branched(), "implementer", TOKEN)).rejects.toThrow(
      "packet task is not authoritative",
    );
  });

  test.each([
    ["a wrong token", () => branched(), "wrong-token"],
    ["a lease held by another agent", () => branchedWith({ agent: "sub-2" }), TOKEN],
    ["an expired lease", () => branchedWith({ expires: "2026-08-13T12:10:00.000Z" }), TOKEN],
    ["a sub-task that is not claimed", () => branchedWith({ status: "open" }), TOKEN],
    ["a branch that is no longer open", () => branched({ status: "collected" }), TOKEN],
    ["no branch ledger at all", () => workflowState(), TOKEN],
  ])("refuses publication with %s", async (_case, build, token) => {
    await expect(publishBare(build(), "sub-implementer", token)).rejects.toThrow(
      "branch sub-task packet authority changed",
    );
  });
});

describe("the critic integrity digest survives the packet's own events", () => {
  test("two observations of the same finding at different heads digest alike", () => {
    const evidence = { kind: "capsule_integrity", status: "passed", issues: [] };
    expect(criticIntegrityDigest([{ ...evidence, event_head: "head-before" }])).toBe(
      criticIntegrityDigest([{ ...evidence, event_head: "head-after" }]),
    );
  });

  test("a different finding digests differently", () => {
    const passed = { kind: "capsule_integrity", status: "passed", issues: [], event_head: "h" };
    const failed = {
      ...passed,
      status: "failed",
      issues: [{ code: "EVENT_CHAIN", message: "broken" }],
    };
    expect(criticIntegrityDigest([passed])).not.toBe(criticIntegrityDigest([failed]));
  });
});

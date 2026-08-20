import { describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentRole } from "../../../orchestrating-long-tasks/scripts/src/contracts/packets.ts";
import { publishPacket } from "../../../orchestrating-long-tasks/scripts/src/packets/persist-packet.ts";
import type { BuiltPacket } from "../../../orchestrating-long-tasks/scripts/src/packets/types.ts";
import { tokenDigest } from "../../../orchestrating-long-tasks/scripts/src/workflow/lease/token.ts";
import type { WorkflowState } from "../../../orchestrating-long-tasks/scripts/src/workflow/types.ts";
import { TestPort, workflowState } from "../workflow/test-port.ts";

const clock = { now: () => new Date("2026-08-13T12:30:00.000Z") };
const TOKEN = "branch-child-token";

function root(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), "role-auth-")));
}

function packet(role: string, taskId: string | null): BuiltPacket {
  return {
    markdown: "# Packet Markdown",
    metadata: {
      schema: "harness.packet-metadata",
      version: 1,
      id: "pkt-role-1",
      role,
      agent_id: "agent-1",
      task_id: taskId,
      attempt: 1,
      graph_revision: 1,
      packet_sha256: "0".repeat(64),
      created_at: "2026-08-13T12:00:00.000Z",
    },
  };
}

function leased(role: AgentRole): WorkflowState {
  const state = workflowState();
  state.tasks["T-1"]!.status = "running";
  state.tasks["T-1"]!.lease = {
    agent_id: "agent-1",
    role,
    attempt: 1,
    started_at: "2026-08-13T12:00:00.000Z",
    expires_at: "2026-08-13T13:00:00.000Z",
    token_digest: tokenDigest(TOKEN),
  };
  return state;
}

function validating(): WorkflowState {
  const state = workflowState();
  state.tasks["T-1"]!.status = "validating";
  state.tasks["T-1"]!.validations = [
    {
      validator_id: "agent-1",
      domain: "code-quality",
      attempt: 1,
      started_at: "2026-08-13T12:00:00.000Z",
      deadline_at: "2026-08-13T13:00:00.000Z",
      token_digest: tokenDigest(TOKEN),
    },
  ];
  return state;
}

function granted(role: AgentRole, status: "active" | "released"): WorkflowState {
  const state = workflowState();
  state.agents = [
    {
      id: "agent-1",
      role,
      parent_agent_id: null,
      parent_task_id: null,
      host: "test-host",
      granted_at: "2026-08-13T12:00:00.000Z",
      status,
    },
  ];
  return state;
}

function publish(state: WorkflowState, role: string, taskId: string | null, token?: string) {
  return publishPacket(
    root(),
    `pkt-${role}`,
    packet(role, taskId),
    new TestPort(state),
    { agentId: "agent-1", attempt: 1, ...(token === undefined ? {} : { token }) },
    clock,
  );
}

describe("per-role packet authorization", () => {
  for (const role of ["sub-implementer", "sub-investigator"] as const) {
    test(`${role} publishes only under a lease claimed in that role`, async () => {
      const published = await publish(leased(role), role, "T-1", TOKEN);
      expect(published.record.role).toBe(role);

      await expect(publish(leased("implementer"), role, "T-1", TOKEN)).rejects.toThrow(
        "task packet authority changed",
      );
      await expect(publish(workflowState(), role, "T-1", TOKEN)).rejects.toThrow(
        "task packet authority changed",
      );
    });

    test(`${role} cannot escape the task binding by publishing run-level`, async () => {
      await expect(publish(leased(role), role, null, TOKEN)).rejects.toThrow(
        "packet task is not authoritative",
      );
    });
  }

  test("sub-validator publishes under the independent validation authority", async () => {
    const published = await publish(validating(), "sub-validator", "T-1", TOKEN);
    expect(published.record.role).toBe("sub-validator");

    await expect(publish(validating(), "sub-validator", "T-1", "wrong-token")).rejects.toThrow(
      "validator packet authority changed",
    );
  });

  test("coordinator publishes only against an active grant", async () => {
    const published = await publish(granted("coordinator", "active"), "coordinator", null);
    expect(published.record.role).toBe("coordinator");

    await expect(publish(workflowState(), "coordinator", null)).rejects.toThrow(
      "coordinator packet has no active agent grant: agent-1",
    );
    await expect(publish(granted("coordinator", "released"), "coordinator", null)).rejects.toThrow(
      "coordinator packet has no active agent grant: agent-1",
    );
    await expect(publish(granted("implementer", "active"), "coordinator", null)).rejects.toThrow(
      "coordinator packet has no active agent grant: agent-1",
    );
  });

  test("a role outside the canonical set cannot publish at all", async () => {
    await expect(publish(leased("implementer"), "auditor", "T-1", TOKEN)).rejects.toThrow(
      "packet role is not a canonical role: auditor",
    );
  });
});

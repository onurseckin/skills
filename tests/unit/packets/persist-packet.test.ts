import { describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  persistPacket,
  publishPacket,
} from "../../../orchestrating-long-tasks/scripts/src/packets/persist-packet.ts";
import type { BuiltPacket } from "../../../orchestrating-long-tasks/scripts/src/packets/types.ts";
import { TestPort, workflowState, repositoryBinding } from "../workflow/test-port.ts";
import { tokenDigest } from "../../../orchestrating-long-tasks/scripts/src/workflow/lease/token.ts";

function createPacket(
  role: string,
  taskId: string | null = "T-1",
  overrides: Record<string, unknown> = {},
): BuiltPacket {
  return {
    markdown: "# Packet Markdown",
    metadata: {
      schema: "harness.packet-metadata",
      version: 1,
      id: "pkt-test-1",
      role,
      agent_id: "agent-1",
      task_id: taskId,
      attempt: 1,
      graph_revision: 1,
      packet_sha256: "0".repeat(64),
      created_at: "2026-08-13T12:00:00.000Z",
      ...overrides,
    },
  };
}

describe("persist-packet", () => {
  test("persistPacket writes bundle and returns markdown path", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "persist-pkt-")));
    const packet = createPacket("implementer");
    const path = await persistPacket(root, "bundle-1", packet);
    expect(path).toBe(join(root, "bundle-1", "packet.md"));
  });

  test("rejects publishPacket if run is already completed", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "persist-pkt-")));
    const state = workflowState();
    state.completion_result = {
      status: "complete",
      completed_at: "2026-08-13T12:00:00.000Z",
      summary: "done",
    };
    const port = new TestPort(state);
    const packet = createPacket("implementer");

    await expect(
      publishPacket(root, "pkt-1", packet, port, { agentId: "agent-1", attempt: 1 }),
    ).rejects.toThrow("run is already completed");
  });

  test("publishes and validates validator packet", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "persist-pkt-")));
    const state = workflowState();
    const token = "validator-token-123";
    state.tasks["T-1"]!.status = "validating";
    state.tasks["T-1"]!.validation = {
      validator_id: "agent-1",
      attempt: 1,
      started_at: "2026-08-13T12:00:00.000Z",
      deadline_at: "2026-08-13T13:00:00.000Z",
      token_digest: tokenDigest(token),
    };
    const port = new TestPort(state);
    const packet = createPacket("validator", "T-1");

    const published = await publishPacket(
      root,
      "pkt-val-1",
      packet,
      port,
      { agentId: "agent-1", token, attempt: 1 },
      { now: () => new Date("2026-08-13T12:30:00.000Z") },
    );
    expect(published.record.status).toBe("published");
    expect(published.record.role).toBe("validator");

    // Invalid validator token or authority
    await expect(
      publishPacket(
        root,
        "pkt-val-2",
        createPacket("validator", "T-1"),
        port,
        { agentId: "agent-1", token: "wrong-token", attempt: 1 },
        { now: () => new Date("2026-08-13T12:30:00.000Z") },
      ),
    ).rejects.toThrow("validator packet authority changed");
  });

  test("rejects critic packet if current repository binding changed", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "persist-pkt-")));
    const state = workflowState();
    const token = "critic-token-123";
    const binding = structuredClone(repositoryBinding);
    state.completion_critic = {
      critic_id: "agent-1",
      attempt: 1,
      status: "assigned",
      assigned_at: "2026-08-13T12:00:00.000Z",
      deadline_at: "2026-08-13T13:00:00.000Z",
      token_digest: tokenDigest(token),
      readiness_sha256: "0".repeat(64),
      repository_binding: binding,
      packet_id: null,
      review_sha256: null,
    };
    state.current_repository_binding = {
      ...binding,
      content_sha256: "1".repeat(64), // changed!
    };
    const port = new TestPort(state);
    const packet = createPacket("completeness-critic", null, {
      readiness_sha256: "0".repeat(64),
      repository_binding: binding,
    });

    await expect(
      publishPacket(
        root,
        "pkt-critic-1",
        packet,
        port,
        { agentId: "agent-1", token, attempt: 1 },
        { now: () => new Date("2026-08-13T12:30:00.000Z") },
      ),
    ).rejects.toThrow("repository bytes changed before critic packet publication");
  });
});

import { afterAll, describe, expect, test } from "bun:test";
import { publishPacket } from "../../../olt/scripts/src/packets/persist-packet.ts";
import type { BuiltPacket } from "../../../olt/scripts/src/packets/types.ts";
import { TestPort, at, workflowState } from "../../workflow/index.ts";
import { tokenDigest } from "../../../olt/scripts/src/workflow/lease/token.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

const vfs = new VirtualMemoryFS();
const session = createVirtualFSSession(vfs);

afterAll(() => {
  session.cleanup();
  vfs.reset();
});

/**
 * publishPacket's retry path: a caller that re-runs the same CLI command after a crash (or a
 * dispatch retry) presents the same packet id again. These tests exercise the three ways that
 * second call can resolve — replay the already-published bundle, refuse a content mismatch, and
 * refuse an identity mismatch — none of which persist-packet.test.ts's happy-path tests reach.
 */

const TOKEN = "validator-retry-token";
const NOW = at("2026-08-14T00:00:00.000Z");

function createPacket(overrides: Record<string, unknown> = {}): BuiltPacket {
  return {
    markdown: "# Packet Markdown",
    metadata: {
      schema: "harness.packet-metadata",
      version: 1,
      id: "pkt-test-1",
      role: "validator",
      agent_id: "agent-1",
      task_id: "T-1",
      attempt: 1,
      graph_revision: 1,
      packet_sha256: "0".repeat(64),
      created_at: "2026-08-13T12:00:00.000Z",
      ...overrides,
    },
  };
}

function validatingPort(): TestPort {
  const state = workflowState();
  state.tasks["T-1"]!.status = "validating";
  state.tasks["T-1"]!.validations = [
    {
      validator_id: "agent-1",
      domain: "code-quality",
      attempt: 1,
      started_at: "2026-08-13T12:00:00.000Z",
      deadline_at: "2026-08-14T13:00:00.000Z",
      token_digest: tokenDigest(TOKEN),
    },
  ];
  return new TestPort(state);
}

function tmpRoot(): string {
  const r = `/virtual/persist-pkt-retry-${Math.random().toString(36).slice(2)}`;
  vfs.mkdirSync(r, { recursive: true });
  return r;
}

describe("publishPacket retry semantics", () => {
  test("replays the already-published bundle when the same id is published again unchanged", async () => {
    const root = tmpRoot();
    const port = validatingPort();
    const packet = createPacket();
    const auth = { agentId: "agent-1", token: TOKEN, attempt: 1 };

    const first = await publishPacket(root, "pkt-replay", packet, port, auth, NOW);
    expect(first.record.status).toBe("published");

    const second = await publishPacket(root, "pkt-replay", packet, port, auth, NOW);
    expect(second.record).toEqual(first.record);
    expect(second.markdownPath).toBe(first.markdownPath);
    expect(second.metadataPath).toBe(first.metadataPath);
  });

  test("rejects a retry whose packet content differs from what was already registered", async () => {
    const root = tmpRoot();
    const port = validatingPort();
    const auth = { agentId: "agent-1", token: TOKEN, attempt: 1 };

    await publishPacket(root, "pkt-mismatch", createPacket(), port, auth, NOW);

    const changed = createPacket({ packet_sha256: "1".repeat(64) });
    await expect(publishPacket(root, "pkt-mismatch", changed, port, auth, NOW)).rejects.toThrow(
      "packet registration differs: pkt-mismatch",
    );
  });

  test("rejects a retry whose authorization identity differs from the original publication", async () => {
    const root = tmpRoot();
    const port = validatingPort();
    const packet = createPacket();

    await publishPacket(
      root,
      "pkt-identity",
      packet,
      port,
      { agentId: "agent-1", token: TOKEN, attempt: 1 },
      NOW,
    );

    // Same packet content and id, but a different claimed attempt: the registration-match
    // check above passes (content is identical), so this must be caught by the identity check.
    await expect(
      publishPacket(
        root,
        "pkt-identity",
        packet,
        port,
        { agentId: "agent-1", token: TOKEN, attempt: 2 },
        NOW,
      ),
    ).rejects.toThrow("packet retry identity differs from publication");
  });
});

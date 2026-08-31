import { describe, expect, test } from "bun:test";
import {
  authenticatePacketIdentity,
  type PacketAuthenticationInput,
} from "../../../olt/scripts/src/packets/authenticate-packet.ts";
import { tokenDigest } from "../../../olt/scripts/src/workflow/lease/token.ts";
import { at, repositoryBinding, workflowState } from "../workflow/test-port.ts";

const TOKEN = "critic-auth-token";

function criticInput(
  overrides: Partial<PacketAuthenticationInput> = {},
): PacketAuthenticationInput {
  const state = workflowState();
  state.current_repository_binding = structuredClone(repositoryBinding);
  state.completion_critic = {
    critic_id: "critic-1",
    token_digest: tokenDigest(TOKEN),
    attempt: 1,
    status: "assigned",
    started_at: "2026-01-01T00:00:00.000Z",
    deadline_at: "2026-01-01T00:01:00.000Z",
    readiness_sha256: "0".repeat(64),
    repository_binding: structuredClone(repositoryBinding),
  };
  return {
    role: "completeness-critic",
    agentId: "critic-1",
    attempt: 1,
    leaseToken: TOKEN,
    // Built fresh on every call (never a module-scope binding captured at import): pins
    // authenticatePacketIdentity's deadline check to this fixed instant instead of the real
    // system clock, so the packet's authorization can't go stale between when this fixture runs
    // and when a busy --no-isolate suite actually reaches it.
    clock: at("2026-01-01T00:00:30.000Z"),
    state,
    ...overrides,
  };
}

describe("authenticatePacketIdentity", () => {
  test("rejects a non-positive attempt number", () => {
    expect(() =>
      authenticatePacketIdentity({
        role: "coordinator",
        agentId: "agent-1",
        attempt: 0,
        state: workflowState(),
      }),
    ).toThrow("packet attempt must be a positive integer");
  });

  test("rejects a completeness-critic packet when the repository changed since authorization", () => {
    const input = criticInput();
    input.state.current_repository_binding = {
      ...input.state.current_repository_binding!,
      content_sha256: "f".repeat(64),
    };
    expect(() => authenticatePacketIdentity(input)).toThrow(
      "repository bytes changed before critic packet publication",
    );
  });

  test("accepts a completeness-critic packet whose repository binding still matches", () => {
    const input = criticInput();
    expect(authenticatePacketIdentity(input)).toBeUndefined();
  });
});

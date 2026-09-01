import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import { assertPublishedTaskPacket } from "../../../../olt/scripts/src/workflow/packet-authority.ts";
import { workflowState } from "../../shared/test-port.ts";
import { setupWorkflowVirtualFs } from "../../shared/index.ts";

describe("workflow/packet-authority", () => {
  let vfsCleanup: (() => void) | undefined;

  beforeEach(() => {
    const setup = setupWorkflowVirtualFs();
    vfsCleanup = setup.cleanup;
  });

  afterEach(() => {
    vfsCleanup?.();
    vfsCleanup = undefined;
  });

  test("assertPublishedTaskPacket succeeds when matching published packet exists", () => {
    const state = workflowState();
    state.packets = {
      "P-1": {
        id: "P-1",
        task_id: "T-1",
        role: "implementer",
        agent_id: "worker-1",
        attempt: 1,
        status: "published",
        created_at: "2026-08-20T00:00:00.000Z",
        packet_sha256: "0".repeat(64),
      },
    };

    expect(() =>
      assertPublishedTaskPacket(state, "T-1", "implementer", "worker-1", 1),
    ).not.toThrow();
  });

  test("assertPublishedTaskPacket throws INVALID_STATE when no published packet matches", () => {
    const state = workflowState();
    state.packets = {
      "P-1": {
        id: "P-1",
        task_id: "T-1",
        role: "implementer",
        agent_id: "worker-1",
        attempt: 1,
        status: "draft", // draft, not published
        created_at: "2026-08-20T00:00:00.000Z",
        packet_sha256: "0".repeat(64),
      },
    };

    expect(() => assertPublishedTaskPacket(state, "T-1", "implementer", "worker-1", 1)).toThrow(
      HarnessError,
    );
    expect(() => assertPublishedTaskPacket(state, "T-1", "implementer", "worker-1", 1)).toThrow(
      "implementer action requires a matching durably published packet",
    );

    // Empty packets
    const emptyState = workflowState();
    delete (emptyState as Record<string, unknown>).packets;
    expect(() => assertPublishedTaskPacket(emptyState, "T-1", "validator", "val-1", 1)).toThrow(
      "validator action requires a matching durably published packet",
    );
  });
});

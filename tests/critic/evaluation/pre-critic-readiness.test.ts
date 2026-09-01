import { describe, expect, test } from "bun:test";
import { beginCompletenessCritic } from "../../../olt/scripts/src/workflow/completion/begin-completeness-critic.ts";
import { at } from "../../workflow/shared/test-port.ts";
import {
  completionPort,
  review,
} from "../../workflow/completion/fixtures/completion-provenance-fixture.ts";

const clock = at("2026-08-13T12:05:00.000Z");

describe("beginCompletenessCritic", () => {
  test("rejects starting a new critic once the run is already marked complete", () => {
    const port = completionPort();
    port.transact("coordinator", "force-complete", {}, (draft) => {
      draft.completion_result = {
        status: "complete",
        actor: "coordinator",
        completed_at: "2026-08-13T12:00:00.000Z",
        graph_revision: 1,
        readiness_sha256: "sha",
        repository_binding: draft.current_repository_binding as never,
        critic_review_sha256: "sha",
        artifact_verification_sha256: "sha",
        mandatory_run_gate_commands: {},
      };
    });
    expect(() => beginCompletenessCritic(port, "critic-2", { clock })).toThrow(
      /run is already completed/,
    );
  });

  test("expires a stale non-terminal critic assignment once the repository has moved on, and starts a fresh attempt", () => {
    const port = completionPort();
    const before = port.read();
    expect(before.completion_critic?.status).toBe("packet_published");
    expect(before.completion_critic_history).toHaveLength(1);

    port.transact("coordinator", "repository-observed", {}, (draft) => {
      draft.current_repository_binding = {
        ...draft.current_repository_binding!,
        content_sha256: "9".repeat(64),
      };
    });

    const { state, token } = beginCompletenessCritic(port, "critic-2", { clock });
    expect(token).toBeTruthy();
    expect(state.completion_critic?.critic_id).toBe("critic-2");
    expect(state.completion_critic?.attempt).toBe(2);
    const expiredHistoryEntry = state.completion_critic_history!.find(
      (e) => e.critic_id === "critic",
    );
    expect(expiredHistoryEntry?.status).toBe("expired");
  });

  test("rejects starting a fresh critic once the current one already delivered a clean review with no repository drift", () => {
    const port = completionPort();
    review(port);
    expect(() => beginCompletenessCritic(port, "critic-2", { clock })).toThrow(
      /the completeness critic review is already clean/,
    );
  });

  test("rejects reassigning after a fresh critic identity is required", () => {
    const port = completionPort();
    review(port);
    expect(() => beginCompletenessCritic(port, "critic", { clock })).toThrow(
      /a fresh completeness critic identity is required/,
    );
  });
});

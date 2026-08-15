import { describe, expect, test } from "bun:test";
import { beginCompletenessCritic } from "../../../orchestrating-long-tasks/scripts/src/workflow/completion/begin-completeness-critic.ts";
import { completionReadyState } from "./completion-fixture.ts";
import { TestPort } from "./test-port.ts";

describe("completeness critic authorization", () => {
  test("issues a token once, persists only its digest, and excludes prior task actors", () => {
    const priorState = completionReadyState();
    priorState.tasks["T-1"]!.original_implementer = "implementer";
    const prior = new TestPort(priorState);
    expect(() => beginCompletenessCritic(prior, "implementer")).toThrow();

    const port = new TestPort(completionReadyState());
    const assigned = beginCompletenessCritic(port, "critic");
    expect(assigned.token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(assigned.state.completion_critic).toMatchObject({
      critic_id: "critic",
      attempt: 1,
      status: "assigned",
    });
    expect(JSON.stringify(assigned.state)).not.toContain(assigned.token);
    expect(() => beginCompletenessCritic(port, "other-critic")).toThrow();
  });
});

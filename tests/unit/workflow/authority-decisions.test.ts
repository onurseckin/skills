import { describe, expect, test } from "bun:test";
import {
  recordAuthorityDecision,
  requirementExecutionState,
} from "../../../olt/scripts/src/workflow/authority/index.ts";
import { claimTask } from "../../../olt/scripts/src/workflow/lease/claim.ts";
import { at, TestPort, workflowState } from "./test-port.ts";

const clock = at("2026-08-13T12:00:00.000Z");

function pendingPort(): TestPort {
  const state = workflowState();
  state.requirements[0]!.disposition = "needs_authority";
  state.requirements[0]!.dependencies = [];
  return new TestPort(state);
}

describe("requirement authority decisions", () => {
  test("does not treat a direct out-of-scope plan declaration as disposal", () => {
    expect(requirementExecutionState({ id: "R-1", disposition: "out_of_scope" })).toBe("paused");
  });

  test("an audited grant resumes scheduler and claim authority", () => {
    const port = pendingPort();
    expect(() => claimTask(port, "T-1", "worker", "implementer", { clock })).toThrow();

    const granted = recordAuthorityDecision(
      port,
      "R-1",
      "coordinator",
      { decision: "grant", rationale: "The user approved this external change." },
      clock,
    );
    const requirement = granted.requirements[0]!;
    expect(requirement.disposition).toBe("needs_authority");
    expect(requirement.authority_status).toBe("granted");
    expect(requirementExecutionState(requirement)).toBe("executable");
    expect(requirement.authority_history).toEqual([
      expect.objectContaining({
        decision: "grant",
        actor: "coordinator",
        prior_disposition: "needs_authority",
        resulting_disposition: "actionable",
        decided_at: "2026-08-13T12:00:00.000Z",
        decision_sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    ]);
    expect(port.events.at(-1)?.kind).toBe("requirement-authority-decided");
    expect(() => claimTask(port, "T-1", "worker", "implementer", { clock })).not.toThrow();
  });

  test("a decline is terminal and disposes pure dormant tasks without fake evidence", () => {
    const port = pendingPort();
    const declined = recordAuthorityDecision(
      port,
      "R-1",
      "coordinator",
      { decision: "decline", rationale: "The user declined the requested authority." },
      clock,
    );
    const requirement = declined.requirements[0]!;
    expect(requirement.disposition).toBe("needs_authority");
    expect(requirement.authority_status).toBe("declined");
    expect(requirement.status).toBe("planned");
    expect(requirement.evidence).toEqual([]);
    expect(requirementExecutionState(requirement)).toBe("disposed");
    expect(declined.tasks["T-1"]!.status).toBe("cancelled");
    expect(declined.tasks["T-1"]!.report).toBeUndefined();
    expect(() =>
      recordAuthorityDecision(
        port,
        "R-1",
        "coordinator",
        { decision: "grant", rationale: "Trying to reverse a terminal decision." },
        clock,
      ),
    ).toThrow("only pending needs_authority requirements can receive a decision");
  });

  test("cancels a task only after all mapped requirements are declined", () => {
    const state = workflowState();
    state.requirements[0]!.disposition = "needs_authority";
    state.requirements.push({
      id: "R-2",
      status: "planned",
      evidence: [],
      disposition: "needs_authority",
      dependencies: [],
    });
    state.tasks["T-1"]!.requirement_ids = ["R-1", "R-2"];
    const port = new TestPort(state);

    recordAuthorityDecision(
      port,
      "R-1",
      "coordinator",
      { decision: "decline", rationale: "The user declined the first authority." },
      clock,
    );
    expect(port.read().tasks["T-1"]!.status).toBe("ready");
    recordAuthorityDecision(
      port,
      "R-2",
      "coordinator",
      { decision: "decline", rationale: "The user declined the second authority." },
      clock,
    );
    expect(port.read().tasks["T-1"]!.status).toBe("cancelled");
  });

  test("rejects malformed decisions and refuses to invalidate active work", () => {
    const port = pendingPort();
    expect(() =>
      recordAuthorityDecision(
        port,
        "R-1",
        "coordinator",
        { decision: "grant", rationale: "" },
        clock,
      ),
    ).toThrow();
    const activeState = workflowState();
    activeState.requirements[0]!.disposition = "needs_authority";
    activeState.tasks["T-1"]!.status = "running";
    expect(() =>
      recordAuthorityDecision(
        new TestPort(activeState),
        "R-1",
        "coordinator",
        { decision: "decline", rationale: "Cannot discard active work." },
        clock,
      ),
    ).toThrow("active or completed task");

    const fabricated = pendingPort();
    const fabricatedState = fabricated.read();
    fabricatedState.requirements[0]!.authority_history = [{ decision: "grant" }];
    expect(() =>
      recordAuthorityDecision(
        new TestPort(fabricatedState),
        "R-1",
        "coordinator",
        { decision: "grant", rationale: "A new decision cannot extend forged history." },
        clock,
      ),
    ).toThrow("cannot already contain authority history");
  });

  test("scheduler authority requires a digest-valid matching audit record", () => {
    const missing = workflowState();
    missing.requirements[0]!.disposition = "needs_authority";
    missing.requirements[0]!.authority_status = "granted";
    expect(() =>
      claimTask(new TestPort(missing), "T-1", "worker", "implementer", { clock }),
    ).toThrow("task requirements are not authorized");

    const port = pendingPort();
    const granted = recordAuthorityDecision(
      port,
      "R-1",
      "coordinator",
      { decision: "grant", rationale: "The user approved this external change." },
      clock,
    );
    const history = granted.requirements[0]!.authority_history as Record<string, unknown>[];
    history[0]!.decision_sha256 = "0".repeat(64);
    expect(() =>
      claimTask(new TestPort(granted), "T-1", "worker", "implementer", { clock }),
    ).toThrow("task requirements are not authorized");
  });

  test("an exact retry returns durable evidence without replaying the decision event", () => {
    const port = pendingPort();
    const input = { decision: "grant" as const, rationale: "The user approved this change." };
    const first = recordAuthorityDecision(port, "R-1", "coordinator", input, clock);
    const eventCount = port.events.length;
    const retried = recordAuthorityDecision(
      port,
      "R-1",
      "coordinator",
      input,
      at("2026-08-13T12:05:00.000Z"),
    );
    expect(retried).toEqual(first);
    expect(port.events).toHaveLength(eventCount);
  });
});

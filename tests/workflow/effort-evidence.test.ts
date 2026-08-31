import { describe, expect, test } from "bun:test";
import { evidenced } from "../../olt/scripts/src/core/contracts/index.ts";
import { claimTask } from "../../olt/scripts/src/workflow/lease/claim.ts";
import { submitTask } from "../../olt/scripts/src/workflow/submission/submit.ts";
import { at, registerTaskPacket, TestPort, workflowState } from "./test-port.ts";

const start = at("2026-08-13T12:00:00.000Z");
const report = {
  summary: "implemented",
  requirement_ids: ["R-1"],
  files_changed: ["src/owned/a.ts"],
  checks: [{ command: "bun test", status: "passed" }],
  evidence: [{ kind: "diff", path: "src/owned/a.ts" }],
};

// C4's own state machine: the CLI supplies real filesystem digests, but the refusal logic itself is
// exercised here against fabricated ones — the pure comparison never touches disk, so a test does
// not need to.
describe("C4: effort evidence at claim and submit", () => {
  test("claimTask stores the given digest on the lease untouched", () => {
    const port = new TestPort(workflowState());
    const { state } = claimTask(port, "T-1", "agent", "implementer", {
      clock: start,
      writeScopeContentHash: evidenced("digest-a", "harness_observed"),
    });
    expect(state.tasks["T-1"]!.lease!.write_scope_content_hash).toEqual({
      value: "digest-a",
      evidence_class: "harness_observed",
    });
  });

  test("refuses a submission whose digest is byte-identical to its content at claim", () => {
    const port = new TestPort(workflowState());
    const { token } = claimTask(port, "T-1", "agent", "implementer", {
      clock: start,
      writeScopeContentHash: evidenced("same-digest", "harness_observed"),
    });
    registerTaskPacket(port, "implementer", "agent", 1);
    const before = port.read();

    expect(() =>
      submitTask(port, "T-1", "agent", token, report, start, {
        currentWriteScopeContentHash: evidenced("same-digest", "harness_observed"),
      }),
    ).toThrow(/byte-identical/);
    // Refused before any state change — the same "no mutation on rejection" contract every other
    // submitTask refusal in submissions.test.ts already holds to.
    expect(port.read()).toEqual(before);
  });

  test("names the write scope that did not change in the refusal", () => {
    const port = new TestPort(workflowState());
    const { token } = claimTask(port, "T-1", "agent", "implementer", {
      clock: start,
      writeScopeContentHash: evidenced("same-digest", "harness_observed"),
    });
    registerTaskPacket(port, "implementer", "agent", 1);

    expect(() =>
      submitTask(port, "T-1", "agent", token, report, start, {
        currentWriteScopeContentHash: evidenced("same-digest", "harness_observed"),
      }),
    ).toThrow(/src\/owned/);
  });

  test("accepts a submission whose digest differs from its content at claim", () => {
    const port = new TestPort(workflowState());
    const { token } = claimTask(port, "T-1", "agent", "implementer", {
      clock: start,
      writeScopeContentHash: evidenced("digest-at-claim", "harness_observed"),
    });
    registerTaskPacket(port, "implementer", "agent", 1);

    const result = submitTask(port, "T-1", "agent", token, report, start, {
      currentWriteScopeContentHash: evidenced("digest-at-submit", "harness_observed"),
    });
    expect(result.state.tasks["T-1"]!.status).toBe("submitted");
    expect(result.state.tasks["T-1"]!.no_op).toBeUndefined();
  });

  test("--no-op with a reason is accepted against an unchanged digest and recorded as an attributed state", () => {
    const port = new TestPort(workflowState());
    const { token } = claimTask(port, "T-1", "agent", "implementer", {
      clock: start,
      writeScopeContentHash: evidenced("unchanged-digest", "harness_observed"),
    });
    registerTaskPacket(port, "implementer", "agent", 1);

    const result = submitTask(port, "T-1", "agent", token, report, start, {
      currentWriteScopeContentHash: evidenced("unchanged-digest", "harness_observed"),
      noOp: { reason: "the fix already landed in task-0's commit" },
    });

    expect(result.state.tasks["T-1"]!.status).toBe("submitted");
    expect(result.state.tasks["T-1"]!.no_op).toEqual({
      reason: "the fix already landed in task-0's commit",
      declared_by: "agent",
      at: start.now().toISOString(),
    });
    // Attributed in the event log too, not only in state — and only for the round that actually
    // used it, matching the "recorded... in the event log" half of C4's contract.
    const submitted = port.events.find((event) => event.kind === "task-submitted");
    expect(submitted?.payload.no_op_reason).toBe("the fix already landed in task-0's commit");
  });

  test("--no-op is refused when the digest actually changed — never a way to mislabel real work", () => {
    const port = new TestPort(workflowState());
    const { token } = claimTask(port, "T-1", "agent", "implementer", {
      clock: start,
      writeScopeContentHash: evidenced("digest-at-claim", "harness_observed"),
    });
    registerTaskPacket(port, "implementer", "agent", 1);

    expect(() =>
      submitTask(port, "T-1", "agent", token, report, start, {
        currentWriteScopeContentHash: evidenced("digest-at-submit", "harness_observed"),
        noOp: { reason: "claiming no-op even though this changed" },
      }),
    ).toThrow(/changed since claim/);
  });

  test("an unattributed no-op reason is refused rather than silently accepted", () => {
    const port = new TestPort(workflowState());
    const { token } = claimTask(port, "T-1", "agent", "implementer", {
      clock: start,
      writeScopeContentHash: evidenced("unchanged-digest", "harness_observed"),
    });
    registerTaskPacket(port, "implementer", "agent", 1);

    expect(() =>
      submitTask(port, "T-1", "agent", token, report, start, {
        currentWriteScopeContentHash: evidenced("unchanged-digest", "harness_observed"),
        noOp: { reason: "   " },
      }),
    ).toThrow();
  });

  test("the check never fires when either digest was never measured — a workflow-layer test, not a bypass", () => {
    // No writeScopeContentHash at claim, none at submit: the same shape every pre-C4 workflow test
    // in this suite already uses, and it must keep working exactly as it always has.
    const port = new TestPort(workflowState());
    const { token } = claimTask(port, "T-1", "agent", "implementer", { clock: start });
    registerTaskPacket(port, "implementer", "agent", 1);

    const result = submitTask(port, "T-1", "agent", token, report, start);
    expect(result.state.tasks["T-1"]!.status).toBe("submitted");
  });
});

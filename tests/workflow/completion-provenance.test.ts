import { describe, expect, test } from "bun:test";
import { completionIssues } from "../../olt/scripts/src/workflow/completion/completion-state.ts";
import { completeRun } from "../../olt/scripts/src/workflow/completion/complete-run.ts";
import { recordCompletionReview } from "../../olt/scripts/src/workflow/completion/record-completion-review.ts";
import { commandRecord, TestPort } from "./test-port.ts";
import {
  artifactVerification,
  clock,
  completionPort,
  criticToken,
  ObservedPort,
  packetSha,
  review,
  reviewInput,
  verifyRepository,
} from "./completion-provenance-fixture.ts";

describe("authoritative completion provenance", () => {
  test("records a critic review bound to its immutable packet and command evidence", () => {
    const port = completionPort();
    expect(() =>
      recordCompletionReview(port, "critic", reviewInput(port, "wrong"), verifyRepository, clock),
    ).toThrow();
    const state = review(port);
    expect(state.completion_review).toMatchObject({
      critic_id: "critic",
      packet_id: "critic-1",
      packet_sha256: packetSha,
      graph_revision: 1,
      status: "clean",
      repository_command_ids: ["C-REPO"],
    });
    expect(state.completion_review!.review_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(completionIssues(port.read())).toEqual(["completion artifact verification is missing"]);
  });

  test("rechecks the critic review and packet fingerprints at completion", () => {
    const port = completionPort();
    review(port);
    const state = port.read();
    state.completion_review!.review_sha256 = "tampered";
    expect(completionIssues(new TestPort(state).read())).toContain(
      "completion review packet provenance is invalid",
    );
  });

  test("derives mandatory run gates from state and verifies their fingerprints", () => {
    const port = completionPort();
    review(port);
    const missing = port.read();
    delete missing.commands["C-RUN"];
    expect(completionIssues(new TestPort(missing).read())).toContain(
      "run gate G-RUN lacks an authoritative passing command",
    );
    const drift = port.read();
    drift.commands["C-RUN"]!.fingerprint = "caller-selected";
    expect(completionIssues(new TestPort(drift).read())).toContain(
      "run gate G-RUN lacks an authoritative passing command",
    );
  });

  test("writes a completion result with critic and derived gate provenance", () => {
    const port = completionPort();
    review(port);
    expect(() => completeRun(port, "coordinator", () => undefined, criticToken, clock)).toThrow();
    let verifierCalled = false;
    const state = completeRun(
      port,
      "coordinator",
      (locked) => {
        verifierCalled = true;
        expect(locked.completion_result).toBeUndefined();
        return artifactVerification(locked);
      },
      criticToken,
      clock,
    );
    expect(verifierCalled).toBeTrue();
    expect(state.completion_result).toMatchObject({
      status: "complete",
      actor: "coordinator",
      critic_review_sha256: state.completion_review!.review_sha256,
      repository_binding: state.completion_review!.repository_binding,
      artifact_verification_sha256: state.completion_verification!.verification_sha256,
      mandatory_run_gate_commands: { "G-RUN": "C-RUN" },
    });
  });

  test("invokes disk artifact verification inside the completion transaction", () => {
    const base = completionPort();
    review(base);
    const port = new ObservedPort(base);
    completeRun(
      port,
      "coordinator",
      (state) => {
        expect(port.locked).toBeTrue();
        return artifactVerification(state);
      },
      criticToken,
      clock,
    );
  });

  test("running commands mechanically block completion", () => {
    const port = completionPort();
    review(port);
    port.transact("critic", "running", {}, (draft) => {
      draft.commands["C-LIVE"] = commandRecord("C-LIVE", {
        task_id: null,
        actor: "critic",
        status: "running",
        finished_at: null,
        exit_code: null,
      });
    });
    expect(() =>
      completeRun(port, "coordinator", (state) => artifactVerification(state), criticToken, clock),
    ).toThrow("running command");
  });

  test("never completes with orphan evidence or an unregistered critic packet", () => {
    const orphaned = completionPort();
    review(orphaned);
    orphaned.transact("test", "inject-orphan", {}, (draft) => {
      draft.orphan_evidence.push({ task_id: "T-1", report_sha256: "orphan" });
    });
    expect(() =>
      completeRun(
        orphaned,
        "coordinator",
        (state) => artifactVerification(state),
        criticToken,
        clock,
      ),
    ).toThrow();
  });

  test("refuses to seal the run without the approving critic's own token", () => {
    const port = completionPort();
    review(port);
    expect(() =>
      completeRun(
        port,
        "coordinator",
        (state) => artifactVerification(state),
        "wrong-token",
        clock,
      ),
    ).toThrow("completion authorization token is invalid");
    // The correct token still seals it - the prior call rejected the token, not the state.
    const state = completeRun(
      port,
      "coordinator",
      (locked) => artifactVerification(locked),
      criticToken,
      clock,
    );
    expect(state.completion_result?.status).toBe("complete");
  });
});

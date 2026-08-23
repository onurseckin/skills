import { describe, expect, test } from "bun:test";
import { recordCompletionRemediation } from "../../../../olt/scripts/src/workflow/completion/record-completion-remediation.ts";
import { at, commandRecord, repositoryBinding, TestPort, workflowState } from "../test-port.ts";
import type { CompletionReview } from "../../../../olt/scripts/src/workflow/completion/types.ts";

const clock = at("2026-08-19T00:00:00.000Z");

function findingsReviewPort(unresolvedFindingIds: string[]): TestPort {
  const state = workflowState();
  state.commands["C-FIX"] = commandRecord("C-FIX", { task_id: null, actor: "coordinator" });
  const review: CompletionReview = {
    critic_id: "critic",
    packet_id: "critic-1",
    graph_revision: 1,
    readiness_sha256: "r".repeat(64),
    repository_binding: structuredClone(repositoryBinding),
    summary: "found some things",
    status: "findings",
    unresolved_finding_ids: unresolvedFindingIds,
    findings: [],
    requirement_proofs: [],
    residual_risks: [],
    integrity_evidence: [],
    repository_command_ids: [],
    checks: [],
    reviewed_at: "2026-08-19T00:00:00.000Z",
    review_sha256: "s".repeat(64),
  };
  state.completion_review = review;
  return new TestPort(state);
}

function validValue(reviewSha: string, findingIds: string[]) {
  return {
    review_sha256: reviewSha,
    resolutions: findingIds.map((id) => ({
      finding_id: id,
      method: "fixed",
      command_ids: ["C-FIX"],
    })),
  };
}

describe("recordCompletionRemediation: resolution command_ids validation", () => {
  test("rejects a resolution whose command_ids is missing, empty, blank, or duplicated", () => {
    const port = findingsReviewPort(["F-1"]);
    expect(() =>
      recordCompletionRemediation(
        port,
        "coordinator",
        {
          review_sha256: "s".repeat(64),
          resolutions: [{ finding_id: "F-1", method: "fixed", command_ids: [] }],
        },
        clock,
      ),
    ).toThrow(/resolution command_ids must be nonempty and unique/);
    expect(() =>
      recordCompletionRemediation(
        port,
        "coordinator",
        {
          review_sha256: "s".repeat(64),
          resolutions: [{ finding_id: "F-1", method: "fixed", command_ids: ["C-FIX", "C-FIX"] }],
        },
        clock,
      ),
    ).toThrow(/resolution command_ids must be nonempty and unique/);
    expect(() =>
      recordCompletionRemediation(
        port,
        "coordinator",
        {
          review_sha256: "s".repeat(64),
          resolutions: [{ finding_id: "F-1", method: "fixed", command_ids: ["  "] }],
        },
        clock,
      ),
    ).toThrow(/resolution command_ids must be nonempty and unique/);
  });
});

describe("recordCompletionRemediation: review matching", () => {
  test("rejects a remediation whose review_sha256 does not match the current review", () => {
    const port = findingsReviewPort(["F-1"]);
    expect(() =>
      recordCompletionRemediation(
        port,
        "coordinator",
        validValue("wrong-sha".padEnd(64, "0"), ["F-1"]),
        clock,
      ),
    ).toThrow(/remediation does not match the latest findings review/);
  });

  test("rejects a remediation submitted against a clean (not findings) review", () => {
    const port = findingsReviewPort(["F-1"]);
    port.transact("tester", "flip-clean", {}, (draft) => {
      draft.completion_review!.status = "clean";
    });
    expect(() =>
      recordCompletionRemediation(port, "coordinator", validValue("s".repeat(64), ["F-1"]), clock),
    ).toThrow(/remediation does not match the latest findings review/);
  });

  test("rejects a remediation when there is no completion review at all", () => {
    const state = workflowState();
    const port = new TestPort(state);
    expect(() =>
      recordCompletionRemediation(port, "coordinator", validValue("s".repeat(64), ["F-1"]), clock),
    ).toThrow(/remediation does not match the latest findings review/);
  });
});

describe("recordCompletionRemediation: exact finding coverage", () => {
  test("rejects a remediation that does not resolve exactly the reviewed findings (missing one)", () => {
    const port = findingsReviewPort(["F-1", "F-2"]);
    expect(() =>
      recordCompletionRemediation(port, "coordinator", validValue("s".repeat(64), ["F-1"]), clock),
    ).toThrow(/remediation must resolve every reviewed finding exactly/);
  });

  test("rejects a remediation that resolves an extra finding beyond what was reviewed", () => {
    const port = findingsReviewPort(["F-1"]);
    expect(() =>
      recordCompletionRemediation(
        port,
        "coordinator",
        validValue("s".repeat(64), ["F-1", "F-extra"]),
        clock,
      ),
    ).toThrow(/remediation must resolve every reviewed finding exactly/);
  });

  test("accepts a remediation that resolves exactly the reviewed findings, in any order", () => {
    const port = findingsReviewPort(["F-2", "F-1"]);
    const state = recordCompletionRemediation(
      port,
      "coordinator",
      validValue("s".repeat(64), ["F-1", "F-2"]),
      clock,
    );
    expect(state.completion_remediations).toHaveLength(1);
    expect(state.completion_remediations![0]!.resolutions.map((r) => r.finding_id).sort()).toEqual([
      "F-1",
      "F-2",
    ]);
  });
});

describe("recordCompletionRemediation: other guards", () => {
  test("rejects remediation once the run is already marked complete", () => {
    const port = findingsReviewPort(["F-1"]);
    port.transact("tester", "force-complete", {}, (draft) => {
      draft.completion_result = {
        status: "complete",
        actor: "coordinator",
        completed_at: "2026-08-19T00:00:00.000Z",
        graph_revision: 1,
        readiness_sha256: "sha",
        repository_binding: draft.current_repository_binding as never,
        critic_review_sha256: "sha",
        artifact_verification_sha256: "sha",
        mandatory_run_gate_commands: {},
      };
    });
    expect(() =>
      recordCompletionRemediation(port, "coordinator", validValue("s".repeat(64), ["F-1"]), clock),
    ).toThrow(/run is already completed/);
  });

  test("rejects remediation command evidence that is not authoritative", () => {
    const port = findingsReviewPort(["F-1"]);
    expect(() =>
      recordCompletionRemediation(
        port,
        "coordinator",
        {
          review_sha256: "s".repeat(64),
          resolutions: [{ finding_id: "F-1", method: "fixed", command_ids: ["C-ghost"] }],
        },
        clock,
      ),
    ).toThrow(/remediation command evidence is invalid: C-ghost/);
  });

  test("rejects a review already remediated for the same review_sha256", () => {
    const port = findingsReviewPort(["F-1"]);
    recordCompletionRemediation(port, "coordinator", validValue("s".repeat(64), ["F-1"]), clock);
    port.transact("tester", "flip-findings-again", {}, (draft) => {
      draft.completion_review!.unresolved_finding_ids = ["F-1"];
    });
    expect(() =>
      recordCompletionRemediation(port, "coordinator", validValue("s".repeat(64), ["F-1"]), clock),
    ).toThrow(/completion review is already remediated/);
  });
});

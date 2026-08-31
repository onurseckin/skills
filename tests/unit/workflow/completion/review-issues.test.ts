import { describe, expect, test } from "bun:test";
import { completionReviewIssues } from "../../../../olt/scripts/src/workflow/completion/review-issues.ts";
import { repositoryBinding, workflowState } from "../test-port.ts";
import type { CompletionReview } from "../../../../olt/scripts/src/workflow/completion/types.ts";

function baseReview(overrides: Partial<CompletionReview> = {}): CompletionReview {
  return {
    critic_id: "critic",
    packet_id: "direct",
    graph_revision: 1,
    readiness_sha256: "r".repeat(64),
    repository_binding: structuredClone(repositoryBinding),
    summary: "reviewed",
    status: "clean",
    unresolved_finding_ids: [],
    findings: [],
    requirement_proofs: [
      {
        requirement_id: "R-1",
        status: "satisfied",
        evidence: [{ kind: "command", reference: "C-1", observation: "ok" }],
      },
    ],
    residual_risks: [],
    integrity_evidence: [{ status: "passed" }],
    repository_command_ids: [],
    checks: [{ command_id: "C-1" }],
    reviewed_at: "2026-08-19T00:00:00.000Z",
    review_sha256: "s".repeat(64),
    ...overrides,
  };
}

describe("completionReviewIssues: no review recorded", () => {
  test("reports a single missing-review issue and nothing else", () => {
    expect(completionReviewIssues(workflowState(), undefined)).toEqual([
      "authoritative completion review is missing",
    ]);
  });
});

describe("completionReviewIssues: findings and residual risks are actually inspected", () => {
  test("flags a review whose finding ids don't match its own unresolved_finding_ids list", () => {
    const state = workflowState();
    const review = baseReview({
      status: "findings",
      findings: [
        {
          id: "F-1",
          requirement_id: "R-1",
          severity: "minor",
          observation: "obs",
          evidence: [{ kind: "critic_assertion" }],
          remediation: "fix",
          revalidation: "re-run",
        },
      ],
      unresolved_finding_ids: [], // does not include F-1 - inconsistent
    });
    expect(completionReviewIssues(state, review)).toContain(
      "completion finding IDs are inconsistent",
    );
  });

  test("does not flag finding-id consistency when the finding id is properly listed as unresolved", () => {
    const state = workflowState();
    const review = baseReview({
      status: "findings",
      findings: [
        {
          id: "F-1",
          requirement_id: "R-1",
          severity: "minor",
          observation: "obs",
          evidence: [{ kind: "critic_assertion" }],
          remediation: "fix",
          revalidation: "re-run",
        },
      ],
      unresolved_finding_ids: ["F-1"],
    });
    expect(completionReviewIssues(state, review)).not.toContain(
      "completion finding IDs are inconsistent",
    );
  });

  test("flags an accepted residual risk that carries no evidence", () => {
    const state = workflowState();
    const review = baseReview({
      residual_risks: [
        {
          id: "RISK-1",
          severity: "minor",
          description: "d",
          disposition: "accepted",
          rationale: "r",
          evidence: [],
        },
      ],
    });
    expect(completionReviewIssues(state, review)).toContain(
      "completion residual risk evidence is invalid",
    );
  });

  test("flags a residual risk whose disposition is not accepted", () => {
    const state = workflowState();
    const review = baseReview({
      residual_risks: [
        {
          id: "RISK-1",
          severity: "minor",
          description: "d",
          disposition: "deferred" as never,
          rationale: "r",
          evidence: [{ kind: "critic_assertion" }],
        },
      ],
    });
    expect(completionReviewIssues(state, review)).toContain(
      "completion residual risk evidence is invalid",
    );
  });

  test("does not flag a well-formed, accepted, evidenced residual risk", () => {
    const state = workflowState();
    const review = baseReview({
      residual_risks: [
        {
          id: "RISK-1",
          severity: "minor",
          description: "d",
          disposition: "accepted",
          rationale: "r",
          evidence: [{ kind: "critic_assertion" }],
        },
      ],
    });
    expect(completionReviewIssues(state, review)).not.toContain(
      "completion residual risk evidence is invalid",
    );
  });

  test("handles state.requirements as nested requirements object and dictionary", () => {
    const state = workflowState();
    // Nested requirements object
    (state as Record<string, unknown>).requirements = {
      requirements: [{ id: "R-1", status: "planned", dependencies: [] }],
    };
    const review = baseReview();
    const issuesNested = completionReviewIssues(state, review);
    expect(issuesNested).not.toContain("completion requirement proof coverage is incomplete");

    // Dictionary representation
    (state as Record<string, unknown>).requirements = {
      "R-1": { id: "R-1", status: "planned", dependencies: [] },
    };
    const issuesDict = completionReviewIssues(state, review);
    expect(issuesDict).not.toContain("completion requirement proof coverage is incomplete");
  });
});

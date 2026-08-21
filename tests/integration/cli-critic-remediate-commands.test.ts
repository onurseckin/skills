import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import {
  initRun,
  loadRun,
  transact,
} from "../../orchestrating-long-tasks/scripts/src/store/index.ts";
import { completionReviewDigest } from "../../orchestrating-long-tasks/scripts/src/workflow/completion/completion-review-digest.ts";
import type {
  CompletionCriticAuthorization,
  CompletionFinding,
  CompletionReview,
} from "../../orchestrating-long-tasks/scripts/src/workflow/types.ts";
import { cleanupRoots } from "../unit/cli/full-lifecycle-fixture.ts";
import { commandRecord, repositoryBinding } from "../unit/workflow/test-port.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

/**
 * critic:remediate and doctor's completion reporting act on completion_review /
 * completion_remediations state -- they never touch how a run got there. Driving the real
 * plan -> task -> validate -> critic:start -> critic:review CLI pipeline just to reach "a findings
 * review is on record" pays for several real gate subprocesses per test. This builds that
 * end state directly: a minimal capsule whose completion_review is already a "findings" verdict on
 * F-CRITIC-01, typed against the same domain types (CompletionReview, CompletionCriticAuthorization)
 * and hashed with the production completionReviewDigest, so nothing here is faked -- it is the same
 * shape recordCompletionReview would have produced, just assembled directly instead of earned
 * through the full pipeline.
 */
async function reviewedFindingsRun(name: string, roots: string[]) {
  const repo = await mkdtemp(join(tmpdir(), `harness-critic-remediate-${name}-`));
  roots.push(repo);
  const runRoot = initRun(
    repo,
    name,
    new TextEncoder().encode("Remediation fixture"),
    "file",
    true,
  );

  const finding: CompletionFinding = {
    id: "F-CRITIC-01",
    requirement_id: "R-1",
    severity: "important",
    observation: "No test covers the cross-module edge case",
    remediation: "Add a test for the cross-module edge case",
    revalidation: "bun test tests",
    evidence: [],
  };

  const review: CompletionReview = {
    critic_id: "critic-1",
    packet_id: "direct",
    graph_revision: 1,
    readiness_sha256: "a".repeat(64),
    repository_binding: structuredClone(repositoryBinding),
    summary: "Missing integration check",
    status: "findings",
    unresolved_finding_ids: [finding.id],
    findings: [finding],
    requirement_proofs: [],
    residual_risks: [],
    integrity_evidence: [{ status: "passed", issues: [] }],
    repository_command_ids: [],
    checks: [],
    reviewed_at: "2026-08-13T12:00:00.000Z",
    review_sha256: "",
  };
  review.review_sha256 = completionReviewDigest(review);

  const criticAssignment: CompletionCriticAuthorization = {
    critic_id: "critic-1",
    token_digest: "d".repeat(64),
    attempt: 1,
    status: "reviewed",
    started_at: "2026-08-13T12:00:00.000Z",
    deadline_at: "2026-08-13T12:20:00.000Z",
    readiness_sha256: review.readiness_sha256,
    repository_binding: structuredClone(repositoryBinding),
  };

  transact(runRoot, "planner", "plan-applied", {}, (state) => {
    state.graph = { revision: 1, gates: [] };
    state.requirements = { requirements: [] };
    state.tasks = {};
    state.commands = {
      "C-FIX": commandRecord("C-FIX", { task_id: null, actor: "coordinator" }),
    };
    state.current_repository_binding = structuredClone(repositoryBinding);
    state.completion_critic = criticAssignment;
    state.completion_critic_history = [criticAssignment];
    state.completion_review = review;
    state.completion_reviews = [review];
  });

  return { run: runRoot, reviewSha: review.review_sha256 };
}

describe("critic:remediate", () => {
  test("closes out a findings review with command-backed resolutions", async () => {
    const { run, reviewSha } = await reviewedFindingsRun("closes-out", roots);

    const doctorBefore = await execute(["doctor", "--run", run]);
    expect(doctorBefore.issues).toContain("completeness critic has unresolved finding F-CRITIC-01");

    const remediated = await execute([
      "critic:remediate",
      "--run",
      run,
      "--actor",
      "coordinator",
      "--resolve",
      "F-CRITIC-01=C-FIX",
      "--resolution-method",
      "F-CRITIC-01=focused repair and verification",
    ]);
    expect(String(remediated.markdown)).toContain("### Completion Findings Remediated");
    const remediation = remediated.remediation as {
      review_sha256: string;
      resolutions: { finding_id: string; method: string; command_ids: string[] }[];
    };
    expect(remediation.review_sha256).toBe(reviewSha);
    expect(remediation.resolutions).toEqual([
      {
        finding_id: "F-CRITIC-01",
        method: "focused repair and verification",
        command_ids: ["C-FIX"],
      },
    ]);

    const persisted = loadRun(run).state.completion_remediations;
    expect(persisted).toHaveLength(1);
    expect(persisted![0]!.review_sha256).toBe(reviewSha);

    // The review still stays in history and unresolved: a fresh critic pass, not this remediation
    // record alone, is what clears "completeness critic has unresolved finding" from doctor.
    const doctorAfter = await execute(["doctor", "--run", run]);
    expect(doctorAfter.issues).toContain("completeness critic has unresolved finding F-CRITIC-01");
    expect(doctorAfter.issues).not.toContain(
      "completion findings review 1 lacks exact remediation",
    );
  });

  test("refuses to remediate a review it does not match", async () => {
    const { run } = await reviewedFindingsRun("no-review-match", roots);
    await expect(
      execute([
        "critic:remediate",
        "--run",
        run,
        "--actor",
        "coordinator",
        "--review-sha256",
        "0".repeat(64),
        "--resolve",
        "F-1=C-does-not-exist",
        "--resolution-method",
        "F-1=n/a",
      ]),
    ).rejects.toThrow();
  });
});

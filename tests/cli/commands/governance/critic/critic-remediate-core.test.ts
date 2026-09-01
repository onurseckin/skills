import { afterEach, describe, expect, test } from "bun:test";
import { criticRemediateCommand } from "../../../../../olt/scripts/src/cli/commands/critic-ops.ts";
import { transact } from "../../../../../olt/scripts/src/engine/store/index.ts";
import { completionReviewDigest } from "../../../../../olt/scripts/src/workflow/completion/completion-review-digest.ts";
import type {
  CompletionCriticAuthorization,
  CompletionFinding,
  CompletionReview,
} from "../../../../../olt/scripts/src/workflow/types.ts";
import { commandRecord } from "../../../../workflow/shared/test-port.ts";
import { cleanupRoots } from "../../fixtures/full-lifecycle-fixture.ts";
import { setupCompiledRun } from "../../fixtures/task-ops-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

export async function reviewedFindingsRun(
  label: string,
  rootList: string[],
): Promise<{ run: string; reviewSha: string; findingId: string }> {
  const { run } = await setupCompiledRun(`remediate-${label}`, rootList);

  const findingId = "F-TEST-1";
  const finding: CompletionFinding = {
    id: findingId,
    requirement_id: null,
    task_id: null,
    domain: "completeness",
    severity: "critical",
    observation: "A defect was observed in review",
    remediation: "Apply the fix and verify",
  };

  const review: Record<string, unknown> = {
    critic_id: "critic-1",
    reviewer_agent_id: "critic-1",
    verdict: "request_changes",
    status: "findings",
    findings: [finding],
    unresolved_finding_ids: [findingId],
    assessed_requirement_ids: [],
    repository_command_ids: [],
    reviewed_at: "2026-08-20T12:00:00.000Z",
    evidence_manifest: [],
    review_digest: "seeded-digest-placeholder",
  };
  const reviewSha = completionReviewDigest(review as unknown as CompletionReview);
  review.review_sha256 = reviewSha;
  const auth: CompletionCriticAuthorization = {
    agent_id: "critic-1",
    assigned_at: "2026-08-20T11:00:00.000Z",
    assigned_by: "coordinator",
    charter_snapshot_sha256: "0".repeat(64),
  };

  transact(run, "test-setup", "seed-findings-review", {}, (state) => {
    state.completion_critic = auth;
    state.completion_review = review;
    state.commands = {
      "C-FIX": commandRecord("C-FIX", { task_id: null, actor: "coordinator" }),
    };
  });

  return { run, reviewSha, findingId };
}

describe("critic:remediate - Core Validations", () => {
  test("records clean remediation when every finding is paired with a resolving command", async () => {
    const { run, reviewSha, findingId } = await reviewedFindingsRun("happy-path", roots);
    const result = criticRemediateCommand({
      run,
      actor: "coordinator",
      resolve: [`${findingId}=C-FIX`],
      "resolution-method": [`${findingId}=focused repair and verification`],
    });

    expect(result.run_root).toBe(run);
    const remediation = result.remediation as {
      review_sha256: string;
      resolutions: { finding_id: string; method: string; command_ids: string[] }[];
    };
    expect(remediation.review_sha256).toBe(reviewSha);
    expect(remediation.resolutions).toEqual([
      { finding_id: findingId, method: "focused repair and verification", command_ids: ["C-FIX"] },
    ]);
  });

  test("--resolve accepts a comma-separated list of command ids for one finding", async () => {
    const { run, findingId } = await reviewedFindingsRun("multi-command", roots);
    transact(run, "test-setup", "extra-command-for-test", {}, (state) => {
      state.commands = {
        ...state.commands,
        "C-SECOND": commandRecord("C-SECOND", { task_id: null, actor: "coordinator" }),
      };
    });
    const result = criticRemediateCommand({
      run,
      actor: "coordinator",
      resolve: [`${findingId}=C-FIX, C-SECOND`],
      "resolution-method": [`${findingId}=two commands closed it out`],
    });
    const remediation = result.remediation as { resolutions: { command_ids: string[] }[] };
    expect(remediation.resolutions[0]!.command_ids).toEqual(["C-FIX", "C-SECOND"]);
  });

  test("accepts an explicit --review-sha256 instead of defaulting to the recorded review", async () => {
    const { run, reviewSha, findingId } = await reviewedFindingsRun("explicit-sha", roots);
    const result = criticRemediateCommand({
      run,
      actor: "coordinator",
      "review-sha256": reviewSha,
      resolve: [`${findingId}=C-FIX`],
      "resolution-method": [`${findingId}=focused repair and verification`],
    });
    const remediation = result.remediation as { review_sha256: string };
    expect(remediation.review_sha256).toBe(reviewSha);
  });
});

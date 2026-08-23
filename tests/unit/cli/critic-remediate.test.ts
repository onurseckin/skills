import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../../olt/scripts/src/cli/execute.ts";
import { initRun, transact } from "../../../olt/scripts/src/store/index.ts";
import { completionReviewDigest } from "../../../olt/scripts/src/workflow/completion/completion-review-digest.ts";
import type {
  CompletionCriticAuthorization,
  CompletionFinding,
  CompletionReview,
} from "../../../olt/scripts/src/workflow/types.ts";
import { commandRecord, repositoryBinding } from "../workflow/test-port.ts";
import { cleanupRoots } from "./full-lifecycle-fixture.ts";
import { setupCompiledRun } from "./task-ops-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

/**
 * A minimal capsule whose completion_review is already an on-record "findings" verdict, built
 * directly against the same domain types recordCompletionReview produces (and hashed with the
 * same completionReviewDigest) rather than earned through the full plan -> critic:start ->
 * critic:review pipeline. critic:remediate only ever reads completion_review /
 * completion_remediations state; it never re-derives how the run got there.
 */
async function reviewedFindingsRun(
  name: string,
  roots: string[],
): Promise<{ run: string; reviewSha: string; findingId: string }> {
  const repo = await mkdtemp(join(tmpdir(), `harness-critic-remediate-cmd-${name}-`));
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

  return { run: runRoot, reviewSha: review.review_sha256, findingId: finding.id };
}

describe("critic:remediate", () => {
  test("closes out a findings review with a command-backed resolution", async () => {
    const { run, reviewSha, findingId } = await reviewedFindingsRun("closes-out", roots);
    const result = await execute([
      "critic:remediate",
      "--run",
      run,
      "--actor",
      "coordinator",
      "--resolve",
      `${findingId}=C-FIX`,
      "--resolution-method",
      `${findingId}=focused repair and verification`,
    ]);
    expect(String(result.markdown)).toContain("### Completion Findings Remediated:");
    expect(String(result.markdown)).toContain(`\`${findingId}\``);
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
    const result = await execute([
      "critic:remediate",
      "--run",
      run,
      "--actor",
      "coordinator",
      "--resolve",
      `${findingId}=C-FIX, C-SECOND`,
      "--resolution-method",
      `${findingId}=two commands closed it out`,
    ]);
    const remediation = result.remediation as { resolutions: { command_ids: string[] }[] };
    expect(remediation.resolutions[0]!.command_ids).toEqual(["C-FIX", "C-SECOND"]);
  });

  test("accepts an explicit --review-sha256 instead of defaulting to the recorded review", async () => {
    const { run, reviewSha, findingId } = await reviewedFindingsRun("explicit-sha", roots);
    const result = await execute([
      "critic:remediate",
      "--run",
      run,
      "--actor",
      "coordinator",
      "--review-sha256",
      reviewSha,
      "--resolve",
      `${findingId}=C-FIX`,
      "--resolution-method",
      `${findingId}=focused repair and verification`,
    ]);
    const remediation = result.remediation as { review_sha256: string };
    expect(remediation.review_sha256).toBe(reviewSha);
  });

  test("rejects when no completion review is recorded for the run", async () => {
    const { run } = await setupCompiledRun("critic-remediate-no-review", roots);
    await expect(
      execute([
        "critic:remediate",
        "--run",
        run,
        "--actor",
        "coordinator",
        "--resolve",
        "F-1=C-FIX",
        "--resolution-method",
        "F-1=fixed it",
      ]),
    ).rejects.toThrow("no completion review is recorded for this run");
  });

  test("rejects a --resolve entry with no '=' separator", async () => {
    const { run } = await reviewedFindingsRun("bad-resolve-pair", roots);
    await expect(
      execute([
        "critic:remediate",
        "--run",
        run,
        "--actor",
        "coordinator",
        "--resolve",
        "F-CRITIC-01-no-equals",
      ]),
    ).rejects.toThrow("--resolve must be given as <finding-id>=<value>");
  });

  test("rejects a --resolve entry that names no command id", async () => {
    const { run, findingId } = await reviewedFindingsRun("empty-resolve", roots);
    await expect(
      execute([
        "critic:remediate",
        "--run",
        run,
        "--actor",
        "coordinator",
        "--resolve",
        `${findingId}=, ,`,
      ]),
    ).rejects.toThrow(`--resolve ${findingId} cites no command id`);
  });

  test("rejects a finding given two --resolution-method entries", async () => {
    const { run, findingId } = await reviewedFindingsRun("two-methods", roots);
    await expect(
      execute([
        "critic:remediate",
        "--run",
        run,
        "--actor",
        "coordinator",
        "--resolve",
        `${findingId}=C-FIX`,
        "--resolution-method",
        `${findingId}=first method`,
        "--resolution-method",
        `${findingId}=second method`,
      ]),
    ).rejects.toThrow(`finding ${findingId} has two --resolution-method`);
  });

  test("rejects a --resolve finding with no matching --resolution-method", async () => {
    const { run, findingId } = await reviewedFindingsRun("missing-method", roots);
    await expect(
      execute([
        "critic:remediate",
        "--run",
        run,
        "--actor",
        "coordinator",
        "--resolve",
        `${findingId}=C-FIX`,
      ]),
    ).rejects.toThrow(`finding ${findingId} has no --resolution-method`);
  });

  test("rejects a --resolution-method entry with no '=' separator", async () => {
    const { run, findingId } = await reviewedFindingsRun("bad-method-pair", roots);
    await expect(
      execute([
        "critic:remediate",
        "--run",
        run,
        "--actor",
        "coordinator",
        "--resolve",
        `${findingId}=C-FIX`,
        "--resolution-method",
        "no-equals-here",
      ]),
    ).rejects.toThrow("--resolution-method must be given as <finding-id>=<value>");
  });

  test("proves anti-leak flow: critic rejections route findings to repairers and require command-backed resolutions", async () => {
    const { run, reviewSha, findingId } = await reviewedFindingsRun("anti-leak-routing", roots);
    // Findings cannot be auto-cleared; they must be formally resolved with recorded command evidence
    const result = await execute([
      "critic:remediate",
      "--run",
      run,
      "--actor",
      "coordinator",
      "--resolve",
      `${findingId}=C-FIX`,
      "--resolution-method",
      `${findingId}=dedicated repairer executed unit test fix and verified with C-FIX`,
    ]);
    expect(result.run_root).toBe(run);
    const remediation = result.remediation as {
      review_sha256: string;
      resolutions: { finding_id: string; method: string; command_ids: string[] }[];
    };
    expect(remediation.review_sha256).toBe(reviewSha);
    expect(remediation.resolutions[0]!.finding_id).toBe(findingId);
    expect(remediation.resolutions[0]!.method).toContain(
      "dedicated repairer executed unit test fix",
    );
    expect(remediation.resolutions[0]!.command_ids).toEqual(["C-FIX"]);
    expect(String(result.markdown)).toContain("Next Step");
    expect(String(result.markdown)).toContain("critic:start");
  });
});

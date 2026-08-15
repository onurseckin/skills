import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { loadRun } from "../../../orchestrating-long-tasks/scripts/src/store/index.ts";
import { graphDocument } from "../graph/fixtures.ts";
import { requirementsDocument } from "../requirements/fixtures.ts";
import {
  cleanupRoots,
  cleanCompletionReview,
  runStateAssertion,
  successfulCommand,
  writeJson,
} from "./full-lifecycle-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

async function completedWorkflowSetup() {
  const repo = await mkdtemp(join(tmpdir(), "harness-cli-compl-"));
  roots.push(repo);
  await writeFile(join(repo, "gate-check.ts"), "console.log('gate-ok');\n");
  const prompt = "Implement completion flow";
  const promptPath = join(repo, "prompt.txt");
  await writeFile(promptPath, prompt);
  const requirements = requirementsDocument(prompt);
  const graph = graphDocument(requirements);
  for (const gate of graph.gates as Record<string, unknown>[]) gate.command = runStateAssertion();
  const requirementsPath = await writeJson(repo, "requirements.json", requirements);
  const graphPath = await writeJson(repo, "graph.json", graph);
  const init = await execute([
    "init", "--repo", repo, "--run-id", "compl-run", "--prompt-file", promptPath,
    "--capture-mode", "file", "--source-verified",
  ]);
  const run = init.run_root as string;
  await execute([
    "plan-apply", "--run", run, "--requirements", requirementsPath,
    "--graph", graphPath, "--expected-revision", "0", "--actor", "planner",
  ]);

  const claim = await execute([
    "claim", "--run", run, "--task", "task-1", "--agent", "impl", "--role", "implementer",
  ]);
  await execute([
    "packet", "--run", run, "--task", "task-1", "--role", "implementer",
    "--agent", "impl", "--token", claim.token as string, "--id", "task-1-impl-1",
  ]);
  const reportPath = await writeJson(repo, "submission.json", {
    summary: "done",
    requirement_ids: ["R-001"],
    files_changed: ["src/area-1"],
    checks: [{ command: "test", status: "passed" }],
    evidence: [{ kind: "diff", path: "src/area-1" }],
  });
  await execute([
    "submit", "--run", run, "--task", "task-1", "--agent", "impl",
    "--token", claim.token as string, "--report", reportPath,
  ]);

  const validation = await execute([
    "begin-validation", "--run", run, "--task", "task-1", "--validator", "val",
  ]);
  await execute([
    "packet", "--run", run, "--task", "task-1", "--role", "validator",
    "--agent", "val", "--token", validation.token as string, "--id", "task-1-val-1",
  ]);
  const valCmd = await successfulCommand(run, repo, "val", "task-1", "gate-required");
  const reviewPath = await writeJson(repo, "review.json", {
    verdict: "pass",
    requirement_ids: ["R-001"],
    checks: [{ command_id: valCmd }],
    findings: [],
  });
  await execute([
    "review", "--run", run, "--task", "task-1", "--validator", "val",
    "--token", validation.token as string, "--review", reviewPath,
  ]);

  const taskGate = await successfulCommand(run, repo, "coordinator", "task-1", "gate-required");
  await execute([
    "gate", "--run", run, "--task", "task-1", "--gate", "gate-required",
    "--command-id", taskGate, "--actor", "coordinator",
  ]);
  await execute(["finish", "--run", run, "--task", "task-1", "--actor", "coordinator"]);
  const runGate = await successfulCommand(run, repo, "coordinator", undefined, "gate-final");
  return { repo, run, runGate };
}

describe("CLI completion commands", () => {
  test(
    "full critic review, remediation, and completion artifact verification flow",
    async () => {
      const { repo, run, runGate } = await completedWorkflowSetup();

    const criticRes = await execute(["begin-critic", "--run", run, "--critic", "critic"]);
    expect(criticRes.token).toBeString();
    expect(criticRes.run_root).toBe(run);

    const criticPacket = await execute([
      "packet", "--run", run, "--role", "completeness-critic", "--agent", "critic",
      "--token", criticRes.token as string, "--repository-command-ids", runGate, "--id", "critic-1",
    ]);

    const metadata = criticPacket.metadata as Record<string, unknown>;
    const criticAuth = criticRes.critic as Record<string, unknown>;
    const criticCheck = await successfulCommand(run, repo, "critic");

    const reviewRoot = await mkdtemp(join(tmpdir(), "harness-rev-"));
    roots.push(reviewRoot);
    const reviewData = {
      ...cleanCompletionReview(
        metadata.packet_sha256,
        criticAuth.readiness_sha256,
        metadata.repository_binding,
        runGate,
        criticCheck,
      ),
      status: "findings",
      unresolved_finding_ids: ["CF-1"],
      findings: [
        {
          id: "CF-1",
          requirement_id: "R-001",
          severity: "important",
          observation: "missing docs",
          evidence: [{ kind: "diff", path: "src/area-1" }],
          remediation: "add docs",
          revalidation: "check docs",
        },
      ],
    };
    const revPath = await writeJson(reviewRoot, "comp-rev.json", reviewData);

    const reviewRes = await execute([
      "review-completion", "--run", run, "--critic", "critic",
      "--token", criticRes.token as string, "--review", revPath,
    ]);
    expect(reviewRes.run_root).toBe(run);
    expect((reviewRes.review as { status: string }).status).toBe("findings");

    const remCmd = await successfulCommand(run, repo, "coordinator");
    const remediationData = {
      review_sha256: (reviewRes.review as { review_sha256: string }).review_sha256,
      resolutions: [
        {
          finding_id: "CF-1",
          method: "docs added",
          command_ids: [remCmd],
        },
      ],
    };
    const remPath = await writeJson(reviewRoot, "remediation.json", remediationData);
    const remRes = await execute([
      "remediate-completion", "--run", run, "--actor", "coordinator", "--remediation", remPath,
    ]);
    expect(remRes.run_root).toBe(run);
    expect(remRes.remediation).toBeObject();

    // Re-critic with clean review and complete
    const secondCritic = await execute(["begin-critic", "--run", run, "--critic", "critic-2"]);
    const secondPkt = await execute([
      "packet", "--run", run, "--role", "completeness-critic", "--agent", "critic-2",
      "--token", secondCritic.token as string, "--repository-command-ids", runGate, "--id", "critic-2",
    ]);
    const secondCheck = await successfulCommand(run, repo, "critic-2");
    const cleanRevData = cleanCompletionReview(
      (secondPkt.metadata as Record<string, unknown>).packet_sha256,
      (secondCritic.critic as Record<string, unknown>).readiness_sha256,
      (secondPkt.metadata as Record<string, unknown>).repository_binding,
      runGate,
      secondCheck,
    );
    cleanRevData.packet_id = "critic-2";
    const cleanRevPath = await writeJson(reviewRoot, "clean-rev.json", cleanRevData);
    await execute([
      "review-completion", "--run", run, "--critic", "critic-2",
      "--token", secondCritic.token as string, "--review", cleanRevPath,
    ]);

    const completed = await execute(["complete", "--run", run, "--actor", "coordinator"]);
    expect(completed.run_root).toBe(run);
    expect((completed.completion as { status: string }).status).toBe("complete");
  }, 30000);

  test("completion artifact verification catches tampered command output", async () => {
    const { repo, run, runGate } = await completedWorkflowSetup();

    const criticRes = await execute(["begin-critic", "--run", run, "--critic", "critic"]);
    const criticPacket = await execute([
      "packet", "--run", run, "--role", "completeness-critic", "--agent", "critic",
      "--token", criticRes.token as string, "--repository-command-ids", runGate, "--id", "critic-1",
    ]);
    const metadata = criticPacket.metadata as Record<string, unknown>;
    const criticAuth = criticRes.critic as Record<string, unknown>;
    const criticCheck = await successfulCommand(run, repo, "critic");

    const reviewRoot = await mkdtemp(join(tmpdir(), "harness-rev-tamper-"));
    roots.push(reviewRoot);
    const reviewData = cleanCompletionReview(
      metadata.packet_sha256,
      criticAuth.readiness_sha256,
      metadata.repository_binding,
      runGate,
      criticCheck,
    );
    const revPath = await writeJson(reviewRoot, "comp-rev.json", reviewData);

    await execute([
      "review-completion", "--run", run, "--critic", "critic",
      "--token", criticRes.token as string, "--review", revPath,
    ]);

    const command = (
      loadRun(run).state.commands as Record<string, { logs: { stdout: { path: string } } }>
    )[criticCheck]!;
    const stdoutPath = join(run, command.logs.stdout.path);
    await chmod(stdoutPath, 0o600);
    await writeFile(stdoutPath, "tampered stdout");

    await expect(execute(["complete", "--run", run, "--actor", "coordinator"])).rejects.toThrow(
      "completion artifact verification failed",
    );
  });
});

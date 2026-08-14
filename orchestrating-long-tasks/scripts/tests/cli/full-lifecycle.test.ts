import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execute } from "../../src/cli/execute.ts";
import { loadRun } from "../../src/store/index.ts";
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

describe("CLI authoritative terminal lifecycle", () => {
  test("reaches completion only through packets, independent evidence, gates, and critic review", async () => {
    const repo = await mkdtemp(join(tmpdir(), "harness-cli-full-"));
    roots.push(repo);
    await writeFile(join(repo, "gate-check.ts"), "console.log('gate-ok');\n");
    const prompt = "Implement the complete lifecycle";
    const promptPath = join(repo, "prompt.txt");
    await writeFile(promptPath, prompt);
    const requirements = requirementsDocument(prompt);
    const graph = graphDocument(requirements);
    for (const gate of graph.gates as Record<string, unknown>[]) {
      gate.command = runStateAssertion();
    }
    const requirementsPath = await writeJson(repo, "requirements.json", requirements);
    const graphPath = await writeJson(repo, "graph.json", graph);
    const initialized = await execute([
      "init",
      "--repo",
      repo,
      "--run-id",
      "full-run",
      "--prompt-file",
      promptPath,
      "--capture-mode",
      "file",
      "--source-verified",
    ]);
    const run = initialized.run_root as string;
    await execute([
      "plan-apply",
      "--run",
      run,
      "--requirements",
      requirementsPath,
      "--graph",
      graphPath,
      "--expected-revision",
      "0",
      "--actor",
      "planner",
    ]);

    const claim = await execute([
      "claim",
      "--run",
      run,
      "--task",
      "task-1",
      "--agent",
      "implementer",
      "--role",
      "implementer",
    ]);
    await execute([
      "packet",
      "--run",
      run,
      "--task",
      "task-1",
      "--role",
      "implementer",
      "--agent",
      "implementer",
      "--token",
      claim.token as string,
      "--id",
      "task-1-implementer-1",
    ]);
    const reportPath = await writeJson(repo, "submission.json", {
      summary: "implemented",
      requirement_ids: ["R-001"],
      files_changed: ["src/area-1"],
      checks: [{ command: "focused check", status: "passed", evidence: "command follows" }],
      evidence: [{ kind: "diff", path: "src/area-1" }],
    });
    await execute([
      "submit",
      "--run",
      run,
      "--task",
      "task-1",
      "--agent",
      "implementer",
      "--token",
      claim.token as string,
      "--report",
      reportPath,
    ]);

    const validation = await execute([
      "begin-validation",
      "--run",
      run,
      "--task",
      "task-1",
      "--validator",
      "validator",
    ]);
    await execute([
      "packet",
      "--run",
      run,
      "--task",
      "task-1",
      "--role",
      "validator",
      "--agent",
      "validator",
      "--token",
      validation.token as string,
      "--id",
      "task-1-validator-1",
    ]);
    const validationCommand = await successfulCommand(
      run,
      repo,
      "validator",
      "task-1",
      "gate-required",
    );
    const reviewPath = await writeJson(repo, "review.json", {
      verdict: "pass",
      requirement_ids: ["R-001"],
      checks: [{ command_id: validationCommand, result: "passed" }],
      findings: [],
    });
    await execute([
      "review",
      "--run",
      run,
      "--task",
      "task-1",
      "--validator",
      "validator",
      "--token",
      validation.token as string,
      "--review",
      reviewPath,
    ]);

    const taskGate = await successfulCommand(run, repo, "coordinator", "task-1", "gate-required");
    await execute([
      "gate",
      "--run",
      run,
      "--task",
      "task-1",
      "--gate",
      "gate-required",
      "--command-id",
      taskGate,
      "--actor",
      "coordinator",
    ]);
    await execute(["finish", "--run", run, "--task", "task-1", "--actor", "coordinator"]);
    const runGate = await successfulCommand(run, repo, "coordinator", undefined, "gate-final");

    const assignment = await execute(["begin-critic", "--run", run, "--critic", "critic"]);
    const criticPacket = await execute([
      "packet",
      "--run",
      run,
      "--role",
      "completeness-critic",
      "--agent",
      "critic",
      "--token",
      assignment.token as string,
      "--repository-command-ids",
      runGate,
      "--id",
      "critic-1",
    ]);
    const metadata = criticPacket.metadata as Record<string, unknown>;
    const criticAuthorization = assignment.critic as Record<string, unknown>;
    const criticCheck = await successfulCommand(run, repo, "critic");
    const reviewRoot = await mkdtemp(join(tmpdir(), "harness-review-"));
    roots.push(reviewRoot);
    const completionPath = await writeJson(
      reviewRoot,
      "completion-review.json",
      cleanCompletionReview(
        metadata.packet_sha256,
        criticAuthorization.readiness_sha256,
        metadata.repository_binding,
        runGate,
        criticCheck,
      ),
    );
    await execute([
      "review-completion",
      "--run",
      run,
      "--critic",
      "critic",
      "--token",
      assignment.token as string,
      "--review",
      completionPath,
    ]);
    const command = (
      loadRun(run).state.commands as Record<string, { logs: { stdout: { path: string } } }>
    )[criticCheck]!;
    const stdoutPath = join(run, command.logs.stdout.path);
    const stdout = await readFile(stdoutPath);
    await chmod(stdoutPath, 0o600);
    await writeFile(stdoutPath, "tampered");
    await expect(execute(["complete", "--run", run, "--actor", "coordinator"])).rejects.toThrow(
      "completion artifact verification failed",
    );
    await writeFile(stdoutPath, stdout);

    const packetPath = criticPacket.path as string;
    const packetMarkdown = await readFile(packetPath);
    await chmod(packetPath, 0o600);
    await writeFile(packetPath, "tampered");
    await expect(execute(["complete", "--run", run, "--actor", "coordinator"])).rejects.toThrow(
      "completion artifact verification failed",
    );
    await writeFile(packetPath, packetMarkdown);
    const completed = await execute(["complete", "--run", run, "--actor", "coordinator"]);
    expect(completed.completion).toMatchObject({ status: "complete", graph_revision: 1 });
    const status = await execute(["status", "--run", run]);
    expect(status.completion_blockers).toEqual([]);
    expect(status.completion_result).toMatchObject({ status: "complete" });
    const doctor = await execute(["doctor", "--run", run]);
    expect(doctor).toMatchObject({ healthy: true, workflow_issues: [] });
  });
});

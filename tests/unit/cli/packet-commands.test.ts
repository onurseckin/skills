import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { graphDocument } from "../graph/fixtures.ts";
import { requirementsDocument } from "../requirements/fixtures.ts";
import { cleanupRoots, writeJson } from "./full-lifecycle-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

async function packetFixture() {
  const repo = await mkdtemp(join(tmpdir(), "harness-cli-packet-"));
  roots.push(repo);
  const prompt = "Implement packet testing";
  const promptPath = join(repo, "prompt.txt");
  await writeFile(promptPath, prompt);
  const requirements = requirementsDocument(prompt);
  const graph = graphDocument(requirements);
  const requirementsPath = await writeJson(repo, "requirements.json", requirements);
  const graphPath = await writeJson(repo, "graph.json", graph);
  const init = await execute([
    "init",
    "--repo",
    repo,
    "--run-id",
    "pkt-run",
    "--prompt-file",
    promptPath,
    "--capture-mode",
    "file",
    "--source-verified",
  ]);
  const run = init.run_root as string;
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
  return { repo, run };
}

describe("CLI packet commands", () => {
  test("packetCommand validates role, task, planner args, and repository command IDs", async () => {
    const { repo, run } = await packetFixture();

    // Unknown role
    await expect(
      execute([
        "packet",
        "--run",
        run,
        "--role",
        "unknown-role",
        "--agent",
        "agent-1",
        "--id",
        "pkt-1",
      ]),
    ).rejects.toThrow("unknown packet role");

    // Planner with extra args or wrong id
    await expect(
      execute([
        "packet",
        "--run",
        run,
        "--role",
        "planner",
        "--agent",
        "agent-1",
        "--id",
        "planner-wrong",
      ]),
    ).rejects.toThrow("planner recovery requires --id planner-0 and no task or token");

    await expect(
      execute([
        "packet",
        "--run",
        run,
        "--role",
        "planner",
        "--agent",
        "agent-1",
        "--id",
        "planner-0",
        "--task",
        "task-1",
      ]),
    ).rejects.toThrow("planner recovery requires --id planner-0 and no task or token");

    // Unknown task
    await expect(
      execute([
        "packet",
        "--run",
        run,
        "--role",
        "implementer",
        "--agent",
        "agent-1",
        "--id",
        "pkt-1",
        "--task",
        "non-existent-task",
      ]),
    ).rejects.toThrow("unknown packet task");

    // Claim task so authenticatePacketIdentity succeeds
    const claim = await execute([
      "claim",
      "--run",
      run,
      "--task",
      "task-1",
      "--agent",
      "agent-1",
      "--role",
      "implementer",
    ]);

    // Malformed repository command IDs (empty entry or duplicates)
    await expect(
      execute([
        "packet",
        "--run",
        run,
        "--role",
        "implementer",
        "--agent",
        "agent-1",
        "--token",
        claim.token as string,
        "--id",
        "pkt-1",
        "--task",
        "task-1",
        "--repository-command-ids",
        "cmd-1, ,cmd-2",
      ]),
    ).rejects.toThrow("--repository-command-ids must be duplicate-free");

    await expect(
      execute([
        "packet",
        "--run",
        run,
        "--role",
        "implementer",
        "--agent",
        "agent-1",
        "--token",
        claim.token as string,
        "--id",
        "pkt-1",
        "--task",
        "task-1",
        "--repository-command-ids",
        "cmd-1,cmd-1",
      ]),
    ).rejects.toThrow("--repository-command-ids must be duplicate-free");

    // Completeness critic without repository command IDs throws
    const { workflowPort } = await import("../../../orchestrating-long-tasks/scripts/src/integration/store-ports.ts");
    const { inspectRepositoryBinding } = await import("../../../orchestrating-long-tasks/scripts/src/packets/repository-identity.ts");
    const { createHash } = await import("node:crypto");
    const criticToken = "critic-secret-token";
    const tokenDigest = createHash("sha256").update(criticToken).digest("hex");
    workflowPort(run).transact("critic", "critic-assigned", {}, (draft) => {
      draft.completion_critic = {
        critic_id: "critic-agent",
        token_digest: tokenDigest,
        attempt: 1,
        status: "assigned",
        started_at: new Date().toISOString(),
        deadline_at: new Date(Date.now() + 60000).toISOString(),
        readiness_sha256: "0".repeat(64),
        repository_binding: inspectRepositoryBinding(repo),
      };
    });

    await expect(
      execute([
        "packet",
        "--run",
        run,
        "--role",
        "completeness-critic",
        "--agent",
        "critic-agent",
        "--token",
        criticToken,
        "--id",
        "critic-pkt",
      ]),
    ).rejects.toThrow("completeness critic packet requires --repository-command-ids");
  });

  test("repositoryInspectionCommand validates phase and records inspection", async () => {
    const { run } = await packetFixture();

    await expect(
      execute(["inspect-repository", "--run", run, "--actor", "inspector", "--phase", "invalid-phase"]),
    ).rejects.toThrow("inspection phase must be baseline or current");

    const baseline = await execute([
      "inspect-repository",
      "--run",
      run,
      "--actor",
      "inspector",
      "--phase",
      "baseline",
    ]);
    expect(baseline.run_root).toBe(run);
    expect(baseline.inspection).toBeObject();

    const current = await execute([
      "inspect-repository",
      "--run",
      run,
      "--actor",
      "inspector",
      "--phase",
      "current",
    ]);
    expect(current.run_root).toBe(run);
    expect(current.inspection).toBeObject();
  });
});

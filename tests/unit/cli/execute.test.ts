import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { workflowPort } from "../../../orchestrating-long-tasks/scripts/src/integration/store-ports.ts";
import { orphanEvidenceSha256 } from "../../../orchestrating-long-tasks/scripts/src/workflow/orphan-evidence/digest.ts";
import { cleanupRoots, writeJson } from "./full-lifecycle-fixture.ts";
import { requirementsDocument } from "../requirements/fixtures.ts";
import { graphDocument } from "../graph/fixtures.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

describe("CLI execute dispatcher", () => {
  test("throws on unknown command", async () => {
    await expect(execute(["non-existent-cmd"])).rejects.toThrow("unknown command: non-existent-cmd");
  });

  test("throws when non-run command receives trailing -- remainder arguments", async () => {
    await expect(
      execute(["status", "--run", "some-run", "--", "extra", "args"]),
    ).rejects.toThrow("command status does not accept -- arguments");

    await expect(
      execute(["claim", "--run", "some-run", "--task", "t1", "--agent", "a1", "--role", "implementer", "--", "extra"]),
    ).rejects.toThrow("command claim does not accept -- arguments");
  });

  test("dispatches disposition-orphan command successfully", async () => {
    const repo = await mkdtemp(join(tmpdir(), "harness-exec-disp-"));
    roots.push(repo);
    const prompt = "First\n\nThird";
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
      "disp-run",
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

    const evidence = { task_id: "task-1", reason: "late report" };
    workflowPort(run).transact("worker", "orphan-recorded", {}, (state) => {
      state.orphan_evidence.push(evidence);
    });

    const decisionPath = await writeJson(repo, "decision.json", {
      orphan_sha256: orphanEvidenceSha256(evidence),
      disposition: "ignored_non_authoritative",
      rationale: "Late report superseded",
      evidence: [{ authoritative_task: "task-1" }],
    });

    const result = await execute([
      "disposition-orphan",
      "--run",
      run,
      "--actor",
      "coordinator",
      "--disposition",
      decisionPath,
    ]);
    expect(result.run_root).toBe(run);
    expect(result.disposition).toBeObject();
  });
});

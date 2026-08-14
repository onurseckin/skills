import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { dispositionOrphanEvidenceCommand } from "../../src/cli/commands/orphan-evidence.ts";
import { execute } from "../../src/cli/execute.ts";
import { workflowPort } from "../../src/integration/store-ports.ts";
import { orphanEvidenceSha256 } from "../../src/workflow/orphan-evidence/digest.ts";
import { graphDocument } from "../graph/fixtures.ts";
import { requirementsDocument } from "../requirements/fixtures.ts";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true }))));

async function plannedRun() {
  const repo = await mkdtemp(join(tmpdir(), "harness-orphan-cli-"));
  roots.push(repo);
  const prompt = "First\n\nThird";
  const promptPath = join(repo, "prompt.txt");
  const requirements = requirementsDocument(prompt);
  const requirementsPath = join(repo, "requirements.json");
  const graphPath = join(repo, "graph.json");
  await writeFile(promptPath, prompt);
  await writeFile(requirementsPath, JSON.stringify(requirements));
  await writeFile(graphPath, JSON.stringify(graphDocument(requirements)));
  const initialized = await execute([
    "init",
    "--repo",
    repo,
    "--run-id",
    "orphan-run",
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
  return { run, repo };
}

describe("orphan evidence CLI handler", () => {
  test("reads a structured decision and durably records it without deleting evidence", async () => {
    const { run, repo } = await plannedRun();
    const orphan = { task_id: "task-1", reason: "expired_lease", report_sha256: "late" };
    workflowPort(run).transact("test", "orphan", {}, (draft) => draft.orphan_evidence.push(orphan));
    const sha = orphanEvidenceSha256(orphan);
    const path = join(repo, "disposition.json");
    await writeFile(
      path,
      JSON.stringify({
        orphan_sha256: sha,
        disposition: "ignored_non_authoritative",
        rationale: "late evidence is retained for audit but cannot replace the accepted attempt",
        evidence: [{ authoritative_task: "task-1" }],
      }),
    );
    const result = await dispositionOrphanEvidenceCommand({
      run,
      actor: "coordinator",
      disposition: path,
    });
    expect(result.disposition).toMatchObject({ orphan_sha256: sha });
    const state = workflowPort(run).read();
    expect(state.orphan_evidence).toEqual([orphan]);
    expect(state.orphan_evidence_dispositions).toHaveLength(1);
  });
});

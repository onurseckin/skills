import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../../olt/scripts/src/cli/execute.ts";
import { cleanupRoots, writeJson } from "./full-lifecycle-fixture.ts";
import { graphDocument } from "../graph/fixtures.ts";
import { requirementsDocument } from "../requirements/fixtures.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

describe("plan:claim / plan:apply", () => {
  test("plan:claim issues a planner packet naming the planning write scope", async () => {
    const repo = await mkdtemp(join(tmpdir(), "harness-plan-claim-"));
    roots.push(repo);
    const promptPath = join(repo, "prompt.txt");
    await writeFile(promptPath, "Implement one independently verified change");
    const init = await execute([
      "init",
      "--repo",
      repo,
      "--run-id",
      "claim-run",
      "--prompt-file",
      promptPath,
    ]);
    const run = init.run_root as string;

    const claimed = await execute(["plan:claim", "--run", run, "--agent", "planner-1"]);
    expect(claimed.packet_id).toBeDefined();
    expect(typeof claimed.role_contract_sha256).toBe("string");
  });

  test("plan:apply validates and commits requirements/graph as revision 1, honouring --expected-revision", async () => {
    const repo = await mkdtemp(join(tmpdir(), "harness-plan-apply-"));
    roots.push(repo);
    const prompt = "Implement one independently verified change";
    const promptPath = join(repo, "prompt.txt");
    await writeFile(promptPath, prompt);
    await writeFile(join(repo, "gate-check.ts"), "console.log('gate-ok');\n");
    const requirements = requirementsDocument(prompt);
    const graph = graphDocument(requirements);
    for (const gate of graph.gates as Record<string, unknown>[]) {
      gate.command = ["bun", "gate-check.ts"];
    }
    const requirementsPath = await writeJson(repo, "requirements.json", requirements);
    const graphPath = await writeJson(repo, "graph.json", graph);

    const init = await execute([
      "init",
      "--repo",
      repo,
      "--run-id",
      "apply-run",
      "--prompt-file",
      promptPath,
    ]);
    const run = init.run_root as string;

    const applied = await execute([
      "plan:apply",
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
    expect(applied.revision).toBe(1);
    expect(String(applied.markdown)).toContain("apply-run");
  });

  test("plan:apply refuses a stale --expected-revision", async () => {
    const repo = await mkdtemp(join(tmpdir(), "harness-plan-apply-stale-"));
    roots.push(repo);
    const prompt = "Implement one independently verified change";
    const promptPath = join(repo, "prompt.txt");
    await writeFile(promptPath, prompt);
    await writeFile(join(repo, "gate-check.ts"), "console.log('gate-ok');\n");
    const requirements = requirementsDocument(prompt);
    const graph = graphDocument(requirements);
    for (const gate of graph.gates as Record<string, unknown>[]) {
      gate.command = ["bun", "gate-check.ts"];
    }
    const requirementsPath = await writeJson(repo, "requirements.json", requirements);
    const graphPath = await writeJson(repo, "graph.json", graph);
    const init = await execute([
      "init",
      "--repo",
      repo,
      "--run-id",
      "apply-stale-run",
      "--prompt-file",
      promptPath,
    ]);
    const run = init.run_root as string;

    await expect(
      execute([
        "plan:apply",
        "--run",
        run,
        "--requirements",
        requirementsPath,
        "--graph",
        graphPath,
        "--expected-revision",
        "5",
        "--actor",
        "planner",
      ]),
    ).rejects.toThrow(/graph revision is 0, expected 5/);
  });

  test("plan:apply defaults its paths to planning/requirements.json and planning/graph.json", async () => {
    const repo = await mkdtemp(join(tmpdir(), "harness-plan-apply-default-paths-"));
    roots.push(repo);
    const prompt = "Implement one independently verified change";
    const promptPath = join(repo, "prompt.txt");
    await writeFile(promptPath, prompt);
    await writeFile(join(repo, "gate-check.ts"), "console.log('gate-ok');\n");
    const init = await execute([
      "init",
      "--repo",
      repo,
      "--run-id",
      "apply-default-run",
      "--prompt-file",
      promptPath,
    ]);
    const run = init.run_root as string;
    const requirements = requirementsDocument(prompt);
    const graph = graphDocument(requirements);
    for (const gate of graph.gates as Record<string, unknown>[]) {
      gate.command = ["bun", "gate-check.ts"];
    }
    await mkdir(join(run, "planning"), { recursive: true });
    await writeFile(join(run, "planning", "requirements.json"), JSON.stringify(requirements));
    await writeFile(join(run, "planning", "graph.json"), JSON.stringify(graph));

    const applied = await execute(["plan:apply", "--run", run, "--actor", "planner"]);
    expect(applied.revision).toBe(1);
  });
});

describe("plan:audit", () => {
  test("refuses to audit an empty planning buffer", async () => {
    const repo = await mkdtemp(join(tmpdir(), "harness-plan-audit-empty-"));
    roots.push(repo);
    const promptPath = join(repo, "prompt.txt");
    await writeFile(promptPath, "Do one thing");
    const init = await execute([
      "init",
      "--repo",
      repo,
      "--run-id",
      "audit-empty",
      "--prompt-file",
      promptPath,
    ]);
    await expect(
      execute(["plan:audit", "--run", init.run_root as string, "--actor", "planner"]),
    ).rejects.toThrow(/cannot audit empty planning buffer/);
  });

  test("audits a nonempty buffer and reports findings and revision", async () => {
    const repo = await mkdtemp(join(tmpdir(), "harness-plan-audit-basic-"));
    roots.push(repo);
    const promptPath = join(repo, "prompt.txt");
    await writeFile(promptPath, "Do one thing");
    const init = await execute([
      "init",
      "--repo",
      repo,
      "--run-id",
      "audit-basic",
      "--prompt-file",
      promptPath,
    ]);
    const run = init.run_root as string;
    await execute([
      "plan:add",
      "--run",
      run,
      "--id",
      "task-a",
      "--label",
      "A",
      "--scope",
      "src/a",
      "--gate",
      "bun test src/a",
      "--actor",
      "planner",
    ]);
    const audited = await execute(["plan:audit", "--run", run, "--actor", "planner"]);
    expect(audited.revision).toBe(1);
    expect(Array.isArray(audited.findings)).toBe(true);
    expect(String(audited.markdown)).toContain("audit-basic");
  });

  test("capsulePlanningStore throws INTEGRITY when mutation returns a Promise", async () => {
    const repo = await mkdtemp(join(tmpdir(), "harness-plan-store-async-"));
    roots.push(repo);
    const promptPath = join(repo, "prompt.txt");
    await writeFile(promptPath, "Test prompt");
    const init = await execute([
      "init",
      "--repo",
      repo,
      "--run-id",
      "async-mut-run",
      "--prompt-file",
      promptPath,
    ]);
    const run = init.run_root as string;

    const { capsulePlanningStore } =
      await import("../../../olt/scripts/src/cli/commands/plan-apply.ts");
    const store = capsulePlanningStore(run);
    const loaded = await store.load();
    expect(loaded.prompt).toBeDefined();

    await expect(
      store.transact("planner", "plan-test", {}, async () => {
        await Promise.resolve();
      }),
    ).rejects.toThrow(/plan mutation resolved asynchronously/);
  });
});

describe("Static Invariant Verification: Zero TypeScript any & Zero Suppressions", () => {
  test("verifies plan-claim-apply-audit test file contains zero any and zero suppressions", async () => {
    const testContent = await Bun.file(import.meta.path).text();
    const forbiddenAnyRegex = new RegExp(":[ \\t]*" + "any\\b");
    const forbiddenCastRegex = new RegExp("\\bas[ \\t]+" + "any\\b");
    const forbiddenSuppressionsRegex = new RegExp("@ts-" + "(ignore|expect-error|nocheck)");
    const forbiddenLintRegex = new RegExp("(eslint|oxlint)" + "-disable");

    expect(testContent).not.toMatch(forbiddenAnyRegex);
    expect(testContent).not.toMatch(forbiddenCastRegex);
    expect(testContent).not.toMatch(forbiddenSuppressionsRegex);
    expect(testContent).not.toMatch(forbiddenLintRegex);
  });
});

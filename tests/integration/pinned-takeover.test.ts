import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { graphDocument } from "../graph/fixtures.ts";
import { requirementsDocument } from "../requirements/fixtures.ts";
import { cleanupRoots } from "../cli/full-lifecycle-fixture.ts";

const roots: string[] = [];
const installedEntrypoint = join(import.meta.dir, "..", "..", "orchestrating-long-tasks", "scripts", "harness.ts");
afterEach(async () => cleanupRoots(roots));

async function invoke(argv: string[], cwd?: string): Promise<Record<string, unknown>> {
  const child = Bun.spawn(argv, { cwd, stdout: "pipe", stderr: "pipe" });
  const [exit, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exit !== 0) throw new Error(`command failed ${exit}: ${stderr}`);
  return JSON.parse(stdout).result;
}

async function pathsBelow(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map(async (entry) => {
        const path = join(root, entry.name);
        return entry.isDirectory() ? [path, ...(await pathsBelow(path))] : [path];
      }),
    )
  ).flat();
}

describe("pinned runtime takeover", () => {
  test("moves and resumes an active packetized run using only copied Bun processes", async () => {
    const base = await mkdtemp(join(tmpdir(), "harness-takeover-"));
    roots.push(base);
    const repo = join(base, "original");
    await mkdir(repo);
    const prompt = "First\n\nThird";
    const promptPath = join(repo, "prompt.txt");
    const requirementsPath = join(repo, "requirements.json");
    const graphPath = join(repo, "graph.json");
    const requirements = requirementsDocument(prompt);
    await writeFile(promptPath, prompt);
    await writeFile(requirementsPath, JSON.stringify(requirements));
    await writeFile(graphPath, JSON.stringify(graphDocument(requirements)));

    const initialized = await invoke([
      "bun",
      installedEntrypoint,
      "init",
      "--repo",
      repo,
      "--run-id",
      "takeover-run",
      "--prompt-file",
      promptPath,
      "--capture-mode",
      "file",
      "--source-verified",
    ]);
    const originalRun = initialized.run_root as string;
    await invoke([
      "bun",
      installedEntrypoint,
      "plan-apply",
      "--run",
      originalRun,
      "--requirements",
      requirementsPath,
      "--graph",
      graphPath,
      "--expected-revision",
      "0",
      "--actor",
      "planner",
    ]);
    const claim = await invoke([
      "bun",
      installedEntrypoint,
      "claim",
      "--run",
      originalRun,
      "--task",
      "task-1",
      "--agent",
      "worker",
      "--role",
      "implementer",
    ]);
    await invoke([
      "bun",
      installedEntrypoint,
      "packet",
      "--run",
      originalRun,
      "--task",
      "task-1",
      "--role",
      "implementer",
      "--agent",
      "worker",
      "--token",
      claim.token as string,
      "--id",
      "task-1-implementer-1",
    ]);
    await writeFile(
      join(repo, "submission.json"),
      JSON.stringify({
        summary: "continued after move",
        requirement_ids: ["R-001"],
        files_changed: ["src/area-1"],
        checks: [{ command: "focused", status: "passed" }],
        evidence: [{ kind: "diff", path: "src/area-1" }],
      }),
    );

    const movedRepo = join(base, "moved");
    await rename(repo, movedRepo);
    const movedRun = join(movedRepo, ".capsules", "takeover-run");
    const status = await invoke(["bun", installedEntrypoint, "status", "--run", movedRun], movedRepo);
    expect(status).toMatchObject({
      run_id: "takeover-run",
      graph_revision: 1,
      counts: { leased: 1, proposed: 1 },
    });

    await writeFile(
      join(movedRun, "state.json"),
      '{"event_head":null,"event_sequence":0,"revision":0,"schema":"harness.state","version":1}',
    );
    const recovered = await invoke([
      "bun",
      installedEntrypoint,
      "projection-recover",
      "--run",
      movedRun,
      "--actor",
      "recovery-coordinator",
    ]);
    const recoveredState = recovered.state as { revision: number; event_sequence: number };
    expect(recoveredState.revision).toBeGreaterThan(5);
    expect(recoveredState.event_sequence).toBe(recoveredState.revision);
    const submitted = await invoke([
      "bun",
      installedEntrypoint,
      "submit",
      "--run",
      movedRun,
      "--task",
      "task-1",
      "--agent",
      "worker",
      "--token",
      claim.token as string,
      "--report",
      join(movedRepo, "submission.json"),
    ]);
    expect(submitted.task).toMatchObject({ status: "submitted" });
  });
});

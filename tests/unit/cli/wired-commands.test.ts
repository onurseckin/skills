import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";

const roots: string[] = [];
const skillRoot = join(import.meta.dir, "..", "..", "..", "orchestrating-long-tasks");

afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

async function compiledCapsule(name: string): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), `harness-${name}-`));
  roots.push(repo);
  const prompt = join(repo, "prompt.txt");
  await writeFile(prompt, "Build the thing.\nCover the thing with tests.\n");
  const init = await execute([
    "plan:init",
    "--repo",
    repo,
    "--run-id",
    name,
    "--prompt-file",
    prompt,
  ]);
  const run = String(init.run_root);
  await execute([
    "plan:add",
    "--run",
    run,
    "--id",
    "task-1",
    "--label",
    "Thing",
    "--scope",
    "src",
    "--gate",
    "bun test tests/unit/thing.test.ts",
    "--actor",
    "coordinator",
  ]);
  await execute([
    "plan:compile",
    "--run",
    run,
    "--actor",
    "planner",
    "--completion-gate",
    "bun test tests",
  ]);
  return run;
}

describe("doctor", () => {
  test("reports the runtime, integrity and workflow blockers of a live capsule", async () => {
    const run = await compiledCapsule("doctor-run");
    const report = await execute(["doctor", "--run", run]);
    expect(report.run_root).toBe(run);
    expect(report.bun_supported).toBeTrue();
    expect(report.integrity_issues).toEqual([]);
    expect(report.issues).toContain("task task-1 is ready, not done");
    expect(String(report.markdown)).toContain("### Capsule Doctor");
  });
});

describe("recover", () => {
  test("releases an expired lease and reports what it released", async () => {
    const run = await compiledCapsule("recover-run");
    await execute([
      "task:claim",
      "--run",
      run,
      "--task",
      "task-1",
      "--agent",
      "worker-1",
      "--role",
      "implementer",
      "--lease-seconds",
      "5",
    ]);
    await Bun.sleep(5_500);

    const recovered = await execute([
      "recover",
      "--run",
      run,
      "--actor",
      "coordinator",
      "--grace-seconds",
      "0",
    ]);
    expect(recovered.recovered).toEqual(["task-1"]);
    expect(String(recovered.markdown)).toContain("**Leases Released**: 1");

    const queue = await execute(["queue:list", "--run", run]);
    expect(queue.partitions).toMatchObject({ ready: ["task-1"], leased: [] });
  }, 15_000);

  test("reports nothing to release while the lease is live", async () => {
    const run = await compiledCapsule("recover-live");
    await execute([
      "task:claim",
      "--run",
      run,
      "--task",
      "task-1",
      "--agent",
      "worker-1",
      "--role",
      "implementer",
      "--lease-seconds",
      "600",
    ]);
    const recovered = await execute(["recover", "--run", run, "--actor", "coordinator"]);
    expect(recovered.recovered).toEqual([]);
  });
});

describe("installation-status", () => {
  test("reports an untouched home as not installed", async () => {
    const home = await mkdtemp(join(tmpdir(), "harness-home-"));
    roots.push(home);
    const status = await execute(["installation-status", "--source", skillRoot, "--home", home]);
    expect(status.installed).toBeFalse();
    expect(status.drifted).toBeTrue();
    expect(status.issues).toContain("not installed");
    expect(String(status.destination)).toContain(join(".agents", "skills"));
  });
});

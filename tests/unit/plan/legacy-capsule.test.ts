import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, statSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { loadRun } from "../../../orchestrating-long-tasks/scripts/src/store/index.ts";

const SHIPPED_CAPSULE = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  ".capsules",
  "2026-08-17-skills-documentation-elevation",
);

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

describe("capsules that predate the planning directory", () => {
  test("plan:enhance creates planning/ when the capsule was initialised without it", async () => {
    const repo = await mkdtemp(join(tmpdir(), "harness-legacy-planning-"));
    roots.push(repo);
    const promptPath = join(repo, "prompt.txt");
    await writeFile(promptPath, "Rebuild the drawer");
    const init = await execute([
      "plan:init",
      "--repo",
      repo,
      "--run",
      "legacy-run",
      "--prompt-file",
      promptPath,
    ]);
    const run = init.run_root as string;
    await rm(join(run, "planning"), { recursive: true });

    await execute([
      "plan:enhance",
      "--run",
      run,
      "--actor",
      "planner",
      "--todo",
      "Read the store before touching it",
    ]);

    expect(statSync(join(run, "planning", "enhanced-plan.md")).isFile()).toBeTrue();
  });

  // The capsule is a working artifact rather than a checked-in fixture, so the proof runs where it
  // exists instead of asserting a path that a fresh clone would not have.
  test.if(existsSync(SHIPPED_CAPSULE))(
    "an existing capsule still loads with every new state key absent",
    () => {
      const loaded = loadRun(SHIPPED_CAPSULE);

      expect(loaded.manifest.run_id).toBe("2026-08-17-skills-documentation-elevation");
      expect(loaded.state.schema).toBe("harness.state");
      expect(loaded.state.planning).toBeUndefined();
      expect(loaded.state.topology).toBeUndefined();
      const requirements = loaded.state.requirements as { prompt_sha256: string };
      expect(requirements.prompt_sha256).toBe(loaded.manifest.prompt_sha256);
    },
  );
});

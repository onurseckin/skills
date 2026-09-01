import { afterEach, describe, expect, test } from "bun:test";
import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync, realpathSync } from "node:fs";
import {
  executePlanBrainstorm,
  resolveBrainstormRunRoot,
  type PlanBrainstormOutput,
} from "../../../../../olt/scripts/src/cli/commands/plan-brainstorm.ts";
import { HarnessError } from "../../../../../olt/scripts/src/core/errors/index.ts";
import { cleanupRoots } from "../../fixtures/full-lifecycle-fixture.ts";
import { freshRun } from "../../fixtures/plan-workflow-fixture.ts";

async function withIsolatedCwd<T>(dir: string, fn: () => T): Promise<T> {
  const originalCwd = process.cwd();
  process.chdir(dir);
  try {
    return fn();
  } finally {
    process.chdir(originalCwd);
  }
}

const roots: string[] = [];
afterEach(async () => {
  await cleanupRoots(roots);
  while (roots.length > 0) {
    const dir = roots.pop();
    if (dir && existsSync(dir)) {
      try {
        await rm(dir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }
});

describe("plan:brainstorm CLI command and executePlanBrainstorm - Root Resolution", () => {
  test("persists a brainstorming result only in a verified capsule and appends one canonical event", async () => {
    const { run } = await freshRun("brainstorm-persist", roots, [
      "Implement deterministic DAG wave scheduler",
      "Handle atomic lease timeouts and worker heartbeat",
    ]);

    const output: PlanBrainstormOutput = executePlanBrainstorm({
      runRoot: run,
      rounds: 2,
      save: true,
      actor: "planner-test",
    });

    expect(output.success).toBe(true);
    expect(output.roundsExecuted).toBe(2);
    expect(output.totalExpandedItems).toBe(32);
    expect(output.result.expandedItems.length).toBe(32);
    expect(output.result.vectors.length).toBe(8);
    expect(output.markdown).toContain("Socratic 8-Vector Brainstorming Matrix");
    expect(output.markdown).toContain("EMPTY_PAYLOAD");
    expect(output.markdown).toContain("TIMEOUT_STAGNATION");

    const brainstormingFile = join(run, "brainstorming.json");
    expect(existsSync(brainstormingFile)).toBe(true);
    const parsedJson = JSON.parse(await readFile(brainstormingFile, "utf-8")) as {
      schema: string;
      version: number;
      rounds: number;
      total_expanded_items: number;
      vectors: unknown[];
      expandedItems?: unknown;
    };
    expect(parsedJson.schema).toBe("harness.brainstorming");
    expect(parsedJson.version).toBe(1);
    expect(parsedJson.rounds).toBe(2);
    expect(parsedJson.total_expanded_items).toBe(32);
    expect(parsedJson.vectors.length).toBe(8);
    expect(parsedJson.expandedItems).toBeUndefined();

    const eventsFile = join(run, "events.jsonl");
    expect(existsSync(eventsFile)).toBe(true);
    const eventsContent = await readFile(eventsFile, "utf-8");
    expect(eventsContent.match(/"kind":"plan-brainstormed"/g)).toHaveLength(1);
    expect(eventsContent).toContain("planner-test");
  });

  test("resolveBrainstormRunRoot resolves a bare run name under the given repo's .olt/capsules/, never repoRoot itself", () => {
    const repoRoot = "/fixture/repo";
    expect(resolveBrainstormRunRoot("host-parity-hygiene-r2", repoRoot)).toBe(
      join(repoRoot, ".olt", "capsules", "host-parity-hygiene-r2"),
    );
    expect(resolveBrainstormRunRoot("host-parity-hygiene-r2", repoRoot)).not.toBe(
      join(repoRoot, "host-parity-hygiene-r2"),
    );
  });

  test("resolveBrainstormRunRoot honours an explicit absolute path unchanged", () => {
    expect(resolveBrainstormRunRoot("/some/absolute/run/root")).toBe("/some/absolute/run/root");
  });

  test("rejects traversal and separator aliases before any capsule lookup", () => {
    for (const alias of ["..", "./run", "nested/run", "nested\\run", "/tmp/../outside"]) {
      expect(() => resolveBrainstormRunRoot(alias)).toThrow(HarnessError);
    }
  });

  test("a nonexistent bare --run name creates nothing outside or inside canonical capsules", async () => {
    const fakeRepo = realpathSync(await mkdtemp(join(tmpdir(), "brainstorm-escape-repo-")));
    roots.push(fakeRepo);
    await writeFile(join(fakeRepo, "package.json"), "{}", "utf-8");

    await expect(
      withIsolatedCwd(fakeRepo, () =>
        executePlanBrainstorm({
          run: "olt-falsifier-probe",
          prompt: "A prompt must not bootstrap a capsule",
          save: true,
          actor: "planner-escape-test",
        }),
      ),
    ).rejects.toBeInstanceOf(HarnessError);

    const strayPath = join(fakeRepo, "olt-falsifier-probe");
    const canonicalPath = join(fakeRepo, ".olt", "capsules", "olt-falsifier-probe");
    expect(existsSync(strayPath)).toBe(false);
    expect(existsSync(canonicalPath)).toBe(false);
  });

  test("an initialized bare run ID resolves only through its canonical capsule root", async () => {
    const { repo } = await freshRun("brainstorm-bare-canonical", roots, ["Canonical prompt"]);
    const output = await withIsolatedCwd(repo, () =>
      executePlanBrainstorm({ run: "brainstorm-bare-canonical", prompt: "Canonical prompt" }),
    );
    expect(output.run_root).toBe(
      realpathSync(join(repo, ".olt", "capsules", "brainstorm-bare-canonical")),
    );
    expect(existsSync(join(repo, "brainstorm-bare-canonical"))).toBe(false);
  });

  test("absolute and separator run paths that are not capsules leave their existing bytes untouched", async () => {
    const root = await mkdtemp(join(tmpdir(), "brainstorm-noncapsule-"));
    roots.push(root);
    const nested = join(root, "nested", "not-a-capsule");
    await mkdir(join(root, "nested"));
    await writeFile(nested, "sentinel", "utf-8");

    expect(() => executePlanBrainstorm({ runRoot: nested, prompt: "Valid prompt" })).toThrow(
      HarnessError,
    );
    expect(await readFile(nested, "utf-8")).toBe("sentinel");
  });

  test("a runRoot that is itself a stray non-capsule absolute path is rejected without creating it", async () => {
    const fakeRepo = await mkdtemp(join(tmpdir(), "brainstorm-explicit-path-"));
    roots.push(fakeRepo);
    const explicitRunRoot = join(fakeRepo, "any", "nested", "path");

    expect(() =>
      executePlanBrainstorm({
        runRoot: explicitRunRoot,
        prompt: "Single requirement line",
        save: true,
      }),
    ).toThrow(HarnessError);
    expect(existsSync(explicitRunRoot)).toBe(false);
  });

  test("refuses symlinked and hard-linked brainstorming targets without changing sentinels", async () => {
    const { run } = await freshRun("brainstorm-target-links", roots);
    const target = join(run, "brainstorming.json");
    const sentinel = join(run, "sentinel.json");
    await writeFile(sentinel, "sentinel", "utf-8");

    await symlink(sentinel, target);
    expect(() => executePlanBrainstorm({ runRoot: run, prompt: "Valid prompt" })).toThrow(
      HarnessError,
    );
    expect(await readFile(sentinel, "utf-8")).toBe("sentinel");
    await rm(target);

    await link(sentinel, target);
    expect(() => executePlanBrainstorm({ runRoot: run, prompt: "Valid prompt" })).toThrow(
      HarnessError,
    );
    expect(await readFile(sentinel, "utf-8")).toBe("sentinel");
  });
});

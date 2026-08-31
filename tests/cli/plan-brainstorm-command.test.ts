import { afterEach, describe, expect, test } from "bun:test";
import { link, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync, realpathSync } from "node:fs";
import { execute } from "../../olt/scripts/src/cli/execute.ts";
import {
  executePlanBrainstorm,
  resolveBrainstormRunRoot,
  type PlanBrainstormOutput,
} from "../../olt/scripts/src/cli/commands/plan-brainstorm.ts";
import { HarnessError } from "../../olt/scripts/src/core/errors/index.ts";
import { loadRun } from "../../olt/scripts/src/engine/store/index.ts";
import { transact } from "../../olt/scripts/src/engine/store/index.ts";
import { cleanupRoots } from "./full-lifecycle-fixture.ts";
import { freshRun } from "./plan-workflow-fixture.ts";

// Runs `fn` with process.cwd() pointed at an isolated tmpdir with no .git/.olt/package.json
// ancestry, so findRepoRoot() resolves to that tmpdir itself rather than this repo -- a bug in
// the bare-name resolver under test can never touch this repo's real .olt/capsules/.
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

describe("plan:brainstorm CLI command and executePlanBrainstorm", () => {
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
    // 2 requirement lines * 8 vectors * 2 rounds = 32 expanded items
    expect(output.totalExpandedItems).toBe(32);
    expect(output.result.expandedItems.length).toBe(32);
    expect(output.result.vectors.length).toBe(8);
    expect(output.markdown).toContain("Socratic 8-Vector Brainstorming Matrix");
    expect(output.markdown).toContain("EMPTY_PAYLOAD");
    expect(output.markdown).toContain("TIMEOUT_STAGNATION");

    // Check brainstorming.json: expandedItems is not persisted (unbounded, multiplicative in
    // rounds); totalExpandedItems and the 8 vectors are kept.
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

    // Check events.jsonl
    const eventsFile = join(run, "events.jsonl");
    expect(existsSync(eventsFile)).toBe(true);
    const eventsContent = await readFile(eventsFile, "utf-8");
    expect(eventsContent.match(/\"kind\":\"plan-brainstormed\"/g)).toHaveLength(1);
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
    // realpathSync: process.cwd() reports the resolved path after chdir on macOS, where
    // mkdtemp's /var/folders/... is itself a symlink to /private/var/folders/....
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

  test("rejects symlinked capsule roots and unsafe manifest or state files before persistence", async () => {
    const { run } = await freshRun("brainstorm-unsafe-capsule", roots);
    const moved = `${run}-moved`;
    await rename(run, moved);
    await symlink(moved, run);
    expect(() => executePlanBrainstorm({ runRoot: run, prompt: "Valid prompt" })).toThrow(
      HarnessError,
    );

    const { run: manifestRun } = await freshRun("brainstorm-hardlink-manifest", roots);
    const manifest = join(manifestRun, "manifest.json");
    const manifestSentinel = join(manifestRun, "manifest-sentinel.json");
    await writeFile(manifestSentinel, "sentinel", "utf-8");
    await rm(manifest);
    await link(manifestSentinel, manifest);
    expect(() => executePlanBrainstorm({ runRoot: manifestRun, prompt: "Valid prompt" })).toThrow(
      HarnessError,
    );
    expect(await readFile(manifestSentinel, "utf-8")).toBe("sentinel");

    const { run: stateRun } = await freshRun("brainstorm-nonfile-state", roots);
    await rm(join(stateRun, "state.json"));
    await mkdir(join(stateRun, "state.json"));
    expect(() => executePlanBrainstorm({ runRoot: stateRun, prompt: "Valid prompt" })).toThrow(
      HarnessError,
    );
    expect(existsSync(join(stateRun, "brainstorming.json"))).toBe(false);
  });

  test("persists before a rejected transaction without appending a fallback event", async () => {
    const { run } = await freshRun("brainstorm-terminal-transaction", roots);
    transact(run, "test-setup", "complete-run", {}, (state) => {
      state.completion_result = { status: "complete" };
    });
    const eventsPath = join(run, "events.jsonl");
    const eventsBefore = await readFile(eventsPath, "utf-8");

    expect(() => executePlanBrainstorm({ runRoot: run, prompt: "Valid prompt" })).toThrow(
      "completed runs are terminal",
    );
    expect(await readFile(eventsPath, "utf-8")).toBe(eventsBefore);
    expect(existsSync(join(run, "brainstorming.json"))).toBe(false);
  });

  test("rejects a reused brainstorming request key whose actor authority identity differs", async () => {
    const { run } = await freshRun("brainstorm-request-key-collision", roots, ["Same prompt"]);
    executePlanBrainstorm({ runRoot: run, prompt: "Same prompt", actor: "planner-a" });
    const eventsBefore = await readFile(join(run, "events.jsonl"), "utf8");
    expect(() =>
      executePlanBrainstorm({ runRoot: run, prompt: "Same prompt", actor: "planner-b" }),
    ).toThrow(/request_key collision does not match authoritative identity/);
    expect(await readFile(join(run, "events.jsonl"), "utf8")).toBe(eventsBefore);
  });

  test("CLI execute('plan:brainstorm') on full capsule run updates capsule state and outputs markdown", async () => {
    const { run } = await freshRun("brainstorm-capsule", roots, [
      "Add strict typeguard checks for payload deserialization",
      "Emit actionable diagnostic telemetry on gate rejection",
    ]);

    const result = await execute([
      "plan:brainstorm",
      "--run",
      run,
      "--rounds",
      "3",
      "--actor",
      "planner-1",
    ]);

    expect(result.success).toBe(true);
    expect(result.roundsExecuted).toBe(3);
    // 2 prompt lines * 8 vectors * 3 rounds = 48 items
    expect(result.totalExpandedItems).toBe(48);
    expect(typeof result.markdown).toBe("string");
    expect(String(result.markdown)).toContain("Socratic 8-Vector Brainstorming Matrix");

    // Verify brainstorming.json in capsule root
    const jsonPath = join(run, "brainstorming.json");
    expect(existsSync(jsonPath)).toBe(true);

    // Verify capsule store state updated with planning.brainstorming
    const loaded = loadRun(run);
    const state = loaded.state;
    const planning = state.planning as
      | { brainstorming?: { rounds: number; total_expanded_items: number } }
      | undefined;
    expect(planning?.brainstorming).toBeDefined();
    expect(planning?.brainstorming?.rounds).toBe(3);
    expect(planning?.brainstorming?.total_expanded_items).toBe(48);
    expect(loaded.events.filter((event) => event.kind === "plan-brainstormed")).toHaveLength(1);
  });

  test("repairs a deleted derived artifact for an identical request without appending another event", async () => {
    const { run } = await freshRun("brainstorm-idempotent-repair", roots, ["Same request"]);
    executePlanBrainstorm({ runRoot: run, prompt: "Same request" });
    const artifact = join(run, "brainstorming.json");
    await rm(artifact);
    const retried = executePlanBrainstorm({ runRoot: run, prompt: "Same request" });
    expect(retried.success).toBe(true);
    expect(existsSync(artifact)).toBe(true);
    expect(loadRun(run).events.filter((event) => event.kind === "plan-brainstormed")).toHaveLength(
      1,
    );
  });

  test("synchronized identical requests create exactly one event and one valid derived artifact", async () => {
    const { run } = await freshRun("brainstorm-identical-concurrent", roots, ["Same request"]);
    await Promise.all([
      Promise.resolve().then(() => executePlanBrainstorm({ runRoot: run, prompt: "Same request" })),
      Promise.resolve().then(() => executePlanBrainstorm({ runRoot: run, prompt: "Same request" })),
    ]);
    const loaded = loadRun(run);
    expect(loaded.events.filter((event) => event.kind === "plan-brainstormed")).toHaveLength(1);
    expect(JSON.parse(await readFile(join(run, "brainstorming.json"), "utf8"))).toEqual(
      (loaded.state.planning as { brainstorming: object }).brainstorming,
    );
  });

  test("synchronized different requests create two events and materialize the final canonical state", async () => {
    const { run } = await freshRun("brainstorm-different-concurrent", roots, ["First request"]);
    await Promise.all([
      Promise.resolve().then(() =>
        executePlanBrainstorm({ runRoot: run, prompt: "First request" }),
      ),
      Promise.resolve().then(() =>
        executePlanBrainstorm({ runRoot: run, prompt: "Second request" }),
      ),
    ]);
    const loaded = loadRun(run);
    expect(loaded.events.filter((event) => event.kind === "plan-brainstormed")).toHaveLength(2);
    expect(JSON.parse(await readFile(join(run, "brainstorming.json"), "utf8"))).toEqual(
      (loaded.state.planning as { brainstorming: object }).brainstorming,
    );
  });

  test("executePlanBrainstorm with explicit prompt string and save=false", () => {
    const prompt = "Implement resilient distributed lock with TTL renewal";
    const output = executePlanBrainstorm({
      prompt,
      rounds: 1,
      save: false,
    });

    expect(output.success).toBe(true);
    expect(output.roundsExecuted).toBe(1);
    // 1 prompt line * 8 vectors * 1 round = 8 items
    expect(output.totalExpandedItems).toBe(8);
    expect(output.result.expandedItems.length).toBe(8);
    expect(output.markdown).toContain("CONCURRENCY_MUTATION");
  });

  test("prompt-only brainstorming performs no durable filesystem operation", async () => {
    const root = await mkdtemp(join(tmpdir(), "brainstorm-prompt-only-"));
    roots.push(root);
    const output = executePlanBrainstorm({ prompt: "In-memory only" });
    expect(output.success).toBe(true);
    expect(existsSync(join(root, "brainstorming.json"))).toBe(false);
  });

  test("throws HarnessError INVALID_ARGUMENT when neither run nor prompt is provided", () => {
    expect(() => {
      executePlanBrainstorm({});
    }).toThrow(HarnessError);

    try {
      executePlanBrainstorm({});
    } catch (err: unknown) {
      expect(err instanceof HarnessError).toBe(true);
      if (err instanceof HarnessError) {
        expect(err.code).toBe("INVALID_ARGUMENT");
      }
    }
  });

  test("clamps non-positive rounds to minimum 1 round", () => {
    const output = executePlanBrainstorm({
      prompt: "Single test requirement line",
      rounds: 0,
      save: false,
    });

    expect(output.roundsExecuted).toBe(1);
    expect(output.totalExpandedItems).toBe(8);
  });

  test("executePlanBrainstorm parses string array tokens against a verified capsule", async () => {
    const { run } = await freshRun("brainstorm-token-input", roots, [
      "Single prompt fallback line",
    ]);

    const outputFromTokens = executePlanBrainstorm(["--run", run, "--rounds", "1"]);
    expect(outputFromTokens.success).toBe(true);
    expect(outputFromTokens.roundsExecuted).toBe(1);

    const outputPromptTokens = executePlanBrainstorm([
      "plan:brainstorm",
      "--prompt",
      "Direct CLI prompt argument",
      "--save",
      "false",
    ]);
    expect(outputPromptTokens.success).toBe(true);
    expect(outputPromptTokens.roundsExecuted).toBe(3);

    const outputFlagsWithRunId = executePlanBrainstorm({
      "run-id": run,
      rounds: "2",
      actor: "custom-planner",
    });
    expect(outputFlagsWithRunId.success).toBe(true);
    expect(outputFlagsWithRunId.roundsExecuted).toBe(2);
  });

  test("throws HarnessError when an invalid run cannot be verified before persistence", () => {
    expect(() => {
      executePlanBrainstorm({
        runRoot: "/dev/null/impossible/path",
        prompt: "Valid prompt",
        save: true,
      });
    }).toThrow(HarnessError);
  });
});

describe("Static Invariant Verification: Zero TypeScript any & Zero Suppressions", () => {
  test("verifies plan-brainstorm-command test file contains zero any and zero suppressions", async () => {
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

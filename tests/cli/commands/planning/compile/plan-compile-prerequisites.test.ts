import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execute } from "../../../../../olt/scripts/src/cli/execute.ts";
import { HarnessError } from "../../../../../olt/scripts/src/core/errors/index.ts";
import { canonicalJsonBytes, sha256Bytes } from "../../../../../olt/scripts/src/core/json.ts";
import {
  BRAINSTORMING_SCHEMA,
  BRAINSTORMING_VERSION,
} from "../../../../../olt/scripts/src/engine/store/projections/materialized-projections.ts";
import { transact } from "../../../../../olt/scripts/src/engine/store/index.ts";
import { cleanupVirtualCliFS, setupVirtualCliFS } from "../../fixtures/full-lifecycle-fixture.ts";

const roots: string[] = [];

async function createTestRun(
  prefix: string,
  promptText = "Build an edge-case aware service",
): Promise<{ repo: string; run: string }> {
  const repo = `/virtual/cli/${prefix}-${Math.random().toString(36).slice(2)}`;
  roots.push(repo);
  await mkdir(join(repo, ".git"), { recursive: true });
  const promptPath = join(repo, "prompt.txt");
  await writeFile(promptPath, promptText, "utf-8");
  const init = await execute([
    "plan:init",
    "--repo",
    repo,
    "--run-id",
    "test-run",
    "--prompt-file",
    promptPath,
  ]);
  const run = init.run_root as string;
  return { repo, run };
}

describe("plan:compile prerequisites", () => {
  beforeEach(() => {
    setupVirtualCliFS();
  });

  afterEach(() => {
    cleanupVirtualCliFS();
    roots.length = 0;
  });

  test("throws INVALID_STATE / MANDATORY_PLAN_STEP_SKIPPED when plan:brainstorm was not executed", async () => {
    const { run } = await createTestRun("harness-plan-compile-nobrainstorm-");

    try {
      await execute([
        "plan:compile",
        "--run",
        run,
        "--actor",
        "planner",
        "--completion-gate",
        "bun test tests",
      ]);
      expect.unreachable("plan:compile should have thrown HarnessError");
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(HarnessError);
      const harnessErr = err as HarnessError;
      expect(harnessErr.code).toBe("INVALID_STATE");
      expect(harnessErr.message).toContain(
        "[MANDATORY_PLAN_STEP_SKIPPED] Cannot compile plan: plan:brainstorm must be executed first.",
      );
    }
  });

  test("succeeds when plan:brainstorm is executed first", async () => {
    const { run } = await createTestRun("harness-plan-compile-withbrainstorm-");

    const brainstormResult = await execute(["plan:brainstorm", "--run", run, "--rounds", "1"]);
    expect(brainstormResult.success).toBe(true);

    const compileResult = await execute([
      "plan:compile",
      "--run",
      run,
      "--actor",
      "planner",
      "--completion-gate",
      "bun test tests",
    ]);
    expect(compileResult.total_tasks).toBe(0);
    expect(compileResult.revision).toBe(1);
  });

  test("succeeds when brainstorming.json is directly present in the run root", async () => {
    const { run } = await createTestRun("harness-plan-compile-jsonfile-");

    await writeFile(
      join(run, "brainstorming.json"),
      JSON.stringify({ roundsExecuted: 1, totalExpandedItems: 8 }),
      "utf-8",
    );

    const compileResult = await execute([
      "plan:compile",
      "--run",
      run,
      "--actor",
      "planner",
      "--completion-gate",
      "bun test tests",
    ]);
    expect(compileResult.total_tasks).toBe(0);
    expect(compileResult.revision).toBe(1);
  });

  test("succeeds when plan-brainstormed event is recorded in state/events", async () => {
    const { run } = await createTestRun("harness-plan-compile-event-");

    transact(run, "planner", "plan-brainstormed", { rounds: 1 }, () => {});

    const compileResult = await execute([
      "plan:compile",
      "--run",
      run,
      "--actor",
      "planner",
      "--completion-gate",
      "bun test tests",
    ]);
    expect(compileResult.total_tasks).toBe(0);
    expect(compileResult.revision).toBe(1);
  });

  test("succeeds when state.planning.brainstorming is set", async () => {
    const { run } = await createTestRun("harness-plan-compile-state-");

    const body = {
      schema: BRAINSTORMING_SCHEMA,
      version: BRAINSTORMING_VERSION,
      rounds: 2,
      total_expanded_items: 16,
    };
    const artifact_sha256 = sha256Bytes(canonicalJsonBytes(body));

    transact(run, "planner", "test-seeded", {}, (state) => {
      state.planning = {
        brainstorming: {
          ...body,
          artifact_sha256,
        },
      };
    });

    const compileResult = await execute([
      "plan:compile",
      "--run",
      run,
      "--actor",
      "planner",
      "--completion-gate",
      "bun test tests",
    ]);
    expect(compileResult.total_tasks).toBe(0);
    expect(compileResult.revision).toBe(1);
  });

  test("succeeds when state.brainstorming is set directly on state", async () => {
    const { run } = await createTestRun("harness-plan-compile-direct-state-");

    transact(run, "planner", "test-direct", {}, (state) => {
      (state as Record<string, unknown>).brainstorming = { rounds: 1 };
    });

    const compileResult = await execute([
      "plan:compile",
      "--run",
      run,
      "--actor",
      "planner",
      "--completion-gate",
      "bun test tests",
    ]);
    expect(compileResult.total_tasks).toBe(0);
  });

  test("succeeds when state.events has type or event matching plan-brainstormed", async () => {
    const { run } = await createTestRun("harness-plan-compile-evt-variants-");

    transact(run, "planner", "test-evt", {}, (state) => {
      (state as Record<string, unknown>).events = [
        { type: "plan-brainstormed" },
        { event: "plan-brainstormed" },
      ];
    });

    const compileResult = await execute([
      "plan:compile",
      "--run",
      run,
      "--actor",
      "planner",
      "--completion-gate",
      "bun test tests",
    ]);
    expect(compileResult.total_tasks).toBe(0);
  });

  test("succeeds when .olt/brainstorming.json is present", async () => {
    const { run } = await createTestRun("harness-plan-compile-dot-olt-json-");
    await mkdir(join(run, ".olt"), { recursive: true });
    await writeFile(join(run, ".olt", "brainstorming.json"), "{}", "utf-8");

    const compileResult = await execute([
      "plan:compile",
      "--run",
      run,
      "--actor",
      "planner",
      "--completion-gate",
      "bun test tests",
    ]);
    expect(compileResult.total_tasks).toBe(0);
  });
});

describe("Static Invariant Verification: Zero TypeScript any & Zero Suppressions", () => {
  test("verifies plan-compile-prerequisites test file contains zero any and zero suppressions", async () => {
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

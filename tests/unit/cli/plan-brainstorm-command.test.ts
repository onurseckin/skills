import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { execute } from "../../../olt/scripts/src/cli/execute.ts";
import {
  executePlanBrainstorm,
  type PlanBrainstormOutput,
} from "../../../olt/scripts/src/cli/commands/plan-brainstorm.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";
import { loadRun } from "../../../olt/scripts/src/engine/store/index.ts";
import { cleanupRoots } from "./full-lifecycle-fixture.ts";
import { freshRun } from "./plan-workflow-fixture.ts";

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
  test("executePlanBrainstorm with temp dir creates brainstorming.json and appends event", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "brainstorm-temp-"));
    roots.push(tempDir);

    const promptText = [
      "# High-Performance Task Engine",
      "- Implement deterministic DAG wave scheduler",
      "- Handle atomic lease timeouts and worker heartbeat",
    ].join("\n");

    await writeFile(join(tempDir, "prompt.md"), promptText, "utf-8");

    const output: PlanBrainstormOutput = executePlanBrainstorm({
      runRoot: tempDir,
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

    // Check brainstorming.json
    const brainstormingFile = join(tempDir, "brainstorming.json");
    expect(existsSync(brainstormingFile)).toBe(true);
    const parsedJson = JSON.parse(await readFile(brainstormingFile, "utf-8")) as {
      roundsExecuted: number;
      totalExpandedItems: number;
      expandedItems: unknown[];
    };
    expect(parsedJson.roundsExecuted).toBe(2);
    expect(parsedJson.totalExpandedItems).toBe(32);
    expect(parsedJson.expandedItems.length).toBe(32);

    // Check events.jsonl
    const eventsFile = join(tempDir, "events.jsonl");
    expect(existsSync(eventsFile)).toBe(true);
    const eventsContent = await readFile(eventsFile, "utf-8");
    expect(eventsContent).toContain("plan-brainstormed");
    expect(eventsContent).toContain("planner-test");
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

  test("executePlanBrainstorm parses string array tokens and handles prompt.txt fallback", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "brainstorm-txt-"));
    roots.push(tempDir);

    await writeFile(join(tempDir, "prompt.txt"), "Single prompt.txt fallback line", "utf-8");

    const outputFromTokens = executePlanBrainstorm(["--run", tempDir, "--rounds", "1"]);
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
      "run-id": tempDir,
      rounds: "2",
      actor: "custom-planner",
    });
    expect(outputFlagsWithRunId.success).toBe(true);
    expect(outputFlagsWithRunId.roundsExecuted).toBe(2);
  });

  test("throws HarnessError INVALID_ARGUMENT when writing brainstorming.json fails", () => {
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

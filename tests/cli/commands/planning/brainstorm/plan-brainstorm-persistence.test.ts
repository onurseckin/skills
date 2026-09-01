import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { link, mkdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { execute } from "../../../../../olt/scripts/src/cli/execute.ts";
import { executePlanBrainstorm } from "../../../../../olt/scripts/src/cli/commands/plan-brainstorm.ts";
import { HarnessError } from "../../../../../olt/scripts/src/core/errors/index.ts";
import { loadRun, transact } from "../../../../../olt/scripts/src/engine/store/index.ts";
import { cleanupVirtualCliFS, setupVirtualCliFS } from "../../fixtures/full-lifecycle-fixture.ts";
import { freshRun } from "../../fixtures/plan-workflow-fixture.ts";

const roots: string[] = [];

describe("plan:brainstorm - Capsule Persistence & Invariants", () => {
  beforeEach(() => {
    setupVirtualCliFS();
  });

  afterEach(() => {
    cleanupVirtualCliFS();
    roots.length = 0;
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
    expect(result.totalExpandedItems).toBe(48);
    expect(typeof result.markdown).toBe("string");
    expect(String(result.markdown)).toContain("Socratic 8-Vector Brainstorming Matrix");

    const jsonPath = join(run, "brainstorming.json");
    expect(existsSync(jsonPath)).toBe(true);

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
    expect(output.totalExpandedItems).toBe(8);
    expect(output.result.expandedItems.length).toBe(8);
    expect(output.markdown).toContain("CONCURRENCY_MUTATION");
  });

  test("prompt-only brainstorming performs no durable filesystem operation", async () => {
    const root = `/virtual/cli/brainstorm-prompt-only-${Math.random().toString(36).slice(2)}`;
    roots.push(root);
    await mkdir(root, { recursive: true });
    const output = executePlanBrainstorm({ prompt: "In-memory only" });
    expect(output.success).toBe(true);
    expect(existsSync(join(root, "brainstorming.json"))).toBe(false);
  });

  test("throws HarnessError INVALID_ARGUMENT when neither run nor prompt is provided", () => {
    expect(() => {
      executePlanBrainstorm({});
    }).toThrow(HarnessError);
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

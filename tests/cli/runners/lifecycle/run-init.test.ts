import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runInitCommand } from "../../../../olt/scripts/src/cli/commands/run-init.ts";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";

describe("run:init CLI command", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `run-init-cli-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  test("throws INVALID_ARGUMENT when neither --run nor --run-id is provided", async () => {
    expect(async () => {
      await runInitCommand({});
    }).toThrow(HarnessError);
  });

  test("initializes capsule run and outputs structured brief", async () => {
    const runId = "test-cli-run-1";
    const result = await runInitCommand({
      run: runId,
      repo: testDir,
      prompt: "Custom CLI prompt text",
      mode: "feature",
    });

    expect(result.run_id).toBe(runId);
    expect(result.existed).toBe(false);
    expect(typeof result.markdown).toBe("string");
    expect(result.markdown as string).toContain("Capsule Initialized");
    expect(existsSync(result.run_root as string)).toBe(true);
    expect(existsSync(join(result.run_root as string, "manifest.json"))).toBe(true);
    expect(existsSync(join(result.run_root as string, "state.json"))).toBe(true);
    expect(existsSync(join(result.run_root as string, "evidence"))).toBe(true);
  });

  test("supports alias --run-id and idempotently handles existing runs", async () => {
    const runId = "test-cli-run-alias";
    const first = await runInitCommand({
      "run-id": runId,
      repo: testDir,
    });
    expect(first.existed).toBe(false);

    const second = await runInitCommand({
      "run-id": runId,
      repo: testDir,
    });
    expect(second.existed).toBe(true);
    expect(second.run_root).toBe(first.run_root);
  });
});

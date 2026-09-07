import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { runInitCommand } from "../../../../olt/scripts/src/cli/commands/run-init.ts";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import { type VirtualMemoryFS } from "../../../../olt/scripts/src/testing/virtual-fs/index.ts";
import {
  cleanupVirtualCliFS,
  setupVirtualCliFS,
} from "../../commands/fixtures/full-lifecycle-fixture.ts";

describe("run:init CLI command", () => {
  let vfs: VirtualMemoryFS;
  let testDir: string;

  beforeEach(() => {
    vfs = setupVirtualCliFS();
    testDir = `/virtual/run-init-cli-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    vfs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    cleanupVirtualCliFS();
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
    expect(vfs.existsSync(result.run_root as string)).toBe(true);
    expect(vfs.existsSync(join(result.run_root as string, "manifest.json"))).toBe(true);
    expect(vfs.existsSync(join(result.run_root as string, "state.json"))).toBe(true);
    expect(vfs.existsSync(join(result.run_root as string, "evidence"))).toBe(true);
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

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, lstatSync } from "node:fs";
import { join } from "node:path";
import {
  initCapsuleRun,
  ensureCapsuleInitialized,
} from "../../../olt/scripts/src/engine/store/capsule/init.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";

describe("capsule-init", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(
      process.cwd(),
      "coverage",
      "scratch",
      `capsule-init-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  test("initializes new capsule run with all expected files and evidence dir", () => {
    const runId = "test-run-init-1";
    const res = initCapsuleRun(runId, { repo: testDir, prompt: "Test prompt content" });

    expect(res.existed).toBe(false);
    expect(existsSync(res.runRoot)).toBe(true);
    expect(existsSync(join(res.runRoot, "manifest.json"))).toBe(true);
    expect(existsSync(join(res.runRoot, "state.json"))).toBe(true);
    expect(existsSync(join(res.runRoot, "events.jsonl"))).toBe(true);
    expect(existsSync(join(res.runRoot, "README.md"))).toBe(true);
    expect(existsSync(join(res.runRoot, "prompt.md"))).toBe(true);
    expect(existsSync(join(res.runRoot, "evidence"))).toBe(true);
    expect(lstatSync(join(res.runRoot, "evidence")).isDirectory()).toBe(true);
  });

  test("handles Uint8Array and default prompt correctly", () => {
    const runId1 = "test-run-bytes-prompt";
    const bytes = new TextEncoder().encode("Raw bytes prompt");
    const res1 = initCapsuleRun(runId1, { repo: testDir, prompt: bytes });
    expect(res1.existed).toBe(false);

    const runId2 = "test-run-default-prompt";
    const res2 = initCapsuleRun(runId2, { repo: testDir });
    expect(res2.existed).toBe(false);
  });

  test("idempotently returns existed=true when allowExisting=true", () => {
    const runId = "test-run-idempotent";
    const first = initCapsuleRun(runId, { repo: testDir, allowExisting: true });
    expect(first.existed).toBe(false);

    const second = initCapsuleRun(runId, { repo: testDir, allowExisting: true });
    expect(second.existed).toBe(true);
    expect(second.runRoot).toBe(first.runRoot);
  });

  test("throws INVALID_STATE when capsule already exists and allowExisting is false or omitted", () => {
    const runId = "test-run-conflict";
    initCapsuleRun(runId, { repo: testDir });

    expect(() => {
      initCapsuleRun(runId, { repo: testDir });
    }).toThrow(HarnessError);

    expect(() => {
      initCapsuleRun(runId, { repo: testDir, allowExisting: false });
    }).toThrow(HarnessError);
  });

  test("ensureCapsuleInitialized returns runRoot for new and existing runs", () => {
    const runId = "test-run-ensure";
    const root1 = ensureCapsuleInitialized(runId, testDir);
    expect(existsSync(root1)).toBe(true);

    const root2 = ensureCapsuleInitialized(runId, testDir);
    expect(root2).toBe(root1);
  });
});

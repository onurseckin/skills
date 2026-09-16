import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { inferActiveRun } from "../../olt/scripts/src/cli/inference.ts";
import {
  cleanupVirtualCliFS,
  setupVirtualCliFS,
} from "./commands/fixtures/full-lifecycle-fixture.ts";
import type { VirtualMemoryFS } from "../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("inferActiveRun", () => {
  let vfs: VirtualMemoryFS;
  const testRepoRoot = "/virtual/test-inference-repo";

  beforeEach(() => {
    vfs = setupVirtualCliFS();
    vfs.mkdirSync(testRepoRoot, { recursive: true });
    vfs.mkdirSync(join(testRepoRoot, ".git"), { recursive: true });
    vfs.writeFileSync(
      join(testRepoRoot, "package.json"),
      JSON.stringify({ name: "test-inference-repo", version: "1.0.0" }),
    );
  });

  afterEach(() => {
    cleanupVirtualCliFS();
  });

  it("discovers active capsule in capsules/ directory when repoRoot has no .session.json", () => {
    const capsulesDir = join(testRepoRoot, "capsules");
    const capsuleA = join(capsulesDir, "run-2026-01-01-001");
    const capsuleB = join(capsulesDir, "run-2026-01-02-002");
    vfs.mkdirSync(capsuleA, { recursive: true });
    vfs.mkdirSync(capsuleB, { recursive: true });

    const active = inferActiveRun(testRepoRoot);
    expect(active).toBeDefined();
    expect(active?.endsWith("run-2026-01-02-002") || active?.endsWith("run-2026-01-01-001")).toBe(
      true,
    );
  });

  it("discovers active capsule in .olt/capsules/ directory", () => {
    const capsulesDir = join(testRepoRoot, ".olt", "capsules");
    const capsuleA = join(capsulesDir, "run-2026-01-01-100");
    vfs.mkdirSync(capsuleA, { recursive: true });

    const active = inferActiveRun(testRepoRoot);
    expect(active).toBe(capsuleA);
  });

  it("ignores archive and hidden directories", () => {
    const capsulesDir = join(testRepoRoot, "capsules");
    const archiveDir = join(capsulesDir, "archive");
    const hiddenDir = join(capsulesDir, ".locks");
    vfs.mkdirSync(archiveDir, { recursive: true });
    vfs.mkdirSync(hiddenDir, { recursive: true });

    const active = inferActiveRun(testRepoRoot);
    expect(active).toBeUndefined();
  });
});

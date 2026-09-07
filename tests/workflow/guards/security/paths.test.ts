import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  resolveBacklogPath,
  resolveCapsulesDir,
  resolveCompletedDefectsPath,
  resolveCompletedTasksPath,
  resolveDefectsPath,
  resolveOltDir,
  resolvePolicyPath,
  resolveTelemetryPath,
} from "../../../../olt/scripts/src/core/shared/paths.ts";
import { setupWorkflowVirtualFs } from "../../shared/index.ts";
import type { VirtualMemoryFS } from "../../../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("Canonical olt/ Storage & Paths System", () => {
  let virtualRoot: string;
  let vfs: VirtualMemoryFS;
  let vfsCleanup: (() => void) | undefined;
  let sc = 0;

  beforeEach(() => {
    const setup = setupWorkflowVirtualFs();
    vfsCleanup = setup.cleanup;
    vfs = setup.vfs;
    virtualRoot = `/virtual/security-paths/test-olt-paths-${++sc}`;
  });

  afterEach(() => {
    vfsCleanup?.();
    vfsCleanup = undefined;
  });

  test("resolves canonical .olt/ directory and persistent files", () => {
    vfs.mkdirSync(join(virtualRoot, ".olt"), { recursive: true });
    vfs.writeFileSync(join(virtualRoot, ".olt", "policy.json"), "{}", "utf-8");
    vfs.writeFileSync(join(virtualRoot, ".olt", "backlog.jsonl"), "", "utf-8");
    vfs.writeFileSync(join(virtualRoot, ".olt", "completed-tasks.jsonl"), "", "utf-8");
    vfs.writeFileSync(join(virtualRoot, ".olt", "defects.jsonl"), "", "utf-8");
    vfs.writeFileSync(join(virtualRoot, ".olt", "completed-defects.jsonl"), "", "utf-8");
    vfs.writeFileSync(join(virtualRoot, ".olt", "telemetry.jsonl"), "", "utf-8");

    expect(resolveOltDir(virtualRoot)).toBe(join(virtualRoot, ".olt"));
    expect(resolvePolicyPath(virtualRoot)).toBe(join(virtualRoot, ".olt", "policy.json"));
    expect(resolveBacklogPath(virtualRoot)).toBe(join(virtualRoot, ".olt", "backlog.jsonl"));
    expect(resolveCompletedTasksPath(virtualRoot)).toBe(
      join(virtualRoot, ".olt", "completed-tasks.jsonl"),
    );
    expect(resolveDefectsPath(virtualRoot)).toBe(join(virtualRoot, ".olt", "defects.jsonl"));
    expect(resolveCompletedDefectsPath(virtualRoot)).toBe(
      join(virtualRoot, ".olt", "completed-defects.jsonl"),
    );
    expect(resolveTelemetryPath(virtualRoot)).toBe(join(virtualRoot, ".olt", "telemetry.jsonl"));
  });

  test("resolves canonical .olt/capsules runtime directory", () => {
    expect(resolveCapsulesDir(virtualRoot)).toBe(join(virtualRoot, ".olt", "capsules"));
  });
});

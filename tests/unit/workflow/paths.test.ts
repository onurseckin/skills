import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
} from "../../../olt/scripts/src/core/shared/paths.ts";

describe("Canonical olt/ Storage & Paths System", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), "test-olt-paths-"));
  });

  afterEach(() => {
    try {
      rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      // Ignored
    }
  });

  test("resolves canonical .olt/ directory and persistent files", () => {
    mkdirSync(join(tmpRoot, ".olt"), { recursive: true });
    writeFileSync(join(tmpRoot, ".olt", "policy.json"), "{}", "utf-8");
    writeFileSync(join(tmpRoot, ".olt", "backlog.jsonl"), "", "utf-8");
    writeFileSync(join(tmpRoot, ".olt", "completed-tasks.jsonl"), "", "utf-8");
    writeFileSync(join(tmpRoot, ".olt", "defects.jsonl"), "", "utf-8");
    writeFileSync(join(tmpRoot, ".olt", "completed-defects.jsonl"), "", "utf-8");
    writeFileSync(join(tmpRoot, ".olt", "telemetry.jsonl"), "", "utf-8");

    expect(resolveOltDir(tmpRoot)).toBe(join(tmpRoot, ".olt"));
    expect(resolvePolicyPath(tmpRoot)).toBe(join(tmpRoot, ".olt", "policy.json"));
    expect(resolveBacklogPath(tmpRoot)).toBe(join(tmpRoot, ".olt", "backlog.jsonl"));
    expect(resolveCompletedTasksPath(tmpRoot)).toBe(join(tmpRoot, ".olt", "completed-tasks.jsonl"));
    expect(resolveDefectsPath(tmpRoot)).toBe(join(tmpRoot, ".olt", "defects.jsonl"));
    expect(resolveCompletedDefectsPath(tmpRoot)).toBe(
      join(tmpRoot, ".olt", "completed-defects.jsonl"),
    );
    expect(resolveTelemetryPath(tmpRoot)).toBe(join(tmpRoot, ".olt", "telemetry.jsonl"));
  });

  test("resolves canonical .olt/capsules runtime directory", () => {
    expect(resolveCapsulesDir(tmpRoot)).toBe(join(tmpRoot, ".olt", "capsules"));
  });
});

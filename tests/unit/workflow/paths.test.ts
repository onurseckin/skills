import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  findRepoRoot,
  resolveBacklogPath,
  resolveCapsulesDir,
  resolveCompletedDefectsPath,
  resolveCompletedTasksPath,
  resolveDefectsPath,
  resolveOltDir,
  resolvePolicyPath,
  resolveTelemetryPath,
} from "../../../olt/scripts/src/shared/paths.ts";

describe("Plan 93 Canonical olt/ Storage & Paths System", () => {
  const tmpRoot = join(process.cwd(), ".tmp", "test-olt-paths");

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

    rmSync(tmpRoot, { recursive: true, force: true });
  });

  test("resolves fallback olt/ directory when .olt does not exist", () => {
    mkdirSync(join(tmpRoot, "olt"), { recursive: true });
    writeFileSync(join(tmpRoot, "olt", "policy.json"), "{}", "utf-8");
    expect(resolveOltDir(tmpRoot)).toBe(join(tmpRoot, "olt"));
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  test("falls back to legacy .capsules/ paths if olt/ is not yet created", () => {
    mkdirSync(join(tmpRoot, ".capsules", "mind", "queue"), { recursive: true });
    writeFileSync(join(tmpRoot, ".capsules", "mind", "queue", "feedback-queue.jsonl"), "", "utf-8");
    writeFileSync(join(tmpRoot, ".capsules", "mind", "queue", "blunders.jsonl"), "", "utf-8");

    expect(resolveBacklogPath(tmpRoot)).toBe(
      join(tmpRoot, ".capsules", "mind", "queue", "feedback-queue.jsonl"),
    );
    expect(resolveDefectsPath(tmpRoot)).toBe(
      join(tmpRoot, ".capsules", "mind", "queue", "blunders.jsonl"),
    );

    rmSync(tmpRoot, { recursive: true, force: true });
  });

  test("resolves capsules runtime directory", () => {
    mkdirSync(join(tmpRoot, "capsules"), { recursive: true });
    expect(resolveCapsulesDir(tmpRoot)).toBe(join(tmpRoot, "capsules"));
    rmSync(tmpRoot, { recursive: true, force: true });
  });
});

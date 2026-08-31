import { describe, it, expect } from "bun:test";
import { existsSync } from "node:fs";
import {
  findRepoRoot,
  isInsideCapsule,
  resolveOltDir,
  resolveCapsulesDir,
  resolvePolicyPath,
  resolveBacklogPath,
  resolveCompletedTasksPath,
  resolveDefectsPath,
  resolveCompletedDefectsPath,
  resolveTelemetryPath,
  resolveScratchDir,
  resolveEvidenceDir,
  stripCapsulePath,
} from "../../../olt/scripts/src/core/shared/paths.ts";

describe("Shared Path Resolvers", () => {
  it("finds repository root correctly", () => {
    const root = findRepoRoot();
    expect(existsSync(root)).toBe(true);
    expect(existsSync(`${root}/package.json`)).toBe(true);
  });

  it("identifies inside-capsule paths with isInsideCapsule and stripCapsulePath", () => {
    expect(isInsideCapsule("/mock/repo/.olt/capsules/run-abc")).toBe(true);
    expect(isInsideCapsule("/mock/repo/.capsules/run-abc")).toBe(true);
    expect(isInsideCapsule("/mock/repo/src/core/paths.ts")).toBe(false);
    expect(isInsideCapsule("/mock/repo/src/capsules/test.ts")).toBe(false);

    expect(stripCapsulePath("/mock/repo/.olt/capsules/run-abc/task")).toBe("/mock/repo");
    expect(stripCapsulePath("/mock/repo/src/core/paths.ts")).toBeUndefined();
  });

  it("resolves canonical .olt directory", () => {
    const oltDir = resolveOltDir();
    expect(oltDir.endsWith(".olt") || oltDir.endsWith("olt")).toBe(true);
  });

  it("resolves canonical .olt/capsules directory", () => {
    const capsulesDir = resolveCapsulesDir();
    expect(capsulesDir).toContain("capsules");
  });

  it("resolves policy, backlog, defects, and telemetry paths", () => {
    expect(resolvePolicyPath()).toContain("policy.json");
    expect(resolveBacklogPath()).toContain("backlog.jsonl");
    expect(resolveCompletedTasksPath()).toContain("completed-tasks.jsonl");
    expect(resolveDefectsPath()).toContain("defects.jsonl");
    expect(resolveCompletedDefectsPath()).toContain("completed-defects.jsonl");
    expect(resolveTelemetryPath()).toContain("telemetry.jsonl");
  });

  it("resolves scratch and evidence directories strictly under OS tmpdir", () => {
    const scratch = resolveScratchDir();
    expect(scratch).toContain("olt-scratch");

    const evidence = resolveEvidenceDir();
    expect(evidence).toContain("olt-scratch");
    expect(evidence).toContain("evidence");
  });
});

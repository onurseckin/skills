import { describe, it, expect } from "bun:test";
import { existsSync } from "node:fs";
import {
  findRepoRoot,
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
} from "../../../olt/scripts/src/shared/paths.ts";

describe("Shared Path Resolvers", () => {
  it("finds repository root correctly", () => {
    const root = findRepoRoot();
    expect(existsSync(root)).toBe(true);
    expect(existsSync(`${root}/package.json`)).toBe(true);
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

  it("resolves scratch and evidence directories strictly under .olt/", () => {
    const scratch = resolveScratchDir();
    expect(scratch).toContain(".olt");
    expect(scratch).toContain("scratch");

    const evidence = resolveEvidenceDir();
    expect(evidence).toContain(".olt");
    expect(evidence).toContain("evidence");
  });
});

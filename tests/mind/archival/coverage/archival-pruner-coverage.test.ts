import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import { consolidateCapsules } from "../../../../olt/scripts/src/mind/archival/pruner.ts";

describe("Archival Pruner Consolidator Coverage Suite", () => {
  let tempDir: string;
  let capsulesDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "pruner-cov-test-"));
    capsulesDir = join(tempDir, "capsules");
    mkdirSync(capsulesDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function createCapsuleDir(
    name: string,
    files: { manifest?: boolean; state?: unknown; prompt?: boolean } = {},
  ) {
    const dir = join(capsulesDir, name);
    mkdirSync(dir, { recursive: true });
    if (files.manifest) writeFileSync(join(dir, "manifest.json"), "{}");
    if (files.prompt) writeFileSync(join(dir, "prompt.md"), "# Prompt");
    if (files.state !== undefined) {
      const stateContent =
        typeof files.state === "string" ? files.state : JSON.stringify(files.state);
      writeFileSync(join(dir, "state.json"), stateContent);
    }
    return dir;
  }

  it("throws HarnessError on missing or non-directory capsulesDir", () => {
    expect(() => consolidateCapsules("")).toThrow(HarnessError);
    expect(() => consolidateCapsules(join(tempDir, "nonexistent"))).toThrow(HarnessError);

    const filePath = join(tempDir, "regular-file");
    writeFileSync(filePath, "content");
    expect(() => consolidateCapsules(filePath)).toThrow(HarnessError);
  });

  it("ignores non-capsules, hidden directories, and archive directory", () => {
    mkdirSync(join(capsulesDir, ".hidden-dir"));
    mkdirSync(join(capsulesDir, "archive"));
    mkdirSync(join(capsulesDir, "random-non-capsule-dir"));

    const result = consolidateCapsules(capsulesDir);
    expect(result.activeCapsules).toEqual([]);
    expect(result.archivedCapsules).toEqual([]);
    expect(result.prunedSubdirectoriesCount).toBe(0);
  });

  it("consolidates capsules using activeRunIds filter", () => {
    createCapsuleDir("run-active-1", { manifest: true });
    createCapsuleDir("run-legacy-1", { prompt: true });

    const result = consolidateCapsules(capsulesDir, {
      activeRunIds: ["run-active-1"],
      pruneBoilerplate: true,
    });

    expect(result.activeCapsules).toContain("run-active-1");
    expect(result.archivedCapsules).toContain("run-legacy-1");
    expect(existsSync(join(capsulesDir, "run-active-1"))).toBe(true);
    expect(existsSync(join(capsulesDir, "archive", "run-legacy-1"))).toBe(true);
  });

  it("consolidates capsules using generation name pattern matching and retention cutoff", () => {
    createCapsuleDir("mind-gen-1", { manifest: true });
    createCapsuleDir("mind-gen-2", { manifest: true });
    createCapsuleDir("mind-gen-3", { manifest: true });

    const result = consolidateCapsules(capsulesDir, {
      currentGeneration: 3,
      retentionGenerations: 1,
      pruneBoilerplate: false,
    });

    expect(result.archivedCapsules).toContain("mind-gen-1");
    expect(result.archivedCapsules).toContain("mind-gen-2");
    expect(result.activeCapsules).toContain("mind-gen-3");
  });

  it("processes active capsules and handles state.json and corrupt states", () => {
    const activeDir = createCapsuleDir("run-state-active", {
      state: {
        mind: { status: "rotated", generation: 1 },
        completion_result: { status: "complete" },
      },
    });
    mkdirSync(join(activeDir, "blobs"));

    createCapsuleDir("run-corrupted-state", {
      state: "{ invalid json",
    });

    const result = consolidateCapsules(capsulesDir, {
      pruneBoilerplate: true,
    });

    expect(result.activeCapsules).toContain("run-state-active");
    expect(result.activeCapsules).not.toContain("run-corrupted-state");
    expect(result.prunedSubdirectoriesCount).toBeGreaterThanOrEqual(1);
    expect(existsSync(join(activeDir, "blobs"))).toBe(false);
  });

  it("supports custom targetArchiveDir and dryRun execution", () => {
    createCapsuleDir("dry-run-cap", { manifest: true });
    const customArchive = join(tempDir, "custom-archive");

    const result = consolidateCapsules(capsulesDir, {
      activeRunIds: [],
      targetArchiveDir: customArchive,
      dryRun: true,
    });

    expect(result.archivedCapsules).toContain("dry-run-cap");
    expect(result.archiveDir).toBe(customArchive);
    expect(existsSync(join(capsulesDir, "dry-run-cap"))).toBe(true);
    expect(existsSync(join(customArchive, "dry-run-cap"))).toBe(false);
  });
});

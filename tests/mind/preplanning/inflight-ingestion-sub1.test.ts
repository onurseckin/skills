import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  InFlightIngestionEngine,
  UserIntentExtractionEngine,
  createInFlightSnapshot,
  extractUserIntent,
  inspectInFlightWork,
  integrateUserIntentIntoRoadmap,
  listInFlightSnapshots,
  loadInFlightSnapshot,
  parseDiffSummary,
  parseGitStashes,
  parseGitStatusOutput,
  saveInFlightSnapshot,
  structureUserIntentAsBacklogDeliverable,
  toCanonicalDomainCategory,
  type GitRunner,
  type InFlightSnapshot,
  type InFlightSnapshotOptions,
  type IntentCategory,
  type IntentDomain,
  type SaveSnapshotOptions,
} from "../../../olt/scripts/src/mind/preplanning/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";

describe("In-Flight Work Ingestion & Intent Extraction Engine Suite", () => {
let testDir: string;
  let snapshotsDir: string;

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `test-inflight-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    snapshotsDir = join(testDir, ".olt", "snapshots");
    mkdirSync(snapshotsDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Best effort cleanup
    }
  });

describe("Git Status, Diff & Stash Parsers (Non-Destructive)", () => {
    it("parses porcelain v1 status with various file change statuses", () => {
      const dummyFile = join(testDir, "test-file.ts");
      writeFileSync(dummyFile, "export const HELLO = 'world';\n", "utf-8");

      const statusOutput = [
        " M test-file.ts",
        "A  src/new-feature.ts",
        " D deleted-file.ts",
        "?? untracked-script.ts",
        "R  old-name.ts -> new-name.ts",
        "C  source.ts -> copy.ts",
        "UU conflicted.ts",
      ].join("\n");

      const parsed = parseGitStatusOutput(statusOutput, testDir);
      expect(parsed.files.length).toBe(7);

      const modified = parsed.files.find((f) => f.path === "test-file.ts");
      expect(modified).toBeDefined();
      expect(modified?.status).toBe("modified");
      expect(modified?.unstaged).toBe(true);
      expect(modified?.staged).toBe(false);

      const added = parsed.files.find((f) => f.path === "src/new-feature.ts");
      expect(added?.status).toBe("added");
      expect(added?.staged).toBe(true);

      const deleted = parsed.files.find((f) => f.path === "deleted-file.ts");
      expect(deleted?.status).toBe("deleted");

      const untracked = parsed.files.find((f) => f.path === "untracked-script.ts");
      expect(untracked?.status).toBe("untracked");

      const renamed = parsed.files.find((f) => f.path === "new-name.ts");
      expect(renamed?.status).toBe("renamed");
      expect(renamed?.oldPath).toBe("old-name.ts");

      const copied = parsed.files.find((f) => f.path === "copy.ts");
      expect(copied?.status).toBe("copied");

      const unmerged = parsed.files.find((f) => f.path === "conflicted.ts");
      expect(unmerged?.status).toBe("unmerged");
    });

    it("parses git diff summary calculating insertions and deletions accurately", () => {
      const diffOutput = [
        "diff --git a/src/mind.ts b/src/mind.ts",
        "--- a/src/mind.ts",
        "+++ b/src/mind.ts",
        "@@ -1,3 +1,5 @@",
        "+export function initializeMind(): void {",
        "+  console.log('mind online');",
        "+}",
        "-export function oldMind(): void {}",
        "diff --git a/src/util.ts b/src/util.ts",
        "--- a/src/util.ts",
        "+++ b/src/util.ts",
        "@@ -10,2 +10,4 @@",
        "+const x = 1;",
        "+const y = 2;",
      ].join("\n");

      const summary = parseDiffSummary(diffOutput);
      expect(summary.filesChanged).toBe(2);
      expect(summary.insertions).toBe(5);
      expect(summary.deletions).toBe(1);
    });

    it("parses git stash entries with custom format and fallback format", () => {
      const stashOutput = [
        "stash@{0}\x1f1111111111111111111111111111111111111111\x1fWIP on main: add ingestion engine\x1f2026-09-01T12:00:00Z",
        "stash@{1}: WIP on feature: repair parser",
      ].join("\n");

      const stashes = parseGitStashes(stashOutput);
      expect(stashes.length).toBe(2);
      expect(stashes[0]?.index).toBe(0);
      expect(stashes[0]?.selector).toBe("stash@{0}");
      expect(stashes[0]?.hash).toBe("1111111111111111111111111111111111111111");
      expect(stashes[0]?.message).toBe("WIP on main: add ingestion engine");
      expect(stashes[0]?.date).toBe("2026-09-01T12:00:00Z");

      expect(stashes[1]?.index).toBe(1);
      expect(stashes[1]?.selector).toBe("stash@{1}");
      expect(stashes[1]?.message).toBe("WIP on feature: repair parser");
    });
  });
});

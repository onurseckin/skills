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

describe("InFlightIngestionEngine Snapshot Lifecycle", () => {
    it("creates, saves to .olt/snapshots/, loads, and lists snapshots non-destructively", async () => {
      const mockRunner: GitRunner = (_cwd, argv) => {
        const cmd = argv[0];
        if (cmd === "symbolic-ref") return { status: 0, stdout: "feature/wave4\n", stderr: "" };
        if (cmd === "rev-parse") {
          return { status: 0, stdout: "abcdef1234567890abcdef1234567890abcdef12\n", stderr: "" };
        }
        if (cmd === "status") {
          return {
            status: 0,
            stdout: " M src/engine.ts\n?? src/untracked.ts\n",
            stderr: "",
          };
        }
        if (cmd === "diff") {
          return {
            status: 0,
            stdout: "diff --git a/src/engine.ts b/src/engine.ts\n+export class EngineV2 {}\n",
            stderr: "",
          };
        }
        if (cmd === "stash") {
          return {
            status: 0,
            stdout: "stash@{0}\x1faaaa\x1fAdd engine v2 architecture\x1f2026-09-01T10:00:00Z\n",
            stderr: "",
          };
        }
        return { status: 0, stdout: "", stderr: "" };
      };

      const engine = new InFlightIngestionEngine(testDir, {
        snapshotsDir,
        runner: mockRunner,
      });

      expect(engine.getRepoRoot()).toBe(testDir);
      expect(engine.getSnapshotsDir()).toBe(snapshotsDir);

      const snapshot = await engine.createSnapshot();
      expect(snapshot.snapshotId.startsWith("snap_")).toBe(true);
      expect(snapshot.branch).toBe("feature/wave4");
      expect(snapshot.headCommit).toBe("abcdef1234567890abcdef1234567890abcdef12");
      expect(snapshot.uncommittedFiles.length).toBe(2);
      expect(snapshot.stashes.length).toBe(1);

      // Save snapshot to .olt/snapshots/
      const savedPath = await engine.saveSnapshot(snapshot);
      expect(existsSync(savedPath)).toBe(true);
      expect(savedPath).toContain(snapshot.snapshotId);
      expect(savedPath.endsWith(".json")).toBe(true);

      // Overwrite protection
      let threwOverwrite = false;
      try {
        await engine.saveSnapshot(snapshot, { overwrite: false });
      } catch (err) {
        threwOverwrite = err instanceof HarnessError;
      }
      expect(threwOverwrite).toBe(true);

      // Load snapshot by ID
      const loadedById = await engine.loadSnapshot(snapshot.snapshotId);
      expect(loadedById.snapshotId).toBe(snapshot.snapshotId);
      expect(loadedById.branch).toBe(snapshot.branch);
      expect(loadedById.headCommit).toBe(snapshot.headCommit);

      // Load snapshot by file path
      const loadedByPath = await engine.loadSnapshot(savedPath);
      expect(loadedByPath.snapshotId).toBe(snapshot.snapshotId);

      // List snapshots
      const list = await engine.listSnapshots();
      expect(list.length).toBe(1);
      const firstSummary = list[0];
      expect(firstSummary).toBeDefined();
      expect(firstSummary?.snapshotId).toBe(snapshot.snapshotId);
      expect(firstSummary?.filesChanged).toBe(snapshot.diffSummary.filesChanged);

      // Inspect in-flight work
      const inspection = await engine.inspectInFlightWork();
      expect(inspection.hasUncommittedChanges).toBe(true);
      expect(inspection.uncommittedFilesCount).toBe(2);
      expect(inspection.branch).toBe("feature/wave4");
    });

    it("handles standalone export functions createInFlightSnapshot, saveInFlightSnapshot, loadInFlightSnapshot, listInFlightSnapshots", async () => {
      const mockRunner: GitRunner = (_cwd, argv) => {
        const cmd = argv[0];
        if (cmd === "symbolic-ref") return { status: 0, stdout: "main\n", stderr: "" };
        if (cmd === "rev-parse") return { status: 0, stdout: "1111222233334444555566667777888899990000\n", stderr: "" };
        if (cmd === "status") return { status: 0, stdout: " M README.md\n", stderr: "" };
        if (cmd === "diff") return { status: 0, stdout: "diff --git a/README.md b/README.md\n+# Docs update\n", stderr: "" };
        if (cmd === "stash") return { status: 0, stdout: "", stderr: "" };
        return { status: 0, stdout: "", stderr: "" };
      };

      const options: InFlightSnapshotOptions = {
        runner: mockRunner,
        customTimestamp: "2026-09-01T12:00:00.000Z",
      };

      const snapshot = await createInFlightSnapshot(testDir, options);
      expect(snapshot.snapshotId).toContain("snap_20260901120000");

      const saveOptions: SaveSnapshotOptions = {
        snapshotsDir,
      };
      const filePath = await saveInFlightSnapshot(snapshot, saveOptions);
      expect(existsSync(filePath)).toBe(true);

      const loaded = await loadInFlightSnapshot(snapshot.snapshotId, {
        snapshotsDir,
        repoRoot: testDir,
      });
      expect(loaded.snapshotId).toBe(snapshot.snapshotId);

      const summaries = await listInFlightSnapshots(snapshotsDir);
      expect(summaries.length).toBeGreaterThanOrEqual(1);

      const inspection = await inspectInFlightWork(testDir);
      expect(inspection.repoRoot).toBe(testDir);
    });
  });
});

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  archiveSnapshotFile,
  cleanupSnapshotFile,
  computeSnapshotChecksum,
  readSnapshotFromDisk,
  resolveSuspendedStatePath,
  type SuspendedAnimationSnapshot,
  writeSnapshotToDisk,
} from "../../../../../olt/scripts/src/mind/lifecycle/suspended-animation.ts";

describe("Suspended Animation Disk Operations Suite", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(
      tmpdir(),
      `suspend-disk-cov-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    );
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const createDummySnapshot = (id = "snap-1"): SuspendedAnimationSnapshot => {
    const unsigned = {
      schemaVersion: "1.0.0",
      snapshotId: id,
      suspendedAtIso: "2026-09-01T20:00:00.000Z",
      suspendedAtMs: 1756700000000,
      reason: "Rate limit",
      governorState: "HIBERNATING" as const,
      tasksDag: [],
      frozenTimers: [],
      activeWatchdogs: [],
      contextState: { active: true },
    };
    return {
      ...unsigned,
      checksum: computeSnapshotChecksum(unsigned),
    };
  };

  describe("resolveSuspendedStatePath", () => {
    it("returns direct path when already ending in .json", () => {
      const explicit = "/tmp/custom-state.json";
      expect(resolveSuspendedStatePath(explicit)).toBe(explicit);
    });

    it("appends .olt/suspended-state.json when given directory root", () => {
      expect(resolveSuspendedStatePath("/tmp/my-repo")).toBe(
        join("/tmp/my-repo", ".olt", "suspended-state.json"),
      );
    });
  });

  describe("readSnapshotFromDisk & writeSnapshotToDisk", () => {
    it("writes snapshot to disk and reads back cleanly with valid checksum", () => {
      const snapshot = createDummySnapshot("snap-disk-write");
      writeSnapshotToDisk(tempDir, snapshot);

      const resolvedPath = resolveSuspendedStatePath(tempDir);
      expect(existsSync(resolvedPath)).toBe(true);

      const readBack = readSnapshotFromDisk(tempDir);
      expect(readBack).not.toBeNull();
      expect(readBack?.snapshotId).toBe("snap-disk-write");
      expect(readBack?.reason).toBe("Rate limit");
      expect(readBack?.contextState).toEqual({ active: true });
    });

    it("returns null when reading non-existent snapshot file", () => {
      expect(readSnapshotFromDisk(join(tempDir, "non-existent"))).toBeNull();
    });

    it("returns null when snapshot file contains invalid JSON", () => {
      const targetPath = resolveSuspendedStatePath(tempDir);
      mkdirSync(join(tempDir, ".olt"), { recursive: true });
      writeFileSync(targetPath, "invalid json string", "utf-8");

      expect(readSnapshotFromDisk(tempDir)).toBeNull();
    });

    it("returns null when snapshot file checksum is corrupt or tampered", () => {
      const snapshot = createDummySnapshot("snap-tampered");
      const tampered = { ...snapshot, checksum: "corruptedchecksum00000000000000" };
      const targetPath = resolveSuspendedStatePath(tempDir);
      mkdirSync(join(tempDir, ".olt"), { recursive: true });
      writeFileSync(targetPath, JSON.stringify(tampered), "utf-8");

      expect(readSnapshotFromDisk(tempDir)).toBeNull();
    });
  });

  describe("cleanupSnapshotFile", () => {
    it("removes existing snapshot file and returns true", () => {
      const snapshot = createDummySnapshot("snap-cleanup");
      writeSnapshotToDisk(tempDir, snapshot);
      expect(cleanupSnapshotFile(tempDir)).toBe(true);
      expect(readSnapshotFromDisk(tempDir)).toBeNull();
    });

    it("returns false when file does not exist", () => {
      expect(cleanupSnapshotFile(join(tempDir, "non-existent"))).toBe(false);
    });
  });

  describe("archiveSnapshotFile", () => {
    it("archives existing snapshot to archive directory and removes source snapshot", () => {
      const snapshot = createDummySnapshot("snap-archive");
      writeSnapshotToDisk(tempDir, snapshot);

      const archivePath = archiveSnapshotFile(tempDir, tempDir);
      expect(archivePath).not.toBeNull();
      if (archivePath) {
        expect(existsSync(archivePath)).toBe(true);
        const content = JSON.parse(
          readFileSync(archivePath, "utf-8"),
        ) as SuspendedAnimationSnapshot;
        expect(content.snapshotId).toBe("snap-archive");
      }

      // Original snapshot file cleaned up
      expect(readSnapshotFromDisk(tempDir)).toBeNull();
    });

    it("returns null when archiving non-existent snapshot", () => {
      expect(archiveSnapshotFile(join(tempDir, "non-existent"), tempDir)).toBeNull();
    });
  });
});

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertSafeCaptureDestination,
  createSnapshotContext,
  createSnapshotTree,
  loadSnapshotTree,
  persistSnapshotTree,
} from "../../../olt/scripts/src/capture/snapshot/index.ts";
import type { DomPhysicsSnapshot } from "../../../olt/scripts/src/capture/runners/types.ts";
import { cleanupVirtualCaptureFS, scratchRoot, setupVirtualCaptureFS } from "../fixture.ts";

function createDummyPhysics(): DomPhysicsSnapshot {
  return {
    viewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
    scrollPosition: { x: 0, y: 0 },
    capturedAt: "2026-08-31T12:00:00.000Z",
    elements: [
      {
        selector: "main.content",
        tagName: "MAIN",
        bounds: {
          x: 0,
          y: 80,
          width: 1440,
          height: 820,
          top: 80,
          left: 0,
          right: 1440,
          bottom: 900,
        },
        computedStyles: {
          display: "block",
          position: "relative",
          zIndex: 0,
          color: "rgb(0, 0, 0)",
          backgroundColor: "rgb(255, 255, 255)",
          overflowX: "visible",
          overflowY: "visible",
        },
        metrics: {
          scrollWidth: 1440,
          scrollHeight: 820,
          clientWidth: 1440,
          clientHeight: 820,
          offsetWidth: 1440,
          offsetHeight: 820,
        },
      },
    ],
    layoutOverflows: [],
    textClippings: [],
  };
}

describe("Snapshot Persistence & Path Safety Confinement", () => {
  beforeEach(() => {
    setupVirtualCaptureFS();
  });

  afterEach(() => {
    cleanupVirtualCaptureFS();
  });

  it("enforces strict path confinement: rejects repository root leaks", () => {
    const safeTmp = join(process.cwd(), ".tmp", "tree.json");
    const safeCapsule = join(process.cwd(), ".olt/capsules/run-x/tree.json");
    const safeScratch = join(process.cwd(), ".olt/scratch/tree.json");
    const safeOsTmp = join(tmpdir(), "tree.json");

    expect(() => assertSafeCaptureDestination(safeTmp)).not.toThrow();
    expect(() => assertSafeCaptureDestination(safeCapsule)).not.toThrow();
    expect(() => assertSafeCaptureDestination(safeScratch)).not.toThrow();
    expect(() => assertSafeCaptureDestination(safeOsTmp)).not.toThrow();

    const rootLeak = join(process.cwd(), "snapshot-tree.json");
    const capturesDirLeak = join(process.cwd(), "captures", "snapshot-tree.json");
    const relativeRootLeak = "snapshot.json";

    expect(() => assertSafeCaptureDestination(rootLeak)).toThrow("outside safe confinement roots");
    expect(() => assertSafeCaptureDestination(capturesDirLeak)).toThrow(
      "outside safe confinement roots",
    );
    expect(() => assertSafeCaptureDestination(relativeRootLeak)).toThrow(
      "outside safe confinement roots",
    );
  });

  it("persists and loads snapshot tree with verified state integrity", () => {
    const testDir = scratchRoot("snapshot-persistence", "persist");
    mkdirSync(testDir, { recursive: true });
    const targetFile = join(testDir, "tree.snapshot.json");

    const tree = createSnapshotTree();
    const context = createSnapshotContext({
      viewport: { name: "desktop", width: 1440, height: 900 },
      url: "http://localhost:3000/",
      screenId: "home",
    });
    const physics = createDummyPhysics();

    tree.addRoot({ id: "root", label: "Initial Screen", context, physics });
    tree.addChild({ id: "child-1", parentId: "root", label: "Step 1", context, physics });

    const persistResult = persistSnapshotTree(tree, targetFile);
    expect(persistResult.filePath).toBe(targetFile);
    expect(persistResult.bytesWritten).toBeGreaterThan(100);
    expect(persistResult.merkleRoot).toHaveLength(64);
    expect(existsSync(targetFile)).toBe(true);

    const loadedTree = loadSnapshotTree(targetFile);
    expect(loadedTree.size()).toBe(2);
    expect(loadedTree.getRoot()?.id).toBe("root");
    expect(loadedTree.getChildren("root")[0]?.id).toBe("child-1");
    expect(loadedTree.computeTreeMerkleRoot()).toBe(persistResult.merkleRoot);
  });

  it("rejects corrupted or tampered snapshot files on load", () => {
    const testDir = scratchRoot("snapshot-persistence", "tamper");
    mkdirSync(testDir, { recursive: true });
    const targetFile = join(testDir, "corrupted.snapshot.json");

    const tree = createSnapshotTree();
    const context = createSnapshotContext({
      viewport: { name: "desktop", width: 1440, height: 900 },
    });
    const physics = createDummyPhysics();
    tree.addRoot({ id: "root", label: "Root", context, physics });

    persistSnapshotTree(tree, targetFile);

    const raw = JSON.parse(readFileSync(targetFile, "utf-8"));
    raw.nodes[0].label = "Unauthorized Tampered Label";
    writeFileSync(targetFile, JSON.stringify(raw), "utf-8");

    expect(() => loadSnapshotTree(targetFile)).toThrow("Corrupted state hash detected");
  });

  it("throws NOT_FOUND when loading non-existent file", () => {
    expect(() => loadSnapshotTree("/virtual/non-existent-snapshot-file-xyz.json")).toThrow(
      "not found",
    );
  });
});

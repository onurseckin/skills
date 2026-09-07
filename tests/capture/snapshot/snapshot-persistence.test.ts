import { afterEach, beforeEach, describe, expect, it } from "bun:test";
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
import {
  cleanupVirtualCaptureFS,
  getVirtualCaptureFS,
  scratchRoot,
  setupVirtualCaptureFS,
} from "../fixture.ts";

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
    const tmpTraversal = join(process.cwd(), ".tmp", "..", "escaped.json");
    const scratchTraversal = join(process.cwd(), ".olt", "scratch", "..", "..", "sneaky.json");

    expect(() => assertSafeCaptureDestination(rootLeak)).toThrow("outside safe confinement roots");
    expect(() => assertSafeCaptureDestination(capturesDirLeak)).toThrow(
      "outside safe confinement roots",
    );
    expect(() => assertSafeCaptureDestination(relativeRootLeak)).toThrow(
      "outside safe confinement roots",
    );
    expect(() => assertSafeCaptureDestination(tmpTraversal)).toThrow(
      "outside safe confinement roots",
    );
    expect(() => assertSafeCaptureDestination(scratchTraversal)).toThrow(
      "outside safe confinement roots",
    );
  });

  it("persists and loads snapshot tree with verified state integrity", () => {
    const vfs = getVirtualCaptureFS();
    const testDir = scratchRoot("snapshot-persistence", "persist");
    vfs.mkdirSync(testDir, { recursive: true });
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
    expect(vfs.existsSync(targetFile)).toBe(true);

    const loadedTree = loadSnapshotTree(targetFile);
    expect(loadedTree.size()).toBe(2);
    expect(loadedTree.getRoot()?.id).toBe("root");
    expect(loadedTree.getChildren("root")[0]?.id).toBe("child-1");
    expect(loadedTree.computeTreeMerkleRoot()).toBe(persistResult.merkleRoot);
  });

  it("rejects corrupted or tampered snapshot files on load", () => {
    const vfs = getVirtualCaptureFS();
    const testDir = scratchRoot("snapshot-persistence", "tamper");
    vfs.mkdirSync(testDir, { recursive: true });
    const targetFile = join(testDir, "corrupted.snapshot.json");

    const tree = createSnapshotTree();
    const context = createSnapshotContext({
      viewport: { name: "desktop", width: 1440, height: 900 },
    });
    const physics = createDummyPhysics();
    tree.addRoot({ id: "root", label: "Root", context, physics });

    persistSnapshotTree(tree, targetFile);

    const raw = JSON.parse(vfs.readFileSync(targetFile, "utf-8"));
    raw.nodes[0].label = "Unauthorized Tampered Label";
    vfs.writeFileSync(targetFile, JSON.stringify(raw), "utf-8");

    expect(() => loadSnapshotTree(targetFile)).toThrow("Corrupted state hash detected");
  });

  it("throws NOT_FOUND when loading non-existent file", () => {
    expect(() => loadSnapshotTree("/virtual/non-existent-snapshot-file-xyz.json")).toThrow(
      "not found",
    );
  });

  it("handles malformed JSON and schema mismatches with INTEGRITY errors", () => {
    const vfs = getVirtualCaptureFS();
    const testDir = scratchRoot("snapshot-persistence", "integrity");
    vfs.mkdirSync(testDir, { recursive: true });

    const malformedFile = join(testDir, "bad.json");
    vfs.writeFileSync(malformedFile, "not-valid-json{{{");
    expect(() => loadSnapshotTree(malformedFile)).toThrow("Invalid JSON in snapshot tree file");

    const badSchemaFile = join(testDir, "bad-schema.json");
    vfs.writeFileSync(
      badSchemaFile,
      JSON.stringify({ schema: "snapshot.tree.v999", nodes: [] }),
    );
    expect(() => loadSnapshotTree(badSchemaFile)).toThrow("Unsupported snapshot tree schema");
  });

  it("loads empty snapshot tree when nodes array is empty", () => {
    const vfs = getVirtualCaptureFS();
    const testDir = scratchRoot("snapshot-persistence", "empty-nodes");
    vfs.mkdirSync(testDir, { recursive: true });
    const emptyFile = join(testDir, "empty.snapshot.json");

    vfs.writeFileSync(
      emptyFile,
      JSON.stringify({
        schema: "snapshot.tree.v1",
        version: 1,
        stats: { totalNodes: 0, maxDepth: 0, leafCount: 0, treeMerkleRoot: "" },
        nodes: [],
        persistedAt: new Date().toISOString(),
      }),
    );

    const loaded = loadSnapshotTree(emptyFile);
    expect(loaded.size()).toBe(0);
    expect(loaded.getRoot()).toBeNull();
  });

  it("persists and loads snapshot tree in deeply nested directories in virtual memory", () => {
    const vfs = getVirtualCaptureFS();
    const deepDir = join(
      scratchRoot("snapshot-persistence", "deep"),
      "level1",
      "level2",
      "level3",
    );
    vfs.mkdirSync(deepDir, { recursive: true });
    const deepFile = join(deepDir, "deep.snapshot.json");

    const tree = createSnapshotTree();
    const context = createSnapshotContext({
      viewport: { name: "desktop", width: 1440, height: 900 },
      url: "http://localhost:3000/",
      screenId: "deep-screen",
    });
    const physics = createDummyPhysics();
    tree.addRoot({ id: "root-deep", label: "Deep Root", context, physics });

    const res = persistSnapshotTree(tree, deepFile);
    expect(res.filePath).toBe(deepFile);
    expect(vfs.existsSync(deepFile)).toBe(true);

    const loaded = loadSnapshotTree(deepFile);
    expect(loaded.size()).toBe(1);
    expect(loaded.getRoot()?.id).toBe("root-deep");
  });
});

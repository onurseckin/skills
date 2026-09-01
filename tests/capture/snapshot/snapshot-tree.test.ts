import { describe, expect, it } from "bun:test";
import {
  compactSnapshotTree,
  createSnapshotTree,
  pruneSnapshotTree,
  SnapshotTree,
} from "../../../olt/scripts/src/capture/snapshot/index.ts";
import type { SnapshotContext } from "../../../olt/scripts/src/capture/snapshot/types.ts";
import type { DomPhysicsSnapshot } from "../../../olt/scripts/src/capture/runners/types.ts";

function createDummyContext(screenId = "home"): SnapshotContext {
  return {
    environment: {
      timestamp: new Date().toISOString(),
      platform: "darwin",
      runtime: "bun",
      runtimeVersion: "1.4.0",
      heapUsedBytes: 1000000,
      heapTotalBytes: 2000000,
      processUptimeSeconds: 10,
      environmentSha256: "0".repeat(64),
    },
    viewport: {
      name: "desktop",
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      isLandscape: true,
      hasTouch: false,
    },
    session: { authenticated: false },
    screenId,
    url: `http://localhost:3000/${screenId}`,
  };
}

function createDummyPhysics(): DomPhysicsSnapshot {
  return {
    viewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
    scrollPosition: { x: 0, y: 0 },
    capturedAt: new Date().toISOString(),
    elements: [
      {
        selector: "#app-header",
        tagName: "HEADER",
        bounds: { x: 0, y: 0, width: 1440, height: 80, top: 0, left: 0, right: 1440, bottom: 80 },
        computedStyles: {
          display: "flex",
          position: "relative",
          zIndex: "auto",
          color: "rgb(255, 255, 255)",
          backgroundColor: "rgb(0, 0, 0)",
          overflowX: "visible",
          overflowY: "visible",
        },
        metrics: {
          scrollWidth: 1440,
          scrollHeight: 80,
          clientWidth: 1440,
          clientHeight: 80,
          offsetWidth: 1440,
          offsetHeight: 80,
        },
      },
    ],
    layoutOverflows: [],
    textClippings: [],
  };
}

describe("SnapshotTree Management & Memory Leak Prevention", () => {
  it("creates tree and adds root node", () => {
    const tree = createSnapshotTree();
    const context = createDummyContext();
    const physics = createDummyPhysics();

    const root = tree.addRoot({
      id: "root-1",
      label: "Initial Render",
      context,
      physics,
    });

    expect(root.id).toBe("root-1");
    expect(root.depth).toBe(0);
    expect(root.sequence).toBe(1);
    expect(root.stateHash).toHaveLength(64);
    expect(tree.size()).toBe(1);
    expect(tree.getRoot()?.id).toBe("root-1");
  });

  it("adds hierarchical children and updates parent references", () => {
    const tree = new SnapshotTree();
    const context = createDummyContext();
    const physics = createDummyPhysics();

    tree.addRoot({ id: "root", label: "Root", context, physics });

    const step1 = tree.addChild({
      id: "step-1",
      parentId: "root",
      label: "Click Button",
      context,
      physics,
    });

    const step2 = tree.addChild({
      id: "step-2",
      parentId: "step-1",
      label: "Modal Open",
      context,
      physics,
    });

    expect(step1.depth).toBe(1);
    expect(step2.depth).toBe(2);
    expect(tree.size()).toBe(3);

    const rootChildren = tree.getChildren("root");
    expect(rootChildren.length).toBe(1);
    expect(rootChildren[0]?.id).toBe("step-1");

    const step1Children = tree.getChildren("step-1");
    expect(step1Children.length).toBe(1);
    expect(step1Children[0]?.id).toBe("step-2");
  });

  it("enforces max depth and max node bounds to prevent unbounded memory retention", () => {
    const depthTree = new SnapshotTree({ maxNodes: 10, maxDepth: 2 });
    const context = createDummyContext();
    const physics = createDummyPhysics();

    depthTree.addRoot({ id: "root", label: "Root", context, physics });
    depthTree.addChild({ id: "node-1", parentId: "root", label: "L1", context, physics });
    depthTree.addChild({ id: "node-2", parentId: "node-1", label: "L2", context, physics });

    expect(() =>
      depthTree.addChild({ id: "node-3", parentId: "node-2", label: "L3", context, physics }),
    ).toThrow("exceeds maximum depth 2");

    const nodeTree = new SnapshotTree({ maxNodes: 2, maxDepth: 10 });
    nodeTree.addRoot({ id: "root", label: "Root", context, physics });
    nodeTree.addChild({ id: "node-1", parentId: "root", label: "L1", context, physics });
    expect(() =>
      nodeTree.addChild({ id: "node-2", parentId: "root", label: "L2", context, physics }),
    ).toThrow("exceeded maximum node limit of 2");
  });

  it("removes subtrees cleanly and updates parent references", () => {
    const tree = new SnapshotTree();
    const context = createDummyContext();
    const physics = createDummyPhysics();

    tree.addRoot({ id: "root", label: "Root", context, physics });
    tree.addChild({ id: "branch-a", parentId: "root", label: "Branch A", context, physics });
    tree.addChild({ id: "leaf-a1", parentId: "branch-a", label: "Leaf A1", context, physics });
    tree.addChild({ id: "branch-b", parentId: "root", label: "Branch B", context, physics });

    expect(tree.size()).toBe(4);

    const removed = tree.removeSubtree("branch-a");
    expect(removed).toEqual(["branch-a", "leaf-a1"]);
    expect(tree.size()).toBe(2);
    expect(tree.getChildren("root").map((n) => n.id)).toEqual(["branch-b"]);
  });

  it("disposes tree completely and prevents operations on disposed instance", () => {
    const tree = new SnapshotTree();
    const context = createDummyContext();
    const physics = createDummyPhysics();

    tree.addRoot({ id: "root", label: "Root", context, physics });
    tree.addChild({ id: "node-1", parentId: "root", label: "Node 1", context, physics });

    expect(tree.isDisposed).toBe(false);
    tree.dispose();

    expect(tree.isDisposed).toBe(true);
    expect(() => tree.size()).toThrow("disposed");
    expect(() => tree.getRoot()).toThrow("disposed");
    expect(() =>
      tree.addChild({ id: "node-2", parentId: "root", label: "Node 2", context, physics }),
    ).toThrow("disposed");
  });

  it("prunes tree by max age, depth, and max node limit (LRU leaf pruning)", async () => {
    const emptyTree = new SnapshotTree();
    expect(pruneSnapshotTree(emptyTree)).toEqual({
      prunedNodeIds: [],
      retainedNodeCount: 0,
      bytesReleasedEstimated: 0,
    });

    const tree = new SnapshotTree();
    const context = createDummyContext();
    const physics = createDummyPhysics();

    tree.addRoot({ id: "root", label: "Root", context, physics });
    for (let i = 1; i <= 6; i++) {
      tree.addChild({ id: `leaf-${i}`, parentId: "root", label: `Leaf ${i}`, context, physics });
    }

    // Depth pruning
    tree.addChild({ id: "deep-1", parentId: "leaf-1", label: "Deep 1", context, physics });
    const depthRes = pruneSnapshotTree(tree, { maxDepth: 1, preserveRoot: true });
    expect(depthRes.prunedNodeIds).toContain("deep-1");

    // Age pruning
    const ageRes = pruneSnapshotTree(tree, { maxAgeMs: 1000000, preserveRoot: true });
    expect(ageRes.prunedNodeIds.length).toBe(0);

    await new Promise((resolve) => setTimeout(resolve, 10));
    const oldAgeRes = pruneSnapshotTree(tree, { maxAgeMs: 5, preserveRoot: true });
    expect(oldAgeRes.prunedNodeIds.length).toBeGreaterThan(0);

    // Node limit pruning
    const tree2 = new SnapshotTree();
    tree2.addRoot({ id: "root2", label: "Root 2", context, physics });
    for (let i = 1; i <= 6; i++) {
      tree2.addChild({ id: `l-${i}`, parentId: "root2", label: `L ${i}`, context, physics });
    }
    const result = pruneSnapshotTree(tree2, { maxNodes: 4, preserveRoot: true });
    expect(result.retainedNodeCount).toBe(4);
    expect(result.prunedNodeIds.length).toBe(3);
    expect(tree2.size()).toBe(4);
  });

  it("compacts tree into a new isolated snapshot tree instance", () => {
    const tree = new SnapshotTree();
    const context = createDummyContext();
    const physics = createDummyPhysics();

    tree.addRoot({ id: "root", label: "Root", context, physics });
    tree.addChild({ id: "child-1", parentId: "root", label: "Child 1", context, physics });

    const compacted = compactSnapshotTree(tree);
    expect(compacted.size()).toBe(2);
    expect(compacted.getRoot()?.id).toBe("root");
    expect(compacted.getChildren("root")[0]?.id).toBe("child-1");

    tree.dispose();
    expect(tree.isDisposed).toBe(true);
    expect(compacted.isDisposed).toBe(false);
    expect(compacted.size()).toBe(2);
  });
});

import { SnapshotTree } from "./snapshot-tree.ts";
import type { SnapshotNode, SnapshotPruneOptions, SnapshotPruneResult } from "./types.ts";

export function pruneSnapshotTree(
  tree: SnapshotTree,
  options: SnapshotPruneOptions = {},
): SnapshotPruneResult {
  if (tree.isDisposed || tree.size() === 0) {
    return {
      prunedNodeIds: [],
      retainedNodeCount: 0,
      bytesReleasedEstimated: 0,
    };
  }

  const prunedNodeIds: string[] = [];
  let bytesReleased = 0;
  const now = Date.now();
  const root = tree.getRoot();
  const preserveRoot = options.preserveRoot ?? true;

  // 1. Prune by max age
  if (options.maxAgeMs !== undefined && options.maxAgeMs > 0) {
    const allNodes = tree.getAllNodes();
    for (const node of allNodes) {
      if (preserveRoot && node.id === root?.id) continue;
      const nodeTime = new Date(node.createdAt).getTime();
      if (now - nodeTime > options.maxAgeMs) {
        const removed = tree.removeSubtree(node.id);
        prunedNodeIds.push(...removed);
      }
    }
  }

  // 2. Prune by max depth
  if (options.maxDepth !== undefined && options.maxDepth >= 0) {
    const allNodes = tree.getAllNodes();
    for (const node of allNodes) {
      if (preserveRoot && node.id === root?.id) continue;
      if (node.depth > options.maxDepth) {
        const removed = tree.removeSubtree(node.id);
        prunedNodeIds.push(...removed);
      }
    }
  }

  // 3. Prune by max nodes (LRU / oldest sequence pruning)
  if (options.maxNodes !== undefined && options.maxNodes > 0) {
    while (tree.size() > options.maxNodes) {
      const allNodes = tree.getAllNodes();
      // Find candidate non-root leaf nodes with lowest sequence number
      const leafCandidates = allNodes.filter(
        (n) => (!preserveRoot || n.id !== root?.id) && n.children.length === 0,
      );
      if (leafCandidates.length === 0) break;
      leafCandidates.sort((a, b) => a.sequence - b.sequence);
      const oldestLeaf = leafCandidates[0];
      if (!oldestLeaf) break;
      const removed = tree.removeSubtree(oldestLeaf.id);
      prunedNodeIds.push(...removed);
    }
  }

  const uniquePruned = Array.from(new Set(prunedNodeIds));
  bytesReleased = uniquePruned.length * 1024;

  return {
    prunedNodeIds: uniquePruned,
    retainedNodeCount: tree.size(),
    bytesReleasedEstimated: bytesReleased,
  };
}

export function compactSnapshotTree(sourceTree: SnapshotTree): SnapshotTree {
  const newTree = new SnapshotTree();
  const root = sourceTree.getRoot();
  if (!root) return newTree;

  newTree.addRoot({
    id: root.id,
    label: root.label,
    context: root.context,
    physics: root.physics,
  });

  const queue: SnapshotNode[] = [root];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const children = sourceTree.getChildren(current.id);
    for (const child of children) {
      newTree.addChild({
        id: child.id,
        parentId: current.id,
        label: child.label,
        context: child.context,
        physics: child.physics,
      });
      queue.push(child);
    }
  }

  return newTree;
}

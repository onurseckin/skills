import type { DomPhysicsSnapshot } from "../runners/types.ts";
import { computeMerkleRoot, computeNodeStateHash } from "./state-hasher.ts";
import type { SnapshotContext, SnapshotNode, SnapshotTreeStats } from "./types.ts";

export interface SnapshotTreeOptions {
  readonly maxNodes?: number | undefined;
  readonly maxDepth?: number | undefined;
}

export class SnapshotTree {
  private readonly nodes = new Map<string, SnapshotNode>();
  private readonly childrenMap = new Map<string, string[]>();
  private rootId: string | null = null;
  private sequenceCounter = 0;
  private isDisposedState = false;
  private readonly maxNodes: number;
  private readonly maxDepth: number;

  public constructor(options: SnapshotTreeOptions = {}) {
    this.maxNodes = options.maxNodes ?? 2000;
    this.maxDepth = options.maxDepth ?? 64;
  }

  public get isDisposed(): boolean {
    return this.isDisposedState;
  }

  private assertNotDisposed(): void {
    if (this.isDisposedState) {
      throw new Error("Cannot operate on disposed SnapshotTree instance");
    }
  }

  public addRoot(params: {
    readonly id: string;
    readonly label: string;
    readonly context: SnapshotContext;
    readonly physics: DomPhysicsSnapshot;
  }): SnapshotNode {
    this.assertNotDisposed();
    if (this.rootId !== null) {
      throw new Error(`SnapshotTree already has root node '${this.rootId}'`);
    }
    if (this.nodes.has(params.id)) {
      throw new Error(`Node '${params.id}' already exists in tree`);
    }

    this.sequenceCounter += 1;
    const stateHash = computeNodeStateHash({
      context: params.context,
      physics: params.physics,
      label: params.label,
      sequence: this.sequenceCounter,
    });
    const merkleRoot = computeMerkleRoot([stateHash]);

    const node: SnapshotNode = {
      id: params.id,
      label: params.label,
      sequence: this.sequenceCounter,
      createdAt: new Date().toISOString(),
      depth: 0,
      context: params.context,
      physics: params.physics,
      stateHash,
      merkleRoot,
      children: [],
    };

    this.nodes.set(node.id, node);
    this.childrenMap.set(node.id, []);
    this.rootId = node.id;
    return node;
  }

  public addChild(params: {
    readonly id: string;
    readonly parentId: string;
    readonly label: string;
    readonly context: SnapshotContext;
    readonly physics: DomPhysicsSnapshot;
  }): SnapshotNode {
    this.assertNotDisposed();
    if (this.nodes.size >= this.maxNodes) {
      throw new Error(`SnapshotTree exceeded maximum node limit of ${this.maxNodes} nodes`);
    }
    if (this.nodes.has(params.id)) {
      throw new Error(`Node '${params.id}' already exists in tree`);
    }
    const parent = this.nodes.get(params.parentId);
    if (!parent) {
      throw new Error(`Parent node '${params.parentId}' does not exist in tree`);
    }
    const nodeDepth = parent.depth + 1;
    if (nodeDepth > this.maxDepth) {
      throw new Error(`SnapshotTree depth ${nodeDepth} exceeds maximum depth ${this.maxDepth}`);
    }

    this.sequenceCounter += 1;
    const stateHash = computeNodeStateHash({
      context: params.context,
      physics: params.physics,
      label: params.label,
      sequence: this.sequenceCounter,
    });
    const merkleRoot = computeMerkleRoot([stateHash]);

    const node: SnapshotNode = {
      id: params.id,
      parentId: params.parentId,
      label: params.label,
      sequence: this.sequenceCounter,
      createdAt: new Date().toISOString(),
      depth: nodeDepth,
      context: params.context,
      physics: params.physics,
      stateHash,
      merkleRoot,
      children: [],
    };

    this.nodes.set(node.id, node);
    this.childrenMap.set(node.id, []);

    const siblingList = this.childrenMap.get(params.parentId) ?? [];
    siblingList.push(node.id);
    this.childrenMap.set(params.parentId, siblingList);

    const updatedParent: SnapshotNode = {
      ...parent,
      children: [...siblingList],
    };
    this.nodes.set(parent.id, updatedParent);

    return node;
  }

  public getNode(id: string): SnapshotNode | undefined {
    this.assertNotDisposed();
    return this.nodes.get(id);
  }

  public getRoot(): SnapshotNode | null {
    this.assertNotDisposed();
    if (!this.rootId) return null;
    return this.nodes.get(this.rootId) ?? null;
  }

  public getChildren(id: string): readonly SnapshotNode[] {
    this.assertNotDisposed();
    const childIds = this.childrenMap.get(id) ?? [];
    return childIds
      .map((childId) => this.nodes.get(childId))
      .filter((n): n is SnapshotNode => n !== undefined);
  }

  public getAllNodes(): readonly SnapshotNode[] {
    this.assertNotDisposed();
    return Array.from(this.nodes.values());
  }

  public size(): number {
    this.assertNotDisposed();
    return this.nodes.size;
  }

  public computeTreeMerkleRoot(): string {
    this.assertNotDisposed();
    if (this.nodes.size === 0) return "0".repeat(64);
    const allStateHashes = Array.from(this.nodes.values()).map((n) => n.stateHash);
    return computeMerkleRoot(allStateHashes);
  }

  public getStats(): SnapshotTreeStats {
    this.assertNotDisposed();
    let maxD = 0;
    let approxBytes = 0;
    for (const node of this.nodes.values()) {
      if (node.depth > maxD) maxD = node.depth;
      approxBytes += JSON.stringify(node).length * 2;
    }
    return {
      totalNodes: this.nodes.size,
      maxDepth: maxD,
      rootId: this.rootId ?? "",
      treeMerkleRoot: this.computeTreeMerkleRoot(),
      memorySizeBytesEstimated: approxBytes,
      isDisposed: false,
    };
  }

  public removeSubtree(nodeId: string): readonly string[] {
    this.assertNotDisposed();
    if (!this.nodes.has(nodeId)) return [];
    if (nodeId === this.rootId) {
      const removed = Array.from(this.nodes.keys());
      this.nodes.clear();
      this.childrenMap.clear();
      this.rootId = null;
      return removed;
    }

    const removedIds: string[] = [];
    const queue = [nodeId];
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (!this.nodes.has(currentId)) continue;
      removedIds.push(currentId);
      const childIds = this.childrenMap.get(currentId) ?? [];
      for (const cid of childIds) {
        queue.push(cid);
      }
      this.nodes.delete(currentId);
      this.childrenMap.delete(currentId);
    }

    // Detach from parent's children list
    for (const [pId, children] of this.childrenMap.entries()) {
      if (children.includes(nodeId)) {
        const filtered = children.filter((c) => c !== nodeId);
        this.childrenMap.set(pId, filtered);
        const parentNode = this.nodes.get(pId);
        if (parentNode) {
          this.nodes.set(pId, { ...parentNode, children: filtered });
        }
      }
    }

    return removedIds;
  }

  public dispose(): void {
    if (this.isDisposedState) return;
    this.nodes.clear();
    this.childrenMap.clear();
    this.rootId = null;
    this.isDisposedState = true;
  }
}

export function createSnapshotTree(options?: SnapshotTreeOptions): SnapshotTree {
  return new SnapshotTree(options);
}

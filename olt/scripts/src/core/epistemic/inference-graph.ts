import { calculateEpistemicGrade, clamp } from "./math.ts";
import type {
  EpistemicGrade,
  InferenceEdge,
  InferenceGraphSnapshot,
  InferenceNode,
  InferenceNodeKind,
} from "./types.ts";

export interface AddNodeOptions {
  readonly kind?: InferenceNodeKind | undefined;
  readonly label?: string | undefined;
  readonly confidence?: number | undefined;
  readonly metadata?: Record<string, unknown> | undefined;
}

export class InferenceGraph {
  private readonly nodes = new Map<string, InferenceNode>();
  private readonly outgoing = new Map<string, Map<string, number>>();
  private readonly incoming = new Map<string, Map<string, number>>();

  public addNode(id: string, options: AddNodeOptions = {}): InferenceNode {
    const confidence = clamp(options.confidence ?? 0, 0, 1);
    const grade = calculateEpistemicGrade(confidence);
    const node: InferenceNode = {
      id,
      kind: options.kind ?? "evidence",
      label: options.label ?? id,
      confidence,
      grade,
      isStale: false,
      updatedAt: Date.now(),
      metadata: options.metadata,
    };
    this.nodes.set(id, node);
    if (!this.outgoing.has(id)) this.outgoing.set(id, new Map());
    if (!this.incoming.has(id)) this.incoming.set(id, new Map());
    return node;
  }

  public getNode(id: string): InferenceNode | undefined {
    return this.nodes.get(id);
  }
  public hasNode(id: string): boolean {
    return this.nodes.has(id);
  }

  public removeNode(id: string): boolean {
    if (!this.nodes.has(id)) return false;
    const outEdges = this.outgoing.get(id);
    if (outEdges) {
      for (const targetId of outEdges.keys()) {
        this.incoming.get(targetId)?.delete(id);
      }
    }
    const inEdges = this.incoming.get(id);
    if (inEdges) {
      for (const sourceId of inEdges.keys()) {
        this.outgoing.get(sourceId)?.delete(id);
      }
    }
    this.outgoing.delete(id);
    this.incoming.delete(id);
    return this.nodes.delete(id);
  }

  public addEdge(sourceId: string, targetId: string, weight = 1.0): boolean {
    if (!this.nodes.has(sourceId) || !this.nodes.has(targetId) || sourceId === targetId) {
      return false;
    }
    const normalizedWeight = clamp(weight, 0, 1);
    let outMap = this.outgoing.get(sourceId);
    if (!outMap) {
      outMap = new Map();
      this.outgoing.set(sourceId, outMap);
    }
    outMap.set(targetId, normalizedWeight);

    let inMap = this.incoming.get(targetId);
    if (!inMap) {
      inMap = new Map();
      this.incoming.set(targetId, inMap);
    }
    inMap.set(sourceId, normalizedWeight);
    this.markStale(targetId);
    return true;
  }

  public removeEdge(sourceId: string, targetId: string): boolean {
    const outMap = this.outgoing.get(sourceId);
    const inMap = this.incoming.get(targetId);
    const removedOut = outMap ? outMap.delete(targetId) : false;
    const removedIn = inMap ? inMap.delete(sourceId) : false;
    if (removedOut || removedIn) {
      this.markStale(targetId);
      return true;
    }
    return false;
  }

  public updateNodeConfidence(id: string, confidence: number): InferenceNode | undefined {
    const existing = this.nodes.get(id);
    if (!existing) return undefined;
    const normalized = clamp(confidence, 0, 1);
    const updated: InferenceNode = {
      ...existing,
      confidence: normalized,
      grade: calculateEpistemicGrade(normalized),
      isStale: false,
      updatedAt: Date.now(),
    };
    this.nodes.set(id, updated);
    this.markDownstreamStale(id);
    return updated;
  }

  public markStale(id: string): readonly string[] {
    const existing = this.nodes.get(id);
    if (!existing) return [];
    const affected: string[] = [];
    const queue = [id];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (visited.has(currentId)) continue;
      visited.add(currentId);
      const node = this.nodes.get(currentId);
      if (node) {
        this.nodes.set(currentId, { ...node, isStale: true, updatedAt: Date.now() });
        affected.push(currentId);
      }
      const outMap = this.outgoing.get(currentId);
      if (outMap) {
        for (const targetId of outMap.keys()) {
          if (!visited.has(targetId)) queue.push(targetId);
        }
      }
    }
    return affected;
  }

  private markDownstreamStale(id: string): readonly string[] {
    const outMap = this.outgoing.get(id);
    if (!outMap || outMap.size === 0) return [];
    const affected: string[] = [];
    for (const targetId of outMap.keys()) {
      affected.push(...this.markStale(targetId));
    }
    return affected;
  }

  public recomputeNode(id: string): InferenceNode | undefined {
    const targetNode = this.nodes.get(id);
    if (!targetNode) return undefined;
    if (targetNode.kind === "axiom" || targetNode.kind === "evidence") {
      const freshNode: InferenceNode = { ...targetNode, isStale: false, updatedAt: Date.now() };
      this.nodes.set(id, freshNode);
      return freshNode;
    }
    const inMap = this.incoming.get(id);
    if (!inMap || inMap.size === 0) {
      const freshNode: InferenceNode = { ...targetNode, isStale: false, updatedAt: Date.now() };
      this.nodes.set(id, freshNode);
      return freshNode;
    }
    let totalWeight = 0;
    let weightedSum = 0;
    for (const [sourceId, edgeWeight] of inMap.entries()) {
      const sourceNode = this.nodes.get(sourceId);
      if (sourceNode) {
        if (sourceNode.isStale) this.recomputeNode(sourceId);
        const updatedSource = this.nodes.get(sourceId);
        const sourceConfidence = updatedSource ? updatedSource.confidence : 0;
        weightedSum += sourceConfidence * edgeWeight;
        totalWeight += edgeWeight;
      }
    }
    const newConfidence = totalWeight > 0 ? clamp(weightedSum / totalWeight, 0, 1) : 0;
    const updated: InferenceNode = {
      ...targetNode,
      confidence: newConfidence,
      grade: calculateEpistemicGrade(newConfidence),
      isStale: false,
      updatedAt: Date.now(),
    };
    this.nodes.set(id, updated);
    return updated;
  }

  public propagateAll(): readonly string[] {
    const order = this.topologicalSort();
    const updated: string[] = [];
    for (const nodeId of order) {
      const node = this.nodes.get(nodeId);
      if (node && node.isStale) {
        this.recomputeNode(nodeId);
        updated.push(nodeId);
      }
    }
    return updated;
  }

  public topologicalSort(): readonly string[] {
    const inDegrees = new Map<string, number>();
    for (const id of this.nodes.keys()) {
      const inMap = this.incoming.get(id);
      inDegrees.set(id, inMap ? inMap.size : 0);
    }
    const queue: string[] = [];
    for (const [id, deg] of inDegrees.entries()) {
      if (deg === 0) queue.push(id);
    }
    const order: string[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      order.push(current);
      const outMap = this.outgoing.get(current);
      if (outMap) {
        for (const targetId of outMap.keys()) {
          const nextInDeg = (inDegrees.get(targetId) ?? 1) - 1;
          inDegrees.set(targetId, nextInDeg);
          if (nextInDeg === 0) queue.push(targetId);
        }
      }
    }
    if (order.length < this.nodes.size) {
      for (const id of this.nodes.keys()) {
        if (!order.includes(id)) order.push(id);
      }
    }
    return order;
  }

  public hasCycle(): boolean {
    const order = this.topologicalSort();
    return order.length !== this.nodes.size;
  }

  public getDownstreamDependents(nodeId: string): readonly string[] {
    const visited = new Set<string>();
    const queue = [nodeId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const outMap = this.outgoing.get(current);
      if (outMap) {
        for (const target of outMap.keys()) {
          if (!visited.has(target)) {
            visited.add(target);
            queue.push(target);
          }
        }
      }
    }
    return Array.from(visited);
  }

  public getUpstreamDependencies(nodeId: string): readonly string[] {
    const visited = new Set<string>();
    const queue = [nodeId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const inMap = this.incoming.get(current);
      if (inMap) {
        for (const source of inMap.keys()) {
          if (!visited.has(source)) {
            visited.add(source);
            queue.push(source);
          }
        }
      }
    }
    return Array.from(visited);
  }

  public snapshot(): InferenceGraphSnapshot {
    const nodes = Array.from(this.nodes.values());
    const edges: InferenceEdge[] = [];
    for (const [sourceId, targetMap] of this.outgoing.entries()) {
      for (const [targetId, weight] of targetMap.entries()) {
        edges.push({ sourceId, targetId, weight });
      }
    }
    return { nodes, edges, timestamp: Date.now() };
  }

  public size(): number {
    return this.nodes.size;
  }
}

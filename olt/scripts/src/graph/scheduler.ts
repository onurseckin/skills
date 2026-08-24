export interface GraphNode {
  readonly id: string;
  readonly dependencies: readonly string[];
}

export class GraphScheduler {
  private readonly nodes = new Map<string, GraphNode>();
  private readonly completed = new Set<string>();

  public addNode(node: GraphNode): void {
    this.nodes.set(node.id, node);
  }

  public completeNode(id: string): void {
    if (!this.nodes.has(id)) {
      throw new Error(`Node not found: ${id}`);
    }
    this.completed.add(id);
  }

  public getReadyNodes(): readonly GraphNode[] {
    const ready: GraphNode[] = [];
    for (const node of this.nodes.values()) {
      if (this.completed.has(node.id)) {
        continue;
      }
      const allDepsMet = node.dependencies.every((dep) => this.completed.has(dep));
      if (allDepsMet) {
        ready.push(node);
      }
    }
    return ready;
  }
}

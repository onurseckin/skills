/**
 * Epistemic Supersession Index
 *
 * Tracks the epistemic validity and supersession lineage of semantic memory entries.
 * Manages states (ACTIVE, SUPERSEDED, DEPRECATED), resolves terminal active successors,
 * detects supersession graph cycles, and provides full lineage traversal.
 */

export type EpistemicStatus = "ACTIVE" | "SUPERSEDED" | "DEPRECATED";

export const EPISTEMIC_STATUSES: readonly EpistemicStatus[] = [
  "ACTIVE",
  "SUPERSEDED",
  "DEPRECATED",
] as const;

export function isEpistemicStatus(value: unknown): value is EpistemicStatus {
  return (
    typeof value === "string" &&
    (value === "ACTIVE" || value === "SUPERSEDED" || value === "DEPRECATED")
  );
}

export interface SupersessionNode {
  readonly id: string;
  readonly title: string;
  readonly status: EpistemicStatus;
  readonly supersededBy?: string | undefined;
  readonly supersedes?: readonly string[] | undefined;
  readonly successorInvariantId?: string | undefined;
  readonly reason?: string | undefined;
  readonly timestamp: string;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface RegisterSupersessionNodeOptions {
  readonly id: string;
  readonly title: string;
  readonly status?: EpistemicStatus | undefined;
  readonly supersededBy?: string | undefined;
  readonly supersedes?: readonly string[] | undefined;
  readonly successorInvariantId?: string | undefined;
  readonly reason?: string | undefined;
  readonly timestamp?: string | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface LineageValidationResult {
  readonly valid: boolean;
  readonly cycles: readonly (readonly string[])[];
}

export interface SupersessionIndexState {
  readonly version: number;
  readonly exportedAt: string;
  readonly nodes: readonly SupersessionNode[];
}

export class SupersessionIndex {
  private readonly nodes = new Map<string, SupersessionNode>();

  public constructor(
    initialNodes?: readonly (SupersessionNode | RegisterSupersessionNodeOptions)[],
  ) {
    if (initialNodes && initialNodes.length > 0) {
      for (const node of initialNodes) {
        this.registerEntry(node);
      }
    }
  }

  /**
   * Registers or updates an entry in the supersession index.
   */
  public registerEntry(
    options: RegisterSupersessionNodeOptions | SupersessionNode,
  ): SupersessionNode {
    const id = options.id.trim();
    if (!id) {
      throw new Error("SupersessionNode id cannot be empty.");
    }
    const title = options.title.trim() || id;
    const existing = this.nodes.get(id);

    const status: EpistemicStatus = options.status ?? existing?.status ?? "ACTIVE";
    const timestamp = options.timestamp ?? existing?.timestamp ?? new Date().toISOString();

    const supersedesList = Array.from(
      new Set([...(existing?.supersedes ?? []), ...(options.supersedes ?? [])]),
    );

    const mergedNode: SupersessionNode = {
      id,
      title,
      status,
      supersededBy: options.supersededBy ?? existing?.supersededBy,
      supersedes: supersedesList.length > 0 ? supersedesList : undefined,
      successorInvariantId: options.successorInvariantId ?? existing?.successorInvariantId,
      reason: options.reason ?? existing?.reason,
      timestamp,
      metadata: options.metadata ?? existing?.metadata,
    };

    this.nodes.set(id, mergedNode);

    // If this node supersedes other entries, update those entries to point to this node
    if (options.supersedes && options.supersedes.length > 0) {
      for (const supersededId of options.supersedes) {
        if (supersededId && supersededId !== id) {
          const prior = this.nodes.get(supersededId);
          if (prior) {
            this.nodes.set(supersededId, {
              ...prior,
              status: "SUPERSEDED",
              supersededBy: id,
              reason: options.reason ?? prior.reason ?? `Superseded by ${id}`,
            });
          } else {
            // Register placeholder for superseded node if not yet present
            this.nodes.set(supersededId, {
              id: supersededId,
              title: supersededId,
              status: "SUPERSEDED",
              supersededBy: id,
              reason: options.reason ?? `Superseded by ${id}`,
              timestamp,
            });
          }
        }
      }
    }

    return mergedNode;
  }

  /**
   * Retrieves a node by ID.
   */
  public getEntry(id: string): SupersessionNode | undefined {
    return this.nodes.get(id);
  }

  /**
   * Checks if an entry exists.
   */
  public hasEntry(id: string): boolean {
    return this.nodes.has(id);
  }

  /**
   * Returns all registered nodes.
   */
  public getAllEntries(): readonly SupersessionNode[] {
    return Array.from(this.nodes.values());
  }

  /**
   * Returns total count of indexed nodes.
   */
  public size(): number {
    return this.nodes.size;
  }

  /**
   * Explicitly marks an entry as superseded by a successor node/invariant.
   */
  public markSuperseded(
    targetId: string,
    successorId: string,
    reason?: string,
    invariantId?: string,
  ): boolean {
    const trimmedTarget = targetId.trim();
    const trimmedSuccessor = successorId.trim();
    if (!trimmedTarget || !trimmedSuccessor) {
      return false;
    }

    const existingTarget = this.nodes.get(trimmedTarget);
    const updatedTarget: SupersessionNode = {
      id: trimmedTarget,
      title: existingTarget?.title ?? trimmedTarget,
      status: "SUPERSEDED",
      supersededBy: trimmedSuccessor,
      supersedes: existingTarget?.supersedes,
      successorInvariantId: invariantId ?? existingTarget?.successorInvariantId,
      reason: reason ?? existingTarget?.reason ?? `Superseded by ${trimmedSuccessor}`,
      timestamp: existingTarget?.timestamp ?? new Date().toISOString(),
      metadata: existingTarget?.metadata,
    };
    this.nodes.set(trimmedTarget, updatedTarget);

    // Update successor node's supersedes list
    const existingSuccessor = this.nodes.get(trimmedSuccessor);
    if (existingSuccessor) {
      const priorSupersedes = existingSuccessor.supersedes ?? [];
      if (!priorSupersedes.includes(trimmedTarget)) {
        this.nodes.set(trimmedSuccessor, {
          ...existingSuccessor,
          supersedes: [...priorSupersedes, trimmedTarget],
        });
      }
    } else {
      this.nodes.set(trimmedSuccessor, {
        id: trimmedSuccessor,
        title: trimmedSuccessor,
        status: "ACTIVE",
        supersedes: [trimmedTarget],
        timestamp: new Date().toISOString(),
      });
    }

    return true;
  }

  /**
   * Marks an entry as deprecated without a direct successor.
   */
  public markDeprecated(targetId: string, reason?: string): boolean {
    const trimmedTarget = targetId.trim();
    if (!trimmedTarget) {
      return false;
    }

    const existing = this.nodes.get(trimmedTarget);
    const updated: SupersessionNode = {
      id: trimmedTarget,
      title: existing?.title ?? trimmedTarget,
      status: "DEPRECATED",
      supersededBy: existing?.supersededBy,
      supersedes: existing?.supersedes,
      successorInvariantId: existing?.successorInvariantId,
      reason: reason ?? existing?.reason ?? "Deprecated",
      timestamp: existing?.timestamp ?? new Date().toISOString(),
      metadata: existing?.metadata,
    };
    this.nodes.set(trimmedTarget, updated);
    return true;
  }

  /**
   * Returns the lineage path starting from entryId and traversing through supersededBy pointers.
   * e.g., [entryId, successor1, successor2, ...]
   */
  public getSuccessorLineage(entryId: string): string[] {
    const path: string[] = [];
    const visited = new Set<string>();
    let currentId: string | undefined = entryId.trim();

    while (currentId && !visited.has(currentId)) {
      path.push(currentId);
      visited.add(currentId);

      const node = this.nodes.get(currentId);
      if (!node) {
        break;
      }

      if (node.supersededBy && node.supersededBy !== currentId) {
        currentId = node.supersededBy;
      } else if (
        node.successorInvariantId &&
        node.successorInvariantId !== currentId &&
        !visited.has(node.successorInvariantId)
      ) {
        path.push(node.successorInvariantId);
        break;
      } else {
        break;
      }
    }

    return path;
  }

  /**
   * Resolves the terminal active successor for an entry.
   * If entry is already ACTIVE and has no successor, returns the entry.
   * If entry is SUPERSEDED, follows the chain to the latest active node or invariant.
   */
  public getTerminalSuccessor(entryId: string): SupersessionNode | null {
    const lineage = this.getSuccessorLineage(entryId);
    if (lineage.length === 0) {
      return null;
    }

    // Traverse from latest to earliest in lineage to find the highest-ranking active node
    for (let i = lineage.length - 1; i >= 0; i -= 1) {
      const candidateId = lineage[i];
      if (candidateId) {
        const candidateNode = this.nodes.get(candidateId);
        if (candidateNode && candidateNode.status === "ACTIVE") {
          return candidateNode;
        }
      }
    }

    // If no active successor found, return the last known node in the chain
    const lastId = lineage[lineage.length - 1];
    if (lastId) {
      return this.nodes.get(lastId) ?? null;
    }

    return null;
  }

  /**
   * Checks whether an entry is obsolete (SUPERSEDED or DEPRECATED).
   */
  public isObsolete(entryId: string): boolean {
    const node = this.nodes.get(entryId.trim());
    if (!node) {
      return false;
    }
    return node.status === "SUPERSEDED" || node.status === "DEPRECATED";
  }

  /**
   * Retrieves the epistemic status of an entry. Defaults to ACTIVE if not indexed.
   */
  public getEpistemicStatus(entryId: string): EpistemicStatus {
    const node = this.nodes.get(entryId.trim());
    return node ? node.status : "ACTIVE";
  }

  /**
   * Validates acyclicity of the supersession graph.
   * Detects cycles in supersededBy pointers.
   */
  public validateLineageAcyclicity(): LineageValidationResult {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const recStack = new Set<string>();
    const pathStack: string[] = [];

    const dfs = (nodeId: string): void => {
      visited.add(nodeId);
      recStack.add(nodeId);
      pathStack.push(nodeId);

      const node = this.nodes.get(nodeId);
      if (node?.supersededBy) {
        const nextId = node.supersededBy;
        if (!visited.has(nextId)) {
          dfs(nextId);
        } else if (recStack.has(nextId)) {
          // Cycle found
          const cycleStartIdx = pathStack.indexOf(nextId);
          if (cycleStartIdx !== -1) {
            const cyclePath = [...pathStack.slice(cycleStartIdx), nextId];
            cycles.push(cyclePath);
          } else {
            cycles.push([nodeId, nextId]);
          }
        }
      }

      pathStack.pop();
      recStack.delete(nodeId);
    };

    for (const nodeId of this.nodes.keys()) {
      if (!visited.has(nodeId)) {
        dfs(nodeId);
      }
    }

    return {
      valid: cycles.length === 0,
      cycles,
    };
  }

  /**
   * Exports index state for serialization.
   */
  public exportState(): SupersessionIndexState {
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      nodes: Array.from(this.nodes.values()),
    };
  }

  /**
   * Imports state into the index, overwriting or merging nodes.
   */
  public importState(state: SupersessionIndexState): void {
    if (!state || !Array.isArray(state.nodes)) {
      throw new Error("Invalid SupersessionIndexState: nodes array is required.");
    }
    for (const node of state.nodes) {
      if (node && typeof node.id === "string") {
        this.registerEntry(node);
      }
    }
  }

  /**
   * Serializes index to JSON string.
   */
  public toJSON(indent = 2): string {
    return JSON.stringify(this.exportState(), null, indent);
  }

  /**
   * Creates a new SupersessionIndex from serialized JSON.
   */
  public static fromJSON(jsonStr: string): SupersessionIndex {
    const parsed = JSON.parse(jsonStr) as SupersessionIndexState;
    const index = new SupersessionIndex();
    index.importState(parsed);
    return index;
  }

  /**
   * Creates a new SupersessionIndex from state object.
   */
  public static fromState(state: SupersessionIndexState): SupersessionIndex {
    const index = new SupersessionIndex();
    index.importState(state);
    return index;
  }
}

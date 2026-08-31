import { HarnessError } from "../../core/errors/index.ts";
import type { CapsuleSpec } from "./types.ts";

export class MultiCapsuleDAG {
  private readonly specsMap: Map<string, CapsuleSpec> = new Map();
  private readonly adjacency: Map<string, Set<string>> = new Map();
  private readonly reverseAdjacency: Map<string, Set<string>> = new Map();

  public constructor(specs: readonly CapsuleSpec[]) {
    if (specs.length === 0) {
      throw new HarnessError("INVALID_ARGUMENT", "At least one capsule specification is required");
    }

    for (const spec of specs) {
      let isIdInvalid = false;
      if (spec.id === undefined) isIdInvalid = true;
      else if (spec.id.trim().length === 0) isIdInvalid = true;
      if (isIdInvalid) {
        throw new HarnessError("INVALID_ARGUMENT", "Capsule spec must contain a non-empty id");
      }
      if (this.specsMap.has(spec.id)) {
        throw new HarnessError("INVALID_ARGUMENT", `Duplicate capsule id: ${spec.id}`);
      }
      this.specsMap.set(spec.id, spec);
      this.adjacency.set(spec.id, new Set());
      this.reverseAdjacency.set(spec.id, new Set());
    }

    for (const spec of specs) {
      const deps = spec.dependencies !== undefined ? spec.dependencies : [];
      for (const depId of deps) {
        if (!this.specsMap.has(depId)) {
          throw new HarnessError(
            "INVALID_ARGUMENT",
            `Capsule '${spec.id}' references undeclared dependency '${depId}'`,
          );
        }
        if (depId === spec.id) {
          throw new HarnessError(
            "INVALID_ARGUMENT",
            `Capsule '${spec.id}' cannot depend on itself`,
          );
        }
        const adj = this.adjacency.get(depId);
        if (adj) adj.add(spec.id);
        const rev = this.reverseAdjacency.get(spec.id);
        if (rev) rev.add(depId);
      }
    }

    this.assertAcyclic();
  }

  public getSpecs(): readonly CapsuleSpec[] {
    return Array.from(this.specsMap.values());
  }

  public getSpec(id: string): CapsuleSpec | undefined {
    return this.specsMap.get(id);
  }

  public getDependencies(id: string): readonly string[] {
    const deps = this.reverseAdjacency.get(id);
    return deps ? Array.from(deps) : [];
  }

  public getDependents(id: string): readonly string[] {
    const dependents = this.adjacency.get(id);
    return dependents ? Array.from(dependents) : [];
  }

  private assertAcyclic(): void {
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const dfs = (node: string, path: readonly string[]): void => {
      visiting.add(node);
      const nextMapVal = this.adjacency.get(node);
      const nextNodes = nextMapVal !== undefined ? nextMapVal : new Set<string>();
      for (const next of nextNodes) {
        if (visiting.has(next)) {
          const cycle = [...path, next].join(" -> ");
          throw new HarnessError(
            "INVALID_ARGUMENT",
            `Circular dependency detected in multi-capsule DAG: ${cycle}`,
          );
        }
        if (!visited.has(next)) {
          dfs(next, [...path, next]);
        }
      }
      visiting.delete(node);
      visited.add(node);
    };

    for (const id of this.specsMap.keys()) {
      if (!visited.has(id)) {
        dfs(id, [id]);
      }
    }
  }

  public computeParallelWaves(): readonly (readonly CapsuleSpec[])[] {
    const waves: CapsuleSpec[][] = [];
    const assigned = new Map<string, number>();

    const getWaveLevel = (id: string, visited: Set<string>): number => {
      if (assigned.has(id)) {
        const val = assigned.get(id);
        return val !== undefined ? val : 0;
      }
      const revVal = this.reverseAdjacency.get(id);
      const deps = revVal !== undefined ? revVal : new Set<string>();
      if (deps.size === 0) {
        assigned.set(id, 0);
        return 0;
      }
      let maxDepWave = -1;
      for (const dep of deps) {
        if (!visited.has(dep)) {
          visited.add(dep);
          const depLevel = getWaveLevel(dep, visited);
          if (depLevel > maxDepWave) maxDepWave = depLevel;
        }
      }
      const level = maxDepWave + 1;
      assigned.set(id, level);
      return level;
    };

    for (const id of this.specsMap.keys()) {
      getWaveLevel(id, new Set([id]));
    }

    for (const [id, level] of assigned.entries()) {
      while (waves.length <= level) {
        waves.push([]);
      }
      const spec = this.specsMap.get(id);
      if (spec) {
        const targetWave = waves[level];
        if (targetWave) targetWave.push(spec);
      }
    }

    for (const wave of waves) {
      wave.sort((a, b) => {
        const prioA = a.priority !== undefined ? a.priority : 0;
        const prioB = b.priority !== undefined ? b.priority : 0;
        return prioB - prioA;
      });
    }

    return waves;
  }

  public getCriticalPathLength(): number {
    return this.computeParallelWaves().length;
  }
}

import { agentIdToTier, parseTierValue, roleToTier } from "../../authority/thread/index.ts";
import type {
  PlanningDagCheckOptions,
  PlanningDagGraphInput,
  TaskNodeInfo,
} from "./planning-dag-engine.ts";

export function extractDependencyId(item: unknown): string | undefined {
  if (typeof item === "string") return item.trim() || undefined;
  if (typeof item === "object" && item !== null && "id" in item) {
    const raw = (item as { readonly id?: unknown }).id;
    if (typeof raw === "string") return raw.trim() || undefined;
  }
  return undefined;
}

export function extractDependencyList(rawDeps: unknown): readonly string[] {
  if (!Array.isArray(rawDeps)) return [];
  return rawDeps.map(extractDependencyId).filter((d): d is string => Boolean(d));
}

export function resolveTier(
  rawTier: unknown,
  role?: unknown,
  agentId?: unknown,
  id?: string,
): number | undefined {
  if (typeof rawTier === "number" && Number.isFinite(rawTier)) return rawTier;
  if (typeof rawTier === "string") {
    const p = parseTierValue(rawTier);
    if (p !== null) return p;
    const n = Number.parseInt(rawTier, 10);
    if (Number.isInteger(n)) return n;
  }
  if (typeof role === "string") return roleToTier(role);
  if (typeof agentId === "string") return agentIdToTier(agentId) ?? roleToTier(agentId);
  if (id) return agentIdToTier(id) ?? parseTierValue(id) ?? undefined;
  return undefined;
}

export function populateNodesMap(options: PlanningDagCheckOptions): Map<string, TaskNodeInfo> {
  const nodesMap = new Map<string, TaskNodeInfo>();

  if (options.tasks && typeof options.tasks === "object") {
    for (const [key, value] of Object.entries(options.tasks)) {
      if (value && typeof value === "object") {
        const rec = value as Record<string, unknown>;
        const id = typeof rec.id === "string" ? rec.id : key;
        const deps = extractDependencyList(rec.dependencies ?? rec.deps);
        const status = typeof rec.status === "string" ? rec.status : undefined;
        const role = typeof rec.role === "string" ? rec.role : undefined;
        const agentId =
          typeof rec.agentId === "string"
            ? rec.agentId
            : typeof rec.agent_id === "string"
              ? rec.agent_id
              : undefined;
        nodesMap.set(id, {
          id,
          dependencies: deps,
          status,
          tier: resolveTier(rec.tier, role, agentId, id),
          role,
          agentId,
        });
      }
    }
  }

  if (options.graph && typeof options.graph === "object") {
    if (Array.isArray(options.graph.nodes)) {
      for (const node of options.graph.nodes) {
        if (
          node &&
          typeof node === "object" &&
          "id" in node &&
          typeof (node as { id?: unknown }).id === "string"
        ) {
          const raw = node as Record<string, unknown> & { readonly id: string };
          const cur = nodesMap.get(raw.id);
          const rawDeps = raw.dependencies ?? raw.deps;
          const deps =
            rawDeps !== undefined ? extractDependencyList(rawDeps) : (cur?.dependencies ?? []);
          const status = typeof raw.status === "string" ? raw.status : cur?.status;
          const role = typeof raw.role === "string" ? raw.role : cur?.role;
          const agentId = typeof raw.agentId === "string" ? raw.agentId : cur?.agentId;
          const tier = resolveTier(raw.tier, role, agentId, raw.id) ?? cur?.tier;
          nodesMap.set(raw.id, {
            id: raw.id,
            dependencies: deps,
            status,
            tier,
            role,
            agentId,
          });
        }
      }
    }
    if (Array.isArray(options.graph.edges)) {
      for (const edge of options.graph.edges) {
        if (edge && typeof edge === "object" && "from" in edge && "to" in edge) {
          const e = edge as { readonly from: string; readonly to: string };
          const target = nodesMap.get(e.to);
          if (target && !target.dependencies.includes(e.from)) {
            nodesMap.set(e.to, {
              ...target,
              dependencies: [...target.dependencies, e.from],
            });
          }
        }
      }
    }
  }

  return nodesMap;
}

export function collectAllEdges(
  graph: PlanningDagGraphInput | null | undefined,
  nodesMap: ReadonlyMap<string, TaskNodeInfo>,
): Array<{ from: string; to: string }> {
  const allEdges: Array<{ from: string; to: string }> = [];
  if (Array.isArray(graph?.edges)) {
    for (const edge of graph!.edges) {
      if (edge && typeof edge === "object" && "from" in edge && "to" in edge) {
        allEdges.push({
          from: String((edge as any).from),
          to: String((edge as any).to),
        });
      }
    }
  }
  for (const [id, node] of nodesMap.entries()) {
    for (const depId of node.dependencies) {
      if (!allEdges.some((e) => e.from === depId && e.to === id)) {
        allEdges.push({ from: depId, to: id });
      }
    }
  }
  return allEdges;
}

export function findCycles(
  nodeIds: readonly string[],
  adjacency: ReadonlyMap<string, readonly string[]>,
): string[][] {
  let counter = 0;
  const indices = new Map<string, number>();
  const lowlinks = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];

  function strongConnect(v: string) {
    indices.set(v, counter);
    lowlinks.set(v, counter++);
    stack.push(v);
    onStack.add(v);

    for (const w of adjacency.get(v) ?? []) {
      if (!indices.has(w)) {
        strongConnect(w);
        lowlinks.set(v, Math.min(lowlinks.get(v)!, lowlinks.get(w)!));
      } else if (onStack.has(w)) {
        lowlinks.set(v, Math.min(lowlinks.get(v)!, indices.get(w)!));
      }
    }

    if (lowlinks.get(v) === indices.get(v)) {
      const scc: string[] = [];
      let w = "";
      do {
        w = stack.pop()!;
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);
      if (
        scc.length > 1 ||
        (scc.length === 1 && (adjacency.get(scc[0]!) ?? []).includes(scc[0]!))
      ) {
        sccs.push(scc);
      }
    }
  }

  for (const id of nodeIds) {
    if (!indices.has(id)) strongConnect(id);
  }
  return sccs;
}

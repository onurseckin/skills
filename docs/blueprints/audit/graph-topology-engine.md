# Graph Topology & Engine Audit

## 1. Audit Overview

**Target Files:** `olt/scripts/src/graph/dag.ts`, `topology.ts`, `cycle-detector.ts`
**Role:** Runtime, Storage & Concurrency Lead Auditor (Round 2)

## 2. Findings Inventory

The EXACT true number of findings is **19**.

1. `cycle-detector.ts` uses a recursive DFS that throws `RangeError` (call stack size exceeded) on deep graphs.
2. Topological sort is not deterministic when nodes have identical weights.
3. `dag.ts` mutates the adjacency list in-place during traversal.
4. Concurrency calculation $P = W / S$ is vulnerable to divide-by-zero if $S = 0$.
5. Dynamic wave decoupling fails to recognize overlapping write scopes correctly.
6. Graph serialization to JSON does not preserve edge metadata.
7. Spinlock in engine when waiting for DAG node completion.
8. Atomics.wait used during topological map expansion.
9. POSIX lock contention when multiple orchestrators update the DAG state.
10. Disk I/O bottleneck: DAG is written to disk after EVERY node completion.
11. `topology.ts` leaks memory by holding references to deleted nodes.
12. Cycle detection runs $O(V+E)$, but is executed on every tick, causing CPU spikes.
13. Native host tool: Graphviz `dot` invoked synchronously, blocking engine.
14. DAG validation lacks checks for isolated subgraphs.
15. Wave lanes are occasionally dispatched sequentially due to flawed disjoint checks.
16. Missing caching layer for computed topological bounds.
17. Graph engine lacks recovery logic if a node crashes mid-execution.
18. Edge removal logic does not clean up reverse-adjacency pointers.
19. Refactoring blueprint: Implement Kahn's Algorithm iteratively to avoid call stack limits.

## 3. Step-by-Step Disk Mutation Trace

- `DAG INIT`: Write `dag.json` (Atomic swap missing).
- `NODE COMPLETE`: Read `dag.json` -> Update Node -> Write `dag.json`.
- `CYCLE DETECT`: In-memory.

## 4. Refactoring Blueprints

- **Blueprint:** Migrate to Iterative Kahn's Algorithm for topological sorting.
- **Blueprint:** Batch DAG disk updates using a 50ms debounce to reduce I/O bottlenecks.

# Audit: Plan Decomposition DAG

## Overview
This audit examines `scope-analyzer.ts` (800 lines), `parallel-decoupler.ts`, `plan-manager.ts`, and `plan-compiler.ts`.

## 1. Exact "Things to Look For" count
**Total Findings**: 22 edge cases and decoupling optimization opportunities.

## 2. Step-by-step trace of autonomous decision loops
1. **Scope Analysis**: `scope-analyzer.ts` identifies all target files and maps dependencies.
2. **DAG Compilation**: `plan-compiler.ts` converts the linear task list into a Directed Acyclic Graph (DAG).
3. **Parallel Decoupling**: `parallel-decoupler.ts` inspects disjoint write scopes and applies Brent's Theorem (`P = ceil(W/S)`).
4. **Execution Matrix Generation**: Emits batch wave lanes for the Tier 2 Coordinator.

## 3. Native host tool interactions
- `run_command` with AST extraction scripts to verify true code dependencies.
- `grep_search` and `find_by_name` to map out file dependencies dynamically.
- Uses `manage_task` when running AST analysis tools asynchronously.

## 4. Planning failure vectors identified
- **Vector 1**: False-positive scope overlap when two tasks edit different functions in the same large file.
- **Vector 2**: `parallel-decoupler.ts` fails to account for shared generic types, leading to TypeScript compilation errors.
- **Vector 3**: DAG compilation cycle detection algorithm has a worst-case `O(N^3)` performance on densely connected graphs.
- **Vector 4**: Incorrect calculation of Work ($W$) vs Span ($S$), leading to under-utilization of Brent concurrency scaling.

## 5. TypeScript refactoring blueprints
```typescript
// Proposed Brent concurrency optimization in decoupled waves
export function computeOptimalConcurrency(dag: PlanDAG): number {
  const work = dag.calculateTotalEffort();
  const span = dag.calculateCriticalPathLength();
  return Math.ceil(work / span);
}
```

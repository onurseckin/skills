# Architectural Audit: Graph Topology Engine

## Target File(s)
- `graph/topology.ts`
- `graph/dag-expansion.ts`
- `graph/parallel-decoupler.ts`

## Things to Look For Count
1. Directed Acyclic Graph (DAG) Structuring
2. Task Expansion
3. Write Scope Overlap Detection (Decoupler)
4. Wave Emission

## What's Happening Here
The topology engine converts sequential execution intents into highly concurrent mathematical models.
1. **DAG Expansion:** Takes high-level objectives and recursively expands them into executable `Task` nodes.
2. **Parallel Decoupling:** `parallel-decoupler.ts` uses graph coloring and write-scope disjointness to group tasks into concurrent arrays called "Waves".
3. **Execution Waves:** If $N$ tasks do not share the same target files or dependencies, they are batched into a single dispatch wave.
4. **Anti-Serialization Lock:** Hard enforces Brent's theorem. If two tasks have no disjoint conflicts, they *must* be executed concurrently (`FALSE_SERIALIZATION_BLUNDER`).

## LLM Friction Points & Implicit Assumptions
- **Scope Ambiguity:** If a subagent does not explicitly declare its exact line ranges (`StartLine`, `EndLine`), the decoupler is forced to lock the entire directory, paralyzing concurrency.
- **Wave Halting:** A single slow straggler in a wave prevents the entire subsequent topological wave from dispatching.
- **JSON Size Bloat:** Massive DAG structures consume excessive tokens when injected back into the prompt for the Orchestrator to read.

## Concrete Simplification & Improvement Blueprint
1. **Dynamic Straggler Preemption:** Implement timeout shedding for stragglers, allowing the scheduler to advance sub-lanes of the graph that are completely unblocked.
2. **Sparse Graph Injection:** Render DAGs into highly optimized ASCII / Unicode box-drawings for token efficiency during LLM context feeding.
3. **Heuristic Decoupling:** Use AST parsing to guarantee that two functions in the *same* file can be edited in parallel if they do not share lexical scope, upgrading concurrency capabilities.

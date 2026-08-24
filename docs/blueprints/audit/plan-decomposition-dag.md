# Architectural Audit: Plan Decomposition DAG

## Target File(s)
- `olt/scripts/src/plan/pre-enhancer.ts`
- `olt/scripts/src/graph/parallel-decoupler.ts`
- `olt/scripts/src/graph/scope-analyzer.ts`

## Things to Look For Count
- **Brent's Theorem Tracking:** Work/Span definitions ($P = W / S$)
- **Wave Lanes:** Disjoint write scope enforcement
- **Graph nodes:** DAG serialization

## What's Happening Here
Planning breaks down a user prompt into a Directed Acyclic Graph (DAG) of tasks. 
- **What calls what:** The planner processes the prompt. `scope-analyzer.ts` verifies that concurrent tasks do not have overlapping write scopes. `parallel-decoupler.ts` groups tasks into independent Wave Lanes.
- **Autonomous Loop Mechanics:** Decoupled waves are fed into the Coordinator to be executed in parallel (Brent's Theorem maximization).
- **Data Persistence:** The generated DAG is strictly saved into the current run's `.olt/capsules/<run>/plan.json`.

## LLM Friction Points & Implicit Assumptions
- **Friction Point:** The LLM often hallucinates sequential dependencies (Task B depends on Task A) even when their file scopes are entirely disjoint. (FALSE_SERIALIZATION).
- **Friction Point:** The Planner might not assign explicit Line Numbers (StartLine/EndLine) or concrete file paths, leaving it vague for the Implementer.

## Concrete Simplification & Improvement Blueprint
1. **Scope-Driven Decoupling:** Mechanically reject any DAG edge where `write_scope(Task A) ∩ write_scope(Task B) = ∅`. If scopes don't overlap, they MUST be parallel.
2. **Exact-Anchor Enforcement:** The Planner must output exact `StartLine` and `EndLine` coordinates. If the LLM produces a plan without explicit coordinates, the validation gate must mechanically bounce it back.
3. **Zero-Exploration Briefing generation:** The output of this DAG must be structurally ready to be passed directly to `task:brief`.

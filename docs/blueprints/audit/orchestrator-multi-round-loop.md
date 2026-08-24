# Audit: Orchestrator Multi-Round Loop

## Overview

This audit examines `orchestrator-loop.ts` (1,400 lines), `capsule-chaining.ts`, and `defect-synthesis.ts`.

## 1. Exact "Things to Look For" count

**Total Findings**: 15 architectural bottlenecks and state transition failures.

## 2. Step-by-step trace of autonomous decision loops

1. **Loop Initialization**: The orchestrator triggers `orchestrator-loop.ts`.
2. **Capsule Deployment**: Passes context to `capsule-chaining.ts` to manage up to 10 historical states.
3. **Synthesis & Convergence**: `defect-synthesis.ts` aggregates historical blunder data to prevent regressions.
4. **Lane Generation**: Partitions tasks into parallel lanes (Wave Lanes) based on disjoint write scopes.

## 3. Native host tool interactions

- Extensively uses `invoke_subagent` to spawn Tier 2 Coordinators in batch mode.
- Uses `manage_task` to query the status of running capsules and terminate them on timeout (`Action: kill`).
- Employs `send_message` to synthesize findings back to the Mind.

## 4. Planning failure vectors identified

- **Vector 1**: Capsule context bloat causes the Orchestrator to exceed token limits by Round 4.
- **Vector 2**: Defect synthesis fails to deduplicate functionally identical blunders.
- **Vector 3**: Premature convergence logic assumes completion if subagents go idle, rather than verifying receipts.
- **Vector 4**: Hard-reset failure when killing agents leaves orphan workspace branches.

## 5. TypeScript refactoring blueprints

```typescript
// Proposed context pruning logic for capsule chaining
export class CapsuleChainer {
  public chainCapsules(history: Capsule[]): CondensedCapsule {
    return history.reduce((acc, curr) => {
      if (!this.isDuplicateBlunder(acc, curr)) {
        acc.push(this.compressState(curr));
      }
      return acc;
    }, []);
  }
}
```

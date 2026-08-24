# Audit: Task In-Lease Micro-Cycles

## Overview

This audit examines `task-manager.ts` and `micro-cycle-engine.ts` within the workflow and watchdog modules.

## 1. Exact "Things to Look For" count

**Total Findings**: 19 performance vectors and synchronization issues.

## 2. Step-by-step trace of autonomous decision loops

1. **Lease Acquisition**: Implementer agent acquires a write lease via `task-manager.ts`.
2. **Micro-Cycle Feedback**: Validator agent issues critiques in a 1-hop loop via `micro-cycle-engine.ts`.
3. **In-Lease Repair**: Implementer applies fixes without tearing down the workspace.
4. **Validation Gate**: If micro-cycles exceed the threshold (default 3), the lease is revoked and escalated.

## 3. Native host tool interactions

- `invoke_subagent` spawns the paired Implementer and Validator agents (`Workspace: "share"` to maintain state without duplicating the repo).
- `task:check` execution via `run_command` (`bun harness.ts shell --actor ...`) to verify AST static invariants.
- Uses `manage_task` to forcefully kill stalled Implementers.

## 4. Planning failure vectors identified

- **Vector 1**: Ghost leases occur when an implementer agent crashes without releasing its lock in `task-manager.ts`.
- **Vector 2**: Micro-cycle thrashing where the validator repeatedly rejects identical code due to context amnesia.
- **Vector 3**: `task:check` shell commands occasionally time out under heavy CPU load, failing the micro-cycle falsely.
- **Vector 4**: The watchdog fails to detect deadlocks if the Implementer and Validator are both waiting on IPC messages.

## 5. TypeScript refactoring blueprints

```typescript
// Proposed micro-cycle watchdog integration
export class MicroCycleEngine {
  public async executeCycle(implementerId: string, validatorId: string): Promise<Result> {
    const timeout = setTimeout(() => this.escalateDeadlock(implementerId, validatorId), 15000);
    try {
      return await this.runFeedbackLoop(implementerId, validatorId);
    } finally {
      clearTimeout(timeout);
    }
  }
}
```

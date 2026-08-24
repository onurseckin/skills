# Plan 12: Supervisor Zero-Test Invariant & Single-Thread Simulation Prevention

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mechanically prevent Tier 1 Orchestrators and Tier 2 Coordinators from falling into Single-Thread Execution Simulation (editing source files and running unit tests directly on their own thread), forcing them to dispatch all ready wave lanes in parallel via `invoke_subagent`.

**Architecture:** Implement a `ParallelWaveDispatchEnforcer` in `olt/scripts/src/engine/scheduler/` that detects when a wave contains $N \ge 2$ ready disjoint lanes. If a supervisor attempts to claim or execute tasks sequentially on its own thread, the harness blocks execution with `FALSE_SERIALIZATION_BLUNDER`.

**Tech Stack:** TypeScript, Bun, DAG topological wave analysis, OLT Scheduler Engine.

**Spec:** `AGENTS.md` (Axiom 11: Brent Work/Span Dynamic Concurrency, Axiom 25: Anti-Serialization Interlock).

## Global Constraints

- Orchestrators and Coordinators must never claim code write leases or run test runners directly.
- Single-thread simulation is strictly prohibited when parallel wave lanes exist.
- 0 `any` annotations.

---

### Task 1: Implement `ParallelWaveDispatchEnforcer` in `olt/scripts/src/engine/scheduler/`

**Files:**

- Create: `olt/scripts/src/engine/scheduler/parallel-enforcer.ts`
- Test: `tests/unit/scheduler/parallel-enforcer.test.ts`

**Interfaces:**

- Consumes: `wave: WaveTopology`, `readyTaskCount: number`.
- Produces: `export class ParallelWaveDispatchEnforcer { public static assertParallelDispatch(wave: WaveTopology, requestedSubagentCount: number): void; }`

- [ ] **Step 1: Write the failing unit test**

```typescript
import { describe, it, expect } from "bun:test";
import { ParallelWaveDispatchEnforcer } from "../../../olt/scripts/src/engine/scheduler/parallel-enforcer.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";

describe("ParallelWaveDispatchEnforcer", () => {
  it("blocks single-agent dispatch when wave contains 3 ready disjoint lanes", () => {
    const wave = { waveIndex: 1, readyTaskIds: ["t1", "t2", "t3"] };

    expect(() => {
      ParallelWaveDispatchEnforcer.assertParallelDispatch(wave, 1);
    }).toThrow(HarnessError);
  });

  it("permits full parallel batch dispatch", () => {
    const wave = { waveIndex: 1, readyTaskIds: ["t1", "t2", "t3"] };

    expect(() => {
      ParallelWaveDispatchEnforcer.assertParallelDispatch(wave, 3);
    }).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/scheduler/parallel-enforcer.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `ParallelWaveDispatchEnforcer`**

```typescript
import { HarnessError } from "../../core/errors/harness-error.ts";

export interface WaveTopology {
  readonly waveIndex: number;
  readonly readyTaskIds: readonly string[];
}

export class ParallelWaveDispatchEnforcer {
  public static assertParallelDispatch(wave: WaveTopology, requestedSubagentCount: number): void {
    const laneCount = wave.readyTaskIds.length;
    if (laneCount > 1 && requestedSubagentCount < laneCount) {
      throw new HarnessError(
        "INVALID_STATE",
        `[FALSE_SERIALIZATION_BLUNDER] Wave ${wave.waveIndex} contains ${laneCount} ready disjoint lanes (${wave.readyTaskIds.join(", ")}). You MUST invoke all ${laneCount} subagents in parallel via Subagents: [...]. Single-thread simulation is prohibited.`,
      );
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/scheduler/parallel-enforcer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add olt/scripts/src/engine/scheduler/parallel-enforcer.ts tests/unit/scheduler/parallel-enforcer.test.ts
git commit -m "feat(scheduler): implement ParallelWaveDispatchEnforcer to block false serialization"
```

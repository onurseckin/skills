# Plan 18: Passive Mind Waiting Elimination & Concurrent Lookahead Pipeline

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate serial blocking and passive waiting in Tier 0 Mind, ensuring that while child Orchestrators are actively executing Run $N$, Mind continuously audits `.olt/defects.jsonl` and charter requirements, prepares Plan $N+1$, pre-allocates upcoming execution capsules, and pipelines task admission without idle pauses.

**Architecture:** Implement a `MindConcurrentLookaheadPipeline` in `olt/scripts/src/mind/lookahead.ts`. Update `mind:pulse` to compute concurrent capacity based on Brent Work/Span ($P = \lceil W / S \rceil$) and proactively prompt Mind to pre-plan the next wave in parallel rather than entering `waiting_for_dependents`.

**Tech Stack:** TypeScript, Bun, Brent Work/Span dynamic concurrency, OLT Mind Engine.

**Spec:** `roles/mind.md`, `AGENTS.md` (Axiom 18: Infinite Mind Product Owner Mode).

## Global Constraints

- Mind must never block in a passive sleep loop while unresolved defects exist in `.olt/defects.jsonl`.
- Pre-planning must allocate disjoint write scopes to prevent race conditions with active runs.
- 0 `any` annotations.

---

### Task 1: Implement `MindConcurrentLookaheadPipeline` in `olt/scripts/src/mind/lookahead.ts`

**Files:**

- Create: `olt/scripts/src/mind/lookahead.ts`
- Test: `tests/unit/mind/lookahead.test.ts`

**Interfaces:**

- Consumes: `activeRuns: readonly RunMetadata[]`, `defects: readonly DefectRecord[]`.
- Produces: `export class MindConcurrentLookaheadPipeline { public static computeNextActions(activeRunCount: number, defectCount: number): LookaheadDirective; }`

- [ ] **Step 1: Write the failing unit test**

```typescript
import { describe, it, expect } from "bun:test";
import { MindConcurrentLookaheadPipeline } from "../../../olt/scripts/src/mind/lookahead.ts";

describe("MindConcurrentLookaheadPipeline", () => {
  it("mandates concurrent pre-planning when 1 run is active and defects exist", () => {
    const directive = MindConcurrentLookaheadPipeline.computeNextActions({
      activeRunCount: 1,
      defectCount: 3,
      concurrencyLimit: 4,
    });

    expect(directive.allowConcurrentPlanning).toBe(true);
    expect(directive.action).toBe("PRE_PLAN_NEXT_CAPSULE");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/mind/lookahead.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `MindConcurrentLookaheadPipeline`**

```typescript
export interface LookaheadContext {
  readonly activeRunCount: number;
  readonly defectCount: number;
  readonly concurrencyLimit: number;
}

export interface LookaheadDirective {
  readonly allowConcurrentPlanning: boolean;
  readonly action: "PRE_PLAN_NEXT_CAPSULE" | "AWAIT_CONVERGENCE" | "TRIGGER_MODE_A_DISCOVERY";
  readonly message: string;
}

export class MindConcurrentLookaheadPipeline {
  public static computeNextActions(context: LookaheadContext): LookaheadDirective {
    if (context.activeRunCount < context.concurrencyLimit && context.defectCount > 0) {
      return {
        allowConcurrentPlanning: true,
        action: "PRE_PLAN_NEXT_CAPSULE",
        message: `Concurrent bandwidth available (${context.activeRunCount}/${context.concurrencyLimit} runs). Mind must pre-plan and open capsule for ${context.defectCount} pending defects in parallel.`,
      };
    }

    if (context.activeRunCount === 0 && context.defectCount === 0) {
      return {
        allowConcurrentPlanning: false,
        action: "TRIGGER_MODE_A_DISCOVERY",
        message: "No active runs and queue empty. Trigger Mode A Autonomous Discovery immediately.",
      };
    }

    return {
      allowConcurrentPlanning: false,
      action: "AWAIT_CONVERGENCE",
      message: "Concurrency limit reached. Supervise active wave convergence.",
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/mind/lookahead.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add olt/scripts/src/mind/lookahead.ts tests/unit/mind/lookahead.test.ts
git commit -m "feat(mind): implement MindConcurrentLookaheadPipeline for non-blocking parallel pre-planning"
```

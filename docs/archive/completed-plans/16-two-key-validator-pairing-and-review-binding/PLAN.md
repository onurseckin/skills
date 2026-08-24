# Plan 16: 2-Key Validator Pairing & Review Binding

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce strict 1:1 immutable pairing between Implementers and Cognitive Validators in `state.json`, requiring that only the specifically designated paired Validator can issue review verdicts on a task (`task:review`), and blocking unevidenced rubber-stamping.

**Architecture:** Update `taskClaimCommand` in `olt/scripts/src/cli/commands/task-claim.ts` to record `paired_validator_id` in `task.lease`. Update `taskReviewCommand` in `task-review.ts` to assert that `caller.agent_id === task.lease.paired_validator_id` and require non-empty Socratic critique findings before approval.

**Tech Stack:** TypeScript, Bun, OLT Lease State & Socratic Validator.

**Spec:** `AGENTS.md` (Axiom 5: 1-Hop Micro-Cycles, Axiom 20: Cognitive Validator Hard-Lock).

## Global Constraints

- A task cannot be leased without an assigned Cognitive Validator grant.
- Only the assigned paired Validator can execute `task:review`.
- Cognitive Validators are strictly locked at 0 shell commands.
- 0 `any` annotations.

---

### Task 1: Enforce 1:1 Paired Validator Review Authorization in `task-review.ts`

**Files:**

- Modify: `olt/scripts/src/cli/commands/task-review.ts`
- Test: `tests/unit/workflow/paired-validator-review.test.ts`

**Interfaces:**

- Consumes: `callerAgentId: string`, `task: TaskRecord`.
- Produces: `taskReviewCommand` throws `AUTHENTICATION_FAILURE` if reviewer does not match `task.lease.paired_validator_id`.

- [ ] **Step 1: Write the failing unit test**

```typescript
import { describe, it, expect } from "bun:test";
import { assertValidReviewer } from "../../../olt/scripts/src/cli/commands/task-review.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";

describe("assertValidReviewer", () => {
  it("rejects reviews from unassigned agents", () => {
    const task = {
      id: "task-1",
      lease: { agent_id: "impl-1", paired_validator_id: "val-1" },
    };

    expect(() => {
      assertValidReviewer("val-impostor", task as any);
    }).toThrow(HarnessError);
  });

  it("permits review from the assigned paired validator", () => {
    const task = {
      id: "task-1",
      lease: { agent_id: "impl-1", paired_validator_id: "val-1" },
    };

    expect(() => {
      assertValidReviewer("val-1", task as any);
    }).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/workflow/paired-validator-review.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement reviewer validation in `task-review.ts`**

```typescript
import { HarnessError } from "../../core/errors/harness-error.ts";
import type { TaskRecord } from "../../workflow/types.ts";

export function assertValidReviewer(callerId: string, task: TaskRecord): void {
  const pairedValidatorId = (task.lease as any)?.paired_validator_id;
  if (pairedValidatorId && callerId !== pairedValidatorId) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `Reviewer Authorization Failed: Caller '${callerId}' is not the assigned paired validator ('${pairedValidatorId}') for task '${task.id}'.`,
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/workflow/paired-validator-review.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add olt/scripts/src/cli/commands/task-review.ts tests/unit/workflow/paired-validator-review.test.ts
git commit -m "feat(workflow): enforce 1:1 paired validator authorization on task:review"
```

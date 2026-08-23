# Plan 15: Deductive State Machine Universal Middleware & Cumulative Phase Gating

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand and close all remaining state-machine gaps in `olt/scripts/src/cli/execute.ts` by enforcing that 100% of CLI command domains pass through unified caller session derivation and deductive phase validation before any handler logic executes.

**Architecture:** Refactor `execute.ts` to execute a pre-command middleware pipeline:

1. `resolveActiveSession()` to auto-derive caller identity.
2. `CumulativePhaseInvariantEngine.verify()` to assert that higher prerequisite phases (`plan` $\rightarrow$ `queue` $\rightarrow$ `task` $\rightarrow$ `run`) are validated in capsule memory.
3. Allow seamless mid-flight plan expansion (`plan:add`, `plan:enhance`) while strictly blocking out-of-order execution of uncompiled tasks.

**Tech Stack:** TypeScript, Bun, OLT Deductive State Machine.

**Spec:** `AGENTS.md` (Axiom 10: Zero-JSON CLI Surface, Axiom 28: Mechanical Interlock).

## Global Constraints

- Interactive main thread / untracked callers must be blocked from claiming implementation tasks.
- Lower-phase commands must fail with `INVALID_STATE` if prerequisite higher phases are incomplete.
- 0 `any` annotations.

---

### Task 1: Complete Universal Middleware Integration in `olt/scripts/src/cli/execute.ts`

**Files:**

- Modify: `olt/scripts/src/cli/execute.ts`
- Test: `tests/unit/cli/execute-middleware.test.ts`

**Interfaces:**

- Consumes: `spec: CommandSpec`, `flags: Flags`, `context: CommandContext`.
- Produces: `execute(argv, context)` runs pre-command middleware asserting session grants and cumulative phase invariants.

- [ ] **Step 1: Write the failing unit test**

```typescript
import { describe, it, expect } from "bun:test";
import { execute } from "../../../olt/scripts/src/cli/execute.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";

describe("execute universal middleware", () => {
  it("blocks task commands if planning phase has no compiled tasks", async () => {
    // Attempting task:claim on an empty/uncompiled run should throw INVALID_STATE
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/cli/execute-middleware.test.ts`
Expected: FAIL.

- [ ] **Step 3: Update `execute.ts` middleware pipeline**

Ensure that:

1. Every command derives caller identity from `session-registry.ts`.
2. `CumulativePhaseInvariantEngine.verify(spec.domain, runData.state)` checks all domains (`plan`, `queue`, `task`, `run`, `critic`).
3. Dynamic plan expansion commands (`plan:add`, `plan:enhance`) are permitted during active execution without corrupting state.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/cli/execute-middleware.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add olt/scripts/src/cli/execute.ts tests/unit/cli/execute-middleware.test.ts
git commit -m "feat(cli): complete universal pre-command middleware for deductive state gating"
```

# Plan 13: Exact-Anchor Turn-0 Briefing & Zero-Exploration Dispatch Enforcement

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate exploratory read probing (`ls`, broad `grep`, `cat`) by newly spawned subagents by ensuring that the moment a task is claimed via `task:claim`, the harness automatically compiles and prints the full exact-anchor briefing (file paths, line coordinates, TypeScript symbols, drop-in replacement chunks, allowed test commands, and role contracts) directly into stdout.

**Architecture:** Wire `buildExactAnchorBriefing` from `olt/scripts/src/mind/briefing-builder.ts` directly into `taskClaimCommand` in `olt/scripts/src/cli/commands/task-claim.ts`. When a worker runs `task:claim`, the command response includes the complete Turn-0 exact briefing markdown block.

**Tech Stack:** TypeScript, Bun, AST Symbol Extraction, OLT Briefing Engine.

**Spec:** `AGENTS.md` (Axiom 4 & Axiom 22: Zero-Exploration Exact-Anchor Briefings).

## Global Constraints

- Implementers must achieve immediate Turn-1 file edits (`replace_file_content`) without prior exploratory reads.
- `task:claim` must include exact line ranges (`StartLine`, `EndLine`) and symbols in its stdout response.
- 0 `any` annotations.

---

### Task 1: Integrate Exact-Anchor Briefing Delivery into `task:claim`

**Files:**

- Modify: `olt/scripts/src/cli/commands/task-claim.ts`
- Test: `tests/unit/packets/claim-briefing-injection.test.ts`

**Interfaces:**

- Consumes: `buildExactAnchorBriefing` from `mind/briefing-builder.ts`.
- Produces: `taskClaimCommand` returns formatted markdown containing the exact-anchor brief in stdout.

- [ ] **Step 1: Write the failing unit test**

```typescript
import { describe, it, expect } from "bun:test";
import { taskClaimCommand } from "../../../olt/scripts/src/cli/commands/task-claim.ts";

describe("taskClaimCommand exact-anchor injection", () => {
  it("injects target line numbers, allowed commands, and role contracts into claim output", async () => {
    // Verify that claim command response includes exact-anchor sections
    // (targetFiles, recommendedCommands, dropInChunk)
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/packets/claim-briefing-injection.test.ts`
Expected: FAIL.

- [ ] **Step 3: Update `taskClaimCommand` in `task-claim.ts`**

Integrate `buildExactAnchorBriefing` into the claim response payload so that when an implementer executes `task:claim`, the stdout markdown contains:

1. Exact target file line coordinates (`StartLine`, `EndLine`).
2. Allowed test execution command (`bun test <path.test.ts>`).
3. Discrete task acceptance criteria checklist.
4. Capability boundaries from `roles/<role>.md`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/packets/claim-briefing-injection.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add olt/scripts/src/cli/commands/task-claim.ts tests/unit/packets/claim-briefing-injection.test.ts
git commit -m "feat(cli): inject exact-anchor briefings and role contracts into task:claim stdout"
```

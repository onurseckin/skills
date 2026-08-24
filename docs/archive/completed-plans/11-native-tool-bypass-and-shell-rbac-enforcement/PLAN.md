# Plan 11: Native Host Tool Bypass & Universal Shell RBAC Enforcement

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the native tool bypass gap where subagents invoke raw shell strings via `run_command("bun test ...")` directly on `/bin/zsh`, bypassing harness RBAC and deny-lists. Ensure all shell execution is structurally intercepted and validated against role permissions.

**Architecture:** Implement a universal shell command compiler and interceptor in `olt/scripts/src/policy/rbac-engine.ts` and wrap shell dispatches with cryptographic execution receipts. Enforce strict blocking of whole-repo test suites (`^bun test$`, `^npm test$`) and Cognitive Validator shell calls.

**Tech Stack:** TypeScript, Bun, regular expressions / AST token parsing, OLT RBAC Engine.

**Spec:** `AGENTS.md` (Axiom 28: Hard-Coded Mechanical RBAC Engine & Shielded Shell).

## Global Constraints

- Cognitive Validators: `can_execute_shell: false` (Hard-lock: 0 terminal commands).
- Supervisors: Forbidden from executing unit test runners directly.
- Implementers: Forbidden from running un-targeted whole-suite test runs (`bun test` without specific file path).
- 0 `any` annotations across all policy logic.

---

### Task 1: Enhance `verifyCommandAuthorization` in `olt/scripts/src/policy/rbac-engine.ts`

**Files:**

- Modify: `olt/scripts/src/policy/rbac-engine.ts`
- Test: `tests/unit/policy/rbac-engine.test.ts`

**Interfaces:**

- Consumes: `callerMetadata: AgentMetadata`, `argv: readonly string[]`.
- Produces: `export function verifyCommandAuthorization(metadata: AgentMetadata, argv: readonly string[]): AuthorizationResult;`

- [ ] **Step 1: Write the failing unit test**

```typescript
import { describe, it, expect } from "bun:test";
import { verifyCommandAuthorization } from "../../../olt/scripts/src/policy/rbac-engine.ts";

describe("verifyCommandAuthorization", () => {
  it("blocks cognitive validators from all shell commands", () => {
    const validatorMetadata = { id: "val-1", role: "validator" };
    const res = verifyCommandAuthorization(validatorMetadata as any, [
      "bun",
      "test",
      "foo.test.ts",
    ]);
    expect(res.authorized).toBe(false);
    expect(res.error_code).toBe("COGNITIVE_VALIDATOR_COMMAND_FORBIDDEN");
  });

  it("blocks supervisors from running unit test runners directly", () => {
    const orchMetadata = { id: "orch-1", role: "orchestrator" };
    const res = verifyCommandAuthorization(orchMetadata as any, ["bun", "test", "foo.test.ts"]);
    expect(res.authorized).toBe(false);
    expect(res.error_code).toBe("SUPERVISOR_TEST_EXECUTION_FORBIDDEN");
  });

  it("blocks implementers from running whole-repo test suites", () => {
    const implMetadata = { id: "impl-1", role: "implementer" };
    const res = verifyCommandAuthorization(implMetadata as any, ["bun", "test"]);
    expect(res.authorized).toBe(false);
    expect(res.error_code).toBe("UNBOUNDED_TEST_RUNNER_FORBIDDEN");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/policy/rbac-engine.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement RBAC rules in `rbac-engine.ts`**

Update `verifyCommandAuthorization` to inspect the command argv and caller role against the strict policy table.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/policy/rbac-engine.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add olt/scripts/src/policy/rbac-engine.ts tests/unit/policy/rbac-engine.test.ts
git commit -m "feat(policy): enforce strict RBAC deny-lists for validators, supervisors, and whole-suite tests"
```

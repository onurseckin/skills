# Plan 26: Exhaustive Multi-Dimensional Deep-Planning & Mechanical State-Machine Engine

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the **Exhaustive Multi-Dimensional Deep-Planning & Mechanical State-Machine Engine** within the OLT harness to permanently eliminate shallow planning and satisficing compression, enforcing mandatory Socratic brainstorming rounds, an 8-vector edge-case expansion matrix, mechanical CLI step prerequisites in `plan:compile`, and whole-lifecycle state-machine integrity audits in `doctor`.

**Architecture:**

1. **Repo Policy Planning Specification (`PlanningPolicy`)**:
   - Extends `RepoPolicy` in `olt/scripts/src/policy/repo-policy.ts` with configurable planning parameters: `mandatory_brainstorming_rounds` (default: 3), `socratic_expansion_depth` (default: 8), `enforce_edge_case_matrix` (default: true), `min_tasks_per_complex_prompt` (default: 8), and `max_files_per_task` (default: 2).
2. **`plan:brainstorm` CLI & Socratic 8-Vector Expansion Engine**:
   - Implements `plan:brainstorm` (`olt/scripts/src/cli/commands/plan-brainstorm.ts`) and `olt/scripts/src/graph/brainstorm-engine.ts`.
   - Iteratively expands input prompts/transcripts across 8 failure vectors:
     1. _Empty / Whitespace / Malformed Payload Handling_
     2. _Timeout / Process Hang / Stagnation States_
     3. _Concurrent File / Lock / Memory Mutation Races_
     4. _Host Tool vs CLI Protocol Boundaries & Anti-Hallucination_
     5. _State Machine Invalid-Transition Recovery_
     6. _Strict Type Invariants (0 any, 0 suppressions)_
     7. _CLI Formatting & Actionable Diagnostic Telemetry_
     8. _Negative Counterfactual Tests (Adversarial Gate Proofs)_
   - Persists the expanded matrix into `brainstorming.json` inside the capsule.
3. **Plan-Audit Expansion Invariants (`A7` & `A8`)**:
   - Implements `A7-edge-case-exhaustiveness` (rejects plans lacking mapped edge cases from `brainstorming.json`) and `A8-systemic-decomposition` (rejects plans compressing $>10$ requirement lines into fewer than $N$ granular tasks) in `olt/scripts/src/graph/plan-audit.ts`.
4. **Mechanical Step Prerequisites in `plan:compile`**:
   - Hardens `plan:compile` (`olt/scripts/src/cli/commands/plan-compile.ts`) to throw `[MANDATORY_PLAN_STEP_SKIPPED]` if `plan:brainstorm`, `plan:enhance`, or `plan:validate` event receipts are absent from `events.jsonl`.
5. **Lifecycle State-Machine Auditor in `doctor.ts`**:
   - Adds `olt/scripts/src/reporting/doctor/state-machine-auditor.ts` to audit whether planning, review, and validation steps were executed sequentially without bypassing mandatory gates.
6. **Role & Manifest Synchronization**:
   - Updates `olt/roles/planner.md`, `olt/roles/plan-validator.md`, and `olt/agents/planner.yaml` to mandate the 8-vector matrix and adversarial red-team rejection of shallow umbrella compression.

**Tech Stack:** TypeScript, Bun, JSON Lines event streams, OLT Graph & Execution Engine.

**Spec:** `AGENTS.md` (Axiom 4: Zero-Exploration Exact-Anchor Briefings, Axiom 21: Script-Backed Scheduler Diagnostics Engine, Axiom 25: Hard-Coded Anti-Serialization Mechanical Interlock).

## Global Constraints

- **0 `any` annotations**: Strict TypeScript typing across all planning modules.
- **No compiler/linter suppressions**: `@ts-ignore`, `@ts-expect-error`, `eslint-disable` forbidden.
- `bun run typecheck` must pass at every task milestone.
- Every task must carry its own explicit unit test suite with 100% pass rate.
- Task granularity must be strictly right-sized to 1–2 target files per task.

---

### Task 1: Extend `RepoPolicy` with `PlanningPolicy` Schema

**Files:**

- Modify: `olt/scripts/src/policy/repo-policy.ts`
- Test: `tests/unit/policy/repo-policy-planning.test.ts`

**Interfaces:**

- Produces: `export interface PlanningPolicy { readonly mandatory_brainstorming_rounds: number; readonly socratic_expansion_depth: number; readonly enforce_edge_case_matrix: boolean; readonly min_tasks_per_complex_prompt: number; readonly max_files_per_task: number; readonly reject_shallow_umbrella_compression: boolean; }`
- Defaults: `mandatory_brainstorming_rounds: 3`, `socratic_expansion_depth: 8`, `enforce_edge_case_matrix: true`, `min_tasks_per_complex_prompt: 6`, `max_files_per_task: 2`, `reject_shallow_umbrella_compression: true`.

- [ ] **Step 1: Write failing unit test for `PlanningPolicy` schema and validation**

```typescript
import { describe, it, expect } from "bun:test";
import {
  generateDefaultRepoPolicy,
  validateRepoPolicy,
  type RepoPolicy,
} from "../../../olt/scripts/src/policy/repo-policy.ts";

describe("RepoPolicy - PlanningPolicy", () => {
  it("includes default planning policy in generated policy", () => {
    const policy = generateDefaultRepoPolicy();
    expect(policy.planning).toBeDefined();
    expect(policy.planning?.mandatory_brainstorming_rounds).toBe(3);
    expect(policy.planning?.socratic_expansion_depth).toBe(8);
    expect(policy.planning?.enforce_edge_case_matrix).toBe(true);
    expect(policy.planning?.min_tasks_per_complex_prompt).toBe(6);
    expect(policy.planning?.max_files_per_task).toBe(2);
  });

  it("validates and preserves custom planning policy settings", () => {
    const raw = {
      schema_version: 1,
      ecosystem: "bun",
      planning: {
        mandatory_brainstorming_rounds: 5,
        socratic_expansion_depth: 10,
        enforce_edge_case_matrix: true,
        min_tasks_per_complex_prompt: 12,
        max_files_per_task: 1,
        reject_shallow_umbrella_compression: true,
      },
    };

    const validated = validateRepoPolicy(raw);
    expect(validated.planning?.mandatory_brainstorming_rounds).toBe(5);
    expect(validated.planning?.min_tasks_per_complex_prompt).toBe(12);
    expect(validated.planning?.max_files_per_task).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/policy/repo-policy-planning.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `PlanningPolicy` in `repo-policy.ts`**

Update `olt/scripts/src/policy/repo-policy.ts` to export `PlanningPolicy`, `DEFAULT_PLANNING_POLICY`, and integrate validation in `validateRepoPolicy` and defaults in `generateDefaultRepoPolicy`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/policy/repo-policy-planning.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add olt/scripts/src/policy/repo-policy.ts tests/unit/policy/repo-policy-planning.test.ts
git commit -m "feat(policy): extend RepoPolicy with configurable PlanningPolicy schema"
```

---

### Task 2: Implement Socratic 8-Vector Brainstorming Engine (`BrainstormEngine`)

**Files:**

- Create: `olt/scripts/src/graph/brainstorm-engine.ts`
- Test: `tests/unit/graph/brainstorm-engine.test.ts`

**Interfaces:**

- Produces: `export class BrainstormEngine { public static expandPromptToVectors(prompt: string, rounds?: number): BrainstormResult; }`
- Vectors: `EMPTY_PAYLOAD`, `TIMEOUT_STAGNATION`, `CONCURRENCY_MUTATION`, `HOST_BOUNDARY`, `STATE_TRANSITION`, `TYPE_INVARIANT`, `CLI_TELEMETRY`, `ADVERSARIAL_GATE`.

- [ ] **Step 1: Write failing unit test for `BrainstormEngine`**

```typescript
import { describe, it, expect } from "bun:test";
import { BrainstormEngine } from "../../../olt/scripts/src/graph/brainstorm-engine.ts";

describe("BrainstormEngine", () => {
  it("expands prompt requirements across all 8 Socratic failure vectors", () => {
    const prompt = "Harden agent system against small model errors and improve CLI error handling";
    const result = BrainstormEngine.expandPromptToVectors(prompt, 3);

    expect(result.roundsExecuted).toBe(3);
    expect(result.vectors.length).toBe(8);
    expect(result.expandedItems.length).toBeGreaterThanOrEqual(8);

    const vectorNames = result.vectors.map((v) => v.id);
    expect(vectorNames).toContain("EMPTY_PAYLOAD");
    expect(vectorNames).toContain("TIMEOUT_STAGNATION");
    expect(vectorNames).toContain("HOST_BOUNDARY");
    expect(vectorNames).toContain("TYPE_INVARIANT");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/graph/brainstorm-engine.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `BrainstormEngine`**

Implement `olt/scripts/src/graph/brainstorm-engine.ts` returning typed `BrainstormResult` with 8 concrete Socratic expansion vectors and prompt line mappings.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/graph/brainstorm-engine.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add olt/scripts/src/graph/brainstorm-engine.ts tests/unit/graph/brainstorm-engine.test.ts
git commit -m "feat(graph): implement Socratic 8-vector BrainstormEngine"
```

---

### Task 3: Implement `plan:brainstorm` CLI Command

**Files:**

- Create: `olt/scripts/src/cli/commands/plan-brainstorm.ts`
- Modify: `olt/scripts/src/cli/execute.ts`
- Test: `tests/unit/cli/plan-brainstorm-command.test.ts`

**Interfaces:**

- CLI usage: `bun harness.ts plan:brainstorm --run <run-id> [--rounds <N>] [--save]`
- Produces: Formatted ASCII brainstorming table, persists `brainstorming.json` in capsule root, and emits `plan-brainstormed` event to `events.jsonl`.

- [ ] **Step 1: Write failing unit test for `plan:brainstorm` CLI command**

```typescript
import { describe, it, expect } from "bun:test";
import { executePlanBrainstorm } from "../../../olt/scripts/src/cli/commands/plan-brainstorm.ts";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("plan:brainstorm command", () => {
  it("executes brainstorming rounds and saves brainstorming.json in capsule", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "olt-test-brainstorm-"));
    const promptPath = join(tempDir, "prompt.md");
    writeFileSync(
      promptPath,
      "Enhance planner with deep edge case discovery\nAdd state machine check",
    );

    const result = await executePlanBrainstorm({
      runRoot: tempDir,
      rounds: 3,
      save: true,
    });

    expect(result.success).toBe(true);
    expect(result.roundsExecuted).toBe(3);
    expect(result.totalExpandedItems).toBeGreaterThanOrEqual(6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/cli/plan-brainstorm-command.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `plan-brainstorm.ts` and register in `execute.ts`**

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/cli/plan-brainstorm-command.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add olt/scripts/src/cli/commands/plan-brainstorm.ts olt/scripts/src/cli/execute.ts tests/unit/cli/plan-brainstorm-command.test.ts
git commit -m "feat(cli): add plan:brainstorm command with capsule persistence"
```

---

### Task 4: Add Invariants `A7-edge-case-exhaustiveness` & `A8-systemic-decomposition` to `plan-audit.ts`

**Files:**

- Modify: `olt/scripts/src/graph/plan-audit.ts`
- Test: `tests/unit/graph/plan-audit-a7-a8.test.ts`

**Interfaces:**

- `A7-edge-case-exhaustiveness`: Rejects plans with 0 mapped edge-case vectors when prompt carries $>5$ lines.
- `A8-systemic-decomposition`: Rejects plans compressing complex prompts ($>10$ lines) into fewer than `policy.planning.min_tasks_per_complex_prompt` tasks.

- [ ] **Step 1: Write failing unit test for `A7` and `A8` invariants**

```typescript
import { describe, it, expect } from "bun:test";
import { auditPlan } from "../../../olt/scripts/src/graph/plan-audit.ts";

describe("plan-audit A7 and A8 invariants", () => {
  const repoRoot = process.cwd();

  it("A8 blocks plans that compress complex prompts into too few tasks", () => {
    const prompt = Array.from(
      { length: 15 },
      (_, i) => `Line ${i + 1}: Actionable requirement`,
    ).join("\n");
    const tasks = [
      { taskId: "task-1", writeScope: ["olt/agents"], deps: [], gate: "bun test" },
      { taskId: "task-2", writeScope: ["olt/roles"], deps: [], gate: "bun test" },
    ];

    const result = auditPlan(repoRoot, tasks, {}, prompt);
    const a8 = result.findings.find((f) => f.invariant === "A8-systemic-decomposition");
    expect(a8).toBeDefined();
    expect(a8?.severity).toBe("blocking");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/graph/plan-audit-a7-a8.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `A7` and `A8` audit logic in `plan-audit.ts`**

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/graph/plan-audit-a7-a8.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add olt/scripts/src/graph/plan-audit.ts tests/unit/graph/plan-audit-a7-a8.test.ts
git commit -m "feat(graph): add A7 edge-case and A8 systemic-decomposition invariants to plan-audit"
```

---

### Task 5: Implement Mechanical Step Prerequisites in `plan-compile.ts`

**Files:**

- Modify: `olt/scripts/src/cli/commands/plan-compile.ts`
- Test: `tests/unit/cli/plan-compile-prerequisites.test.ts`

**Interfaces:**

- Enforces that `events.jsonl` contains `plan-brainstormed` and `plan-audited` event types before allowing compilation.
- Throws `HarnessError("INVALID_STATE", "[MANDATORY_PLAN_STEP_SKIPPED] Cannot compile plan: plan:brainstorm must be executed first.")`.

- [ ] **Step 1: Write failing unit test for `plan:compile` step prerequisites**

```typescript
import { describe, it, expect } from "bun:test";
import { executePlanCompile } from "../../../olt/scripts/src/cli/commands/plan-compile.ts";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";

describe("plan:compile prerequisites", () => {
  it("throws MANDATORY_PLAN_STEP_SKIPPED when plan:brainstorm has not been run", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "olt-compile-test-"));
    writeFileSync(join(tempDir, "state.json"), JSON.stringify({ planning_tasks: [{ id: "t1" }] }));
    writeFileSync(join(tempDir, "events.jsonl"), ""); // No brainstorm event

    expect(async () => {
      await executePlanCompile({ runRoot: tempDir, actor: "planner" });
    }).toThrow(HarnessError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/cli/plan-compile-prerequisites.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement prerequisite checks in `plan-compile.ts`**

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/cli/plan-compile-prerequisites.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add olt/scripts/src/cli/commands/plan-compile.ts tests/unit/cli/plan-compile-prerequisites.test.ts
git commit -m "feat(cli): enforce mechanical step prerequisites in plan:compile"
```

---

### Task 6: Implement `LifecycleStateMachineAuditor` & Integrate into `doctor.ts`

**Files:**

- Create: `olt/scripts/src/reporting/doctor/state-machine-auditor.ts`
- Modify: `olt/scripts/src/reporting/doctor.ts`
- Test: `tests/unit/reporting/state-machine-auditor.test.ts`

**Interfaces:**

- Produces: `export class StateMachineAuditor { public static auditLifecycle(runState: JsonObject, events: readonly JsonObject[]): LifecycleFinding[]; }`
- Flags: `PLANNING_BRAINSTORMING_SKIPPED`, `PLAN_VALIDATION_SKIPPED`, `UNVALIDATED_TASK_COMPLETED`.

- [ ] **Step 1: Write failing unit test for `StateMachineAuditor`**

```typescript
import { describe, it, expect } from "bun:test";
import { StateMachineAuditor } from "../../../olt/scripts/src/reporting/doctor/state-machine-auditor.ts";

describe("StateMachineAuditor", () => {
  it("flags skipped plan validation when tasks are completed directly from planning", () => {
    const state = {
      tasks: {
        "task-1": { status: "done", validations: [] }, // Done without validation receipt!
      },
    };

    const findings = StateMachineAuditor.auditLifecycle(state as any, []);
    expect(findings.some((f) => f.code === "UNVALIDATED_TASK_COMPLETED")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/reporting/state-machine-auditor.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `state-machine-auditor.ts` and wire into `runDoctor` in `doctor.ts`**

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/reporting/state-machine-auditor.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add olt/scripts/src/reporting/doctor/state-machine-auditor.ts olt/scripts/src/reporting/doctor.ts tests/unit/reporting/state-machine-auditor.test.ts
git commit -m "feat(reporting): integrate LifecycleStateMachineAuditor into doctor command"
```

---

### Task 7: Update Role Contracts and Agent YAMLs

**Files:**

- Modify: `olt/roles/planner.md`
- Modify: `olt/roles/plan-validator.md`
- Modify: `olt/agents/planner.yaml`
- Modify: `olt/agents/plan-validator.yaml`
- Test: `tests/unit/roles/planner-contract.test.ts`

- [ ] **Step 1: Update `planner.md` and `planner.yaml` to mandate the 8-Vector Expansion and `plan:brainstorm` execution**
- [ ] **Step 2: Update `plan-validator.md` to enforce adversarial rejection of shallow umbrella compression (`[SHALLOW_PLAN_BLUNDER]`)**
- [ ] **Step 3: Run `bun run typecheck` to verify 100% type safety**
- [ ] **Step 4: Commit & Sync**

```bash
git add olt/roles/planner.md olt/roles/plan-validator.md olt/agents/planner.yaml olt/agents/plan-validator.yaml
git commit -m "docs(roles): update planner and plan-validator with Socratic expansion and adversarial rejection"
bun scripts/sync-global.ts
```

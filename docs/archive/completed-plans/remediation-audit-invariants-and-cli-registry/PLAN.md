# Master Plan: CLI Registry Disambiguation, Feedback Category Normalization & Repository Invariant Remediation

> **Tracking ID:** `fb-1788022000000-remediation-cli-registry-and-invariants-compliance`  
> **Status:** `PLANNED - READY FOR COORDINATOR DISPATCH`  
> **Priority:** `CRITICAL_USER_FEEDBACK`  
> **Target Subsystems:** `olt/scripts/src/cli/registry/`, `olt/scripts/src/mind/feedback/`, `olt/scripts/src/mind/preplanning/`, `olt/scripts/src/graph/`, `olt/scripts/src/telemetry/`, `olt/scripts/src/validation/`  
> **Author:** Pipeline Pre-Planning Meta-Orchestrator (`orchestrator_pipeline_preplanning`)  
> **Created:** 2026-08-29

---

## Level 1: Executive Context & Problem Statement

### 1.1 Architectural Context & Root Causes

During multi-agent continuous execution, forensic analysis and archive audits identified five structural invariant regressions and operational friction points:

1. **CLI Registry Collision on Duplicate Alias (`init`)**:
   `olt/scripts/src/cli/registry/run.ts` and `olt/scripts/src/cli/registry/plan.ts` both declared alias `"init"`. `BY_INVOCATION` indexing in `olt/scripts/src/cli/registry/index.ts` enforces unique command and alias registration and throws `Error: duplicate CLI command name: init`, crashing any harness invocation indexing the registry.
   _Root Cause:_ Lack of compile-time alias disambiguation between `plan:init` and `run:init`.

2. **Feedback Category Validation Failure for `ENGINE` and `COMMUNICATION`**:
   Active `.olt/backlog.jsonl` contains backlog entries with `category: "ENGINE"`, `"COMMUNICATION"`, `"VALIDATION"`, `"NOTIFICATION"`, `"GOVERNANCE"`, `"ORCHESTRATION"`, and `"AUDITING"`. In `olt/scripts/src/mind/feedback/queue/types.ts`, `validateCategory()` throws `HarnessError("INTEGRITY", "Feedback item requires valid category")` when encountering these unmapped categories during `smart:synthesize` and task admission.
   _Root Cause:_ Incomplete category enum union and normalization mappings in feedback ingestion.

3. **Wildcard Facade Exports (`export *`)**:
   Multiple facade modules (`mind/preplanning/index.ts`, `graph/index.ts`, `telemetry/index.ts`, `telemetry/collectors/index.ts`) violate the repository's explicit named exports invariant by using wildcard `export *` re-exports, degrading IDE symbol resolution and tree-shaking guarantees.

4. **Source Density Budget Violations**:
   Oversized monolithic files (>300 physical lines) and directories containing >10 files exist across `cli/commands/`, `reporting/doctor/`, and `packets/`, violating density budgets.

5. **Code Comments Invariant Violations**:
   Source files in `olt/scripts/src/` contain non-documentation comments, violating the ZERO_CODE_COMMENTS invariant across all executable `.ts` files.

---

## Level 2: Target Architecture & ASCII Unicode Topology

```text
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                   INVARIANT REMEDIATION & REGISTRY NORMALIZATION TOPOLOGY                   │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
                                            │
               ┌────────────────────────────┼────────────────────────────┐
               ▼                            ▼                            ▼
┌─────────────────────────────┐┌─────────────────────────────┐┌─────────────────────────────┐
│     CLI Registry Layer      ││    Feedback Queue Layer     ││    Facade & Index Layer     │
│ ─────────────────────────── ││ ─────────────────────────── ││ ─────────────────────────── │
│ • Unique Invocation Map     ││ • Extended Category Union   ││ • Explicit Named Exports    │
│ • Disambiguated Aliases     ││ • Bidirectional Normalize   ││ • Zero Wildcard "export *"  │
│ • Deterministic Handlers    ││ • Atomic Ingestion Parser   ││ • Strict Surface Facades   │
└─────────────────────────────┘└─────────────────────────────┘└─────────────────────────────┘
               │                            │                            │
               └────────────────────────────┼────────────────────────────┘
                                            ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                              DENSITY & QUALITY RATTER GATES                                 │
│ ─────────────────────────────────────────────────────────────────────────────────────────── │
│ • Density Budget: ≤ 300 Physical Lines / File, ≤ 10 Files / Subsystem Directory             │
│ • Code Hygiene: Zero Code Comments in all TypeScript files (Exempt: *.md, *.yaml, *.jsonl)  │
│ • Zero TypeScript 'any' and Zero Compiler Suppressions                                      │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Level 3: Disjoint Scope Boundaries

| Scope Domain             | Path Specification                                                                                                                                                   | Access Contract       |
| :----------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------- |
| **Write Scope (Lane A)** | `olt/scripts/src/cli/registry/plan.ts`, `olt/scripts/src/cli/registry/run.ts`, `olt/scripts/src/cli/registry/index.ts`, `tests/unit/cli/registry-uniqueness.test.ts` | Exclusive Write Lease |
| **Write Scope (Lane B)** | `olt/scripts/src/mind/feedback/queue/types.ts`, `olt/scripts/src/mind/feedback/queue/validator.ts`, `tests/unit/mind/feedback-category.test.ts`                      | Exclusive Write Lease |
| **Write Scope (Lane C)** | `olt/scripts/src/mind/preplanning/index.ts`, `olt/scripts/src/graph/index.ts`, `olt/scripts/src/telemetry/index.ts`, `olt/scripts/src/telemetry/collectors/index.ts` | Exclusive Write Lease |
| **Read-Only Scope**      | `olt/scripts/src/core/`, `olt/scripts/src/authority/`, `.olt/backlog.jsonl`, `.olt/defects.jsonl`                                                                    | Read-Only             |

---

## Level 4: Atomic Implementation Tasks Matrix

| Task ID        | Target File Path                                | Exact TypeScript Symbols / Signatures                                  | Deliverable & Contract ($\le 300$ lines, 0 comments)                                                                                                                                         |
| :------------- | :---------------------------------------------- | :--------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `task-rem-1.1` | `olt/scripts/src/cli/registry/plan.ts`          | `PLAN_COMMANDS: readonly CommandSpec[]`                                | Disambiguate `plan:init` alias from `"init"` to `["plan-init", "init-plan"]`. Ensure zero overlap with `run:init`.                                                                           |
| `task-rem-1.2` | `olt/scripts/src/cli/registry/run.ts`           | `RUN_COMMANDS: readonly CommandSpec[]`                                 | Disambiguate `run:init` alias to `["run-init", "capsule-init"]` or canonical empty alias list.                                                                                               |
| `task-rem-1.3` | `tests/unit/cli/registry-uniqueness.test.ts`    | `describe("CLI Registry Uniqueness", ...)`                             | Unit test verifying zero duplicate command names/aliases across `COMMAND_REGISTRY` and asserting `findCommand("plan:init")` and `findCommand("run:init")` resolve deterministically.         |
| `task-rem-2.1` | `olt/scripts/src/mind/feedback/queue/types.ts`  | `FeedbackCategory`, `validateCategory(val: unknown): FeedbackCategory` | Extend `FeedbackCategory` union with `"ENGINE"`, `"COMMUNICATION"`, `"VALIDATION"`, `"NOTIFICATION"`, `"GOVERNANCE"`, `"ORCHESTRATION"`, `"AUDITING"`. Normalize synonyms deterministically. |
| `task-rem-2.2` | `tests/unit/mind/feedback-category.test.ts`     | `describe("Feedback Category Normalization", ...)`                     | Unit test validating all backlog categories parse without throwing `HarnessError("INTEGRITY")`.                                                                                              |
| `task-rem-3.1` | `olt/scripts/src/mind/preplanning/index.ts`     | `export { ... }` (Named Exports)                                       | Replace `export * from "./types.ts"`, etc., with explicit named exports.                                                                                                                     |
| `task-rem-3.2` | `olt/scripts/src/graph/index.ts`                | `export { ... }` (Named Exports)                                       | Replace `export *` statements with explicit named exports for graph components, validators, and renderers.                                                                                   |
| `task-rem-3.3` | `olt/scripts/src/telemetry/index.ts`            | `export { ... }` (Named Exports)                                       | Convert telemetry facade to explicit named exports.                                                                                                                                          |
| `task-rem-3.4` | `olt/scripts/src/telemetry/collectors/index.ts` | `export { ... }` (Named Exports)                                       | Convert collector facade to explicit named exports.                                                                                                                                          |

---

## Level 5: Falsifiable Gate Verification Commands

```bash
# Gate 1: CLI Registry Uniqueness & Deterministic Resolution
bun test tests/unit/cli/registry-uniqueness.test.ts

# Gate 2: Feedback Category Normalization & Backlog Parsing
bun test tests/unit/mind/feedback-category.test.ts

# Gate 3: Facade Typechecking & Coding Conventions
bun test tests/unit/validation/coding-conventions.test.ts

# Gate 4: Repository Static Verification Interlock
bun ~/.agents/skills/olt/scripts/harness.ts task:check --repo .
```

---

## Level 6: Strict Invariant Enforcement

1. **Zero Code Comments**: No inline `//`, multiline `/* */`, or docblock `/** */` comments permitted in any `.ts` file.
2. **Density Budget**: Every modified file must remain $\le 300$ physical lines. Subdirectories must contain $\le 10$ files.
3. **Ban Defect-Prefix Source Files**: No `defect-*.ts` or `fb-*.ts` files permitted in source or test directories.
4. **Explicit Named Exports**: No `export *` wildcard re-exports. Every symbol must be explicitly named in `index.ts`.
5. **Zero Backwards-Compatibility Shims**: No deprecated type aliases, dead shims, or polyfill fallbacks.

---

## Level 7: Sequential Critical Path DAG & Work/Span Optimization

```text
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                             CRITICAL PATH DAG (KAHN SORT)                                   │
└─────────────────────────────────────────────────────────────────────────────────────────────┘

  [Wave 1: Registry & Category Fixes]
      ├── Task rem-1.1 (Plan Registry Alias) ────────┐
      ├── Task rem-1.2 (Run Registry Alias)  ────────┼──► [Gate 1: Registry Uniqueness Test]
      ├── Task rem-1.3 (Registry Unit Test)  ────────┘
      │
      ├── Task rem-2.1 (Category Types Extension) ───┐
      └── Task rem-2.2 (Category Unit Test)      ────┴──► [Gate 2: Category Validation Test]
                                                                  │
                                                                  ▼
  [Wave 2: Facade Explicit Named Exports]
      ├── Task rem-3.1 (Preplanning Facade) ─────────┐
      ├── Task rem-3.2 (Graph Facade)       ─────────┼──► [Gate 3: Coding Conventions Test]
      ├── Task rem-3.3 (Telemetry Facade)   ─────────┤
      └── Task rem-3.4 (Collectors Facade)  ─────────┘
                                                                  │
                                                                  ▼
  [Wave 3: Full Invariant Seal & Clean Release]
      └── Task rem-4.1 (Clean Release & Verification) ──► [Gate 4: task:check & Skill Sync]
```

**Work/Span Calculation**:

- Total Work ($W$): 9 discrete tasks $\approx 18$ minutes.
- Critical Path Span ($S$): 3 sequential wave barriers $\approx 6$ minutes.
- Optimal Concurrency: $P = \lceil W / S \rceil = \lceil 18 / 6 \rceil = 3$ concurrent implementers.
- Hard Concurrency Cap: Never exceed 50 active subagents across all tiers.

---

## Level 8: Exhaustive Traceability Matrix

| Backlog / Defect ID                                                   | Title / Requirement                          | Resolved By Tasks                                              | Falsifiable Gate Verification Target                              |
| :-------------------------------------------------------------------- | :------------------------------------------- | :------------------------------------------------------------- | :---------------------------------------------------------------- |
| `fb-1788022000000-remediation-cli-registry-and-invariants-compliance` | CLI Registry `init` Duplicate Alias Conflict | `task-rem-1.1`, `task-rem-1.2`, `task-rem-1.3`                 | `bun test tests/unit/cli/registry-uniqueness.test.ts`             |
| `fb-1788022000000-remediation-cli-registry-and-invariants-compliance` | Feedback Category Schema Normalization       | `task-rem-2.1`, `task-rem-2.2`                                 | `bun test tests/unit/mind/feedback-category.test.ts`              |
| `defect-modularity-facade-and-zero-comments-violation`                | Wildcard `export *` Elimination in Facades   | `task-rem-3.1`, `task-rem-3.2`, `task-rem-3.3`, `task-rem-3.4` | `bun test tests/unit/validation/coding-conventions.test.ts`       |
| `defect-modularity-facade-and-zero-comments-violation`                | Strict Zero Comments Invariant Enforcement   | All Tasks                                                      | `bun ~/.agents/skills/olt/scripts/harness.ts task:check --repo .` |

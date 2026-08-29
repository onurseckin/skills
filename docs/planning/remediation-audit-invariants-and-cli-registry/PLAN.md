# Remediation Plan: CLI Registry Conflict, Feedback Category Normalization, and Architecture Invariants Compliance

> **Tracking ID:** `fb-1788022000000-remediation-cli-registry-and-invariants-compliance`  
> **Status:** `PLANNED`  
> **Priority:** `HIGH`  
> **Target Subsystems:** `olt/scripts/src/cli/registry/`, `olt/scripts/src/mind/feedback/`, `olt/scripts/src/mind/preplanning/`, `olt/scripts/src/graph/`, `olt/scripts/src/telemetry/`  
> **Author:** Independent Plan Implementation & Archive Auditor  
> **Created:** 2026-08-29

---

## 1. Executive Summary & Audit Findings

During the deep architectural audit of the last 10 completed plans in `docs/archive/completed-plans/`, five critical operational and invariant gaps were discovered in the codebase:

1. **CLI Registry Duplicate Alias Conflict (`init` duplicate)**:
   - `olt/scripts/src/cli/registry/run.ts` (orchestrate) and `olt/scripts/src/cli/registry/plan.ts` (plan:init) both claim the alias `"init"`.
   - `BY_INVOCATION` indexing in `cli/registry/index.ts` throws `Error: duplicate CLI command name: init`, breaking CLI subprocess execution and commands using the registry.
   - **Remediation**: Disambiguate command aliases so that `plan:init` retains `aliases: ["plan-init", "init-plan"]` while `orchestrate` retains `aliases: ["run", "run:init"]` or canonical unique aliases.

2. **Feedback Category Validation Gap (`ENGINE` & `COMMUNICATION`)**:
   - `.olt/backlog.jsonl` contains items with `category: "ENGINE"` and `category: "COMMUNICATION"`.
   - `validateCategory()` in `olt/scripts/src/mind/feedback/queue/types.ts` does not recognize these categories, throwing `HarnessError("INTEGRITY", "Feedback item requires valid category")` during `smart:synthesize`.
   - **Remediation**: Extend `FeedbackCategory` union and `validateCategory()` mapping to accept `"ENGINE"` (maps to `"CORE_ENGINE"` or `"ENGINE"`) and `"COMMUNICATION"` (maps to `"CLI_TOOLING"` or `"COMMUNICATION"`).

3. **Wildcard Facade Exports (`export *`) Elimination**:
   - `olt/scripts/src/mind/preplanning/index.ts`, `graph/index.ts`, `telemetry/index.ts`, and `telemetry/collectors/index.ts` use wildcard `export *` re-exports, violating Invariant 3 (Explicit Named Exports in index.ts Facades).
   - **Remediation**: Replace all `export *` with explicit named exports (`export { ... } from "..."`).

4. **Source Density Budget Remediation (<= 300 Lines/File, <= 10 Files/Dir)**:
   - 101 `.ts` source files exceed 300 physical lines (e.g. `defect-audit.ts` 955 lines, `mind-pulse.ts` 944 lines, `dag-view.ts` 1062 lines, `topology-synthesis.ts` 1008 lines, `multi-capsule.ts` 963 lines).
   - 18 directories contain > 10 files (e.g. `cli/commands` 91 files, `reporting` 33 files, `graph` 34 files, `packets` 46 files).
   - **Remediation**: Decompose oversized monolithic files into cohesive domain sub-modules under dedicated subdirectories with <= 10 files each.

5. **Zero Code Comments in TypeScript Files Enforcement**:
   - 468 `.ts` source files contain 2,387 comments (single-line, block, docblock), violating the ZERO_COMMENTS_INVARIANT.
   - **Remediation**: Execute an AST-preserving comment purge across all `.ts` source files while exempting markdown, YAML, and jsonl documentation.

---

## 2. Work Breakdown & Remediation Tasks

### Wave 1: Immediate Critical Operational Fixes

#### Task 1.1: CLI Registry Alias Conflict Disambiguation
- **Files:** `olt/scripts/src/cli/registry/run.ts`, `olt/scripts/src/cli/registry/plan.ts`
- **Action:** Remove duplicate `"init"` alias from `run.ts` or disambiguate to `"orchestrate-init"`. Ensure every command name and alias in `COMMAND_REGISTRY` is globally unique.
- **Verification Gate:** `bun test tests/unit/workflow/task-check.test.ts` (subprocess spawn tests pass 100%).

#### Task 1.2: Feedback Category Schema & Normalization Extension
- **Files:** `olt/scripts/src/mind/feedback/queue/types.ts`
- **Action:** Add `"ENGINE"`, `"COMMUNICATION"`, `"VALIDATION"`, `"TOOLING"` to `FeedbackCategory` and `validateCategory()`.
- **Verification Gate:** `bun test tests/unit/cli/smart-task-ops.test.ts` (100% PASS).

### Wave 2: Facade & Density Modularization

#### Task 2.1: Named Index Facades Conversion
- **Files:** `olt/scripts/src/mind/preplanning/index.ts`, `olt/scripts/src/graph/index.ts`, `olt/scripts/src/telemetry/index.ts`, `olt/scripts/src/telemetry/collectors/index.ts`
- **Action:** Convert all `export *` statements to explicit named exports.
- **Verification Gate:** `bun test tests/unit/validation/coding-conventions.test.ts`.

#### Task 2.2: Large File & Directory Decomposition
- **Files:** Top oversized files in `cli/commands/`, `orchestrator/`, `packets/`, `summary/`, `reporting/`
- **Action:** Split into domain-semantic sub-modules adhering to $\le 300$ physical lines and $\le 10$ files per directory.

### Wave 3: Zero-Comment Invariant Alignment

#### Task 3.1: Repository TypeScript Comment Purge
- **Files:** All `.ts` files under `olt/scripts/src/`
- **Action:** Strip all code comments while preserving non-code documentation files (.md, .yaml, .json).
- **Verification Gate:** `validateZeroCommentsInCode` on all `.ts` files passes with 0 violations.

---

## 3. Exhaustive Traceability Matrix

| Finding / Gap ID                                       | Target Subsystem               | Remediation Task | Verification Gate                                           |
| :----------------------------------------------------- | :----------------------------- | :--------------- | :---------------------------------------------------------- |
| `fb-cli-registry-duplicate-init-alias`                 | `cli/registry/`                | Task 1.1         | `bun test tests/unit/workflow/task-check.test.ts`           |
| `fb-feedback-category-engine-communication-validation` | `mind/feedback/queue/`         | Task 1.2         | `bun test tests/unit/cli/smart-task-ops.test.ts`             |
| `fb-facade-wildcard-export-elimination`                | `mind/preplanning/`, `graph/`  | Task 2.1         | `bun test tests/unit/validation/coding-conventions.test.ts` |
| `fb-density-budget-oversized-file-decomposition`       | `cli/`, `orchestrator/`        | Task 2.2         | Density budget scanner ($\le 300$ lines, $\le 10$ files)    |
| `fb-zero-comment-invariant-repo-purge`                 | `olt/scripts/src/`             | Task 3.1         | Zero-comment scanner (0 violations across all `.ts`)        |

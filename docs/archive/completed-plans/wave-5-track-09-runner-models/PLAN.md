# Wave 5 Track 9: Engine Runner Models & Workflow Store Imports Remediation Plan

> **Tracking ID:** `fb-wave-5-track-09-runner-models`  
> **Status:** `COMPLETED & ARCHIVED`  
> **Target Subsystems:** `olt/scripts/src/engine/runner/`, `olt/scripts/src/workflow/`, `olt/scripts/src/integration/`, `olt/scripts/src/engine/store/`  
> **Defects:** `defect-engine-runner-models-modularization-import-paths`, `defect-workflow-integrity-evidence-unresolved-store-import`  
> **Implementers:** `implementer_17`, `implementer_18`  
> **Paired Cognitive Validator:** `validator_09`  
> **Created At:** `2026-08-29T17:07:00-07:00`  
> **Completed At:** `2026-08-29T17:09:50-07:00`  
> **Specification Version:** `1.0.0-PROD`

---

## 1. Executive Summary & Defect Scope

Following the modularization of `engine/runner/models/` and `engine/store/`, several consuming modules in `workflow/` and `integration/` were left with stale, deep, or un-canonicalized relative import paths that bypass the clean named facades. Additionally, `workflow/completion/integrity-evidence.ts` referenced internal store modules rather than resolving cleanly through the authoritative `engine/store/index.ts` facade.

### Defect Targets:

1. `defect-engine-runner-models-modularization-import-paths`:
   - Canonicalized imports from `engine/runner/index.ts` in:
     - `integration/recover-gate-attempt.ts`
     - `integration/command-intent-match.ts`
     - `integration/record-command.ts`
     - `integration/incomplete-attempt-recovery.ts`
     - `integration/reconcile-command-attempts.ts`
     - `workflow/completion/completion-state.ts`
     - `workflow/completion/readiness-issues.ts`
     - `workflow/completion/repository-evidence.ts`
     - `workflow/gates/gate-policy.ts`
     - `workflow/review/command-evidence.ts`
2. `defect-workflow-integrity-evidence-unresolved-store-import`:
   - Resolved `workflow/completion/integrity-evidence.ts` store verification import directly to `engine/store/index.ts`.

---

## 2. Invariants & Rules Compliance Report

- **Zero Comments**: 0 comments across all 14 touched production `.ts` files.
- **Zero `any`**: 0 `any` types throughout.
- **$\le 300$ LOC per file**: Maximum file size is 218 LOC (`completion-state.ts`).
- **$\le 10$ files per directory**: Density constraints maintained.
- **Named Facades**: Canonical named re-exports in `engine/runner/index.ts`, `engine/runner/models/index.ts`, and `engine/store/index.ts`.
- **File-scoped unit tests only**: 68+ unit tests passing across all touched subsystems.

---

## 3. 5-Round Adversarial Review Execution

- **Round 1 (Architectural Integrity & Product Alignment)**: **PASSED** — Clean named facades in `engine/runner/index.ts` and `engine/store/index.ts`, decoupled consumers.
- **Round 2 (Modularity & Structural Compliance)**: **PASSED** — All files $\le 218$ LOC, density budgets respected, clean named exports.
- **Round 3 (AST Purity & Type Safety)**: **PASSED** — 0 comments, 0 `any`, strict return signatures.
- **Round 4 (Test Coverage & Edge Cases)**: **PASSED** — 68+ passing unit tests across integration, runner, and workflow suites.
- **Round 5 (Final Sign-off & Clearance)**: **PASSED & FORMALLY CERTIFIED** by `validator_09`.

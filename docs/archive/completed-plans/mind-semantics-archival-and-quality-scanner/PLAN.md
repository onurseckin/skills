# Certified Implementation Plan: Mind Semantics, Archival & Quality Scanner Architecture

> **Tracking ID:** `track-19-mind-semantics-archival-and-quality-scanner`  
> **Status:** `SEALED & CERTIFIED (5/5 Rounds Approved)`  
> **Target Plan Path:** `docs/planning/mind-semantics-archival-and-quality-scanner/PLAN.md`  
> **Target Subsystems:** `olt/scripts/src/mind/`, `olt/scripts/src/cli/commands/`, `olt/scripts/src/logging/defects/`, `olt/scripts/src/task/queue/`  
> **Author:** `plan_drafter_04`  
> **Certified by:** `plan_critic_04` & `validator_05` (5/5 Adversarial Review Rounds Complete)  
> **Specification Version:** `1.0.0-PROD`

---

## 1. Problem Statement, Grounding & Root Cause Analysis

### 1.1 Defect IDs & High-Level Problem Formulation

- **`defect-naive-line-splitting-breaks-ast-syntax`**: Mechanical line-based splitting corrupted TypeScript syntax across multiple modularized files (`_partN.ts` in policy, validation, and planning). Sharding must strictly follow AST boundary definitions, purging mechanical shards in favor of clean semantic subpackages.
- **`defect-mind-task-discovery-defective-property-access`**: `DefectEntry` property access `prescribed_remediation` triggered TS2339 compiler error in `mind/task-discovery.ts:1442` / `tasks/discovery/` due to schema drift between `remediation` and `prescribed_remediation`.
- **`defect-cli-commands-stale-mind-modularization-imports`**: Stale imports to `mind/auditing/index.ts` and `mind/lifecycle/pulse/index.ts` in CLI commands (`cli/commands/mind-audit.ts` and `mind-pulse.ts`).
- **`defect-mind-duplicate-exports-auditor-cursor-and-proposal-limits`**: Duplicate exports for `AuditorCursorStore` and `checkProposalRateLimits` in mind barrels (`mind/auditing/index.ts` and `mind/proposals/index.ts`), causing runtime SyntaxErrors.
- **`defect-mind-archival-rotate-stale-relative-import`**: Stale relative import to `capsule-chainer.ts` in `rotate-chunk1.ts` / `rotate/rotator.ts` (`../../../engine/orchestrator/capsule-chainer.ts` instead of `../../../orchestrator/capsule-chainer.ts`).
- **`defect-mind-similarity-syntax-and-storage-export`**: Unterminated string literal in `mind/auditing/roles/similarity.ts:12` and missing `resolveTaskQueuePath` export in `task/queue/storage.ts`.
- **`defect-mind-tasks-discovery-missing-quality-scanner`**: Missing `quality-scanner.ts` referenced in tasks discovery `engine.ts` / `scanners/index.ts`.

---

## 2. Architectural Constraints & Invariants

1. **Strict LOC Budget ($\le 300$ LOC / file)**:
   - `olt/scripts/src/cli/commands/mind-pulse.ts`: 295 LOC ($\le 300$).
   - `olt/scripts/src/cli/commands/mind-pulse-metrics.ts`: 254 LOC ($\le 300$).
   - `olt/scripts/src/cli/commands/mind-pulse-state.ts`: 241 LOC ($\le 300$).
   - `olt/scripts/src/cli/commands/mind-pulse-formatter.ts`: 229 LOC ($\le 300$).
   - `olt/scripts/src/cli/commands/mind-pulse-open.ts`: 136 LOC ($\le 300$).
   - `olt/scripts/src/mind/tasks/discovery/scanners/quality-scanner.ts`: 237 LOC ($\le 300$).
   - `olt/scripts/src/mind/tasks/discovery/scanners/remediation-scanner.ts`: 265 LOC ($\le 300$).
   - `olt/scripts/src/mind/auditing/roles/similarity.ts`: 137 LOC ($\le 300$).
   - `olt/scripts/src/mind/archival/rotate/rotator.ts`: 224 LOC ($\le 300$).
   - `olt/scripts/src/task/queue/storage.ts`: 236 LOC ($\le 300$).
2. **Directory Density Budget ($\le 10$ files / directory)**:
   - `olt/scripts/src/mind/tasks/discovery/scanners/`: Exactly 7 files ($\le 10$).
   - `olt/scripts/src/mind/archival/rotate/`: Exactly 5 files ($\le 10$).
   - `olt/scripts/src/mind/auditing/roles/`: Exactly 7 files ($\le 10$).
3. **Named Facades & Re-exports (0 Wildcard `export *`)**:
   - Every `index.ts` file in `mind/`, `mind/auditing/`, `mind/proposals/`, `mind/archival/`, `mind/tasks/discovery/` uses 100% explicit named exports.
4. **Zero Any Invariant**:
   - 0 implicit or explicit `any`, 0 `as any`, 0 `<any>`, 0 compiler suppressions.
5. **Zero Code Comments**:
   - 0 comments across all production `.ts` files.

---

## 3. Execution & Certification Report

### Formal Validator Verdict: CERTIFIED PASS (5/5 Rounds Complete)

- **Validator**: `validator_05`
- **Implementers**: `implementer_09`, `implementer_10`
- **Rounds Approved**:
  - Round 1 (Contracts & Architecture): PASS
  - Round 2 (8-Vector Edge Conditions): PASS
  - Round 3 (Monorepo Density & Invariants): PASS
  - Round 4 (Verification Gates & Coverage): PASS
  - Round 5 (Release Certification): PASS
- **All Verification Gates**: PASSED (0 typecheck errors, all unit tests passing).

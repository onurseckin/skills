# Plan 93: Canonical `olt/` Repository Directory, Professional Task Taxonomy & Outer Capsule Path

**Directive Reference**: `p93`  
**Status**: 🔒 **LOCKED & READY FOR IMPLEMENTATION**  
**Location**: `docs/planning/plan-93/PLAN_93_OLT_CANONICAL_STORAGE_AND_CLEAN_TASK_SYSTEM.md`

---

## 1. Scope & Invariants: Outer Storage Organization Only

> [!IMPORTANT]
> **Internal Capsule Structure Invariant**: The internal architecture of runs inside capsules (`state.json`, `index.json`, `packets/`, `evidence/`, `runtime/`) is **100% PRESERVED AND UNCHANGED**.
> This plan modifies ONLY the outer storage paths and project-level governance.

---

## 2. Core Architecture: `olt/` (Committed) vs `capsules/` (Gitignored)

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                           STORAGE ARCHITECTURE SEPARATION MATRIX                                 │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                  │
│  📁 `olt/` (COMMITTED TO GIT — Project Governance & Backlog)                                     │
│  ├── policy.json                <-- Repository ecosystem rules, allowed commands, test runners    │
│  ├── backlog.jsonl              <-- Active task & feature backlog (replaces feedback-queue)       │
│  ├── completed-tasks.jsonl      <-- Historical archive of verified tasks with commit SHAs         │
│  ├── defects.jsonl              <-- Active identified defects/remediations (replaces blunders)    │
│  ├── completed-defects.jsonl    <-- Historical archive of verified defect remediations            │
│  └── telemetry.jsonl            <-- High-level system health insights (replaces observations)     │
│                                                                                                  │
│  📁 `capsules/` (GITIGNORED — Outer Folder Name Only, Internal Structure Untouched)             │
│  └── run-<run_id>/              <-- Standard internal capsule layout remains 100% unchanged!     │
│      ├── state.json             <-- Standard DAG state machine                                   │
│      ├── index.json             <-- Standard task index                                          │
│      ├── packets/               <-- Standard task packets                                        │
│      ├── runtime/               <-- Standard agent metadata manifests                            │
│      └── evidence/              <-- Standard task execution receipts                             │
│                                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Outer Path Migration Mapping

| Item                        | Old Outer Path               | New Canonical Path      | Git Status           |
| :-------------------------- | :--------------------------- | :---------------------- | :------------------- |
| **Persistent Governance**   | `.capsules/mind/queue/*`     | `olt/*`                 | **Committed to Git** |
| **Repo Policy**             | `.capsules/repo-policy.json` | `olt/policy.json`       | **Committed to Git** |
| **Runtime Capsules**        | `.capsules/run-*`            | `capsules/run-*`        | **Gitignored**       |
| **Internal Capsule Layout** | _Standard run contents_      | _Standard run contents_ | **100% UNCHANGED**   |

---

## 4. Target Implementation Files in Skill Monorepo

| Target File Path                                                      | Planned Modifications & Responsibilities                                                            |
| :-------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------- |
| `orchestrating-long-tasks/scripts/src/shared/paths.ts`                | Resolves `olt/` as persistent governance directory and `capsules/` as gitignored runtime directory. |
| `.gitignore`                                                          | Add `capsules/` and ensure `olt/` is tracked in git.                                                |
| `orchestrating-long-tasks/scripts/src/cli/commands/todo.ts`           | Updates backlog CLI to point to `olt/backlog.jsonl`.                                                |
| `orchestrating-long-tasks/scripts/src/mind/product-owner-dispatch.ts` | Updates PO intake pipeline to read from `olt/backlog.jsonl`.                                        |
| `tests/unit/workflow/paths.test.ts`                                   | Unit tests verifying `olt/` path resolution and outer capsule separation.                           |

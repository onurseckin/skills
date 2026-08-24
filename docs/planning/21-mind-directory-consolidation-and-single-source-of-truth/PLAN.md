# Plan 21: Mind Directory Consolidation & Single Source of Truth

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate the Mind charter into the canonical single source of truth location (`docs/CHARTER.md`), remove all duplicate and orphaned `mind/` directories (`docs/mind/` and `olt/mind/`), archive historical evolution documents to `docs/archive/`, update all 15+ hardcoded TypeScript references, and remove the `mind` entry from `sync-global.ts`.

**Architecture:**

- The **single source of truth** for the Mind charter is `docs/CHARTER.md` (moved from `docs/mind/CHARTER.md` up one level — no special `mind/` subdirectory).
- `olt/mind/` is deleted entirely. Historical charter evolution files are moved to `docs/archive/` for reference only.
- `docs/mind/` is deleted entirely.
- All 15 TypeScript files that hardcode `"docs/mind/CHARTER.md"` are updated to `"docs/CHARTER.md"`.
- `scripts/sync-global.ts` removes `"mind"` from the `ENTRIES` array.

**Tech Stack:** TypeScript, Bun, path normalization, file system operations.

**Spec:** `AGENTS.md` (Axiom 18: Infinite Mind Product Owner Mode, Axiom 27: Canonical `olt/` Directory).

## Global Constraints

- 0 `any` annotations.
- `bun run typecheck` must pass after every task.
- All existing unit tests must continue to pass.
- No new runtime behavior changes — this is purely a structural consolidation.

---

### Task 1: Relocate charter, delete duplicate directories, archive historical files

**Files to modify:**

- Move: `docs/mind/CHARTER.md` → `docs/CHARTER.md`
- Move to archive: `olt/mind/charter-capture-evolution.md`, `olt/mind/charter-harness-infinite-evolution.md`, `olt/mind/charter-harness-infinite-evolution-v2.md`, `olt/mind/charter-scheduler-evolution.md` → `docs/archive/`
- Delete: `docs/mind/` (entire directory)
- Delete: `olt/mind/` (entire directory)

**Write scope:** `docs/`, `olt/mind/`

- [ ] **Step 1:** Create `docs/archive/` directory
- [ ] **Step 2:** Move `docs/mind/CHARTER.md` to `docs/CHARTER.md`
- [ ] **Step 3:** Move all 4 historical charter files from `olt/mind/` to `docs/archive/`
- [ ] **Step 4:** Remove empty `docs/mind/` and `olt/mind/` directories
- [ ] **Step 5:** Verify `docs/CHARTER.md` exists and is readable
- [ ] **Step 6:** Commit: `refactor(docs): consolidate mind charter to docs/CHARTER.md and archive historical charters`

---

### Task 2: Update all TypeScript hardcoded references from `docs/mind/CHARTER.md` to `docs/CHARTER.md`

**Files to modify (15 files with hardcoded `"docs/mind/CHARTER.md"` paths):**

- `olt/scripts/src/cli/commands/mind-admit.ts`
- `olt/scripts/src/cli/commands/mind-pulse-open.ts`
- `olt/scripts/src/cli/commands/mind-pulse.ts`
- `olt/scripts/src/cli/registry/mind.ts`
- `olt/scripts/src/mind/brief.ts`
- `olt/scripts/src/mind/lanes/rescue.ts`
- `olt/scripts/src/mind/memory.ts`
- `olt/scripts/src/mind/rotate.ts`
- `olt/scripts/src/mind/smart-task-manager.ts`
- `olt/scripts/src/mind/task-discovery.ts`
- `olt/references/cli-capabilities.md`

**Write scope:** `olt/scripts/src/`, `olt/references/`

- [ ] **Step 1:** Search-and-replace all occurrences of `"docs/mind/CHARTER.md"` with `"docs/CHARTER.md"` across all TypeScript and markdown files.
- [ ] **Step 2:** Run `bun run typecheck` — must exit 0.
- [ ] **Step 3:** Run existing mind-related unit tests to verify no regressions.
- [ ] **Step 4:** Commit: `refactor(olt): update charter path references from docs/mind/ to docs/`

---

### Task 3: Remove `"mind"` from `sync-global.ts` ENTRIES array

**Files to modify:**

- `scripts/sync-global.ts` (remove `"mind"` from `ENTRIES` array)

**Write scope:** `scripts/`

- [ ] **Step 1:** Edit `scripts/sync-global.ts` and remove the `"mind"` entry from the `ENTRIES` array.
- [ ] **Step 2:** Run `bun run typecheck` — must exit 0.
- [ ] **Step 3:** Run `bun scripts/sync-global.ts` to verify clean sync without `mind/` propagation.
- [ ] **Step 4:** Verify `~/.agents/skills/olt/mind/` is no longer created/populated.
- [ ] **Step 5:** Commit: `fix(sync): remove orphaned mind directory from global skill sync`
- [ ] **Step 6:** Push to main and run global sync.

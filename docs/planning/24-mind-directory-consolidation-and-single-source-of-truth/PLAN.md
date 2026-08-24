# Plan 24: Mind Directory Consolidation & Single Source of Truth

> **Priority:** HIGHEST URGENCY — must execute before any further Mind deployments.

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task.

**Problem:** The Mind agent has special-treatment directories (`docs/mind/`, `olt/mind/`) that no other role has. All other agents use the canonical `olt/roles/`, `olt/agents/`, and `olt/references/` locations. This inconsistency causes:

1. **Duplicate files**: `docs/mind/CHARTER.md` and `olt/mind/CHARTER.md` are byte-identical copies (2629 bytes). Changes to one are not reflected in the other.
2. **Orphaned historical charters**: `olt/mind/` contains 4 orphaned historical charter evolution markdown files with zero code references — dead weight that confuses agents into thinking they are authoritative.
3. **Special treatment blunder risk**: New agents or implementers see `olt/mind/` and assume Mind has a unique governance folder, leading them to dump files there (or create new `mind/` folders in wrong locations).
4. **`sync-global.ts` propagation**: The `"mind"` entry in `ENTRIES` array (line 69) syncs the orphaned `olt/mind/` folder globally to every assistant platform via `~/.agents/skills/olt/mind/`.

**Goal:** Consolidate the Mind charter into the canonical single source of truth location, remove all duplicate and orphaned `mind/` directories, update all 15+ hardcoded TypeScript references, and remove the `mind` entry from `sync-global.ts`.

**Architecture:**

- The **single source of truth** for the Mind charter is `docs/CHARTER.md` (moved from `docs/mind/CHARTER.md` up one level — no special `mind/` subdirectory).
- `olt/mind/` is deleted entirely. Historical charter evolution files are moved to `docs/archive/` for reference only.
- `docs/mind/` is deleted entirely.
- All 15 TypeScript files that hardcode `"docs/mind/CHARTER.md"` are updated to `"docs/CHARTER.md"`.
- `scripts/sync-global.ts` removes `"mind"` from the `ENTRIES` array.

**Tech Stack:** TypeScript, Bun, path normalization, file system operations.

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

- `olt/scripts/src/cli/commands/mind-admit.ts` (line 67)
- `olt/scripts/src/cli/commands/mind-pulse-open.ts` (line 151)
- `olt/scripts/src/cli/commands/mind-pulse.ts` (line 697)
- `olt/scripts/src/cli/registry/mind.ts` (line 159)
- `olt/scripts/src/mind/brief.ts` (line 341)
- `olt/scripts/src/mind/lanes/rescue.ts` (line 214)
- `olt/scripts/src/mind/memory.ts` (lines 715, 732, 737, 752, 774)
- `olt/scripts/src/mind/rotate.ts` (line 102)
- `olt/scripts/src/mind/smart-task-manager.ts` (line 1939)
- `olt/scripts/src/mind/task-discovery.ts` (line 331)
- `olt/references/cli-capabilities.md` (line 2268)

**Write scope:** `olt/scripts/src/`, `olt/references/`

- [ ] **Step 1:** Search-and-replace all occurrences of `"docs/mind/CHARTER.md"` with `"docs/CHARTER.md"` across all TypeScript and markdown files listed above.
- [ ] **Step 2:** Run `bun run typecheck` — must exit 0.
- [ ] **Step 3:** Run existing mind-related unit tests to verify no regressions.
- [ ] **Step 4:** Commit: `refactor(olt): update charter path references from docs/mind/ to docs/`

---

### Task 3: Remove `"mind"` from `sync-global.ts` ENTRIES array

**Files to modify:**

- `scripts/sync-global.ts` (line 69: remove `"mind"` from `ENTRIES` array)

**Write scope:** `scripts/`

- [ ] **Step 1:** Edit `scripts/sync-global.ts` and remove the `"mind"` entry from the `ENTRIES` array (line 69).
- [ ] **Step 2:** Run `bun run typecheck` — must exit 0.
- [ ] **Step 3:** Run `bun scripts/sync-global.ts` to verify clean sync without `mind/` propagation.
- [ ] **Step 4:** Verify `~/.agents/skills/olt/mind/` is no longer created/populated.
- [ ] **Step 5:** Commit: `fix(sync): remove orphaned mind directory from global skill sync`
- [ ] **Step 6:** Push to main and run global sync.

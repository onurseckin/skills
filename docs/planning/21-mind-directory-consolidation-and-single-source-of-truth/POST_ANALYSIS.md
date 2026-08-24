# Plan 21 Post-Analysis: Mind Directory Consolidation & Single Source of Truth

## Executive Summary

An evidence-based audit of Plan 21 indicates that the consolidation of the Mind charter and cleanup of legacy directories is largely successful, with one minor documentation gap. However, structurally, the decision to host the canonical charter at `docs/CHARTER.md` creates a fundamental architectural leak that breaks the `olt` global skill distribution model.

## Task 1: Relocate charter, delete duplicate directories, archive historical files

**Status:** Fully Implemented

**Evidence:**

- **Charter Relocated:** The canonical charter now resides at `docs/CHARTER.md`.
- **Directories Deleted:** The duplicate and orphaned `docs/mind/` and `olt/mind/` directories have been completely removed from the repository.
- **Archival Complete:** The historical evolution documents have been safely relocated to `docs/archive/` (e.g., `docs/archive/charter-scheduler-evolution.md`, `docs/archive/charter-harness-infinite-evolution-v2.md`).

## Task 2: Update all TypeScript hardcoded references

**Status:** Partially Implemented

**Evidence (Success):**
14 hardcoded references to `"docs/mind/CHARTER.md"` were correctly updated to `"docs/CHARTER.md"` across the `olt/scripts/src/` TypeScript codebase, including key files like:

- `olt/scripts/src/cli/commands/mind-admit.ts:65`
- `olt/scripts/src/cli/commands/mind-pulse.ts:695`
- `olt/scripts/src/mind/smart-task-manager.ts:1945`
- `olt/scripts/src/mind/memory.ts`

**Evidence (Gap):**
A markdown reference was missed in the documentation:

- `olt/references/cli-capabilities.md:2268`:
  ```bash
  bun harness.ts mind:init --repo . --charter docs/mind/CHARTER.md --actor owner
  ```

## Task 3: Remove `"mind"` from `sync-global.ts` ENTRIES array

**Status:** Fully Implemented

**Evidence:**

- `scripts/sync-global.ts` has successfully removed `"mind"` from the `ENTRIES` array. This ensures that the global sync process (`bun scripts/sync-global.ts`) no longer attempts to propagate the deleted directory to `~/.agents/skills/olt/mind/`.

## Structural Evaluation: `docs/CHARTER.md` vs `olt/agents/*.yaml`

**Audit Finding:** Inappropriate Location (Architectural Leakage)

**Analysis:**
While Plan 21 explicitly moved the charter to `docs/CHARTER.md`, this creates a structural flaw compared to the rest of the agent ecosystem:

1. **Global Sync Exclusion:** The `scripts/sync-global.ts` engine is hardcoded to package and deploy only the contents of the `olt/` directory (plus specific top-level files like `olt/SKILL.md`). Because `docs/CHARTER.md` lives entirely outside `olt/`, it is completely omitted when the skill is deployed globally to `~/.agents/skills/olt/`.
2. **Namespace Pollution:** The `docs/` directory is traditionally reserved for generic repository documentation. Forcing a highly specialized agent configuration file (containing cognitive pillars, escalation paths, and agent identity) into a standard `docs/` folder leaks the internal implementation details of the `olt` framework into the host repository.
3. **Architectural Inconsistency:** Throughout the `olt` ecosystem, agent personas, boundaries, and rules are canonically defined inside `olt/agents/*.yaml` (e.g., `olt/agents/mind.yaml`) and `olt/roles/*.md`. The Mind charter operates as an extended manifestation of the Mind persona. It should structurally reside within the `olt/` bounded context (e.g., merged into `olt/agents/mind.yaml`, `olt/roles/mind.md`, or kept as `olt/CHARTER.md`) to maintain strict encapsulation and ensure it travels with the global skill deployment.

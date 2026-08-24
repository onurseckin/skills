# Plan 28: Modularized Sync Subsystem, OLT Global Shell Command & Resilient PATH Export

**Status:** Proposed (Revised with Modular `scripts/sync/` Subsystem & Lefthook Simplification)  
**Objective:** Refactor the synchronization subsystem into a cleanly modularized `scripts/sync/` architecture, export `olt` as a first-class global shell executable pointing strictly to canonical global deployment (`~/.agents/skills/olt/scripts/harness.ts`), integrate intelligent idempotent shell RC PATH configuration, update `package.json` scripts, and simplify Lefthook pre-push hooks.

---

## 1. Executive Summary & Architectural Motivation

### Why Modularize the Sync Subsystem?

Previously, skill synchronization was contained in a single monolithic script (`scripts/sync-global.ts`). As we introduce the global `olt` executable binary and automated shell RC path management, we want clean separation of concerns:

1. **Skill File Deployment & Symlink Synchronization** (Ecosystem platforms).
2. **Global Executable Binary Export (`olt`)** (Direct execution of canonical global harness).
3. **Resilient Shell RC Path Export** (Active shell detection, idempotency, zero-crash courtesy invariant).
4. **Filesystem Helpers** (Symlink verification, recursive safe deletion).

### Developer & Agent Experience (`olt <command>`)

Instead of typing lengthy harness paths, developers and subagents anywhere on the system can simply run:

```bash
olt usage:report
olt quota:check
olt plan:status
olt watchdog:role-boundary
```

---

## 2. Directory Architecture & Separation of Responsibilities

```text
scripts/
├── sync/
│   ├── index.ts           # Main entry point for `bun run sync` (orchestrates all steps)
│   ├── skill-deployer.ts  # Deploys olt/ to ~/.agents/skills/olt and links 9 assistant platforms
│   ├── olt-bin.ts         # Generates ~/.local/bin/olt executable (0o755) pointing to global harness
│   ├── shell-rc.ts        # Detects active shell, pre-checks PATH, idempotently appends to RC
│   └── fs-helpers.ts      # safeRemove, smartEnsureSymlink utilities
└── sync-global.ts         # Backward-compatibility proxy re-exporting scripts/sync/index.ts
```

### Module Responsibilities Breakdown

| Module                               | Responsibility                                                                                                                                                | Invariants                                                                                                                                   |
| :----------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------- |
| **`scripts/sync/skill-deployer.ts`** | Copies `olt/` to `~/.agents/skills/olt/`, purges legacy `orchestrating-long-tasks`, ensures symlinks in `.gemini`, `.claude`, `.cursor`, `.codex`, `.openai`. | Does not copy `.capsules` or runtime scratch.                                                                                                |
| **`scripts/sync/olt-bin.ts`**        | Creates executable `~/.local/bin/olt` (and `~/.bun/bin/olt` if present).                                                                                      | **Strictly executes canonical global harness** `${HOME}/.agents/skills/olt/scripts/harness.ts`. Never hijacked by local unstaged edits.      |
| **`scripts/sync/shell-rc.ts`**       | Detects active shell (`~/.zshrc`, `~/.bashrc`, `~/.config/fish/config.fish`), checks if `~/.local/bin` is already declared.                                   | **Zero Duplicate Lines:** If already present, skips editing. **Zero-Blocker:** Wrapped in `try/catch`—never fails sync on permission errors. |
| **`scripts/sync/index.ts`**          | Orchestrates deployment $\rightarrow$ binary generation $\rightarrow$ shell RC configuration in sequence.                                                     | Default command for `bun run sync` / `bun sync`.                                                                                             |

---

## 3. Package & Hook Configuration Updates

### A. `package.json` Scripts

```json
{
  "scripts": {
    "sync": "bun scripts/sync/index.ts",
    "sync:local": "bun run sync",
    "sync:remote": "npx skills update olt -g -y"
  }
}
```

### B. `lefthook.yml` Pre-Push Hook

Simplify the hook from `bun run sync:local` to `bun run sync`:

```yaml
pre-push:
  commands:
    sync:
      run: bun run sync
```

### C. The `olt` Executable Content

```bash
#!/usr/bin/env bash
set -e

GLOBAL_HARNESS="${HOME}/.agents/skills/olt/scripts/harness.ts"

if [ ! -f "${GLOBAL_HARNESS}" ]; then
  echo "Error: OLT global harness not found at ${GLOBAL_HARNESS}." >&2
  echo "Run 'bun run sync' in your skills repository to deploy." >&2
  exit 1
fi

exec bun "${GLOBAL_HARNESS}" "$@"
```

---

## 4. Implementation Work Breakdown

| Step       | Scope                          | Target Files                                                                         | Description                                                                                                             |
| :--------- | :----------------------------- | :----------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------- |
| **Task 1** | **Filesystem Helpers**         | `scripts/sync/fs-helpers.ts`                                                         | Extract `safeRemove` and `smartEnsureSymlink` into shared utilities.                                                    |
| **Task 2** | **Skill Deployer**             | `scripts/sync/skill-deployer.ts`                                                     | Modularize canonical skill copying and 9-platform ecosystem symlink management.                                         |
| **Task 3** | **Global Bin Exporter**        | `scripts/sync/olt-bin.ts`                                                            | Implement `ensureGlobalOltBinary()` to create `~/.local/bin/olt` with `0o755` executable permissions.                   |
| **Task 4** | **Idempotent Shell RC Helper** | `scripts/sync/shell-rc.ts`                                                           | Implement `ensurePathInShellRc()` with shell detection, pre-check regex, non-duplicating append, and `try/catch` guard. |
| **Task 5** | **Sync Index & Proxy**         | `scripts/sync/index.ts`<br>`scripts/sync-global.ts`                                  | Build main entry point and retain backward compatibility proxy for `scripts/sync-global.ts`.                            |
| **Task 6** | **Config Updates**             | `package.json`<br>`lefthook.yml`                                                     | Update npm scripts and Lefthook `pre-push` configuration.                                                               |
| **Task 7** | **Unit Test Suite**            | `tests/unit/installer/bin-export.test.ts`<br>`tests/unit/installer/shell-rc.test.ts` | Test binary generation, execution target, idempotency (no duplicate additions), and permission resilience.              |
| **Task 8** | **Documentation**              | `README.md`<br>`AGENTS.md`<br>`SKILL.md`                                             | Document `olt <command>` as the primary global CLI interface.                                                           |

---

## 5. Verification & Testing Strategy

1. **Unit Test Suite (`bun test tests/unit/installer/`):**
   - Verify `olt-bin.ts` creates valid executable pointing to canonical `${HOME}/.agents/skills/olt/scripts/harness.ts`.
   - Verify `shell-rc.ts` skips modification when `~/.local/bin` is already in test RC content.
   - Verify `shell-rc.ts` appends cleanly when path is missing.
   - Verify simulated permission errors (`EACCES`) do not throw and gracefully log an informational hint.
2. **Live Execution Verification:**
   - Run `bun run sync` $\rightarrow$ Confirm modular deployment, binary export, and shell check succeed.
   - Verify `~/.local/bin/olt` exists and has executable permissions.
   - Execute `olt usage:report` from any directory.
   - Execute `olt quota:check` from any directory.
   - Run `git status` and test Lefthook pre-push hook.
   - Verify `tsc -p tsconfig.json --noEmit` passes with 0 errors.

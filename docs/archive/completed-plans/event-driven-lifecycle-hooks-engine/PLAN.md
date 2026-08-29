# Event-Driven Lifecycle Hooks & Policy Location Clean Architecture Master Plan

> **Tracking ID:** `fb-1788021200000-policy-event-lifecycle-hooks-engine`  
> **Status:** `PLANNED`  
> **Priority:** `HIGH`  
> **Target Subsystems:** `.olt/policy.json`, `olt/scripts/src/policy/`, `olt/scripts/src/orchestrator/station-landing.ts`, `olt/scripts/src/engine/lifecycle/`  
> **Author:** Tier 0 Strategic Mind Supervisor & Infinite Product Owner  
> **Created:** 2026-08-29

---

## 1. Executive Summary & Architectural Cleanliness

This plan addresses two critical architectural improvements:

1. **Policy Location & Skill Distribution Directory Cleanliness**:
   - In target repositories governed by OLT, `.olt/policy.json` is the sole canonical project governance location.
   - The skill distribution folder `olt/` (which synchronizes to `~/.agents/skills/olt/`) had an obsolete static `policy.json` sitting directly at `olt/policy.json`.
   - **Correction**: Default policy definitions and templates must reside cleanly inside `olt/scripts/src/policy/templates/default-policy.json` and `olt/scripts/src/policy/generator/`. The stray `olt/policy.json` will be permanently removed from the skill distribution root, leaving `olt/` containing only standard skill elements (`SKILL.md`, `AGENTS.md`, `.skillignore`, `agents/`, `checklists/`, `references/`, `scripts/`).
2. **Event-Driven Lifecycle Hooks Engine**:
   - Elevates post-phase notifications into a generalized, policy-driven automation system configured directly in `.olt/policy.json`.
   - When lifecycle events fire (`on_phase_completion`, `on_release_push`, `on_task_completion`, `on_wave_completion`, `on_error`), the harness dynamically evaluates `policy.json` `hooks` and executes configured shell commands with template variables (`{phase_name}`, `{commit_sha}`, `{duration_formatted}`, `{duration_ms}`, `{task_count}`).
   - If the user keeps default configuration, it executes the visual notification with the Glass audio chime. If the user edits or removes the hook from `policy.json`, the harness dynamically respects the policy without modifying engine source code.

```text
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                    POLICY-DRIVEN EVENT HOOKS & CLEAN LOCATION ARCHITECTURE                  │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                             │
│  [ Clean Skill Distribution (olt/) ]                                                        │
│    • olt/SKILL.md, olt/AGENTS.md, olt/agents/, olt/scripts/                                 │
│    • Default Policy Template ──► olt/scripts/src/policy/templates/default-policy.json       │
│    • Purged stray root file  ──► DELETE olt/policy.json                                     │
│                                                                                             │
│  [ Target Project Governance (.olt/) ]                                                      │
│    • Canonical Policy        ──► .olt/policy.json (sole runtime source of truth)            │
│    • Configurable Hooks:                                                                    │
│      {                                                                                      │
│        "hooks": {                                                                           │
│          "on_phase_completion": [                                                           │
│            "bun ~/.agents/skills/olt/scripts/harness.ts notify:phase --phase '{phase_name}'"│
│          ]                                                                                  │
│        }                                                                                    │
│      }                                                                                      │
│                                                                                             │
│  [ LifecycleHooksEngine (olt/scripts/src/policy/hooks/) ]                                   │
│    • Injects Template Variables: {phase_name}, {commit_sha}, {duration_formatted}, etc.     │
│    • Executes Non-Blocking Detached Processes (spawn + unref)                               │
│    • Graceful Fallback: Hook failures never block or crash core orchestration               │
│                                                                                             │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Policy Schema Specification (`.olt/policy.json`)

Extend the authoritative `RepoPolicy` schema with the optional `hooks` configuration section:

```typescript
export type LifecycleEventType =
  | "on_phase_completion"
  | "on_release_push"
  | "on_task_completion"
  | "on_wave_completion"
  | "on_error";

export interface LifecycleHooksConfig {
  on_phase_completion?: string[];
  on_release_push?: string[];
  on_task_completion?: string[];
  on_wave_completion?: string[];
  on_error?: string[];
}
```

### 2.1 Default Policy Template (`olt/scripts/src/policy/templates/default-policy.json`)

```json
{
  "hooks": {
    "on_phase_completion": [
      "bun ~/.agents/skills/olt/scripts/harness.ts notify:phase --phase '{phase_name}' --sha '{commit_sha}' --duration '{duration_formatted}' --tasks {task_count}"
    ]
  }
}
```

---

## 3. Template Variables & Interpolation

The Hooks Engine dynamically replaces the following placeholder variables before command execution:

| Variable               | Description                            | Example Output             |
| :--------------------- | :------------------------------------- | :------------------------- |
| `{phase_name}`         | Name of the completed phase / cluster  | `cluster-mind-preplanning` |
| `{commit_sha}`         | Short SHA of the conventional commit   | `a5264fd8`                 |
| `{duration_formatted}` | Human-readable elapsed time            | `4m 32s`                   |
| `{duration_ms}`        | Milliseconds elapsed                   | `272000`                   |
| `{task_count}`         | Number of tasks in the completed phase | `12`                       |
| `{repo_root}`          | Absolute path to the repository root   | `/Users/onur/repos/skills` |
| `{status}`             | Final execution status                 | `SUCCESS`                  |

---

## 4. Implementation Task Breakdown

| Task ID            | Component / File                                         | Scope & Deliverable                                                                                        | Gate Verification            |
| :----------------- | :------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------- | :--------------------------- |
| **`task-hooks-1`** | `olt/scripts/src/policy/templates/` & `generator/`       | Relocate default policy template to `policy/templates/default-policy.json` and update `generator/index.ts` | Unit tests                   |
| **`task-hooks-2`** | `olt/policy.json` (Skill Root)                           | Permanently delete stray `olt/policy.json` from skill distribution root                                    | Directory hygiene check      |
| **`task-hooks-3`** | `olt/scripts/src/policy/repo-policy.ts` & `io-safety.ts` | Remove legacy fallback references to `olt/policy.json`; enforce sole `.olt/policy.json` target path        | Repo policy I/O tests        |
| **`task-hooks-4`** | `olt/scripts/src/policy/types/` & `schema/`              | Add `LifecycleHooksConfig` to `RepoPolicy` interfaces and JSON Schema                                      | Typecheck + schema validator |
| **`task-hooks-5`** | `olt/scripts/src/policy/hooks/interpolator.ts`           | Template interpolation engine with safe variable substitution                                              | Pure unit tests              |
| **`task-hooks-6`** | `olt/scripts/src/policy/hooks/lifecycle-hooks-engine.ts` | Non-blocking execution dispatcher with timeout, detached spawn, and zero code comments                     | Unit tests with mock spawn   |
| **`task-hooks-7`** | `olt/scripts/src/orchestrator/station-landing.ts`        | Hook `executeLifecycleHooks("on_phase_completion", ...)` into release landing pipeline                     | Integration tests            |

---

## 5. Acceptance Criteria & Invariants

1. **Clean Skill Root**: Zero stray `policy.json` in `olt/` root; all policy templates live under `olt/scripts/src/policy/templates/`.
2. **Policy-Driven Customizability**: Modifying or removing hooks in `.olt/policy.json` takes immediate effect dynamically without engine code edits.
3. **Non-Blocking Resilience**: Hook execution failures, timeouts, or invalid shell commands never crash or block orchestrator phase transitions.
4. **Strict Modularity & Zero Comments**: All new files strictly follow $\le 300$ line limits, named exports in `index.ts` (no `export *`), and 0 comments in `.ts` files.

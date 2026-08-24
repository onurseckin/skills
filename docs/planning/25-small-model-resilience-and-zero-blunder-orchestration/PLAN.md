# Plan 25: Small-Model Resilience & Zero-Blunder OLT Hardening

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Context & Problem Statement:**
Analysis of multi-agent execution transcript `8b1c3333-a00c-4dc3-871d-8f72b3b3465a` revealed 6 critical failure modes when small models operate within the OLT framework:

1. **Prompt Paralysis on Mind Wake-up**: Small models repeatedly prompt the user asking "What should I work on next?" instead of recognizing that Tier 0 Mind wakes autonomously from `docs/CHARTER.md` and drives its own pulse/admission loops.
2. **Host Tool vs Harness CLI Confusion**: Small models hallucinate nonexistent SDKs (`import { Agy }`, `agy models`), attempt raw background `nohup bash` scripts, or confuse native host tools (`run_command`, `schedule`, `manage_task`, `view_file`, `replace_file_content`, `write_to_file`, `define_subagent`, `invoke_subagent`, `manage_subagents`, `send_message`) with the CLI harness protocol (`bun ~/.agents/skills/olt/scripts/harness.ts <command>`).
3. **Scheduler Panics & Negative Constraint Over-Indexing**: Small models panic on scheduler timer return states or get trapped in negative-constraint loops rather than executing deterministic forward actions.
4. **Empty Payload Errors**: Small models emit empty whitespace or reasoning tokens without actionable text or tool invocations.
5. **Repo Pollution & Directory Mutation**: Misplacement of temporary scripts in repository root (`ROOT_HYGIENE_VIOLATION`) and unauthorized edits to `docs/mind/CHARTER.md` due to non-canonical directory structure.
6. **Path Alias Mismatch**: Confusion between "orchestrating long tasks" and canonical `olt/` namespace and global skill location `~/.agents/skills/olt`.

**Goal:**
Harden the entire OLT architecture against small-model failure modes by reconciling and executing Plans 19, 22, 23, and 24:

1. Harden agent YAMLs (`olt/agents/mind.yaml`, `orchestrator.yaml`, `coordinator.yaml`, `implementer.yaml`, `validator.yaml`).
2. Harden role markdown contracts (`olt/roles/mind.md`, `orchestrator.md`, `coordinator.md`, `implementer.md`, `validator.md`).
3. Create authoritative Host Environment Contract (`olt/references/host-environment.md`).
4. Execute Plan 24: Consolidate Mind charter to `docs/CHARTER.md`, archive historical charters to `docs/archive/`, remove duplicate directories (`docs/mind/`, `olt/mind/`), update all 15+ TypeScript references in `olt/scripts/src/` and tests, and remove `"mind"` from `scripts/sync-global.ts`.
5. Perform deterministic verification and validation via `task:check` and full typechecks.

**Tech Stack:**
TypeScript, Bun, YAML agent manifests, Markdown role contracts and architectural references, OLT Harness Engine.

## Global Constraints

- **0 `any` annotations** across all TypeScript code.
- **No compiler or linter suppressions** (`@ts-ignore`, `@ts-expect-error`, `eslint-disable`).
- `bun run typecheck` must pass at every milestone.
- Strict 1:1 single-implementer and single-validator isolation with disjoint write scopes for all tasks.
- Coordinators and Orchestrators must NOT execute unit test suites directly.

---

### Task 1: Harden Agent YAML Manifests

**Files to modify:**

- `olt/agents/mind.yaml`
- `olt/agents/orchestrator.yaml`
- `olt/agents/coordinator.yaml`
- `olt/agents/implementer.yaml`
- `olt/agents/validator.yaml`

**Write Scope:** `olt/agents/`

**Key Directives to Inject:**

- **Mind Manifest (`mind.yaml`)**:
  - Autonomous Wakeup Mandate: Mind wakes autonomously from `docs/CHARTER.md` with ZERO human prompt requirement. Strict prohibition against prompting the user or waiting for user input.
  - Infinite Product Owner cadence: Mode A (Autonomous Self-Evolution) vs Mode B (External Intake).
  - Native Host Tools vs Harness CLI distinction: Explicitly list allowed native host tools (`run_command`, `schedule`, `manage_task`, `define_subagent`, `invoke_subagent`, `manage_subagents`, `send_message`) vs `bun ~/.agents/skills/olt/scripts/harness.ts`.
  - Non-empty payload invariant: Every turn must produce substantive markdown and tool calls.
- **Orchestrator Manifest (`orchestrator.yaml`)**:
  - Autonomous loop governance, capsule chaining, watchdog monitoring, and hard reset discipline.
  - Native host tools vs harness CLI clarity.
- **Coordinator Manifest (`coordinator.yaml`)**:
  - 1:1 isolated task dispatch (Anti-Batching Rule), 1-shot exact-anchor briefings (`task:brief`), hard agent reset on kill.
  - Mandatory no-code-edit and strict test execution ban.
- **Implementer Manifest (`implementer.yaml`)**:
  - Strict disjoint write scope confinement, Turn 1 exact edits, file-scoped unit testing (`bun test <path.test.ts>`), 1-hop micro-cycles.
  - Root scratch prohibition (`scratch/` only).
- **Validator Manifest (`validator.yaml`)**:
  - Cognitive Validator Hard-Lock Interlock: 0 command execution privileges (`run:exec`, 0 tests, 0 bash scripts).
  - Adversarial probe discipline (`task:probe` in Round 1).

- [ ] **Step 1:** Review current YAML configurations in `olt/agents/`.
- [ ] **Step 2:** Harden `olt/agents/mind.yaml` with autonomous wakeup, host tool clarity, and anti-paralysis invariants.
- [ ] **Step 3:** Harden `olt/agents/orchestrator.yaml` and `olt/agents/coordinator.yaml`.
- [ ] **Step 4:** Harden `olt/agents/implementer.yaml` and `olt/agents/validator.yaml`.
- [ ] **Step 5:** Verify YAML syntax and consistency across all 5 files.

---

### Task 2: Harden Role Markdown Contracts

**Files to modify:**

- `olt/roles/mind.md`
- `olt/roles/orchestrator.md`
- `olt/roles/coordinator.md`
- `olt/roles/implementer.md`
- `olt/roles/validator.md`

**Write Scope:** `olt/roles/`

**Key Directives to Inject:**

- Comprehensive `may` and `must_not` clauses covering the 6 failure modes:
  - **`mind.md`**: Must not ask user for prompts; must wake autonomously from `docs/CHARTER.md`; must not hallucinate SDKs; must not edit code; must not run tests directly; must maintain continuous non-stop pulse cycles.
  - **`orchestrator.md`**: Must not implement code; must not bypass hierarchy; must supervise up to 10 rounds with capsule chaining.
  - **`coordinator.md`**: Must not write application code; must not run test suites directly; must enforce 1:1 isolation and exact briefings.
  - **`implementer.md`**: Must strictly stay within leased write scope; must never write temporary scratch files in repo root; must run file-scoped tests only.
  - **`validator.md`**: Must never execute terminal commands or tests; must evaluate code via reading and Socratic probe (`task:probe`).

- [ ] **Step 1:** Review current role contracts in `olt/roles/`.
- [ ] **Step 2:** Update `olt/roles/mind.md` with explicit anti-prompt-paralysis, autonomous charter boot, and host tool distinction.
- [ ] **Step 3:** Update `olt/roles/orchestrator.md` and `olt/roles/coordinator.md`.
- [ ] **Step 4:** Update `olt/roles/implementer.md` and `olt/roles/validator.md`.
- [ ] **Step 5:** Verify markdown formatting and role consistency.

---

### Task 3: Create Host Environment Contract

**Files to create:**

- `olt/references/host-environment.md`

**Write Scope:** `olt/references/`

**Key Sections:**

1. **Architectural Separation**: Native Host Environment Tools vs OLT Harness Protocol.
2. **Native Host Tools Catalog**:
   - Filesystem Tools: `view_file`, `replace_file_content`, `write_to_file`, `list_dir`, `grep_search`, `find_by_name`.
   - Execution & Process Tools: `run_command`, `manage_task`.
   - Scheduler Tool: `schedule` (One-shot `DurationSeconds` vs Recurring `CronExpression`, asynchronous non-blocking semantics, anti-panic guidelines).
   - Agent Lifecycle Tools: `define_subagent`, `invoke_subagent`, `manage_subagents`, `send_message`.
3. **Zero-Hallucination Invariant**:
   - Explicitly list non-existent interfaces (`import { Agy }`, `agy models`, raw nohup scripts) and forbid their invocation.
4. **Canonical Paths & Directory Semantics**:
   - Repo Root vs Global Skill Root (`~/.agents/skills/olt`).
   - `olt/` (Skill Source & Roles) vs `.olt/` (Runtime State & Ledgers) vs `scratch/` (Temporary Files).
   - Single Source of Truth for Mind Charter: `docs/CHARTER.md`.

- [ ] **Step 1:** Draft `olt/references/host-environment.md` incorporating complete tool specifications and anti-hallucination rules.
- [ ] **Step 2:** Validate cross-references with `AGENTS.md`, `olt/references/host-adapters.md`, and `olt/references/cli-capabilities.md`.
- [ ] **Step 3:** Verify markdown formatting and table rendering.

---

### Task 4: Mind Single Source of Truth Consolidation (Plan 24 Execution)

**Files to modify/move/delete:**

- Move: `docs/mind/CHARTER.md` → `docs/CHARTER.md`
- Archive: `olt/mind/*.md` → `docs/archive/`
- Delete: `docs/mind/` (directory)
- Delete: `olt/mind/` (directory)
- Update TypeScript Files with `"docs/mind/CHARTER.md"` references:
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
- Update Global Sync:
  - `scripts/sync-global.ts` (remove `"mind"` from `ENTRIES` array)
- Update Unit Tests referencing `docs/mind/CHARTER.md` (in `tests/unit/mind/`):
  - `tests/unit/mind/admission-gates.test.ts`
  - `tests/unit/mind/admission-negative.test.ts`
  - `tests/unit/mind/audit-planted.test.ts`
  - `tests/unit/mind/audit.test.ts`
  - `tests/unit/mind/budget.test.ts`
  - `tests/unit/mind/damage.test.ts`
  - `tests/unit/mind/defect-audit.test.ts`
  - `tests/unit/mind/driver-gap.test.ts`
  - `tests/unit/mind/hierarchy-regression.test.ts`
  - `tests/unit/mind/lane-rescue.test.ts`
  - `tests/unit/mind/memory.test.ts`
  - `tests/unit/mind/mind-pulse-open.test.ts`
  - `tests/unit/mind/mind-wake.test.ts`
  - `tests/unit/mind/proposals.test.ts`
  - `tests/unit/mind/pulse-reclaim.test.ts`
  - `tests/unit/mind/pulse-sh.test.ts`
  - `tests/unit/mind/quiesce.test.ts`
  - `tests/unit/mind/rounds.test.ts`
  - `tests/unit/mind/soak-injections.test.ts`
  - `tests/unit/mind/sources.test.ts`
  - `tests/unit/mind/witness.test.ts`

**Write Scope:** `docs/`, `olt/mind/`, `olt/scripts/src/`, `olt/references/`, `scripts/`, `tests/unit/mind/`

- [ ] **Step 1:** Create `docs/archive/` and move `olt/mind/*.md` files into it.
- [ ] **Step 2:** Move `docs/mind/CHARTER.md` to `docs/CHARTER.md` and delete `docs/mind/` and `olt/mind/`.
- [ ] **Step 3:** Update all TypeScript files in `olt/scripts/src/` replacing `"docs/mind/CHARTER.md"` with `"docs/CHARTER.md"`.
- [ ] **Step 4:** Update `scripts/sync-global.ts` to remove `"mind"` from `ENTRIES`.
- [ ] **Step 5:** Update all unit test fixtures/assertions in `tests/unit/mind/` to reference `"docs/CHARTER.md"`.
- [ ] **Step 6:** Run `bun run typecheck` to verify zero type errors.

---

### Task 5: Deterministic Verification & Validation

**Scope:** Whole Repository Verification & Capsule Completion

- [ ] **Step 1:** Execute fast incremental verification (`task:check`) across all modified modules.
- [ ] **Step 2:** Execute `bun run typecheck` across the entire codebase to guarantee 0 type errors.
- [ ] **Step 3:** Dispatch Tier 3 Completeness Critic to verify full coverage against requirements.
- [ ] **Step 4:** Seal capsule run via `bun harness.ts run:complete`.
- [ ] **Step 5:** Execute Conventional Commit, push to `origin/main`, and run `bun scripts/sync-global.ts`.
- [ ] **Step 6:** Send milestone notification and final completion summary to Tier 1 Orchestrator via `send_message`.

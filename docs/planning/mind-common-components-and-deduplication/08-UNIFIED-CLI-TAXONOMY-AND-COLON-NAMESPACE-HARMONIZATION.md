# Blueprint 08: Unified CLI Taxonomy, Colon-Namespace Harmonization & Zero-Alias Invariant

**Domain:** `cli` / `tooling` / `reporting` / `queue` / `governance`  
**Priority:** `CRITICAL`  
**Status:** `READY_FOR_EXECUTION`  
**Tracking ID:** `MIND-DEDUP-CLI-TAXONOMY-08`

---

## Level 1: Executive Context & Problem Statement

Across the Harness CLI registry (54 commands), a critical taxonomy dissonance and alias proliferation defect exists:

1. **Inconsistent Domain Verb Prefixes**: Reporting commands are scattered across arbitrary top-level verbs (`usage:report`, `quota:check`, `stream:events`, `dag:trace`) instead of grouping under clean, authoritative domain namespaces (`report:*`, `events:*`, `quota:*`).
2. **Artificial Subsystem Namespace Bloat**: Singletons like the central task queue are awkwardly prefixed with `mind:queue:add` and `mind:queue:clean`, even though there is only **one authoritative task queue** in the entire system (`.olt/task-queue.jsonl`).
3. **Severe Alias Proliferation & Collision**: Commands carry up to 6 conflicting aliases (e.g. `dag` has `["dag:render", "dag:view", "graph:sugiyama", "report:sugiyama", "graph:ascii", "status:dag"]`), causing CLI collisions (`init` collision between `run.ts` and `plan.ts`) and confusing subagent reasoning.
4. **Preservation of Subcommand Granularity**: Refactoring must NOT delete sub-capabilities (like `report:summary`, `report:task`, `report:leases`, `report:decisions`, `report:health`, `report:usage`). Instead, the bare root command (`report`) executes the unified comprehensive view by default, while colon sub-verbs execute specific focused tasks with zero duplicate aliases (`aliases: []`).

---

## Level 2: Target Architecture & ASCII Unicode Taxonomy Tree

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                 CANONICAL UNIFIED CLI COLON-NAMESPACE TAXONOMY               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [ Unified Domain Verb ]  ──►  [ Canonical Sub-Verbs (aliases: []) ]        │
│                                                                             │
│  1. `report` (Master View)──┬──► `report:summary`    (Executive brief)      │
│                             ├──► `report:task`       (Task verification)    │
│                             ├──► `report:health`     (Doctor audit status)  │
│                             ├──► `report:leases`     (Active lease matrix)  │
│                             ├──► `report:decisions`  (Governance audit)     │
│                             ├──► `report:usage`      (Platform tokens/quota)│
│                             └──► `report:dag`        (Sugiyama DAG layout)  │
│                                                                             │
│  2. `events` (Event Stream) ├──► `events:stream`     (Live terminal tail)   │
│                             └──► `events:trace`      (Step timeline tracer) │
│                                                                             │
│  3. `queue` (Central Queue) ├──► `queue:add`         (Enqueue atomic task)  │
│                             ├──► `queue:drain`       (Topological wave plan)│
│                             ├──► `queue:status`      (Inspect active queue) │
│                             └──► `queue:clean`       (Prune completed tasks)│
│                                                                             │
│  4. `msg` (Mailbox IPC)     ├──► `msg:send`          (HMAC signed dispatch) │
│                             ├──► `msg:recv`          (Read unread inbox)    │
│                             ├──► `msg:poll`          (Blocking inbox wait)  │
│                             └──► `msg:list`          (Audit active inboxes) │
│                                                                             │
│  5. `quota` (Circuit Guard) ├──► `quota:check`       (Evaluate <10% limit)  │
│                             ├──► `quota:freeze`      (Snapshot & RAM sleep) │
│                             └──► `quota:resume`      (Auto-wake resumption) │
│                                                                             │
│  6. `worktree` (Isolation)  ├──► `worktree:create`   (Provision track branch)│
│                             ├──► `worktree:land`     (Rebase & push origin) │
│                             └──► `worktree:prune`    (Zero worktree cleanup)│
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Level 3: Disjoint Scope Boundaries

### Write Scope

- `olt/scripts/src/cli/registry/reporting.ts` (Harmonized `report:*` and `events:*` commands)
- `olt/scripts/src/cli/registry/mind.ts` (Migration of queue commands to unified `queue:*`)
- `olt/scripts/src/cli/registry/workflow.ts` (Worktree commands harmonization)
- `olt/scripts/src/cli/registry/core.ts` (Core commands alias purge)
- `olt/scripts/src/cli/registry/engine.ts` (Engine commands alias purge)
- `olt/scripts/src/cli/registry/plan.ts` (Plan commands alias purge)
- `olt/scripts/src/cli/registry/inspection.ts` (Inspection commands alias purge)
- `tests/unit/cli/registry-taxonomy.test.ts` (Taxonomy & zero-alias verification suite)

### Read-Only Scope

- `olt/scripts/src/cli/registry/types.ts` (CommandSpec & FlagSpec contracts)
- `olt/scripts/src/core/shared/paths.ts` (Canonical storage paths)

---

## Level 4: Atomic Implementation Tasks Matrix

| Task ID           | Target File Path                                                   | Exported Typed Symbols / Registrations                     | Deliverable & Contract                                                                                                                                                                                                                                                                                   |
| :---------------- | :----------------------------------------------------------------- | :--------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`task-tax-01`** | `olt/scripts/src/cli/registry/reporting.ts`                        | `REPORTING_COMMANDS: readonly CommandSpec[]`               | Unify all reporting under `report`, `report:summary`, `report:task`, `report:health`, `report:leases`, `report:decisions`, `report:usage`, `report:dag`, `report:graph-json`; unify event commands under `events:stream` and `events:trace`; purge all `aliases` to `[]`. ($\le 300$ lines, 0 comments). |
| **`task-tax-02`** | `olt/scripts/src/cli/registry/mind.ts`                             | `MIND_COMMANDS: readonly CommandSpec[]`                    | Extract queue commands into top-level `queue:add`, `queue:drain`, `queue:status`, `queue:clean`; purge all `aliases` to `[]`. ($\le 300$ lines, 0 comments).                                                                                                                                             |
| **`task-tax-03`** | `olt/scripts/src/cli/registry/workflow.ts` & `engine.ts`           | `WORKFLOW_COMMANDS`, `ENGINE_COMMANDS`                     | Consolidate `worktree:*` and `msg:*` namespaces; purge all legacy duplicate aliases across all command specs. ($\le 280$ lines, 0 comments).                                                                                                                                                             |
| **`task-tax-04`** | `olt/scripts/src/cli/registry/core.ts`, `plan.ts`, `inspection.ts` | `CORE_COMMANDS`, `PLAN_COMMANDS`, `INSPECTION_COMMANDS`    | Eliminate `init` collision; purge all alias arrays to `aliases: []`. ($\le 260$ lines, 0 comments).                                                                                                                                                                                                      |
| **`task-tax-05`** | `tests/unit/cli/registry-taxonomy.test.ts`                         | `describe("CLI Registry Taxonomy & Zero-Alias Invariant")` | Unit test suite asserting 100% of commands follow canonical `<domain>:<subcommand>` taxonomy and have `aliases.length === 0`.                                                                                                                                                                            |

---

## Level 5: Falsifiable Gate Verification Commands

1. **CLI Registry Taxonomy & Zero-Alias Unit Test**:
   ```bash
   bun test tests/unit/cli/registry-taxonomy.test.ts
   ```
2. **Whole CLI Registry Integrity Suite**:
   ```bash
   bun test tests/unit/cli/registry.test.ts
   ```
3. **Master Doctor Check**:
   ```bash
   bun harness.ts doctor
   ```
4. **AST Static Purity & Zero-Comments Gate**:
   ```bash
   bun harness.ts task:check --file olt/scripts/src/cli/registry/reporting.ts olt/scripts/src/cli/registry/mind.ts olt/scripts/src/cli/registry/workflow.ts
   ```

---

## Level 6: Strict Invariant Enforcement

1. **Zero Aliases Invariant (`\mathcal{A}_0`)**: `command.aliases` MUST be strictly `[]` across 100% of registered commands.
2. **Strict Colon-Namespace Hierarchy**: Every command is either a bare top-level verb (`report`, `doctor`, `dag`) or a single-colon specialization (`report:usage`, `queue:add`, `events:stream`). Multi-word or random verbs are prohibited.
3. **Zero Code Comments**: 0 comments in all `.ts` files.
4. **Strict Density Budgets**: $\le 300$ physical lines per file, $\le 10$ files per directory.
5. **Explicit Named Facade Exports**: 100% named exports in `index.ts` facades.

---

## Level 7: Sequential Execution Order & Critical Path DAG

```text
[task-tax-01: Reporting & Events Namespace Harmonization] ──┐
                                                            │
[task-tax-02: Universal Queue Namespace Harmonization]   ───┼──► [task-tax-05: Taxonomy Tests]
                                                            │
[task-tax-03 & 04: Core, Plan & Workflow Alias Purge]    ───┘
                                                            │
                                                            ▼
[Gate Verification: bun test tests/unit/cli/ & bun harness.ts doctor]
                                                            │
                                                            ▼
[Atomic Landing: git commit ──► git push origin main ──► global skill sync]
```

---

## Level 8: Exhaustive Traceability Matrix

| Backlog / Defect ID                         | Task ID                   | Target Component                | Gate Test Suite                            | Invariant Status                       |
| :------------------------------------------ | :------------------------ | :------------------------------ | :----------------------------------------- | :------------------------------------- |
| `defect-alias-proliferation-bloat`          | `task-tax-01, 02, 03, 04` | `olt/scripts/src/cli/registry/` | `tests/unit/cli/registry-taxonomy.test.ts` | Complete ($\le 300$ lines, 0 comments) |
| `defect-cli-init-collision`                 | `task-tax-04`             | `src/cli/registry/plan.ts`      | `tests/unit/cli/registry.test.ts`          | Complete ($\le 260$ lines, 0 comments) |
| `defect-queue-domain-dissonance`            | `task-tax-02`             | `src/cli/registry/mind.ts`      | `tests/unit/cli/registry-taxonomy.test.ts` | Complete ($\le 300$ lines, 0 comments) |
| `defect-reporting-subcommand-fragmentation` | `task-tax-01`             | `src/cli/registry/reporting.ts` | `tests/unit/cli/registry-taxonomy.test.ts` | Complete ($\le 300$ lines, 0 comments) |

# Harness CLI & API Abstraction: Architecture & Implementation Plan

**Created**: 2026-08-14  
**Status**: Authoritative Architectural Plan  
**Location**: `docs/planning/orchestrating-long-tasks-enhancements/02-harness-cli-api-plan.md`  
**Run Capsule Reference**: `.capsules/2026-08-14-harness-cli-plan/`

---

## 1. Executive Summary & Architectural Motivation

### 1.1 The "Leaky Abstraction" & Context Poisoning
In the initial generation of multi-agent long-task harnesses, LLM agents (coordinators, implementers, validators, critics) were forced to act as **manual JSON database engines and AST compilers**:
1. **Whole-File Ingestion**: An agent invoked `view_file` on 200–500 line JSON files (`graph.json`, `state.json`, `requirements.json`) merely to discover which task was unblocked or to check lease status.
2. **Manual Graph Crafting**: The planner was required to hand-craft 150+ lines of raw JSON containing UUIDs, SHA-256 digests, edge relationships, line disposition objects, and rigid schema validation fields.
3. **Context Burn & Amnesia**: Ingesting and producing raw JSON consumed **10,000–35,000 tokens per turn**. Within 3–5 agentic turns, the host conversation window exhausted its token budget, triggering catastrophic transcript truncations, context compression, and cognitive amnesia.
4. **Fragile State Mutation**: Schema typos, malformed JSON keys, or missed array fields caused runtime validation crashes, wasting cycles on mechanical bookkeeping rather than substantive software engineering.

### 1.2 The High-Level CLI & API Vision
The **Harness CLI / API Layer** eliminates all raw JSON interactions from the LLM agent's context window. 

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                             LLM Agent Context Window                             │
│  • Emits ONLY declarative CLI commands (e.g. `bun harness.ts queue:next`)       │
│  • Ingests ONLY compact, role-bound Markdown briefs (15 - 30 lines, < 300 tokens) │
│  • Zero `view_file` calls on `.json` capsule state files                         │
└────────────────────────────────────────┬─────────────────────────────────────────┘
                                         │ CLI Invocations (argv flags)
                                         ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                         Harness CLI / API Engine Layer                           │
│  • Manages internal state transitions, dependency queues, and concurrency locks  │
│  • Scope Independence Analyzer (auto-detects disjoint write scopes & parallelizes)│
│  • Requirements Compiler (auto-derives line dispositions & prompt SHA-256)       │
│  • Generates role-bound Markdown packets in `packets/`                           │
│  • Formats all command stdout strictly as concise Markdown tables/briefs         │
└────────────────────────────────────────┬─────────────────────────────────────────┘
                                         │ File I/O & Git Ops
                                         ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                             Clean Capsule Storage                                │
│   ├── prompt.md         # Immutable prompt bytes (SHA-256 bound)                 │
│   ├── manifest.json     # Run manifest, timestamps, versions, assurance          │
│   ├── requirements.json # Internal state: atomic requirements, prompt mappings   │
│   ├── graph.json        # Internal state: nodes, edges, gates, write scopes      │
│   ├── state.json        # Internal state: authoritative lifecycle & event index  │
│   ├── packets/          # Immutable role-bound context bundles                   │
│   ├── evidence/         # Verifiable test logs, diff snapshots, command proofs   │
│   ├── findings/         # Formal reviewer rejections, audit findings             │
│   ├── reports/          # Implementer submission reports & validator decisions   │
│   └── commands/         # Monitored execution logs and stdout/stderr streams     │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### 1.3 Core Architectural Invariants
1. **Zero Raw JSON in LLM Context**: Agents never inspect, edit, or receive raw JSON state files. All inputs are CLI flags; all outputs are compact Markdown briefs.
2. **Markdown-Only Projections**: Every CLI command returns a structured, scannable Markdown slice strictly bounded to $\le 30$ physical lines.
3. **Automated Mechanical Synthesis**: The CLI automatically derives requirement nodes, prompt line dispositions, SHA-256 digests, graph topologies, and git diff verifications.
4. **Strict Capsule Taxonomy**: Elimination of unstructured `tmp/` directories. All persistent artifacts reside in typed capsule directories (`packets/`, `evidence/`, `findings/`, `reports/`, `commands/`).
5. **Two-Tier Agent Isolation**: The main interactive user thread spawns exactly one Background Run Coordinator; all subagent workers, tool loops, and chatter remain fully isolated in the background hierarchy.

---

## 2. Complete CLI Command Specifications & Grammar

The Harness CLI exposes a unified binary entrypoint (`bun orchestrating-long-tasks/scripts/harness.ts`) structured into modular command domains.

```
harness.ts <domain>:<command> [flags] [-- <args...>]
```

---

### 2.1 Planning & Graph Construction API

The Planning API replaces manual JSON composition of `requirements.json` and `graph.json` with high-level declarations and automated compilation.

```
┌─────────────┐       plan:add       ┌──────────────┐      plan:compile     ┌─────────────────┐
│  plan:init  ├─────────────────────►│  plan:add    ├──────────────────────►│  Compiled Plan  │
│  (Capsule)  │  (Declare Task 1..N) │  (Validation)│ (Scope Analyzer & DAG)│ (Revision 1)    │
└─────────────┘                      └──────────────┘                       └─────────────────┘
```

#### 2.1.1 `plan:init`
Initializes a new run capsule, binds prompt bytes, and captures baseline repository state.

* **Grammar**:
  ```bash
  bun harness.ts plan:init \
    --run <RUN_ID> \
    --prompt-file <PATH> \
    [--repo <PATH>] \
    [--capture-mode <file|stdin>] \
    [--source-verified]
  ```
* **Pre-conditions & Invariants**:
  - `prompt-file` must exist and be readable.
  - Capsule directory `.capsules/<RUN_ID>/` must not already exist (fail-closed against overwrites).
  - Initializes clean directory taxonomy (`packets/`, `evidence/`, `findings/`, `reports/`, `commands/`) without `tmp/`.
* **State Mutations**:
  - Writes `prompt.md`, `manifest.json`, `state.json` (revision 0), `events.jsonl`.
  - Appends `capsule_initialized` event.
* **Stdout Markdown Brief**:
  ```markdown
  ### Capsule Initialized: 2026-08-14-parallel-coverage
  - **Capsule Root**: `.capsules/2026-08-14-parallel-coverage/`
  - **Prompt SHA-256**: `4746167e1cd0418775fa02030f361a1467dc13175c3bf3e82e33d9a0e45b8722` (2,187 bytes)
  - **Assurance**: `source-verified` | Runtime: Bun 1.3.14
  - **Status**: Ready for task declarations (`plan:add`).
  ```

#### 2.1.2 `plan:add`
Declaratively adds a planned work unit, including its write scope boundaries, verification gates, and optional causal dependencies.

* **Grammar**:
  ```bash
  bun harness.ts plan:add \
    --run <RUN_ID> \
    --id <TASK_ID> \
    --label <STRING> \
    --scope <COMMA_SEPARATED_PATHS> \
    --gate <SHELL_COMMAND> \
    [--deps <COMMA_SEPARATED_TASK_IDS>] \
    [--goal <STRING>] \
    [--criteria <SEMICOLON_SEPARATED_STRINGS>] \
    [--priority <INTEGER>] \
    [--effort <INTEGER>]
  ```
* **Parameters**:
  - `--id`: Unique task identifier (e.g. `task-core-tests`, `task-installer`).
  - `--label`: Human-readable label for dashboard and reports.
  - `--scope`: Comma-separated list of exact directory or file paths the worker is permitted to modify.
  - `--gate`: Mandatory validation command that must exit 0 for task satisfaction.
  - `--deps`: Optional prerequisite task IDs. If omitted, task is marked parallel-ready by default.
  - `--goal`: High-level statement of purpose.
  - `--criteria`: Semicolon-delimited acceptance criteria.
  - `--priority`: Priority weight (1-100, default: 50).
  - `--effort`: Estimated effort units (1-10, default: 3).
* **Pre-conditions & Invariants**:
  - Capsule must be in `planning` state (graph revision 0).
  - `--id` must be unique within the run.
  - Normalized paths in `--scope` are checked for valid syntax.
* **State Mutations**:
  - Registers draft task, requirement nodes, and gate definitions in internal planning buffer.
* **Stdout Markdown Brief**:
  ```markdown
  ### Task Registered: task-installer
  - **Label**: Installer Unit Tests & Refactoring
  - **Write Scope**: `orchestrating-long-tasks/scripts/src/installer/`, `tests/unit/installer/`
  - **Mandatory Gate**: `bun test tests/unit/installer`
  - **Dependencies**: None (Parallel-ready)
  - **Plan Size**: 3 tasks registered. Run `plan:compile` when finished adding tasks.
  ```

#### 2.1.3 `plan:compile`
Compiles all declared tasks into an immutable execution graph, runs the Scope Independence Analyzer, generates prompt line dispositions, and creates initial worker packets.

* **Grammar**:
  ```bash
  bun harness.ts plan:compile \
    --run <RUN_ID> \
    [--strict-parallel] \
    [--actor <STRING>]
  ```
* **Compilation Algorithm Steps**:
  1. Validates DAG acyclicity across all dependency edges.
  2. Executes Scope Independence Analyzer: verifies disjoint write scopes across parallel batches.
  3. Derives requirement mappings and prompt line dispositions (100% prompt coverage).
  4. Persists internal `requirements.json` and `graph.json`.
  5. Generates role packets in `.capsules/<RUN_ID>/packets/`.
  6. Advances graph revision to 1; transitions run state from `planning` to `executing`.
* **Stdout Markdown Brief**:
  ```markdown
  ### Plan Compiled Successfully (Graph Revision 1)
  - **Total Tasks**: 4 registered | **Parallel Concurrency Waves**: 2
  - **Wave 0 (Ready Now)**: `task-core`, `task-installer`, `task-cli` (3 parallel lanes)
  - **Wave 1 (Blocked)**: `task-integration` (depends on `task-core`, `task-cli`)
  - **Scope Isolation**: Disjoint write scopes verified (0 collisions)
  - **Requirements Covered**: 12/12 atomic obligations mapped
  - **Next Step**: Query ready tasks via `bun harness.ts queue:next --run <RUN_ID>`
  ```

#### 2.1.4 `plan:status`
Displays current planning buffer state before compilation.

* **Grammar**:
  ```bash
  bun harness.ts plan:status --run <RUN_ID>
  ```
* **Stdout Markdown Brief**:
  ```markdown
  ### Planning Buffer: 2026-08-14-parallel-coverage (Draft)
  | ID | Label | Write Scope | Gate | Dependencies |
  | :--- | :--- | :--- | :--- | :--- |
  | `task-core` | Core Unit Tests | `tests/unit/core/` | `bun test tests/unit/core` | None |
  | `task-installer` | Installer Tests | `tests/unit/installer/` | `bun test tests/unit/installer` | None |
  | `task-cli` | CLI Tests | `tests/unit/cli/` | `bun test tests/unit/cli` | None |
  
  **Status**: 3 tasks declared. Uncompiled. Run `plan:compile` to seal.
  ```

---

### 2.2 Task Queue & Discovery API

The Queue API provides context-minimized, single-task projections so coordinators and workers can discover, inspect, and lease work without ingesting the full graph.

#### 2.2.1 `queue:next`
Finds the highest-priority task that is ready for immediate execution (all dependencies satisfied, no write scope locks held).

* **Grammar**:
  ```bash
  bun harness.ts queue:next \
    --run <RUN_ID> \
    [--max-parallel <INTEGER>] \
    [--agent <AGENT_ID>]
  ```
* **Algorithm**:
  - Scans graph for tasks with status `ready`.
  - Filters out tasks whose dependencies are not `satisfied`.
  - Filters out tasks whose write scopes intersect with any currently `leased` task.
  - Returns the top $N$ candidates sorted by `priority DESC, created_order ASC`.
* **Stdout Markdown Brief** ($\le 25$ lines):
  ```markdown
  ### Ready Task: task-installer (Priority: 80)
  - **Label**: Installer Unit Tests & Coverage
  - **Goal**: Implement unit tests for all installer modules to achieve 100% branch coverage.
  - **Write Scope**: `orchestrating-long-tasks/scripts/src/installer/`, `tests/unit/installer/`
  - **Mandatory Gate**: `bun test tests/unit/installer`
  - **Role Packet**: `.capsules/2026-08-14-parallel-coverage/packets/task-installer/packet.md`
  
  #### Claim Command:
  ```bash
  bun harness.ts task:claim --run 2026-08-14-parallel-coverage --task task-installer --agent worker-installer
  ```
  ```

#### 2.2.2 `queue:list`
Provides a concise snapshot of all execution lanes across queue partitions.

* **Grammar**:
  ```bash
  bun harness.ts queue:list --run <RUN_ID> [--all]
  ```
* **Stdout Markdown Brief**:
  ```markdown
  ### Execution Queue Summary
  | Partition | Count | Tasks |
  | :--- | :--- | :--- |
  | 🟢 **Ready** | 2 | `task-installer`, `task-cli` |
  | 🔄 **Leased** | 1 | `task-core` (Agent: `worker-core`, Exp: 22m) |
  | 🔍 **Validating** | 0 | - |
  | ⏳ **Blocked** | 1 | `task-integration` (waiting for: `task-core`, `task-cli`) |
  | ✅ **Satisfied** | 0 | - |
  
  **Parallel Concurrency**: 1/3 active lanes utilized. 2 ready tasks available.
  ```

#### 2.2.3 `queue:pop`
Atomic convenience command that combines `queue:next` and `task:claim` into a single operation, immediately leasing the top ready task and returning its lease token.

* **Grammar**:
  ```bash
  bun harness.ts queue:pop --run <RUN_ID> --agent <AGENT_ID> [--lease-duration <DURATION>]
  ```
* **Stdout Markdown Brief**:
  ```markdown
  ### Task Popped & Leased: task-installer
  - **Agent**: `worker-installer`
  - **Lease Token**: `tok_claim_9f8a2c4e1b7d83`
  - **Deadline**: 30m (Expires: 19:15:00 UTC)
  - **Write Scope**: `tests/unit/installer/`
  - **Mandatory Gate**: `bun test tests/unit/installer`
  - **Packet**: `.capsules/2026-08-14-parallel-coverage/packets/task-installer/packet.md`
  ```

---

### 2.3 Worker Lifecycle API

The Worker Lifecycle API manages task leasing, heartbeat renewals, git diff boundary verification, and report generation.

```
┌────────────┐       task:claim       ┌─────────────┐      task:submit      ┌───────────────┐
│ Ready Task ├───────────────────────►│ Leased Task ├──────────────────────►│   Submitted   │
└────────────┘                        └──────┬──────┘                       │ (Git Verified)│
                                             │ task:heartbeat               └───────────────┘
                                             ▼
                                      (Extend Lease)
```

#### 2.3.1 `task:claim`
Acquires an exclusive execution lease on a task and its declared write scope.

* **Grammar**:
  ```bash
  bun harness.ts task:claim \
    --run <RUN_ID> \
    --task <TASK_ID> \
    --agent <AGENT_ID> \
    [--lease-duration <DURATION>]
  ```
* **Pre-conditions & Invariants**:
  - Task must be in `ready` state.
  - No active lease exists for the task or intersecting write scopes.
  - Generates a cryptographically secure, single-use lease bearer token.
* **State Mutations**:
  - Transitions task state from `ready` to `leased`.
  - Records `agent_id`, `lease_token_hash`, and `lease_expires_at` in state store.
  - Appends `task_leased` event to `events.jsonl`.
* **Stdout Markdown Brief**:
  ```markdown
  ### Task Leased: task-installer
  - **Agent**: `worker-installer`
  - **Lease Token**: `tok_claim_9f8a2c4e1b7d83`
  - **Duration**: 30 minutes
  - **Assigned Write Scope**: `tests/unit/installer/`
  - **Role Packet**: `.capsules/2026-08-14-parallel-coverage/packets/task-installer/packet.md`
  - **Note**: Pass `--token tok_claim_9f8a2c4e1b7d83` to `task:submit`.
  ```

#### 2.3.2 `task:heartbeat`
Extends an active task lease to prevent lease timeout during prolonged builds or complex edits.

* **Grammar**:
  ```bash
  bun harness.ts task:heartbeat \
    --run <RUN_ID> \
    --task <TASK_ID> \
    --agent <AGENT_ID> \
    --token <TOKEN> \
    [--extend <DURATION>]
  ```
* **Stdout Markdown Brief**:
  ```markdown
  ### Heartbeat Acknowledged: task-installer
  - **Agent**: `worker-installer`
  - **Lease Extended**: +30 minutes (New Deadline: 19:45:00 UTC)
  ```

#### 2.3.3 `task:submit`
Submits completed worker implementation, automatically verifying that repository modifications strictly respected the assigned write scope.

* **Grammar**:
  ```bash
  bun harness.ts task:submit \
    --run <RUN_ID> \
    --task <TASK_ID> \
    --agent <AGENT_ID> \
    --token <TOKEN> \
    --summary <STRING> \
    [--evidence <PATH>]
  ```
* **Automated Verification & Packaging**:
  1. Validates lease token authenticity and expiration.
  2. Inspects `git status` and `git diff` against baseline repository snapshot.
  3. **Strict Scope Verification**: If any modified, added, or deleted file falls outside the task's declared `write_scope`, the submission is **rejected immediately** with a scope violation error.
  4. Compiles structured submission record in `reports/<TASK_ID>-submission.json`.
  5. Moves task state from `leased` to `submitted`.
* **Stdout Markdown Brief**:
  ```markdown
  ### Submission Accepted: task-installer
  - **Agent**: `worker-installer` | Status: `submitted`
  - **Write Scope Compliance**: Passed (6 files touched, all within `tests/unit/installer/`)
  - **Diff Stats**: +412 lines, -18 lines
  - **Report**: `.capsules/2026-08-14-parallel-coverage/reports/task-installer-submission.json`
  - **Next Step**: Dispatch independent validator via `task:validate-start`.
  ```

---

### 2.4 Independent Validation API

The Validation API enforces independent verification: validators execute gates and audit implementation diffs using dedicated leases.

```
┌───────────┐   task:validate-start   ┌────────────┐     task:review (pass)     ┌───────────┐
│ Submitted ├────────────────────────►│ Validating ├───────────────────────────►│ Satisfied │
└───────────┘                         └─────┬──────┘                            └───────────┘
                                            │ task:reject (or review fail)
                                            ▼
                                     ┌─────────────┐
                                     │   Finding   │──► (Route to Repairer)
                                     │  Recorded   │
                                     └─────────────┘
```

#### 2.4.1 `task:validate-start`
Initiates independent validation for a submitted task, provisioning a validator packet.

* **Grammar**:
  ```bash
  bun harness.ts task:validate-start \
    --run <RUN_ID> \
    --task <TASK_ID> \
    --validator <VALIDATOR_ID> \
    [--lease-duration <DURATION>]
  ```
* **Automated Operations**:
  - Generates validation packet in `.capsules/<RUN_ID>/packets/<TASK_ID>-val/packet.md` containing submission summary, diff snapshot, and gate command list.
  - Transitions task state from `submitted` to `validating`.
  - Issues validator bearer token.
* **Stdout Markdown Brief**:
  ```markdown
  ### Validation Leased: task-installer
  - **Validator**: `val-agent-1`
  - **Validation Token**: `tok_val_8a7d6e5c4b3a21`
  - **Mandatory Gates to Run**:
    1. `bun test tests/unit/installer`
  - **Validator Packet**: `.capsules/2026-08-14-parallel-coverage/packets/task-installer-val/packet.md`
  ```

#### 2.4.2 `task:review`
Records the validator's authoritative verdict and executes/verifies mandatory gate evidence.

* **Grammar**:
  ```bash
  bun harness.ts task:review \
    --run <RUN_ID> \
    --task <TASK_ID> \
    --validator <VALIDATOR_ID> \
    --token <VAL_TOKEN> \
    --status <pass|fail> \
    --summary <STRING> \
    [--evidence <PATH>]
  ```
* **State Mutations & Workflow**:
  - If `status: pass`:
    - Verifies gate execution evidence.
    - Transitions task state to `satisfied`.
    - Stores `reports/<TASK_ID>-review.json`.
    - Evaluates DAG: unblocks dependent downstream tasks in queue.
  - If `status: fail`:
    - Creates structured finding in `findings/<FINDING_ID>.json`.
    - Transitions task state to `rejected` / `repair_needed`.
* **Stdout Markdown Brief (Pass)**:
  ```markdown
  ### Task Validated & Satisfied: task-installer
  - **Validator**: `val-agent-1` | Verdict: ✅ PASS
  - **Gate Results**: `bun test tests/unit/installer` (86 tests passed, 0 failures)
  - **Downstream Impact**: Unblocked `task-integration` in queue
  - **Review Report**: `.capsules/2026-08-14-parallel-coverage/reports/task-installer-review.json`
  ```

#### 2.4.3 `task:reject`
Dedicated rejection command to log structured audit findings and route a task back for repair.

* **Grammar**:
  ```bash
  bun harness.ts task:reject \
    --run <RUN_ID> \
    --task <TASK_ID> \
    --validator <VALIDATOR_ID> \
    --token <VAL_TOKEN> \
    --reason <STRING> \
    --finding <STRING>
  ```
* **Stdout Markdown Brief**:
  ```markdown
  ### Task Rejected: task-installer
  - **Validator**: `val-agent-1` | Verdict: ❌ REJECTED
  - **Finding ID**: `finding-installer-timeout-01`
  - **Issue**: `Test suite exceeds 250 physical lines in installer-helper.spec.ts`
  - **Action**: Task returned to queue with status `repair_needed`.
  ```

---

### 2.5 Completeness Critic & Run Finalization API

The Critic API performs run-level completeness verification against original prompt requirements before sealing the capsule.

#### 2.5.1 `critic:start`
Initializes completeness critic evaluation once all tasks reach `satisfied`.

* **Grammar**:
  ```bash
  bun harness.ts critic:start \
    --run <RUN_ID> \
    --critic <CRITIC_ID>
  ```
* **Pre-conditions & Invariants**:
  - All graph tasks must be in `satisfied` state.
  - Zero open unclosed findings in `findings/`.
  - Generates critic packet in `packets/critic/packet.md` aggregating prompt requirements, all gate evidence proofs, and total repository diff.
* **Stdout Markdown Brief**:
  ```markdown
  ### Completeness Critic Session Initialized
  - **Critic**: `critic-agent-alpha`
  - **Critic Token**: `tok_critic_3f9e8a7b6c5d4e`
  - **Scope Under Review**: 4/4 tasks satisfied | 12/12 requirements evidenced
  - **Mandatory Final Gate**: `bun test` (Full workspace verification)
  - **Critic Packet**: `.capsules/2026-08-14-parallel-coverage/packets/critic/packet.md`
  ```

#### 2.5.2 `critic:review`
Records the completeness critic's formal approval or remediation request.

* **Grammar**:
  ```bash
  bun harness.ts critic:review \
    --run <RUN_ID> \
    --critic <CRITIC_ID> \
    --token <TOKEN> \
    --decision <approve|request_changes> \
    --summary <STRING> \
    [--finding <STRING>]
  ```
* **Stdout Markdown Brief**:
  ```markdown
  ### Completeness Critic Sign-Off: APPROVED
  - **Critic**: `critic-agent-alpha`
  - **Authorization**: Valid completion certificate issued
  - **Prompt Coverage**: 100% (12/12 requirements verified with zero gaps)
  - **Next Step**: Seal run via `bun harness.ts run:complete --run <RUN_ID> --auth-token <TOKEN>`
  ```

#### 2.5.3 `run:complete`
Seals the run capsule, updates manifest timestamps, verifies repository clean state, and records final completion proof.

* **Grammar**:
  ```bash
  bun harness.ts run:complete \
    --run <RUN_ID> \
    --auth-token <CRITIC_TOKEN>
  ```
* **Stdout Markdown Brief**:
  ```markdown
  ### 🎉 Run Completed Successfully: 2026-08-14-parallel-coverage
  - **Capsule**: `.capsules/2026-08-14-parallel-coverage/`
  - **Summary**: 4 tasks executed, 4 independent validations passed, 1 critic sign-off
  - **Total Gates Verified**: 5/5 gates green
  - **Run Duration**: 42m 18s | Token Efficiency: 98.2% reduction
  - **Capsule Status**: Sealed & Auditable
  ```

#### 2.5.4 `run:status`
Outputs an authoritative, high-density dashboard of run progress.

* **Grammar**:
  ```bash
  bun harness.ts run:status --run <RUN_ID> [--detailed]
  ```
* **Stdout Markdown Brief**:
  ```markdown
  ### Run Status: 2026-08-14-parallel-coverage (Phase: Executing)
  | Task ID | Label | Write Scope | Status | Agent / Lock |
  | :--- | :--- | :--- | :--- | :--- |
  | `task-core` | Core Tests | `tests/unit/core/` | ✅ Satisfied | Validated by `val-1` |
  | `task-installer` | Installer Tests | `tests/unit/installer/` | 🔄 Validating | `val-agent-1` (18m left) |
  | `task-cli` | CLI Tests | `tests/unit/cli/` | 🏃 Leased | `worker-cli` (24m left) |
  | `task-integration` | Integration Tests | `tests/integration/` | ⏳ Blocked | Waiting on `task-cli` |
  
  **Progress**: 1/4 Satisfied, 1 Validating, 1 Leased, 1 Blocked.
  ```

---

### 2.6 Monitored Command Execution API

#### `run:exec`
Executes verification commands as literal `argv` arrays (safe from shell injection), captures timing and outputs, and persists proofs directly to `evidence/` and `commands/`.

* **Grammar**:
  ```bash
  bun harness.ts run:exec \
    --run <RUN_ID> \
    -- <COMMAND_AND_ARGS...> \
    [--task <TASK_ID>] \
    [--cwd <PATH>] \
    [--save-evidence <EVIDENCE_ID>]
  ```
* **Stdout Markdown Brief**:
  ```markdown
  ### Command Executed: `bun test tests/unit/installer`
  - **Exit Code**: `0` (Success) | **Duration**: 1.84s
  - **Output Summary**: 11 test suites passed, 86 tests passed, 0 failed
  - **Evidence Recorded**: `.capsules/2026-08-14-parallel-coverage/evidence/gate-installer.json`
  - **Raw Stream Log**: `.capsules/2026-08-14-parallel-coverage/commands/cmd-8f92a1.log`
  ```

---

## 3. Token Economics, Context Isolation & Minimal Markdown Schemas

### 3.1 Quantitative Token Economics: JSON vs Markdown Briefs

| Interaction Step | Legacy Raw JSON Approach | Harness CLI Markdown Briefs | Token Reduction |
| :--- | :--- | :--- | :--- |
| **Discover next ready task** | `view_file` on `graph.json` + `state.json` (350 lines JSON) $\approx$ **4,800 tokens** | `bun harness.ts queue:next` (20 lines Markdown) $\approx$ **160 tokens** | **96.7%** |
| **Claim task & get context** | `view_file` on `requirements.json` (400 lines JSON) $\approx$ **5,500 tokens** | `bun harness.ts task:claim` (15 lines Markdown) $\approx$ **140 tokens** | **97.5%** |
| **Submit task completion** | Construct 80-line JSON payload + write file $\approx$ **3,200 tokens** | `bun harness.ts task:submit --summary "..."` $\approx$ **120 tokens** | **96.2%** |
| **Run status check** | `view_file` on `state.json` + `events.jsonl` $\approx$ **8,000 tokens** | `bun harness.ts run:status` (18 lines Markdown) $\approx$ **180 tokens** | **97.8%** |
| **10-Step Workflow Total** | **~120,000 tokens** (Triggering 3-4 context truncations) | **~1,800 tokens** (Zero truncations) | **98.5%** |

```
Legacy Approach (Raw JSON Ingestion):
████████████████████████████████████████ (30,000 tokens / turn -> Context Overflow)

Harness CLI API Approach (Compact Markdown Briefs):
█ (250 tokens / turn -> 98.5% savings, zero truncations)
```

### 3.2 Context Isolation Contract Rules
1. **Rule of Clean Projections**: No CLI command shall ever output raw, unformatted JSON to `stdout` unless the caller explicitly passes `--format=json` for machine scripting. Default `stdout` is always Markdown.
2. **Rule of File Read Elimination**: Agents are strictly forbidden from opening `.json` state files directly via `view_file`. All inspection occurs through `run:status`, `queue:list`, `queue:next`, or reading single role packets in `packets/`.
3. **Line Budget Ceiling**: Every CLI output must be strictly $\le 30$ physical lines. If a list contains more items than can fit within 30 lines, the output must show the top items with a high-level summary and pagination hints.
4. **Actionable Next Steps**: Every CLI Markdown response terminates with an explicit, copy-pasteable next command hint (e.g. `bun harness.ts task:claim ...`).

---

## 4. Automated Graph & Requirement Compilation Engine

```
                               ┌─────────────────────────────┐
                               │ `plan:add` Task Definitions │
                               └──────────────┬──────────────┘
                                              │
                                              ▼
                               ┌─────────────────────────────┐
                               │  Requirement Derivation &   │
                               │   Prompt Line Cover Engine  │
                               └──────────────┬──────────────┘
                                              │
                                              ▼
                               ┌─────────────────────────────┐
                               │ Scope Independence Analyzer │
                               │  (Disjoint Scope Topology)  │
                               └──────────────┬──────────────┘
                                              │
                        ┌─────────────────────┴─────────────────────┐
                        ▼                                           ▼
          ┌───────────────────────────┐               ┌───────────────────────────┐
          │  Automated Parallel DAG   │               │   Validation Feedback     │
          │ (Concurrent Wave Clusters)│               │(Unnecessary Serialization)│
          └───────────────────────────┘               └───────────────────────────┘
```

### 4.1 Automated Requirement & Graph Derivation
When an agent calls `plan:add`, the engine automatically:
1. **Synthesizes Atomic Requirements**: Splits high-level goals into fine-grained requirement entities (`req-<task_id>-1`, `req-<task_id>-2`).
2. **Line Disposition Binding**: Scans `prompt.md` using fuzzy substring and semantic AST matching to assign exact line numbers (`source_lines: [12, 13, 14]`) and excerpts. Disposes non-task lines as `constraint` or `context` with structured rationale to achieve 100% prompt coverage.
3. **Node & Edge Topology Synthesis**:
   - Creates `task` node with write scope and priority.
   - Creates `requirement` nodes and links them via `task -> implements -> requirement`.
   - Creates `gate` node and links via `gate -> validates -> task`.
   - Adds `task -> depends_on -> task` edges only when explicitly declared or necessitated by artifact flow.

### 4.2 Scope Independence Analyzer Algorithm
The Scope Independence Analyzer evaluates all declared task write scopes to discover maximal safe concurrency.

#### Formal Algorithm Specification:
```typescript
interface TaskScope {
  taskId: string;
  normalizedScopes: string[]; // Normalized canonical relative paths
  dependencies: string[];
}

function analyzeScopeIndependence(tasks: TaskScope[]): ScopeAnalysisResult {
  const collisions: ScopeCollision[] = [];
  const parallelWaves: TaskScope[][] = [];
  
  // Step 1: Normalize all scope paths (strip trailing slashes, resolve relative globs)
  for (const task of tasks) {
    task.normalizedScopes = task.normalizedScopes.map(p => normalizePath(p));
  }

  // Step 2: Pairwise Disjoint Set Intersection Check
  for (let i = 0; i < tasks.length; i++) {
    for (let j = i + 1; j < tasks.length; j++) {
      const taskA = tasks[i];
      const taskB = tasks[j];
      
      const overlap = findScopeIntersection(taskA.normalizedScopes, taskB.normalizedScopes);
      if (overlap.hasOverlap) {
        collisions.push({
          taskA: taskA.taskId,
          taskB: taskB.taskId,
          conflictingPath: overlap.conflictingPath,
          relation: overlap.relation // 'exact_match' | 'parent_child'
        });
      }
    }
  }

  // Step 3: Unnecessary Serialization Rule
  // If Task B depends on Task A, but their scopes are completely disjoint
  // and Task B does not consume any output artifact of Task A, emit optimization warning.
  const serializationWarnings: SerializationWarning[] = [];
  for (const task of tasks) {
    for (const depId of task.dependencies) {
      const depTask = tasks.find(t => t.taskId === depId);
      if (depTask) {
        const overlap = findScopeIntersection(task.normalizedScopes, depTask.normalizedScopes);
        if (!overlap.hasOverlap && !hasArtifactDataFlow(depTask, task)) {
          serializationWarnings.push({
            blockedTask: task.taskId,
            dependencyTask: depTask.taskId,
            message: `Unnecessary sequential dependency: scopes are disjoint and no artifact flow exists.`
          });
        }
      }
    }
  }

  return { collisions, serializationWarnings, concurrencyWaves: computeWaves(tasks, collisions) };
}
```

### 4.3 Validation Feedback Rules for Serialization
During `plan:compile`, the CLI validates the schedule against scope independence:
- **Rule 1 (Collision Guard)**: If two tasks have overlapping write scopes and neither depends on the other, compilation emits a blocking error: `Scope collision detected between task-A and task-B on path 'src/common/'. Explicit dependency or partition required.`
- **Rule 2 (Parallelism Discovery Advisory)**: If two tasks have disjoint write scopes and no artifact flow, but are sequentially chained, compilation succeeds with an advisory optimization notice:
  ```markdown
  ⚠️ [PARALLELISM ADVISORY]: `task-cli` declares dependency on `task-installer`, but write scopes are completely disjoint (`tests/unit/cli/` vs `tests/unit/installer/`). Remove `--deps` to execute both in parallel.
  ```

---

## 5. Two-Tier Agent Coordination & Host Adapter Routing

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                     Tier 1: Main Interactive Assistant (Chat)                    │
│   • Converses with user, handles ad-hoc requests, and stays responsive           │
│   • Spawns EXACTLY ONE child: Background Run Coordinator                         │
│   • Ingests milestone-only summary alerts (3 - 5 messages per 2-hour run)        │
└────────────────────────────────────────┬─────────────────────────────────────────┘
                                         │ Spawns 1 Coordinator (via Host Adapter)
                                         ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                  Tier 2: Background Run Coordinator (Orchestrator)               │
│   • Runs isolated in background thread with `enable_subagent_tools: true`       │
│   • Executes Harness CLI lifecycle loop (`queue:next`, `task:claim`, etc.)       │
│   • Manages all Tier 3 workers, validators, and repairers                        │
│   • Directs worker `send_message` traffic away from main chat thread             │
└───────────────────┬────────────────────┬────────────────────┬────────────────────┘
                    │                    │                    │
                    ▼                    ▼                    ▼
     ┌──────────────────────┐ ┌──────────────────────┐ ┌──────────────────────┐
     │ Tier 3: Worker Lane 1│ │ Tier 3: Worker Lane 2│ │ Tier 3: Validator    │
     │  (Implementer Core)  │ │ (Implementer Install)│ │  (Independent Gate)  │
     └──────────────────────┘ └──────────────────────┘ └──────────────────────┘
```

### 5.1 The Two-Tier Isolation Contract
1. **Tier 1 (Main Interactive Thread)**:
   - Maintains conversational responsiveness with the user.
   - Never directly spawns implementers, validators, or critics.
   - Never runs busy-wait polling loops or detailed tool chains.
2. **Tier 2 (Background Run Coordinator)**:
   - Dedicated subagent equipped with subagent creation and harness execution capabilities.
   - Executes the harness state machine, monitors queue progress, and dispatches parallel workers.
   - Intercepts all subagent messages from Tier 3 workers.
3. **Tier 3 (Workers & Validators)**:
   - Ephemeral subagents restricted to leased task scopes.
   - Report exclusively to the Tier 2 Coordinator.

### 5.2 Host Adapter Specifications

#### A. Google Antigravity Host Adapter
```typescript
// Tier 1 spawns Tier 2 Coordinator
invoke_subagent({
  Subagents: [{
    TypeName: "self",
    Role: "Background Run Coordinator",
    Prompt: "You are the Background Run Coordinator for capsule 2026-08-14-parallel-coverage. Execute the run lifecycle using `bun harness.ts` CLI commands.",
    Workspace: "inherit",
    Model: "inherit"
  }]
});

// Tier 2 Coordinator spawns Tier 3 Worker
invoke_subagent({
  Subagents: [{
    TypeName: "self",
    Role: "Worker Lane - Installer",
    Prompt: "Execute task-installer for capsule 2026-08-14-parallel-coverage. Read packet at `.capsules/.../packet.md`. Submit work via `bun harness.ts task:submit`.",
    Workspace: "inherit",
    Model: "inherit"
  }]
});
```

#### B. Claude Code Host Adapter
- **Coordinator Dispatch**: Invoked via Claude Subagent Task Protocol with isolated background context.
- **Worker Concurrency**: Coordinator launches background Task workers, listening on completion webhooks without blocking standard stdout.

#### C. Codex / OpenAI Swarm Host Adapter
- **Routine Execution**: Coordinates tasks via function-calling tool routines, delegating isolated thread sessions to worker functions and aggregating results via callback handoffs.

### 5.3 Milestone Reporting Protocol
The Tier 2 Coordinator sends messages to the Tier 1 Main Assistant **only** at major lifecycle boundaries:
1. **Milestone 1**: Plan Compiled & Initial Wave Dispatched (e.g. "Plan compiled: 4 tasks registered, 3 parallel lanes active").
2. **Milestone 2**: Major Wave Satisfied (e.g. "Wave 0 complete: Core, Installer, and CLI test suites passed validation").
3. **Milestone 3**: Completeness Critic Sign-off & Run Complete (e.g. "Run completed: All 4 tasks satisfied, 100% prompt requirements verified").
4. **Escalation (Exception Only)**: Unresolvable blocker requiring human authority decision.

---

## 6. Migration & Backwards Compatibility Strategy

### 6.1 Compatibility Guardrails
- **Dual-Mode Execution**: The harness will support legacy JSON flags (`--requirements <FILE> --graph <FILE>`) for existing programmatic callers while providing the new high-level CLI commands as the primary interface.
- **Progressive Deprecation**: Legacy direct JSON manipulation instructions in `SKILL.md` will be replaced with CLI API workflows in Phase 4.

---

## 7. Phased Implementation Roadmap

```
┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
│     Phase 1     │──────►│     Phase 2     │──────►│     Phase 3     │──────►│     Phase 4     │
│ Planning Engine │       │ Queue & Workers │       │ Validation/Crit │       │ Skill Protocol  │
└─────────────────┘       └─────────────────┘       └─────────────────┘       └─────────────────┘
```

### Phase 1: Planning Engine, Scope Analyzer & Markdown Formatters
- **Deliverables**:
  - Implement `plan:init`, `plan:add`, `plan:compile`, `plan:status`.
  - Implement Scope Independence Analyzer in `orchestrating-long-tasks/scripts/src/graph/scope-analyzer.ts`.
  - Implement Requirement Compiler in `orchestrating-long-tasks/scripts/src/requirements/compiler.ts`.
  - Implement Markdown output renderers with $\le 30$ line ceiling.
- **Target Files**:
  - `src/cli/commands/planning.ts`
  - `src/graph/scope-analyzer.ts`
  - `src/requirements/compiler.ts`
  - `src/reporting/markdown-formatters.ts`
- **Verification Gate**:
  - `bun test tests/unit/planning tests/unit/graph` (100% statement & branch coverage).

### Phase 2: Queue & Worker Lifecycle Engine
- **Deliverables**:
  - Implement `queue:next`, `queue:list`, `queue:pop`.
  - Implement `task:claim`, `task:heartbeat`, `task:submit`.
  - Implement automated `git diff` write scope validation on submit.
  - Implement `run:exec` monitored execution logging.
- **Target Files**:
  - `src/cli/commands/queue.ts`
  - `src/cli/commands/worker.ts`
  - `src/cli/commands/runner.ts`
  - `src/workflow/scope-guard.ts`
- **Verification Gate**:
  - `bun test tests/unit/queue tests/unit/worker tests/unit/runner` (100% coverage).

### Phase 3: Independent Validation, Critic & Completion Engine
- **Deliverables**:
  - Implement `task:validate-start`, `task:review`, `task:reject`.
  - Implement `critic:start`, `critic:review`, `run:complete`, `run:status`.
  - Implement structured finding generation and critic authorization certificates.
- **Target Files**:
  - `src/cli/commands/validation.ts`
  - `src/cli/commands/completion.ts`
  - `src/workflow/critic.ts`
- **Verification Gate**:
  - `bun test tests/unit/validation tests/unit/completion` (100% coverage).

### Phase 4: Skill Protocol & Two-Tier Host Integration
- **Deliverables**:
  - Update `orchestrating-long-tasks/SKILL.md` to mandate the CLI API protocol.
  - Add reference guides and host adapter templates for Antigravity, Claude Code, and Codex.
  - End-to-end integration test suite simulating full parallel runs with zero raw JSON file ops.
- **Target Files**:
  - `orchestrating-long-tasks/SKILL.md`
  - `orchestrating-long-tasks/references/cli-reference.md`
  - `orchestrating-long-tasks/references/two-tier-coordination.md`
- **Verification Gate**:
  - Full end-to-end simulation test suite passing with 100% gate assurance.

---

## 8. Quality Gates & Architectural Verification Strategy

### 8.1 Code & Convention Standards
1. **Module Size Enforcement**:
   - Production modules strictly $< 200$ physical lines of code.
   - Test modules strictly $< 250$ physical lines of code.
2. **Strict TypeScript Standards**:
   - Zero `any` annotations (`: any`, `as any`, `Promise<any>`).
   - Zero suppression directives (`@ts-ignore`, `@ts-expect-error`, `eslint-disable`).
   - All external boundaries typed with `unknown` and validated via type guards.
3. **Coverage Standard**:
   - 100% statement, branch, function, and line coverage across all new CLI and graph modules.

---

## 9. Appendix: Complete CLI Command Grammar Reference

```bash
# --- PLANNING ---
bun harness.ts plan:init --run <RUN> --prompt-file <PATH> [--repo <PATH>] [--capture-mode file|stdin] [--source-verified]
bun harness.ts plan:add --run <RUN> --id <ID> --label <TXT> --scope <PATHS> --gate <CMD> [--deps <IDS>] [--goal <TXT>] [--criteria <TXT>] [--priority <N>] [--effort <N>]
bun harness.ts plan:compile --run <RUN> [--strict-parallel] [--actor <NAME>]
bun harness.ts plan:status --run <RUN>

# --- QUEUE & DISCOVERY ---
bun harness.ts queue:next --run <RUN> [--max-parallel <N>] [--agent <ID>]
bun harness.ts queue:list --run <RUN> [--all]
bun harness.ts queue:pop --run <RUN> --agent <ID> [--lease-duration <DUR>]

# --- WORKER LIFECYCLE ---
bun harness.ts task:claim --run <RUN> --task <ID> --agent <ID> [--lease-duration <DUR>]
bun harness.ts task:heartbeat --run <RUN> --task <ID> --agent <ID> --token <TOK> [--extend <DUR>]
bun harness.ts task:submit --run <RUN> --task <ID> --agent <ID> --token <TOK> --summary <TXT> [--evidence <PATH>]

# --- INDEPENDENT VALIDATION ---
bun harness.ts task:validate-start --run <RUN> --task <ID> --validator <ID> [--lease-duration <DUR>]
bun harness.ts task:review --run <RUN> --task <ID> --validator <ID> --token <TOK> --status pass|fail --summary <TXT> [--evidence <PATH>]
bun harness.ts task:reject --run <RUN> --task <ID> --validator <ID> --token <TOK> --reason <TXT> --finding <TXT>

# --- CRITIC & COMPLETION ---
bun harness.ts critic:start --run <RUN> --critic <ID>
bun harness.ts critic:review --run <RUN> --critic <ID> --token <TOK> --decision approve|request_changes --summary <TXT> [--finding <TXT>]
bun harness.ts run:complete --run <RUN> --auth-token <TOK>
bun harness.ts run:status --run <RUN> [--detailed]

# --- MONITORED EXECUTION ---
bun harness.ts run:exec --run <RUN> [--task <ID>] [--cwd <PATH>] [--save-evidence <ID>] -- <CMD...>
```

# Plan 23: Small-Model Resilience & Zero-Blunder Orchestration Hardening

> **Status**: **Completed & Authoritative**  
> **Directory**: `docs/planning/23-small-model-resilience-and-zero-blunder-orchestration/`  
> **Target Subsystems**: `olt/agents/`, `olt/roles/`, `olt/references/`, `olt/scripts/src/mind/`, `olt/scripts/src/authority/`, `olt/scripts/src/cli/commands/`  
> **Spec Reference**: `AGENTS.md` (Axioms 1, 4, 10, 12, 13, 20, 22, 28, 30)

---

## 1. Executive Summary & Root-Cause Forensics

During extensive stress-testing of long-horizon orchestration runs with small-to-medium parameter language models (specifically cataloged in benchmark conversation `8b1c3333-a00c-4dc3-871d-8f72b3b3465a`), several recurring failure modes and behavioral blunders emerged. These failure patterns undermined autonomous loop convergence, burned prompt tokens on exploratory scanning, and introduced fragile reliance on manual prompt engineering.

Plan 23 permanently hardens the entire OLT agent ecosystem, role contracts, YAML manifests, reference architectures, AST briefing builders, and execution guards against these failure modes.

### The 7 Critical Small-Model Failure Modes

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                 SMALL-MODEL FAILURE MODES & STRUCTURAL REMEDIES             │
├─────────────────────────────────────────────────────────────────────────────┤
│ 1. Initiation Paralysis / Prompt Stalls                                     │
│    ❌ Model wakes up and asks user "How can I help you?" or halts on turn 0.│
│    ✅ Turn 0 Autonomous Wake-up Invariant: Autonomous discovery from         │
│       docs/CHARTER.md and .olt/feedback-queue.jsonl without human prompts.  │
├─────────────────────────────────────────────────────────────────────────────┤
│ 2. Tool & SDK Hallucinations                                                │
│    ❌ Inventing fictional SDKs (`import { Agy } from 'agy'`, `agy models`). │
│    ✅ Host Environment Contract (`host-environment.md`) + negative          │
│       constraints separating Host Platform tools from Harness CLI commands. │
├─────────────────────────────────────────────────────────────────────────────┤
│ 3. Unmanaged Background Shell Scripts & Sleep Daemons                       │
│    ❌ Executing `nohup cmd &` or `sleep 300` in bash subshells.              │
│    ✅ Host `schedule` reactive timer protocol + Non-Blocking Scheduler      │
│       Return Invariant (ending turn or continuing proactive background cog).│
├─────────────────────────────────────────────────────────────────────────────┤
│ 4. Empty Message Payloads & Reasoning-Only Drops                            │
│    ❌ Terminating without `send_message` or returning empty JSON bodies.   │
│    ✅ Non-Empty Payload Mandate (`NON_EMPTY_PAYLOAD_MANDATE`) + mandatory    │
│       structured submission reports and receipts.                           │
├─────────────────────────────────────────────────────────────────────────────┤
│ 5. Root Directory Hygiene Pollution                                         │
│    ❌ Dumping temporary scripts (`./test.ts`, `./temp.js`, `./debug.log`)    │
│       directly into the repository root.                                    │
│    ✅ `RootDirectoryHygieneGuard` (`root-hygiene-guard.ts`): Enforces        │
│       `ROOT_HYGIENE_VIOLATION` for uncoordinated files outside `scratch/`.  │
├─────────────────────────────────────────────────────────────────────────────┤
│ 6. Gate-Proof Manual Linking Traps                                          │
│    ❌ Forgetting to record gate proofs after successful test runs.          │
│    ✅ Automatic Gate Proof Attachment in `run:exec` (`run-ops.ts`):         │
│       Dynamically binds test records to task gates upon exit code 0.        │
├─────────────────────────────────────────────────────────────────────────────┤
│ 7. Exploratory Discovery Loops & Token Burning                              │
│    ❌ Burning 5-10 turns doing `list_dir`, `grep_search`, `find_by_name`.    │
│    ✅ Zero-Exploration Exact-Anchor Briefings (`briefing-builder.ts`):       │
│       Supplies exact line coordinates, AST symbols, and drop-in chunks.     │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Unified Architecture & Structural Invariants

The hardened architecture rests on 7 structural pillars embedded across configuration, schemas, runtime CLI, and supervisory personas:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                      PLAN 23 HARDENED ARCHITECTURE                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [ Tier 0: Mind Supervisor ] ──> Autonomous Wakeup (`docs/CHARTER.md`)      │
│         │                                                                   │
│         ▼                                                                   │
│  [ Tier 1: Orchestrator ]   ──> 10-Step Deep-Thinking Planning Checklist    │
│         │                                                                   │
│         ▼                                                                   │
│  [ Tier 2: Coordinator ]    ──> Zero-Exploration 1-Shot Briefing Builder    │
│         │                       (`task:brief`, AST Exact Anchors)           │
│         ▼                                                                   │
│  [ Tier 3: Workers ]        ──> Disjoint Scope Leases & 1-Hop Micro-Cycles  │
│                                 (Turn 1 File Edits, Zero Discovery Chatter) │
│                                                                             │
│  [ Execution Platform ]     ──> Host Tools vs Harness CLI Separation        │
│                                 (`olt/references/host-environment.md`)      │
│  [ Process Safety ]         ──> Non-Blocking Scheduler (`schedule`) &       │
│                                 Root Hygiene Guard (`root-hygiene-guard.ts`)│
│  [ Verification Automation] ──> Auto Gate Proof Attachment (`run:exec`)     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1. Turn 0 Autonomous Wake-up Invariant

- Supervisory agents (`mind`, `orchestrator`, `coordinator`) are programmed with explicit negative constraints against waiting for user prompts or asking for instructions.
- Mind automatically reads the project charter at `docs/CHARTER.md` and discovers pending tasks from `.olt/feedback-queue.jsonl`.
- If the backlog queue is empty, Mind immediately transitions to **Autonomous Discovery Mode** (auditing 0 `any` types, charter gaps, blunder regression suites, and Brent Work/Span concurrency $P = \lceil W / S \rceil$).

### 2. Host Tools vs. Harness CLI Separation

- Detailed in `olt/references/host-environment.md`:
  - **Native Host Tools**: `view_file`, `replace_file_content`, `write_to_file`, `list_dir`, `grep_search`, `find_by_name`, `run_command`, `manage_task`, `schedule`, `define_subagent`, `invoke_subagent`, `manage_subagents`, `send_message`.
  - **Harness Protocol CLI**: `bun ~/.agents/skills/olt/scripts/harness.ts <command>` (or `bun ./olt/scripts/harness.ts <command>`).
- Strict prohibition of non-existent SDK imports (`@antigravity/sdk`, `agy`, `@anthropic/claude-code`) and pseudo-binaries (`agy models`, `gemini agent spawn`).

### 3. Rigid Role Negative Constraints (`must_not`)

All 5 golden roles (`mind`, `orchestrator`, `coordinator`, `implementer`, `validator`) enforce standardized negative constraint arrays in their YAML manifests and role contracts:

- Never prompt user for instructions upon startup.
- Never hallucinate nonexistent host tool SDKs or pseudo-commands.
- Never spawn raw unmanaged background `nohup` bash scripts or detach daemon processes.
- Never stall on non-blocking scheduler tool return states (`schedule` returns immediately).
- Never emit empty payloads or reasoning-only drops lacking structured reports.
- Never create loose scratch files in the repository root.

### 4. Zero-Exploration Exact-Anchor Briefings (`briefing-builder.ts`)

- The AST extraction engine in `olt/scripts/src/mind/briefing-builder.ts` inspects target files on disk using the TypeScript compiler API (`ts.createSourceFile`).
- Automatically extracts function/class/interface/type/enum/method/property signatures with exact 1-indexed line ranges (`StartLine`, `EndLine`), docstrings, and drop-in context snippets.
- Derives recommended file-scoped test commands (`deriveRecommendedTestCommands`) from touched paths (e.g. `bun test tests/unit/...test.ts`).
- Guarantees that dispatched implementers can perform surgical Turn 1 edits with zero preliminary exploratory `list_dir` or `grep_search` calls.

### 5. Root Directory Hygiene Guard (`root-hygiene-guard.ts`)

- `RootDirectoryHygieneGuard.assertAllowedWritePath` verifies that all file creations and edits reside either in declared project directories or inside the designated `scratch/` directory.
- Any attempt to create uncoordinated temporary `.ts`, `.js`, `.json`, or `.log` scratch files in the repository root triggers an immediate `PATH_SAFETY` exception (`[ROOT_HYGIENE_VIOLATION]`).

### 6. Automatic Gate Proof Attachment in `run:exec`

- In `olt/scripts/src/cli/commands/run-ops.ts`, when a command executes with `--task <id>` and `--gate <gateId>` flags and finishes with `exitCode === 0`, the harness automatically records the gate proof (`attachGateResult`) and advances task completion (`finishTask`).
- Eliminates manual linking oversights and guarantees tamper-proof verification receipts in the capsule state ledger.

### 7. Protected Supervisory Cadence & Non-Blocking Schedulers

- Supervisory persona reminders and watchdog heartbeats run on 3-to-5-minute cycles (`authority/watchdog-manager.ts`, `authority/persona-grounding.ts`).
- `TimerProtectionGuard` prevents non-human roles from canceling or killing supervisory heartbeat timers.
- Agents are grounded to understand that `schedule` calls return immediately without blocking, requiring agents to conclude turns or proceed with background work.

---

## 3. Implementation Status & Codebase Audit Ledger

Every task specified in Plan 23 has been audited against the live codebase:

| Task / Subsystem                            | Target Files                                                                                                                                                   |                         Implementation Status                         | Grounded Code Evidence                                                                                                                                                                                                                                                                                                                                       |
| :------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------: | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Task 1: Agent YAML Manifests**            | `olt/agents/mind.yaml`<br>`orchestrator.yaml`<br>`coordinator.yaml`<br>`implementer.yaml`<br>`validator.yaml`                                                  | **Completed** _(Minor parity enhancement noted for coordinator.yaml)_ | • `mind.yaml` (L56–62): Explicit negative constraints for paralysis, hallucinations, sleep scripts, empty payloads, root hygiene.<br>• `orchestrator.yaml` (L53–59): Complete failure mode constraints.<br>• `implementer.yaml` (L22–27, L83–88): Strict `must_not` clauses + invariants.<br>• `validator.yaml`: Cognitive validator hard-lock (0 commands). |
| **Task 2: Role Markdown Contracts**         | `olt/agents/*.yaml` (`instructions:` block)<br>`olt/scripts/src/authority/persona-grounding.ts`<br>`olt/scripts/src/authority/supervisory-persona-reminder.ts` |                             **Completed**                             | • Embedded directly in YAML manifest instruction blocks and synchronized with `SUPERVISORY_ROLE_BOUNDARIES` in `persona-grounding.ts` (L34–159).<br>• Standing checklists `STANDING_CHECKLIST_DEFINITIONS` in `supervisory-persona-reminder.ts` (L407–459).                                                                                                  |
| **Task 3: Host Environment Contract**       | `olt/references/host-environment.md`<br>`olt/references/failure-modes.md`                                                                                      |                             **Completed**                             | • `host-environment.md` (357 lines): Authoritative catalog of native host tools vs harness CLI, prohibited hallucinations, and workspace hygiene.<br>• `failure-modes.md` (156 lines): Canonical loopholes and structural countermeasures.                                                                                                                   |
| **Task 4: Auto Gate Proof Attachment**      | `olt/scripts/src/cli/commands/run-ops.ts`                                                                                                                      |                             **Completed**                             | • `run-ops.ts` (L430–438): Auto-triggers `attachGateResult(port, task, gate, record.id, actor)` and `finishTask(port, task, actor)` when `task && gate && exitCode === 0`.                                                                                                                                                                                   |
| **Task 5: Zero-Exploration Briefings**      | `olt/scripts/src/mind/briefing-builder.ts`<br>`olt/scripts/src/cli/commands/task-brief.ts`<br>`olt/scripts/src/cli/commands/agent-brief.ts`                    |                             **Completed**                             | • `briefing-builder.ts` (1,117 lines): TypeScript AST symbol extractor (`extractSymbolsFromSource`), anchor generator (`extractFileAnchors`), test command derivation (`deriveRecommendedTestCommands`), markdown formatter (`formatExactAnchorBriefingMarkdown`).                                                                                           |
| **Task 6: Root Hygiene & Timer Protection** | `olt/scripts/src/authority/root-hygiene-guard.ts`<br>`olt/scripts/src/authority/timer-protection-guard.ts`                                                     |                             **Completed**                             | • `root-hygiene-guard.ts` (L20–35): `RootDirectoryHygieneGuard.assertAllowedWritePath` throwing `ROOT_HYGIENE_VIOLATION`.<br>• `timer-protection-guard.ts` (L14–23): `TimerProtectionGuard.assertCanKillTimer` blocking non-human kills of supervisory timers.                                                                                               |

---

## 4. Empirical Validation & Falsifiability Evidence

All core subsystems and failure mode protections are verified by comprehensive unit test suites passing cleanly with zero type errors and zero suppressions:

### 1. Manifest Schema & Authority Invariants

- **Test File**: `tests/unit/authority/manifest-parser.test.ts` (1,651 lines, 32 assertions)
- **Key Assertions**:
  - `parseUnifiedAgentManifest` and `validateUnifiedAgentManifest` catch structural anomalies, missing tools, and invalid permissions arrays.
  - `evaluateSupervisoryState` detects supervisory zero-file-edit violations (`SUPERVISOR_ZERO_FILE_EDIT_BREACH`), self-execution attempts (`SUPERVISOR_TASK_SELF_EXECUTION_BREACH`), and cross-tier spawning (`CROSS_TIER_SPAWN_HIERARCHY_BREACH`).
  - Unified agent models dynamically merge role contracts, YAML manifests, and standing decision protocols.

### 2. Root Directory Hygiene Guard Verification

- **Test File**: `tests/unit/authority/root-hygiene-guard.test.ts`
- **Key Assertions**:
  - Verifies that writes to root config files (`package.json`, `tsconfig.json`, `lefthook.yml`, `.gitignore`) are permitted.
  - Verifies that any uncoordinated scratch file (e.g. `test.ts`, `scratch.json`, `debug.log`) in the repository root throws `HarnessError` with code `PATH_SAFETY` and message containing `[ROOT_HYGIENE_VIOLATION]`.

### 3. Supervisory Timer Protection Guard Verification

- **Test File**: `tests/unit/authority/timer-protection.test.ts`
- **Key Assertions**:
  - Verifies that supervisory heartbeats are immutable and cannot be killed by autonomous subagents.
  - Verifies that only `human_root` callers possess permission to terminate protected timers.

### 4. Gate Proof Falsifiability & Revert Simulation

- **Test File**: `tests/unit/graph/gate-proof.test.ts` (438 lines)
- **Key Assertions**:
  - Verifies `proveGateFalsifiable` proves gate failure on disposable scratch copies before trusting green passes.
  - Verifies `appendGateProof` and `latestGateProof` maintain chronological, tamper-proof gate verification ledgers.

---

## 5. Architectural Invariants Summary

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                       STANDALONE EXECUTION INVARIANTS                       │
├─────────────────────────────────────────────────────────────────────────────┤
│ 1. Zero 'any' & Zero Suppressions: Strict TypeScript compilation across      │
│    all source and test files (0 'any', 0 '@ts-ignore', 0 'eslint-disable').  │
├─────────────────────────────────────────────────────────────────────────────┤
│ 2. Disjoint Write Scope Isolation: Every worker strictly modifies files     │
│    within leased write scope. Out-of-scope edits are critical violations.   │
├─────────────────────────────────────────────────────────────────────────────┤
│ 3. Cognitive Validator Hard-Lock: Cognitive validators execute 0 commands;   │
│    implementers own 100% of unit tests; mechanic verification is CLI-based. │
├─────────────────────────────────────────────────────────────────────────────┤
│ 4. Zero-Exploration 1-Shot Briefings: Dispatches include exact line numbers, │
│    AST symbol anchors, drop-in replacement chunks, and focused commands.    │
├─────────────────────────────────────────────────────────────────────────────┤
│ 5. Clean Repository Root: All temporary test scripts and debug logs reside   │
│    strictly in 'scratch/' or '.olt/scratch/'.                                │
├─────────────────────────────────────────────────────────────────────────────┤
│ 6. Automatic Gate Binding: Successful test executions with --task and --gate │
│    automatically record cryptographic proof in active run ledgers.          │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Next Steps & Continuous Maintenance

1. **Keep `coordinator.yaml` `permissions.must_not` in Full Parity**:
   - Ensure `olt/agents/coordinator.yaml` continuously mirrors the full negative constraint array found in `mind.yaml` and `orchestrator.yaml` (prompt stalls, tool hallucinations, sleep scripts, empty payloads).
2. **Periodic Charter & Blunder Audit**:
   - As new edge cases arise in multi-agent runs, register empirical blunder instances in `.olt/blunders.jsonl` and auto-promote to `completed-blunders.jsonl` with verified test assertions via `bun harness.ts defect:audit --auto-promote`.
3. **Global Skill Sync**:
   - Synchronize updates to global agents directory via `bun scripts/sync-global.ts` to keep `~/.agents/skills/olt/` in lockstep with the canonical monorepo.

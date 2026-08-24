# Plan 24: Direct Host Tool Interception & Automatic Command Receipt Logging

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement remaining tasks in this plan. Completed steps are verified with empirical test proofs (`- [x]`); pending steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent subagents from bypassing the harness CLI when executing terminal commands or modifying code, automatically generating cryptographically signed command execution receipts (`receipt_sha256`, `stdout_sha256`) in `evidence/`, `state.json`, and `events.jsonl` whenever a test or check is run. Eliminate the `[GATE_NOT_PROVED]` friction trap that drives agents to write scratch patch scripts by providing automatic gate result attachment, shielded non-interactive execution, and fast in-process incremental verification (`task:check`).

**Spec:** `AGENTS.md` (Axiom 6: Strict Test Execution Ban on Supervisors, Axiom 9: Direct Argv & Non-Interactive Execution, Axiom 22: Fast Incremental Verification, Axiom 28: Shielded Shell).

---

## 1. System Overview & Architectural Model

Subagents operating in complex multi-agent environments often attempt to run raw shell commands, whole-repo test suites, or unshielded chained commands (`&&`, `;`, `|`), risking dirty git working trees, unbounded token costs, and non-deterministic execution states. Furthermore, when gate verification proofs are not automatically captured into capsule state, subagents fall into the `[GATE_NOT_PROVED]` trap and resort to authoring manual scratch patch scripts.

Plan 24 establishes a unified **Shielded Execution & Automatic Receipt Pipeline**:

```text
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│              DIRECT HOST TOOL INTERCEPTION & AUTO-RECEIPTS ARCHITECTURE                 │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                         │
│   [ Subagent Dispatch & Execution Intent ]                                              │
│   ┌─────────────────────────────────┐   ┌───────────────────────────────────────────┐   │
│   │ Implementer / Worker Command    │   │ Fast Incremental Check (`task:check`)     │   │
│   │ `bun harness.ts shell -- ...`   │   │ `--file <paths>` or `--task <id>`         │   │
│   └────────────────┬────────────────┘   └─────────────────────┬─────────────────────┘   │
│                    │                                          │                         │
│                    ▼                                          ▼                         │
│   [ Hard-Coded Mechanical RBAC Engine (`rbac-engine.ts`) ]                              │
│   ┌─────────────────────────────────────────────────────────────────────────────────┐   │
│   │ • Persona Role Enforcement (Cognitive Validators: 0 shell execution privileges)│   │
│   │ • Implementer Confinement: Blocks untargeted whole-suite tests (vitest, bun test)│   │
│   │ • Static Subshell/Chaining Ban: Blocks sh -c, eval, &&, ;, pipe chaining        │   │
│   │ • Scope Safety Guard: Validates file write and read bounds                       │   │
│   └────────────────────────────────────────┬────────────────────────────────────────┘   │
│                                            │                                            │
│                                            ▼                                            │
│   [ Dual Execution & State Recording Pathways ]                                         │
│   ┌────────────────────────────────────────┴────────────────────────────────────────┐   │
│   │                                                                                 │   │
│   │  Path A: Standalone Host Execution (`shellCommand`)                             │   │
│   │  • Direct argv execution via spawnSync                                          │   │
│   │  • Emits signed receipt to `evidence/cmd-<sha16>.json`                          │   │
│   │  • Emits live telemetry event to `.olt/telemetry.jsonl`                         │   │
│   │                                                                                 │   │
│   │  Path B: Capsule-Integrated Execution (`run:exec` / `runAndRecordCommand`)      │   │
│   │  • Two-phase transaction: `recordCommandIntent` -> `reconcileCommandResult`     │   │
│   │  • Atomically updates `state.json` (`commands` ledger) and `events.jsonl`       │   │
│   │  • Writes receipt to `<capsuleRoot>/evidence/cmd-<id>.json`                     │   │
│   │  • Auto-Gate Proof Attachment: `attachGateResult` & `finishTask` on exit code 0 │   │
│   │                                                                                 │   │
│   │  Path C: Fast Incremental Compiler & AST Audit (`task:check`)                   │   │
│   │  • In-process TypeScript typechecker (0 compiler suppressions, 0 any)           │   │
│   │  • AST invariant linter (0 forbidden patterns)                                 │   │
│   │  • Emits structured mechanic report to `evidence/mechanic-report[-<task>].json` │   │
│   └────────────────────────────────────────┬────────────────────────────────────────┘   │
│                                            │                                            │
│                                            ▼                                            │
│   [ Cryptographic Receipts, State Ledgers & Telemetry Stream ]                          │
│   ┌─────────────────────────────┐ ┌───────────────────────────┐ ┌─────────────────────┐│
│   │ Cryptographic Evidence JSON │ │ Capsule Transaction State │ │ Live Telemetry Stream││
│   │  `evidence/cmd-*.json`      │ │   `state.json` (commands) │ │  Stream Logging      ││
│   │  `stdout_sha256`, receipt   │ │   `events.jsonl` (receipt)│ │(.olt/telemetry.jsonl)││
│   └─────────────────────────────┘ └───────────────────────────┘ └─────────────────────┘│
│                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Architectural Components & Codebase Mapping

### A. Mechanical RBAC Authorization Engine

- **File:** [`olt/scripts/src/policy/rbac-engine.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/policy/rbac-engine.ts)
- **Functions:** `verifyCommandAuthorization(metadata, argv, policy)`
- **Guarantees:**
  - **Cognitive Validator Hard-Lock:** Cognitive Validators (`validator`, `code-quality`, `security`, `ui-design`) have `can_execute_shell: false`, permanently barring any command execution.
  - **Untargeted Test Suite Ban:** Implementers are blocked from running global test suites (`^bun test$`, `^vitest$`, `^npm test$`, `^pytest$`, `^cargo test$`) without explicit target file arguments.
  - **Unshielded Subshell / Chaining Defense:** Rejects raw subshells (`sh -c`, `bash -c`, `eval`, `node -e`) and unshielded chaining operators (`&&`, `;`, `|`).

### B. Shielded Shell Command

- **File:** [`olt/scripts/src/cli/commands/shell.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/cli/commands/shell.ts)
- **Functions:** `shellCommand(flags, context, remainder)`
- **Guarantees:**
  - Direct argv execution without subshell invocation.
  - Cryptographically signs execution metadata (`receipt_sha256`, `stdout_sha256`, `stderr_sha256`).
  - Writes durable receipts to `<runRoot>/evidence/cmd-<id>.json` or `evidence/cmd-<sha>.json`.
  - Emits telemetry events to `.olt/telemetry.jsonl` with estimated token counts and exit codes.

### C. Capsule Command Execution & Auto-Gate Proof Attachment

- **Files:** [`olt/scripts/src/cli/commands/run-ops.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/cli/commands/run-ops.ts), [`olt/scripts/src/integration/record-command.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/integration/record-command.ts)
- **Functions:** `runExecCommand`, `runAndRecordCommand`, `attachGateResult`
- **Guarantees:**
  - Two-phase transactional execution recording into `state.json` and `events.jsonl` via `transact`.
  - Automatic Gate Attachment: When `--task` and `--gate` are passed and the command succeeds (`exitCode === 0`), `run:exec` automatically invokes `attachGateResult` and `finishTask`, permanently eliminating `[GATE_NOT_PROVED]` traps.
  - Ingests visual screenshots into capsule artifacts if generated during command execution.

### D. Fast In-Process Incremental Verification (`task:check`)

- **File:** [`olt/scripts/src/cli/commands/task-check.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/cli/commands/task-check.ts)
- **Functions:** `taskCheckCommand`, `performIncrementalTypecheck`, `performAstLintCheck`
- **Guarantees:**
  - Targeted compilation and diagnostics check in milliseconds.
  - Zero-`any` and zero-compiler-suppression AST static enforcement.
  - Writes structured audit reports to `evidence/mechanic-report[-<taskId>].json`.

### E. Auto-Receipt Logger

- **File:** [`olt/scripts/src/engine/runner/auto-receipt.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/engine/runner/auto-receipt.ts)
- **Functions:** `AutoReceiptLogger.recordReceipt(capsuleRoot, options)`
- **Guarantees:**
  - Appends verified SHA-256 hashed command events to `events.jsonl`.

---

## 3. Post-Analysis Audit Reconciliation & Implementation Status

A comprehensive audit between `PLAN.md`, `POST_ANALYSIS.md`, and the active codebase confirms:

| Component                                              |         Status         | Implementation Location                                | Empirical Evidence / Verification                                 |
| :----------------------------------------------------- | :--------------------: | :----------------------------------------------------- | :---------------------------------------------------------------- |
| **Mechanical RBAC Engine**                             |     **Completed**      | `olt/scripts/src/policy/rbac-engine.ts`                | `tests/unit/cli/shell-interlock.test.ts` (12 passing tests)       |
| **Shielded Shell Execution**                           |     **Completed**      | `olt/scripts/src/cli/commands/shell.ts`                | `tests/unit/cli/shell-interlock.test.ts`                          |
| **Auto-Gate Proof Attachment**                         |     **Completed**      | `olt/scripts/src/cli/commands/run-ops.ts:430-438`      | `runExecCommand` auto-calls `attachGateResult` & `finishTask`     |
| **Fast Incremental Verification (`task:check`)**       |     **Completed**      | `olt/scripts/src/cli/commands/task-check.ts`           | `tests/unit/cli/task-check.test.ts` (8 passing tests)             |
| **Durable Evidence Receipts**                          |     **Completed**      | `evidence/cmd-*.json`, `evidence/mechanic-report.json` | Tested in `shell-interlock.test.ts` and `task-check.test.ts`      |
| **Live Telemetry Stream Logging**                      |     **Completed**      | `olt/scripts/src/reporting/telemetry-stream.ts`        | Verified in standalone and capsule execution                      |
| **AutoReceiptLogger Basic Event Logging**              |     **Completed**      | `olt/scripts/src/engine/runner/auto-receipt.ts`        | `tests/unit/runner/auto-receipt.test.ts` (2 passing tests)        |
| **AutoReceiptLogger Capsule State Transaction Bridge** | **Pending Refinement** | `olt/scripts/src/engine/runner/auto-receipt.ts`        | Integrate `transact` for dual `state.json` + `events.jsonl` write |

---

## 4. Implementation Tasks & Verification

### Task 1: AutoReceiptLogger Implementation & Event Logging

**Files:**

- Implementation: `olt/scripts/src/engine/runner/auto-receipt.ts`
- Unit Test: `tests/unit/runner/auto-receipt.test.ts`

- [x] **Step 1: Write unit test for `AutoReceiptLogger` event formatting and hashing**
- [x] **Step 2: Implement `AutoReceiptLogger.recordReceipt` with SHA-256 stdout hashing**
- [x] **Step 3: Run unit tests to verify event creation and payload matching**
- [x] **Step 4: Commit**

```bash
bun test tests/unit/runner/auto-receipt.test.ts
git add olt/scripts/src/engine/runner/auto-receipt.ts tests/unit/runner/auto-receipt.test.ts
git commit -m "feat(runner): implement AutoReceiptLogger for transparent gate proof recording"
```

---

### Task 2: Shielded Shell Command & RBAC Interlock Enforcement

**Files:**

- Implementation: `olt/scripts/src/cli/commands/shell.ts`, `olt/scripts/src/policy/rbac-engine.ts`
- Unit Test: `tests/unit/cli/shell-interlock.test.ts`

- [x] **Step 1: Implement `verifyCommandAuthorization` with persona checks and subshell guards**
- [x] **Step 2: Implement `shellCommand` supporting standalone and capsule-bound modes**
- [x] **Step 3: Generate cryptographic receipts (`cmd-*.json`) in `evidence/` and emit telemetry**
- [x] **Step 4: Verify test suite passes with 100% assertions**

```bash
bun test tests/unit/cli/shell-interlock.test.ts
git add olt/scripts/src/cli/commands/shell.ts olt/scripts/src/policy/rbac-engine.ts tests/unit/cli/shell-interlock.test.ts
git commit -m "feat(cli): implement shielded shell command with RBAC authorization and cryptographic receipts"
```

---

### Task 3: Automatic Gate Proof Attachment in `run:exec`

**Files:**

- Implementation: `olt/scripts/src/cli/commands/run-ops.ts`, `olt/scripts/src/integration/record-command.ts`

- [x] **Step 1: Integrate `attachGateResult` and `finishTask` hooks into `runExecCommand`**
- [x] **Step 2: Verify zero-friction gate satisfaction upon successful command execution**
- [x] **Step 3: Enforce screenshot ingestion for UI/DOM verification runs**
- [x] **Step 4: Commit & Sync**

```bash
git add olt/scripts/src/cli/commands/run-ops.ts olt/scripts/src/integration/record-command.ts
git commit -m "feat(cli): integrate automatic gate proof attachment and task completion into run:exec"
```

---

### Task 4: In-Process Incremental Verification (`task:check`)

**Files:**

- Implementation: `olt/scripts/src/cli/commands/task-check.ts`
- Unit Test: `tests/unit/cli/task-check.test.ts`

- [x] **Step 1: Implement targeted TypeScript typechecking (`performIncrementalTypecheck`)**
- [x] **Step 2: Implement AST static invariant analysis (`performAstLintCheck` 0 any, 0 suppressions)**
- [x] **Step 3: Implement evidence report generation (`mechanic-report.json`)**
- [x] **Step 4: Verify end-to-end task check test suite**

```bash
bun test tests/unit/cli/task-check.test.ts
git add olt/scripts/src/cli/commands/task-check.ts tests/unit/cli/task-check.test.ts
git commit -m "feat(cli): implement fast incremental verification tooling with task:check"
```

---

### Task 5 (Future Refinement): AutoReceiptLogger State Transaction Bridge

**Files:**

- Modify: `olt/scripts/src/engine/runner/auto-receipt.ts`
- Modify: `olt/scripts/src/cli/commands/task-check.ts`
- Test: `tests/unit/runner/auto-receipt.test.ts`

- [x] **Step 1: Extend `AutoReceiptLogger.recordReceipt` to support optional state transaction (`transact`) when capsule ledger is active**
- [x] **Step 2: Wire `taskCheckCommand` to record verification passes through `AutoReceiptLogger`**
- [x] **Step 3: Run test suite to verify dual state and event updates**
- [x] **Step 4: Commit**

```bash
bun test tests/unit/runner/auto-receipt.test.ts tests/unit/cli/task-check.test.ts
git add olt/scripts/src/engine/runner/auto-receipt.ts olt/scripts/src/cli/commands/task-check.ts tests/unit/runner/auto-receipt.test.ts
git commit -m "refactor(runner): bridge AutoReceiptLogger with capsule state transactions and task:check"
```

---

## 5. Empirical Validation Evidence

All core implementations across Plan 24 have been empirically validated in the local workspace:

1. **AutoReceiptLogger Suite:**

   ```
   tests/unit/runner/auto-receipt.test.ts:
   (pass) AutoReceiptLogger > can be instantiated
   (pass) AutoReceiptLogger > records command receipt directly into capsule state
   (pass) AutoReceiptLogger > records command receipt via state transaction when capsule ledger is active
   3 pass, 0 fail (21 expect calls)
   ```

2. **Shell Interlock & Scope Suite:**

   ```
   tests/unit/cli/shell-interlock.test.ts:
   (pass) CLI Shell Interlock > instantly blocks un-targeted whole-repo test run for implementer
   (pass) CLI Shell Interlock > instantly blocks cognitive validator from running any shell commands
   (pass) CLI Shell Interlock > instantly blocks unshielded subshells and chaining attempts
   (pass) CLI Shell Interlock > executes authorized diagnostic command and outputs cryptographic receipt
   (pass) CLI Shell Interlock > executes command under capsule record with --run, --task, --wave, and --gate
   (pass) CLI Shell Interlock > Static Invariant Verification: Zero TypeScript any & Zero Suppressions
   12 pass, 0 fail (56 expect calls)
   ```

3. **Incremental Verification Suite (`task:check`):**

   ```
   tests/unit/cli/task-check.test.ts:
   (pass) task:check > isSupportedSourceFile identifies valid extensions
   (pass) task:check > collectSourceFilesRecursively collects nested files
   (pass) task:check > performIncrementalTypecheck checks files accurately
   (pass) task:check > performAstLintCheck verifies AST invariants
   (pass) task:check > taskCheckCommand runs full verification end to end
   8 pass, 0 fail (46 expect calls)
   ```

4. **Total Verified Assertions:** **23 tests, 0 failures, 123 expect calls** executing across runner, CLI, and interlock systems.

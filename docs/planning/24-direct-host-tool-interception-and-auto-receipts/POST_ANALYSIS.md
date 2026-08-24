# Plan 24 Post-Analysis: Rigorous Product Audit

## Executive Summary

An evidence-based architectural and code audit was conducted on Plan 24 (Direct Host Tool Interception & Automatic Command Receipt Logging). While the core command execution, RBAC verification, and incremental checking CLI commands have been successfully introduced, the central artifact (`AutoReceiptLogger`) is completely stranded. It lacks integration with the command executors, and it fails to update the capsule state ledger (`state.json`), meaning the system does not yet achieve the goal of transparent, automatic state logging without friction.

---

## 1. AutoReceiptLogger Implementation

**Status:** Partially Implemented (Missing Integration & Stateful Ledger Logging)

- **Evidence:**
  - The file exists at `olt/scripts/src/engine/runner/auto-receipt.ts` alongside its test `tests/unit/runner/auto-receipt.test.ts`.
  - The interface matches the spec (`public static recordReceipt(capsuleRoot: string, opts: CommandReceiptOptions): void`).
- **Code Gaps:**
  - **No `state.json` logging:** The implementation at `auto-receipt.ts:27` only appends to `events.jsonl` using `appendFileSync`. It fundamentally ignores the requirement to record the receipt into the `state.json` ledger.
  - **Orphaned Component:** A codebase-wide search reveals `AutoReceiptLogger.recordReceipt` is never called outside of its unit test. It is entirely disconnected from the actual `task:check`, `run:exec`, and `shell` commands.

## 2. Shielded Shell and Command Execution

**Status:** Implemented (but diverges from using AutoReceiptLogger)

- **Evidence:**
  - `harness.ts shell` is implemented via `shellCommand` in `olt/scripts/src/cli/commands/shell.ts`.
  - RBAC is correctly enforced using `verifyCommandAuthorization` (`shell.ts:64`).
  - `run:exec` is fully implemented in `olt/scripts/src/cli/commands/run-ops.ts:348` via `runExecCommand`.
  - Execution receipts (including cryptographically signed `receipt_sha256` and `stdout_sha256`) are generated properly.
- **Code Gaps:**
  - The command execution pathways use `runAndRecordCommand` (`shell.ts:95`) or write receipts directly to `evidence/cmd-*.json` (`shell.ts:125`, `shell.ts:205`). They emit telemetry but bypass `AutoReceiptLogger` completely, meaning the spec's intended unified interception point is ignored.

## 3. Incremental Verification Tooling (`task:check`)

**Status:** Implemented (Missing Ledger Logging)

- **Evidence:**
  - Fast incremental checking is robustly implemented in `olt/scripts/src/cli/commands/task-check.ts`.
  - Features intelligent scope discovery (`resolveTargetFiles`), `performIncrementalTypecheck` (0 any), and AST enforcement (`performAstLintCheck` 0 suppressions).
- **Code Gaps:**
  - Upon completion, `task:check` writes its receipt exclusively to the disk at `evidence/mechanic-report.json` (`task-check.ts:771-790`).
  - It completely fails to invoke `AutoReceiptLogger` or `transact`. Consequently, the execution of a `task:check` does not result in a unified `events.jsonl` or `state.json` record.

## 4. Friction Elimination (`[GATE_NOT_PROVED]` Traps)

**Status:** Partially Implemented (Systemic Risk Remains)

- **Evidence:**
  - Providing the `shell` and `task:check` commands reduces the need for agents to write ad-hoc `.js` scratch scripts to prove gates, which was the primary developer/agent experience goal.
- **Code Gaps:**
  - Because `task:check` bypasses `state.json` and `events.jsonl`, if the orchestrator/coordinator relies strictly on the structured ledger to determine gate satisfaction (the `[GATE_NOT_PROVED]` logic), agents running `task:check` will generate a `mechanic-report.json` but still hit the trap because the state ledger remains unaware of the verification pass.

---

## Conclusion & Required Fixes

To fully satisfy Plan 24:

1. Update `AutoReceiptLogger` to use `transact` so that it atomically writes to both `state.json` and `events.jsonl`.
2. Hook `AutoReceiptLogger` into `task:check` (at the end of `taskCheckCommand`) and into standalone `shell` command flows.
3. Ensure the ledger formally recognizes `mechanic-report` equivalents as valid gate proofs to permanently eliminate `[GATE_NOT_PROVED]` friction.

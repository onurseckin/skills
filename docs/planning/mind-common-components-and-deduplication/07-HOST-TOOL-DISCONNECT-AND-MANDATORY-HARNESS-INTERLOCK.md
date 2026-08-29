# Blueprint 07: Host-Tool Bypass Prevention, Shielded Shell Execution & Hierarchical Dispatch Interlock

**Domain:** `authority` / `communication` / `capsule` / `governance` / `security`  
**Priority:** `CRITICAL`  
**Status:** `READY_FOR_EXECUTION`  
**Tracking ID:** `MIND-DEDUP-HOST-INTERLOCK-07`

---

## Level 1: Executive Context & Problem Statement

Across multi-agent execution in host environments (e.g. Antigravity CLI), critical host bypass and execution drift defects occur:

1. **Host-Native Tool Bypass**: Subagents naturally default to in-memory host tools (`send_message`, unshielded shell calls, direct file edits), bypassing the file-backed `.olt/mailboxes/` IPC bus and `.olt/capsules/` ledger.
2. **Unshielded Command Execution Drift**: Subagents executing shell commands directly via host `run_command` often run un-targeted whole-suite test runs (`bun test`, `npm test`), unauthorized git mutations, or arbitrary bash scripts, bypassing Harness CLI's deterministic RBAC security engine.
3. **Vague Conversational Parent-to-Child Dispatch**: When higher-tier agents spawn child subagents, they often pass vague conversational descriptions rather than strict, fully hydrated YAML manifest contracts and **Zero-Exploration Exact-Anchor Briefings (`task:brief`)**, leading to exploratory token burning and out-of-scope edits.

---

## Level 2: Target Architecture & ASCII Unicode Topology

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│          MANDATORY HARNESS IPC, SHIELDED SHELL & DISPATCH INTERLOCK          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [ Tier N Parent Supervisor Dispatch Boundary ]                             │
│    • Injects complete YAML manifest rules + 1-Shot Zero-Exploration Brief   │
│    • Declares exact disjoint write scope, line anchors, symbols, and tests  │
│                                           │                                 │
│                                           ▼                                 │
│  [ Tier N+1 Child Subagent Execution Controls ]                             │
│    • Host `send_message`: STRICTLY FORBIDDEN (Must use `harness msg:send`)  │
│    • Turn 1 Disk Registration: MUST execute `harness task:claim --run <id>` │
│    • Command Execution: MUST route via Shielded Shell RBAC Engine           │
│      (`bun harness.ts shell --actor <id> -- <cmd>`)                         │
│                                           │                                 │
│                                           ▼                                 │
│  [ RBAC Authority & Shielded Shell Engine (`verifyCommandAuthorization`) ]  │
│    • Cognitive Validators: Hard-locked to 0 commands (can_execute_shell: 0) │
│    • Implementers: Leased file-scoped tests only (`bun test <path.test.ts>`)|
│    • Forbidden Verbs: `^npm test$`, `^bun test$`, `git checkout`, `git reset│
│    • Cryptographic Audit: Signs execution receipts into `evidence/`         │
│                                           │                                 │
│                                           ▼                                 │
│  [ Mechanical Gate & Doctor Auto-Healing Engine ]                           │
│    • `task:review`: Rejects unleased or unshielded task submissions.        │
│    • `doctor`: Audits `.olt/mailboxes/`, `.olt/capsules/`, and shell logs.  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Level 3: Disjoint Scope Boundaries

### Write Scope

- `olt/agents/*.yaml` (All 28 agent manifest prompts updated with strict bypass bans, RBAC rules, and exact dispatch templates)
- `olt/scripts/src/authority/rbac/command-authorizer.ts` (Shielded shell & RBAC authorizer)
- `olt/scripts/src/authority/manifest/agent-manifest-parser.ts` (Manifest parser validation)
- `olt/scripts/src/reporting/doctor/mailbox-health-engine.ts` (Mailbox health checks)
- `olt/scripts/src/reporting/doctor/command-lock-engine.ts` (Command lock verification)
- `olt/scripts/src/workflow/lease/guard.ts` (Capsule lease verification interlock)
- `tests/unit/authority/rbac/command-authorizer.test.ts` (RBAC unit tests)
- `tests/unit/authority/manifest-interlock.test.ts` (Manifest prompt validation tests)

### Read-Only Scope

- `olt/scripts/src/core/shared/paths.ts` (Canonical path constants)
- `olt/scripts/src/communication/mailbox/` (Mailbox dispatcher)

---

## Level 4: Atomic Implementation Tasks Matrix

| Task ID            | Target File Path                                            | Exported Typed Symbols / Manifest Directives                                                                                                                                                | Deliverable & Contract                                                                                                                                         |
| :----------------- | :---------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`task-lock-01`** | `olt/agents/*.yaml` (All 28 Manifests)                      | `communication_contract`, `forbid_native_messaging: true`, `command_authority`                                                                                                              | Mandate across all 28 manifests: ban `send_message`; force all inter-agent traffic through `bun harness.ts msg:send`; enforce strict role command boundaries.  |
| **`task-lock-02`** | `olt/scripts/src/authority/rbac/command-authorizer.ts`      | `verifyCommandAuthorization(actorRole: string, cmd: readonly string[]): CommandAuthResult`<br>`executeShieldedCommand(actorId: string, cmd: readonly string[]): Promise<CommandExecResult>` | Hybrid static + dynamic deny-list compiler. Blocks whole-suite test runs and git mutations; hard-locks validators to 0 commands ($\le 240$ lines, 0 comments). |
| **`task-lock-03`** | `olt/agents/orchestrator.yaml` & `coordinator.yaml`         | `dispatch_contract: "zero_exploration_exact_anchor"`                                                                                                                                        | Require parent supervisors to hydrate child dispatches with exact file paths, line ranges (`StartLine`, `EndLine`), symbols, and file-scoped test commands.    |
| **`task-lock-04`** | `olt/agents/implementer.yaml` & `worker.yaml`               | `mandatory_turn1_actions: ["task:claim"]`                                                                                                                                                   | Mandate Turn 1 `bun harness.ts task:claim` before any file editing tool is invoked.                                                                            |
| **`task-lock-05`** | `olt/scripts/src/workflow/lease/guard.ts`                   | `verifyDiskCapsuleLease(runId: string, taskId: string): LeaseGuardResult`                                                                                                                   | Reject task reviews and validation approvals if `.olt/capsules/<run_id>/state.json` lacks an active on-disk lease ($\le 220$ lines, 0 comments).               |
| **`task-lock-06`** | `olt/scripts/src/reporting/doctor/command-lock-engine.ts`   | `checkCommandLockIntegrity(oltDir: string): DoctorCheckEngineResult`                                                                                                                        | `doctor` check asserting cognitive validators have executed 0 commands and implementers ran only file-scoped tests ($\le 200$ lines, 0 comments).              |
| **`task-lock-07`** | `olt/scripts/src/reporting/doctor/mailbox-health-engine.ts` | `checkMailboxDiskActivity(oltDir: string): DoctorCheckEngineResult`                                                                                                                         | `doctor` check asserting `.olt/mailboxes/` contains live inboxes and valid HMAC signatures for active agents ($\le 240$ lines, 0 comments).                    |

---

## Level 5: Falsifiable Gate Verification Commands

1. **RBAC Command Authorization Unit Test**:
   ```bash
   bun test tests/unit/authority/rbac/command-authorizer.test.ts
   ```
2. **Manifest Interlock & Dispatch Contract Verification**:
   ```bash
   bun test tests/unit/authority/manifest-parser.test.ts
   ```
3. **Capsule Lease Guard Gate**:
   ```bash
   bun test tests/unit/workflow/lease/guard.test.ts
   ```
4. **Master Doctor Command Lock & Mailbox Diagnostic**:
   ```bash
   bun harness.ts doctor
   ```
5. **AST Static Purity & Zero-Comments Gate**:
   ```bash
   bun harness.ts task:check --file olt/scripts/src/authority/rbac/command-authorizer.ts olt/scripts/src/workflow/lease/guard.ts olt/scripts/src/reporting/doctor/command-lock-engine.ts
   ```

---

## Level 6: Strict Invariant Enforcement

1. **Zero Code Comments**: 0 comments (`//`, `/* */`, `/** */`) in all `.ts` files.
2. **Strict Density Budgets**: $\le 300$ physical lines per file, $\le 10$ files per directory.
3. **Explicit Named Facade Exports**: 100% named exports in `index.ts` facades (0 wildcard `export *`).
4. **Zero Backwards-Compatibility Shims**: No stub forwarding files; clean, direct imports.
5. **Cognitive Hard-Lock ($\mathcal{C}_7$)**: Cognitive Validators strictly locked out of command execution (0 `run:exec`, 0 tests, 0 bash scripts).
6. **No Defect-Prefix Files**: 0 `defect-*.ts` or `fb-*.ts` files in source or test trees.

---

## Level 7: Sequential Execution Order & Critical Path DAG

```text
[task-lock-01 & 03 & 04: Manifest Prompt Contracts & Dispatch Hydration]
                                  │
                                  ▼
[task-lock-02: RBAC Command Authorizer] ──► [task-lock-05: Capsule Lease Guard]
                                  │
                                  ▼
[task-lock-06: Doctor Command Lock Audit] ──► [task-lock-07: Doctor Mailbox Health Audit]
                                  │
                                  ▼
[Gate Verification: bun test & bun harness.ts doctor]
                                  │
                                  ▼
[Atomic Landing: git commit ──► git push origin main ──► global skill sync]
```

---

## Level 8: Exhaustive Traceability Matrix

| Backlog / Defect ID                     | Task ID             | Target Component                                   | Gate Test Suite                                        | Invariant Status                       |
| :-------------------------------------- | :------------------ | :------------------------------------------------- | :----------------------------------------------------- | :------------------------------------- |
| `fb-1788021500000-capsule-connectivity` | `task-lock-04 & 05` | `olt/agents/*.yaml`, `src/workflow/lease/`         | `tests/unit/workflow/lease/guard.test.ts`              | Complete ($\le 220$ lines, 0 comments) |
| `fb-1788021600000-mandatory-mailbox`    | `task-lock-01 & 07` | `olt/agents/*.yaml`, `src/reporting/doctor/`       | `tests/unit/doctor/mailbox-health-engine.test.ts`      | Complete ($\le 240$ lines, 0 comments) |
| `defect-unshielded-code-running-drift`  | `task-lock-02 & 06` | `src/authority/rbac/`, `src/reporting/doctor/`     | `tests/unit/authority/rbac/command-authorizer.test.ts` | Complete ($\le 240$ lines, 0 comments) |
| `defect-vague-conversational-dispatch`  | `task-lock-03`      | `olt/agents/orchestrator.yaml`, `coordinator.yaml` | `tests/unit/authority/manifest-parser.test.ts`         | Complete ($\le 200$ lines, 0 comments) |

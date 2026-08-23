# 03. Bearer Token Protocol & Dispatch Security

[⬅ Previous: Role Contracts & Task Execution Briefs](./02-immutable-role-packets.md) | [Master Table of Contents](../README.md) | [Next: Chapter 05 — Leases & Heartbeats ➡](../05-task-execution/01-leasing-and-heartbeats.md)

---

## 🛡️ Multi-Agent Threat Model & Security Philosophy

Autonomous multi-agent systems introduce security vulnerabilities that traditional single-threaded developer tools never encounter:

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                               MULTI-AGENT ATTACK VECTORS & THREATS                               │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                  │
│  1. Agent Spoofing & Identity Tampering:                                                         │
│     • Agent A attempts to submit tasks, report fake test receipts, or approve reviews on behalf  │
│       of Agent B without possessing valid authority.                                             │
│                                                                                                  │
│  2. Zombie Worker State Corruption:                                                              │
│     • A slow or crashed worker whose lease expired wakes up and writes stale, conflicting        │
│       results over a newly assigned worker's active worktree.                                    │
│                                                                                                  │
│  3. Shell Escapes & Command Injection:                                                           │
│     • Agents construct unshielded shell strings with backdoors, command chaining (&&, ||, ;, |), │
│       inline code evaluators (node -e, python -c), or un-targeted whole-suite test runs.         │
│                                                                                                  │
│  4. Context Pollution & Broad Filesystem Squeezing:                                              │
│     • Unconstrained agents scan hundreds of irrelevant files across the repo, exhausting context │
│       windows, inducing hallucination, and generating un-audited cross-domain edits.             │
│                                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

`olt` neutralizes these threats through a four-pillar security architecture:

1. **Cryptographic One-Time Bearer Token Protocol:** Zero plaintext persistence, capability-scoped tokens, SHA-256 digest validation.
2. **Hybrid Static + Dynamic RBAC Deny-List Engine:** Multi-layer command authorization (`verifyCommandAuthorization`) blocking unshielded subshells, un-targeted tests, and git mutations.
3. **Shielded Shell Gate:** Non-interactive, direct-argv command execution (`bun harness.ts shell`) with signed evidence receipts.
4. **Smart Neighborhood Read Scope Guard:** Bounded directory inspection and explicit, audited expansion (`scope:expand`).

---

## 🔑 The Cryptographic Bearer Token Protocol

To guarantee that only the currently authorized agent can modify task state or submit verification reviews, `olt` employs a **One-Time Bearer Token Capability Model**.

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                           BEARER TOKEN GENERATION & VERIFICATION                                 │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                  │
│  [ CAPABILITY DISPATCH: task:claim / task:validate-start / plan:validate-start / critic:start ]  │
│                                  │                                                               │
│                                  ▼                                                               │
│  [ Secure Cryptographic Random Generation ]                                                      │
│    • Generates 256 bits of entropy: `randomBytes(32).toString("base64url")`                      │
│    • Computes SHA-256 digest: `createHash("sha256").update(token).digest("hex")`                 │
│                                  │                                                               │
│                                  ├───► Emitted ONCE to Process Stdout in Markdown Brief          │
│                                  │     (Delivered strictly into Subagent Working Memory)         │
│                                  │                                                               │
│                                  └───► Persisted to Disk in `state.json` & `events.jsonl`        │
│                                        (ONLY SHA-256 Digest `token_digest` is Stored)            │
│                                                                                                  │
│  [ PROTECTED MUTATION INVOCATION: task:submit / task:review / task:heartbeat / critic:review ]   │
│    • Caller passes plaintext `--token <token>` via CLI argument                                  │
│    • Harness hashes supplied token and matches against recorded `token_digest`                   │
│    • Exact SHA-256 match ──► Mutation Authorized                                                 │
│    • Mismatch / Expired  ──► Immediate Rejection (`lease identity or token is invalid`)           │
│                                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Core Token Invariants

1. **Stdout Emission Exactly Once:** Plaintext tokens are returned once in standard output when a lease or review is created. They are never reprinted by status commands.
2. **Digest-Only Persistence:** The harness **NEVER** writes plaintext bearer tokens to disk, log files, event streams, git commits, or reports. Only the SHA-256 digest (`token_digest`) is recorded in `state.json`, `events.jsonl`, and `reports/`.
3. **Mandatory Protected Mutations:** Every state transition that alters task lifecycle or sign-off authority requires `--token`:
   - `task:heartbeat`, `task:submit`, `task:release`
   - `task:probe`, `task:review`, `task:reject`
   - `plan:review`
   - `critic:review`, `critic:reject`
   - `branch:open`, `branch:submit`, `branch:collect`, `branch:abandon`
4. **Zero Regeneration:** If an agent process crashes and loses its in-memory token, the harness cannot recover or recalculate it. The task must be voluntarily released or reclaimed via timeout recovery.

### The 4 Distinct Token Families

Bearer tokens are strictly capability-segregated across four distinct families. A token minted for one family cannot be used to authenticate actions in another:

| Token Family              | Minted By                 | Bound To                                       | Authorized Capabilities                                        |
| :------------------------ | :------------------------ | :--------------------------------------------- | :------------------------------------------------------------- |
| **Lease Token**           | `task:claim`, `queue:pop` | Task Attempt (`state.tasks[id].lease`)         | `task:heartbeat`, `task:submit`, `task:release`, `branch:open` |
| **Validation Token**      | `task:validate-start`     | Task Validation (`state.tasks[id].validation`) | `task:probe`, `task:review`, `task:reject`                     |
| **Plan-Validation Token** | `plan:validate-start`     | Graph Revision (`state.plan_validation`)       | `plan:review` (Graph topology sign-off)                        |
| **Critic Token**          | `critic:start`            | Capsule Completion (`state.completion_review`) | `critic:review`, `critic:reject`                               |

---

## 🚦 Hybrid Static + Dynamic RBAC Deny-List Engine

Command execution within `olt` is governed by a **Hybrid Static + Dynamic Role-Based Access Control (RBAC)** engine (`verifyCommandAuthorization`). Before any command is executed, the engine evaluates both static system invariants and repository-level dynamic security policies.

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                            HYBRID RBAC DENY-LIST VERIFICATION ENGINE                             │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                  │
│  Incoming Command (`bun harness.ts shell --actor <agent> -- <command>`)                          │
│                                  │                                                               │
│                                  ▼                                                               │
│  [ STEP 1: Unshielded Subshell & Command Chaining Gate ]                                         │
│    • Checks for forbidden shells (`sh`, `bash`, `zsh`), evaluators (`eval`, `node -e`),          │
│      and chaining operators (`&&`, `||`, `;`, `|`, `&`)                                          │
│    • Violation ──► Blocked with `UNSHIELDED_COMMAND_BLUNDER`                                     │
│                                  │                                                               │
│                                  ▼                                                               │
│  [ STEP 2: Cognitive Validator Hard-Lock Interlock ]                                             │
│    • Checks `can_execute_shell === false` (validator, critic, planner)                           │
│    • Violation ──► Blocked with `PERMISSION_DENIED` (0 commands authorized)                      │
│                                  │                                                               │
│                                  ▼                                                               │
│  [ STEP 3: Un-Targeted Test Suite Detection (Implementer / Worker) ]                             │
│    • Detects bare whole-repo test runs across 15+ test frameworks (`bun test`, `pytest`, etc.)   │
│    • Violation ──► Blocked with `INVALID_SCOPE` (Must provide targeted file argument)            │
│                                  │                                                               │
│                                  ▼                                                               │
│  [ STEP 4: Static & Dynamic Forbidden Regex Matching ]                                           │
│    • Checks static role rules (e.g. implementers blocked from `git commit`, `git push`)          │
│    • Checks dynamic repo policy rules (`policy.forbidden_commands`)                             │
│    • Violation ──► Blocked with `PERMISSION_DENIED`                                              │
│                                  │                                                               │
│                                  ▼                                                               │
│  [ AUTHORIZED: Command Dispatched via Direct Exec with Signed Evidence Receipt ]                 │
│                                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Static Role Restrictions

```typescript
export const STATIC_SUPERVISOR_FORBIDDEN_PATTERNS: readonly RegExp[] = [
  /^git\s+(commit|push|reset|checkout\s+-b|merge|rebase)/i,
  /write_to_file/i,
  /replace_file/i,
  /^bun\s+test\b/i,
  /^npm\s+test\b/i,
  /^vitest\b/i,
  /^pytest\b/i,
  /^cargo\s+test\b/i,
];

export const STATIC_IMPLEMENTER_FORBIDDEN_PATTERNS: readonly RegExp[] = [
  /^git\s+(commit|push|reset|checkout(\s+-b)?|rebase|merge)/i,
  /^bun\s+harness.*task:review/i,
  /^bun\s+harness.*run:complete/i,
  /^bun\s+harness.*mind:/i,
];
```

### Un-Targeted Test Suite Prevention (`isUntargetedTestCommand`)

A frequent failure mode of worker agents is running the entire repository test suite (e.g. `bun test` or `pytest`) on every minor edit. In large repositories, this wastes massive CPU time, causes timeout flakes, and leaks cross-task test failures into the worker's context.

The RBAC engine intercepts bare test runner commands across 15+ ecosystems and enforces targeted file arguments:

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                            UN-TARGETED TEST RUNNER DETECTION MATRIX                              │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                  │
│  BLOCKED (Un-targeted):                   ALLOWED (Targeted):                                    │
│  • `bun test`                             • `bun test tests/unit/auth.test.ts`                   │
│  • `npm test`                             • `npm test -- tests/unit/auth.test.ts`                │
│  • `pytest -v -s`                         • `pytest tests/unit/test_auth.py`                     │
│  • `cargo test --all`                     • `cargo test -- tests/unit/test_auth.rs`              │
│  • `go test ./...`                        • `go test ./pkg/auth/auth_test.go`                    │
│  • `vitest run`                           • `vitest run src/auth/jwt.spec.ts`                    │
│  • `dotnet test`                          • `dotnet test Tests/AuthTests.cs`                     │
│                                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🛡️ The Shielded Shell Gate (`bun harness.ts shell`)

To eliminate subshell vulnerabilities, command injection, and interactive prompt hangs, all agent shell executions run through the **Shielded Shell Gate**:

```bash
bun harness.ts shell --actor worker-1 -- bun test tests/unit/auth.test.ts
```

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                 SHIELDED SHELL GATE PROPERTIES                                   │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                  │
│  1. Direct Argv Execution (No Shell Interpolation):                                              │
│     • Uses `Bun.spawn` / `node:child_process` with raw argv arrays.                              │
│     • Shell meta-characters ($, `, >, <, ;) are treated as literal arguments, not syntax.       │
│                                                                                                  │
│  2. Interactive Prompt Immunity (stdin: /dev/null):                                             │
│     • Standard input is explicitly closed. If a command prompts for confirmation (y/N) or        │
│       passwords, it fails immediately instead of hanging the agent indefinitely.                 │
│                                                                                                  │
│  3. Cryptographic Signed Evidence Receipts:                                                      │
│     • Every execution captures stdout, stderr, exit code, duration, and actor ID.                │
│     • Receipts are SHA-256 hashed and stored under `.olt/capsules/<run-id>/evidence/`.               │
│                                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Handling Command Chaining Violations (`UNSHIELDED_COMMAND_BLUNDER`)

If an agent attempts to execute chained commands:

```bash
bun harness.ts shell --actor worker-1 -- echo "done" && git push
```

The RBAC engine intercepts the operator and returns a structured refusal:

```text
[UNSHIELDED_COMMAND_BLUNDER] Direct subshell invocation, evaluator, or command chaining blocked: 'echo done && git push'.
All commands must be executed as direct argv arrays via: 'bun harness.ts shell --actor <agent_id> -- <command>'.
Subshells ('sh -c', 'bash -c', 'eval') and command chaining ('&&', '||', ';', '|') are strictly prohibited.
```

---

## 🔍 Smart Neighborhood Read Scope Guard (`scope:expand`)

While write operations are strictly confined to leased write scopes, subagents frequently need to inspect related files (type definitions, utility functions, configuration files) to perform their work.

If read access is completely unrestricted, agents scan hundreds of unrelated files, polluting their context window. If read access is overly restrictive, agents fail because they cannot inspect interfaces.

`olt` resolves this with the **Smart Neighborhood Read Scope Guard** (`checkReadScopeAuthorization`).

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                             SMART NEIGHBORHOOD READ SCOPE HIERARCHY                              │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                  │
│  1. Always-Accessible Global Files:                                                              │
│     • `package.json`, `tsconfig*.json`, `bun.lockb`, `.gitignore`, `olt/policy.json`             │
│     • Shared type declarations in `contracts/`, `types/`, `shared/`                              │
│                                                                                                  │
│  2. Declared Scopes:                                                                             │
│     • Files explicitly named in the task's `write_scope` or `allowed_read_scope`                 │
│                                                                                                  │
│  3. Smart Neighborhood Heuristic (Max Depth = 2):                                                │
│     • Files sharing the same directory ancestor within 2 path levels                             │
│     • Enforces root-boundary crossover prevention (must share at least 1 top-level folder)       │
│                                                                                                  │
│  4. Dynamic Audited Scope Expansion (`scope:expand`):                                            │
│     • Legitimate out-of-neighborhood reads are explicitly appended to the agent manifest        │
│                                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Dynamically Expanding Read Scope (`scope:expand`)

When an implementer needs to inspect an external module outside its neighborhood:

```bash
bun harness.ts scope:expand --actor worker-1 --read src/policy/repo-policy.ts
```

The harness validates the path, appends it to the agent's active `allowed_read_scope`, logs a telemetry event, and emits confirmation:

```markdown
### Read Scope Expanded for Actor: `worker-1`

- **Granted Path**: `src/policy/repo-policy.ts`
- **Active Read Scopes**: `src/auth/jwt.ts`, `src/policy/repo-policy.ts`
```

---

## ⏳ Lease Expiration, Stale Recovery & Orphan Quarantine

When a subagent crashes, loses connectivity, or exceeds its lease duration:

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                             STALE WORKER RECOVERY & QUARANTINE                                   │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                  │
│  1. Heartbeat Timeout:                                                                           │
│     • Leases expire after `default_lease_seconds` (default: 1800s) if no heartbeat is sent.      │
│                                                                                                  │
│  2. Recovery Sweep (`bun harness.ts recover`):                                                   │
│     • Coordinator reclaims expired tasks, invalidating the old `token_digest`.                   │
│     • Task status transitions to `retry_ready` (or `changes_requested` for repairs).             │
│                                                                                                  │
│  3. Late Submission Quarantine:                                                                  │
│     • If a zombie worker wakes up and calls `task:submit --token <old_token>`, the submission    │
│       is REJECTED.                                                                               │
│     • The late payload is safely quarantined under `.olt/capsules/<run-id>/evidence/orphans/`        │
│       without mutating active task state or corrupting git branches.                             │
│                                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 📚 Diátaxis Reference: Security Commands & Error Codes

### CLI Security Command Reference

| Command          | Key Flags                    | Security Enforcement                                               |
| :--------------- | :--------------------------- | :----------------------------------------------------------------- |
| `shell`          | `--actor <id> -- <cmd>`      | Enforces RBAC deny-list, blocks subshells/chaining, logs evidence. |
| `scope:expand`   | `--actor <id> --read <path>` | Audited dynamic expansion of allowed read neighborhood.            |
| `task:heartbeat` | `--task <id> --token <tok>`  | Renews lease deadline; requires matching token digest.             |
| `task:release`   | `--task <id> --token <tok>`  | Voluntarily yields lease back to queue.                            |
| `recover`        | `--actor <id>`               | Reclaims expired leases across the capsule.                        |

### Security Error Code Directory

| Error Code                   | Exit Code | Trigger Condition                                                              | Recommended Remediation                                                     |
| :--------------------------- | :-------- | :----------------------------------------------------------------------------- | :-------------------------------------------------------------------------- |
| `UNSHIELDED_COMMAND_BLUNDER` | 70        | Attempted subshell (`sh -c`, `bash -c`) or chaining (`&&`, `\|\|`, `;`, `\|`). | Pass raw argv to `bun harness.ts shell --actor <id> -- <argv>`.             |
| `PERMISSION_DENIED`          | 70        | Cognitive validator attempting shell execution, or supervisor running tests.   | Adhere to role invariants (Cognitive Validators must not execute commands). |
| `INVALID_SCOPE`              | 70        | Implementer running un-targeted full test suite (`bun test`, `pytest`).        | Provide targeted file argument (e.g. `bun test tests/unit/auth.test.ts`).   |
| `READ_SCOPE_EXCEEDED`        | 70        | Attempting to read a file outside declared neighborhood.                       | Call `bun harness.ts scope:expand --actor <id> --read <path>`.              |
| `PATH_SAFETY`                | 70        | Directory traversal attempting to escape repository root (`../`).              | Confine file paths within repository boundary.                              |
| `INVALID_TOKEN`              | 1         | Bearer token hash does not match recorded lease digest.                        | Verify token or request lease reclamation via `recover`.                    |

---

[⬅ Previous: Role Contracts & Task Execution Briefs](./02-immutable-role-packets.md) | [Master Table of Contents](../README.md) | [Next: Chapter 05 — Leases & Heartbeats ➡](../05-task-execution/01-leasing-and-heartbeats.md)

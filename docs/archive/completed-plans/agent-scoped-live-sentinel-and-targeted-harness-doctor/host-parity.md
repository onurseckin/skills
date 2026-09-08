# Universal Host Parity & Shell Interception Mechanics

> **Document:** `host-parity.md`  
> **Master Plan:** `docs/planning/agent-scoped-live-sentinel-and-targeted-harness-doctor/PLAN.md`  
> **Tracking ID:** `fb-agent-scoped-live-sentinel-doctor-interlock`

---

## 1. Universal Host-Agnostic Architecture

The Agent-Scoped Live Sentinel must run identically across all 4 canonical hosts:

- **`antigravity`**
- **`claude_code`**
- **`codex`**
- **`cursor`**

To achieve 100% host parity without host-proprietary locks, the Sentinel is built strictly on **Harness-Native Primitives**:

1. **Direct Argv Non-Interactive CLI:** Every diagnostic and interjection executes via deterministic CLI argv (`bun harness.ts ...`).
2. **POSIX File-Locked Mailbox IPC:** Message passing uses atomic filesystem append operations secured by POSIX `flock` and HMAC signatures.
3. **Shielded Shell Wrapper (`harness.ts shell`):** All subagent tool commands flow through the harness execution wrapper.

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                       CANONICAL 4-HOST INTEGRATION                          │
├───────────────┬────────────────────────────┬────────────────────────────────┤
│ Host          │ Shell Execution Layer      │ Sentinel Hook Binding          │
├───────────────┼────────────────────────────┼────────────────────────────────┤
│ antigravity   │ run_command via harness.ts │ PostToolUse hook & wrapper     │
│ claude_code   │ Bash tool via harness.ts   │ Post-command turn hook wrapper │
│ codex         │ Exec / terminal tool       │ Process wrapper hook           │
│ cursor        │ Terminal task integration  │ Background sentinel watcher    │
└───────────────┴────────────────────────────┴────────────────────────────────┘
```

---

## 2. Shielded Shell Execution Wrapper (`harness.ts shell`)

To prevent subagents from executing unmonitored commands or bypassing role boundaries, all command invocations are routed through the shielded shell wrapper:

```bash
bun harness.ts shell \
  --actor <agent-id> \
  --role <canonical-role> \
  --token <session-hmac> \
  -- <command-argv...>
```

### Execution Life Cycle

1. **Pre-Command Authorization (`verifyCommandAuthorization`):**
   - Validates role permissions (e.g., Cognitive Validators have `can_execute_shell: false` $\to$ instant mechanical block).
   - Rejects un-targeted whole-suite test runs (`bun test`, `vitest`).
2. **Command Dispatch:**
   - Executes command non-interactively using direct argv.
   - Captures stdout, stderr, exit code, and cryptographic SHA-256 of execution artifacts.
3. **Post-Command Sentinel Inspection (`sentinel:post-action`):**
   - Analyzes command exit code and working tree changes.
   - Triggers `doctor:agent --role <role> --agent <id>` if any boundary anomalies occur.
4. **Receipt Generation:**
   - Appends signed execution receipt to `.olt/telemetry.jsonl`.

---

## 3. POSIX Flock Mailbox Concurrency

The mailbox system operates without database dependencies or daemon processes, using atomic POSIX file locking:

```text
               Harness Interjection Dispatcher
                              │
                              ▼
        Acquire Exclusive POSIX Lock (flock -x)
           Path: .olt/mailboxes/<agent-id>/.lock
                              │
                              ▼
           Append Message to inbox.jsonl (Atomic)
                              │
                              ▼
         Release POSIX Lock & Touch .notify Sentinel
                              │
                              ▼
          Agent Subagent Reads Next Turn (flock -s)
```

### Invariants:

- **Lock Contention SLA:** Maximum flock wait time is bounded to 500ms; non-blocking lock failure retries with exponential backoff up to 3 attempts.
- **HMAC Authenticity:** Every message is cryptographically signed with the active run's ephemeral secret, preventing spoofed interjections.
- **Zero Polling Waste:** The existence of `.notify` allows event-driven wakeups on hosts supporting file watches, falling back to turn-boundary reads on passive hosts.

---

## 4. Session Authority & Anti-Impersonation

To ensure subagents cannot impersonate supervisors or other workers:

1. **Ephemeral Run Tokens:** During `agent:register`, the harness generates an actor-scoped HMAC session token stored in memory and capsule state.
2. **Process Ancestry Verification:** `harness.ts shell` inspects process parentage (PPID) against the registered agent process tree.
3. **Write Scope Verification:** Attempts to write to another agent's mailbox or modify files outside assigned `task.write_scope` result in an immediate `UNAUTHORIZED_ACTOR_MUTATION` violation.

---

## 5. Host Parity Verification Test Matrix

The Sentinel includes automated integration tests verifying identical behavior across all 4 environments:

- `tests/sentinel/host_parity_antigravity.test.ts`
- `tests/sentinel/host_parity_claude_code.test.ts`
- `tests/sentinel/host_parity_codex.test.ts`
- `tests/sentinel/host_parity_cursor.test.ts`

Each test verifies:

1. Zero-command hardlock for Cognitive Validators.
2. File-scoped test enforcement for Implementers.
3. Anti-serialization detection for Coordinators.
4. Correct scoped delivery to `.olt/mailboxes/<id>/` with 0 cross-tier leakage.

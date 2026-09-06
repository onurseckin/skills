# Agent-Scoped Live Shell Sentinel: Flow Topology, Gates & Resilience

## Levels 5, 6 & 7 System Dynamics, Acceptance Contracts & Security

> **Document Type:** Companion Architectural Specification  
> **Master Blueprint:** `docs/blueprints/agent-scoped-live-sentinel.md`  
> **Applicability:** All 20 Canonical Agent Roles across all 4 Canonical Hosts  
> **Tracking ID:** `bp-agent-scoped-live-sentinel-flow-and-gates`

---

## 1. Level 5: Interaction Dynamics & Flow Topology

The sentinel governs agent execution through deterministic lifecycle hooks, point-to-point mailbox IPC, and a progressive 3-strike escalation ladder.

```text
       Agent Turn Begins
               │
               ▼
   [Hook: sentinel:pre-action]   ──► Checks leased write scope & command auth
               │
          Action Executes (Tool invocation / shell command)
               │
               ▼
   [Hook: sentinel:post-action]  ──► Scans AST, line budget (<=300), fanout (<=10)
               │
               ▼
   [Hook: sentinel:turn-end]     ──► Executes: bun harness.ts doctor:agent
               │
               ▼
   Violation Detected? ───Yes────► Scoped Mailbox Delivery (.olt/mailboxes/<id>/)
               │ No                  (Evaluates Strike 1, 2, or 3)
               ▼
       Next Agent Turn
```

### 1.1 Turn Lifecycle Hook Mechanics

1. **`sentinel:pre-action` (In-Flight Interception):**
   - Intercepts outgoing tool calls before OS execution.
   - Verifies target file against `task.write_scope`. If outside scope, execution is blocked immediately in-memory with `PATH_SAFETY_VIOLATION`.
   - Passes shell commands to `verifyCommandAuthorization`. Cognitive Validators attempting shell execution receive an instant mechanical block.

2. **`sentinel:post-action` (State & AST Delta Audit):**
   - Inspects modified files immediately after tool completion.
   - Evaluates physical lines: triggers alarm if LOC $> 300$.
   - Runs fast AST parser for prohibited tokens (`: any`, `as any`, `@ts-ignore`, `@ts-expect-error`).

3. **`sentinel:turn-end` (Holistic Role Probe):**
   - Invokes `bun harness.ts doctor:agent --role <role> --agent <id>`.
   - Verifies sequential requirements (e.g. verifying that an Implementer executed a file-scoped unit test prior to `task:submit`, or that a UI Optical Validator reviewed screenshot images before approval).

### 1.2 Scoped Mailbox IPC Topology

Interjections are routed exclusively via atomic POSIX file-locked mailboxes without network daemons:

- **Mailbox Path:** `.olt/mailboxes/<agent-id>/inbox.jsonl`
- **Lock File:** `.olt/mailboxes/<agent-id>/.lock`
- **Notification Signal:** `.olt/mailboxes/<agent-id>/.notify`
- **Zero-Cross-Tier Routing Invariant:** Strikes 1 and 2 are delivered strictly to the target agent's private mailbox. Higher supervisory tiers (Coordinator, Orchestrator, Mind) remain completely unaware of local corrections.

### 1.3 The 3-Strike Progressive Escalation Ladder

To prevent infinite thrashing while maintaining autonomous recovery:

```text
┌─────────┬──────────┬────────────────────────────────────────────────────────┐
│ Strike  │ Severity │ Action & Mechanical Behavior                           │
├─────────┼──────────┼────────────────────────────────────────────────────────┤
│ 1: ADVISE│ Advisory │ Delivers structured markdown brief with exact copy-     │
│         │          │ paste CLI remediation. Non-blocking; agent fixes in turn│
├─────────┼──────────┼────────────────────────────────────────────────────────┤
│ 2: BLOCK │ Interlock│ Mechanically blocks non-remedial tool calls. Agent     │
│         │          │ must execute the remediation command before proceeding.│
├─────────┼──────────┼────────────────────────────────────────────────────────┤
│ 3: ESCAL│ Critical │ Freezes task lease (`task:freeze`). Routes encrypted    │
│         │          │ escalation packet to parent supervisor. Logs defect.   │
└─────────┴──────────┴────────────────────────────────────────────────────────┘
```

---

## 2. Level 6: Acceptance & Value Gates

### 2.1 Deterministic Doctor Probe Contract (`doctor:agent`)

The sentinel delegates all invariant verification to the canonical harness probe:

```bash
bun harness.ts doctor:agent \
  --role <canonical-role> \
  --agent <agent-id> \
  --task <task-id> \
  --run <capsule-name> \
  --format json
```

**Exit Codes:**

- `0`: HEALTHY (All role invariants satisfied).
- `1`: VIOLATION_DETECTED (Rule breach; returns structured violation payload).
- `2`: FATAL_CONFIGURATION_ERROR (Corrupted state, invalid token, or unknown role).

**Canonical JSON Response Schema:**

```json
{
  "status": "HEALTHY | VIOLATION_DETECTED",
  "agent_id": "implementer_core_01",
  "role": "implementer",
  "task_id": "task-042",
  "strike_count": 1,
  "violations": [
    {
      "code": "MISSING_FILE_SCOPED_TEST_RUN",
      "severity": "CRITICAL",
      "target_file": "src/engine/dag.ts",
      "message": "Source file modified without executing targeted unit test.",
      "remediation_cmd": "bun test tests/engine/dag.test.ts",
      "documentation_ref": "AGENTS.md#rule-6"
    }
  ]
}
```

### 2.2 Verifiable Cryptographic `[ROUTING_JOURNEY]` Audit Trail

Every interjection carries a tamper-evident routing header verifying message provenance:

```json
{
  "routing_journey": {
    "origin_sentinel": "sentinel:implementer_core_01",
    "origin_role": "implementer",
    "rule_code": "MISSING_FILE_SCOPED_TEST_RUN",
    "target_agent": "implementer_core_01",
    "target_role": "implementer",
    "parent_supervisor": "coordinator_core_01",
    "current_strike": 1,
    "escalated": false,
    "timestamp": 1757155600,
    "sha256": "8f4e2b...c3a9"
  }
}
```

**Invariant:** Mailbox delivery routers verify that messages with `escalated: false` are strictly rejected if addressed to any mailbox other than `target_agent`.

### 2.3 4-Host Parity Verification Suite

Automated integration tests verify identical enforcement across all 4 canonical hosts:

- `tests/sentinel/host_parity_antigravity.test.ts`
- `tests/sentinel/host_parity_claude_code.test.ts`
- `tests/sentinel/host_parity_codex.test.ts`
- `tests/sentinel/host_parity_cursor.test.ts`

Each test suite asserts:

1. Strict pre-action mechanical block on unauthorized commands.
2. File-scoped unit test validation prior to `task:submit`.
3. Scoped point-to-point delivery with zero cross-tier leak.
4. Clean execution of POSIX flock operations with zero lock starvation.

---

## 3. Level 7: Resilience & Edge Hardening

### 3.1 POSIX Flock Contention SLA ($\le 500\text{ms}$)

To prevent filesystem deadlocks when multiple subagents update mailboxes simultaneously:

- Writers acquire locks using non-blocking calls (`LOCK_EX | LOCK_NB`).
- On contention, the writer backs off with randomized jitter across 3 attempts:
  - Attempt 1: 50ms sleep
  - Attempt 2: 150ms sleep
  - Attempt 3: 300ms sleep
- If the lock remains unacquired after 500ms, the operation aborts safely with `MAILBOX_LOCK_TIMEOUT`, preserving state integrity without hanging the host process.

### 3.2 Ephemeral Session HMAC Authentication

To protect against message spoofing or unauthorized interjections:

- Upon agent deployment (`agent:register`), the harness generates a 256-bit cryptographically secure session key bound to the run capsule.
- Every sentinel command and mailbox payload includes an HMAC-SHA256 signature calculated over the payload bytes.
- Mailbox consumers reject unsigned or mismatched payloads instantly.

### 3.3 Process Tree Ancestry (PPID) Verification

To block rogue subagents from launching unmonitored background subshells or detached daemons:

- `harness.ts shell` inspects the operating system process ancestry.
- The parent PID (PPID) of the executing command must map directly to an authorized harness process.
- Detached commands (`nohup`, `disown`, background subshells `(...) &`) fail pre-action verification and trigger an immediate Strike 2 block.

### 3.4 Quota Freeze & Circuit-Breaker Resilience

The sentinel natively integrates with Monorepo Rule 35 (<10% Quota Circuit-Breaker):

- When quota falls below 10% (`QUOTA_EXHAUSTED_CIRCUIT_BROKEN`) or HTTP 429 is encountered, the sentinel enters a passive sleep state.
- **Zero-Kill Invariant:** Active subagents are never killed; processes sleep in RAM with working tree changes intact.
- Upon quota reset timer wake, the sentinel validates state coordinates against `.olt/quota-dag-snapshot.json` and resumes the active strike ladder seamlessly.

---

## 4. Resilience Guarantees Summary

```text
┌─────────────────────────┬──────────────────────┬────────────────────────┐
│ Threat / Edge Case      │ Hardening Mechanism  │ Guaranteed SLA         │
├─────────────────────────┼──────────────────────┼────────────────────────┤
│ Mailbox Lock Race       │ Non-blocking flock   │ Contention SLA <= 500ms│
│ Token / Message Spoof   │ Ephemeral Run HMAC   │ Cryptographic Reject   │
│ Rogue Detached Subshell │ PPID Process Audit   │ Pre-action Deny        │
│ Memory / Quota Freeze   │ RAM Sleep + Snapshot │ Zero Task Termination  │
└─────────────────────────┴──────────────────────┴────────────────────────┘
```

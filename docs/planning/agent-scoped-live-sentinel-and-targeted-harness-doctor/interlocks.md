# Sentinel Interlocks, Scoped Mailbox IPC & Progressive Escalation

> **Document:** `interlocks.md`  
> **Master Plan:** `docs/planning/agent-scoped-live-sentinel-and-targeted-harness-doctor/PLAN.md`  
> **Tracking ID:** `fb-agent-scoped-live-sentinel-doctor-interlock`

---

## 1. Turn-Boundary Sentinel Hooks

The Sentinel operates as an in-process, non-blocking supervisor monitoring agent operations at three deterministic event hooks:

```text
       Agent Turn Begins
               │
               ▼
   [Hook: sentinel:pre-action]   ──► Verifies lease validity, read/write boundaries
               │
          Action Executes (Tool call / Command execution)
               │
               ▼
   [Hook: sentinel:post-action]  ──► Validates output invariants, LOC limits, AST errors
               │
               ▼
   [Hook: sentinel:turn-end]     ──► Executes role doctor: bun harness.ts doctor:agent
               │                     Evaluates overall turn compliance
               ▼
   Interjection Required? ──Yes──► Scoped Mailbox Interjection (.olt/mailboxes/<id>/)
               │ No
               ▼
       Next Agent Turn
```

### Hook Responsibilities

1. **`sentinel:pre-action`**:
   - Inspects outgoing tool calls before execution.
   - Blocks write attempts targeting files outside the leased `write_scope`.
   - Rejects non-authorized CLI commands via `verifyCommandAuthorization`.

2. **`sentinel:post-action`**:
   - Inspects modified files for density breaches (physical lines $> 300$).
   - Scans code changes for banned tokens (`: any`, `as any`, `@ts-ignore`, `@ts-expect-error`).
   - Ensures directory file fanout remains $\le 10$ files.

3. **`sentinel:turn-end`**:
   - Invokes `bun harness.ts doctor:agent --role <role> --agent <id>`.
   - Audits whether mandatory intermediate steps were omitted (e.g. `task:submit` without prior file-scoped unit test run; UI review without `view_file` on screenshots).

---

## 2. Scoped Mailbox Delivery & Zero-Cross-Tier Routing

A primary failure mode of global monitoring is **cross-tier cognitive noise**. When low-level implementer omissions are broadcast globally or logged indiscriminately into shared channels, orchestrators and coordinators burn token context diagnosing issues outside their lane.

The Sentinel enforces **Strict Scoped Routing**:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                       SCOPED ROUTING ARCHITECTURE                           │
├──────────────────────┬─────────────────────────────┬────────────────────────┤
│ Event Trigger        │ Destination Mailbox         │ Visibility Scope       │
├──────────────────────┼─────────────────────────────┼────────────────────────┤
│ Implementer omission │ .olt/mailboxes/impl-123/    │ ONLY Implementer       │
│ Coordinator omission │ .olt/mailboxes/coord-456/   │ ONLY Coordinator       │
│ Validator omission   │ .olt/mailboxes/val-789/     │ ONLY Validator         │
│ Strike 3 Escalation  │ .olt/mailboxes/parent-id/   │ Parent Supervisor ONLY │
└──────────────────────┴─────────────────────────────┴────────────────────────┘
```

### Deterministic `[ROUTING_JOURNEY]` Audit Trail

Every interjection message carries a verifiable cryptographic routing header:

```json
{
  "routing_journey": {
    "origin_sentinel": "sentinel:impl-123",
    "origin_role": "implementer",
    "rule_code": "MISSING_FILE_SCOPED_TEST_RUN",
    "target_agent": "impl-123",
    "target_role": "implementer",
    "parent_supervisor": "coord-456",
    "current_strike": 1,
    "escalated": false,
    "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  }
}
```

Higher supervisory tiers never receive messages where `escalated == false`.

---

## 3. The 3-Strike Progressive Escalation Model

To prevent infinite thrashing while maintaining autonomous recovery, the Sentinel applies a progressive 3-strike escalation ladder:

```text
  Violation Detected
          │
          ├───────────────────────────────────────────────────┐
          ▼                                                   ▼
     Strike 1: ADVISE                                    Strike 2: BLOCK
     • Informational warning in mailbox                  • Mechanical command lock
     • Injects exact copy-paste fix                      • Rejects further tool calls
     • Non-blocking; agent course-corrects               • Must execute remediation first
          │                                                   │
          └─────────────────────────┬─────────────────────────┘
                                    │ Unresolved after Strike 2
                                    ▼
                             Strike 3: ESCALATE
                             • Freezes agent task lease
                             • Pushes escalation to parent supervisor
                             • Logs incident to .olt/defects.jsonl
```

### Strike Progression Details

- **Strike 1 (Advise & Guide):**
  - Delivered directly to the agent's mailbox at turn end.
  - Formatted as a high-signal markdown receipt ($\le 15$ lines) with the exact remediation command.
  - The agent has 1 turn to execute the fix.

- **Strike 2 (Hard Interlock Block):**
  - If the same violation persists into the next turn, the sentinel engages a mechanical lock.
  - Any non-remedial tool call is intercepted and rejected with:
    `[SENTINEL_BLOCK: STRIKE 2] You must first execute: <remediation_command>`.

- **Strike 3 (Supervisory Escalation & Lease Pause):**
  - If the agent fails to resolve the violation after Strike 2, the lease is frozen (`task:freeze`).
  - An escalation brief is delivered to the parent supervisor (Coordinator for Implementer; Orchestrator for Coordinator).
  - The parent supervisor can choose to re-brief the agent, reassign the lane, or trigger an in-lease micro-repair.

---

## 4. Deterministic Doctor Probe Contract (`doctor:agent`)

The Sentinel delegates evaluation to the canonical harness command `doctor:agent`.

### Invocation Signature

```bash
bun harness.ts doctor:agent \
  --role <canonical-role> \
  --agent <agent-id> \
  --task <task-id> \
  --run <capsule-name> \
  --format json
```

### JSON Response Schema

```json
{
  "status": "HEALTHY" | "VIOLATION_DETECTED",
  "agent_id": "impl-lane-1",
  "role": "implementer",
  "task_id": "task-001",
  "strike_count": 1,
  "violations": [
    {
      "code": "MISSING_FILE_SCOPED_TEST_RUN",
      "severity": "CRITICAL",
      "target_file": "src/engine/dag.ts",
      "message": "Source file was modified but no targeted unit test was executed in this turn.",
      "remediation_cmd": "bun test tests/engine/dag.test.ts",
      "documentation_ref": "AGENTS.md#rule-6"
    }
  ]
}
```

---

## 5. Anti-Drift Telemetry & Empirical Journaling

1. **Defect Deduplication:**
   Violations that reach Strike 2 are recorded in `.olt/telemetry.jsonl` with their cryptographic signature to prevent duplicate defect logging.
2. **Auto-Resolution Receipt:**
   When an agent successfully executes the remediation command, the sentinel emits a `SENTINEL_RESOLVED` event, clearing the strike counter back to 0.
3. **Audit Log Persistence:**
   All sentinel events are written to `.olt/sentinel-log.jsonl` ensuring full post-mortem forensics for the Tier 2 `meta-auditor`.

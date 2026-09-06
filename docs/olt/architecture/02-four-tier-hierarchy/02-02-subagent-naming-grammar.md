# Subagent Naming Grammar & Lifecycle Management

---

[Previous: 02-01 The Four-Tier Agent Model](02-01-the-four-tier-agent-model.md) | [Chapter Index](index.md) | [All Chapters Index](../index.md) | [Next: 02-03 Host Parity & Adapters](02-03-host-parity-and-adapters.md)

---

## 1. Executive Summary & Epistemic Naming Discipline

In distributed multi-agent execution runtimes where ephemeral subagents are spawned, leased, and rotated concurrently, unstructured or arbitrary agent naming is an existential vulnerability:

- **Telemetry Collision**: Log parsers and event ledgers cannot distinguish between a high-level supervisory coordinator and an ephemeral task worker.
- **Message Misrouting**: Unstructured identifiers lead to mailbox cross-talk, delivering task receipts or failure payloads to incorrect agent queues.
- **Zombie Process Opacity**: When an execution thread hangs, automated watchdog scripts cannot trace orphaned worktrees or dangling file locks back to originating tasks.
- **Security Boundary Bleed**: Lacking deterministic role tokens, sandboxes cannot mechanically enforce tier-based permission lattices.

The OLT engine resolves this through the **Formal Subagent Naming Grammar & Lifecycle Protocol**:

1. **Strict EBNF Grammar**: Every subagent identifier must strictly parse against an Extended Backus-Naur Form grammar encoding role archetype, domain scope, task sequence, and a collision-resistant nonce.
2. **Deterministic Mailbox Addressing**: Agent names map 1:1 to filesystem-backed mailbox queues under `.olt/mailboxes/<agent_id>/`.
3. **Fail-Closed Session Registry**: The central Session Registry enforces unique active registration at spawn time, rejecting syntax violations and duplicate keys fail-closed.
4. **Monotonic Lifecycle State Machine**: Subagents advance through strict, unidirectional lifecycle states governed by cryptographic leases and periodic heartbeats.

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                   SUBAGENT NAMING STRUCTURE & TOKEN ANATOMY                 │
├─────────────────────────────────────────────────────────────────────────────┤
│   CANONICAL GRAMMAR:  <role>_<scope>_<sequence>[-<nonce>]                   │
│                                                                             │
│   ┌──────────────┐   ┌──────────────┐   ┌─────────────────┐   ┌──────────┐  │
│   │     ROLE     │ _ │    SCOPE     │ _ │  TASK SEQUENCE  │ - │  NONCE   │  │
│   └──────────────┘   └──────────────┘   └─────────────────┘   └──────────┘  │
│          │                  │                    │                 │        │
│          ▼                  ▼                    ▼                 ▼        │
│    Canonical Role    Domain Boundary     DAG Task / Wave ID    Hex Nonce    │
│    (implementer)     (engine-core)       (task-04, wave-01)    (a9f1)       │
│                                                                             │
│   Concrete Examples:                                                        │
│   • coordinator_core-engine_wave-01       ──► Tier 2 Coordinator Wave 1     │
│   • implementer_ast-parser_task-04-a9f1   ──► Tier 3 Leased Implementer     │
│   • validator_ast-lint_task-04-c3e2       ──► Tier 3 Cognitive Validator    │
│   • publisher_release_wave-01-f4d2        ──► Tier 3 Dedicated Publisher    │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Formal EBNF Grammar Specification

The subagent naming syntax is formally specified in Extended Backus-Naur Form (EBNF):

```ebnf
SubagentIdentifier  ::= Role "_" DomainScope "_" TaskSequence [ "-" Nonce ] ;

Role                ::= "mind"
                      | "mind-auditor"
                      | "skill-auditor"
                      | "orchestrator"
                      | "coordinator"
                      | "planner"
                      | "implementer"
                      | "validator"
                      | "completeness-critic"
                      | "publisher"
                      | "ui-headless-validator"
                      | "ui-optical-validator"
                      | "plan-validator"
                      | "sub-implementer"
                      | "sub-validator"
                      | "sub-investigator" ;

DomainScope         ::= AlphaLower { ( AlphaLower | Digit | "-" ) } ;
TaskSequence        ::= WaveSequence | TaskUnitSequence | GenSequence ;
WaveSequence        ::= "wave-" Digit { Digit } ;
TaskUnitSequence    ::= "task-" Digit { Digit } ;
GenSequence         ::= "gen-" Digit { Digit } ;
Nonce               ::= HexChar HexChar HexChar HexChar [ HexChar HexChar ] ;

AlphaLower          ::= "a" | "b" | "c" | "d" | "e" | "f" | "g" | "h" | "i" | "j"
                      | "k" | "l" | "m" | "n" | "o" | "p" | "q" | "r" | "s" | "t"
                      | "u" | "v" | "w" | "x" | "y" | "z" ;
Digit               ::= "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" ;
HexChar             ::= Digit | "a" | "b" | "c" | "d" | "e" | "f" ;
```

### 2.1 Canonical Regular Expression

Every agent spawn request is verified against the canonical compiled regular expression before session allocation:

```regex
^(mind|mind-auditor|skill-auditor|orchestrator|coordinator|planner|implementer|validator|completeness-critic|publisher|ui-headless-validator|ui-optical-validator|plan-validator|sub-implementer|sub-validator|sub-investigator)_[a-z0-9-]+_(wave-[0-9]+|task-[0-9]+|gen-[0-9]+)(-[0-9a-f]{4,6})?$
```

---

## 3. Subagent Lifecycle State Machine

Subagents transition through deterministic lifecycle states:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                    SUBAGENT MONOTONIC LIFECYCLE STATE MACHINE               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   [ SPAWNING ] ──► [ REGISTERED ] ──► [ LEASED / ACTIVE ] ──► [ VALIDATING ]│
│                                              │                     │        │
│                                              ▼ (Heartbeat Timeout) ▼        │
│                                         [ ZOMBIE ]           [ COMPLETE ]   │
│                                              │                     │        │
│                                              ▼                     ▼        │
│                                         [ QUARANTINED ] ──► [ TERMINATED ]  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

| Lifecycle State | Description                                   | Invariant & SLA Gate                                 |
| :-------------- | :-------------------------------------------- | :--------------------------------------------------- |
| `SPAWNING`      | Host process initialization underway          | Transient state; timeout 30 seconds.                 |
| `REGISTERED`    | Name validated and locked in session registry | Mailbox allocated under `.olt/mailboxes/<id>/`.      |
| `ACTIVE`        | Task lease claimed; executing implementation  | Heartbeat required every $\le 30$ seconds.           |
| `VALIDATING`    | Code changes submitted for dual verification  | Command hard-lock active for Cognitive Validators.   |
| `COMPLETE`      | Cognitive pass and mechanical exit 0 receipts | Ready for atomic release by Tier 3 Publisher.        |
| `ZOMBIE`        | Heartbeat elapsed $> 300$ seconds             | Leases revoked; quarantined by Coordinator watchdog. |
| `TERMINATED`    | Worktree cleanly torn down                    | Hard reset executed via `manage_subagents kill`.     |

---

## 4. Mailbox Directory Addressing & IPC Protocol

Inter-agent communication flows strictly through isolated, flock-protected filesystem mailboxes under `.olt/mailboxes/<agent_id>/`:

```text
.olt/mailboxes/<agent_id>/
├── in/              # Inbound message queue (msg:recv, msg:poll)
├── out/             # Outbound dispatch buffer (msg:send)
├── archive/         # Processed and acknowledged message receipts
└── heartbeat.json   # High-resolution monotonic timestamp telemetry
```

### Addressing Axioms:

1. **Zero-JSONL Direct Reads**: Agents must never parse or tail raw `.jsonl` files directly; all messaging operations must flow through `bun harness.ts msg:*`.
2. **Mailbox Lock Isolation**: Each mailbox is guarded by an advisory flock lock under `.olt/locks/mailboxes/<agent_id>.lock`, guaranteeing atomic message consumption and zero dropped notifications.
3. **No Native Send Bypasses**: Subagents are mechanically blocked from using unshielded native messaging tools that bypass the audit trail.

---

## 5. TypeScript Parsing & Registry Implementation

The grammar validator is implemented under [`authority/naming.ts`](../../../../olt/scripts/src/authority/naming.ts):

```typescript
export interface ParsedSubagentIdentifier {
  readonly rawIdentifier: string;
  readonly role: string;
  readonly domainScope: string;
  readonly taskSequence: string;
  readonly sequenceNumber: number;
  readonly nonce?: string;
}

export class SubagentIdentifierParser {
  private static readonly REGEX =
    /^(mind|mind-auditor|skill-auditor|orchestrator|coordinator|planner|implementer|validator|completeness-critic|publisher|ui-headless-validator|ui-optical-validator|plan-validator|sub-implementer|sub-validator|sub-investigator)_([a-z0-9-]+)_(wave-[0-9]+|task-[0-9]+|gen-[0-9]+)(?:-([0-9a-f]{4,6}))?$/;

  public static parse(id: string): ParsedSubagentIdentifier {
    const match = this.REGEX.exec(id);
    if (!match) throw new Error(`TRAP_INVALID_SYNTAX: '${id}' violates canonical EBNF grammar.`);
    const [, role, domainScope, seqStr, nonce] = match;
    const [, numStr] = seqStr.split("-");
    return {
      rawIdentifier: id,
      role,
      domainScope,
      taskSequence: seqStr,
      sequenceNumber: parseInt(numStr, 10),
      nonce,
    };
  }
}
```

---

## 6. Failure Taxonomy & Anti-Blunder Matrix

| Failure Code                | Trigger Condition                           | Mechanical Defense & Recovery                            |
| :-------------------------- | :------------------------------------------ | :------------------------------------------------------- |
| `TRAP_INVALID_SYNTAX`       | Name violates canonical EBNF regex          | Spawn rejected fail-closed; error logged to ledger.      |
| `TRAP_AGENT_NAME_COLLISION` | Candidate name matches active session       | Spawn rejected; append pseudorandom hex nonce & retry.   |
| `TRAP_HIERARCHY_INVERSION`  | Child agent attempts to spawn superior tier | RBAC interlock checks authority token; aborts call.      |
| `TRAP_ZOMBIE_HEARTBEAT`     | Heartbeat elapsed $> 300$ seconds           | Coordinator revokes monotonic lease; re-leases task.     |
| `TRAP_MAILBOX_CORRUPT`      | Missing mailbox directory tree              | Session registry auto-reconstructs filesystem hierarchy. |

---

## 7. Architectural Invariants Summary

- **Invariant $\mathcal{C}_5$ (Monotonic Lifecycle Ordering)**: Subagent state transitions are strictly unidirectional; terminated agents cannot revert to active.
- **Invariant $\mathcal{C}_{11}$ (Strict 1:1 Anti-Batching)**: Each subagent is bound to exactly one atomic task sequence identifier; multi-task batching is prohibited.
- **Invariant $\mathcal{C}_{14}$ (5-Minute Straggler SLA Revocation)**: Any subagent whose heartbeat delta exceeds 300 seconds is unconditionally declared a zombie and reclaimed.

---

[Previous: 02-01 The Four-Tier Agent Model](02-01-the-four-tier-agent-model.md) | [Chapter Index](index.md) | [All Chapters Index](../index.md) | [Next: 02-03 Host Parity & Adapters](02-03-host-parity-and-adapters.md)

# 02. Immutable Role Packets & Templates

[⬅ Previous: Host-Agnostic Architecture](./01-host-agnostic-architecture.md) | [Master Table of Contents](../README.md) | [Next: Bearer Token Security ➡](./03-bearer-token-security.md)

---

## 📄 What is a Role Packet?

Rather than passing informal conversational prompts to subagents, the harness generates **Immutable, Cryptographically Bound Role Packets** under:

```text
.capsules/<run-id>/packets/<packet-id>/packet.md
```

A role packet is a standalone, self-contained Markdown file that acts as an **airtight legal contract** for the worker agent. It defines:

1. The exact, immutable requirements to satisfy.
2. The strictly leased, exclusive directory write scope.
3. The expected verification evidence schema.
4. The literal commands to run.
5. Authoritative baseline repository state.
6. The universal `common-instructions.md` rules.

---

## 🎭 The 5 Core Role Templates

The harness defines five specialized role templates located in `scripts/assets/`:

```text
+-----------------------------------------------------------------------------------------------+
|                                     THE 5 ROLE PACKET TYPES                                   |
+-----------------------------------------------------------------------------------------------+
|                                                                                               |
|  1. planner.md             ---> Decomposes raw prompt into requirements & DAG; no code edits. |
|  2. implementer.md         ---> Writes code within leased write scope & runs focused tests.   |
|  3. validator.md           ---> Adversarial reviewer; runs fresh commands; outputs findings.  |
|  4. repairer.md            ---> Fixes structured defects reported by validator (max 3 rounds).|
|  5. completeness-critic.md ---> Final run-level auditor; verifies overall completion proof.   |
|                                                                                               |
+-----------------------------------------------------------------------------------------------+
```

---

## 🔏 Cryptographic Packet Sealing

When a packet is generated via `harness.ts packet`, the harness:

1. Synthesizes the role template with current task metadata from `state.json`.
2. Appends `common-instructions.md` byte-for-byte.
3. Computes the SHA-256 hash of the complete packet text (`packet_sha256`).
4. Writes the packet with read-only permissions (`mode 0444`).
5. Appends a `packet_published` event to `events.jsonl`.

```json
{
  "schema": "harness.packet",
  "version": 1,
  "run_id": "docs-system",
  "role": "implementer",
  "agent_id": "implementer-1",
  "task_id": "task-1",
  "attempt": 1,
  "packet_sha256": "0c6e71ff9896ad7131b3ee29d54f89f678e054d336d926ea07dec522cc4e0a9f"
}
```

If the dispatched subagent tampers with or modifies its assigned packet file, the harness detects the SHA-256 mismatch upon submission and rejects the attempt.

---

## 📜 Universal Invariants in `common-instructions.md`

Every single role packet unconditionally appends the 14 rules from `common-instructions.md`. Key invariants include:

- **Rule 2 (Exclusive Scope):** Treat the write scope as an exclusive lease. Never edit, format, or delete any file outside it.
- **Rule 5 (Direct Argv):** Execute commands as literal argv without a shell.
- **Rule 6 (Focused Proof):** Implementers run only focused tests for their owned behavior; full integration suites belong to the coordinator.
- **Rule 11 (No API Calls):** Never call LLM APIs or launch LLM CLI subshells.
- **Rule 13 (Token Secrecy):** Never write bearer tokens into packet files, status reports, or git commits.

---

[⬅ Previous: Host-Agnostic Architecture](./01-host-agnostic-architecture.md) | [Master Table of Contents](../README.md) | [Next: Bearer Token Security ➡](./03-bearer-token-security.md)

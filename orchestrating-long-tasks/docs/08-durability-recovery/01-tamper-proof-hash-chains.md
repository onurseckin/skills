# 01. Event-Sourced Storage & Tamper-Proof Hash Chains

[⬅ Previous: Mechanical Completion Engine](../07-gates-and-completion/03-mechanical-completion-engine.md) | [Master Table of Contents](../README.md) | [Next: POSIX File Locking & Durable Writes ➡](./02-posix-flock-and-fdatasync.md)

---

## ⛓️ The Architecture of `events.jsonl`

In traditional systems, state is updated by mutating a central database or JSON file in place. If the system crashes mid-write, data is corrupted or lost forever.

`orchestrating-long-tasks` uses an **Append-Only Event Sourcing** architecture. Every state change (plan initialization, task claiming, command start, validation submission, gate attachment) is appended as a discrete line in `.capsules/<run-id>/events.jsonl`.

```text
┌─────────────────────────────────────────────────────────────────┐
│                          EVENT LINE 1                           │
│  sequence: 1, kind: "run-initialized", hash: "41512719..."      │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼ (previous_hash = "41512719...")
┌─────────────────────────────────────────────────────────────────┐
│                          EVENT LINE 2                           │
│  sequence: 2, kind: "plan-applied",    hash: "bd5aaed2..."      │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼ (previous_hash = "bd5aaed2...")
┌─────────────────────────────────────────────────────────────────┐
│                          EVENT LINE 3                           │
│  sequence: 3, kind: "task-claimed",    hash: "1cb2ca94..."      │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🔒 Cryptographic Hashing & Tamper-Proof Invariants

Every event object $E_i$ contains:
- `sequence`: Strictly ascending integer $i = 1, 2, 3 \dots$
- `previous_hash`: The exact SHA-256 digest of $E_{i-1}$ (or `null` for $E_1$)
- `hash`: SHA-256 digest of $E_i$ (calculated across canonical JSON encoding of all fields excluding `hash`)
- `projection`: Full projected snapshot of `state.json` at sequence $i$.

### Mathematical Guarantee:
$$H_i = \text{SHA-256}\left(\text{CanonicalJSON}(E_i \setminus \{H_i\})\right)$$
$$E_i.\text{previous\_hash} = H_{i-1}$$

If any process or actor modifies even a single character of past history, the entire downstream cryptographic chain breaks immediately. The harness validator detects the discrepancy and refuses to boot.

---

## 📐 Canonical JSON Encoding (`canonicalJsonBytes`)

To guarantee that JSON hashes are 100% deterministic across diverse OS platforms, runtimes, and architectures:
1. **Sorted Keys:** All object keys are sorted lexicographically at every nesting level.
2. **Strict Spacing:** Zero extraneous whitespace, padding, or trailing commas.
3. **Normalized Floats & Strings:** Strict UTF-8 byte serialization.

---

[⬅ Previous: Mechanical Completion Engine](../07-gates-and-completion/03-mechanical-completion-engine.md) | [Master Table of Contents](../README.md) | [Next: POSIX File Locking & Durable Writes ➡](./02-posix-flock-and-fdatasync.md)

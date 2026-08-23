# 01. Event-Sourced Storage & Tamper-Proof Hash Chains

[⬅ Previous: Mechanical Completion Engine](../07-gates-and-completion/03-mechanical-completion-engine.md) | [Master Table of Contents](../README.md) | [Next: POSIX File Locking & Durable Writes ➡](./02-posix-flock-and-fdatasync.md)

---

## 🧭 Diátaxis Overview

| Quadrant         | Purpose in this Chapter                                                                                                                                        |
| :--------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Explanation**  | Understand the Append-Only Event Sourcing model, the mathematics of SHA-256 hash chains, Canonical JSON serialization, and the `sameJson` equality comparator. |
| **How-To Guide** | Verifying capsule hash chain integrity, inspecting historical event records, and auditing state projections.                                                   |
| **Reference**    | Event object schema, event kind catalog, Canonical JSON encoding rules, and integrity verification error codes.                                                |
| **Tutorial**     | Step-by-step trace of how events are canonically encoded, hashed, chained, and re-projected into live state.                                                   |

---

## ⛓️ 1. Explanation: Append-Only Event Sourcing

In conventional systems, state is updated by mutating a database table or rewriting a centralized JSON file in place. If an agent crashes or the OS loses power during a write, the state is corrupted or lost.

In `olt`, state is never mutated in place. All state transitions are recorded as **discrete, immutable events** appended to `.capsules/<run-id>/events.jsonl`. The live in-memory state (`RunState`) and `state.json` file are **pure mathematical projections** derived by replaying `events.jsonl` from line 1 to head.

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                      EVENT-SOURCED PROJECTION ENGINE                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  events.jsonl (Append-Only Immutable Source of Truth)                       │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ Event 1: {"seq": 1, "kind": "plan-init", "hash": "41512719..."}       │  │
│  │ Event 2: {"seq": 2, "kind": "plan-task-added", "hash": "bd5aaed2..."} │  │
│  │ Event 3: {"seq": 3, "kind": "task-claimed", "hash": "1cb2ca94..."}    │  │
│  │ Event 4: {"seq": 4, "kind": "task-submitted", "hash": "9f82103a..."}  │  │
│  └───────────────────────────────────┬───────────────────────────────────┘  │
│                                      │                                      │
│                                      ▼ (Replay Projection Engine)           │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ state.json (Derived Materialized View / Cache)                        │  │
│  │ • Current Tasks & Statuses                                            │  │
│  │ • Active Leases & Bearer Token Digests                                │  │
│  │ • Findings Registry & Resolution State                                │  │
│  │ • Gate Proof Records & Integrity Manifest                             │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 🔒 2. Reference: Cryptographic Hash Chain Architecture

Every line in `events.jsonl` is a cryptographically signed event object $E_i$:

```json
{
  "sequence": 3,
  "kind": "task-claimed",
  "actor": "worker-1",
  "payload": {
    "task_id": "task-slug",
    "agent_id": "worker-1",
    "role": "implementer",
    "lease_duration": 1200
  },
  "previous_hash": "bd5aaed20194821a8f9210382049182301928301928301928301928301928301",
  "hash": "1cb2ca9481920481029381029381029381029381029381029381029381029381",
  "projection": {
    "revision": 1,
    "event_sequence": 3,
    "event_head": "1cb2ca9481920481029381029381029381029381029381029381029381029381"
  }
}
```

### Mathematical Chain Invariants:

$$H_i = \text{SHA-256}\left(\text{CanonicalJSON}(E_i \setminus \{H_i\})\right)$$

$$E_i.\text{previous\_hash} = \begin{cases} \text{null}, & \text{if } i = 1 \\ H_{i-1}, & \text{if } i > 1 \end{cases}$$

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                       CRYPTOGRAPHIC CHAIN LINKING                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  EVENT 1 (Genesis)                                                          │
│  ├── sequence: 1                                                            │
│  ├── previous_hash: null                                                    │
│  └── hash: "41512719..." ─────────────────────────────────────┐             │
│                                                               │             │
│                                                               ▼             │
│  EVENT 2                                                                    │
│  ├── sequence: 2                                                            │
│  ├── previous_hash: "41512719..." ◄───────────────────────────┘             │
│  └── hash: "bd5aaed2..." ─────────────────────────────────────┐             │
│                                                               │             │
│                                                               ▼             │
│  EVENT 3                                                                    │
│  ├── sequence: 3                                                            │
│  ├── previous_hash: "bd5aaed2..." ◄───────────────────────────┘             │
│  └── hash: "1cb2ca94..."                                                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Tamper-Proof Guarantee

If any process or rogue actor alters even a single character in Event 1 (e.g. changing an actor name or task payload):

1. The recalculation of $H_1$ yields a completely different SHA-256 digest.
2. $E_2.\text{previous\_hash} \neq H_1$, breaking the link between Event 1 and Event 2.
3. Every downstream hash $H_2, H_3 \dots H_n$ becomes invalid.
4. On startup, the harness validator detects the discrepancy and **aborts immediately**, refusing to operate on a compromised capsule.

---

## 📐 3. Reference: Canonical JSON Encoding & Determinism

To guarantee that SHA-256 hashes are 100% deterministic across diverse OS platforms, CPU architectures, and runtimes (macOS, Linux, x86_64, ARM64):

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                     CANONICAL JSON SERIALIZATION RULES                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. Lexicographical Key Sorting                                             │
│     All JSON object keys are recursively sorted in UTF-8 byte order.        │
│     {"z": 1, "a": 2}  ──►  {"a":2,"z":1}                                    │
│                                                                             │
│  2. Strict Zero-Whitespace Serialization                                    │
│     No whitespace around delimiters, colons, or brackets.                   │
│     {"a": 1, "b": 2}  ──►  {"a":1,"b":2}                                    │
│                                                                             │
│  3. Normalized Numbers & Unicode                                            │
│     No trailing float zeros; strict UTF-8 NFC byte normalization.           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 🧮 4. Explanation: `sameJson`, `readCanonicalObject`, and `jsonCopy`

Canonical encoding is the foundational building block for all state integrity checks across `olt`:

### 1. `sameJson(left, right)`

Used whenever the harness needs to evaluate whether two JSON values are semantically and structurally identical. Both values are encoded into Canonical JSON byte streams and compared byte-for-byte:

- Ignores arbitrary key order differences in memory.
- Detects any semantic divergence with zero false positives.

### 2. `readCanonicalObject(filePath)`

When reading persistent JSON files from disk (`state.json`, `metadata.json`, `requirements.json`):

- Reads the raw bytes from disk.
- Parses the JSON.
- Re-encodes the parsed object into Canonical JSON.
- **Asserts byte-for-byte identity** between on-disk bytes and canonical output.
- **Refuses to load any file with non-canonical formatting** (extra spaces, newlines, or unsorted keys), immediately flagging potential manual tampering.

### 3. `jsonCopy(value)`

Deep copies in the harness are implemented using `structuredClone(value)`, deliberately **avoiding** `JSON.parse(JSON.stringify(value))`. The `stringify` round-trip silently drops object keys with `undefined` values, which would mask malformed schema structures. `structuredClone` preserves explicit `undefined` values so schema validators can properly reject them.

---

## ➡️ 5. Explanation: Forward-Only Payload Enrichment

As the `olt` harness evolves, new fields are added to event payloads. The hash chain enforces a strict backward-compatibility invariant:

> **Historical event payloads are NEVER backfilled or rewritten.**

Rewriting a historical event to add a new metadata field would alter its canonical serialization, change its SHA-256 hash, and invalidate all downstream events.

### Reader Compatibility Rule

All event consumers and state projectors must tolerate the absence of modern fields on legacy events:

- A `review-recorded` event in modern runs includes `verdict`, `round`, `class`, and `finding_count`.
- An older event written under a previous version may only contain `task_id` and `verdict`.
- The projection engine handles missing fields with explicit safe fallbacks rather than guessing or mutating historical payloads.

---

## 📖 6. How-To Guide: Auditing & Verifying Capsules

### Auditing a Capsule with Doctor

```bash
bun harness.ts doctor --run .capsules/<run-id>
```

Output:

```text
### Capsule Doctor: `.capsules/run-402`
- **Healthy**: yes
- **Hash Chain Verified**: 84/84 events valid (Genesis to Head intact)
- **Manifest Integrity**: 100% blobs verified against SHA-256 digests
- **Issues**: none
```

### Inspecting Specific Event Chains

```bash
# View latest event head
bun harness.ts events:head --run .capsules/<run-id>

# View full event history
bun harness.ts events:list --run .capsules/<run-id> --limit 10
```

---

## 💻 7. Tutorial: Event Hashing & State Projection Trace

### Step 1: Genesis Event Appended (`plan-init`)

```json
{
  "sequence": 1,
  "kind": "plan-init",
  "actor": "planner",
  "payload": { "run_id": "run-demo", "prompt_sha256": "8a9f..." },
  "previous_hash": null,
  "hash": "41512719e0b8214a...",
  "projection": { "revision": 1, "event_sequence": 1, "event_head": "41512719e0b8214a..." }
}
```

### Step 2: Task Claim Event Appended (`task-claimed`)

1. Harness verifies $E_2.\text{previous\_hash} = E_1.\text{hash}$ (`"41512719e0b8214a..."`).
2. Canonical JSON string computed for Event 2 excluding `"hash"`.
3. SHA-256 computed: `"bd5aaed2981a..."`.
4. Event 2 written to `events.jsonl` with `fsyncSync`.

### Step 3: Projected State Updated

Projection engine updates `state.json`:

- `tasks["task-1"].status = "leased"`
- `tasks["task-1"].lease.agent_id = "worker-1"`
- `state.event_head = "bd5aaed2981a..."`

`state.json` is durably flushed using atomic rename and directory sync.

---

[⬅ Previous: Mechanical Completion Engine](../07-gates-and-completion/03-mechanical-completion-engine.md) | [Master Table of Contents](../README.md) | [Next: POSIX File Locking & Durable Writes ➡](./02-posix-flock-and-fdatasync.md)

# 01. Event-Sourced Storage & Tamper-Proof Hash Chains

> [!IMPORTANT]
> **HUMAN DEVELOPER REFERENCE ONLY**: This documentation is written for human engineers maintaining and evolving the skill. Autonomous LLM runtime subagents MUST NOT ingest these files directly into context; all operational directives, topology graphs, and task assignments MUST be queried exclusively through the Harness CLI.

[⬅ Previous: Mechanical Completion Engine](../07-gates-and-completion/03-mechanical-completion-engine.md) | [Master Table of Contents](../README.md) | [Next: POSIX File Locking & Durable Writes ➡](./02-posix-flock-and-fdatasync.md)

---

## ⛓️ The Architecture of `events.jsonl`

In traditional systems, state is updated by mutating a central database or JSON file in place. If the system crashes mid-write, data is corrupted or lost forever.

`orchestrating-long-tasks` uses an **Append-Only Event Sourcing** architecture. Every state mutation is appended as an immutable, discrete record in `.capsules/<run-id>/events.jsonl` — planning (`plan-init`, `plan-enhanced`, `plan-task-added`, `plan-compiled`, `topology-recorded`, `plan-recompiled`, `plan-audited`, `plan-audit-accepted`), execution (`task-claimed`, `lease-heartbeat`, `lease-released`, `task-submitted`, `command-recorded`, `gate-proved`), branching (`branch-opened`, `branch-claimed`, `branch-submitted`, `branch-collected`, `branch-abandoned`), deployment (`agent-registered`, `agent-reported`, `agent-released`), review (`validation-started`, `probe-recorded`, `review-recorded`, `critic-assigned`, `completion-reviewed`, `plan-validation-started`, `plan-reviewed`), recovery (`stale-recovery`, `projection-recovered`, `supervisor-dead-agent-reclaimed`, `supervisor-dispatch-outcome`, `task-escalated-by-supervisor`) and completion (`run-completed`).

```text
┌─────────────────────────────────────────────────────────────────┐
│                          EVENT LINE 1                           │
│  sequence: 1, kind: "plan-init",       hash: "41512719..."      │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼ (previous_hash = "41512719...")
┌─────────────────────────────────────────────────────────────────┐
│                          EVENT LINE 2                           │
│  sequence: 2, kind: "plan-task-added", hash: "bd5aaed2..."      │
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
- `payload`: Structured payload describing the exact state transition.
- `projection`: The `RunState` head — revision, event sequence, event head — as of this event.

### Mathematical Guarantee:

$$H_i = \text{SHA-256}\left(\text{CanonicalJSON}(E_i \setminus \{H_i\})\right)$$
$$E_i.\text{previous\_hash} = H_{i-1}$$

If any process or actor modifies even a single character of past history, the entire downstream cryptographic chain breaks immediately. The harness validator detects the discrepancy and refuses to boot.

This isn't only a boot-time check. `workflow/completion/integrity-evidence.ts`'s
`observeCapsuleIntegrity` runs the identical chain-and-manifest verification **at completion-review
time** and hands the result to the completeness critic as its own evidence — never trusted from a
`--review` payload the critic supplies, always independently re-measured by the harness itself in that
same moment (Chapter 07 §02). The resulting record deliberately carries no timestamp: it is a pure
function of the capsule's bytes as they stand right now, nothing else, which is exactly what lets an
independently published critic packet recompute and match the identical digest later.

---

## 📐 Canonical JSON Encoding

To guarantee that JSON hashes are 100% deterministic across diverse OS platforms, runtimes, and architectures:

1. **Sorted Keys:** All object keys are sorted lexicographically at every nesting level.
2. **Strict Spacing:** Zero extraneous whitespace, padding, or trailing commas.
3. **Normalized Floats & Strings:** Strict UTF-8 byte serialization.

---

## 🧮 `sameJson`: The One Comparator Behind Every "Did This Change" Check

Canonical encoding is not only how a hash is computed — it is also the single shared way the harness
answers "are these two JSON values actually the same," everywhere that question comes up: whether a
command's on-disk record still matches what `state.commands` claims about it (Chapter 05), whether a
plan revision changed a task's contract out from under work already in flight (Chapter 03), whether a
capsule's stored blob still matches what the capture ledger recorded (Chapter 08 §02's write pipeline).
`core/json.ts`'s `sameJson(left, right)` re-encodes both sides through the identical canonical encoder
described above and compares the resulting bytes — so a value that differs only in _key order_ (which
`JSON.stringify` alone would treat as a different string) is correctly read as identical, and a value
that differs in any real way is caught regardless of which side happens to be freshly re-serialized and
which side came straight off disk.

`readCanonicalObject` — the function every durable JSON read in the store layer goes through — takes
this one step further: it does not merely parse a file, it **refuses to load one whose bytes are not
already exactly canonical**, by re-encoding the parsed value and comparing it byte-for-byte against
what was actually on disk. A file edited by hand, even in a way that preserves valid JSON and identical
semantic content — reordered keys, extra whitespace, a trailing newline — fails this check. This is the
same tamper-detection promise the hash chain makes, applied to a single file rather than the whole
chain: the moment the _bytes themselves_ stop matching what the harness would have written, loading
refuses rather than silently accepting a file that merely still happens to parse.

One more small but load-bearing detail: `jsonCopy(value)` — used wherever the harness needs a
value-safe deep copy before mutating a draft — is implemented with `structuredClone`, deliberately
**not** a `JSON.stringify` / `JSON.parse` round-trip. That round-trip silently drops any object key
whose value is `undefined`, which would turn a malformed record into a well-formed-looking one on its
way through a copy — exactly the kind of silent repair this project refuses to do anywhere else.
`structuredClone` preserves the value exactly, `undefined` keys included, so a downstream validator
still gets the chance to correctly reject it.

---

## ➡️ Payload Enrichment Is Forward-Only

New fields on an event payload apply to events written from now on and are **never backfilled**.
Rewriting a historical payload would change its canonical JSON, change its hash, and break every link
after it — the chain is exactly what makes retroactive improvement impossible.

The practical consequence: an old capsule keeps the payloads it was written with, and every reader
must tolerate their absence rather than assume a default. `review-recorded` carries `verdict`,
`round`, `class` and `finding_count`; an event written before those existed carries only `task_id`,
and a reader that guessed a verdict for it would be inventing history.

---

[⬅ Previous: Mechanical Completion Engine](../07-gates-and-completion/03-mechanical-completion-engine.md) | [Master Table of Contents](../README.md) | [Next: POSIX File Locking & Durable Writes ➡](./02-posix-flock-and-fdatasync.md)

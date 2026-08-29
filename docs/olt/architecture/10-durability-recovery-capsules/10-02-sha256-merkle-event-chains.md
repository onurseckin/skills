# SHA-256 Merkle Event Chains & Tamper-Evident Ledgers

---

[Previous: 10-01 Capsule Filesystem Anatomy](10-01-capsule-filesystem-anatomy.md) | [Chapter Index](index.md) | [All Chapters Index](../index.md) | [Next: 10-03 POSIX Flock Advisory Locking](10-03-posix-flock-advisory-locking.md)
---

## 1. Executive Summary & Epistemic Auditability

In autonomous agent systems that perform hundreds of state mutations, auditing historical execution requires absolute cryptographic proof that log records have not been altered, omitted, or reordered retroactively.

The **OLT (Orchestrating Long Tasks)** engine implements **SHA-256 Merkle Event Chains & Tamper-Evident Ledgers**. Under this architecture:

1. **Cryptographic Event Chaining**: Every event $e_k$ appended to `events.jsonl` incorporates the SHA-256 hash of the immediately preceding event $h_{k-1}$.
2. **Genesis Sealing**: The genesis hash $h_0$ is bound to the cryptographic hash of `manifest.json`.
3. **Tamper Detection**: Any modification, insertion, or deletion of a historical event breaks the hash chain for all subsequent events, allowing the engine to instantly detect and halt on ledger tampering in $\mathcal{O}(N)$ time.

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                 SHA-256 MERKLE EVENT CHAIN TOPOLOGY                              │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                  │
│   Genesis Root (h_0): SHA256(manifest.json)                                                      │
│        │                                                                                         │
│        ▼                                                                                         │
│   Event 1: h_1 = SHA256( h_0  ||  CanonicalJSON(e_1) )  ──► "phase:planned"                      │
│        │                                                                                         │
│        ▼                                                                                         │
│   Event 2: h_2 = SHA256( h_1  ||  CanonicalJSON(e_2) )  ──► "task:claimed"                      │
│        │                                                                                         │
│        ▼                                                                                         │
│   Event 3: h_3 = SHA256( h_2  ||  CanonicalJSON(e_3) )  ──► "task:validated"                    │
│        │                                                                                         │
│        ▼                                                                                         │
│   Event N: h_N = SHA256( h_{N-1}  ||  CanonicalJSON(e_N) )  ──► "run:completed" (Terminal Root)  │
│                                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Mathematical Formalization of the Merkle Hash Recurrence

Let $M$ be the canonical byte representation of `manifest.json`.

Let $E = \langle e_1, e_2, \dots, e_N \rangle$ be the chronological sequence of event records in `events.jsonl`.

### The Hash Chaining Recurrence

The cryptographic hash sequence $\langle h_0, h_1, \dots, h_N \rangle$ is defined recursively:

$$h_0 = \text{SHA256}(M)$$

$$h_k = \text{SHA256}\Big( h_{k-1} \mathbin{\Vert} \text{CanonicalJSON}(e_k) \Big), \quad \text{for } k = 1, 2, \dots, N$$

Where $\text{CanonicalJSON}(e)$ produces a deterministic, whitespace-normalized string with alphabetically sorted keys:

$$\text{CanonicalJSON}(e) = \text{JSON.stringify}(e, \text{Object.keys}(e).\text{sort}())$$

```mermaid
flowchart LR
    Manifest[manifest.json] -->|SHA256| H0[h_0: Genesis Hash]
    H0 --> Chain1[Concat with e_1]
    Chain1 -->|SHA256| H1[h_1: Event 1 Hash]
    H1 --> Chain2[Concat with e_2]
    Chain2 -->|SHA256| H2[h_2: Event 2 Hash]
    H2 --> Chain3[Concat with e_3]
    Chain3 -->|SHA256| H3[h_3: Terminal Root]
```

---

## 3. Cryptographic Verification Algorithm

The verification engine ([`merkle-ledger.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/engine/store/merkle-ledger.ts)) verifies the integrity of the ledger in $\mathcal{O}(N)$ time:

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                               MERKLE LEDGER VERIFICATION ALGORITHM                               │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                  │
│   1. Read manifest.json and compute h_expected = SHA256(manifest_bytes).                         │
│   2. Open events.jsonl and iterate through lines k = 1 .. N:                                     │
│      a. Parse event record e_k.                                                                  │
│      b. Compute live hash: h_live = SHA256(h_expected || CanonicalJSON(e_k)).                    │
│      c. Assert e_k.hash == h_live.                                                               │
│         • If mismatch ──► TRAP: LEDGER_TAMPERING_DETECTED at sequence k.                         │
│      d. Update h_expected <- h_live.                                                             │
│   3. Return VERIFIED with terminal root digest h_N.                                              │
│                                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Ledger Event Schema

Every line in `events.jsonl` is an independent JSON object:

```json
{
  "seq": 42,
  "timestamp": "2026-08-29T03:18:00.000Z",
  "actor": "coordinator_core_wave-1",
  "type": "task:validated",
  "payload": {
    "taskId": "TASK-01",
    "evidenceDigest": "8f3b2a1c90ef4321",
    "durationMs": 1420
  },
  "previousHash": "a1b2c3d4e5f6...",
  "hash": "f6e5d4c3b2a1..."
}
```

---

## 5. Architectural Invariants Summary

1. **Immutable Chain**: Historical events cannot be edited without invalidating all subsequent hash tokens.
2. **Deterministic Serialization**: Canonical JSON key sorting guarantees reproducible hashes across platforms.
3. **Fail-Closed Verification**: Any hash chain discontinuity halts the active execution wave immediately.

---

[Previous: 10-01 Capsule Filesystem Anatomy](10-01-capsule-filesystem-anatomy.md) | [Chapter Index](index.md) | [All Chapters Index](../index.md) | [Next: 10-03 POSIX Flock Advisory Locking](10-03-posix-flock-advisory-locking.md)
---

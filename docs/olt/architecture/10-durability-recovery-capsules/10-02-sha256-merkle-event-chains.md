# 10-02 SHA-256 Merkle Event Chains & Tamper-Evident Ledgers

---

[Previous: 10-01 Capsule Filesystem Anatomy](10-01-capsule-filesystem-anatomy.md) | [Chapter Index](index.md) | [All Chapters Index](../index.md) | [Next: 10-03 POSIX Flock Advisory Locking](10-03-posix-flock-advisory-locking.md)

---

## 1. Executive Summary & Epistemic Foundations

In multi-agent autonomous engineering environments, complex task graphs execute across dozens of concurrent subagent turns. Without mathematical auditability, event logs are vulnerable to retroactive tampering: rogue agent processes could rewrite past task statuses, fabricate test verdicts, or delete failed attempts to forge successful execution records.

To enforce complete epistemic non-repudiation, the **OLT (Orchestrating Long Tasks)** engine implements **SHA-256 Merkle Event Chains & Tamper-Evident Ledgers**. Under this architecture:

1. **Sequential Hash Chaining**: Every event $e_k$ appended to `events.jsonl` incorporates the cryptographic SHA-256 digest of the preceding event $h_{k-1}$.
2. **Genesis Sealing**: The genesis hash $h_0$ is cryptographically bound to the SHA-256 digest of the write-once `manifest.json`.
3. **Deterministic Canonicalization**: Event payloads are normalized via lexicographically sorted keys before hashing, guaranteeing reproducible cross-platform digests.
4. **Tamper Fracture Detection**: Any modification, insertion, or reordering of past events breaks the cryptographic link for all subsequent records, allowing $\mathcal{O}(N)$ mechanical detection.

```text
+--------------------------------------------------------------------------------------------------+
│                             SHA-256 MERKLE EVENT CHAIN TOPOLOGY                                  │
+--------------------------------------------------------------------------------------------------+
│                                                                                                  │
│   GENESIS SEED: manifest.json ──► h_0 = SHA256( CanonicalJSON(manifest.json) )                   │
│        │                                                                                         │
│        ▼ (Event 1: Phase Planning)                                                               │
│   +------------------------------------------------------------------------------------------+   │
│   │ seq: 1 | actor: "orch_main" | type: "phase:planned"                                      │   │
│   │ prevHash: h_0                                                                            │   │
│   │ hash: h_1 = SHA256( h_0 || CanonicalJSON(e_1) )                                          │   │
│   +---------------------------------------------+--------------------------------------------+   │
│                                                 │                                                │
│                                                 ▼ (Event 2: Task Claimed)                        │
│   +------------------------------------------------------------------------------------------+   │
│   │ seq: 2 | actor: "coord_core" | type: "task:claimed" | taskId: "TASK-01"                  │   │
│   │ prevHash: h_1                                                                            │   │
│   │ hash: h_2 = SHA256( h_1 || CanonicalJSON(e_2) )                                          │   │
│   +---------------------------------------------+--------------------------------------------+   │
│                                                 │                                                │
│                                                 ▼ (Event 3: Task Evidence Validated)             │
│   +------------------------------------------------------------------------------------------+   │
│   │ seq: 3 | actor: "validator_gate" | type: "task:validated" | evidenceDigest: "9f8a..."    │   │
│   │ prevHash: h_2                                                                            │   │
│   │ hash: h_3 = SHA256( h_2 || CanonicalJSON(e_3) )                                          │   │
│   +---------------------------------------------+--------------------------------------------+   │
│                                                 │                                                │
│                                                 ▼ (Event N: Terminal Run Completed)              │
│   +------------------------------------------------------------------------------------------+   │
│   │ seq: N | actor: "orch_main" | type: "run:completed" | totalTasks: N                      │   │
│   │ prevHash: h_{N-1}                                                                        │   │
│   │ hash: h_N = SHA256( h_{N-1} || CanonicalJSON(e_N) )  <── [Terminal Merkle Root]          │   │
│   +------------------------------------------------------------------------------------------+   │
│                                                                                                  │
+--------------------------------------------------------------------------------------------------+
```

---

## 2. Core Architectural Principles & Invariants

1. **Cryptographic Chaining Invariant**: For every event $e_k$ with $k \ge 1$, the field `e_k.previousHash` must exactly equal $h_{k-1}$, and `e_k.hash` must equal $\text{SHA256}(h_{k-1} \mathbin{\Vert} \text{CanonicalJSON}(e_k))$.
2. **Canonical JSON Serialization**: Object keys must be sorted alphabetically and serialized without non-standard whitespace before digest calculation.
3. **Fail-Closed Verification**: Any hash mismatch during ledger replay immediately halts the execution wave with `TRAP: MERKLE_CHAIN_FRACTURE`.
4. **Append-Only Mutation**: Mutating existing lines in `events.jsonl` is strictly prohibited. State changes are recorded exclusively by appending new event lines.
5. **Linear Verification Complexity**: Full cryptographic validation of the ledger must execute in deterministic $\mathcal{O}(N)$ time and $\mathcal{O}(1)$ working memory.

```text
+--------------------------------------------------------------------------------------------------+
│                             EVENT LEDGER INTEGRITY CHECK MATRIX                                  │
+-------------------------+-----------------------------------+------------------------------------+
│ Validation Check        │ Inspection Target                 │ Action on Failure                  │
+-------------------------+-----------------------------------+------------------------------------+
│ Genesis Hash Check      │ h_0 == SHA256(manifest.json)      │ HALT: CORRUPTED_GENESIS_ROOT       │
+-------------------------+-----------------------------------+------------------------------------+
│ Sequence Continuity     │ e_k.seq == e_{k-1}.seq + 1        │ HALT: EVENT_SEQUENCE_GAP           │
+-------------------------+-----------------------------------+------------------------------------+
│ Previous Hash Linkage   │ e_k.previousHash == e_{k-1}.hash  │ HALT: CHAIN_DISCONTINUITY          │
+-------------------------+-----------------------------------+------------------------------------+
│ Live Digest Recalculate │ e_k.hash == SHA256(h_{k-1} || e_k)│ HALT: EVENT_PAYLOAD_TAMPERED       │
+-------------------------+-----------------------------------+------------------------------------+
│ Timestamp Monotonicity  │ t_k >= t_{k-1}                    │ WARN: CLOCK_SKEW_DETECTED          │
+-------------------------+-----------------------------------+------------------------------------+
```

---

## 3. Algorithmic Mechanics & State Transitions

The ledger engine supports two core algorithms: atomic event appending under POSIX lock and full linear cryptographic verification:

```mermaid
flowchart TD
    subgraph Append["Event Append Protocol (under flock)"]
        A[New State Event e_k Ready] --> B[Read Last Line of events.jsonl]
        B --> C[Extract Last Hash: h_{k-1}]
        C --> D[Normalize e_k with Alphabetical Key Sorting]
        D --> E[Compute Live Hash: h_k = SHA256(h_{k-1} || NormalizedJSON)]
        E --> F[Construct Final Record with seq, prevHash, hash]
        F --> G[Append Line to events.jsonl & fsync]
    end

    subgraph Verify["Ledger Audit Protocol (olt doctor / verify)"]
        H[Read manifest.json] --> I[Compute Expected Genesis Root h_0]
        I --> J[Open events.jsonl Stream]
        J --> K[Iterate Line by Line k = 1 .. N]
        K --> L{Does e_k.prevHash == h_{k-1}?}
        L -->|No| M[TRAP: BROKEN_CHAIN_LINK]
        L -->|Yes| N{Does e_k.hash == Recomputed SHA256?}
        N -->|No| O[TRAP: TAMPERED_EVENT_PAYLOAD]
        N -->|Yes| P[Update Expected Hash: h_{k-1} <- e_k.hash]
        P --> Q{More Lines?}
        Q -->|Yes| K
        Q -->|No| R([Ledger 100% Cryptographically Verified])
    end
```

---

## 4. Mathematical Formulations & Proofs

Let $M$ be the canonical string representation of `manifest.json`. Let $\mathcal{E} = \langle e_1, e_2, \dots, e_N \rangle$ denote the sequence of event objects.

### 1. Canonical Key-Sorting Bijection

Let $\mathcal{C}(e)$ denote the canonical serialization operator:

$$\mathcal{C}(e) = \text{JSON.stringify}(e, \text{Object.keys}(e).\text{sort}())$$

### 2. Merkle Hash Recurrence Relation

The hash chain $\langle h_0, h_1, \dots, h_N \rangle$ is defined recursively:

$$h_0 = \text{SHA256}(\mathcal{C}(M))$$

$$h_k = \text{SHA256}\Big( h_{k-1} \mathbin{\Vert} \mathcal{C}(e_k.\text{payload}) \Big), \quad \forall k \in \{1, 2, \dots, N\}$$

### 3. Theorem: Tamper Detection Guarantee

**Theorem**: Let $\mathcal{E} = \langle e_1, \dots, e_N \rangle$ be an authentic ledger with terminal hash $h_N$. If an adversary modifies any historical event $e_j$ ($1 \le j \le N$) to $e_j' \neq e_j$, then the reconstructed terminal hash $h_N'$ satisfies $h_N' \neq h_N$ with probability $1 - 2^{-256}$.

_Proof_:
Assume $e_j' \neq e_j$. By the collision resistance property of SHA-256:

$$h_j' = \text{SHA256}(h_{j-1} \mathbin{\Vert} \mathcal{C}(e_j')) \neq \text{SHA256}(h_{j-1} \mathbin{\Vert} \mathcal{C}(e_j)) = h_j$$

For step $j+1$:

$$h_{j+1}' = \text{SHA256}(h_j' \mathbin{\Vert} \mathcal{C}(e_{j+1}))$$

Since $h_j' \neq h_j$, finding $h_{j+1}' = h_{j+1}$ requires finding a second pre-image for SHA-256, which has probability $P \le 2^{-256}$. By induction over all remaining $N - j$ steps:

$$P(h_N' = h_N) \le 2^{-256} \approx 0$$

Therefore, any retrospective ledger modification is detected with overwhelming mathematical certainty.

---

## 5. Concrete TypeScript Contracts & Schemas

The TypeScript types for Merkle ledger events and verification functions are implemented in [`epistemic-engine.ts`](../../../../olt/scripts/src/reporting/doctor/epistemic-engine.ts).

```typescript
export interface MerkleEventEnvelope<T = Record<string, unknown>> {
  readonly seq: number;
  readonly timestamp: string;
  readonly actor: string;
  readonly type: string;
  readonly payload: T;
  readonly previousHash: string;
  readonly hash: string;
}

export interface MerkleVerificationResult {
  readonly valid: boolean;
  readonly totalEvents: number;
  readonly genesisHash: string;
  readonly terminalRootHash: string;
  readonly fracturedAtSeq?: number;
  readonly diagnosticReason?: string;
}
```

```typescript
export function canonicalStringify(obj: unknown): string {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return `[${obj.map((item) => canonicalStringify(item)).join(",")}]`;
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const pairs = keys.map((key) => {
    const val = (obj as Record<string, unknown>)[key];
    return `${JSON.stringify(key)}:${canonicalStringify(val)}`;
  });
  return `{${pairs.join(",")}}`;
}

export function computeEventHash(previousHash: string, payload: unknown): string {
  const serialized = canonicalStringify(payload);
  const combined = `${previousHash}:${serialized}`;
  return Bun.crypto.hash("sha256", combined, "hex");
}

export function verifyEventLedger(
  genesisHash: string,
  events: readonly MerkleEventEnvelope[],
): MerkleVerificationResult {
  let expectedPrevHash = genesisHash;

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (event.seq !== i + 1) {
      return {
        valid: false,
        totalEvents: events.length,
        genesisHash,
        terminalRootHash: expectedPrevHash,
        fracturedAtSeq: event.seq,
        diagnosticReason: `Sequence mismatch: expected ${i + 1}, got ${event.seq}`,
      };
    }

    if (event.previousHash !== expectedPrevHash) {
      return {
        valid: false,
        totalEvents: events.length,
        genesisHash,
        terminalRootHash: expectedPrevHash,
        fracturedAtSeq: event.seq,
        diagnosticReason: `Previous hash mismatch at seq ${event.seq}`,
      };
    }

    const liveHash = computeEventHash(expectedPrevHash, event.payload);
    if (event.hash !== liveHash) {
      return {
        valid: false,
        totalEvents: events.length,
        genesisHash,
        terminalRootHash: expectedPrevHash,
        fracturedAtSeq: event.seq,
        diagnosticReason: `Hash computation mismatch at seq ${event.seq}`,
      };
    }

    expectedPrevHash = event.hash;
  }

  return {
    valid: true,
    totalEvents: events.length,
    genesisHash,
    terminalRootHash: expectedPrevHash,
  };
}
```

---

## 6. Failure Modes, Anti-Blunders & Recovery Playbooks

```text
+--------------------------------------------------------------------------------------------------+
│                             MERKLE EVENT CHAIN ANTI-BLUNDER MATRIX                               │
+--------------------------+------------------------------+----------------------------------------+
│ Blunder Anti-Pattern     │ Root Cause                   │ OLT Prevention & Recovery Playbook     │
+--------------------------+------------------------------+----------------------------------------+
│ Unsorted JSON Key Hash   │ Serializing payload with     │ canonicalStringify() sorts all object  │
│ Drift                    │ standard JSON.stringify; keys│ keys alphabetically prior to hashing;  │
│                          │ reordered across JS engines. │ ensures 100% deterministic hash output.│
+--------------------------+------------------------------+----------------------------------------+
│ Concurrent Unlocked      │ Two workers append to        │ POSIX flock LOCK_EX wraps all ledger   │
│ Append Interleaving      │ events.jsonl simultaneously, │ append operations, guaranteeing strict │
│                          │ causing broken hash sequence.│ sequential writes without interleaving.│
+--------------------------+------------------------------+----------------------------------------+
│ Truncated Line on Crash  │ System terminated mid-write, │ Ledger reader ignores partial last     │
│                          │ leaving unparseable JSON line│ line if unsealed; doctor truncates to  │
│                          │ at end of file.              │ last valid Merkle hash boundary.       │
+--------------------------+------------------------------+----------------------------------------+
│ Sequence ID Gap          │ Worker skips sequence number │ Verifier checks e_k.seq == k; catches  │
│                          │ during manual test fixture   │ sequence gaps immediately and halts    │
│                          │ generation.                  │ state projection.                      │
+--------------------------+------------------------------+----------------------------------------+
```

---

## 7. Architectural Invariants Summary & Verification Checklist

1. **Unbroken Merkle Linkage**: Every event must cryptographically chain to its immediate predecessor.
2. **Canonical Serialization**: JSON representations must use sorted keys without discretionary whitespace.
3. **Genesis Anchor**: `h_0` must strictly bind to the SHA-256 digest of `manifest.json`.
4. **Lock-Protected Mutation**: Event appends must occur under POSIX exclusive advisory lock.
5. **Fail-Closed Audit**: Any discontinuity in the hash chain immediately halts execution.

---

[Previous: 10-01 Capsule Filesystem Anatomy](10-01-capsule-filesystem-anatomy.md) | [Chapter Index](index.md) | [All Chapters Index](../index.md) | [Next: 10-03 POSIX Flock Advisory Locking](10-03-posix-flock-advisory-locking.md)

---

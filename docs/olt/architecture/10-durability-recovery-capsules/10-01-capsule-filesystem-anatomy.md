# Capsule Filesystem Anatomy & Atomic Write Semantics

[OLT Documentation Hub](../../README.md) > [Architecture Index](../index.md) > [Chapter 10](./index.md) > 10-01 Capsule Anatomy

---

[⏮️ Previous: Chapter 10: Durability, Recovery & Merkle Chains Overview](index.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: 10-02 SHA-256 Merkle Event Chains](10-02-sha256-merkle-event-chains.md)
---

## 1. Capsule Directory Hierarchy

Every OLT run is encapsulated inside a self-contained directory:

```text
.olt/capsules/<slug>/
 ├── manifest.json       # Immutable metadata, prompt SHA, configuration
 ├── prompt.txt          # Raw sealed prompt (mode 0444)
 ├── events.jsonl        # Append-only SHA-256 Merkle event chain
 ├── state.json          # Materialized projection state view
 ├── requirements.json   # Compiled requirements & line coverage map
 ├── mailbox/            # Agent IPC queues (inbox, outbox, processed)
 ├── receipts/           # Command execution records and binary proofs
 └── locks/              # POSIX advisory lock files (capsule.lock)
```

---

## 2. Atomic Replacement Semantics

State mutations are never written in-place. OLT uses the **Atomic Write-and-Rename Pattern**:

```typescript
const tmpPath = `${targetPath}.${Date.now()}.tmp`;
writeFileSync(tmpPath, content, { encoding: "utf8" });
renameSync(tmpPath, targetPath); // Atomic POSIX rename
```

---

[⏮️ Previous: Chapter 10: Durability, Recovery & Merkle Chains Overview](index.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: 10-02 SHA-256 Merkle Event Chains](10-02-sha256-merkle-event-chains.md)
---

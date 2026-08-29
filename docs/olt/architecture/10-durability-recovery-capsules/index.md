# Chapter 10: Durability, Recovery & Merkle Chains

[OLT Documentation Hub](../../README.md) > [Architecture Index](../index.md) > Chapter 10: Durability, Recovery & Merkle Chains

---

[⏮️ Previous: Chapter 09: Falsifiable Evidence Gates](../09-falsifiable-evidence-gates/index.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: 10-01 Capsule Filesystem Anatomy](10-01-capsule-filesystem-anatomy.md)
---

## 1. Chapter Overview

An autonomous agent harness must survive process crashes, host reboots, power failures, and kernel panics without losing state.

OLT provides **Zero-Loss Crash Recovery** through its **Capsule Filesystem Anatomy**, **SHA-256 Merkle Event Chaining**, **POSIX Advisory Locking**, and **Projection-Patch State Reconstruction**.

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                            CHAPTER 10: DURABILITY & RECOVERY TOPOLOGY                            │
├──────────────────────────┬──────────────────────────┬────────────────────────────────────────────┤
│ Sub-Topic                │ Key Architectural Model  │ Primary Invariants Enforced                │
├──────────────────────────┼──────────────────────────┼────────────────────────────────────────────┤
│ 01. Capsule Anatomy      │ .olt/capsules/<slug>/    │ Atomic fs.renameSync & Isolation Layout    │
│ 02. Merkle Event Chains  │ Cryptographic Hash Chain │ Hi = SHA256(Hi-1 || Ei || timestamp)      │
│ 03. POSIX Flock Locking  │ Advisory Kernel Locks    │ 5000ms Acquisition Deadline & Exit Code 4  │
│ 04. State Reconstruction │ Zero-Loss Replay Engine  │ Deterministic Projection from events.jsonl │
└──────────────────────────┴──────────────────────────┴────────────────────────────────────────────┘
```

---

## 2. Table of Contents

1. **[10-01: Capsule Filesystem Anatomy](./10-01-capsule-filesystem-anatomy.md)**  
   _Comprehensive layout under `.olt/capsules/<slug>/`, format contracts, schema versions._
2. **[10-02: SHA-256 Merkle Event Chains](./10-02-sha256-merkle-event-chains.md)**  
   _Cryptographic event chaining equation, tamper detection, append-only log integrity._
3. **[10-03: POSIX Flock Advisory Locking](./10-03-posix-flock-advisory-locking.md)**  
   _Advisory locking mechanics (`LOCK_EX`, `LOCK_UN`), 5000ms deadline, Exit Code 4._
4. **[10-04: Projection-Patch State Reconstruction](./10-04-projection-patch-state-reconstruction.md)**  
   _Projection state engine, deterministic zero-loss crash recovery, torn-tail healing._

---

[⏮️ Previous: Chapter 09: Falsifiable Evidence Gates](../09-falsifiable-evidence-gates/index.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: 10-01 Capsule Filesystem Anatomy](10-01-capsule-filesystem-anatomy.md)
---

# Falsifiable Evidence Classes (Class 1–4)

[OLT Documentation Hub](../../README.md) > [Architecture Index](../index.md) > [Chapter 09](./index.md) > 09-01 Evidence Classes

---

[⏮️ Previous: Chapter 09: Falsifiable Evidence Gates Overview](index.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: 09-02 Anti-Mock PNG IHDR Binary Inspection](09-02-anti-mock-png-ihdr-binary-inspection.md)
---

## 1. Epistemic Strength Ordering

OLT ranks all verification evidence into four hierarchical classes:

$$\text{Class 1} \succ \text{Class 2} \succ \text{Class 3} \succ \text{Class 4}$$

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                       THE 4 FALSIFIABLE EVIDENCE CLASSES                    │
├─────────┬──────────────────────────┬────────────────────────────────────────┤
│ Class 1 │ Compiler & Binary Proofs │ Zero-exit process execution receipts.  │
│ Class 2 │ AST Static Analysis      │ Deterministic AST tree query results.  │
│ Class 3 │ Monitored Stdout/Stderr  │ Structured JSON log event streams.     │
│ Class 4 │ Cryptographic Merkle Hash│ Content hash tree signatures.          │
└─────────┴──────────────────────────┴────────────────────────────────────────┘
```

---

[⏮️ Previous: Chapter 09: Falsifiable Evidence Gates Overview](index.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: 09-02 Anti-Mock PNG IHDR Binary Inspection](09-02-anti-mock-png-ihdr-binary-inspection.md)
---

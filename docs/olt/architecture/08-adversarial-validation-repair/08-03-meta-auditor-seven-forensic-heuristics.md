# Meta-Auditor Seven Forensic Heuristics ($H_1 \dots H_7$)

[OLT Documentation Hub](../../README.md) > [Architecture Index](../index.md) > [Chapter 08](./index.md) > 08-03 Seven Forensic Heuristics

---

[⏮️ Previous: 08-02 Cognitive Validator Command Hard-Lock](08-02-cognitive-validator-command-hard-lock.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: 08-04 Structured Findings & Monotonic Repair](08-04-structured-findings-and-monotonic-repair.md)
---

## 1. Forensic Heuristic Catalog

The **Meta-Auditor** evaluates all submitted diffs against seven empirical behavioral heuristics:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                    THE 7 FORENSIC BEHAVIORAL HEURISTICS                     │
├────┬─────────────────────────────┬─────────────────────────────────────────┤
│ H1 │ Tautological Test Detection │ Tests that assert expect(true).toBe(true│
│ H2 │ Silent Scope Creep          │ Modifying files outside granted scopes. │
│ H3 │ Mock Subversion             │ Replacing real logic with hardcoded mock│
│ H4 │ Context Amnesia             │ Deleting existing functions / comments. │
│ H5 │ Superficial Patching        │ Adding // @ts-ignore instead of typing. │
│ H6 │ Suppression Leaks           │ Silencing linter / compiler warnings.   │
│ H7 │ Unfalsifiable Gate Claims   │ Claiming passes without command receipts│
└────┴─────────────────────────────┴─────────────────────────────────────────┘
```

---

[⏮️ Previous: 08-02 Cognitive Validator Command Hard-Lock](08-02-cognitive-validator-command-hard-lock.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: 08-04 Structured Findings & Monotonic Repair](08-04-structured-findings-and-monotonic-repair.md)
---

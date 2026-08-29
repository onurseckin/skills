# Honesty Verification Gates & Anti-Fabrication

[OLT Documentation Hub](../../README.md) > [Architecture Index](../index.md) > [Chapter 11](./index.md) > 11-03 Honesty Gates

---

[⏮️ Previous: 11-02 Strict 1:1 Anti-Batching Leases](11-02-strict-one-to-one-anti-batching.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: 11-04 Agent Grant Ledger & Authority Locks](11-04-agent-grant-ledger-and-authority-locks.md)
---

## 1. Rejection of Simulated & Tautological Proofs

The Honesty Verification Engine inspects all test receipts for fabrication:

- Rejecting mock functions that return constant true without executing business logic.
- Detecting skipped test suites (`test.skip()`, `xit()`).
- Revoking agent credentials if fabrication is detected.

---

[⏮️ Previous: 11-02 Strict 1:1 Anti-Batching Leases](11-02-strict-one-to-one-anti-batching.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: 11-04 Agent Grant Ledger & Authority Locks](11-04-agent-grant-ledger-and-authority-locks.md)
---

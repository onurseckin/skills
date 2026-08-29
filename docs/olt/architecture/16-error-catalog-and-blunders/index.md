# Chapter 16: Error Catalog & Empirical Blunders

---

[⏮️ Previous: Chapter 15 Index](../15-state-schemas-and-event-ledger/index.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: 16-01 Exit Status Hierarchy](16-01-exit-status-hierarchy.md)
---

Welcome to Chapter 16 of the **OLT Technical Architecture Manual**.

This chapter contains the authoritative exit code hierarchy, structured `HarnessError` catalog, the 28 empirical failure modes, and automated self-healing playbooks.

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                            CHAPTER 16: ERROR CATALOG & EMPIRICAL BLUNDERS                        │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│  • 16-01. Exit Status Hierarchy: POSIX exit codes (0, 3, 4, 70) and zero-mutation guarantees     │
│  • 16-02. Harness Error Codes & Payloads: complete dictionary of 12 HarnessError codes           │
│  • 16-03. Twenty-Eight Empirical Blunders: failure patterns across planning, validation, state   │
│  • 16-04. Recovery & Mitigation Playbooks: step-by-step remediation procedures                   │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

## Modular Sections

- **[16-01. Exit Status Hierarchy](./16-01-exit-status-hierarchy.md)**: POSIX exit code taxonomy, zero-mutation guarantee, and stream routing.
- **[16-02. Harness Error Codes & Payloads](./16-02-harness-error-codes-and-payloads.md)**: Structured error schemas, repair argument vectors, and code exemplars.
- **[16-03. Twenty-Eight Empirical Blunders](./16-03-twenty-eight-empirical-blunders.md)**: Catalog of 28 empirical failures (`LP`, `VP`, `VT`, `BR`, `MC`, `SM`, `G5`).
- **[16-04. Recovery & Mitigation Playbooks](./16-04-recovery-and-mitigation-playbooks.md)**: Self-healing playbooks for torn logs, stale leases, and stuck gates.

---

[⏮️ Previous: Chapter 15 Index](../15-state-schemas-and-event-ledger/index.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: 16-01 Exit Status Hierarchy](16-01-exit-status-hierarchy.md)
---

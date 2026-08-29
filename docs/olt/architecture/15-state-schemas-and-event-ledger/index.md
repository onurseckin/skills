# Chapter 15: State Schemas & Capsule Event Ledger

---

[⏮️ Previous: Chapter 14 Index](../14-harness-cli-and-command-engine/index.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: 15-01 Capsule Filesystem Layout](15-01-capsule-filesystem-layout.md)
---

Welcome to Chapter 15 of the **OLT Technical Architecture Manual**.

This chapter provides formal JSON schema specifications (Draft 2020-12) and storage models for every artifact in the OLT capsule directory hierarchy.

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                            CHAPTER 15: STATE SCHEMAS & CAPSULE EVENT LEDGER                      │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│  • 15-01. Capsule Filesystem Layout: single-task vs generational mind directories                │
│  • 15-02. Manifest & Requirements Schemas: prompt binding and line disposition contracts         │
│  • 15-03. Events JSONL & Merkle Schema: immutable event chain and patch definitions              │
│  • 15-04. State JSON & Mailbox Schemas: projected state and inter-agent mailbox messages         │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

## Modular Sections

- **[15-01. Capsule Filesystem Layout](./15-01-capsule-filesystem-layout.md)**: Layout, permissions, and Content-Addressed Storage deduplication.
- **[15-02. Manifest & Requirements Schemas](./15-02-manifest-and-requirements-schemas.md)**: Schemas for `manifest.json`, `requirements.json`, and prompt capture.
- **[15-03. Events JSONL & Merkle Schema](./15-03-events-jsonl-and-merkle-schema.md)**: Append-only hash chain event formats and Merkle audit trails.
- **[15-04. State JSON & Mailbox Schemas](./15-04-state-json-and-mailbox-schemas.md)**: Materialized projections, task states, and inter-agent communication envelopes.

---

[⏮️ Previous: Chapter 14 Index](../14-harness-cli-and-command-engine/index.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: 15-01 Capsule Filesystem Layout](15-01-capsule-filesystem-layout.md)
---

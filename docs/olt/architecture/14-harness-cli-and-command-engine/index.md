# Chapter 14: Harness CLI & Command Execution Engine

---

[⏮️ Previous: Chapter 13 Index](../13-policy-rbac-failclosed-engine/index.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: 14-01 Lifecycle & Run Commands](14-01-lifecycle-and-run-commands.md)
---

Welcome to Chapter 14 of the **OLT Technical Architecture Manual**.

This chapter details the CLI command architecture, parsing mechanics, parameter validation, and command execution pipelines spanning all 15 functional domains of the OLT Harness.

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                               CHAPTER 14: HARNESS CLI & COMMAND ENGINE                           │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│  • 14-01. Lifecycle & Run Commands: run:*, plan:*, queue:*                                       │
│  • 14-02. Task & Worker Commands: task:*, branch:*, inspection:*                                 │
│  • 14-03. Mind & Preplanning Commands: mind:*                                                    │
│  • 14-04. Doctor & Diagnostics Commands: doctor:*, gate:*, graph:*, role:*, explain:*            │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

## Modular Sections

- **[14-01. Lifecycle & Run Commands](./14-01-lifecycle-and-run-commands.md)**: Exhaustive flag tables, parameter types, stdin handling, and exit statuses for run lifecycle commands.
- **[14-02. Task & Worker Commands](./14-02-task-and-worker-commands.md)**: Complete guide to task leasing, branch isolation, and inspection commands.
- **[14-03. Mind & Preplanning Commands](./14-03-mind-and-preplanning-commands.md)**: Command reference for the autonomous Mind supervisor suite.
- **[14-04. Doctor & Diagnostics Commands](./14-04-doctor-and-diagnostics-commands.md)**: Reference for verification engines, diagnostics, and gate evaluation commands.

---

[⏮️ Previous: Chapter 13 Index](../13-policy-rbac-failclosed-engine/index.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: 14-01 Lifecycle & Run Commands](14-01-lifecycle-and-run-commands.md)
---

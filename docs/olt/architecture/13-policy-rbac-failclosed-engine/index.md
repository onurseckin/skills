# Chapter 13: Policy, Mechanical RBAC & Fail-Closed Engine

[OLT Documentation Hub](../../README.md) > [Architecture Index](../index.md) > Chapter 13: Policy, Mechanical RBAC & Fail-Closed Engine

---

[⏮️ Previous: Chapter 12: Flock Mailboxes & Live TUI](../12-flock-mailboxes-and-tui/index.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: 13-01 Mechanical RBAC Compiler](13-01-mechanical-rbac-compiler.md)
---

## 1. Chapter Overview

Autonomous multi-agent swarms require kernel-level security guarantees. Allowing unconstrained shell execution or indiscriminate file edits leads to catastrophic repository clobbering, security breaches, and prompt injection exploits.

OLT enforces a **Fail-Closed Security Architecture** powered by the **Mechanical RBAC Compiler**, **10 AST Static Purity Checkers**, **Fail-Closed Permission Gates**, and the **Supervisor Zero-File-Edit Rule**.

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                            CHAPTER 13: POLICY & RBAC TOPOLOGY                                    │
├──────────────────────────┬──────────────────────────┬────────────────────────────────────────────┤
│ Sub-Topic                │ Key Architectural Model  │ Primary Invariants Enforced                │
├──────────────────────────┼──────────────────────────┼────────────────────────────────────────────┤
│ 01. Mechanical RBAC      │ Declarative Policy AST   │ Strict Role Verb Filters & Scope Regexes   │
│ 02. AST Purity Engine    │ 10 Static AST Linters    │ Zero any types, compiler suppressions, etc │
│ 03. Fail-Closed Gates    │ Default-Deny Envelope    │ Block Unauthorized Tool & Shell Calls      │
│ 04. Zero-File-Edit Rule  │ Supervisor Confinement   │ Tiers 0, 1, 2 Pure Oversight Mandate       │
└──────────────────────────┴──────────────────────────┴────────────────────────────────────────────┘
```

---

## 2. Table of Contents

1. **[13-01: Mechanical RBAC Compiler](./13-01-mechanical-rbac-compiler.md)**  
   _RBAC policy manifest schema (`policy.json`), permission compilation, runtime filtering._
2. **[13-02: Static AST Lint Purity Engine](./13-02-static-ast-lint-purity-engine.md)**  
   _The 10 AST static purity checkers in detail, AST traversal, automated code quality._
3. **[13-03: Fail-Closed Permission Gates](./13-03-fail-closed-permission-gates.md)**  
   _Fail-closed architecture, default-deny execution, sandbox escaping prevention._
4. **[13-04: Zero-File-Edit Rule for Supervisors](./13-04-zero-file-edit-rule-for-supervisors.md)**  
   _The Zero-File-Edit Rule for Tiers 0, 1, and 2 supervisors, delegation enforcement._

---

[⏮️ Previous: Chapter 12: Flock Mailboxes & Live TUI](../12-flock-mailboxes-and-tui/index.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: 13-01 Mechanical RBAC Compiler](13-01-mechanical-rbac-compiler.md)
---

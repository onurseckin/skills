# Cowan Token Budgeting & Context Sanitization

[OLT Documentation Hub](../../README.md) > [Architecture Index](../index.md) > [Chapter 07](./index.md) > 07-04 Cowan Token Budgeting

---

[⏮️ Previous: 07-03 Stale Worker & Zombie Auto-Recovery](07-03-stale-worker-and-zombie-auto-recovery.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: Chapter 08: Adversarial Validation & Monotonic Repair](../08-adversarial-validation-repair/index.md)
---

## 1. Cognitive Window Management

Large Language Models degrade significantly when saturated with irrelevant context. OLT enforces a hard **150k token budget envelope** per agent invocation.

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                       150K TOKEN BUDGET ALLOCATION                          │
├──────────────────────────┬──────────────────────────┬───────────────────────┤
│ System Prompt & RBAC     │ Task Scope & AST Slices  │ Free Workspace        │
│ 15,000 Tokens (10%)      │ 45,000 Tokens (30%)      │ 90,000 Tokens (60%)   │
└──────────────────────────┴──────────────────────────┴───────────────────────┘
```

---

## 2. Prompt Injection Defense & Sanitization

All external text, user comments, and file contents read from disk are passed through an untrusted content sandbox, escaping markdown injection delimiters and stripping hidden system prompt overrides.

---

[⏮️ Previous: 07-03 Stale Worker & Zombie Auto-Recovery](07-03-stale-worker-and-zombie-auto-recovery.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: Chapter 08: Adversarial Validation & Monotonic Repair](../08-adversarial-validation-repair/index.md)
---

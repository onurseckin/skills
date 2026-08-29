# Cognitive Validator Command Hard-Lock

[OLT Documentation Hub](../../README.md) > [Architecture Index](../index.md) > [Chapter 08](./index.md) > 08-02 Command Hard-Lock

---

[⏮️ Previous: 08-01 Adversarial Validation Philosophy](08-01-adversarial-validation-philosophy.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: 08-03 Meta-Auditor 7 Forensic Heuristics](08-03-meta-auditor-seven-forensic-heuristics.md)
---

## 1. The Zero-Command Invariant ($C_7$)

Reviewers that execute shell commands frequently "fix" test failures by silently editing test assertions or disabling assertions to make tests green.

OLT enforces the **Cognitive Validator Command Hard-Lock**:

$$\text{Role} = \text{CognitiveValidator} \implies \text{PermittedCommands} = \emptyset$$

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                 COGNITIVE VALIDATOR HARD-LOCK ENFORCEMENT                   │
├─────────────────────────────────────────────────────────────────────────────┤
│ PERMITTED:                                                                  │
│ • AST Traversal & Static Diff Analysis                                      │
│ • Reading Cryptographic Execution Receipts (record.json)                   │
│ • Emitting Structured Finding Payloads (findings.json)                      │
├─────────────────────────────────────────────────────────────────────────────┤
│ FORBIDDEN (EXIT 3: ROLE_CONFINEMENT_VIOLATION):                             │
│ • Shell execution (bun test, npm run, bash, exec)                           │
│ • Direct file edits (write_file, replace_content)                           │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

[⏮️ Previous: 08-01 Adversarial Validation Philosophy](08-01-adversarial-validation-philosophy.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: 08-03 Meta-Auditor 7 Forensic Heuristics](08-03-meta-auditor-seven-forensic-heuristics.md)
---

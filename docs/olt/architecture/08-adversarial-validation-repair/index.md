# Chapter 08: Adversarial Validation & Monotonic Repair

[OLT Documentation Hub](../../README.md) > [Architecture Index](../index.md) > Chapter 08: Adversarial Validation & Monotonic Repair

---

[⏮️ Previous: Chapter 07: Distributed Leasing & Execution](../07-distributed-leasing-execution/index.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: 08-01 Adversarial Validation Philosophy](08-01-adversarial-validation-philosophy.md)
---

## 1. Chapter Overview

Self-grading coding agents consistently fail due to sycophancy: an agent that writes a bug will rationalize the bug when asked to review its own work.

OLT enforces strict **Adversarial Validation**:

- **Epistemic Separation**: The reviewer is never the implementer.
- **Cognitive Validator Command Hard-Lock**: Validators are strictly forbidden from running shell commands (0 mutating executions), reviewing code exclusively via AST structural analysis and cryptographic proof receipts.
- **7 Meta-Auditor Forensic Heuristics**: Deep detection of subtle blunders (mock subversion, tautological tests, suppression leaks).
- **Monotonic Repair Waves**: Targeted defect resolution ($k \le 3$) without chaotic global retries.

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                            CHAPTER 08: ADVERSARIAL REVIEW TOPOLOGY                               │
├──────────────────────────┬──────────────────────────┬────────────────────────────────────────────┤
│ Sub-Topic                │ Key Architectural Model  │ Primary Invariants Enforced                │
├──────────────────────────┼──────────────────────────┼────────────────────────────────────────────┤
│ 01. Adversarial Review   │ Epistemic Separation     │ Implementer != Validator (Anti-Sycophancy) │
│ 02. Command Hard-Lock    │ 0 Mutating Commands      │ AST-Only Cognitive Code Review             │
│ 03. 7 Forensic Heuristic │ Forensic Blunder Scans   │ H1–H7 Behavioral Anti-Patterns             │
│ 04. Monotonic Repair     │ Structured Findings P0-P3│ Repair Waves (k <= 3) & Defect Isolation   │
└──────────────────────────┴──────────────────────────┴────────────────────────────────────────────┘
```

---

## 2. Table of Contents

1. **[08-01: Adversarial Validation Philosophy](./08-01-adversarial-validation-philosophy.md)**  
   _Socratic reflexive probing, separation of implementer and reviewer, anti-sycophancy._
2. **[08-02: Cognitive Validator Command Hard-Lock](./08-02-cognitive-validator-command-hard-lock.md)**  
   _Strict 0-command execution policy for cognitive validators, AST-only inspection._
3. **[08-03: Meta-Auditor Seven Forensic Heuristics](./08-03-meta-auditor-seven-forensic-heuristics.md)**  
   _The 7 root-cause behavioral heuristics of Meta-Auditor Forensics ($H_1 \dots H_7$)._
4. **[08-04: Structured Findings & Monotonic Repair](./08-04-structured-findings-and-monotonic-repair.md)**  
   _Structured finding schema ($P_0 \dots P_3$), monotonic repair waves ($k \le 3$), defect isolation._

---

[⏮️ Previous: Chapter 07: Distributed Leasing & Execution](../07-distributed-leasing-execution/index.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: 08-01 Adversarial Validation Philosophy](08-01-adversarial-validation-philosophy.md)
---

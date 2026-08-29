# Structured Findings & Monotonic Repair Routing

[OLT Documentation Hub](../../README.md) > [Architecture Index](../index.md) > [Chapter 08](./index.md) > 08-04 Monotonic Repair

---

[⏮️ Previous: 08-03 Meta-Auditor 7 Forensic Heuristics](08-03-meta-auditor-seven-forensic-heuristics.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: Chapter 09: Falsifiable Evidence Gates](../09-falsifiable-evidence-gates/index.md)
---

## 1. Structured Finding Schema ($P_0 \dots P_3$)

When validation fails, findings are formatted into schema-validated JSON:

```json
{
  "severity": "P0",
  "rule": "TAUTOLOGICAL_TEST_ASSERTION",
  "file": "tests/auth.test.ts",
  "line": 42,
  "description": "Test asserts expect(token).toBeDefined() without verifying signature.",
  "remediation": "Add assertion verifying JWT signature against public key."
}
```

- **$P_0$ (Blocker)**: Critical bug or security vulnerability; halts wave.
- **$P_1$ (Defect)**: Functional requirement failure; triggers repair subtask.
- **$P_2$ (Quality)**: AST lint or modular budget warning; non-blocking.
- **$P_3$ (Nit)**: Stylistic suggestion; recorded for telemetry.

---

## 2. Monotonic Repair Waves ($k \le 3$)

Repair tasks are strictly targeted to the isolated defect ($k \le 3$). If a task fails 3 consecutive repair attempts, it is quarantined for human escalation.

---

[⏮️ Previous: 08-03 Meta-Auditor 7 Forensic Heuristics](08-03-meta-auditor-seven-forensic-heuristics.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: Chapter 09: Falsifiable Evidence Gates](../09-falsifiable-evidence-gates/index.md)
---

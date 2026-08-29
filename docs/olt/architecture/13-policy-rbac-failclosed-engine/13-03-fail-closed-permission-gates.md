# Fail-Closed Permission Gates & Default-Deny Architecture

[OLT Documentation Hub](../../README.md) > [Architecture Index](../index.md) > [Chapter 13](./index.md) > 13-03 Fail-Closed Gates

---

[⏮️ Previous: 13-02 Static AST Lint Purity Engine](13-02-static-ast-lint-purity-engine.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: 13-04 Zero-File-Edit Rule for Supervisors](13-04-zero-file-edit-rule-for-supervisors.md)
---

## 1. Default-Deny Execution Envelope

If an agent attempts an action that is not explicitly whitelisted in its active RBAC grant, the permission gate triggers **Fail-Closed Rejection**:

- Intercepts the tool call before execution.
- Emits a security audit event to `events.jsonl`.
- Terminates the subagent process with **Exit Code 3 (`ROLE_CONFINEMENT_VIOLATION`)**.

---

[⏮️ Previous: 13-02 Static AST Lint Purity Engine](13-02-static-ast-lint-purity-engine.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: 13-04 Zero-File-Edit Rule for Supervisors](13-04-zero-file-edit-rule-for-supervisors.md)
---

# Mechanical RBAC Compiler & Permission Filters

[OLT Documentation Hub](../../README.md) > [Architecture Index](../index.md) > [Chapter 13](./index.md) > 13-01 Mechanical RBAC Compiler

---

[⏮️ Previous: Chapter 13: Policy, Mechanical RBAC & Fail-Closed Engine Overview](index.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: 13-02 Static AST Lint Purity Engine](13-02-static-ast-lint-purity-engine.md)
---

## 1. Declarative Policy Manifest (`policy.json`)

The security boundary of every role is formally defined in `olt/policy.json`:

```json
{
  "roles": {
    "coordinator": {
      "tier": 2,
      "allowed_verbs": ["task:claim", "task:heartbeat", "task:retry", "queue:wave"],
      "denied_verbs": ["task:submit", "git:commit", "file:write"],
      "write_scope": []
    },
    "implementer": {
      "tier": 3,
      "allowed_verbs": ["task:submit", "task:check", "file:write", "file:edit"],
      "denied_verbs": ["queue:wave", "run:complete", "mind:*"],
      "write_scope": ["dynamic:grant_ledger"]
    }
  }
}
```

The **Mechanical RBAC Compiler** translates this declarative schema into runtime interception gates that filter every command before execution.

---

[⏮️ Previous: Chapter 13: Policy, Mechanical RBAC & Fail-Closed Engine Overview](index.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: 13-02 Static AST Lint Purity Engine](13-02-static-ast-lint-purity-engine.md)
---

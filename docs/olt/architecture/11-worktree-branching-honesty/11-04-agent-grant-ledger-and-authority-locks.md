# Agent Grant Ledger & Session Authority Locks

[OLT Documentation Hub](../../README.md) > [Architecture Index](../index.md) > [Chapter 11](./index.md) > 11-04 Agent Grant Ledger

---

[⏮️ Previous: 11-03 Honesty Verification Gates](11-03-honesty-gates-and-anti-fabrication.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: Chapter 12: Flock Mailboxes & Live TUI](../12-flock-mailboxes-and-tui/index.md)
---

## 1. Dynamic Capability Elevation

Agents start with default-deny permissions. When a task requires writing to a specific subsystem (e.g. `src/auth/`), the coordinator issues a temporary grant recorded in the **Agent Grant Ledger**:

```json
{
  "grant_id": "grant-901",
  "agent_id": "implementer_auth_task-1",
  "allowed_paths": ["src/auth/**", "tests/auth/**"],
  "expires_at": 1756470000
}
```

Upon task submission or lease expiry, the grant is revoked immediately.

---

[⏮️ Previous: 11-03 Honesty Verification Gates](11-03-honesty-gates-and-anti-fabrication.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: Chapter 12: Flock Mailboxes & Live TUI](../12-flock-mailboxes-and-tui/index.md)
---

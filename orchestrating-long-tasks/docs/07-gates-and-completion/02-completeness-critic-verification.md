# 02. Completeness Critic Verification Protocol

[⬅ Previous: Mandatory Gate Systems](./01-mandatory-gate-systems.md) | [Master Table of Contents](../README.md) | [Next: Mechanical Completion Engine ➡](./03-mechanical-completion-engine.md)

---

## 🎯 The Purpose of the Completeness Critic

While individual task validators review isolated subfolder scopes, a macro-level risk remains: **Systemic Blind Spots**.

- Did the agents implement all tasks, but forget a global cross-cutting user requirement?
- Are all generated artifact files physically present on disk with valid byte sizes?
- Does every line of the original prompt have a verified requirement and task disposition?

The **Completeness Critic** is an independent auditing role that evaluates the entire repository and execution history before run finalization.

---

## 🔐 The Critic Lifecycle: `critic:start` and `critic:review`

The critic evaluation workflow follows a secure sequence:

```text
[ Coordinator initiates completeness review ]
                 │
                 ▼
     (bun harness.ts critic:start --run .capsules/<slug> --critic <critic-id>)
                 │
                 ├── Generates high-entropy bearer token (e.g. `critic-tok-992...`)
                 ├── Calculates token digest (SHA-256)
                 └── Records critic session in events.jsonl
                 │
                 ▼
     (Critic inspects requirements, diffs, and runs validation commands)
                 │
                 ▼
     (bun harness.ts critic:review --run .capsules/<slug> --critic <critic-id> --token <token> --decision approve --summary "...")
                 │
                 └── Submits audited verdict (`approve` or `reject`)
```

---

## 📝 Critic Verification Review

The critic evaluates the repository and submits its verdict:

```bash
bun harness.ts critic:review \
  --run .capsules/<run-id> \
  --critic critic-lead \
  --token <critic-token> \
  --decision approve \
  --summary "Audited all requirements against live code. Verified that all documentation chapters exist, contain bidirectional navigation links, and strictly satisfy the Zero-JSON CLI API requirements."
```

---

## 🛡️ Critic Verification Rules

1. **Token Digest Verification:** The critic token presented on review submission must cryptographically match the SHA-256 digest recorded in the active critic session.
2. **Exhaustive Requirement Review:** The critic must evaluate all requirements defined in the compiled plan.
3. **Artifact Integrity Audit:** The critic verifies that all declared files and directories are physically inspectable, non-empty, and free of placeholder stubs.

---

[⬅ Previous: Mandatory Gate Systems](./01-mandatory-gate-systems.md) | [Master Table of Contents](../README.md) | [Next: Mechanical Completion Engine ➡](./03-mechanical-completion-engine.md)

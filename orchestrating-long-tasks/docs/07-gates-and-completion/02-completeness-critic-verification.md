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

## 🔐 The Critic Token Lifecycle

The critic evaluation workflow follows a secure 3-step sequence:

```text
[ Coordinator initiates completion review ]
                 │
                 ▼
     (harness.ts begin-critic)
                 │
                 ├── Generates high-entropy bearer token (e.g. `critic-tok-992...`)
                 ├── Calculates token digest (SHA-256)
                 └── Records `completion-critic-started` in events.jsonl
                 │
                 ▼
     (harness.ts packet --role critic)
                 │
                 └── Publishes sanitised `critic.md` packet
                 │
                 ▼
     (harness.ts review-completion)
                 │
                 └── Submits audited verdict (`pass` or `reject`)
```

---

## 📝 The Completion Review Payload

The critic evaluates the repository and submits a structured JSON payload:

```json
{
  "verdict": "pass",
  "summary": "Audited all 10 requirements against live code. Verified that all 27 markdown documentation files exist, contain bidirectional navigation links, and strictly satisfy the junior-developer tutorial mandate.",
  "reviewed_requirement_ids": [
    "R-INIT-CAPSULE",
    "R-DECISION-MAKING",
    "R-TASK-MANAGEMENT",
    "R-MULTI-AGENT-DEPLOY",
    "R-TASK-FOLLOWING",
    "R-TRACKING-FEEDBACK",
    "R-EXTENDED-SYSTEMS",
    "R-COMPLETION-GIT-PUSH"
  ],
  "findings": []
}
```

---

## 🛡️ Critic Verification Rules

1. **Token Digest Verification:** The critic token presented on review submission must cryptographically match the SHA-256 digest recorded in the active `completion_critic` record.
2. **Exhaustive Requirement Review:** The critic must evaluate and list every requirement defined in `requirements.json`.
3. **Artifact Integrity Audit:** The critic verifies that all declared artifacts in `graph.json` are physically inspectable, non-empty, and free of placeholder stubs.

---

[⬅ Previous: Mandatory Gate Systems](./01-mandatory-gate-systems.md) | [Master Table of Contents](../README.md) | [Next: Mechanical Completion Engine ➡](./03-mechanical-completion-engine.md)

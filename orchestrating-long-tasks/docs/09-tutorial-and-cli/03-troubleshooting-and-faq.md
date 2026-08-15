# 03. Troubleshooting, Common Pitfalls & FAQ

[⬅ Previous: CLI Command Reference](./02-cli-command-reference.md) | [Master Table of Contents](../README.md)

---

## ❓ Frequently Asked Questions

### Q1: Why did `task:submit` fail with `WRITE_SCOPE_VIOLATION`?

**A:** The implementer modified files outside the `write_scope` assigned during `plan:add`. Inspect the task's write scope in `plan:status` or `run:status`, and restrict all edits strictly to that subdirectory.

### Q2: Why did `plan:compile` fail with an integrity error?

**A:** `plan:compile` verifies 100% line disposition coverage against the verbatim prompt in `prompt.md`. Ensure every task or requirement maps directly to lines in the prompt, and all required tasks have been added via `plan:add`.

### Q3: What happens when a validator rejects a task?

**A:** The task transitions to `changes_requested`. The implementer can re-claim the task via `task:claim`, apply fixes based on the findings, and re-submit via `task:submit`. The maximum number of repair rounds is configurable in `harness.config.json` (default `5`).

---

## ⚠️ Common Pitfalls & How to Avoid Them

| Pitfall                     | Root Cause                                                | Solution                                                                                                        |
| :-------------------------- | :-------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------- |
| **Self-Validation Failure** | Implementer attempts to validate its own task.            | The harness enforces strict role separation. Always dispatch a distinct validator ID via `task:validate-start`. |
| **Gate Stale Mismatch**     | Repository files were modified after gate execution.      | Re-run the gate command via `run:exec --gate <gate-id>` to capture fresh `trusted_host_observed_v1` evidence.   |
| **Shell String in Gate**    | Passing `"bun test tests/*.ts"` as a single shell string. | Use literal bare executable string arrays: `["bun", "test", "tests/foo.test.ts"]`.                              |
| **Unanchored Prompt Lines** | Leaving prompt lines without requirement mappings.        | Every non-blank line in `prompt.md` must be covered when compiling the plan with `plan:compile`.                |

---

## 🧭 Master Navigation Hub

| Section | Chapter Title                                                                          | Primary Topics                                           |
| :------ | :------------------------------------------------------------------------------------- | :------------------------------------------------------- |
| **01**  | [Foundations & Architecture](../01-foundations/01-why-long-tasks-fail.md)              | Failure modes, run capsule, 9-stage lifecycle.           |
| **02**  | [Requirements & Decisions](../02-requirements/01-prompt-capture-and-integrity.md)      | Prompt integrity, line disposition, authority decisions. |
| **03**  | [Graph Scheduler](../03-graph-scheduler/01-dependency-graph-theory.md)                 | DAG theory, topological batching, plan revisions.        |
| **04**  | [Multi-Agent Deployment](../04-multi-agent/01-host-agnostic-architecture.md)           | Two-Tier hierarchy, role briefs, bearer tokens.          |
| **05**  | [Task Lifecycle & Execution](../05-task-execution/01-leasing-and-heartbeats.md)        | Leases, write scopes, task:submit, run:exec.             |
| **06**  | [Validation & Repair](../06-validation-repair/01-adversarial-validation-philosophy.md) | Adversarial review, finding schema, 5-round limits.      |
| **07**  | [Gates & Completion](../07-gates-and-completion/01-mandatory-gate-systems.md)          | Gate contracts, critic protocol, terminal checklist.     |
| **08**  | [Durability & Recovery](../08-durability-recovery/01-tamper-proof-hash-chains.md)      | Hash chains, flock/fdatasync, torn tail quarantine.      |
| **09**  | [Tutorial & CLI Reference](../09-tutorial-and-cli/01-end-to-end-tutorial.md)           | End-to-end tutorial, CLI manual, troubleshooting.        |

---

[⬅ Previous: CLI Command Reference](./02-cli-command-reference.md) | [Master Table of Contents](../README.md)

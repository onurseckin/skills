# 03. Troubleshooting, Common Pitfalls & FAQ

[⬅ Previous: CLI Command Reference](./02-cli-command-reference.md) | [Master Table of Contents](../README.md)

---

## ❓ Frequently Asked Questions

### Q1: Why did `harness run` fail with `INVALID_SCOPE`?

**A:** The implementer modified or targeted a file outside the `write_scope` declared in `graph.json`. Check the task's assigned `write_scope` array and keep all edits strictly within those directories.

### Q2: Why did `plan-apply` reject my revision?

**A:** `plan-apply` uses optimistic concurrency control (`--expected-revision <N>`). If another actor or event updated the graph since you read it, inspect `harness.ts status` to obtain the latest revision integer, and re-run with the updated `--expected-revision`.

### Q3: Why is my task stuck in `validating`?

**A:** An agent started validation via `begin-validation` but hasn't submitted a review. If the validator timed out or crashed, run:

```bash
bun orchestrating-long-tasks/scripts/harness.ts recover --run .capsules/<run-id> --actor coordinator --grace-seconds 0
```

This reclaims expired leases and resets the validation state.

---

## ⚠️ Common Pitfalls & How to Avoid Them

| Pitfall                     | Root Cause                                                      | Solution                                                                                                |
| :-------------------------- | :-------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------ |
| **Self-Validation Failure** | Implementer attempts to submit `review` using its own agent ID. | The harness enforces strict role separation. Always spawn a distinct validator agent ID for validation. |
| **Gate Stale Mismatch**     | Repository files were modified after the gate test was run.     | Re-run the gate command via `harness run --gate <gate-id>` to capture the live repository binding.      |
| **Shell String in Gate**    | Passing `"bun test tests/*.ts"` as a single string.             | Use bare string arrays: `["bun", "test", "tests/foo.test.ts"]`.                                         |
| **Unanchored Prompt Lines** | Leaving prompt lines without requirement mappings.              | Every line in `prompt.md` must appear in at least one requirement `prompt_lines` array.                 |

---

## 🧭 Master Navigation Hub

| Section | Chapter Title                                                                          | Primary Topics                                           |
| :------ | :------------------------------------------------------------------------------------- | :------------------------------------------------------- |
| **01**  | [Foundations & Architecture](../01-foundations/01-why-long-tasks-fail.md)              | Failure modes, run capsule, lifecycle.                   |
| **02**  | [Requirements & Decisions](../02-requirements/01-prompt-capture-and-integrity.md)      | Prompt integrity, line disposition, authority decisions. |
| **03**  | [Graph Scheduler](../03-graph-scheduler/01-dependency-graph-theory.md)                 | DAG theory, topological batching, plan revisions.        |
| **04**  | [Multi-Agent Deployment](../04-multi-agent/01-host-agnostic-architecture.md)           | Subagent models, role packets, bearer tokens.            |
| **05**  | [Task Lifecycle & Execution](../05-task-execution/01-leasing-and-heartbeats.md)        | Leases, write scopes, evidence submission.               |
| **06**  | [Validation & Repair](../06-validation-repair/01-adversarial-validation-philosophy.md) | Adversarial review, finding schema, 3-round escalation.  |
| **07**  | [Gates & Completion](../07-gates-and-completion/01-mandatory-gate-systems.md)          | Gate contracts, critic protocol, terminal checklist.     |
| **08**  | [Durability & Recovery](../08-durability-recovery/01-tamper-proof-hash-chains.md)      | Hash chains, flock/fdatasync, torn tail quarantine.      |
| **09**  | [Tutorial & CLI Reference](../09-tutorial-and-cli/01-end-to-end-tutorial.md)           | End-to-end tutorial, CLI manual, troubleshooting.        |

---

[⬅ Previous: CLI Command Reference](./02-cli-command-reference.md) | [Master Table of Contents](../README.md)

# 03. Plan Revision, Replanning & Immutability

[⬅ Previous: Topological Conflict-Free Batching](./02-topological-conflict-free-batching.md) | [Master Table of Contents](../README.md) | [Next: Chapter 04 — Host-Agnostic Architecture ➡](../04-multi-agent/01-host-agnostic-architecture.md)

---

## ❄️ The Structural Freeze Invariant

Once `plan:compile` has run and execution has begun:

> **Structural task contracts, write scopes, produced artifacts, and prerequisite dependencies freeze
> for the duration of the revision.**

Why it has to be this way:

- If an agent could rewrite its own dependencies mid-flight, it could skip a prerequisite.
- If an agent could widen its own write scope, the scheduler's disjointness guarantee — the thing that
  makes parallel lanes safe — would be worthless.

The freeze is enforced by a revision guard: an apply that does not name the revision it expects, or
names a stale one, is refused rather than merged.

---

## 🌿 The Escape Hatch That Is Not a Revision

A working agent that discovers its task splits in two does **not** need a revision. `branch:open`
subdivides work at execution time, inside the scope the agent already holds, and never enters the
plan DAG:

```text
sub-task id S-1 collides with a plan task; a branch never enters the plan DAG
```

A branch cannot renegotiate a contract, because it can only hand down a _proper subset_ of what the
parent already has. That is precisely why it is allowed to happen while the plan is frozen. See
[Chapter 09 §01](../09-branching-and-honesty/01-execution-time-branching.md).

Use a revision when the **contract** must change: a new task, a new dependency, a scope that must
grow. Use a branch when only the **execution** splits.

---

## 📈 Revisions ($0 \to 1 \to 2$)

Revision 0 is the uncompiled planning buffer. `plan:compile` commits revision 1. Two paths raise it
further.

### Manual: declare and recompile

```bash
bun harness.ts plan:add --run .capsules/<slug> --actor planner --id <new-task> \
  --label "<label>" --scope <path> --gate "<gate-cmd>" --requirement-lines "<n>"

bun harness.ts plan:compile --run .capsules/<slug> --actor planner \
  --completion-gate "bun test tests/unit"
```

### Findings-driven: `plan:replan`

```bash
bun harness.ts plan:replan --run .capsules/<slug> --actor coordinator \
  --findings-file findings.json --gate "bun run typecheck" --round 2
```

`plan:replan` ingests validator or critic findings, partitions them into **disjoint write scopes** so
the repair wave can run in parallel, and compiles the next revision. `--gate` supplies the
revalidation command for generated repair tasks; it may be omitted only when the findings declare
their own `revalidation_gate` or the planned task covering that scope has a gate to inherit. There is
no default.

Rules every revision obeys:

1. **Monotonic increment.** Exactly one, and the apply names the revision it expects.
2. **Immutable source requirements.** Original prompt requirements are not deleted or re-scoped.
3. **Preserved history.** `done` tasks, satisfied requirements, gate receipts, findings and validation
   history survive the recompile.
4. **Archived predecessors.** Prior graph states are kept in `plan_history` and in the event chain.
5. **Re-recorded topology.** `state.topology` is rewritten for the new revision, so the wave plan and
   the graph never disagree about which revision they describe.

---

## 📊 What Freezes vs. What Evolves

| Property                 | Behaviour                    | Rationale                                                      |
| :----------------------- | :--------------------------- | :------------------------------------------------------------- |
| **`prompt.md`**          | Immutable, forever           | SHA-256 bound in `manifest.json` at `plan:init`.               |
| **Done task contracts**  | Frozen                       | Completed work cannot be mutated or downgraded.                |
| **Active leased scopes** | Frozen                       | A lease cannot widen or narrow while it is held.               |
| **Task status**          | Evolves                      | Driven by the state machine, recorded in `task.history[]`.     |
| **Findings**             | Appended immutably           | Opened by a verdict, answered by `--resolve` with command ids. |
| **Gate receipts**        | Appended immutably           | `run:exec` records argv, exit, timings, repository binding.    |
| **Branches**             | Appended to `state.branches` | Execution-time only; never a plan node.                        |
| **Agent grants**         | Appended to `state.agents`   | Registered before work, released after.                        |
| **Topology**             | Rewritten per revision       | One authority for waves; no second derivation.                 |
| **New tasks / edges**    | Added via revision $N+1$     | The only way a contract grows.                                 |

---

## 🚦 When Neither Tool Fits

If a task cannot be completed inside its contract and cannot be branched — a shared file must change,
a dependency was missed — the agent stops and reports. It does not take the path silently. The
coordinator then either raises a revision or escalates. A task that has exhausted `max_repair_rounds`
(6) is `escalated` for the same reason: the loop is bounded so a wrong plan surfaces as a decision
rather than as spend.

---

[⬅ Previous: Topological Conflict-Free Batching](./02-topological-conflict-free-batching.md) | [Master Table of Contents](../README.md) | [Next: Chapter 04 — Host-Agnostic Architecture ➡](../04-multi-agent/01-host-agnostic-architecture.md)

# 03. Authority-Gated Obligations & Their Dispositions

[⬅ Previous: Line Disposition Algorithm](./02-line-disposition-algorithm.md) | [Master Table of Contents](../README.md) | [Next: Chapter 03 — Dependency Graph Theory ➡](../03-graph-scheduler/01-dependency-graph-theory.md)

---

## 🛑 The Problem

Some instructions must not be executed autonomously:

- _"Drop the legacy SQLite tables and migrate to Postgres after my approval."_
- _"Deploy the container to production if all tests pass."_
- _"Delete all orphaned S3 buckets."_

Blind execution causes catastrophic loss. Silent omission fails the prompt. Neither is acceptable, so
the harness models the gap explicitly rather than letting an agent decide in prose.

---

## 🧾 What Exists Today, Precisely

### The vocabulary is real and enforced

| Level                          | Values                                                         | Enforcement                                                                                                                                         |
| :----------------------------- | :------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------- |
| Requirement `disposition`      | `actionable`, `needs_authority`                                | `plan:compile` validates the enum. `out_of_scope` is **rejected in a plan**: _"disposition cannot be out_of_scope in a plan; use needs_authority"_. |
| Requirement `authority_status` | `granted`, `declined`                                          | Read by the scheduler's execution-state check and by completion.                                                                                    |
| Runtime disposition            | `actionable`, `needs_authority`, `out_of_scope`                | A requirement that is `needs_authority` without a grant makes its tasks non-executable.                                                             |
| Disposition `rationale`        | required whenever a line links a `needs_authority` requirement | `plan:compile` refuses a bare disposition for a gated obligation.                                                                                   |
| Event                          | `requirement-authority-decided`                                | Appended when a decision is recorded.                                                                                                               |

`proposeBatch` will not schedule a task whose requirements are not `executable`, so a gated
requirement genuinely holds its work back. Completion honours a declined requirement as cleanly
disposed rather than demanding a fabricated proof for it.

### The recording path: `authority:decide`

```bash
bun harness.ts authority:decide --run .capsules/<run-id> --requirement req-prod-deploy \
  --actor coordinator --decision grant \
  --rationale "The user approved the production deploy in the review thread."
```

`--decision` is `grant` or `decline`, both terminal: a second call against an already-decided
requirement is refused with `INVALID_STATE`, and an exact retry (same actor, same rationale) is
idempotent rather than re-appending history. `decline` disposes the requirement `out_of_scope` and
cancels every dormant task built on it alone; it refuses instead if that would invalidate an active
or completed task, so a decline can never retroactively unmake finished work.

This command is deliberately outside every agent's role contract — `--actor` records who decided, but
no `commands:` grant names it, because the decision it records is a human one, not an agent's to make
on its own. `plan:compile` version 1 still derives every requirement as `actionable`, so a compiled
plan does not currently produce a `needs_authority` requirement on its own; see the next section for
how to gate one today.

---

## ✅ How To Handle a Gated Obligation Today

1. **Do not declare a task for it.** `plan:add` is what turns a prompt line into work. Leave the
   gated line unclaimed and `plan:compile` disposes it `kind: "context"` — recorded, visible, and not
   scheduled.
2. **Say so in the enhanced plan.** `plan:enhance --open-question "Line 7 asks for a production
deploy; that needs a human decision before it can be planned."` puts the gap in
   `planning/enhanced-plan.md`, digest-bound and reviewable.
3. **Let the critic see it.** The completeness critic reads every disposition. A `context` disposition
   on an obligation-shaped line is exactly the thing it is meant to question, and it can approve with
   an explicit residual risk or reject and force a replan.
4. **If the human grants it later**, add the task with `plan:add --requirement-lines <that line>` and
   raise the revision with `plan:compile`. The grant becomes an ordinary planned obligation with its
   own gate, which is stronger evidence than an authority flag ever was. `authority:decide` settles a
   requirement the compiler already produced as `needs_authority`; it is not a substitute for planning
   the obligation properly once it is approved.

```text
                     ┌─────────────────────────────────┐
                     │ prompt line asks for a gated act│
                     └────────────────┬────────────────┘
                                      │
                    ┌─────────────────┴─────────────────┐
                    │ human has not decided             │ human granted it
                    ▼                                   ▼
        ┌───────────────────────────┐       ┌───────────────────────────┐
        │ leave it unclaimed        │       │ plan:add --requirement-   │
        │ → disposition "context"   │       │ lines <n> → real task,    │
        │ → plan:enhance records    │       │   real gate, real proof   │
        │   the open question       │       │   at revision N+1         │
        └───────────────────────────┘       └───────────────────────────┘
```

---

## 🚫 What Not To Do

- **Do not fabricate a proof.** A declined or undecided obligation has no test that passes; writing
  one is exactly the assurance inflation the harness exists to prevent.
- **Do not claim the line with a task that does something else.** The requirement's excerpt would
  then quote an obligation the gate never proves, and every mechanical check would still pass.
- **Do not describe the decision only in chat.** Prose is not state. If it is not in
  `planning/enhanced-plan.md` or the graph, the next agent will not see it.

---

## 📌 Mixed Lines

A single line can carry both an actionable and a gated obligation. Bind the actionable half to a task
with `--requirement-lines`; the line is then disposed as a `requirement` naming that task's
requirement, and the gated half belongs in the enhanced plan's open questions until a human settles
it. The line is disposed exactly once either way.

---

[⬅ Previous: Line Disposition Algorithm](./02-line-disposition-algorithm.md) | [Master Table of Contents](../README.md) | [Next: Chapter 03 — Dependency Graph Theory ➡](../03-graph-scheduler/01-dependency-graph-theory.md)

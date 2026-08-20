# 02. Write Scopes & Directory Containment Invariants

[⬅ Previous: Leasing & Heartbeats](./01-leasing-and-heartbeats.md) | [Master Table of Contents](../README.md) | [Next: Submission & Evidence Collection ➡](./03-submission-and-evidence-collection.md)

---

## 🛑 The Principle of Strict Write Containment

In multi-agent systems, "scope creep" often takes the form of uncoordinated file modifications:

- An implementer fixing an authentication bug decides to "clean up formatting" in `src/utils/logger.ts`.
- Another implementer concurrently refactors `src/utils/logger.ts`.
- A git conflict occurs, or one agent silently clobbers the other's changes.

To eliminate this class of bugs entirely, the harness enforces the **Write Scope Containment Invariant**:

> **An agent holding a task lease is strictly forbidden from creating, modifying, formatting, or deleting any file located outside its leased `write_scope`.**

---

## 🔍 Path Normalization & Ancestor Validation

During plan compilation (`plan:compile`) and submission verification (`task:submit`), write scopes are strictly normalized:

1. **No Relative Traversal:** Paths with `.` or `..` components are resolved and normalized relative to repository root.
2. **Normalized Containment:** A modified file path $F$ belongs to scope $S$ when $F == S$, or $F$ sits
   beneath $S$. Scope patterns are glob-aware: `*` matches any run of characters inside one segment and
   `**` absorbs any number of segments, so `docs/**` genuinely contains `docs/concepts/guide.md`.
3. **Quarantine on Boundary Breach:** If touched files during a task submission contain even one file outside the leased write scope, `task:submit` is **instantly rejected with `WRITE_SCOPE_VIOLATION`**.

```text
Task Leased Write Scope: ["orchestrating-long-tasks/docs/05-task-execution"]

Valid File Modifications:
  ✅ orchestrating-long-tasks/docs/05-task-execution/01-leasing-and-heartbeats.md
  ✅ orchestrating-long-tasks/docs/05-task-execution/02-atomic-filesystem-scopes.md

Invalid File Modifications (Rejected with Error):
  ❌ orchestrating-long-tasks/docs/01-foundations/01-why-long-tasks-fail.md  [Out of scope]
  ❌ orchestrating-long-tasks/package.json                                  [Out of scope]
  ❌ tests/execution/suite.test.ts                                          [Out of scope]
```

---

## 🔀 Two Kinds of Scope Test

The harness runs two different scope predicates, and confusing them is a common source of surprise.

| Test                              | Used by                      | Question                                            | Example                                           |
| :-------------------------------- | :--------------------------- | :-------------------------------------------------- | :------------------------------------------------ |
| **Overlap** (`scopeConflict`)     | Scheduler, sibling sub-tasks | _Can these two name the same path?_                 | `src/auth` vs `src/auth/session` → conflict       |
| **Containment** (`scopeContains`) | Branch sub-scopes            | _Does the outer own everything the inner can name?_ | `src/truncate` contains `src/truncate/measure.ts` |

Containment is the stricter one: two scopes can collide without either owning the other, and a
sub-agent may only be handed authority its parent already holds. `branch:open` additionally requires a
**proper** subset — strictly less than the parent holds — which is what makes branch chains terminate.

---

## 📂 Shared Files & Monolithic Configurations

What if multiple tasks need to add exports to a shared `index.ts` or package manifest?

- **Pattern:** Create a dedicated integration task downstream whose write scope is `["src/index.ts"]` or `["package.json"]`.
- **Ordering:** The integration task declares `--deps task-A,task-B`. It runs only after both parallel workers have finished, merging the exports deterministically without races.
- **Anti-pattern:** widening one worker's scope "just this once". The scheduler's disjointness guarantee is what makes the other lane safe, and it is not an approximation.

---

## 🌿 Scoping For Branchability

A task with a **single-file** write scope cannot branch: there is no proper subset to hand down.

```text
sub-task S-1 write scope src/truncate.ts is not a proper subset of the parent
scope src/truncate.ts: a branch must hand down strictly less than it holds
```

If a task is plausibly divisible at execution time, give it a directory scope (`src/truncate`) rather
than a file scope (`src/truncate.ts`). This is a planning decision with real consequences, made before
anyone knows the work will need splitting.

---

[⬅ Previous: Leasing & Heartbeats](./01-leasing-and-heartbeats.md) | [Master Table of Contents](../README.md) | [Next: Submission & Evidence Collection ➡](./03-submission-and-evidence-collection.md)

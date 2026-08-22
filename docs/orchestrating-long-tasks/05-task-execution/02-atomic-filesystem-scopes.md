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

## 🌳 Worktree Isolation (Opt-In)

Write-scope disjointness stops two agents from touching the same _file_. It does not stop a
repo-wide gate — a full test suite, a repo-wide lint — from failing because a **sibling** task in the
same wave left the shared checkout mid-edit when that gate happened to run. Two disjoint write scopes
can still share one working directory, and a gate that walks the whole tree sees everyone's half-written
files at once.

`worktree_isolation` (default **off**) closes that gap by giving each concurrently active task its own
real `git worktree` — a separate checkout, same repository, same object store:

```json
{
  "worktree_isolation": true,
  "commit_per_subphase": true,
  "max_commit_lines": 500,
  "rebase_on_complete": true
}
```

### How the pool is sized and named

At `plan:compile` — never later, never per-claim — the harness reads the just-recorded topology and
provisions **one worktree per task-slot in the widest wave**, then reuses that same pool round-robin
across every later wave. Two tasks are never assigned the same slot while both could still be running,
because every task in one wave is already scope-disjoint from every other task in that wave by
definition. This is a deliberate reading of an ambiguous requirement: sizing the pool to concurrency
rather than to total task count means every concurrent task still gets full isolation without paying for
one checkout per task in the plan.

Every worktree hangs off one shared, never-checked-out anchor branch, `<branch_prefix><run-id>`
(`branch_prefix` defaults to `harness/`), created once at provisioning time. Each worktree's own branch
is a **sibling** of that anchor — `<anchor>--wt-0`, `<anchor>--wt-1`, … — never nested under it, because
Git's ref namespace forbids a ref and a ref-path-prefix of the same name coexisting side by side. The
worktree directories themselves live **outside** the repository, resolved against the repo's _parent_
directory (`worktree_root`, default `../.harness-worktrees`); a configured root that would resolve
inside the repo is refused at provisioning time, not discovered later as a surprise.

### What changes at `task:claim` and `task:submit`

When isolation is on, `task:claim` looks up the task's assigned worktree and the brief names it
explicitly:

```text
### Task Leased: task-slug
- **Agent**: `impl-slug`
- **Isolated Worktree**: `/Users/dev/.harness-worktrees/<run-id>/wt-1` — do all editing there, not in the shared repo checkout.
```

(That path sits beside `/Users/dev/my-repo`, the repository itself — one level up from it, per
`worktree_root`'s default.)

The write-scope content digest described above (§ Effort Evidence, next page) is hashed against **that
worktree's** copy of the write scope, not the shared repository — hashing the shared checkout under
isolation would make every submission read as unchanged, since the agent never touched it.

If `commit_per_subphase` is also on (the default once isolation is on), `task:submit` makes one commit
per task inside its assigned worktree — a _sub-phase_ commit, always tagged `chore:` today (nothing on
a task record yet declares what kind of change it represents, so this is a stated interim policy, not a
guess). A commit past `max_commit_lines` (default 500) is never refused — it is recorded with a
**warning** on the submission result, since only a human coordinator can judge whether a large diff was
actually warranted.

### What isolation does not change

Nothing about this section changes write-scope containment, the overlap-vs-containment tests, or branch
scoping — those are enforced identically whether or not a task happens to be editing inside its own
worktree or the shared checkout. Worktree isolation is purely about **where the bytes physically live
while an agent edits them**; consolidating every worktree's sub-phase commits back onto one branch (and
optionally rebasing that branch onto the base branch's tip) happens once, at `run:complete`, and a
conflict anywhere in that pipeline stops it in place rather than resolving anything on the run's behalf
— see Chapter 07/08 for that mechanism and for `worktree:reclaim`, the explicit, human-decided cleanup
for an abandoned run's disposable worktree directories.

---

[⬅ Previous: Leasing & Heartbeats](./01-leasing-and-heartbeats.md) | [Master Table of Contents](../README.md) | [Next: Submission & Evidence Collection ➡](./03-submission-and-evidence-collection.md)

# 02. Line Disposition & Requirement Derivation

[⬅ Previous: Prompt Capture & Integrity](./01-prompt-capture-and-integrity.md) | [Master Table of Contents](../README.md) | [Next: Authority Decisions & Dispositions ➡](./03-authority-decisions-and-dispositions.md)

---

## 🔍 The 100% Line Disposition Rule

In standard development, an agent reads a 500-word prompt, generates a brief 3-point plan, and gets
to work. Along the way 40% of the subtle constraints are quietly forgotten.

The compiler forbids that outcome with the **100% Line Disposition Invariant**:

> **Every non-blank line of `prompt.md` gets exactly one disposition record during `plan:compile`.**

A line is disposed one of two ways. If a task claims it, its disposition is `kind: "requirement"` and
it names the requirement ids that cover it. If no task claims it, the compiler disposes it as
`kind: "context"` with the rationale _"Contextual background, architectural guidance, or specification
constraints"_.

This matters more than it sounds: a line does **not** silently vanish, and it does **not** block
compilation either. It is recorded as context, visibly, so the completeness critic and a human reader
can both see which lines the plan chose not to turn into work.

Version 1 of the requirements document accepts four disposition kinds — `requirement`, `context`,
`constraint`, `non_actionable` — and the compiler emits the first two.

---

## 🧩 Declaring Tasks and Binding Them to Lines

```bash
bun harness.ts plan:add --run .capsules/<slug> --actor planner --id <task-id> \
  --label "<label>" --scope <path> --gate "<gate-cmd>" --requirement-lines "3-5,8" [--deps <dep-id>]

bun harness.ts plan:status --run .capsules/<slug>

bun harness.ts plan:compile --run .capsules/<slug> --actor planner --completion-gate "bun test tests"
```

Real output of a bound declaration:

```text
### Task Registered: task-slug
- **Label**: Slugify helper
- **Write Scope**: `src/slug.ts`
- **Mandatory Gate**: `bun test tests/slug.test.ts`
- **Dependencies**: None (Parallel-ready)
- **Prompt Binding**: Declared prompt lines 1
- **Plan Size**: 1 tasks registered. Run `plan:compile` when finished adding tasks.
```

---

## 📐 How the Compiler Actually Assigns Lines

The algorithm is short and worth knowing exactly, because its fallback is the source of most
mis-scoped plans.

```text
1. Collect every non-blank prompt line, 1-indexed.
2. Withhold every line any task DECLARED via --requirement-lines, before the sweep starts.
   → A task that named its lines cannot lose them to an earlier task that named none.
3. For each task, in declaration order:
     a. Declared lines?  → use them.
     b. Otherwise        → take the next unclaimed, undeclared line by POSITION, and WARN.
     c. No line left     → fold this task's gate and criterion into the requirement that already
                           claims the fallback line, and WARN. If there is none, fail INTEGRITY.
4. Mint one requirement per task: id `req-<task-id minus the "task-" prefix>`, disposition
   `actionable`, status `planned`, acceptance criteria derived from the task's gate.
5. Dispose every non-blank line: `requirement` if claimed, `context` if not.
```

The positional fallback is a convenience with teeth. Its warning says so:

```text
task task-2 was glued to prompt line 4 by position, not by declaration; pass
--requirement-lines to bind it to the lines it actually implements
```

And when there are more tasks than prompt lines:

```text
task task-9 had no unclaimed prompt line; its gate was folded into requirement req-1.
Bind it with --requirement-lines to give it a requirement of its own
```

**Bind your lines.** A task glued to the wrong line proves the wrong obligation, and the critic will
happily certify the mismatch because every mechanical check passes.

---

## 🔬 One Line, Several Obligations

Users pack multiple obligations into one sentence:

> _"Add Redis caching for user sessions and deploy the schema migration only after I confirm it."_

Two tasks may both declare `--requirement-lines 1`. The line is then disposed once, naming both
requirement ids:

```json
{
  "line": 1,
  "kind": "requirement",
  "requirement_ids": ["req-cache", "req-migrate"]
}
```

One disposition, several requirements — not several dispositions for one line. The compiler counts
dispositions per line and rejects a duplicate.

---

## 📋 The Derived Requirement

Each requirement the compiler mints carries:

| Field               | Value                                                                                                                           |
| :------------------ | :------------------------------------------------------------------------------------------------------------------------------ |
| `id`                | `req-<task suffix>` — `task-slug` yields `req-slug`.                                                                            |
| `source_lines`      | The 1-indexed prompt lines the task bound to.                                                                                   |
| `source_excerpt`    | Byte-exact text of those lines from `prompt.md`.                                                                                |
| `instruction`       | The task's `--goal`, or its `--label` when no goal was given. Not the prompt sentence — read `source_excerpt` for that.         |
| `implementation`    | A template the compiler writes from the label and write scope: _"Implement requirements for `<label>` within scope `<scope>`"_. |
| `subsystem`         | The constant `"runtime/planning"`. The compiler derives nothing here, so do not read it as the target module.                   |
| `acceptance[]`      | Criteria with their own ids, e.g. `crit-req-slug-1`, each naming its evidence.                                                  |
| `candidate_gates[]` | Literal argv plus cwd, derived from the task's `--gate`.                                                                        |
| `priority`          | The task's `--priority`, or `50`.                                                                                               |
| `risk`              | The constant `"medium"`. Nothing measures it; treat it as unset.                                                                |
| `dependencies`      | `req-` ids derived from the task's `--deps`.                                                                                    |
| `disposition`       | `actionable`. `out_of_scope` is rejected in a plan; use `needs_authority`.                                                      |
| `status`            | `planned`, then `satisfied` once proven.                                                                                        |

Three of those fields are placeholders the compiler fills rather than facts it derived —
`implementation`, `subsystem` and `risk`. They are documented here so a reader does not mistake a
constant for a measurement; the fields that carry real information are `source_lines`,
`source_excerpt`, `acceptance[]` and `candidate_gates[]`.

The default acceptance criterion the compiler writes is exactly the gate:

```json
{
  "id": "crit-req-slug-1",
  "criterion": "Task gate `bun test tests/slug.test.ts` passes with exit code 0",
  "evidence": ["Gate execution output for `task-slug`"]
}
```

That is why a task with a weak gate produces a weak requirement. The gate is not a formality attached
to the requirement — for a derived requirement, the gate _is_ the acceptance criterion.

---

[⬅ Previous: Prompt Capture & Integrity](./01-prompt-capture-and-integrity.md) | [Master Table of Contents](../README.md) | [Next: Authority Decisions & Dispositions ➡](./03-authority-decisions-and-dispositions.md)

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

`plan:add` gets an early, advisory look at one of the six structural-audit invariants explained
below: if `--gate` looks like it runs the whole repository's suite against a narrow `--scope`, the
brief carries a `gate_breadth_warning`, and — only when the repository actually already has one — a
`suggested_gate_paths` line naming real, on-disk test paths discovered for that scope (a co-located
test, a mirrored top-level test directory, a same-named file beside it). It never guesses a
convention that isn't already there; a scope with nothing found on disk gets the warning with no
suggestion attached. This is advisory at `plan:add` time — `plan:compile`'s A6-whole-suite-gate check
(below) is what actually refuses to seal the plan over it.

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

A subtlety worth knowing if you ever pass `--requirement-lines` against a prompt containing an
unusual line terminator: "non-blank prompt line" is defined by the exact same Unicode
line-terminator set both here and inside `plan:compile`'s validator (vertical tab, form feed, NEL,
`U+2028`/`U+2029`, not merely `\n`/`\r\n`) — `requirements/prompt-lines.ts`'s `promptLines()` and the
validator that later checks the compiled requirements document both split on the identical regular
expression, deliberately, so a prompt containing one of those less common terminators is never
numbered one way when a task binds to it and a different way when the compiler checks the result.
`--requirement-lines`'s own bounds check (blank line, line number outside the prompt's real length)
runs at the moment the task is _declared_, not at compile time — a typo like `--requirement-lines
"1-999999999"` is refused immediately, before it ever has the chance to materialize a very large set
of line numbers in memory.

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
dispositions per line and rejects a duplicate. When exactly one requirement claims a line, the
disposition instead carries a singular `requirement_id` field, not a one-element `requirement_ids`
array — the field name itself tells a reader whether a line is shared before they look at its value.

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

## 🚧 Two Checks Before a Plan Can Be Sealed (C1 and C6)

Everything above describes what the compiler _builds_. This section describes what makes it
**refuse to build anything at all** — two mechanical checks `plan:compile` runs before it derives a
single requirement, added after a real forensic incident: a run where ten separate tasks shared one
identical `bun run typecheck` gate that would have passed whether any of them did their work or not,
and where a false dependency edge serialized two tasks that never actually touched each other's
files. Nothing in the original compiler (everything documented above) could have caught either
problem — a monolithic decomposition or a false barrier both look like a perfectly ordinary,
mechanically valid plan.

### The Structural Audit (C1)

`graph/plan-audit.ts`'s `auditPlan` runs six named invariants against the planning buffer. Five
produce real findings; the sixth is permanently, deliberately unevaluated:

| Invariant                  | Severity          | What it checks                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| :------------------------- | :---------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A1-granularity**         | blocking          | Only evaluated once the whole plan touches 5+ files. Flags any single task whose write scope expands (on disk, via glob) to more than 3 files — a hint that several distinct pieces of work were compressed into one task.                                                                                                                                                                                                                               |
| **A2-parallelism**         | _never evaluated_ | Would need a grounded count of distinct entities the prompt names, to compare against the task count. The harness refuses to derive that number with an NLP heuristic guessing at it, and no coordinator-declared entity count is collected anywhere for it to compare against instead. **This invariant is permanently reported under `not_evaluated`, never blocking, never passing — it exists as a name in the source, not yet as a working check.** |
| **A3-gate-discrimination** | blocking          | Two tasks with disjoint write scopes but the _identical_ gate command (whitespace-normalized) — a shared gate that passes whether either task did its work or nothing at all — unless **both** tasks carry a matching `gate:prove` falsifiability proof over their current scope (see C3 below).                                                                                                                                                         |
| **A4-false-barrier**       | blocking          | A dependency edge between two tasks whose write scopes don't actually overlap — the same scope-independence analysis the scheduler itself uses to decide what may run in parallel, reused here to catch a barrier the planner drew but the file scopes never justified.                                                                                                                                                                                  |
| **A5-straggler**           | advisory          | Within one concurrency wave carrying at least two tasks with declared `--effort` estimates: any task whose effort is more than 3× the wave's median — the rest of the wave will sit idle waiting on it.                                                                                                                                                                                                                                                  |
| **A6-whole-suite-gate**    | blocking          | A task's gate looks like it runs the whole repository's test suite rather than something scoped to its own write scope — unless proven falsifiable (C3). The run-wide suite belongs to `--completion-gate`, which runs exactly once; a task gate proves its _own_ task.                                                                                                                                                                                  |

Run it standalone at any point to preview the verdict without attempting a compile:

```bash
bun harness.ts plan:audit --run .capsules/<slug> --actor planner
```

`plan:compile` runs the identical check automatically, first, before deriving anything. **The
verdict is recorded as its own `plan-audited` capsule event no matter what happens next** — even a
compile that goes on to refuse because of what the audit found leaves a durable, permanent trace of
exactly what was checked and what it found, rather than a warning printed to a terminal and lost.

A blocking finding can be overridden, but never silently and never in bulk:

```bash
bun harness.ts plan:compile --run .capsules/<slug> --actor planner \
  --completion-gate "bun test tests/unit" \
  --accept-audit "A3-gate-discrimination:task-a and task-b legitimately share the shared-fixture regression test"
```

`--accept-audit` is repeatable, and each one must name a **real, currently-blocking** invariant —
`plan:compile` refuses `--accept-audit "A2-parallelism:..."` outright, since A2 is never blocking to
begin with ("nothing to accept"). There is no blanket override: every blocking invariant this
specific audit run raised needs its own acceptance, naming who accepted it and why. That acceptance
is itself recorded as a `plan-audit-accepted` event — but it does **not** mutate any state that would
suppress the finding on a future compile. If the same plan is later revised and recompiled, the audit
runs completely fresh, and a still-blocking condition needs its `--accept-audit` restated. Acceptance
is attached to one compile attempt, never to the plan as a permanent waiver.

### The Mandatory Topology Declaration (C6)

Every dependency edge a plan declares needs a stated reason. `plan:add --deps <id>` alone leaves that
edge _unjustified_; pairing it with `--dep-reason` records why it exists:

```bash
bun harness.ts plan:add --run .capsules/<slug> --actor planner --id task-b \
  --label "..." --scope src/b --gate "bun test tests/b.test.ts" \
  --deps task-a --dep-reason "task-a:task-b imports the type task-a defines"
```

An unjustified edge is caught at two different moments, with two different weights. At `plan:add`
time it is only **advisory** — the brief notes it, but the task is still registered:

```text
> **Unjustified dependency**: task-a has no --dep-reason yet; plan:compile will refuse to seal without one.
```

At `plan:compile` time it becomes a **hard refusal** (`graph/topology-declaration.ts`'s
`assertTopologyJustified`), run right after the structural audit above and before a single
requirement is derived:

```text
{"ok":false,"error":{"code":"INVALID_ARGUMENT","message":"dependency edge(s) without a declared justification: task-b -> task-a. Pass plan:add --dep-reason task-a:\"<why this edge exists>\" for each one before compiling."}}
```

Unlike the structural audit, this specific check appends **no event of its own** to the chain — it
is a pure validation that either passes silently or throws before compilation begins; the only
record of a refusal here is the CLI error itself. Every justified edge, and the count of tasks with
no dependencies at all (independent roots), is reported on the successful `plan:compile` brief once
the plan does seal.

### Declaring a Whole Glob at Once: `--auto-partition`

This exists as the direct countermeasure for a real, documented incident: a coordinator, faced with a
prompt naming a pattern rather than a fixed list of files ("add a question bank for every topic under
`src/curriculum/mlQuestions/`"), hand-rolled one task per curriculum file by typing out one `plan:add`
call after another — exactly the kind of tedious bookkeeping that tempts a coordinator into
compressing the work into a single monolithic task instead, the precise failure A1-granularity above
exists to catch. `plan:add --auto-partition` closes the gap the other way: it lets the harness itself
enumerate what actually exists on disk and derive one task per match, so "fewer tasks means less
bookkeeping" stops being the path of least resistance:

```bash
bun harness.ts plan:add --run .capsules/<slug> --id task-topic --label "Topic bank" \
  --actor planner --auto-partition "src/curriculum/mlQuestions/*.ts" \
  --gate-template "bun test {scope}"
```

- The glob is matched against the real repository tree (symlinks are skipped, `.git`,
  `.capsules`, `node_modules` and similar directories are never descended into) — the planner never
  hand-picks which files land in which task; the harness derives the partition from what is actually
  there.
- `--gate-template` is required and must contain the literal placeholder `{scope}`, substituted with
  each generated task's own scope, so every generated task gets its **own** narrow gate rather than
  inheriting one shared command (which A3-gate-discrimination would then immediately flag).
- `--group-by directory` (default `file`) groups every match under the same parent directory into
  one task instead of one task per file.
- Every generated task id is `<id-prefix>-<slugified-scope>` and every generated label is
  `<label-prefix>: <scope>` — real, on-disk paths turned into ids, never a guessed naming convention.
- `--auto-partition` is mutually exclusive with `--scope`, `--gate`, `--deps` and `--dep-reason`:
  auto-partitioned tasks derive their scope and gate from the glob and are **independent roots by
  construction** — there is nothing for a hand-declared dependency to mean here.

### An Alternative Declare Path: A Dedicated Planner Agent

Everything on this page so far assumes the coordinator itself calls `plan:add` / `plan:compile`
directly (typically `--actor planner`, but still the coordinator's own CLI call). The harness also
supports dispatching a genuinely separate **planner** agent to do this work, because a planner has no
task and no lease of its own — there is nothing for it to `task:claim` against. `plan:claim` is its
equivalent: it hands back the planner role contract, the immutable prompt, and a write scope of
exactly `planning/requirements.json` and `planning/graph.json`, which the planner fills in and the
coordinator then seals with `plan:apply --expected-revision <n>`. That expected-revision check exists
specifically so a planner working from a stale packet can never silently overwrite a newer plan built
against outdated assumptions.

---

[⬅ Previous: Prompt Capture & Integrity](./01-prompt-capture-and-integrity.md) | [Master Table of Contents](../README.md) | [Next: Authority Decisions & Dispositions ➡](./03-authority-decisions-and-dispositions.md)

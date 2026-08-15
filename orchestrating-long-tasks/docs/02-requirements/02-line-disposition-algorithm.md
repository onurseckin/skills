# 02. Line Disposition & Atomic Decomposition Algorithm

[⬅ Previous: Prompt Capture & Integrity](./01-prompt-capture-and-integrity.md) | [Master Table of Contents](../README.md) | [Next: Authority Decisions & Dispositions ➡](./03-authority-decisions-and-dispositions.md)

---

## 🔍 The 100% Line Disposition Rule

In standard development, an agent reads a 500-word prompt, generates a brief 3-point plan, and gets to work. Along the way, 40% of the subtle constraints in the prompt are quietly forgotten.

To completely prevent unhandled requirements, the `orchestrating-long-tasks` compiler enforces the **100% Line Disposition Invariant**:

> **Every single non-blank line of the user's prompt must be assigned exactly one mathematical disposition record during plan compilation.**

When the planner executes `plan:compile --actor planner`, the compiler validates that every non-blank line in `prompt.md` is strictly mapped to atomic requirements. If even one line is omitted, `plan:compile` fails with an `INTEGRITY` error.

---

## 🧩 Declaring Tasks & Compiling the Graph

Tasks are declared cleanly through the CLI with disjoint write scopes and mandatory gates:

```bash
bun harness.ts plan:add --run .capsules/<slug> --actor planner --id <task-id> --label "<label>" --scope <path> --gate "<gate-cmd>" [--deps <dep-id>]
```

You can inspect the planning buffer at any time:

```bash
bun harness.ts plan:status --run .capsules/<slug>
```

And compile the verified graph:

```bash
bun harness.ts plan:compile --run .capsules/<slug> --actor planner
```

---

## 🔬 Decomposing Compound Sentences: Plural Line Mapping

In natural language, users frequently pack multiple independent obligations into a single sentence. For example:

> _"Add Redis caching for user sessions and deploy the schema migration only after I explicitly confirm it."_

This single line (Line 1) contains two distinct obligations:

1. **`R-CACHE`**: An immediately actionable coding task (_"Add Redis caching for user sessions"_).
2. **`R-MIGRATE`**: An authority-gated external mutation (_"Deploy schema migration only after explicit confirmation"_).

### The Plural Disposition Solution:

Instead of creating a monolithic requirement or dropping the approval constraint, the compiler decomposes the line into **two atomic requirements** mapped to the same source line:

```json
{
  "dispositions": [
    {
      "line": 1,
      "kind": "requirement",
      "requirement_ids": ["R-CACHE", "R-MIGRATE"],
      "rationale": "Line contains both an actionable implementation obligation and a user-gated deployment obligation."
    }
  ]
}
```

Both `R-CACHE` and `R-MIGRATE` list `source_lines: [1]` and `source_excerpt: "Add Redis caching..."`.

- `R-CACHE` has `disposition: "actionable"`.
- `R-MIGRATE` has `disposition: "needs_authority"`.

This allows the scheduler to dispatch `R-CACHE` immediately in parallel via `queue:pop` / `task:claim`, while pausing `R-MIGRATE` until the user provides an audited authority decision!

---

## 📐 Atomic Requirement Structure

| Field                 | Purpose                                                                | Validation Rule                               |
| :-------------------- | :--------------------------------------------------------------------- | :-------------------------------------------- |
| **`id`**              | Unique alphanumeric requirement identifier (`req-foundations`, `R-001`).| Must be unique across the entire run.         |
| **`source_lines`**    | Exact 1-indexed line numbers in `prompt.md`.                           | Must strictly match the lines in `prompt.md`. |
| **`source_excerpt`**  | Exact string from `prompt.md` joined across `source_lines`.            | Byte-exact match with `prompt.md`.            |
| **`instruction`**     | Concise summary of what the user asked for.                            | Non-empty string.                             |
| **`implementation`**  | Technical explanation of how the system will satisfy it.               | Non-empty string.                             |
| **`subsystem`**       | Target directory or module path.                                       | Non-empty path string.                        |
| **`acceptance`**      | Array of acceptance criteria with IDs (`A-001`) and expected evidence. | Non-empty array of objects.                   |
| **`candidate_gates`** | Proposed test commands that will prove completion.                     | Array of literal argv objects.                |
| **`disposition`**     | Current actionability (`actionable` vs `needs_authority`).             | Closed enum.                                  |
| **`status`**          | Lifecycle state (`planned`, `in_progress`, `satisfied`, `disposed`).   | Closed enum.                                  |

---

[⬅ Previous: Prompt Capture & Integrity](./01-prompt-capture-and-integrity.md) | [Master Table of Contents](../README.md) | [Next: Authority Decisions & Dispositions ➡](./03-authority-decisions-and-dispositions.md)

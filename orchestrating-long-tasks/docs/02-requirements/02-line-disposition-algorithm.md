# 02. Line Disposition & Atomic Decomposition Algorithm

[⬅ Previous: Prompt Capture & Integrity](./01-prompt-capture-and-integrity.md) | [Master Table of Contents](../README.md) | [Next: Authority Decisions & Dispositions ➡](./03-authority-decisions-and-dispositions.md)

---

## 🔍 The 100% Line Disposition Rule

In standard development, an agent reads a 500-word prompt, generates a brief 3-point plan, and gets to work. Along the way, 40% of the subtle constraints in the prompt are quietly forgotten.

To completely prevent unhandled requirements, the `orchestrating-long-tasks` compiler enforces the **100% Line Disposition Invariant**:

> **Every single non-blank line of the user's prompt must be assigned exactly one mathematical disposition record in `requirements.json`.**

If a prompt has 10 non-blank lines, the `dispositions` array must have exactly 10 disposition entries mapping line 1 through line 10. If even one line is omitted, `harness.ts validate` fails with a schema violation.

---

## 🧩 Schema for Atomic Requirements & Dispositions

Here is the exact structure of `planning/requirements.json`:

```json
{
  "schema": "harness.requirements",
  "version": 1,
  "prompt_sha256": "8dcd43232e1bf99c2746f2d7ae338227da95178c43cbcd637a4f11486a0a9aa8",
  "requirements": [
    {
      "id": "R-001",
      "source_lines": [1],
      "source_excerpt": "Preserve the complete prompt.",
      "instruction": "Preserve the complete prompt.",
      "implementation": "Store the exact prompt bytes and bind them to the run manifest digest.",
      "subsystem": "src/store",
      "acceptance": [
        {
          "id": "A-001",
          "criterion": "The stored prompt bytes and manifest digest match the source.",
          "evidence": ["A passing prompt-capsule integrity test command"]
        }
      ],
      "candidate_gates": [{ "argv": ["bun", "test", "tests/store/prompt.test.ts"], "cwd": "." }],
      "priority": 100,
      "risk": "high",
      "ambiguity": [],
      "dependencies": [],
      "disposition": "actionable",
      "status": "planned"
    }
  ],
  "dispositions": [
    {
      "line": 1,
      "kind": "requirement",
      "requirement_id": "R-001"
    }
  ]
}
```

---

## 🔬 Decomposing Compound Sentences: Plural Line Mapping

In natural language, users frequently pack multiple independent obligations into a single sentence. For example:

> *"Add Redis caching for user sessions and deploy the schema migration only after I explicitly confirm it."*

This single line (Line 1) contains two distinct obligations:
1. **`R-CACHE`**: An immediately actionable coding task (*"Add Redis caching for user sessions"*).
2. **`R-MIGRATE`**: An authority-gated external mutation (*"Deploy schema migration only after explicit confirmation"*).

### The Plural Disposition Solution:
Instead of creating a monolithic requirement or dropping the approval constraint, the compiler creates **two atomic requirements** mapped to the same source line:

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

This allows the scheduler to dispatch `R-CACHE` immediately in parallel, while pausing `R-MIGRATE` until the user provides an audited authority decision!

---

## 📐 Atomic Requirement Fields Explained

| Field | Purpose | Validation Rule |
| :--- | :--- | :--- |
| **`id`** | Unique alphanumeric requirement identifier (`R-001`, `R-AUTH`). | Must be unique across the entire run. |
| **`source_lines`** | Exact 1-indexed line numbers in `prompt.md`. | Must strictly match the lines in `prompt.md`. |
| **`source_excerpt`** | Exact string from `prompt.md` joined across `source_lines`. | Byte-exact match with `prompt.md`. |
| **`instruction`** | Concise summary of what the user asked for. | Non-empty string. |
| **`implementation`** | Technical explanation of how the system will satisfy it. | Non-empty string. |
| **`subsystem`** | Target directory or module path. | Non-empty path string. |
| **`acceptance`** | Array of acceptance criteria with IDs (`A-001`) and expected evidence. | Non-empty array of objects. |
| **`candidate_gates`** | Proposed test commands that will prove completion. | Array of literal argv objects. |
| **`disposition`** | Current actionability (`actionable` vs `needs_authority`). | Closed enum. |
| **`status`** | Lifecycle state (`planned`, `in_progress`, `satisfied`, `disposed`). | Closed enum. |

---

[⬅ Previous: Prompt Capture & Integrity](./01-prompt-capture-and-integrity.md) | [Master Table of Contents](../README.md) | [Next: Authority Decisions & Dispositions ➡](./03-authority-decisions-and-dispositions.md)

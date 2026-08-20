# 02. Structured Finding Schema & Resolution

[⬅ Previous: Adversarial Validation Philosophy](./01-adversarial-validation-philosophy.md) | [Master Table of Contents](../README.md) | [Next: Repair Routing & Escalation ➡](./03-repair-routing-and-escalation.md)

---

## 🛑 Why Vague Feedback Fails

_"This code looks buggy, please fix error handling"_ costs a repairer an entire round of guessing:
which function, what input, what command reproduces it, and how will the fix be proven?

Every finding in the capsule therefore carries the same six answers, and the harness supplies none of
them on a validator's behalf.

---

## 📋 Two Classes, One Pipeline

```bash
bun harness.ts task:reject \
  --run .capsules/<run-id> --task <task-id> --validator <val-id> --token <validation-token> \
  --reason "The gate is green only because both test inputs are hard-coded; slugify implements nothing." \
  --severity critical \
  --remediation "Lowercase the input, collapse every run of non-alphanumeric characters into one hyphen, and trim the edges." \
  --checks <validator-gate-command-id>
```

```json
{
  "id": "finding-task-slug-reject",
  "class": "defect",
  "requirement_id": "req-slug",
  "severity": "critical",
  "evidence": [{ "kind": "command", "reference": "C-1c12763c-29c4-493b-a0ef-e5a6b6e255a3" }],
  "observation": "The gate is green only because both test inputs are hard-coded; slugify implements nothing.",
  "remediation": "Lowercase the input, collapse every run of non-alphanumeric characters into one hyphen, and trim the edges.",
  "revalidation": "Run gate tests for task-slug"
}
```

```bash
bun harness.ts task:probe \
  --run .capsules/<run-id> --task <task-id> --validator <val-id> --token <validation-token> \
  --demand "Prove the slug is computed, not matched: the gate must stay green with the hard-coded branches gone." \
  --revalidation "bun test tests/slug.test.ts"
```

```json
{
  "id": "probe-task-slug-01-1",
  "class": "probe_demand",
  "requirement_id": "req-slug",
  "severity": "minor",
  "evidence": [
    {
      "kind": "demand",
      "detail": "Prove the slug is computed, not matched: the gate must stay green with the hard-coded branches gone.",
      "evidence_class": "agent_reported"
    }
  ],
  "observation": "Prove the slug is computed, not matched: the gate must stay green with the hard-coded branches gone.",
  "remediation": "Answer the demand with evidence, or record a defect with task:reject if it does not hold.",
  "revalidation": "bun test tests/slug.test.ts"
}
```

Both land in `.capsules/<run-id>/findings/<id>.json` and in `state.tasks.<id>.findings[]`. The
`class` field is what keeps them apart, and it is **never inferred from severity or verdict** — a
probe demand carries `severity: minor` because it asserts nothing, not because it is unimportant.

---

## 🔍 The Mandatory Components

| Field                | Meaning                                                                  | Rule                                                               |
| :------------------- | :----------------------------------------------------------------------- | :----------------------------------------------------------------- |
| **`id`**             | Stable identifier: `finding-<task>-reject`, `probe-<task>-NN-N`.         | Auto-derived, or set with `--finding-id`.                          |
| **`class`**          | `defect` or `probe_demand`.                                              | Set by which command recorded it.                                  |
| **`requirement_id`** | The obligation this finding is about.                                    | Bound with `--requirement`, else the task's own.                   |
| **`severity`**       | `critical`, `important`, `minor`.                                        | **Required** on `task:reject`. No default.                         |
| **`observation`**    | Exactly what was observed, or exactly what must be proved.               | Non-empty.                                                         |
| **`evidence[]`**     | `kind: "command"` references for a defect; `kind: "demand"` for a probe. | Command references must resolve.                                   |
| **`remediation`**    | What would fix it.                                                       | **Required** on `task:reject`; the harness writes none of its own. |
| **`revalidation`**   | How the fix is to be proven.                                             | `--revalidation`, else the task's own gate.                        |
| **`status`**         | `open` or `resolved`.                                                    | Only a `--resolve` on a verdict moves it.                          |

The severity vocabulary is `critical | important | minor`. Nothing grades a finding automatically, and
`--remediation` may not simply restate `--reason`: echoing the observation back under the remediation
label files the defect as its own fix.

---

## 🔐 Resolution Requires a Command, Explicitly

A finding cannot be closed by prose, by a later submission, or by the harness deciding it looks
handled. `task:review --status pass` requires one `--resolve` per open finding:

```bash
bun harness.ts task:review \
  --run .capsules/<run-id> --task task-slug --validator val-slug-2 --token <token> --status pass \
  --summary "The literal branches are gone and the gate still passes, so the slug is computed." \
  --checks C-168a1579-… \
  --resolve "probe-task-slug-01-1=C-168a1579-…" \
  --resolve "finding-task-slug-reject=C-168a1579-…"
```

Omit one and the pass is refused **by name**:

```text
{"ok":false,"error":{"code":"INVALID_STATE","message":"cannot pass task-slug: 1 open finding(s) unanswered: finding-task-slug-reject; answer each with --resolve <finding-id>=<command-id>"}}
```

`--resolve` takes `<finding-id>=<command-id>[,<command-id>]`, and each cited command must be a
**successful run by this validator, bound to this task, matching a mandatory gate**. `--resolution-method`
optionally records how it was answered; it defaults to the finding's class.

A pass carrying only `--summary` is therefore not a complete verdict once any finding is open, and it
does not satisfy the probe requirement on its own either.

---

## 🔒 Finding Invariants

1. **No phantom rejections.** A rejection without a severity and a remediation is refused; a critic
   rejection without structured `--findings` is refused. A critic that rejects with nothing to say
   fails rather than inventing a finding.
2. **No phantom probes.** `task:probe` needs at least one `--demand`.
3. **Immutable traceability.** Findings live in `events.jsonl`, `state.json` and `findings/`, and the
   `review-recorded` event carries `verdict`, `round`, `class` and `finding_count`, so a clean pass is
   never mislabelled in the timeline as "requested changes (0 findings)".
4. **Mechanical resolution only.** Every close is `<finding-id>=<command-id>`, and the harness never
   marks one answered on a validator's behalf.

---

## 🔎 Reading Findings Back

```bash
bun harness.ts finding:get --run .capsules/<run-id>
bun harness.ts finding:get --run .capsules/<run-id> --id probe-task-slug-01-1
bun harness.ts report:get  --run .capsules/<run-id> --task task-slug --type review
```

---

[⬅ Previous: Adversarial Validation Philosophy](./01-adversarial-validation-philosophy.md) | [Master Table of Contents](../README.md) | [Next: Repair Routing & Escalation ➡](./03-repair-routing-and-escalation.md)

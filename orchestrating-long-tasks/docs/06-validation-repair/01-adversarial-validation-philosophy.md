# 01. Adversarial Validation: The Probe / Defect Split

[⬅ Previous: Submission & Evidence Collection](../05-task-execution/03-submission-and-evidence-collection.md) | [Master Table of Contents](../README.md) | [Next: Structured Finding Schema ➡](./02-structured-finding-schema.md)

---

## 🎭 The Fatal Flaw of Self-Grading

Ask an agent that just wrote code whether its tests pass, and it evaluates its own output under deep
conversational bias: it assumes its reasoning was correct, reads ambiguous output optimistically, and
overlooks the edge cases it never thought of.

> **An implementer is NEVER permitted to validate its own task.**

`task:validate-start` enforces three separate independence rules:

1. The validator is not the task's `original_implementer`.
2. The validator does not appear in the task's attempts.
3. **The validator has not validated this task before.** A repair round needs a _fresh_ validator.

Reusing a validator across rounds fails outright:

```text
{"ok":false,"error":{"code":"INVALID_STATE","message":"validator must be independent from implementers"}}
```

---

## 🧼 Context Sanitization

Even a separate agent anchors on the implementer's narrative. So the validator's brief is built from
an allowlist:

```text
[ Implementer Submits Work: task:submit ]
  ├── summary: "I fixed the bug and tests pass 100%!" (PROSE, agent_reported)
  ├── files_changed: ["src/auth.ts"]                  (harness_observed via git)
  └── write_scope: ["src/auth"]
                  │
                  ▼ (task:validate-start)
┌────────────────────────────────────────────────────────┐
│  STRIPPED FROM THE VALIDATOR BRIEF:                    │
│  ❌ implementer narrative   ❌ subjective confidence    │
│  ❌ prior review notes      ❌ implementer claims       │
└──────────────────────────┬─────────────────────────────┘
                           ▼
[ Allowlisted context delivered to the validator ]
  ✅ Original prompt text        ✅ Atomic acceptance criteria
  ✅ The repository on disk      ✅ Mandatory gate argv to run via run:exec
```

The brief also states the bar up front:

```text
### Validation Leased: task-slug
- **Validator**: `val-slug`
- **Validation Token**: `BtYrfM4hNV-YBbSBw3jp6eHUI-GmVZAXbPBT9b2l6cQ`
- **Mandatory Gates to Run**:
  1. `bun test tests/slug.test.ts`
- **Before Sign-off**: record 1 adversarial probe(s) with `task:probe`; a pass is refused without them.
```

---

## 🔎 The Probe: Adversarial Without Being Dishonest

Requiring a validator to be adversarial is easy to state and easy to get wrong. Demand a mandatory
_rejection_ and you have asked for a defect nobody observed; demand nothing and the check is
optional. Neither is acceptable.

A **probe** is the shape that works. It is a demand for proof, not an accusation, so requiring one
asks nothing dishonest of anybody:

```bash
bun harness.ts task:probe --run .capsules/<run-id> --task <task-id> \
  --validator <val-agent> --token <token> \
  --demand "Prove the slug is computed, not matched: the gate must stay green with the hard-coded branches gone." \
  --revalidation "bun test tests/slug.test.ts"
```

```text
### Adversarial Probe Recorded: task-slug
- **Validator**: `val-slug-2` | Verdict: 🔎 PROBE (Round 1)
- **Nature**: Demand for proof, not a defect. Repair round stays 0.
- **Demands**:
  - `probe-task-slug-01-1`: Prove the slug is computed, not matched: …
- **Next Step**: Answer every demand with command evidence, then `task:review --status pass`, or `task:reject` if a demand fails.
```

|                       | `task:probe`            | `task:reject`                             |
| :-------------------- | :---------------------- | :---------------------------------------- |
| Claim made            | "Prove X"               | "X is broken"                             |
| Finding `class`       | `probe_demand`          | `defect`                                  |
| Counter moved         | `probe_round` +1        | `repair_round` +1                         |
| Task status after     | stays `validating`      | `changes_requested`                       |
| Reassigns implementer | no                      | yes                                       |
| Graph edge            | `probe` (info / cyan)   | `pushback` (error)                        |
| Required flags        | at least one `--demand` | `--reason`, `--severity`, `--remediation` |

`min_adversarial_probes` is **1**. The requirement is enforced, not merely written down:
`task:review --status pass` is refused while `probe_round` is short of it.

---

## ⚖️ When a Rejection Is Actually Correct

`task:reject` demands `--checks` that are the validator's **own successful runs of every mandatory
task gate**. A failing gate run cannot back a rejection:

```text
review check command C-237045e3-… is not successful validator evidence for task-slug
```

That constraint is not arbitrary. It makes `task:reject` the tool for a defect **the green gate does
not catch** — the case where mechanical verification passes and judgement is still required:

```ts
// The gate is green. The requirement is not met.
export function slugify(input: string): string {
  if (input === "Hello World") return "hello-world";
  if (input === "Ship it, now!") return "ship-it-now";
  return input;
}
```

```text
### Task Rejected: task-slug
- **Validator**: `val-slug` | Verdict: ❌ REJECTED
- **Finding ID**: `finding-task-slug-reject`
- **Issue**: `The gate is green only because both test inputs are hard-coded; slugify implements nothing.`
- **Action**: Task recorded as `changes_requested`.
```

A **red** gate is not a verdict to record. It is a repair situation: the task goes back, and
`task:review --status pass` stays blocked while any mandatory gate's recorded run exited nonzero.

---

## 🧭 The Validator's Sequence

```text
1. task:validate-start        → validation token, mandatory gate list, probe requirement
2. run:exec … --actor <val>   → rerun every mandatory gate yourself
3. task:probe --demand "…"    → at least min_adversarial_probes rounds
4. run:exec … --actor <val>   → produce the command that ANSWERS each demand
5a. task:review --status pass --checks <cmd> --resolve <finding>=<cmd>   (every open finding)
5b. task:reject --severity … --remediation … --checks <green gate run>  (an observed defect)
```

Steps 2 and 4 are frequently the same command; the point is that the evidence answering a demand is a
recorded run, not a sentence.

---

[⬅ Previous: Submission & Evidence Collection](../05-task-execution/03-submission-and-evidence-collection.md) | [Master Table of Contents](../README.md) | [Next: Structured Finding Schema ➡](./02-structured-finding-schema.md)

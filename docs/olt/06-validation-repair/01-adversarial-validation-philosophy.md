# 01. Adversarial Validation: The Probe / Defect Split

[⬅ Previous: Submission & Evidence Collection](../05-task-execution/03-submission-and-evidence-collection.md) | [Master Table of Contents](../README.md) | [Next: Structured Finding Schema ➡](./02-structured-finding-schema.md)

---

## 🧱 Two Layers of Adversarial Checking

This chapter is about the second of two layers, and it is worth being explicit about the boundary
before diving in.

**Before any task is dispatched at all**, `plan:compile` runs a purely mechanical, structural audit —
`plan:audit` — against the whole planning buffer: is any one task's write scope quietly carrying most
of the plan (`A1-granularity`), do two disjoint-scope tasks share a gate so indistinguishable from a
no-op that it cannot tell either task's absence from its presence (`A3-gate-discrimination`), is a
dependency edge serializing two tasks whose scopes never actually overlap (`A4-false-barrier`), does
one task's effort estimate dwarf its wave-mates enough that everyone else will idle waiting on it
(`A5-straggler`), or does a task's own gate walk the whole repository when only `--completion-gate`
is allowed to (`A6-whole-suite-gate`). A blocking finding refuses to let `plan:compile` seal the plan at
all unless the coordinator explicitly accepts it, once per invariant, with a stated reason:

```bash
bun harness.ts plan:compile --run .capsules/<run-id> --actor planner \
  --completion-gate "bun test tests/unit" \
  --accept-audit "A3-gate-discrimination:task-a and task-b legitimately share the shared-fixture regression test"
```

`A3` and `A6` both consult recorded **falsifiability proofs** (`gate:prove`, Chapter 07) before
flagging a shared or whole-repository-looking gate: a gate that has actually been proven to fail once
its task's own work is reverted in a scratch copy is not the same finding as one nobody has ever tried
to falsify. `A2-parallelism` — "does the decomposition match the prompt's entity count" — has no
grounded number to compare against anywhere in the plan (deriving one would mean an NLP heuristic
guessing at a count nobody asked for), so it is always reported under `not_evaluated` rather than
silently skipped or invented.

This structural audit is deterministic and requires no judgement — it is the harness checking its own
arithmetic. The rest of this chapter is the opposite: a **task's own submitted work**, judged by an
independent agent that has to actually look at the diff, not a shape the harness can check by counting
files. Both layers exist because a plan can be structurally sound and still contain a task whose
implementation is wrong, and a gate can be well-formed and still pass on code that does nothing.

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

## 🗂️ One Task, Several Domains (B12.2)

A single validator judging "is this task good" conflates several genuinely different questions: is the
code well-structured, does the UI actually render correctly, is the security posture sound. The harness
answers this by letting a task carry **several open validations at once, one per applicable standing
checklist domain**, rather than forcing one validator to certify everything:

```text
VALIDATOR_DOMAINS = code-quality | product | security | system-design | ui-design
```

`code-quality` applies to **every** task — whatever else changes, it is also code. The others are
either derived automatically from the task's write scope, or dispatched explicitly:

- **`ui-design`** — the scope touches a markup/style/component extension (`.tsx`, `.jsx`, `.vue`,
  `.svelte`, `.html`, `.css`, `.scss`, `.sass`, `.less`, …).
- **`system-design`** — the scope touches `.graphql` / `.gql` / `.proto`, or a path containing
  `schema/`, `contracts/` or `migrations/`.
- **`product`** and **`security`** — real domains the checklist system names, but with no structural
  signal in a write scope to auto-detect them from. A run that needs one dispatches it explicitly.

```bash
bun harness.ts task:validate-start --run .capsules/<run-id> --task task-1 --validator val-1
bun harness.ts task:validate-start --run .capsules/<run-id> --task task-1 --validator val-1 --validator-domain code-quality
```

Omit `--validator-domain` and the harness derives it: the first domain applicable to the task's write
scope that nobody currently has an **open** validation against. This is what lets a coordinator
dispatch one validator per applicable domain without tracking which flag goes with which agent by hand.
An explicitly named domain the write scope does not draw is refused (`validator domain X is not
applicable to task-1's write scope`), and a domain that already has an open attempt is refused too —
one open attempt per domain, at most.

The three independence rules above still apply **task-wide**, not per domain: an agent who validated
`ui-design` on round 1 cannot pick up `code-quality` on round 2 of the same task either. Validating one
domain of a task is still validating that task.

### Reaching `validated`

The task transitions to `validated` only once **every applicable domain has its own recorded pass** —
the first domain to pass does not unilaterally close the task out from under the domains still mid-flight.
A pass on one domain while others remain open reports honestly rather than declaring victory early:

```text
### Domain Passed, Task Still validating: task-slug
- **Validator**: `val-ui` | Verdict: ✅ PASS
- **Outstanding Domains**: security still need an independent pass before task-slug is validated
```

But a **reject from any single domain ends the round for every domain at once.** If `code-quality` and
`ui-design` are both open and `ui-design` rejects, `code-quality`'s still-open attempt is archived into
`validation_history` along with it — it loses its slot the same as the domain that actually rejected,
and both are re-dispatched together once the repair round completes. A task-wide defect does not get to
coexist with a passing domain from before it was found.

Findings themselves (`task.findings`) are a **single list shared by the whole task**, not partitioned
per domain — a finding a `ui-design` validator raised is still an open finding a `security` validator's
own later pass has to `--resolve`, exactly as if it had raised it itself. Domains give a task several
independent verdicts; they do not give it several independent finding lists.

---

---

## 🧼 Context Sanitization & Sycophancy Prevention

LLMs are inherently susceptible to **sycophantic confirmation bias**: when provided with an implementer's self-assuring narrative ("I refactored the auth module and all edge cases are handled cleanly"), an LLM validator is statistically inclined to agree, skimming over subtle regressions.

To prevent this cognitive failure mode, the harness applies algorithmic **Validator Context Isolation** (`isolateValidatorContext`, `excludeValidatorContamination`) to every validation brief:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                 ALGORITHMIC CONTEXT SANITIZATION PIPELINE                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [ Raw Implementer Submission ]                                             │
│    • summary: "I fixed the bug and tests pass 100%!" (PROSE, agent_reported)│
│    • confidence: 0.98, decision_narrative: "Refactored parsing logic"       │
│    • files_changed: ["src/auth.ts"] (harness_observed via git diff)         │
│    • write_scope: ["src/auth"]                                              │
│                                  │                                          │
│                                  ▼ (isolateValidatorContext)                │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  SCRUBBED EXCLUSION SET (VALIDATOR_EXCLUSIONS):                       │  │
│  │  ❌ confidence             ❌ decision_narrative                      │  │
│  │  ❌ implementer_report     ❌ task_report                             │  │
│  │  ❌ previous_review        ❌ prior_reviews                           │  │
│  │  ❌ validator_report       ❌ subjective conclusions                  │  │
│  └───────────────────────────────┬───────────────────────────────────────┘  │
│                                  ▼                                          │
│  [ Clean Allowlisted Brief Delivered to Validator ]                         │
│    ✅ Original prompt markdown text (prompt.md)                             │
│    ✅ Atomic acceptance criteria & mapped requirements                      │
│    ✅ Objective filesystem state on disk & git baseline diff                │
│    ✅ Exact mandatory gate command argv to execute via run:exec             │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

The brief states the verification contract up front without narrative contamination:

```text
### Validation Leased: task-slug
- **Validator**: `val-slug`
- **Validation Token**: `BtYrfM4hNV-YBbSBw3jp6eHUI-GmVZAXbPBT9b2l6cQ`
- **Mandatory Gates to Run**:
  1. `bun test tests/slug.test.ts`
- **Before Sign-off**: record 1 adversarial probe(s) with `task:probe`; a pass is refused without them.
```

### Round Two Gets a Harder Sanitization Pass

A fresh validator identity defeats one kind of anchoring. It does nothing about a subtler kind: a round-2
validator who reads "round 1 concluded the parser drops empty rows" has already been handed a
conclusion to defend or dismiss, not a question to answer for itself. So on any round after the first,
every prior finding is stripped of anything that states a **judgement** — `verdict`, `severity`,
`class`, `observation`, `conclusion`, `rationale`, `recommendation`, `resolved_by`, and everything else
that names an opinion rather than a fact — before it ever reaches the round-2+ packet. What survives is
re-expressed as a **demand to prove**, not a verdict to inherit:

```json
{
  "demand_id": "finding-task-slug-reject",
  "requirement_id": "req-slug",
  "prove": "Lowercase the input, collapse every run of non-alphanumeric characters into one hyphen, and trim the edges.",
  "prove_by": "bun test tests/slug.test.ts",
  "look_at": ["..."]
}
```

Both readings point at the identical underlying defect. Only the second leaves the judgement where it
belongs: with the validator actually looking at the code. This stripping is enforced, not merely
attempted — anything that reaches a round-2+ packet still carrying one of those judgement-bearing keys
fails the packet build outright rather than shipping a validator brief with a thumb on the scale.

The round-2+ packet also carries what the harness itself measured about the gap between rounds: every
demand still standing, every command already run against the task, the mandatory gates' latest recorded
results, and a repository diff anchored to the previous round's own repository reading — including,
when no commit landed between rounds, the raw fact that the anchor commit itself never moved, so "nothing
changed since the previous round" is never confused with "the diff looks unchanged because nothing was
re-measured."

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

## 🖼️ UI Tasks: The Dual-Channel Validator Protocol

A prose claim of "the layout renders correctly" is exactly the unfalsifiable kind of statement this
whole chapter exists to refuse. For a task whose write scope touches a UI extension or a UI-shaped
directory (`.tsx`, `.jsx`, `.vue`, `.svelte`, `.html`, `.css`, `.scss`, `.sass`, `.less`, `.svg`, or a
path under `components/`, `views/`, `pages/`, `styles/`, `ui/`, `frontend/`, `client/`, `renderer/`,
`canvas/`, or `layout/`), `task:review --status pass` runs a **Dual-Channel Validator Protocol** audit
before the verdict is even recorded, and a task the audit fails cannot pass — non-UI tasks are entirely
unaffected; the audit reports `non_ui_skipped` and moves on.

The audit asks for either channel, and ideally both:

- **DOM metrics** (`visual-report.json`) — a structured report of overflow, clipping, stacking order,
  contrast and origin-orphan checks per viewport.
- **Screenshots** — real, non-empty rasterizations. A screenshot recorded at 0 bytes is flagged as an
  **Anti-Mocking Invariant Violation**, not silently accepted as evidence.

Both channels missing is an outright refusal (`mode: rejected`): "Task modifies UI scope but provided
neither DOM metrics nor visual screenshots." When at least one channel is present, the audit further
requires coverage across all three required viewports — **mobile, tablet, desktop** — from either
channel; a viewport covered by neither is its own finding (`missing_viewport`). When **both** channels
cover a viewport, the audit cross-checks them against each other (`mode: dual_channel_corroborated`):
a dimension only one channel actually recorded is never compared against a number the other channel
never measured, so a mismatch reported here is always a genuine disagreement between two real
readings, never a fabricated one filled in against a missing measurement.

The validator does not have to run this manually — `collectTaskScreenshots` and the visual-report
ingestion run automatically as part of `task:review`, searching the repository root plus
`test-results/`, `screenshots/` and `playwright-report/` for evidence the task's own commands produced.
The validator's job is to make sure that evidence exists before asking for a pass.

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

A passing `task:review` may optionally attach `--checklist-domain <domain> --checklist-report
<path>` — the standing-checklist coverage report Chapter 06 §02 covers in full. It is a separate report
of what the validator actually inspected against that domain's checklist, and it never gates the
verdict on its own; the task's own pass/fail is decided purely by its own requirements.

If the task draws more than one applicable domain, this sequence runs once **per domain**, independently
— each domain's validator holds its own token and passes or rejects on its own timeline. The task
itself only reaches `validated` once every domain that opened has recorded a pass, as covered above.
`probe_round`, though, is a single counter kept on the **task**, not one per domain: the first
validator to probe — whichever domain it is validating — satisfies `min_adversarial_probes` for every
domain's eventual pass on that task, not just its own. A second domain's validator is not required to
record its own probe if another domain already recorded one this round.

---

[⬅ Previous: Submission & Evidence Collection](../05-task-execution/03-submission-and-evidence-collection.md) | [Master Table of Contents](../README.md) | [Next: Structured Finding Schema ➡](./02-structured-finding-schema.md)

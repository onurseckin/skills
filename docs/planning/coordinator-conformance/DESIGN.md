# Coordinator Conformance: forcing plans to stay inside the skill

Companion to `FORENSICS.md`, which establishes the evidence. This document specifies the fix.

## The principle

> A task cannot be marked done without a validator. A **plan** can be compiled without one.
> That asymmetry is the whole bug.

Every mechanism below removes one way for a plan to leave the skill's spectrum without being told.
None of them is a prompt asking the model to behave. Exhortation is what already failed: the
coordinator was told four times, by the user, in plain language, and still reverted to waterfall.

---

## C1 — `plan:audit`: promote the existing warnings to refusals

The analysis exists (`gate-breadth.ts`, `scope-analyzer.ts`) and already runs at compile. It returns
warnings. Make a defined subset **blocking**, surfaced through a real CLI command so the verdict is
recorded in the capsule as an event rather than printed and lost.

`plan:compile` calls the audit and refuses to seal on any `blocking` verdict. Invariants:

| id | invariant | verdict |
|---|---|---|
| `A1-granularity` | a task's `write_scope` expands to > 3 files while the plan touches ≥ 5 | blocking |
| `A2-parallelism` | prompt names ≥ 10 distinct entities but the plan has < 5 independent roots | blocking |
| `A3-gate-discrimination` | two disjoint tasks carry an identical gate argv | blocking |
| `A4-false-barrier` | a dependency edge whose child reads nothing the parent writes | blocking |
| `A5-straggler` | a task's effort estimate > 3× the median of its readiness layer | advisory + justification |
| `A6-whole-suite-gate` | a task gate is a whole-repo command (`looksWholeSuite`) | blocking |

A6 is the one that would have caught the DSA run on its own: ten tasks, one `bun run typecheck`.

**Override, not bypass.** `--accept-audit <id>:<reason>` records an explicit, attributed, per-invariant
acceptance as a capsule event. A plan may proceed against the audit only by writing down who accepted
what and why. Silence is not an option; neither is a blanket `--force`.

## C2 — the plan validator: a validator role for coordinators

The user's own framing: implementers have dedicated adversarial validators, coordinators have none.

A `plan-validator` role, symmetric to the implementer's validator and dispatched the same way, that
reviews the **compiled plan** — not the code — against the graph contract, and can issue a pushback
that forces re-planning before a single implementer is dispatched. It answers, in writing:

1. Does the decomposition match the entity count in the prompt, or did it compress?
2. Is every dependency edge justified by a real read/write relationship?
3. Can each gate actually fail if its task does nothing? (see C3)
4. Is any task's scope large enough that one agent will straggle while the rest idle?

Its pushback uses the existing pushback channel, so the round is modelled acyclically and shows up in
`graph.json` as a distinct edge kind, exactly like an implementer repair round.

## C3 — gate discrimination: prove the gate can fail

The deepest fix, and the one that makes stamping detectable. A gate that cannot fail proves nothing.

`gate:prove` establishes falsifiability the same way this repo's own health suite verifies its
guards: **revert the task's write scope in a scratch copy and require the gate to exit non-zero.**
A gate that still passes with the task's work removed is not a gate for that task, and `plan:compile`
refuses it under A3/A6.

This is the mechanism that converts "satisfied" from *the repo still compiles* into *this task's work
is present*.

## C4 — effort evidence: refuse a submission that changed nothing

`task:submit` compares a content hash of the task's `write_scope` taken at claim against submit.
Unchanged scope and a `done` claim is refused. A task that legitimately needs no change submits
`--no-op --reason "<why>"`, which is recorded as an explicit, attributed state — never inferred.

This alone makes §2.1 of the forensics impossible: eleven zero-second submissions with no file
mutation would have been eleven refusals.

## C5 — run-id typing

A run id is an identifier, not a path. Normalise and validate at the single entry point that resolves
a capsule: reject a value containing a path separator after stripping one optional `.capsules/`
prefix, so both documented forms work and `.capsules/.capsules/` becomes unreachable.

## C6 — idea injection: give the planner the topology, don't ask for it

The remaining gap after C1–C5 is that a refused planner still has to invent a better plan, which is
the thing it is bad at. So supply it:

- **`plan:add --auto-partition <glob>`** — the harness enumerates matching files and emits one task
  per file (or per declared group), with a scope-narrow gate per task. The planner stops choosing
  granularity; it declares intent and the harness derives the decomposition. This is the post-mortem's
  Proposal 2, and it is the single highest-leverage item for weak planners.
- **A mandatory topology declaration** at `plan:compile`: independent-root count, and a one-line
  justification per dependency edge. Forcing the planner to *state* why an edge exists is what makes
  an unjustified barrier visible — to the planner itself, at the moment it is inventing one.
- **A worked exemplar at the point of use**, in `SKILL.md`'s planning route rather than a reference
  file: the DSA case as a matched pair — the 3-node waterfall that was rejected beside the 14-node DAG
  that replaced it. A weak model imitates the nearest example; make the nearest example correct.

---

## Ordering

C3 and C4 are the load-bearing pair: they make the *evidence* real, so everything downstream can
trust "done". C1 is what turns existing analysis into enforcement. C2 gives the plan an adversary.
C6 is what stops the refusals from becoming a loop the planner cannot exit. C5 is a small correctness
fix carried along.

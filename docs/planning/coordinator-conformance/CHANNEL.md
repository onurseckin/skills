# The CLI as sole medium: registration is non-negotiable

Fourth document in this set. `FORENSICS.md` gives the evidence, `DESIGN.md` the first six refusals,
`RAILS.md` the weak-model principle. This one states the owner's architecture directly and corrects
the earlier documents where they treated reporting as a by-product rather than as the point.

## The thesis

> The harness CLI is the **communication** channel, the **verification** channel, and the **reporting**
> channel. It is the single medium through which every role interacts with every other role and with
> the run's own history.

The purpose is precise: a language model should not have to read this skill's internals to use it
correctly. It needs to know which commands exist and what arguments they take. Everything else —
coordination, hand-off, evidence, state, history — happens _through_ those commands. The CLI is not a
convenience wrapper over a state file. It is the only door.

Two consequences follow immediately, and neither is currently enforced:

1. **No model may edit a capsule JSON directly.** Gaps in the record are filled by running a command,
   never by writing a file. A model that hand-edits `state.json` has left the system.
2. **Registration is non-negotiable.** Thinking, approach, topology, implementation choice — all free.
   _Recording what you did_ — never free. Every action, positive or negative, is registered.

`RAILS.md` framed this as "the harness constrains HOW, never WHAT". That holds, but it understated the
reporting half. Restated correctly:

> **The harness constrains how you WORK and demands that you RECORD. It never constrains what you decide.**

## Why the positive path must be policed too

The earlier documents worried about refusing bad outcomes. The owner's point is different and larger:
**the run's history is a product**, not a diagnostic. It is exported as `graph.json` and rendered, and
its purpose is to let a human understand what actually happened. A success that goes unrecorded is a
hole in that product exactly as much as a failure that goes unrecorded.

So a validator that finds nothing wrong is not finished. It still owes:

- a feedback analysis to its coordinator, and
- a state-machine transition that lands in history.

Measured reality, across six live capsules (30 tasks, 29 reviews):

|                                          |                                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------------- |
| Verdict `pass`                           | 29 (100%)                                                                             |
| Rejects, findings, probes, repair rounds | 0, 0, 0, 0                                                                            |
| Screenshots on any review                | 0                                                                                     |
| Checks per review                        | exactly 1, every time                                                                 |
| Distinct gate commands                   | 4, all repo-wide: `typecheck` ×19, `check` ×4, `compose:check` ×3, `audit:catalog` ×3 |

Twenty-nine passes and not one carries information a reader could learn anything from. The pushback
loop has never once executed. That is the product failing, not merely the enforcement failing.

## R1 — Role output contracts, schema-checked at the boundary

Every role, at every node type, has a **required output shape**, validated by the harness at the moment
of the call. Not prose in a role file that an agent may ignore — a typed contract the CLI refuses to
accept a violation of.

The owner's own example is the sharpest one:

> A UI validator must produce screenshots. **Regardless of verdict.** There is no such thing as a UI
> review, passing or failing, with an empty screenshot set.

Today, `cli/commands/task-review.ts:157-158` refuses a UI _pass_ with no dual-channel evidence. That is
the right mechanism, and it must be widened in two directions:

- **to the negative path** — a UI _reject_ also requires the screenshots that justify it;
- **to every role** — implementer, validator, plan-validator, critic, coordinator each get a contract.

Classification must not depend on `write_scope` extensions alone. In the real incident, the task
`task-dual-channel-ui-validation` declared `write_scope: ["src/types/dsa.ts"]`, so its own UI mandate
never fired. Route classification through the task's requirement text and title as well.

## R2 — Empty evidence is an automatic refusal

Stated by the owner as a rule: no findings, no reports, no screenshots, and a status of `pass` — the
harness refuses, and says why.

Generalised: **for every role contract, an output that satisfies the shape while carrying no
information is refused at the boundary.** This is the one place a shape check is not enough, because
`requireText` cannot tell an observation from a placeholder. Where substance cannot be judged, require
an _artifact_ instead of a sentence — a command record, a file on disk with a non-zero byte count, a
hash. The existing dual-channel check already does this correctly: it verifies a sha256-keyed
screenshot store with `sizeBytes > 0`, rather than counting entries in a model-authored JSON array.

## R3 — Reporting up is a transition, not a courtesy

When a child node finishes — implementer to validator, validator to coordinator, branch back to parent
— the hand-off is a registered state transition carrying a payload the harness checks against the
sender's role contract. Silence is not a valid completion.

The parent's obligation is symmetric: **a coordinator must verify that every child produced its
expected output** before treating a subtree as done, and the harness must give it a single command
that answers that question rather than requiring it to reason over raw state.

## R4 — Pushback is a first-class object, and it flows both ways

Pushbacks must be enumerable and renderable: a reader of the summary should see every pushback, who
issued it, to whom, why, and what resolved it.

Crucially, the owner's example inverts the usual direction: **a coordinator pushes back on a
validator** that reported `pass` without screenshots. Today all pushback machinery runs
validator → implementer. The coordinator → validator edge does not exist, and it is exactly the edge
that would have caught the UI failure. Add it, with its own edge kind in `graph.json`.

Two distinct pushback causes, both needed:

- **substantive** — the work is wrong;
- **procedural** — the work may be fine but it was not registered, or was registered wrongly.
  _"You did not record what you did"_ is a legitimate, and currently impossible, rejection.

## R5 — Every shape change of the graph is registered

Expansion, collapse, branch, collect, backtrack. Each is an event carrying who, why, and the node
delta. The summary then answers "how did this graph come to look like this" from the record alone.

Today `graph.revision` is `1` in all five capsules and `plan_history` is empty everywhere. The
interior has never moved, so this has never been exercised — which is precisely why it must be built
before it is relied upon.

## R6 — The CLI must be self-navigating

If the CLI is the only medium, it has to be usable without reading the source. From any state, one
command returns the legal next moves as fully-formed argv with real ids, plus what each unblocks and
what is currently blocking. `reporting/next-actions.ts` already computes much of this and is not
surfaced from `run:status`. Wire it.

This is what makes the rest affordable for a small model: it never has to _derive_ the protocol, only
execute the move it is handed.

## What this changes about enforcement

The current enforcement profile, measured: **strong on structure and state, absent on substance and
initiative**. Every field that carries meaning is free text checked only for non-emptiness, and no
component ever initiates anything — `recoverStale` is correct, complete, and has no caller that runs
on a timer.

The three additions this document demands, in order:

1. **Contracts at every boundary** (R1, R2) — refuse an output that cannot inform a reader.
2. **The coordinator → validator edge** (R4) — someone must be able to reject a rubber stamp.
3. **A heartbeat** — none of the above matters unattended while the only timer in the source tree is a
   watchdog that never touches a lease.

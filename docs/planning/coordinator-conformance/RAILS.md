# Rails: designing the harness for the weakest model that will run it

Third document in this set. `FORENSICS.md` established what went wrong; `DESIGN.md` specified six
refusals; this one states the principle those refusals must obey, and corrects `DESIGN.md` where it
assumed a capable operator.

## The premise

The skill will be run by a small, fast, cheap model on a long task, because that is the economically
sensible thing to do and because two orchestrators often run at once. **The ideal-model case is not
the design target. The weak-model case is.** A harness that produces good runs only when the operator
is already smart has not automated anything — it has relocated the intelligence requirement.

So the bar is: *a model that does not understand the architecture, cannot hold the whole plan in
context, and will take the locally cheapest action at every step, must still produce a well-formed,
parallel, evidenced run.*

## The distinction that matters: a capability is not a rail

Everything the real failure needed already existed.

| What was needed | What exists | Why it did not help |
|---|---|---|
| fine-grained decomposition | `scopeIsNarrow`, `discoverGatePaths` | advisory |
| no artificial serialization | disjoint-scope detection, `SerializationWarning` | advisory |
| scoped gates | `looksWholeSuite`, `gateBreadthWarning` | advisory |
| a growing graph | `plan:apply` + `revision-guard` | unreachable (packet hardcodes revision 0) |
| worker subdivision | `branch:*`, six registered commands | never routed to |

Not one of these is missing. Every one is a **capability** — available to an operator who knows it
exists, is optional, and is therefore invisible to a weak model. A weak model does not explore a
command surface; it repeats the shortest path that did not error.

**A rail is different: the correct action is the default action, and the incorrect action is refused.**
The work of this project is not adding capability. It is converting existing capability into rails.

## The five forcing functions

Ordered by how much they help a weak model, most first.

### 1. Prescribe — tell the model its legal next moves, fully formed

The single highest-leverage mechanism. A weak model is bad at deciding what to do next and good at
running a command it was handed. Every command's output should end with the exact next commands,
already populated with real ids — not a description of what to do, the literal argv.

The seed of this exists: `reporting/task-actions.ts` builds `outstandingGateRuns` and
`validationActions` as real argv. It must become universal and mandatory rather than partial:
from any state, `run:status` answers *"what are my legal moves right now"* exhaustively.

Corollary — **a refusal without a prescribed repair is a defect.** This is where `DESIGN.md` was
wrong. It specified blocking invariants but not what a refused planner does next. A weak model
refused with no path forward does not re-plan; it goes around the harness. That is precisely what
happened in the real run: told to use the skill, it later edited files outside the lease entirely.
Every refusal must carry the command that would satisfy it.

### 2. Derive — compute the answer so the model never chooses

Anything the harness can compute, the model must not be asked to invent.

- Gate for a scope: `discoverGatePaths` already finds real on-disk paths. Offer the narrowest gate.
- Partition of a directory: enumerate the files; emit one task each.
- Dependency necessity: the harness knows scope overlap. The model declares *intent*; the harness
  decides whether an edge is warranted.
- Effort/priority/order fields: derived, never asked for.

Every value a weak model is asked to invent is a place it will invent something plausible and wrong.

### 3. Prove — verify claims mechanically instead of trusting them

A weak model's self-report is not evidence. Where a claim is mechanically checkable, check it:

- A gate is falsifiable only if reverting the task's scope makes it fail (`gate:prove`).
- Work happened only if the scope's content hash changed between claim and submit.
- A task ran in parallel only if concurrent leases overlapped in time.

### 4. Elicit-then-falsify — force a structured claim, then check it against computable truth

This is the systematic self-evaluation the owner asked for, and it is stronger than asking a model to
"reflect", which a weak model does badly. Do not ask for an opinion; demand a *number* the harness can
verify.

At `plan:compile` the planner must declare:

```
independent roots:        N
tasks:                    T
files in total scope:     F
per edge:                 "<child> needs <parent> because <reason>"
```

The harness computes all of N, T and F itself and refuses on mismatch. A weak model that confabulates
"8 independent roots" over a 1-root chain is caught by arithmetic, not by judgment. **Confabulation
becomes a detector instead of a failure**, which is exactly what you want from a model that will
confabulate regardless.

The same shape applies to graph shape-change: every revision records `+nodes / −nodes / reason`, and
the model's stated reason is checked against what actually changed.

### 5. Expose — make absence visible

Silence read as success is the failure mode behind every fabricated completion here. A run that seals
at revision 1, with zero findings, zero branches and a peak concurrency of 1 has almost certainly
under-used the system — the harness knows all four numbers and must say so at completion.

Not a refusal: an advisory that makes a suspicious shape legible instead of silent.

## Resolving hard lines against flexibility

These do not conflict once the boundary is drawn in the right place:

> **The harness constrains HOW. It never constrains WHAT.**

| Hard line (process) | Free (content) |
|---|---|
| must go through the CLI; unexplained tree drift is a finding | any implementation the worker judges best |
| every edge must carry a justification | any topology that can be justified |
| a gate must be provably falsifiable | any command that passes the proof |
| work must occur inside the lease window | any approach taken inside it |
| plan growth goes through the revision guard | any nodes the goal admits |
| the goal/requirement contract is immutable | the entire interior is mutable |

Rigidity about process is what *buys* freedom of content: because the requirement contract cannot be
edited, the interior can be opened up safely. The frozen goal is what makes the fluid middle
affordable — `revision-guard.ts:75-83` already encodes exactly this and is the best-designed code in
the subsystem.

## What this changes in `DESIGN.md`

1. **C1 gains a mandatory repair prescription.** A blocking verdict must emit the exact command that
   resolves it. A refusal that leaves a weak model stuck causes it to leave the harness.
2. **C6 is promoted, not an afterthought.** Derivation (`--auto-partition`, derived gates, derived
   scheduler fields) outranks refusal for weak models, because a model that is handed a correct plan
   never needs to be refused.
3. **New — C7 `plan:next`:** the exhaustive legal-move surface. From any state, the fully-formed
   commands the current role may run now, and what each unblocks.
4. **New — C8 declare-and-verify at compile:** roots/tasks/scope-size declared by the planner and
   checked by the harness; per-edge justification required.
5. **New — C9 shape ledger and completion advisory:** revisions record node deltas with reasons;
   `run:complete` reports revision count, findings, branches and peak-concurrency-vs-peak-ready.
6. **New — C10 out-of-band edit detection:** repository drift not attributable to any recorded command
   is surfaced. This is the direct counter to going around the harness.

## The test this design must pass

Not "does a careful operator produce a good run" — that already worked. The bar is:

> An operator that always takes the locally cheapest action, never reads a reference file, and never
> explores the command surface still produces a decomposed, parallel, evidenced, growing run — because
> every cheaper path is either refused with a repair in hand, or does not exist.

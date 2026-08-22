# PHASE 4 — the hierarchy

## 1. Goal

Let the mind cause code to be written — **without ever writing any**, and without collapsing a tier.

The mind deploys a tier-1 orchestrator for one admitted candidate; the orchestrator deploys a
tier-2 coordinator; the coordinator runs the existing pipeline. Every skip is a refusal.

## 2. Preconditions

Phases 0–3 complete, the shadow week judged worthwhile, and at least one candidate admitted through
all six gates against a real defect in this repository.

## 3. Work items

---

### W4.1 — Reconcile the shipped orchestrator contract

**Files:** `roles/orchestrator.md`, `roles/coordinator.md`, `contracts/packets.ts`.

`roles/orchestrator.md` **already exists** — it landed in commit `8318e5d`, after `PLAN.md` was
written, so §3.2's "new, tier 1" is half-obsolete. Reconcile rather than overwrite:

1. **Remove `orchestrator:run` from its `commands` list** (`roles/orchestrator.md:36`). That command
   throws `INVALID_STATE` unconditionally — `cli/commands/orchestrator-ops.ts:76-80` requires a
   host-injected executor and no injector exists anywhere in the tree. A compliant tier-1 agent
   following the shipped contract today calls a command that cannot work. This is the exact
   capability-versus-rail failure, inverted: a _granted_ capability that does not exist.
2. **Add `mind:round-open` and `mind:round-close`** once W4.2 lands.
3. **Split the dual-role paragraph out of `roles/coordinator.md:102`** — _"This contract covers both
   drivers: the tier 2 coordinator that owns one run, and the tier 1 loop runner that chains runs."_
   One document describing two roles is precisely how a weak model ends up doing the wrong one.

**Acceptance:** a test asserting no role contract grants a command that unconditionally throws — it
enumerates `COMMAND_REGISTRY`, and any command whose handler's only path is a throw fails the
assertion; a test that `roles/coordinator.md` no longer mentions tier 1.

---

### W4.2 — `mind:round-open` / `mind:round-close`

**Files:** `cli/commands/mind-round.ts` (new), `mind/rounds.ts` (new).

Built on `orchestrator/capsule-chainer.ts`, which already carries forward unresolved findings,
unsatisfied requirements and `previousEventHead` into a successor capsule. Do not write a second
chaining mechanism.

`mind:round-open` — flags `--run` (mind capsule), `--actor`, `--objective`, `--candidate`,
optional `--chain-from`. Refuses when: the prior round has a live lease or an unclosed attempt; the
round budget is spent; the candidate is not admitted; the objective's statement differs from the
admitted candidate's (an objective may not drift between rounds — a changed objective is a **new**
objective and belongs to tier 0).

`mind:round-close` — flags `--run`, `--actor`, `--objective`, `--round`, `--result`
(`converged | exhausted | escalated`), and either `--successor` or `--terminal-reason`.

**The arming rail at tier 1:** a round may not close without recording either the next round it
opened or why the chain ended. Same shape as the pulse's arming rail, one level down.

**Acceptance:** a round cannot open over a live lease; a round cannot close without successor or
reason; an objective whose statement changed is refused; chaining carries forward the prior round's
unresolved findings, asserted against the chainer's own output.

---

### W4.3 — Deployment, and the tier rule

**Files:** `roles/mind.md` (upgrade from observe-only), `mind/deploy.ts` (new).

Grant `spawns: [orchestrator]` and the deployment commands. The rule that makes the hierarchy real
rather than decorative:

> **A tier may deploy only the tier directly beneath it.**

The mind never dispatches an implementer. If it wants code written it deploys an orchestrator,
which deploys a coordinator, which pairs an implementer with a validator. Every skip is a refusal,
enforced by the `spawns:` list in the role contract.

Why the indirection earns its cost: **each tier is the thing that bounds the tier below.** An
orchestrator bounds rounds; a coordinator bounds waves and repair budget; a validator bounds "done".
Collapse a tier and you delete a bound.

The tier-1 packet carries (`PLAN.md` §3.4) — nothing new is needed, `packets/render-packet.ts`
already stamps `role_contract_sha256`:

| Field                | Class            | Source                                          |
| :------------------- | :--------------- | :---------------------------------------------- |
| `objective`          | agent_reported   | the admitted candidate's statement              |
| `witness_command_id` | harness_observed | the command that proved the defect exists       |
| `charter_goal_ids`   | harness_observed | which goals admitted it                         |
| `round_budget`       | derived          | from the remaining pulse/day budget             |
| `wall_clock_budget`  | derived          | same                                            |
| `profile`            | agent_reported   | abstract profile name only — never a model name |
| `prohibitions`       | harness_observed | the charter's never-unattended list, verbatim   |

**Acceptance:** a test that a mind grant may not register an implementer, a validator, a
planner or a coordinator; a test that an orchestrator grant may not register an implementer; a test
that the packet contains no model name, tier or thinking level.

---

### W4.4 — Model and effort plumbing

**Files:** `mind/profiles.ts` (new).

Per D9 and `PLAN.md` §10: role → **abstract profile** in the skill; profile → concrete values in an
**owner file** the skill does not contain; the harness records what was actually reported.

```
mind → deliberate     implementer      → default
orchestrator  → deliberate     validator/critic → adversarial
coordinator   → default        sub-investigator → cheap_bulk
planner       → deliberate
```

Ships **unbound** — inherit everything — and an unbound value records as `unknown`. An unbound
deployment works; it is simply not optimised, and its ledger says so.

Degrade honestly: if `detectHostTelemetry()` reports the host cannot select per agent, do not emit
the parameter, record "per-agent model selection unavailable on `<host>`", and say so in the run
summary. Never pretend.

**Do not build adaptation in this phase.** `PLAN.md` §10.4 is explicit: no adaptation until at least
~30 completed implementer/validator pairs per profile exist, and even then one dial, one step,
recorded as a decision. It is the most speculative section of the plan and the last thing to build.

**Acceptance:** a test that greps the entire skill tree for model names and finds none; a test that
an unbound profile renders `unknown` rather than a default; a test that a host without per-agent
selection produces the limitation string rather than a silently dropped parameter.

---

## 4. Check and balance

- **Tier-skip refusals** are tested from both directions: the contract refuses the spawn, and the
  CLI refuses the command.
- **Findings must route.** The delegation audit (`../coordinator-conformance/DELEGATION-AUDIT.md`)
  found that a validator's findings had no transport to the agent that could act on them, and that
  the _success_ path (`workflow/review/record-review.ts:121`) notifies nobody at all. If that is
  still true when this phase starts, it is a work item here, because a hierarchy whose feedback does
  not reach the tier below is a hierarchy in name only.
- **The damage suite from Phase 2 runs against a round**, not only against a task.

## 5. The real-objective experiment

One admitted candidate, end to end, unattended. The pass bar is the set of properties this project
has **never yet achieved in a real run**:

1. **`graph.revision > 1`** — the plan interior actually moved. Both capsules in this repository, and
   all six in the original forensics, show `graph.revision = 1` and `plan_history = []`. The interior
   has never moved. If it still does not move, the round did not adapt to anything it learned.
2. **At least one recorded validator rejection or probe that no quota asked for.** Not a target — a
   demonstration that rejection is reachable.
3. **A `summary:export` a human finds legible**, judged by a human.
4. **Files were actually written during the run window.** Check mtimes against the run span. This is
   the single check that would have caught the original forensic failure, where 11 tasks were claimed,
   submitted and validated in one second with nothing written.

## 6. Failure modes

| Likely mistake                                      | The tell                                               |
| :-------------------------------------------------- | :----------------------------------------------------- |
| Overwriting the shipped `roles/orchestrator.md`     | Commit `8318e5d`'s prose disappears from the diff      |
| Building `orchestrator:run`'s executor              | Host dispatch code inside `scripts/src/` — see D8      |
| The mind dispatching a coordinator "just this once" | A `spawns` list with more than one entry               |
| An objective statement edited between rounds        | Convergence claimed for a goal nobody set              |
| A model name appearing in a packet                  | The grep test fails — and the ledger becomes a fiction |
| Declaring done without checking file mtimes         | The forensic failure, reproduced exactly               |

## 7. Rollback

Revert `spawns` to `[]` in `roles/mind.md` and the mind falls back to a Phase 3 system:
discovery and proposals, no deployment. Round capsules already created are ordinary capsules and are
sealed or abandoned through the existing commands.

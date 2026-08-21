# CONSCIOUSNESS — implementation index

`PLAN.md` is the design. **This directory is the specification.** The design argues for the system;
the specification tells an implementer what to type. An agent that has read only `PLAN.md` will
invent the contracts it needs — flag names, event kinds, state keys, file paths — and two agents
inventing in parallel will invent differently. Read the specification.

## Reading order

| Order | Document          | What it settles                                                                       |
| ----: | :---------------- | :------------------------------------------------------------------------------------ |
|     1 | `README.md`       | The decisions every phase depends on, and how a phase file is meant to be executed     |
|     2 | `CONTRACTS.md`    | The substrate: capsule shape, state keys, event kinds, every command's flags, wiring   |
|     3 | `VERIFICATION.md` | The check-and-balance regime: what counts as proof, and the suites each phase must add |
|     4 | `PHASE-<n>.md`    | Your phase. Do not read forward; later phases assume work you have not done            |
|     — | `PLAN.md`         | The reasoning behind all of it. Read when a specification line seems arbitrary         |

Companion documents referenced throughout, with their real paths:

- `../coordinator-conformance/FORENSICS.md` — the run that produced 11 "successes" and no file writes
- `../coordinator-conformance/DESIGN.md` — the six refusals (C1–C6)
- `../coordinator-conformance/RAILS.md` — the weak-model principle and the five forcing functions
- `../coordinator-conformance/CHANNEL.md` — the CLI as sole medium (R1–R11)
- `../coordinator-conformance/SUPERVISION.md` — the session supervisor, and its measured failures
- `../coordinator-conformance/QUEUE.md` — the ranked backlog and the reconciliation protocol
- `../coordinator-conformance/DELEGATION-AUDIT.md` — guarantees G1–G7 and which are enforced
- `../orchestration-overhaul/AUTONOMOUS.md` — the autonomous operating contract
- `../orchestration-overhaul/model-effort-policy.md` — the owner's deferred model/effort research

## Decisions — settled here, not re-opened in a phase

`PLAN.md` §14.1 leaves seven questions open. Two of them block implementation, because they decide
file paths and command names that every phase writes. They are decided below. The rest stay open and
are scheduled into the phase that can answer them with evidence.

Each decision is reversible by editing this section and the phase that implements it — but it is not
reversible by an implementer mid-task, and an implementer that disagrees records a finding rather
than diverging.

### D1 — The namespace is `mind:`

Domain string `"mind"`, commands `mind:init`, `mind:wake`, and so on. Chosen over `consciousness:`
because a weak model retypes these constantly and every character is a chance to mistype. The
*system* is called Consciousness; the *command namespace* is `mind:`. `roles/consciousness.md`
keeps the long name because a role is typed once per grant.

### D2 — The mind capsule is a real capsule at `.capsules/mind-<generation>/`

It is created by `initRun` (`store/capsule.ts:24`) exactly like a run capsule. This buys, with zero
new code: the kernel lock (`platform/run-lock.ts`), the append-only hash chain
(`store/event-append.ts`), checkpointing every 20th event, the canonical state projection, torn-tail
repair via `doctor:repair`, integrity verification, and the capsule index.

Consequence, stated so nobody is surprised by it: `.capsules/` is gitignored (`.gitignore:18`). The
mind does not travel with the repository and is not backed up by pushing. Phase 6 owns that problem
and it is the single most likely way a remote deployment silently loses its history.

Rejected alternative: a committed `.mind/` directory. It would need either a second store
implementation or a `.gitignore` exception, and it commits a monotonically growing event log to Git
history. The plan's own §14.1.2 leaves this open; it is closed here in favour of reuse.

### D3 — The charter IS the mind capsule's `prompt.md`

`mind:init --charter <path>` reads the charter's bytes and hands them to `initRun` as the prompt,
with `capture_mode: "file"` and `source_verified: true` (`store/assurance.ts`).

This is not a convenience. It means the charter pin already exists and is already enforced:

- `manifest.prompt_sha256` **is** the pinned charter digest.
- `prompt.md` is written `0o444` and `checkManifest` (`store/manifest.ts:42-55`) already refuses a
  capsule whose `prompt.md` is writable or whose bytes no longer hash to the manifest.
- "Consciousness may not edit the charter" is therefore not a rule an agent could break. It is a
  file mode and a hash, checked on every load.

Drift detection at `mind:wake` is then one comparison: re-hash the file at
`state.charter.source_path` and compare it to `manifest.prompt_sha256`. Equal means the owner has
not edited the charter since the pin. Unequal means HALT (`PLAN.md` §8.2).

### D4 — The capsule flag is `--run`, never a new `--mind` flag

`assertGrantedCommand` (`packets/command-authority.ts`) resolves the capsule from a flag literally
named `run`, and returns silently — granting everything — when it is absent. A `mind:*` command that
took `--mind` instead would pass its role contract unchecked while *appearing* to be governed by
one. That is the exact capability-versus-rail failure this whole project exists to prevent.

So: `--run .capsules/mind-1`. If someone later wants `--mind` as an ergonomic alias, it is a
deliberate task that extends `command-authority.ts` in the same change, with a test that proves an
out-of-contract command is still refused through the alias.

### D5 — Tier 0 requires widening the role-contract tier bound

`packets/role-contract.ts:168` refuses any tier outside 1–3. `roles/consciousness.md` declares
`tier: 0`. Phase 1 widens the bound to 0–3 and updates `tests/unit/roles/role-documents.test.ts:72-73`.
`tier` is not used for enforcement anywhere in `src/` — it is a declared fact — so the change is
small, but it is a change, and it is a work item rather than a surprise an implementer discovers.

### D6 — Every new role is three edits, not one file

Adding `roles/<role>.md` alone **fails the suite**. `tests/unit/roles/role-documents.test.ts:24-30`
asserts that `roles/` holds exactly one document per member of `AGENT_ROLES` plus one per validator
domain. A new role therefore requires:

1. `roles/<role>.md`
2. the `AgentRole` union in `contracts/packets.ts:3-14`
3. the `AGENT_ROLES` array in `contracts/packets.ts:16-28`

and, because `references/protocol.md:40` states a role count that is already stale at eleven, a
correction there too.

### D7 — The harness records escalations; the driver notifies

The harness has no outbound channel and must never grow one: `SKILL.md:53` (invariant 6) forbids
calling a model API, and `PLAN.md` §11.3 puts outbound webhooks on the never-unattended list.
`mind:escalate` therefore **only** appends an event and writes `escalation.md` in the capsule.

The notification half belongs to `pulse.sh`, which is outside the harness and is the driver
contract's fourth obligation (`PLAN.md` §5.1: REPORT). Where `PLAN.md` says a pulse "fires a push
notification", read: the pulse records, and the driver — reading the exit code and
`last_pulse.json` — notifies through whatever the owner configured.

An implementer that finds itself adding an HTTP client to `scripts/src/` has misread this and must
stop.

### D8 — `orchestrator:run` stays unbuilt

Its executor does not exist anywhere in the tree (`cli/commands/orchestrator-ops.ts:76-80` throws
`INVALID_STATE`; there is no injector). Building one means writing host-side model dispatch inside a
harness whose sixth invariant is that it never does that. Rounds are driven pulse-by-pulse instead.

Note the live contradiction Phase 4 must fix: `roles/orchestrator.md:36` already grants
`orchestrator:run` to the shipped tier-1 role, so a compliant agent will call a command that always
throws.

### D9 — No model name, tier or thinking level appears anywhere in this skill

Profiles are abstract (`deliberate`, `default`, `adversarial`, `cheap_bulk`) and ship **unbound**.
The owner binds them in their own file. The harness records what was actually reported and renders
an unbound value as `unknown`. See `PLAN.md` §10 and `../orchestration-overhaul/model-effort-policy.md`.

### Still open, and where each is answered

| Question                                    | `PLAN.md` | Answered by                                                       |
| :------------------------------------------ | :-------- | :---------------------------------------------------------------- |
| One mind per repo, or one across repos?     | §14.1.3   | Deferred past Phase 6. Per-repo until a second repo actually asks |
| What counts as "the app is stable"?         | §14.1.4   | The charter's `stability` block; Phase 1 writes this repo's       |
| Should a quiescent mind ever propose?       | §14.1.5   | Measured in Phase 3's shadow week, then decided                   |
| Is Antigravity's scheduler durable?         | §14.1.6   | Phase 6 verifies before any adapter table claims it               |
| `host_reported` is defined and unassigned   | §14.1.7   | Out of scope. Until something assigns it, model data is a claim   |

## How to execute a phase file

Each phase file has the same seven sections, in the same order:

1. **Goal** — one sentence. If the work does not serve it, it belongs to another phase.
2. **Preconditions** — what must be true before starting, as commands that must exit 0.
3. **Work items** — numbered `W<phase>.<n>`. Each names its files, its change, its acceptance test,
   and whether it may run in parallel with its siblings.
4. **Check and balance** — the suites that prove the phase, including the negative ones.
5. **Exit criteria** — the phase is done when every line here is a command that passed.
6. **Failure modes** — what an implementer is most likely to get wrong here, and the tell.
7. **Rollback** — how to undo the phase without stranding a capsule.

Rules that hold in every phase:

- **A work item is not done until its acceptance test exists and fails without the change.** This is
  `gate:prove`'s logic applied to the phase itself. Write the test first, watch it fail, then fix.
- **No comments in code.** This repository forbids them. If a comment seems necessary to explain a
  contract subtlety, the subtlety belongs in the relevant `references/*.md`.
- **No `any`, no `@ts-ignore`, no `eslint-disable`, no `v8 ignore`.** If a third-party type forces
  one, stop and report it rather than introducing it quietly.
- **Every refusal carries the argv that would satisfy it.** `RAILS.md`: a refusal without a
  prescribed repair is a defect. This is graded — see `VERIFICATION.md` §4.
- **No prompt, packet, brief or test may state a target count** for anything a model produces.
  `PLAN.md` §12.4. Ceilings yes; quotas never.
- **Absent stays absent.** A value nobody measured renders as `unknown`, never as a plausible
  default. `references/protocol.md:13-14`.

## The dependency graph between phases

```
   PHASE 0  ground repair ─────────────┐
     (independent of everything)       │
                                       ▼
   PHASE 1  Pulse Zero  ──────────────► PHASE 2  rescue + repair ──┐
     capsule · 4 commands · driver         lane selector           │
                                           damage suite            ▼
                                                          PHASE 3  discovery
                                                            10 sources
                                                            6 gates
                                                                   │
                                                                   ▼
                                                          PHASE 4  hierarchy
                                                            tier 1 rounds
                                                                   │
                                       ┌───────────────────────────┤
                                       ▼                           ▼
                              PHASE 5  audit + economics   PHASE 6  container
```

Phase 0 may start immediately and in parallel with nothing else pending. Phase 1 must not start
until Phase 0's exit criteria pass, because Pulse Zero's whole value is that it runs against a
harness whose monitor does not lie. Phases 5 and 6 may run in parallel with each other.

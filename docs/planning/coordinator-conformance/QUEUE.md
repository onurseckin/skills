# Queue: what is running, what is next, and the standing rules

Live working state for the coordinator-conformance arc. `FORENSICS.md` holds the evidence,
`DESIGN.md`/`RAILS.md`/`CHANNEL.md` hold the specifications. This file holds the order of work and the
rules that apply to every wave.

## Standing rules

1. **Docs are the last stage of every loop.** No phase is finished until the documentation reflects
   what the code now does. Owner's words: _"after each process docs should be always up to date"_.
2. **Every sub-phase must land committable and pushable** — unit lane green, typecheck clean, lint
   clean, format clean. Never a suppression, a skip, a weakened assertion or a rule change to get
   there. Fix the problem.
3. **Never assume; verify.** Open the file, run the command, read the output. A claim that was not
   executed is not a result.
4. **Findings become queue items.** Anything discovered mid-wave that is out of that wave's scope is
   appended here rather than fixed opportunistically or forgotten.
5. **Comments are relocated, not deleted.** Contract knowledge in a comment moves into the docs before
   the comment is removed; a comment marking unfinished work is removed only after the work is done.

## Ranked backlog

Ordering reasoning: nothing else is observable until the installed runtime matches the source, so C11
precedes everything. C3b then does triple duty — gate discrimination, the validation evidentiary
floor, and partial write-scope truthfulness — using code that already exists and is already correct.

| #   | Item                                                                    | Status | Why here                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | ----------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **C11 — installed-runtime freshness**                                   | queued | All five live capsules show `plan-audited=0`, `gate-proved=0`. Both trees report `RUNTIME_VERSION "0.1.0"` so nothing can detect drift. `installer/installation-status.ts` + `identity.ts:48` already digest the source tree; call them from `orchestrate`/`plan:init`, not only from `doctor`. Installing the current build also delivers the 429/backoff handling and the dual-channel UI refusal, both of which already exist and neither of which is installed. |
| 2   | **C3b — `gate:prove` at `task:review`**, `base` = sha recorded at claim | queued | At compile there is no work to revert, so the proof is incoherent there. At review all three inputs exist: a sealed gate, real work, a baseline. Make a `falsifiable: true` proof a precondition beside `assertProbeSatisfied`. Closes gate discrimination, the validation gap, and — because reverting a _declared_ scope leaves out-of-scope work standing — partially enforces scope truthfulness.                                                               |
| 3   | **C10 — out-of-band edit detection**                                    | queued | `write_scope` is declared, never enforced: `build-report.ts:34-38` discards the harness's own observation when the agent declares a list. `packets/round-repository-delta.ts:62-70` already runs the exact `git diff`; add `--name-only`, subtract the union of scopes, surface the remainder. ~40 lines on existing machinery.                                                                                                                                     |
| 4   | **The heartbeat**                                                       | queued | `recoverStale` is correct and deliberately re-entrant, but the only `setInterval` in the tree is the watchdog and it never touches a lease. `supervisor.ts:255-257` returns `single_tick` without a dispatcher. **No role contract grants `orchestrator:run` or `orchestrator:supervise`.** Without this, nothing recovers while the operator is away.                                                                                                              |
| 5   | **R1/R2 — role output contracts and the empty-evidence refusal**        | queued | Per-role required output shape, checked at the CLI boundary. A UI validator needs screenshots _regardless of verdict_. Where substance cannot be judged, require an artifact (a command record, a file with non-zero bytes, a hash) rather than a sentence.                                                                                                                                                                                                         |
| 6   | **R4 — the coordinator → validator pushback edge**                      | queued | All pushback today flows validator → implementer. The edge that would have caught the UI failure does not exist. Needs its own edge kind in `graph.json`. Two causes must be expressible: substantive (the work is wrong) and procedural (it was not registered, or registered wrongly).                                                                                                                                                                            |
| 7   | **Make `plan:apply` reachable**                                         | queued | The frozen-goal growth path is the best-designed code in the subsystem (`revision-guard.ts:75-83` refuses a requirement-contract change while leaving task addition unrestricted) and it is unreachable: `packets/planner-packet.ts:32,40,57` hardcodes revision 0, and `plan:apply` is absent from `roles/coordinator.md`.                                                                                                                                         |
| 8   | **A2 — replace the permanent stub**                                     | queued | `auditPlan` always emits A2 as `not_evaluated`, so a one-task plan whose scope names a not-yet-existing directory compiles with zero findings — the exact forensics shape. Its stated excuse (no entity count available) is refuted by `requirements/compiler.ts:44-49`, which already computes `nonBlankLineIndices` from the immutable prompt.                                                                                                                    |
| 9   | **A3 — compare gate structure, not bytes**                              | queued | `plan-audit.ts:129` is exact string equality, so appending `--scope=t0` manufactures fake discrimination. Compare `(executable, subcommand, target set)`.                                                                                                                                                                                                                                                                                                           |
| 10  | **`plan:review` evidentiary floor**                                     | queued | `approved` legally carries zero commands by design, so an entire compiled plan is approvable on four free-text sentences — materially weaker than `task:review`.                                                                                                                                                                                                                                                                                                    |
| 11  | **Data-model unification**                                              | queued | `screenshots` is a lossy projection of `screenshot_records` (`reporting/command-evidence.ts:21-22`). `inspection-formatter.ts:61` reads `status ?? verdict ?? decision ?? "unknown"` — three names for one concept plus a fabricated literal. The alias is banned; delete it.                                                                                                                                                                                       |
| 12  | **Audit the 16 integration tests**                                      | queued | Nothing currently gates on `tests/integration`, so their correctness is unverified.                                                                                                                                                                                                                                                                                                                                                                                 |

## In flight

- **test-lane** — clear the last 10 unit failures, then classify every slow test by nature (not speed)
  and rewrite or move accordingly, under a deterministic isolation contract.
- **hygiene-and-docs** — root cleanup, comment audit across all 20 source directories, docs rewrite.

## Settled, do not re-litigate

- Dispatch is continuous per-task readiness. There is **no wave barrier** —
  `scheduler/propose-batch.ts:66-72` filters each task against its own `depends_on`;
  `ready-set.ts:11-13` states the recorded topology is a display annotation only.
- The frozen goal **is** enforced (`revision-guard.ts:75-83`).
- `assertValidatorCommands(requireAllGates=true)` genuinely prevents a validator rubber-stamping
  without running every mandatory gate under its own actor id.
- PASS is the most heavily guarded transition in the codebase, not the least.
- The `converged_success` fabrication came from the harness's own `defaultExecuteRound`, not from an
  agent. The source tree has already deleted that path; the installed build has not.

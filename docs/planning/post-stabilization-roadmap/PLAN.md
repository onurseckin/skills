# Post-Stabilization Roadmap: Sequenced Debt-Reduction Backlog

> **Tracking ID:** `plan-post-stabilization-roadmap`  
> **Status:** `PROPOSED - SEQUENCED BACKLOG`  
> **Priority:** `P1_OWNER_DIRECTIVE`  
> **Target Subsystems:** `olt/scripts/src/mind/`, `olt/scripts/src/reporting/`, `olt/scripts/src/cli/`, `olt/scripts/src/packets/`, `tests/`, `.olt/`, `lefthook.yml`, `AGENTS.md`  
> **Author:** Main-thread stabilization session  
> **Created:** 2026-09-06

---

## 1. Framing: Why This Is a Sequenced Backlog, Not a Migration

Lefthook's gates have two different scopes, and that asymmetry is what makes staged sequencing possible instead of a big-bang rewrite:

| Hook         | Command                 | Scope             |
| :----------- | :---------------------- | :---------------- |
| `pre-commit` | `oxlint {staged_files}` | staged files only |
| `pre-commit` | `oxfmt {staged_files}`  | staged files only |
| `pre-commit` | `modularity:staged`     | staged files only |
| `pre-commit` | `test:purity:staged`    | staged files only |
| `pre-commit` | `test:changed`          | staged files only |
| `pre-commit` | `typecheck`             | **repo-wide**     |
| `pre-push`   | `modularity:check`      | **repo-wide**     |
| `pre-push`   | `test:purity --all`     | **repo-wide**     |
| `pre-push`   | `test:coverage`         | **repo-wide**     |

Every pre-commit gate except `typecheck` only ever looks at the files in the current commit. That means purity debt (4643 violations) and modularity debt (2566 violations) are payable **incrementally, one staged batch at a time** — nobody has to touch all 508 impure test files or the whole modularity backlog in a single sitting. The repo-wide totals only matter at `pre-push`.

**Owner directive, effective the next commit onward:**

- **PRE-COMMIT must pass on merit.** No `LEFTHOOK=0`, no `--no-verify` on commit.
- **PRE-PUSH may continue with `--no-verify`** until the repo-wide `modularity:check` and `test:purity --all` totals reach zero.

Every wave below is scoped so the files it touches leave `pre-commit` green on merit; none of them require the repo-wide gates to pass yet.

---

## 2. Wave 0 — Unblock the Gate Itself

Small, do first — nothing downstream can be trusted while the gate itself is broken.

| #   | Item                     | Location                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Definition of Done                                                                                 |
| :-- | :----------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------- |
| 0.1 | `modularity:check` crash | `bun run modularity:check` currently throws `ENOENT` walking a stale staged-add whose target file was deleted (observed against `scripts/testing/guardrails/baseline/index.json`; re-verify the exact path at pickup time since the tree is in flux — re-running showed a second, different ENOENT against a since-deleted `olt/scripts/src/cli/commands/task-assign-repairer.ts`). Re-stage or remove the dangling index entries so the walker only sees files that exist on disk; if a code path in `scripts/modularity/modularity-cli.ts` assumes staged adds always resolve, add a existence guard instead of trusting the git index blindly. | `bun run modularity:check` exits without ENOENT.                                                   |
| 0.2 | Stray debug output       | `olt/scripts/src/packets/command-authority-grants.ts` — remove any `console.error("DEBUG assertGrantedCommand", ...)` left in `assertGrantedCommand` (re-check first: as of this audit the string no longer greps in the file, so this may already be resolved by a concurrent track — confirm before spending a task on it).                                                                                                                                                                                                                                                                                                                     | `grep -rn "DEBUG assertGrantedCommand" olt/scripts/src/` returns nothing.                          |
| 0.3 | Oversized test file      | `tests/cli/commands/tasks/reviews/task-review-verdicts.test.ts` is 347 lines, over the 400-line cap; it will fail `modularity:staged` the next time anyone touches it. Split by verdict category (e.g. `-approve`, `-reject`, `-escalate` siblings) mirroring the domain split used elsewhere in `tests/cli/commands/tasks/reviews/`.                                                                                                                                                                                                                                                                                                             | `wc -l` on every resulting file ≤ 400; `modularity:staged` passes when the split files are staged. |

---

## 3. Wave 1 — Runtime Ship-Blockers

Highest value: in every case below, tests are green while the feature is either unreachable or a no-op. Green coverage is actively hiding these gaps, so they outrank purity/modularity cleanup.

### 3.1 Epic 13 — Two-tier concurrency accounting (NOT STARTED)

`olt/scripts/src/mind/concurrency-cap.ts` treats every tier identically: `isSaturated()` (`activeSeats.size >= this.maxCap`) and `getStats()` count all seats regardless of `tier`, and no `activeSupervisors` concept exists. Idle Tier 0-2 supervisors occupy seats and are counted toward saturation, so the fleet can falsely report itself saturated while Tier 3 workers sit idle. Add a tier-aware exemption so only Tier 3 execution seats count toward `isSaturated()`/capacity, and surface supervisory occupancy separately (e.g. `activeSupervisors` in `FleetConcurrencyStats`).
**DoD:** a unit test asserts `isSaturated()` stays `false` while N idle Tier 0-2 seats are held and zero Tier 3 seats are active, at `maxCap` capacity.

### 3.2 Epic 16 — Two-key validator gate never fires

`olt/scripts/src/reporting/socratic-validator/evaluators-2.ts`, `evaluateTwoKeyValidatorPairing`, short-circuits with `if (state.two_key_pairing === undefined) return [];`. Nothing in the landing path ever populates `two_key_pairing`, and the function itself is never invoked from task landing/finish gates, so validator pairing is currently unguarded end to end. Wire a producer that populates `two_key_pairing` from the implementer + cognitive-validator receipts, and call `evaluateTwoKeyValidatorPairing` from the finish-task gate (`olt/scripts/src/workflow/gates/finish-task.ts`) alongside the existing `MIN_ADVERSARIAL_PROBES` check.
**DoD:** a landing attempt with a missing or mismatched validator receipt fails the finish-task gate with a named verdict; a matched pair passes.

### 3.3 Epic 14 — Dynamic graph clustering orphaned

`olt/scripts/src/mind/planning/dynamic-graph-clustering.ts` implements real clustering, but `clusterTasks`/`provisionTaskClusters` have zero real callers — the only reference outside the module itself is the barrel re-export at `olt/scripts/src/mind/planning/index.ts:85`; the apparent hit in `mind/tasks/smart/executor/execution.ts:130-140` is an unrelated local loop variable of the same name, not the imported function. Wire the real functions into the task-scheduling entry point that currently builds clusters ad hoc (the executor above is the natural call site).
**DoD:** an integration test proves a scheduling run routes through `provisionTaskClusters` (not a shadowed local), e.g. by asserting on cluster metadata only the real implementation produces.

### 3.4 Epic 17 — `quota:freeze` incomplete

`executeGracefulSoftExit` (handoff.md authoring + git staging) is never called from the `quota:freeze` command, and the command declares a required `actor` flag whose context parameter is received as `_context` (unused), so no authentication check ever runs. Wire the command handler to call `executeGracefulSoftExit` and to validate `actor` against the session context before proceeding.
**DoD:** invoking `quota:freeze` without a valid `actor` is rejected; a valid invocation produces a `handoff.md` and a staged working tree.

### 3.5 Epic 5/19 — `regression-gen` still emits the tautology it was meant to eliminate

`olt/scripts/src/mind/defects/loop/regression-gen.ts`: the empty-suite fallback (around line 86) still emits `expect(true).toBe(true)`, and the three category branches (lines ~53-63) each build `assertion` from fields drawn from the same literal `defectMeta` object being asserted against (`expect(meta.category).toBe("boundary_violation")` where `meta.category` was just set to that literal) — a self-referential round-trip, not an empirical assertion. Regression tests need to assert against the defect's actual persisted record or an observable side effect, not a copy of the input literal. Additionally, generated output currently targets `tests/unit/mind/*.test.ts`; the mandated location is `tests/regressions/`.
**DoD:** `generateRegressionTestSuite` output contains no `expect(true).toBe(true)` and no assertion whose both sides derive from the same input object; generated file path hints resolve under `tests/regressions/`.

### 3.6 Duplicate `defect-audit` command directory

`olt/scripts/src/cli/commands/defect-audit/` (9 files: `apca.ts`, `command.ts`, `discovery.ts`, `formatter.ts`, `index.ts`, `promotion.ts`, `summary.ts`, `test-gen.ts`, `types.ts`) has zero production importers. The live path is the legacy sibling `olt/scripts/src/cli/commands/defect-audit.ts`, wired via `olt/scripts/src/cli/registry/diagnostics.ts:1` (`import { defectAuditCommand } from "../commands/defect-audit.ts"`). Delete the orphaned directory.
**DoD:** `grep -rn "commands/defect-audit/" olt/scripts/src` returns nothing outside the deleted directory itself; `typecheck` and `defect-audit`-related tests still pass.

### 3.7 Test-runner and language-agnosticism in agent manifests

Agent YAML manifests and reference docs hardcode `bun test`, baking a Bun/TypeScript assumption into a skill that must govern _any_ consumer repository regardless of language, package manager, or test runner. `.olt/policy.json` already declares the single source of truth:

```
"test_runner": { "enabled": true, "default_command": "bun test", "targeted_pattern": "bun test <path>", "full_suite_command": "bun test:all", "timeout_ms": 30000 }
```

Manifests and briefings must reference that policy, never a literal command — this is a language-agnosticism invariant, not a text substitution. The underlying rule is that the skill carries zero assumptions about a consumer repo's language, package manager, or test runner.

There is a severity split that drives work order:

- **Executable/structured fields (fix first).** `olt/agents/mind.yaml:63` has a structured `- command: "bun test tests/unit"` entry under `stability:` — a literal command the harness actually runs, which hard-fails in any non-Bun consumer repo. Sweep `olt/agents/*.yaml` for any other structured `command:` field carrying a literal runner.
- **Prose fields (fix second).** Responsibilities/prohibitions text mentioning `bun test`, `npm test`, `vitest` is misleading and teaches agents the wrong invariant, but is not executed. Confirmed occurrences: `olt/agents/coordinator.yaml:56`; `olt/agents/implementer.yaml:36,44,164,167`; `olt/agents/orchestrator.yaml:83,163`; `olt/agents/mind.yaml:297`; `olt/agents/sub-implementer.yaml:40,120`.

**Scope (verified):** 5 of 23 files in `olt/agents/*.yaml`, plus `olt/references/topology-exemplar.md`, `run-playbook.md`, `schema-examples.md`, `host-environment.md`, `cli-capabilities/domains/{critic,run,defect}.md`, `cli-capabilities/domains/plan/authoring.md`, `cli-capabilities/domains/task/ops.md`, `cli-capabilities/domains/diagnostics/audit.md`, plus `olt/AGENTS.md` and `olt/SKILL.md`.

**Build on the existing mechanism, do not invent a new one.** `olt/scripts/src/cli/commands/task-brief.ts` already derives recommended commands from policy via `isTestingEnabled` (`olt/scripts/src/policy/index.ts:172`) and `deriveRecommendedCommands` (`olt/scripts/src/cli/commands/task-brief-helpers.ts:15`). Manifests should route through that resolution path rather than a parallel one. Preserve the tri-state contract from `docs/planning/optional-unit-testing-and-policy-governance/PLAN.md`: when `test_runner` is disabled, manifests must render **no test command at all**, not a default.

The same class of assumption likely exists for typecheck (`tsc --noEmit`) and lint (`oxlint`) commands baked into manifests; sweep those in the same pass against their `.olt/policy.json` equivalents (`typecheck_command`, `lint_command`).

**DoD:** `grep -rEn "bun test|npm test|pnpm test|vitest|jest|pytest|go test" olt/agents olt/references` returns zero hits outside documentation explicitly illustrating this repo's own policy values; every structured `command:` field resolves from `test_runner` policy at render time instead of a literal.

---

## 4. Wave 2 — Test Purity Migration + `.olt/` Pollution

Largest and most mechanical; suitable for cheap/fast models running in parallel batches. 508 of 2195 test files carry 4643 violations, ~95% category `filesystem`. Migrate real filesystem access to `VirtualMemoryFS`, one domain batch per commit so `test:purity:staged` passes on each commit.

| Batch | Scope                | Definition of Done                                                                                                                                                    |
| :---- | :------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `tests/store/**`     | Zero `filesystem`-category rows for this path in `bun run test:purity:staged` when staged; `bun run test:purity --all` violation count for `tests/store/` drops to 0. |
| 2     | `tests/session/**`   | Same criteria, scoped to `tests/session/`.                                                                                                                            |
| 3     | `tests/capture/**`   | Same criteria, scoped to `tests/capture/`.                                                                                                                            |
| 4     | `tests/cli/**`       | Same criteria, scoped to `tests/cli/`.                                                                                                                                |
| 5     | `tests/agents/**`    | Same criteria, scoped to `tests/agents/`.                                                                                                                             |
| 6     | `tests/authority/**` | Same criteria, scoped to `tests/authority/`.                                                                                                                          |
| 7     | Remainder            | All files not covered above; run to zero.                                                                                                                             |

Each batch commit: stage only that domain's files, run `bun ai:coverage-orchestrator:validate <changed files>`, confirm `test:purity:staged` is clean before committing.

**Bundled — same root cause, `.olt/` pollution:** impure tests currently write into the _real_ `.olt/`, not a virtual FS. 693 of 1065 rows in `.olt/defects.jsonl` are test fixtures (e.g. `"unknown command: nope"`, `"--id is required"`, `source_repo` paths under `/private/var/folders/.../olt-defect-routing-*`), and sentinel strike files are written during test runs. The Mind reads this ledger for real signal, so today it is partly reading its own test noise.

- Redirect all such fixtures to `VirtualMemoryFS` as part of the batch that owns them (most land in the `tests/cli` and `tests/agents` batches above).
- Once redirected, purge the 693 identified test-fixture rows from `.olt/defects.jsonl` (filter by the `source_repo` pattern and known fixture message strings above) and any sentinel strike files with the same provenance.
  **DoD:** `.olt/defects.jsonl` contains zero rows whose `source_repo` matches a temp-directory pattern; a full local test run leaves `.olt/` byte-identical before and after (`git status` on `.olt/` before/after shows no diff).

---

## 5. Wave 3 — Hygiene and Drift

- **AGENTS.md drift.** Root `AGENTS.md` states the hard file-size limit as ≤400 physical lines (lines 138, 576, 623), but `olt/AGENTS.md:466` still says ≤200 lines for production sources / ≤250 for test suites. Reconcile to one number — 400 is the currently-enforced value per `scripts/modularity`. Also verify whether root `AGENTS.md` §2's role-contract table and `olt/SKILL.md` rule 31 still describe roles that §26 / rule 39 elsewhere declare retired; update or remove the stale rows.
  **DoD:** a single line-limit number appears in both files; no role appears as both active and retired.
- **Modularity backlog.** 2566 violations: 2285 `facade_bypass`, 184 `line_limit`, 44 `fanout`. The last ratchet run showed a net regression (58 added / 10 worsened / 9 resolved) — flag this trend in the ratchet report each wave so it doesn't silently worsen while purity work is prioritized.
  **DoD:** ratchet report attached to each wave's landing commit shows net-negative or flat violation delta.
- **Dead operational state in `.olt/`:**
  - Orphaned lease `.olt/locks/leases/track-multi-orch-dispatch.json` (`status: "active"`, `expiresAt: 9999999999999`) points at a worktree that no longer exists — release it.
  - 9 agent grants under `.olt/capsules/mind-gen-1` have zero matching release events — audit and close them out.
  - Capsule `track-rbac-test-mutex` stalled after coordinator registration: `task-1` stuck `ready`, `task-2`/`task-3` stuck `proposed` — either advance or archive the capsule.
    **DoD:** `harness.ts lease:list` and `harness.ts capsule:status` show none of the three anomalies above.
- **Stale defect closure.** `defect-cognitive-pushback-quota-runtime-gap` claims the pushback quota is only a post-hoc diagnostic; that is no longer true — `olt/scripts/src/workflow/gates/finish-task.ts:106-114` now hard-enforces `MIN_ADVERSARIAL_PROBES = 5` before a task can transition to `done` (landed in commit `4c6083aa`). Close the defect citing that gate as resolution proof. Separately, 3 defects in `completed-defects.jsonl` were closed by `main-thread-stabilizer` with `resolution_note: null` — require a real resolution note or reopen them.
  **DoD:** the defect is `resolved` with a `resolution_note` citing the file:line above; the 3 null-note defects each carry a substantive note or are back in an open state.
- **Non-reproducible fixtures.** `tests/liaison/daemon/{service,projection}.test.ts` point at a gitignored, locally-archived capsule and will not reproduce on a fresh checkout or in CI. Replace with a committed synthetic fixture that exercises the same code path.
  **DoD:** both tests pass from a clean clone with no local `.olt/` state.
- **Four-role legacy purge remainder.** The `repairer`, `mechanic-validator`, `ui-validator`, and `ui-mechanic-validator` role purge landed **structurally** this session — manifests deleted, `olt/scripts/src/cli/commands/task-assign-repairer.ts` removed, registry entries cleaned — but a string-reference sweep remains across approximately 79 files, predominantly test literals in `tests/agents/identity`, `tests/doctor/rules`, `tests/graph/expansion`, `tests/scheduler/core`, and `tests/contracts/schemas`, plus `olt/scripts/src/mind/auditing/roles/rules/matrix.ts`. This is mechanical, well-suited to bulk processing across parallel agents. `tests/roles/ecosystem/plan-91-roles.test.ts` is the guard test that must stay green throughout.
  **DoD:** `grep -rlE '"repairer"|"mechanic-validator"|"ui-validator"|"ui-mechanic-validator"' tests/ olt/` returns nothing; `tests/roles/ecosystem/plan-91-roles.test.ts` passes.

---

## 6. Explicitly Deferred (Owner Decision — Record, Do Not Schedule)

- **Epic 11** — the `activeRuns === 0` pulse blindfold in `mind-pulse-formatter.ts`.
- **Epic 8** — a `tests/`-only location ratchet.
- **Regenerating `~/.claude/agents/` from `olt/agents/*.yaml`.**

---

## 7. Execution Protocol

- Each wave lands as its own commit (or short commit series within the wave); `pre-commit` passes on merit for every commit — no `LEFTHOOK=0`, no `--no-verify` at commit time.
- `pre-push` may continue to run with `--no-verify` until `bun run modularity:check` and `bun run test:purity --all` both report zero repo-wide violations; re-evaluate this exception once Wave 2 completes.
- Every task above states its definition of done as a runnable command or an observable assertion — no task is considered complete on narrative claim alone.
- Wave order is fixed (0 → 1 → 2 → 3) because Wave 0 unblocks the gate everything else is measured against, and Wave 1 removes ship-blockers that green tests are currently hiding; Waves 2-3 are debt paydown and can be parallelized internally (per-batch, per-item) once Waves 0-1 land.

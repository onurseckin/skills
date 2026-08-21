# Queue: what is running, what is next, and the standing rules

Live working state for the coordinator-conformance arc. `FORENSICS.md` holds the evidence,
`DESIGN.md`/`RAILS.md`/`CHANNEL.md` hold the specifications. This file holds the order of work and the
rules that apply to every wave.

## Count, settled 2026-08-21

**27 tracked items. 9 closed, 18 open.** Of the 22 pre-existing ranked rows, 9 are done
(#1, #6, #7, #8, #9, #14, #15, #16, #17) and 13 are still open (#3, #4, #5, #10, #11, #12, #13, #18,
#19, #20, #21, #22, #23). This pass folds in 5 more from `DELEGATION-AUDIT.md` (D1-D5, all open,
none fixed this wave — see below) for the 27/9/18 total.

This settling pass verified four rows independently rather than trusting `DELEGATION-AUDIT.md`'s word,
per standing rule 3 — opening the cited file or running the cited command myself for each:

- **#1** (CI) — confirmed: `.github/workflows/ci.yml` runs `Typecheck` → `Unit tests` (`bun run test`)
  → `Format check` in one unconditional job; `package.json:19` maps `test` to
  `bun test --timeout 30000 --parallel --no-isolate tests/unit`. **DONE, holds.**
- **#16** (`abandonAttempt` unreachable) — confirmed: `task-abandon.ts:2` imports `abandonAttempt`,
  `:12` calls it; `cli/registry/task.ts:290` registers `task:abandon`. **RESOLVED, holds.**
- **#6** (`plan:review` evidentiary floor caveat) — confirmed: `find . -iname "*cli-plan-validate*"`
  and `ls tests/integration` both come back empty; the caveat's own citation no longer exists.
  **RESOLVED, unqualified, holds.**
- **#17** (health tool false positive) — confirmed **half** right, corrected the other half. Ran
  `bun harness.ts health --all` myself: `store/index.ts` is confirmed gone from all 730+ lines of
  output — that part of DONE holds. But the claim that the resulting single unused-code failure "is
  the allowed `harness.ts:27` entry point" does not hold **right now**: `health/report.ts:21`'s
  `shown = failures.slice(0, listed)` prints failures first, and today's first (and only) unused-code
  failure is `store/content-normalization/normalize.ts:79`'s `contentEquals` — genuinely unused in
  production (only `tests/unit/store/content-normalization/normalize.test.ts` calls it; `harness.ts:27`
  is correctly bucketed as one of the 4 **allowed** entries, not a failure). This is not a health-tool
  bug — it is the expected shape of row #4 (R11) still being PARTIAL: `contentEquals` is exactly one of
  the functions row #4 says still needs wiring into a real call site. Corrected in the "Already done"
  table below rather than repeated as fact.

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

Reconciled 2026-08-20. Every row below was checked against current code by opening the file or
running the command it cites. Twelve rows that were tagged **in flight** are gone: their waves
landed and were verified wired, not merely written. Four items were deleted outright. Four new
defects found during the pass are folded into the ranking and carry their evidence below the table.

**Ordering reasoning.** The gate comes first: CI has been dead long enough that a whole test lane
rotted behind it, so #1-#3 restore the ability to notice anything at all. #4-#6 are the evidentiary
floor — R11 is promoted above the rest because C4 and C10 both landed today and both hash raw bytes,
which makes a formatter run indistinguishable from a scope violation. Everything below that is
ranked by how much of the run's honesty depends on it. #23 is last by construction.

`Source` says where the evidence lives: `Q<n>` is this file's own numbering before reconciliation,
`B<n>` is a section in `../orchestration-overhaul/BACKLOG.md`, `new` is this pass.

| #   | Item                                                                                            | Source    | Why it is still here                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **CI runs a path that does not exist** — **DONE 2026-08-21**                                    | new       | Fixed by `db6a07b`. `.github/workflows/ci.yml:37` now runs `bun run test`, which `package.json` maps to `bun test --timeout 30000 --parallel --no-isolate tests/unit` — `tests/unit` holds 475 `*.test.ts` files (confirmed by `find`), so the invocation resolves. `Typecheck` (line 33) runs before it and `Format check` (line 40) after, both unconditional in the same job. Production call site: GitHub Actions on every push/PR to `main`. Verified by reading the workflow file and `package.json` directly, not by re-running the suite (forbidden this pass).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 3   | **CI coverage floor** — unblocked 2026-08-21, still **NOT-STARTED**                             | B9.1      | No longer blocked on #1 (fixed, see row 1) — but the floor itself was never built. `.github/workflows/ci.yml` has exactly three steps — `Typecheck`, `Unit tests` (`bun run test`, no `--coverage`), `Format check` — nothing measures or gates on coverage. `package.json:20` defines `test:coverage` (`bun test ... --coverage tests/unit`) but grepping the whole repo for its invocation (CI, `lefthook.yml`) finds none; `lefthook.yml`'s `pre-push` runs plain `bun run test`. No threshold config exists anywhere — `bunfig.toml` sets only `[test] timeout = 30000`. Still needed: a CI step running `test:coverage` with an enforced minimum.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 4   | **R11 — file equality must be semantic** — **PARTIAL, re-verified 2026-08-21**                  | Q17       | Re-verified independently against current code (not the prior pass's word): the shared normalisation layer at `store/content-normalization/` is real and unchanged in substance — `format.ts`, `json-canonical.ts`, `yaml-canonical.ts`, `ecmascript-whitespace.ts` (renamed from `typescript-whitespace.ts` since the last note; same function, `canonicalizeEcmaScriptWhitespace`), `normalize.ts`, `index.ts`, 83 tests confirmed by direct count in `tests/unit/store/content-normalization/`. One real `store/**` call site is wired: `capsule-index.ts:251` routes through `contentDigest`, confirmed by reading the line directly (`return contentDigest(readFileSync(capturesPath(runRoot)), CAPTURES_FILE).sha256;`). `blobs.ts`/`layout-packets.ts`/`manifest.ts` remain correctly untouched (content lives under gitignored `.capsules/`). Traced all five previously-"unaudited" mechanisms to ground truth this pass — see the refreshed table below the design section: contract digests and C4 confirmed still raw exactly as before; C10 and repository binding/inspection are now fully traced (previously only guessed at) and are also still raw; `gate:prove` was traced fully and turns out **not to be this item's bug at all** — it does not hash-compare, so there is nothing to route through `contentDigest`. Net: 4 real remaining gaps (contract digests, C4, C10, repository content hashing), 1 false lead cleared (`gate:prove`). Whoever owns the 4 remaining files imports `contentDigest`/`contentEquals` from `store/content-normalization/index.ts`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 5   | **R1/R2 — role output contracts, empty-evidence refusal** — **PARTIAL, re-verified 2026-08-21** | Q5        | Re-verified independently against current code, all claims hold unchanged. Classification: `contracts/workflow.ts:58-75`'s `applicableValidatorDomains`/`uiDomainApplies` (confirmed by reading the function bodies directly) take requirement free text alongside write_scope; `textSignalsUiDomain` matches on a `UI_TEXT_MARKERS` regex set (`ui`, `ux`, `screenshots?`, `visual(ly)?`, `dual-channel`, `wcag`, `contrast ratio`, `accessib(le\|ility)`, `dom metrics`, etc.). Test counts confirmed by direct grep: `tests/unit/contracts/workflow.test.ts` (10) + `tests/unit/workflow/review/role-evidence.test.ts` (11) = 21, matching the cited number exactly. The refusal: `workflow/review/role-evidence.ts`'s `assertRoleArtifactPresent` is called unconditionally at `cli/commands/task-review.ts:148`, after (not gated behind) the pass-only dual-channel check at line 140 — confirmed by reading the surrounding code, so it fires for both `--status pass` and `--status fail`. Still open, confirmed unchanged: only `ui-design` has a per-domain artifact rule (`grep -rn "assertRoleArtifactPresent\|RoleArtifactEvidence"` finds exactly the two lines in `role-evidence.ts` plus the one call site — no `product`/`security`/`system-design` analogue anywhere); the deep viewport/contrast audit at line 140 still gates on `dualChannel.isUiTask` alone (the analyzer's own write_scope/taskFiles classifier, from `validation/dual-channel-analyzer.ts` — confirmed imported live at `cli/commands/task-review-support.ts` and `validation/report-adapter.ts`, so it is itself wired, just narrower than the classifier this item widened), not on `classifiesAsUiTask`'s broader text signal.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 6   | **`plan:review` evidentiary floor** — **RESOLVED, re-verified 2026-08-21**                      | Q10       | Re-verified independently against current code. Was: approvable on zero commands and four free-text sentences. Now: `recordPlanReview` (`workflow/plan-review/record-plan-review.ts:147`) calls `assertDependencyEdgeCoverage`/`assertGateCoverage`, which throw `INVALID_STATE` if `--dependency-edges-reviewed`/`--gate-ids-reviewed` omit a real edge/gate the compiled plan declares or name a fabricated one — confirmed by reading both functions directly. Wired to a real, live production path: `plan:review` is registered at `cli/registry/plan.ts:312`, backed by `planReviewCommand` in `plan-validate.ts`, which calls `recordPlanReview` at `plan-validate.ts:158` — this is the only call site in the tree (`grep -rn "recordPlanReview" src --include="*.ts"`, excluding tests). Test counts re-confirmed by direct grep: `tests/unit/workflow/plan-review.test.ts` (22) and `tests/unit/cli/plan-validate.test.ts` (14), matching the cited numbers exactly. **Caveat struck, not just resolved:** the previous caveat named `tests/integration/cli-plan-validate.test.ts` as needing `--gate-ids-reviewed` added. That file no longer exists — `find . -iname "*cli-plan-validate*"` returns nothing, and `tests/integration` was deleted in its entirety by owner decision (`db6a07b`, see "Struck by owner decision" below). There is nothing left for any wave to own here; the caveat is obsolete, not outstanding.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 7   | **Telemetry points at the wrong reporter** — **DONE-AND-WIRED 2026-08-21**                      | B32 + B38 | Both halves of this row's own claim are now false, verified directly rather than inherited. The "neither live capsule has an `agents` key" gap is closed by a real dispatched run left on disk at `.capsules/b32-b20-telemetry-proof-2026-08-21/state.json`: opened it directly with `python3 -m json.tool` — `agents` has 2 entries (`coordinator-1`, and a real sibling implementer `aa49f062714f34399`), the implementer carrying `tokens_in`/`tokens_out`/`token_extras`/`tools_used` all stamped `evidence_class: "harness_observed"`, read straight off that agent's own host transcript. Wiring confirmed at all four boundaries by opening each call site: `probeAgentTelemetry`/`probeAtTaskBoundary` fire from `cli/commands/agent-ops.ts:90` (`agent:register`), `:142` (`agent:release`), `cli/commands/task-claim.ts:173` (`task:claim`) and `:311` (`task:submit`). `agents/worker.yaml`'s "### Telemetry" section (lines 125-134) no longer asks the subagent to conditionally self-report into a void — it now states the harness reads the host transcript automatically and reserves `agent:report` for what that read can't see. B38 (absorbed here) is independently `verified` in `BACKLOG.md` with all four findings closed. What remains is a design question, not missing code: `grep -rn '"host_reported"' scripts/src --include="*.ts"` still shows it only in `contracts/evidence.ts`'s type declaration, never assigned in production — but `BACKLOG.md`'s B32.1 note argues a CLI-relayed dispatch value can never honestly earn `host_reported` (unverified input), so `harness_observed` is the correct reporter, not the wrong one this item's title accused. Whether anything should ever earn `host_reported` is an open owner decision tracked in `BACKLOG.md`, not a gap in this item.                                                                                                                                                                                                                                                                                                                                                                                            |
| 8   | **"Open the artifact, do not reason about it"** — **DONE-AND-WIRED 2026-08-21**                 | B33       | "2 of 15" is stale, from before `bf90e9c`/`bf42a7f` landed. Re-ran the count myself: `grep -lc "B33" roles/*.md agents/*.yaml` now shows all 9 validating-role contracts (`validator.md`, `validator-code-quality.md`, `validator-product.md`, `validator-security.md`, `validator-system-design.md`, `validator-ui-design.md`, `sub-validator.md`, `plan-validator.md`, `completeness-critic.md`) and all 3 matching personas (`validator.yaml`, `plan-validator.yaml`, `critic.yaml`) citing `(B33)`. Verified reachable, not just present on disk: `loadRoleContract` (`packets/role-contract.ts:204`) is called from `packets/role-grant.ts:95` (the `grant.role` fallback path used whenever `--validator-domain` is not set) and from `plan-validator-grant.ts`/`critic-grant.ts`; `role-grant.ts`'s `publishTaskRolePacket`/`publishSubTaskRolePacket` are in turn called from real CLI commands — `cli/commands/task-claim.ts`, `cli/commands/queue.ts`, `cli/commands/branch-ops.ts` — so every dispatched validator packet actually carries the rule. Ran `bun test tests/unit/roles/role-documents.test.ts tests/unit/roles/agent-personas.test.ts` directly: **11 pass, 0 fail.** Landed in `bf42a7f` ("feat: bind the look-at-the-artifact rule to every validating role").                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 9   | **Transition ↔ summary bijection** — **DONE-AND-WIRED 2026-08-21**                              | B21       | Not true any more — the check landed today. `workflow/completion/transition-summary-issues.ts` (opened in full) exports `transitionSummaryIssues(state)`, which checks the bijection both directions (has-transition-without-summary AND has-summary-without-transition) across branches, sub-tasks, agent grants, task submission reports, and repair hand-offs. Wiring confirmed by tracing the real call chain, not assuming it: `readiness-issues.ts:116` calls it inside `completionReadinessIssues`, which `begin-completeness-critic.ts:82` calls inside `beginCompletenessCritic`, which `cli/commands/critic-ops.ts:44`'s `criticStartCommand` calls — and that handler is registered against the real CLI command `critic:start` (`cli/registry/critic.ts:36`). So a broken summary chain now refuses `critic:start` before a critic can even begin, not just at the critic's own review. Ran the tests directly rather than trusting the count: `bun test tests/unit/workflow/completion/` → **117 pass, 0 fail** across 13 files. Three narrower gaps remain, each already tracked elsewhere and outside this row's own claim (per `BACKLOG.md`'s own note): the "terminates" transition has no reachable CLI writer (that's QUEUE item 16, `abandonAttempt`); `agent:release` enforces only a bare `--reason` string, not B21.1's fuller structured-summary contents; and whether these five summary fields actually render into `graph.json`/`summary.md` (B21.3) was not re-checked this pass.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 10  | **Per-validator quality metrics**                                                               | B20.4     | Quality metrics are run-wide only — never per agent, never per validator. Re-confirmed today, unchanged: `grep -rn "validatorQuality\|probe-answer-rate\|withdrawn\|overturn" scripts/src/summary/ scripts/src/workflow/review/` → zero hits. `summary/metrics-collector.ts:168-171` computes exactly three run-wide rollups (`pushbacks_total`, `resolved_findings_total`, `open_findings_total`) and nothing keyed by agent or validator id. `contracts/workflow.ts:121`'s `Finding.status` is still exactly `"open" \| "resolved"` — no `"withdrawn"` state exists for a validator's finding to be evaluated against, so "were its validators any good" (the item's own stated purpose) has no data model to compute from yet. Genuinely NOT-STARTED; the blocker is an unmade owner decision on what recorded signal "withdrawn"/"overturned" should map to (per `BACKLOG.md`'s B20.4 note), not an unwritten function.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 11  | **R4 — the coordinator → validator pushback edge** — **PARTIAL, re-verified 2026-08-21**        | Q6        | Re-verified independently against current code today rather than trusting the prior pass's label; every claim below holds. The edge exists at the workflow layer: opened `workflow/review/coordinator-pushback.ts` in full — `recordCoordinatorPushback` rejects a validator's own recorded pass on a `validated` task, requiring a `cause` of `procedural` (task returns to `validating` only, implementer untouched, lines 103-111) or `substantive` (`repair_round += 1`, `repair_assignee = original_implementer`, escalates once rounds exhaust, lines 114-129). Wired to a real CLI command: `cli/commands/coordinator-pushback.ts` calls `recordCoordinatorPushback`, registered as `coordinator:pushback` in `cli/registry/coordinator.ts:6`, and granted to the role — `grep -n "coordinator:pushback" roles/coordinator.md` confirms it's listed at line 48 under the role's allowed commands. Ran the tests directly: `bun test tests/unit/workflow/review/coordinator-pushback.test.ts tests/unit/cli/coordinator-pushback-command.test.ts` → **14 pass, 0 fail**. Both gaps the prior pass flagged are still open, confirmed by direct grep just now: (1) `grep -rn '"pushback"' summary/graph-edge-types.ts summary/graph-edge-factory.ts` shows a `pushback` `EdgeKind` already exists and is used for validator-reject/plan-validator-reject edges (`graph-edge-factory.ts:207,257`), but `coordinator_pushback` is not a member of that union and `grep -rn "coordinator_pushback" summary/*.ts` returns zero hits — so a coordinator pushback is recorded and readable on `task.coordinator_pushbacks` (`coordinator-pushback.ts:89,100`) but renders nowhere in `graph.json`/`summary.md`. (2) Read `recordCoordinatorPushback` end to end: the `substantive` branch is structurally identical to an ordinary validator reject (same repair-round/reassign/escalate mechanics) — the one capability an ordinary reject genuinely cannot express is the `procedural` path, which targets one specific already-recorded validation rather than the task's current state in general. Status unchanged from the prior pass's own note; this pass adds only independent confirmation, not new evidence. |
| 12  | **Worktree isolation, three gaps** — **PARTIAL 2026-08-21 (re-verified)**                       | B22       | Re-verified fresh, not trusted from the prior note. Wiring is real: `provisionWorktrees` at `cli/commands/plan-compile.ts:132`, `commitSubphase`/`recordWorktreeCommit` at `cli/commands/task-claim.ts:51,61`, `consolidateWorktrees`/`recordConsolidation` at `cli/commands/run-ops.ts:78,84`, `reclaimOrphanedWorktrees`/`recordReclaim` at `cli/commands/worktree-ops.ts:29,37`, `readWorktreeLedger` feeding `run:status` at `cli/commands/run-ops.ts:212`. `bun test tests/unit/workflow/worktree tests/unit/contracts/worktree.test.ts tests/unit/cli/worktree-ops.test.ts` — 87 pass, 0 fail, run just now. Two of the three original gaps are still real, checked directly: (1) `harness-config.ts:59` still reads `worktree_isolation: false`, against this item's explicit "default on." (3) `grep -rn "commit hygiene\|oversized commit\|max_commit_lines" workflow/completion/` is still zero hits — B22.5's critic check has no implementation. **The third original gap is now OBSOLETE, not fixed**: it named two failing `tests/integration/workflow-worktree-*.test.ts` files: both were deleted outright (not converted) by the integration-lane-deletion commit `db6a07b`, along with five sibling worktree integration files — `git show db6a07b --stat \| grep worktree` shows 7 files removed, only `tests/unit/workflow/worktree/fixture.ts` patched (its prompt fixture grown to satisfy the newer requirement-lines binding rule). No unit-level replacement exists for the specific scenario that was failing (`consolidateWorktrees` driven through a full `run:complete`/`sealSingleTaskRun` path hitting the `gate:prove` precondition) — `consolidate.test.ts` exercises `consolidateWorktrees` directly, not that end-to-end path. Kept in queue on gaps #1 and #3 alone.                                                                                                                                                                                                                                                                                                                                                                                                              |
| 13  | **`RunFacts.steps` is produced and read by nothing** — **PARTIAL 2026-08-21 (re-verified)**     | B15       | The premise no longer holds inside this repo: `RunFacts.steps` (`graph-run-facts.ts:274,299`, via `collectActionSteps`) now has a real reader. `markdown-report-context.ts:167` reads `input.graph.run?.steps ?? []`; `markdown-step-provenance.ts`'s `renderActionProvenance` consumes it and is imported/invoked in `markdown-formatter.ts:28,66`, producing summary.md's "19. Action Provenance Trace" section; that formatter is called from `generateSummarySuite` (`generate-summary.ts:9,45`), which is imported and called from the production CLI path `cli/commands/summary-ops.ts:2` (and `run-ops.ts`). That is a genuine producer-to-reader wire, not a dead symbol. What is still true, checked fresh against the actual gvui checkout on this machine (`/Users/onurseckinsenoglu/repos/gvui`, HEAD `fc90912`, today): `grep -rl "StepScrubber\|GraphPlaybackOverlay" src` (excluding each component's own file and tests) returns nothing — both step-scrubbing components remain unimported anywhere in gvui's UI, and `src/testing/currentSkillExport.test.tsx`'s own comment/test ("nothing in gvui's UI reads it either... RunFacts is unconsumed") still passes as of today's gvui HEAD. So B15's gvui-consumption half is still exactly as bad as this item describes. Also confirmed still fully unstarted: B15.3 — grepped `scripts/src/summary` for `toolInvocation`/`ToolInvocationRecord`, zero hits; `classifyActionKind` in `timeline-collector.ts` has no `"tool"` case in its switch. Retitled to reflect the split: the skills-side producer/renderer half is done and wired (markdown), the gvui-side visual consumer half and B15.3 are not. Kept in queue on those two remaining pieces.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 14  | **Asset dimensions and byte size** — **DONE-AND-WIRED 2026-08-21 (re-verified)**                | B3        | Re-ran rather than trusted: `bun test tests/unit/summary/graph-asset-completeness.test.ts` — 6 pass, 0 fail, just now. `MediaAsset.sizeBytes`/`.dimensions` (`graph-types.ts:144-145`) are populated by `measureAssets` (`asset-measure.ts:77`, reads real PNG/GIF/BMP headers plus `lstatSync` byte size), called from `asset-mapper.ts:115,187`, which is called from `graph-task-preparation.ts:88-92` (`mapMediaAssets` building `implementerAssets`/`validatorAssets`) — one of the three call sites the test suite exercises (the other two, `graph-generator-critic-nodes.ts` and `graph-generator-branch-nodes.ts`, thread the same `runRoot`). That path runs inside `generateGraphDataset`, reachable from the real CLI command path (`generate-summary.ts` → `cli/commands/summary-ops.ts:2` → `generateSummarySuite`), not a standalone harness. Test asserts real measured values (1440x900 etc. read from actual `IHDR` chunks and `lstatSync`, never a fixture literal) and includes a reverse-verification in its own history (temporarily breaking `buildImplementerNode` made 2/6 fail as expected). Marking done.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 15  | **Strike two sentences from `SPEC.md`** — **DONE 2026-08-21 (re-verified)**                     | B4        | `grep -n "Existing capsules must keep loading\|tolerant fallback to the legacy" docs/planning/orchestration-overhaul/SPEC.md` returns zero hits, run just now. `SPEC.md:236-238` now reads the owner-decision replacement text under `## 10. Compatibility and verification` ("No backward compatibility (B4, owner decision)..."). Landed in commit `db6a07b` (bundled into the same commit that deleted the integration lane; confirmed via `git show db6a07b -- docs/planning/orchestration-overhaul/SPEC.md`, a clean two-line-removed/three-line-added diff at the right location). Marking done. **Aside, not this item's scope but worth flagging rather than silently trusting:** the same BACKLOG.md entry that reports this item closed also claims the repo-wide dual-read fallback (`state.gates ?? (... ).graph?.gates ?? []`) was deleted from "all 10 sites" — checked directly and it is still present, unchanged, at `workflow/completion/repository-evidence.ts:23`. That is a different claim than this item's own two-sentence SPEC.md ask, which is genuinely done; flagging so it isn't mistaken for closed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 16  | **`abandonAttempt` is unreachable** — **RESOLVED 2026-08-21**                                   | new       | `task:abandon` is a registered CLI command (`registry/task.ts:290-308`) whose handler calls `abandonAttempt` directly (`cli/commands/task-abandon.ts:12`); the error that used to name the bare function now names the real command (`workflow/lease/attempt-state.ts:39`: "...run task:abandon to close it explicitly..."). Verified, not just read: `tests/unit/cli/task-abandon-command.test.ts` drives it through `execute()` against a real on-disk capsule (2 pass), `tests/unit/workflow/gates-completion.test.ts:80` asserts the corrected error text, and a live `bun harness.ts health --all` run today no longer flags `abandon.ts` anywhere in its output.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 17  | **The health tool has a false positive** — **RESOLVED 2026-08-21**                              | new       | Fixed today in `be9b91a`. Root cause: `health/reachability.ts`'s `usageIndex` only recorded a module as "imported" inside the `*`-namespace branch — a named import through a pure re-export barrel (exactly what `store/index.ts` is: 7 lines, all `export { X } from "./Y.ts"`) never marked the barrel itself used, so 46 real production importers still read as zero. Now `usage.importedModules.add(binding.from)` runs unconditionally. Verified live: `bun harness.ts health --all` today reports zero findings for `store/index.ts` (or `abandon.ts`) anywhere in 730 lines of output; `bun test tests/unit/health/reachability.test.ts` → 10 pass, including a new regression test for this exact barrel case. The complaint's other half (`test:unit`/`test:integration` reported as missing `package.json` commands) is moot for a different reason now: those scripts don't exist anywhere any more (`db6a07b`), and nothing in `health/` still references them — the live run instead correctly flags `BACKLOG.md` for still citing those command names, which is real drift, folded into #18.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 18  | **`BACKLOG.md` citation drift**                                                                 | new       | Re-measured 2026-08-21: `bun harness.ts health --consumer /Users/onurseckinsenoglu/repos/gvui --all` reports **53** intent-drift failures against `BACKLOG.md` right now, not 35 — 39 of the 53 cite a `tests/integration/**` path or the bare filename of a test that lived there, and `db6a07b` deleted that whole tree outright since the 35-count was written, so the rot got worse, not better, in the interim. Methodology note: the same check run _without_ `--consumer` reports 131 — inflated, because roughly half of `BACKLOG.md`'s citations name gvui-side files/symbols that genuinely exist in that sibling repo (confirmed directly, see #19) but read as "not present" when gvui isn't in the scanned tree. Future reconciliations should standardize on the `--consumer` form or this number keeps swinging by which invocation someone happened to run. Still real, still unfixed — nobody has touched `BACKLOG.md`'s citations.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 19  | **gvui duplication**                                                                            | B8.3      | Re-verified 2026-08-21 by reading gvui directly (`/Users/onurseckinsenoglu/repos/gvui`, sibling checkout — a separate repo from this one, so not in this repo's own scan): `wasmLayoutAdapter.ts` is still genuinely dead — the real production barrel (`src/engine/layout/index.ts:6`) exports `./customLayoutAdapter`, never `./custom/wasmLayoutAdapter` or its `custom/index.ts` re-export; every consumer of the latter is a test file (four dynamic `import()`s plus two sibling test files), and its own test carries a maintainer's note calling it "v1-era dead code" that "currently fails to load" (a stale import name post-v2-rewrite). `getNodeRepairRounds` is still defined separately at `ComparisonView/diffEngine.ts:211` and `GraphDiff/diffEngine.ts:453`, but a direct diff shows it is no longer _verbatim_ — the two copies have diverged: `ComparisonView`'s keeps a `node.metrics?.retries` fallback branch `GraphDiff`'s dropped, and `GraphDiff`'s added `Number.isFinite` guards `ComparisonView`'s lacks, so the two diff engines can now disagree on the same node's repair-round count. Matches `BACKLOG.md`'s own independent same-day (2026-08-21) B8.3 finding.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 20  | **Sweep the consumer for literal fallbacks** — **NOT-STARTED, re-verified 2026-08-21**          | B37 (13)  | Opened `health/index.ts:154-165`: `checkLiteralFallbacks(production)` runs on the harness's own `production` sources only — `consumer` (populated at line 84-87 whenever `--consumer` is passed) is threaded into `intent-drift` and `vendor-identifiers` but never into this check. Ran the real command, not a cached transcript — `bun scripts/harness.ts health --consumer ../../gvui --all` — and the Literal-fallbacks section's own `Cannot check` list still reads, verbatim, "The consumer repository was not swept for fallbacks; only the harness source was." (the literal string at `health/index.ts:162`). No code anywhere scans gvui for this check. Kept, evidence refreshed against HEAD `154b5cb`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 21  | **The reporting contract has no durable home** — **NOT-STARTED, re-verified 2026-08-21**        | B41 (3)   | `grep -rn "REPORTING CONTRACT" .` across both this repo and `../gvui` returns exactly one hit — `BACKLOG.md`'s own text describing the gap — nowhere else. Also checked the two more specific tokens finding 3 names: `filesChanged`/`files_changed` hits are the pre-existing task-submission field (`implementer.md:59`, `graph-types.ts:200`, `graph-generator-branch-nodes.ts:243`), a different, already-committed mechanism (per-task submission evidence) from the wave-level implementer report finding 3 is about; `deductionsNotObserved` has zero hits anywhere outside BACKLOG.md. Checked all 15 files under `orchestrating-long-tasks/roles/` — none carries this requirement, and no dispatch-prompt template file exists in either repo to carry it. It still lives only in ephemeral wave-dispatch prompt text, outside version control, exactly as finding 3 describes. Kept, evidence refreshed against HEAD `154b5cb`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 22  | **`process-group.ts` grace race** — **NOT-STARTED, re-verified 2026-08-21**                     | B35       | Opened `runner/process-group.ts:79-89` directly: `wait(graceMs)` is still `await Promise.race([exited.catch(() => undefined), wait(graceMs)])` at all three call sites (SIGTERM, SIGKILL, final wait), and the default `wait` (line 54-56) is still a bare `setTimeout`-based race, byte-identical to B35's own citation. `git log --oneline -- .../runner/process-group.ts` shows no commit ever touches this file; the one nearby-sounding commit, `ecb5536` ("perf: back off descendant polling and bound process snapshots"), touched `descendant-tracker.ts`/`descendant-poll-policy.ts` instead — a different mechanism, not this race. None of B35's three owner options (accept-at-load / event-driven descendant reaping / load-aware skip) has been chosen anywhere in today's ~40 commits. Survives on exactly the open owner-decision B35 names — standing rule 5 above ("write a 2-3 option plan and wait for `go`") applies verbatim. Kept, evidence refreshed against HEAD `154b5cb`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 23  | **The final audit gate** — **NOT-STARTED, re-verified 2026-08-21**                              | B17       | Re-checked every precondition fresh in `../gvui` rather than trusting B17's own last note. HEAD advanced again since B17 was last written, to `fc90912` ("docs: defer the relational layout plan for later") — a docs-only commit (`git show fc90912 --stat`: 105 lines, one new file, `docs/planning/relational-layout.md`; nothing else changed), so none of the 8 steps' preconditions moved. `crates/gvui/target/debug/.cargo-lock` is still dated 2026-08-15 18:35; `find crates/gvui/src -name "*.rs" -newer .../.cargo-lock` still returns 3 files — Rust source still postdates the last `cargo test` run, unchanged from the prior note. `reports/visual-report.json`'s last touching commit is still `5e20110` (2026-08-20 22:17:47), nothing since. No `bun run audit`, no `test:visual` run, no cargo test output, and no real end-to-end `/orchestrate`-through-gvui run found dated after `fc90912`. Zero of the 8 steps have executed since the last check. Last by construction, and correctly so. Kept, evidence refreshed against HEAD `154b5cb`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

### The four new items, with their evidence

These have no section anywhere else, so their evidence lives here.

**#1 — CI runs a path that does not exist.** — **DONE 2026-08-21, kept as history below.** At the time
this was written, `.github/workflows/ci.yml:23` was `run: bun test orchestrating-long-tasks/scripts/tests`,
a directory that never existed, and the step failure meant `Typecheck` never ran either.
**Re-verified 2026-08-21 against current `HEAD` (154b5cb):** fixed in `db6a07b`. The workflow now
reads (`.github/workflows/ci.yml:33-40`): `Typecheck` (`bun run typecheck`) → `Unit tests` (`bun run
test`) → `Format check` (`bunx oxfmt --check .`), all unconditional in one job. `package.json` maps
`test` to `bun test --timeout 30000 --parallel --no-isolate tests/unit`, and `tests/unit` holds 475
`*.test.ts` files (`find tests/unit -name "*.test.ts" | wc -l`), so the invocation resolves — no
"filters did not match" failure is possible any more. Production call site: GitHub Actions, triggered
on every push and PR to `main`. This was the single cause behind #2, #3 and #18: three separate kinds
of rot that accumulated behind a gate that was never closed — #2 was resolved separately by deleting
the integration lane outright (see "Struck by owner decision" below); #3 (coverage floor) and #18
(citation drift) are tracked in their own rows and remain open in their own right, unblocked but not
themselves fixed by this.

**#16 — `abandonAttempt` is unreachable.** — **RESOLVED 2026-08-21.** At the time this was written,
`workflow/lease/abandon.ts:6` exported a complete, transactional `abandonAttempt` with exactly two
mentions in the whole tree: its own definition, and `workflow/lease/attempt-state.ts:39`'s
`HarnessError` telling an operator to "…call abandonAttempt to close it explicitly…" with no command
that actually did so. **Re-verified 2026-08-21 against current code:** a `task:abandon` command now
exists end to end — registered at `cli/registry/task.ts:290-308`, backed by `taskAbandonCommand`
(`cli/commands/task-abandon.ts:7-19`), which calls `abandonAttempt` directly at line 12. The error
text was corrected too: `attempt-state.ts:39` now reads "...run task:abandon to close it explicitly
before the task can \<verb\>" — it names the real command, not the bare function. Verified by running
code, not just reading it: `bun test tests/unit/cli/task-abandon-command.test.ts` → 2 pass, driving
the command through the real `execute()` CLI entrypoint against an on-disk capsule (claim → abandon →
reclaim round trip); `tests/unit/workflow/gates-completion.test.ts:80` asserts the corrected error
string; a live `bun harness.ts health --all` run today produces zero mentions of `abandon.ts` anywhere
in 730 lines of output. One nuance worth recording rather than silently fixing: `roles/coordinator.md`'s
`commands:` grant list does not name `task:abandon`, even though the command's own description says it
"exists for a coordinator to unstick a task." This does not block reachability today — every
registry-example invocation of a coordinator command in this codebase (`task:release`, `gate:prove`,
etc.) uses an unregistered literal `--actor coordinator`, and `assertGrantedCommand`
(`packets/command-authority.ts:66-75`) only enforces role grants when the actor string matches a
registered agent-ledger id, which a bare `--actor coordinator` never does — confirmed by reading the
function and by `task-abandon-command.test.ts`'s own passing use of exactly that pattern. So the gap
is a documentation-completeness note for whoever formalizes coordinator self-registration, not an
open reachability defect.

**#17 — the health tool has a false positive.** — **RESOLVED 2026-08-21.** At the time this was
written, `harness.ts health --all` reported `src/store/index.ts` as _"no production module imports
anything from it; only tests do, so the subsystem it implements never runs"_, when `grep -rln
'store/index\.ts"' src/` returns **45** (now 46) production files. **Re-verified 2026-08-21:** fixed
today in commit `be9b91a` ("fix: close reachability false positive on re-export barrels"). Root cause,
confirmed by reading the diff: `health/reachability.ts`'s `usageIndex` called
`usage.importedModules.add(binding.from)` only inside the `binding.imported === "*"` branch — a named
import through a pure re-export barrel (exactly what `store/index.ts` is: 7 lines, all `export { X }
from "./Y.ts"`) never marked the barrel itself as imported, no matter how many production files
imported named symbols through it. The fix moves that line unconditionally above the namespace check.
Verified by running code: `bun test tests/unit/health/reachability.test.ts` → 10 pass, 0 fail,
including a new regression test for exactly this barrel shape; a live `bun harness.ts health --all`
run today has zero output mentioning `store/index.ts` anywhere. The complaint's second half — `harness
health` reporting `test:unit`/`test:integration` as missing `package.json` commands — is moot for a
different reason now: those scripts were deliberately deleted from `package.json` in `db6a07b`, and
`grep -rn "test:unit\|test:integration" scripts/src/health` returns nothing, so there is no longer a
mechanism that could report them as "missing commands" one way or the other. The live run instead
correctly flags `BACKLOG.md` for still citing those two command names as if they existed — that is
real drift, tracked under #18, not a health-tool defect. The other unused-code failure this item's
own text pointed at in the same breath — `workflow/lease/abandon.ts` — was #16 and is resolved above.

**#18 — `BACKLOG.md` citation drift.** — **Still open, evidence refreshed 2026-08-21 (the gap widened,
it did not close).** Originally: commits `a214752` and `5869023` moved roughly two dozen test files
from `tests/unit/**` into flat `tests/integration/*` names without updating the citations that pointed
at them, taking intent drift to 35 failures (up from 26). **Since then**, `db6a07b` deleted
`tests/integration` in its entirety (see "Struck by owner decision" below) — those files were not
renamed again, they stopped existing under any path, so every citation that already drifted to a
`tests/integration/*` name is now doubly wrong. Re-measured today with the correct multi-repo
invocation, since `BACKLOG.md` cites both this repo and gvui: `bun harness.ts health --consumer
/Users/onurseckinsenoglu/repos/gvui --all` reports **53** intent-drift failures against `BACKLOG.md`
right now, not 35. Breakdown of the 53, read line by line: 22 cite a `tests/integration/**` path
directly; 17 more cite the bare filename of a test that lived under that tree before the deletion
(so 39 of 53 — nearly three-quarters — trace to the same one cause, the integration-lane deletion);
the remaining 14 are pre-existing, unrelated drift — missing symbols (`canonicalizeTypeScriptWhitespace`,
`toolInvocation`, `ToolInvocationRecord`, `runAlpha`, `sealSingleTaskRun`, `waitForProcessExit`,
`liveScriptsRoot`, `SHORT_LEASE`), missing commands (`build:wasm`, `test:unit`, `test:integration`),
missing files (`summary/summary.md` ×2). **Methodology caution, worth recording so the number stops
swinging:** the identical check run _without_ `--consumer` reports **131** failures, not 53 — because
roughly half of `BACKLOG.md`'s citations name gvui-side files/symbols/tests that genuinely exist in
that sibling repo (confirmed directly — see #19's evidence for `wasmLayoutAdapter.ts` and
`getNodeRepairRounds`, both real, both present) but read as "not present in the scanned source" when
gvui simply isn't part of the scan. Whoever reconciles this next should always pass `--consumer
../gvui`, or restate which of the two numbers they mean. Affected sections, unchanged from the
original list: B1, B2, B3, B6, B15, B17, B19, B20, B22, B27, B32, B34, B35, B37, B38 — nobody has
edited `BACKLOG.md`'s citations yet, so this remains genuinely unstarted, not merely unresolved.

## Reconciliation protocol

**Before working any queued item, first establish that it is still real.** Open the files it cites,
run the commands it cites, and decide: still real / already fixed / obsolete. Delete the obsolete
ones from this file rather than leaving them tagged.

Run reconciliation as its own pass, after a wave lands and the repo is stable — never interleaved
with implementation, because a tree mid-edit cannot answer "is this still true".

**Verify the wiring, not the existence of code.** Three times in one day an agent reported a fix that
was real code joined to nothing: `gate:prove` was built but never called, the dual-channel analyzer
shipped but was never imported, and five gvui validator roles were unreachable because the producer
emitted a different shape. A symbol that exists is not a symbol that runs.

### The 2026-08-20 pass

24 items were reconciled against current code. 20 survived, 4 were deleted, 4 new defects were found.
Twelve `in flight` rows were verified landed and cleared. Deletions, with cause:

| Item    | Verdict       | Cause                                                                                                                                      |
| ------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **B26** | already fixed | `tests/unit/workflow/validator-independence.test.ts` drives the exact cycle it asked for, asserting by error code. Retagged `verified`.    |
| **B39** | already fixed | `grants.ts` stamps every CLI-supplied field `agent_reported`; conflict surfacing reaches `markdown-formatter.ts` and `graph-generator.ts`. |
| **B18** | obsolete      | Its own text withdrew B18.2 in favour of B22 — and B22's worktree module is now implemented and wired.                                     |
| **B40** | obsolete      | It existed only to audit B39. With B39 fixed, it tracks nothing.                                                                           |

**Owed next:** re-reconcile after #1 and #2 land, because a green CI changes what "verified" means
for every row above.

## Landed in the harness-honesty wave, not previously recorded here

Three defects found by forensics on the `limo` capsule and discussed directly with the owner. They
were implemented before being queued, so they are recorded here for completeness:

| Item                         | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Requirement fold refuses** | A 487-byte single-line prompt naming ~13 concerns produced ONE requirement carrying FOUR acceptance criteria, each "Task gate `<X>` passes with exit code 0". `compiler.ts` folds surplus tasks into the first requirement via `nonBlankLineIndices[taskIdx % length]`. The harness already warned; the warning is now a refusal. Gate-as-acceptance (the silent third fallback) now warns loudly, and becomes conditional on a falsifiability proof once C3b lands. |
| **Projection checkpointing** | `events.jsonl` measured at 4,613,371 bytes over 66 events; the `projection` field is 103.7% of that by JSON size. Real event content totals ~17KB — the signal is 0.4% of the file. Replaced with periodic checkpoints plus replay.                                                                                                                                                                                                                                  |
| **Unclosed attempts**        | Three of four tasks in the `limo` run reached `done` holding an implementation attempt with `started_at` and no `submitted_at`. A terminal transition now refuses while an attempt is open; abandonment is an explicit attributed state.                                                                                                                                                                                                                             |

## R11 — File equality must be semantic, not byte-level (added 2026-08-20)

### The requirement

> "If a formatter runs and a row/column alignment changes, or it gets some additional spacing, that
> should not be registered as a different file. File equality should be handled by the content of the
> code — parsed and trimmed — so that additional spacing or alignment changes are not considered a
> difference."

The skill should not need to intervene in a repository's own formatting setup. It should be
_indifferent_ to formatting instead.

### It has already caused two real failures, both today, both in this repository

**1. Digested checklists.** `bun run format` (bare `oxfmt`, no path restriction) re-indented list
items in `orchestrating-long-tasks/checklists/*.md` — ` -` became `- `, plus blank lines. A
`git diff --word-diff` showed **zero word-level changes**. Five contract-digest tests failed, because
those files' bytes are hashed into validator domain contracts.

**2. The generated CLI manifest.** The same command reformatted
`references/cli-capabilities.md`, producing **484 insertions and 485 deletions** with no semantic
change, and breaking the freshness test that compares the checked-in file against the registry
render. This silently failed three consecutive pushes before the cause was found.

Both were worked around by adding ignore patterns to `.oxfmtrc.json`. That is a patch on one
formatter in one repository — it does not generalise to a consumer repo the skill is dropped into.

### Where byte-equality is currently load-bearing

Every one of these would report a false difference after a formatter run:

| Mechanism                       | What it hashes                                   |
| ------------------------------- | ------------------------------------------------ |
| contract digests                | role and checklist document bytes                |
| `prompt_sha256`                 | the immutable prompt                             |
| C4 write-scope content hash     | the declared scope at claim vs submit            |
| C10 drift detection             | working tree vs the union of declared scopes     |
| repository binding / inspection | `current_repository_inspection_sha256`           |
| `gate:prove`                    | a reverted scratch copy against the working tree |

C4 and C10 are the dangerous pair. A repo-wide format run between claim and submit would read as
"this task wrote the whole repository", and a format run inside a scope would read as work where none
happened.

**Correction, 2026-08-21:** the `gate:prove` row above was wrong. Traced fully this pass
(`graph/gate-proof.ts`'s `proveGateFalsifiable`, see the Status section below) — it never hashes or
byte-compares anything; it reverts the write scope to Git blob content and re-runs the actual gate
command, checking the exit code. It does not belong in this table and carries none of this item's
risk. Left in place above rather than deleted, so the original (mistaken) design note stays legible
as history; treat the Status section below as authoritative.

### Design direction

Introduce one content-normalisation layer that every hash and comparison routes through, with a
canonicaliser per known format and an honest fallback:

- **JSON / JSONL** — parse, canonicalise key order and whitespace, hash the canonical form.
- **YAML** — parse and canonicalise.
- **TS / JS** — normalise whitespace outside string and template literals. Do NOT attempt to run the
  consumer's formatter; that couples the harness to a toolchain it does not own.
- **Everything else** — byte equality, unchanged.

**Record which normalisation was applied.** "Equal under JSON canonicalisation" and "byte-identical"
are different claims and the evidence spine already has the vocabulary to say so. Collapsing them
would be the same dishonesty this project keeps removing.

### The trap to avoid

Normalisation must never hide a real change. Whitespace is semantic in more places than it looks:
Markdown list indentation changes nesting, YAML indentation changes structure, Python indentation
changes control flow, and inside a template literal a space is data. A canonicaliser that trims too
eagerly turns a correctness mechanism into a blind spot — which is worse than the false positives it
set out to fix. Prefer a conservative canonicaliser per format over a general whitespace stripper,
and byte-equality wherever the format is unknown.

### Status (2026-08-21, re-verified same day) — layer built, one consumer wired, four still raw, one false lead cleared

`store/content-normalization/` (`format.ts`, `json-canonical.ts`, `yaml-canonical.ts`,
`ecmascript-whitespace.ts` — renamed from `typescript-whitespace.ts`, same exported
`canonicalizeEcmaScriptWhitespace`, `normalize.ts`, `index.ts`) implements the design above:

- **JSON/JSONL** — parses via the existing `parseJsonBytes`/`canonicalJsonBytes` in `core/json.ts`
  and re-hashes the canonical form; per-line for JSONL, blank lines and a missing trailing newline
  are insignificant.
- **YAML** — a from-scratch, deliberately restricted recursive-descent parser (block and flow
  mappings/sequences, quoted and plain scalars with null/bool/number inference on unquoted scalars
  only). It bails to byte-equality — does not guess — on block scalars (`|`/`>`), anchors, aliases,
  tags, document markers, tab indentation, and multi-line flow collections. Reordered keys, added
  comments, flow-vs-block spelling of the same structure, and quote-style all canonicalise equal;
  a real indentation change that moves a key to a different parent still compares unequal (tested).
- **TS/JS** — a hand-written scanner that treats single/double-quoted strings, template literals
  (including nested `${}` interpolation, scanned recursively so a nested template or object literal
  inside the interpolation doesn't miscount braces), line/block comments, and regex literals
  (division-vs-regex resolved by the preceding significant token, the standard heuristic) as
  protected/verbatim spans, and outside those spans collapses indentation, trailing whitespace, and
  repeated blank lines while **never deleting a newline that sits between two non-blank lines** —
  the one invariant that keeps ASI-sensitive code (`return\nx` vs `return x`) from being conflated.
  Bails to byte-equality on anything it can't confidently scan (unterminated string/template/regex/
  comment) rather than risk a wrong answer.
- Every path records which of `json-canonical` / `jsonl-canonical` / `yaml-canonical` /
  `typescript-whitespace` / `byte-identical` actually applied — `contentDigest`/`contentEquals` return
  it, not just the hash.

83 tests in `tests/unit/store/content-normalization/`; `bun run typecheck` clean.

**Wired:** `store/capsule-index.ts:251` — the capture-ledger freshness digest (`captureLedgerDigest`,
feeding `indexFreshness`) now calls `contentDigest(bytes, CAPTURES_FILE)` instead of raw
`createHash("sha256")`. Regression test:
`tests/unit/store/capsule-index.test.ts` → `indexFreshness` → "stays current when captures.json is
rewritten with different key order and spacing but the same content" — verified failing (reports
`"stale"`) against the pre-change code and passing after.

**Deliberately not touched:** `blobs.ts` (`copyAndHash`/`blobContentDigest`), `layout-packets.ts`
(packet markdown digest), `manifest.ts` (prompt digest). All three hash content that lives under
`.capsules/`, which `/.gitignore` excludes from the repository entirely — no formatter ever reaches
it — and two of them hash markdown, which this design correctly refuses to canonicalise anyway.
Routing them through the module would have been wiring for its own sake with no behavioural
difference and no test able to prove it, so they were left alone rather than padded for appearance.

**Still raw-byte, still outside `store/**` and this item's ownership for this wave — fully re-traced
2026-08-21, replacing the guesses in the previous pass's table:**

| Mechanism                  | File                                                                                                      | Verified still raw?                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contract digests           | `packets/role-contract.ts:196,306,375`                                                                    | Yes, unchanged — `createHash("sha256")` over role/checklist `.md` bytes, confirmed by re-reading all three lines this pass.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| C4 write-scope hash        | `workflow/lease/write-scope-hash.ts:26` (`digestFile`), `:76` (`hashWriteScope`)                          | Yes, unchanged — raw `createHash("sha256")` per file and over the sorted manifest string. Confirmed live and load-bearing today, not theoretical: `hashWriteScope` is called at both `cli/commands/task-claim.ts:135` (claim time) and `:268` (submit time) — a repo-wide formatter run between those two calls would read as an out-of-scope write.                                                                                                                                                                                                                                                                                                                                                             |
| C10 drift                  | `workflow/submission/out-of-band-drift.ts` → `packets/round-repository-delta.ts`'s `anchoredChangedPaths` | Now fully traced (previously "not re-audited"). It isn't a hash at all — it's `git diff --no-ext-diff --no-textconv --name-only <head_commit> -- . :(exclude).capsules` (`round-repository-delta.ts:52-59`). `contentDigest`/`contentEquals` are never called on either side; any byte-different file, reformatted or not, is reported as an out-of-band path. Confirmed wired at `workflow/submission/submit.ts:113` (per the "In flight" table above), so this is live today.                                                                                                                                                                                                                                  |
| Repository content hashing | `packets/repository-content-node.ts:75,96,116`, `packets/repository-snapshot.ts:52` (`pathRecord`)        | Now fully traced (previously "needs its own look"). `repository-identity.ts`/`repository-inspection.ts` only hash `canonicalJsonBytes` of an _already-computed_ binding object, so they were a red herring — the actual raw-byte hashing happens one layer down, per scanned file, via `sha256Bytes(bytes)`/`createHash("sha256")` in these two files. `repository-snapshot.ts:52` in particular hashes named "instruction"/"convention" files raw — `package.json`, `tsconfig.json`, `AGENTS.md` — so a formatter touching any of those changes `repository_content_sha256`. Confirmed wired: `inspectRepositoryBinding`/inspection are called from `cli/commands/critic-ops.ts` and `cli/commands/run-ops.ts`. |
| `gate:prove`               | `graph/gate-proof.ts`'s `proveGateFalsifiable`                                                            | **Cleared — not this item's bug.** Fully traced this pass: `grep -n "createHash\|contentDigest\|contentEquals\|sha256\|hash" graph/gate-proof.ts cli/commands/gate-prove.ts` returns nothing. The mechanism reverts the write-scope files to their base-ref Git blob bytes in a scratch copy and _re-executes the real gate command_, checking its exit code — there is no digest comparison anywhere to normalise. The previous pass's guess ("likely `hashWriteScope`, shared with C4") was wrong; `gate:prove` shares no code with C4's `write-scope-hash.ts`. This row should not have been in the "byte-equality load-bearing" table at all; struck from the outstanding list.                              |

Whoever owns the 4 remaining files adopts `contentDigest`/`contentEquals` from
`store/content-normalization/index.ts` directly — no further design work should be needed, the
canonicalisers already handle `.md`/unknown formats safely by falling back to byte equality on their
own.

## In flight

Nothing. The `test-lane` and `hygiene-and-docs` waves landed, along with C3b, C10, C11, the
heartbeat, `plan:apply` reachability, A2, A3, the data-model unification and R7-R10. Each was
verified wired, not merely present:

| Landed                 | Verified by                                                                                                                                                                            |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C11 installed-runtime  | `assertInstalledRuntimeFresh` imported and called in `cli/commands/plan.ts:12`; all three roots enumerated in `installer/runtime-freshness.ts` (covers R10).                           |
| C3b `gate:prove`       | `assertGateProofFalsifiable` called at `workflow/review/record-review.ts:98`.                                                                                                          |
| C10 out-of-band drift  | `outOfBandPaths` called at `workflow/submission/submit.ts:113`.                                                                                                                        |
| The heartbeat          | `orchestrator:supervise` registered and granted in `roles/coordinator.md:46`; `orchestrator-ops.ts` → `supervision-watch` → `supervision-tick` → `reclaimDeadAgents` → `recoverStale`. |
| `plan:apply` reachable | Granted at `roles/coordinator.md:30`; `packets/planner-packet.ts:25` reads the live revision instead of hardcoding 0.                                                                  |
| A2 parallelism         | Grounded on `A2_PROMPT_LINE_THRESHOLD` and independent-root count; `not_evaluated` is now the ambiguous case, not the only case.                                                       |
| A3 gate structure      | `sameGateSignature` compares `(executable, subcommand, targets)`; the string equality is gone.                                                                                         |
| Data-model unification | The `screenshots` alias is gone from `reporting/command-evidence.ts`; `inspection-formatter.ts` no longer exists.                                                                      |
| R7 / R8 / R9           | `HarnessError.fix` at `errors/harness-error.ts:10`; the never-read-source footer at `errors/normalize-error.ts:12`; `explain` registered at `cli/registry/explain.ts:6`.               |

Unit lane at the time of writing: `bun run test:unit` → **3905 pass, 0 fail** across 464 files.
The integration lane is a different story — see #2.

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

---

## R7–R10: the context-burn defect (added 2026-08-20) — **landed 2026-08-20**

> Kept as the design record for work that has shipped. R7's `fix` field, R8's footer, R9's
> `explain` command and R10's three-root freshness are all wired; see the In flight table above
> for the call sites. Nothing below is outstanding.

### The observation

A live trace of a small model starting a run on another repository:

```
harness.ts --help                          ← correct
harness.ts help                            ← correct
Read harness.ts                            ← defect
Read src/cli/execute.ts                    ← defect
Read SKILL.md  (from ~/.gemini/...)
Read agents/coordinator.yaml
harness.ts plan:init --run capture-nextgen-expansion
Read src/cli/commands/plan.ts              ← defect (after plan:add failed)
harness.ts plan:add ...                    ← failed
Read src/cli/commands/plan.ts              ← defect (again)
harness.ts plan:add --run .capsules/...    ← succeeded, having learned the form from source
harness.ts plan:compile                    ← failed
Read graph/compiler.ts                     ← defect
Read graph/validate-graph.ts               ← defect
Read graph/validate-gates.ts               ← defect
Read graph/gate-command-policy.ts   (×2)   ← defect
Read graph/gate-runtime-grammar.ts  (×2)   ← defect
```

Roughly 100k tokens of harness source consumed before any task work began, and the cost scales with
the size of the skill rather than the size of the user's job.

### The mechanism, and why the model is not at fault

The pattern is exact: **the model reads source only after a command fails.** It runs the command, gets
an error, cannot act on the error, and goes to the source to derive what the harness wanted. Reading
`plan.ts` is how it discovered that `--run` takes the `.capsules/<id>` form; reading the four gate
files is how it tried to discover what gate command would be accepted.

This is the same root cause `RAILS.md` already identified for a different symptom:

> A refusal without a prescribed repair is a defect. A weak model refused with no path forward does
> not re-plan.

There it went _around_ the harness by editing files directly. Here it goes _into_ the harness by
reading its source. One cause, two symptoms.

Note what is NOT the problem: `harness.ts help plan:add` already emits a complete, excellent contract —
every flag, type, requirement, default, mutual exclusion, and worked examples. Better help would not
have prevented this, because the model already ran `help` twice at the start. The gap is entirely in
what happens when a command is _refused_.

Verified: grepping the source for any error carrying a suggested next command returns essentially
nothing. Errors state what was rejected; none state what to run instead.

### R7 — Errors prescribe, they never merely diagnose

Every refusal carries three parts, and the third is currently missing everywhere:

| part                                                                  | today  | required |
| --------------------------------------------------------------------- | ------ | -------- |
| **what** was rejected                                                 | yes    | yes      |
| **why** — the rule violated                                           | partly | yes      |
| **fix** — the literal argv to run instead, fully formed with real ids | **no** | **yes**  |

Where the harness can compute the fix it must. A gate rejection is the clearest case: `discoverGatePaths`
(`graph/gate-breadth.ts`) already enumerates real on-disk paths for a write scope and is already used
to suggest them elsewhere. A scope-gate refusal should end with the exact `plan:add` line that would
be accepted, not a description of the rule it broke.

### R8 — State the prohibition where it is read, and give the alternative

`SKILL.md` already carries a "Never read" column, but the running agent loaded a 395-line SKILL.md from
a stale install that predates it. So the prohibition must also live where a failing agent is
guaranteed to look: **in the error itself**. Every error footer carries one line — never read the
harness source; run `harness.ts help <command>` or `harness.ts explain <code>`.

### R9 — `harness.ts explain <error-code>`

A command that expands any error code into its full rule, its rationale, and its remedy. This gives a
refused model a _command to run_ in place of a _file to read_, which is the substitution the whole
item exists to make.

### R10 — Runtime freshness must cover every install root

Three install roots exist on this machine, all dated 2026-08-19, all carrying the superseded 395-line
SKILL.md:

```
~/.agents/skills/orchestrating-long-tasks          395L SKILL.md, 327 .ts
~/.gemini/config/skills/orchestrating-long-tasks   395L SKILL.md,   0 .ts
~/.claude/skills/orchestrating-long-tasks          395L SKILL.md,   0 .ts
repo                                               148L SKILL.md, 510 .ts
```

Two of them ship documentation with no scripts, which is how the trace ended up reading `SKILL.md`
from `.gemini` while executing `harness.ts` from `.agents` — **two different roots, independently
stale, with nothing able to notice.** C11 must digest and report every root it can find, not one.

## Struck by owner decision, 2026-08-21

**"Repair the integration lane" (was ranked #2, Q12) — DELETED, not deferred.**

It described 45 of 815 integration tests failing, all from two correct mechanisms that landed the same
day (`assertGateProofFalsifiable` and the requirements fold-refusal) meeting fixtures written before
them. There is nothing left to repair: the owner deleted `tests/integration` in its entirety
(commit `db6a07b`, 149 files) and collapsed the project to a single lane.

His reasoning, in his words:

> "Unit tests shouldn't do the job of the actual code directly itself. It should just test its
> behaviour — the actual code already runs, we don't need to reinvent the wheel. Integration tests
> here are not important. If all of them are converted as unit tests, or if they already have unit
> test alternatives, that should be enough. The regular one-run test should directly run the unit
> test, so we no longer need the unit/integration separation."

Consequences recorded so the trade is visible rather than forgotten:

- `package.json` now exposes one script — `test` -> `bun test --parallel --no-isolate tests/unit`.
  `test:unit`, `test:integration`, `test:integrations` and `test:all` are gone.
- CI and the lefthook pre-push hook both run that single lane.
- The lane is being converted so unit tests mock their dependencies instead of driving the real CLI,
  spawning subprocesses, shelling to git, or building capsules on disk. Target: near-100% coverage,
  whole lane under 60 seconds.
- **What is lost:** the only place the harness was exercised against a real filesystem, real git and
  real subprocesses. The `health` check and real capsule runs cover part of that surface; nothing
  covers the rest. Stated once, accepted by the owner, recorded here so it is a known trade rather
  than a later surprise.

## D1–D5: the delegation defect (audited 2026-08-21)

Full evidence, with every command's real output, in [`DELEGATION-AUDIT.md`](DELEGATION-AUDIT.md).
Opened on the owner's report that the final verification phase submits its report **to the main
thread**, which then implements the findings itself. The report is accurate. Six of seven guarantees
audited are absent or documented-only; only "completion cannot happen with open findings" is
genuinely enforced.

| Guarantee                                         | Verdict                           | Settled by                                                                                                                                   |
| :------------------------------------------------ | :-------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------- |
| Main thread deploys an orchestrator, does no work | absent                            | No `orchestrator` in `contracts/packets.ts:15-26`; `orchestrate-formatter.ts:22-30` tells the caller to plan it themselves                   |
| Validator/critic may not implement                | enforced (registered agents only) | `packets/command-authority.ts:55-63` via `cli/execute.ts:29`; `must_not` is prose per `health/unenforced.ts:185`                             |
| Findings become new work through `plan:replan`    | absent on the real path           | `plan-replan-findings.ts:60` reads `revalidation_gate`, `review-input.ts:54` writes `revalidation`; then `revision-guard.ts:134-138` refuses |
| A silent termination is detected                  | absent                            | `dead-agent-detector.ts:13` — the only reason code is `expired_lease_no_submission`                                                          |
| A dead agent is re-woken with a corrective        | absent                            | `watchdog.ts:180-235` emits an event and returns; no dispatch, no injection                                                                  |
| Completion blocked by open findings               | **enforced**                      | `review-issues.ts:97-99`, `completion-state.ts:154-155`; refusal reproduced live                                                             |
| Every role reports through the CLI                | absent                            | An unregistered agent leased a task against an empty ledger                                                                                  |

Ranked by how badly the absence hurts:

- **D1 — a clean termination is undetectable.** Every detection path in the tree keys off a lapsed
  deadline (`recover-stale.ts:29,52,69`). An agent that finishes its turn without calling the CLI is
  indistinguishable from one still working until its lease expires. Worse, `reclaimDeadAgents`
  (`dead-agent-detector.ts:55-74`) builds its event list only from task leases and branch sub-leases:
  a validator that started validation and never returned a verdict is reset to `submitted` **silently**
  — reproduced live, `events: []`, `escalatedNow: []`, `changesRequested: []`. This is the owner's
  actual failure and nothing else on this list matters if it stays absent.
- **D2 — registration is optional, so every role rail is opt-out.** `command-authority.ts:72-73`
  returns without checking when the acting agent is not in the ledger. Reproduced: an unregistered
  agent claimed a task and the ledger stayed `[]`. `CHANNEL.md` calls registration non-negotiable; no
  code agrees. Also: `contracts/agents.ts:19` gives grants only `active | released`, so there is no
  state meaning "died", and an `active` grant blocks nothing at completion.
- **D3 — a completeness critic's findings cannot become tasks.** Two independent refusals on the real
  `critic:reject` → `plan:replan` path, both reproduced. The second is asserted as intended behaviour
  by `tests/unit/cli/critic-start-review.test.ts:245-247`. Meanwhile the critic itself is denied
  `plan:replan` by its own contract, so its only outlet is the markdown at
  `run-formatter.ts:73-74` — "Yielding to Coordinator… Coordinator runs `plan:replan`" — prose in a
  return value that lands in whoever spawned it.
- **D4 — the main thread has nothing to hand off to.** There is no orchestrator role, no
  `roles/orchestrator.md`, and the tier ladder documents a coordinator as tier 1's single child while
  `agents/orchestrator.yaml:6-7` puts the meta-orchestrator _at_ tier 1 as a coordinator persona.
  The entry point instructs the main thread to do the work, so it does.
- **D5 — `triggerAutoWake` reports success for an action it never took.** It emits an event and
  returns `succeeded: true`; its only production caller is its own interval inside `loop-runner`,
  behind `orchestrator:run`, which refuses without a host-injected executor.
  `host-adapters.md:164`'s claim that the runtime "re-dispatches it without human intervention" is
  false by construction — the harness never dispatches.

**No harness-side channel exists to wake anybody.** A whole-tree grep for
`inbox|mailbox|notify|notification|SendMessage|milestone` across `scripts/src/` returns one hit, a
vendor-name exclusion list. Every handoff is pull-based. Any fix for D1/D3 has to be a durable
obligation a coordinator discovers by polling, not a message the harness sends.

**Already done, confirmed during this audit** (three ranked rows above are stale):

| Row     | Now                                                                                                                                                                  |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **#1**  | Fixed. `.github/workflows/ci.yml:32-36` runs `bun run typecheck` then `bun run test`, and `package.json:19` is `bun test … tests/unit`. The dead path is gone.       |
| **#16** | Fixed. `cli/commands/task-abandon.ts:2,12` imports and calls `abandonAttempt`; `task:abandon` is registered at `cli/registry/task.ts:290`.                           |
| **#17** | Fixed. `harness health --all` now reports **1** unused-code failure, and it is `harness.ts:27`, the allowed process entry point. `store/index.ts` no longer appears. |

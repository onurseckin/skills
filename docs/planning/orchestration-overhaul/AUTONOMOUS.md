# Autonomous operating procedure

The owner is away. This file is the contract for continuing without them, and it is written to survive
context loss: a fresh session should be able to read only this file plus `BACKLOG.md` and carry on.

## Model and effort policy (owner decision, 2026-08-20)

| Role | Model | Effort |
|:--|:--|:--|
| Planning, architecture, large orchestration, plan writing | **opus** | **xhigh** |
| Implementers | **sonnet** | **xhigh** |
| Verifiers / validators | **sonnet** | **xhigh** |
| Final synthesis and adversarial design review | **opus** | **xhigh** |

Rationale from the owner: running everything on Opus at high effort makes waves take hours the work does
not need, and slow feedback lets wrong conclusions sit unchallenged. Speed is a correctness property here,
not only a cost one.

Pass these explicitly on every `agent()` call — `model` and `effort`. Omitting them inherits the session
model, which is Opus, which is the thing being corrected.

## The loop

1. **Observe.** Wait for running workflows to complete. Never launch work that collides with in-flight
   file ownership; check what a running wave owns before assigning paths.
2. **Assess.** When a wave lands, run the health check and read it in full:
   `bun orchestrating-long-tasks/scripts/harness.ts health --consumer ../gvui --all`
   Then run the gates: `bun run typecheck` and the unit suite.
3. **Self-evaluate.** Ask what is actually missing, not what is nominally done. Check `BACKLOG.md` for
   `queued` items. Check that anything marked done is REACHABLE — B33's rule: open the artifact, do not
   reason about it.
4. **Plan.** Write the next wave from the health output and the backlog, opus/xhigh.
5. **Implement.** Pipeline the work — never a barrier between build and verify (B24/B25). Partition by
   file ownership so agents cannot collide. Sonnet/xhigh for both sides.
6. **Verify.** Every verifier re-runs the health check and pastes before/after counts. A claimed fix that
   does not move the number is not a fix.
7. **Commit and push.** Gates green -> commit (Conventional Commits, no AI attribution) -> push. The
   post-push hook runs `skill:update`, which refreshes the global skill from GitHub.
8. **Repeat** from step 1 until the backlog is drained and the health check is HEALTHY.

## Recovery

- A workflow that dies mid-flight leaves its transcripts under
  `~/.claude/projects/<project>/<session>/subagents/workflows/<runId>/`. Read `journal.jsonl` there to see
  which agents completed and what they returned before deciding anything.
- Re-run a dead workflow with `Workflow({scriptPath, resumeFromRunId})` — completed agents replay from
  cache, only the failed and subsequent calls re-run.
- If the working tree is mid-write and gates fail, do NOT commit and do NOT `--no-verify`. Identify which
  agent was writing, let it finish or re-run it, then gate again.
- Commits are cheap now (typecheck only, ~4s). Push carries the full suite. Commit often; push when green.

## Standing constraints

- Never `--no-verify`. Never `any`. Never a suppression comment. Never a fabricated value.
- Never delete something the skill documents — wire it instead (B33).
- Scope test runs to the files touched; the full suite runs at the wave barrier only (B29).
- Branch is `orchestration-overhaul` in both repos. Do not merge to main; the owner decides that.
- The global skill updates from GitHub's default branch, so work on this branch will not reach
  `~/.agents/skills/` until the owner merges. Say so rather than implying the global skill is current.

## Where the state lives

- `BACKLOG.md` — every owner decision, B1-B33, with reasoning. The authority for what to build.
- `SPEC.md` — the original architecture spec. Superseded by the backlog where they conflict.
- `model-effort-policy.md` — deferred tier research, for when the owner returns to it.
- This file — how to keep going.

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

## The rule that keeps this running

**NEVER end a turn with nothing in flight.** Launch the next wave FIRST, then schedule the wakeup as a
silent-death fallback — never the other way round, and never "the next iteration will launch it".

Work in flight generates completion notifications, and those are the real wake signal. A scheduled wakeup
with no work running is a single point of failure: if it does not fire, everything stops and nothing
notices. This happened once — a turn ended after a commit with the next wave deferred to the wakeup, and
the run sat idle until the owner came back and found it stopped.

Order, every turn, without exception:
1. Launch or confirm work is running.
2. Do bookkeeping — commit, record findings, update the backlog.
3. Schedule the wakeup last, as the fallback.

If a wave lands and the backlog still holds `queued` items or health is UNHEALTHY, the next wave launches
in the SAME turn. Assessment and planning are not a turn of their own.

## The loop

1. **Observe.** Wait for running workflows to complete. Never launch work that collides with in-flight
   file ownership; check what a running wave owns before assigning paths.
2. **Assess.** When a wave lands, run the health check and read it in full:
   `bun orchestrating-long-tasks/scripts/harness.ts health --consumer ../gvui --all`
   Then run the gates: `bun run typecheck` and the unit suite.
3. **Self-evaluate.** Ask what is actually missing, not what is nominally done. Check `BACKLOG.md` for
   `queued` items — its per-item status note says exactly what's still open, so read that before
   re-deriving it. An item already tagged `verified` was independently confirmed by a SEPARATE later
   pass against B33's three bars (reachable, does what was asked, guard holds) and does not need
   re-checking absent a new finding; an item tagged only `done (<sha>)` still needs that check — B33's
   rule: open the artifact, do not reason about it.
4. **Plan.** Write the next wave from the health output and the backlog, opus/xhigh.
5. **Implement.** Pipeline the work — never a barrier between build and verify (B24/B25). Partition by
   file ownership so agents cannot collide. Sonnet/xhigh for both sides.
6. **Verify.** Every verifier re-runs the health check and pastes before/after counts. A claimed fix that
   does not move the number is not a fix.
7. **Commit and push.** Gates green -> commit (Conventional Commits, no AI attribution) -> push. The
   post-push hook runs `skill:update`, which refreshes the global skill from GitHub.
8. **Repeat** from step 1 until the backlog is drained and the health check is HEALTHY.

## "Drained" is a claim, not a state

An empty backlog never ends the loop on its own. Before stopping, run a POST-IMPLEMENTATION VERIFICATION
pass over everything marked done, and put back whatever does not survive it.

The evidence is overwhelming and all from this overhaul: the role-packet subsystem, the Dual-Channel
Validator, the conflict-aware scheduler, the config loader, lease recovery, `handoff.md` and the host
telemetry probe were each fully implemented, typechecked, tested — and called by nothing. Every one was
reported done. A list that says "done" is the least reliable artifact in the repository.

For each completed item prove three things, and treat any failure as a NEW backlog entry:

1. **It is reachable.** A producer writes it, a reader consumes it, and a test exercises the path.
   `harness.ts health` answers most of this mechanically — use it rather than reading code and believing.
2. **It does what the item asked**, not what was convenient to build. Re-read the item's own words and
   check the behaviour against them. A partial fix reported as complete is the commonest failure here.
3. **Its guard holds.** Delete the guard in a scratch copy and confirm a test fails. A test that passes
   with the code removed is not defending anything.

Write a NEW item rather than reopening the old one — a reopened item loses the record of what was already
checked, and the next pass repeats the work.

**Termination requires all three: the backlog holds no `queued` item, `health` reports HEALTHY, and a
verification pass has just run and re-added nothing.** Two out of three keeps the loop going.

## Stray cleanup, every cycle — with a hard protected list

Long autonomous runs leak background processes. The audio-notification hooks were the worst case: one
`afplay` per agent turn stop, hundreds accumulated over fourteen hours, each holding a `coreaudiod`
connection until that daemon sat at 105% CPU for seven days. Killing the strays dropped it to 35%
immediately. Check for this class every cycle, before deciding wave width.

### NEVER kill these. They are the working environment.

    agy            Antigravity CLI — the owner's coding agent
    claude         Claude Code — this session and its subagents
    wezterm-gui    the terminal
    tmux           the multiplexer inside it
    zsh / bash / login / sh    shells, including every subprocess of the above

If a candidate's ancestry reaches any of those, leave it. When unsure, leave it and report instead —
killing the owner's editor or terminal costs far more than a slow machine.

### Safe to terminate when they pile up or stick

- `afplay` strays beyond a couple: a notification-hook leak, never real work.
- Orphaned `bun`/`node` whose parent is 1 AND whose workflow has completed: leftovers from a finished
  wave. Check the workflow is actually done first — a live agent's parent may briefly reparent.
- A system daemon genuinely pegged for hours where a restart is the standard remedy — `coreaudiod` is the
  known case. It needs `sudo`, so report it rather than failing silently:
  `sudo killall coreaudiod` (launchd respawns it instantly; audio reconnects).

### The check

    load=$(uptime | sed 's/.*averages*: *//' | awk '{print int($1)}')
    strays=$(pgrep -x afplay | wc -l)
    ps -axo pid=,pcpu=,etime=,comm= | sort -k2 -rn | head -5

Read the top five before killing anything. Twice in this run the biggest consumer was NOT this project —
once a third repo's `tsc`, once the audio daemon — and killing agents would have fixed neither. The
armed watchdog reports IDLE, OVERLOAD (load > 150 or free memory < 400 MB, naming the top three) and
AUDIO STRAYS, so the signal usually arrives before the next cycle does.

### Wave width — do not self-restrict

**Agent count was never the problem.** Diagnosed twice in this run: the machine's biggest consumers were a
third repository's `tsc` at 174%, and `coreaudiod` pegged at 105% by leaked `afplay` processes. Neither was
caused by agents, and cutting wave width would have fixed neither.

Run at the maximum the host allows — up to 20 concurrent subagents in Claude Code. The workflow runtime
caps each RUN at `min(16, cores - 2)`, so reaching that ceiling means launching SEVERAL workflows
concurrently on disjoint file ownership rather than one narrow one. Do that.

Narrow only on evidence that agents themselves are the constraint — free memory genuinely exhausted, or
the top CPU consumers actually being this project's processes. Read the top five first (see above);
twice now the honest answer was "not us".

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

- `BACKLOG.md` — every owner decision, numbered B1 and up, with reasoning. The authority for what to
  build. Read its status index first: `done`/`verified`/`queued`/`deferred by owner`, with counts, so
  a fresh session gets progress at a glance instead of re-deriving it from 38+ headings.
- `SPEC.md` — the original architecture spec. Superseded by the backlog where they conflict.
- `model-effort-policy.md` — deferred tier research, for when the owner returns to it.
- This file — how to keep going.

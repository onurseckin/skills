# Telling Failure Modes Apart

This skill covers four ways a worker session stops making progress. The identify/
terminate/relaunch/resume shape applies to all four; only the account-switch step is
specific to the first one. Get the diagnosis right before acting — switching accounts
on a hung-but-not-exhausted worker wastes a cycle, and killing a process that will
recover on its own destroys state for nothing.

## Check This First, Regardless Of Cause

Before diagnosing _why_ the worker stopped making progress, check _whether anything
is even running in the target pane at all_ — via the pid-to-pane recipe in
`references/tmux-targeting.md`, not by assuming from the window name or from a
machine-wide `pgrep`. If nothing is running there, there is nothing to terminate:
skip the kill step entirely and go straight to relaunching. Do not go looking
elsewhere on the machine for an `agy` process to act on just because the target
window doesn't have one — that search is exactly how an unrelated window's session
gets killed by mistake (see "The One Way To Cause Real Damage" in `SKILL.md`). This
check costs one `pgrep -P <pane_pid>` and comes before every branch below.

## Quota Exhaustion

**Signature:** the process is often still alive (or exits with a quota-related
error), and `agyp quota --json`/`agyp list --json` for its bound account shows
`remainingPercentage` near zero. A live pane's TUI status bar can show this directly
— verified real example from this machine: `AI: Out of credits` in the bottom status
line — but treat that string as a corroborating hint, not the check itself; wording
can change across agy versions. `agyp quota --json` is authoritative.

**Recovery:** the full sequence in `SKILL.md`, including the account switch.

## Process Crash

**Signature:** `pane_current_command` for the pane has reverted from `agy` to `zsh`
(or whatever the pane's underlying shell is) without anyone terminating it on
purpose. `capture-pane` shows a shell prompt, a stack trace, or an error message
where the TUI used to be, instead of the interactive interface.

**Recovery:** there is no live process to identify or terminate — this is the
"nothing running" branch above, confirmed rather than assumed via the pid-to-pane
check. The account is very likely not the problem — skip the account-switch step. Go
straight to relaunching and resuming (`references/session-restart.md`), then
re-establish coordination.

## Hung Session

**Signature — the distinguishing test requested for this skill:** the process is
still alive (pid confirmed via the pid-to-pane recipe, `pane_current_command` still
shows the worker binary), **and** its account's quota is fine per `agyp quota
--json`. What's missing is progress: repeated `tmux capture-pane` reads a few
seconds apart show no change in the pane's content. A quota-dead session, by
contrast, has the same "pid alive" signature but quota near zero — check quota before
concluding "hung" so you don't kill a session that would have recovered on its own
once it noticed its own account had quota again (some tools retry automatically).

**Recovery:** if quota is genuinely fine and content is genuinely static across
multiple checks spaced a reasonable interval apart (don't conclude "hung" from a
single snapshot — the worker may just be mid-thought on a slow step), terminate and
relaunch as normal, skipping the account-switch step.

## Terminal/Machine Restart

**Signature:** `tmux list-sessions` itself errors (no server running at all), or it
succeeds but the expected window/pane doesn't exist, or it exists with a fresh
`zsh` and no memory of anything that was running before.

**Recovery:** there's nothing to identify or kill — the whole process tree is
already gone (another instance of the "nothing running" branch above). What survives
is disk state: the conversation database (`references/session-restart.md`'s index
lookup still works, since it reads from `~/.gemini`/`$AGYP_HOME`, not from the dead
process) and any coordination binding file
(`references/handoff-protocol.md`'s `.chatroom/binding.json`). If the pane/window
itself doesn't exist, create it first (`tmux new-window` or equivalent) before
relaunching into it — at that point you're back on the normal relaunch-and-resume
path, just without a kill step.

## Common Mistakes

| Mistake                                                                                               | Why it's wrong                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Killing by process name (`pkill agy`, `killall agy`, `kill $(pgrep agy)`) instead of a confirmed pid  | Hits every window running the same binary, including ones you were never asked to touch — see "The One Way To Cause Real Damage" in `SKILL.md`.                                                 |
| Hunting the machine for _an_ agy process when the target pane has none running                        | The target having nothing running is a valid, common outcome (crash, restart) — not a cue to go find a different window's process to act on instead.                                            |
| Running `agyp use` from the supervisor's own shell and expecting the worker's pane to pick it up      | Environment variables never travel sideways between unrelated shells — see `references/account-management.md`.                                                                                  |
| Reaching for `agyp global` to fix one pane                                                            | Rewrites the machine-wide login keychain default; moves every other unbound shell and the IDE, not just the one pane you meant to fix.                                                          |
| Treating `agy -c`/`--continue` as precise                                                             | It resumes whatever conversation is _most recent for that shell's account_, which is not necessarily the one this window was running if the window has run several. Use the index lookup first. |
| Trusting a single `capture-pane` snapshot to call a session "hung"                                    | Slow steps look identical to a genuine hang in one snapshot. Compare at least two, spaced out.                                                                                                  |
| Treating the TUI's own status text (e.g. an "out of credits" string) as the authoritative quota check | Wording can change across versions; `agyp quota --json` is the stable interface.                                                                                                                |
| Assuming the `<project>-<tool>` window-naming convention is universal                                 | It's this owner's habit, not a guarantee. Confirm with pid lineage and account identity, not window names, before touching anything.                                                            |
| Trusting pid lineage alone, without the account-identity cross-check                                  | The two signals fail independently; requiring both to agree is what catches a stale binding or a coincidental pid match.                                                                        |
| Skipping straight to `agyp logout` or thinking a broken vault needs re-login                          | `logout` is irreversible and out of scope for this skill entirely; a broken vault is `agyp doctor --repair`, not a re-login.                                                                    |

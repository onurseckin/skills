---
name: agy-switch-helper
description: Use when a tmux-paired worker CLI session (e.g. agy) stops making progress — quota exhaustion, a crash, a hang, or a restart — and must be recovered unattended: identify its pane, switch accounts if needed, relaunch, and resume its conversation
---

# Agy Switch Helper

This is a prose-and-recipes skill. There is no code, no test suite, and no automated
guard here on purpose — every step is a command you run by hand, reading the output
before you act on it.

## The One Way To Cause Real Damage

Every destructive action in this skill is scoped to exactly one tmux pane. The owner
runs several project pairs side by side in one tmux server. Different windows,
different projects, different accounts — **the same process name in more than one of
them.** Nothing in the tooling stops you from acting on the wrong one. Correct
targeting is the _entire_ isolation mechanism; there is no other safety net.

This is not hypothetical. Real, live state on the authoring machine, captured while
writing this skill:

```
main:3.1 skills-claude   cmd=2.1.263   pid=9152
main:4.1 skills-agy      cmd=zsh       pid=65288   <- target window: nothing running in it
main:2.1 resume-impl     cmd=agy       pid=5601    <- a different project; agy IS running here

$ pgrep agy
5561
$ ps -o pid=,ppid=,command= -p 5561
5561  5601  agy                        <- child of main:2.1 (resume-impl), NOT of the target
```

An agent asked to recover `skills-agy` that reaches for `pkill agy`, `killall agy`, or
`kill $(pgrep agy)` kills pid 5561 — a _different team's_ live session, on a
_different project_, on a _different account_, mid-task. `skills-agy` had nothing
running that needed killing at all.

Treat these as hard rules, not judgment calls:

1. **Name the target window explicitly on every single command** —
   `-t <session>:<window>.<pane>`. Never rely on tmux's notion of "current window":
   an agent does not reliably know what it is, and it can change out from under you.
2. **Never kill by process name.** `pkill agy`, `killall agy`, and
   `kill $(pgrep agy)` are forbidden outright, full stop — named here so the pattern
   is recognizable the moment you're about to type it.
3. **Prove the pid belongs to the target pane before killing it.** Trace it to the
   pane's own `pane_pid` (the verified recipe is in `references/tmux-targeting.md`).
   An unproven pid is a **stop-and-report condition**, never a judgment call.
4. **Cross-check with account identity, independently of the pid trace.**
   `agyp doctor --json`'s `liveSessions[].email` should match what
   `agyp current --json` reports _run inside the target pane itself_. Require both
   confirmations to agree before any kill.
5. **If nothing is running in the target pane, there is nothing to kill.** Check this
   _first_, explicitly. Never go hunting the machine for an `agy` process to
   terminate just because you were told to recover one — that hunt is exactly how you
   end up killing someone else's.

The reference files below carry the full mechanics; this section is the one part of
the whole skill you should not skim.

## Terminology

Two collaborating agentic CLI sessions run in paired tmux windows: a **supervisor
session** (plans, verifies, directs) and a **worker session** (implements). Either
side can be either role. Today it is often Claude Code as supervisor and `agy` (the
Antigravity CLI) as worker, but the same recipes apply if the pairing is agy-as-
supervisor with another agy as worker, or a third agentic app entirely acting as the
liveness checker. Everywhere below, "supervisor" and "worker" mean the _role_, not a
specific product. Only the concrete tooling — `agyp`, `agy`, `tmux` — is named
specifically, because those are the actual binaries this skill drives.

## When To Use This

The worker session has stopped making progress and a human is not there to notice or
fix it. The most common cause is **quota exhaustion**: the worker's account has run
out of provider quota mid-task. The same recovery shape also covers a **crash** (the
process died), a **hang** (the process is alive but stuck), and a **restart** (the
machine or terminal itself came back up with nothing running). `references/failure-
modes.md` covers telling these apart. Only the account-switching step is specific to
the quota case — identify, terminate, relaunch, and resume apply to all four.

## Preconditions

Check each of these before touching anything:

1. **You can reach the same machine and tmux server the worker runs in.** Run
   `tmux list-sessions`. If it errors with something like `no server running`, there
   is no tmux to recover into — the terminal itself is gone. See "the terminal itself
   is gone" in `references/failure-modes.md` instead of the steps below.
2. **The agyp vault is healthy**, if the quota path is in play at all:
   `agyp doctor --json` and check the `needsRepair` field. If it is `true`, resolve
   that first with `agyp doctor --repair` (see `references/account-management.md`) —
   a broken vault will make every later quota/account read misreport.
3. **You know, or can find, which repository or task the worker pane is responsible
   for** — its working directory, or the window name. You need this to pick the right
   conversation to resume in step 5, not just to relaunch cold.
4. **`sqlite3` is on the machine** (`which sqlite3`) if you intend to use the precise
   conversation-lookup path in `references/session-restart.md`. It ships with macOS;
   if it is genuinely missing, the resume ladder still has a fallback that does not
   need it.

## Scope Boundaries

Pid-targeting and kill safety are covered above in "The One Way To Cause Real
Damage" — those rules apply in full here too. The rest of the scope:

- Prefer `agyp use` (binds one shell) over `agyp global` (rewrites the login
  keychain the IDE and every bare `agy` on the machine reads). `agyp help global` and
  `agyp help sync` both carry the tool's own line "This command changes stored
  state."; `agyp help use` does not. If you only need one pane to stop being on a
  dead account, `global` is almost never what you want — it would silently move every
  _other_ unbound shell and the IDE onto that account too.
- **Never run `agyp logout`.** It deletes the stored sign-in for that account with no
  undo. This skill has no legitimate reason to call it. If an account genuinely needs
  to be removed, stop and ask a human.
- Never touch credentials, and never log the user out of anything — only which
  account is _bound to the target shell_ is ever in scope.
- If a `liveSessions` entry from `agyp doctor --json` does not trace back to a tmux
  pane at all, leave it alone. It belongs to the IDE or a plain terminal, not to a
  window you were asked to manage.

## The Canonical Recovery Sequence

1. **Detect** that the worker needs recovery. Quota exhaustion is the common case
   (`agyp quota`/`agyp doctor`, plus a corroborating look at the pane itself); a
   crash, hang, or restart present differently — see `references/failure-modes.md`.
2. **Identify** the exact tmux window/pane the worker runs in, and — if a process is
   still alive — the specific pid belonging to _that pane only_, confirmed by **two
   independent signals** (pid lineage and account identity — see "The One Way To
   Cause Real Damage" above and `references/tmux-targeting.md`).
3. **Check whether anything is even running there first.** If nothing is, there is
   nothing to terminate — skip straight to relaunching. If something is, terminate it
   cleanly: graceful signal first, verify it actually exited, escalate only if it
   didn't (`references/session-restart.md`).
4. **Only for the quota case**, inside that pane's own shell: check quota across
   accounts, pick the one with the most remaining (or decide waiting beats
   switching), and bind it (`references/account-management.md`). Skip this step
   entirely for a crash/hang/restart — the account was never the problem.
5. **Relaunch** the worker CLI in the same window, resuming its prior conversation
   instead of starting cold (`references/session-restart.md`'s resume ladder).
6. **Re-establish coordination**: hand the resumed worker what it needs to rejoin the
   shared coordination channel, and have it spawn (or confirm) a dedicated,
   never-terminating communication agent so the supervisor isn't flying blind again
   (`references/handoff-protocol.md`).

**Verify every step from inside the target pane, not from your own shell.** A
`tmux capture-pane -p -t <target>` showing the expected state is evidence; the
absence of an error in your own shell is not — a command sent to the wrong pane
produces no error anywhere, it just silently does nothing to the pane you meant to
change. A step that silently didn't take effect (wrong pane, env var that didn't
stick, conversation ID that doesn't exist) compounds into a much worse mess two
steps later.

## Worked Example

**Part 1 — the trap, not a drill.** This is the exact live scenario from "The One Way
To Cause Real Damage" above, walked as a targeting exercise. Suppose the task is
"recover the `skills-agy` session":

```
$ tmux list-panes -a -F '#{session_name}:#{window_index}.#{pane_index} #{window_name} pane_pid=#{pane_pid} cmd=#{pane_current_command}'
main:3.1 skills-claude pane_pid=9152  cmd=2.1.263
main:4.1 skills-agy    pane_pid=65288 cmd=zsh
main:2.1 resume-impl   pane_pid=5601  cmd=agy
```

`skills-agy` is `main:4.1`, `pane_pid=65288`, currently running `zsh` — not `agy`.
Confirm directly rather than assuming from the window name alone:

```
$ pgrep -P 65288 -l
(no output — no agy child of this pane's shell)
```

**Correct conclusion: nothing is running in the target. There is nothing to kill.**
Skip straight to relaunching (Part 2's step 5 mechanics, applied to this window).

The wrong conclusion looks like this — and it is worth seeing exactly how it happens:

```
$ pgrep agy
5561
$ ps -o pid=,ppid=,command= -p 5561
5561  5601  agy
```

pid `5561`'s `ppid` is `5601` — that's `main:2.1` (`resume-impl`)'s `pane_pid`, a
different window entirely, confirmed live under a different account
(`agyp doctor --json`'s `liveSessions` showed `{"pid":5561,"email":"onurssenoglu@gmail.com"}`
at the time). Killing it because a machine-wide `pgrep agy` happened to return it
would have destroyed a different team's unrelated, live session. This is precisely
why rules 2–4 above exist: a bare `pgrep`/`pkill` on the binary name carries no
window information at all, and the fix is never "be more careful with pgrep" — it's
"always confirm lineage against the specific pane_pid you already named."

**Part 2 — the full sequence**, illustrated on `main:2.1` (`resume-impl`) instead,
since it's the pane that actually has something running. To show the account-switch
step concretely, this part narrates a hypothetical ("suppose this account were
low") layered onto the real structural facts below — flagged plainly where the
framing is illustrative rather than a literal recorded event.

Real `agyp quota --cached --json` shape, captured live (both accounts shown so you
can see what "one healthy, one not" looks like — quota is time-sensitive and these
exact numbers will already be stale by the time you read this):

```json
{
  "ok": true,
  "command": "quota",
  "accounts": [
    {
      "account": "onurssenoglu@gmail.com",
      "isSessionAccount": true,
      "runningSessions": 1,
      "quota": {
        "remainingPercentage": 46.1,
        "resetTime": "2026-09-08T11:14:22Z",
        "source": "live_session"
      }
    },
    {
      "account": "onurseckinsenoglu@gmail.com",
      "isSessionAccount": false,
      "runningSessions": 0,
      "quota": {
        "remainingPercentage": 100,
        "resetTime": "2026-09-08T13:26:58Z",
        "source": "cache"
      }
    }
  ]
}
```

For the rest of this walkthrough, imagine `main:2.1` were the one critically low
instead. `capture-pane` on a live worker pane can also show exhaustion directly —
during this skill's own verification, a live pane's status bar literally read
`Gemini 3.8 Flash · high · 5 subagent(s) · AI: Out of credits`. Treat that string as
a corroborating hint only (exact wording can change across versions); `agyp quota
--json` is the authoritative check.

**Step 2 — Identify, with both confirmations** (real, executed output):

```
$ tmux list-panes -a -F '#{session_name}:#{window_index}.#{pane_index} pane_pid=#{pane_pid} cmd=#{pane_current_command}'
main:2.1 pane_pid=5601 cmd=agy

$ agyp doctor --json | grep -A4 liveSessions
  "liveSessions": [ { "pid": 5561, "port": 57731, "email": "onurssenoglu@gmail.com" } ],

$ pgrep -P 5601 -l
5561 agy

$ ps -o pid=,ppid=,tty=,command= -p 5561
5561  5601 ttys006  agy

$ tmux send-keys -t main:2.1 'agyp current --json' Enter
$ tmux capture-pane -p -t main:2.1 | tail -6
{ "ok": true, "sessionAccount": "onurssenoglu@gmail.com", ... }
```

Two independent confirmations, both satisfied: pid `5561`'s `ppid` (`5601`) matches
`main:2.1`'s `pane_pid` (lineage), and the account `liveSessions` reports for that
pid (`onurssenoglu@gmail.com`) matches what `agyp current --json` reports _from
inside that same pane_ (identity). Full mechanism in
`references/tmux-targeting.md`.

**Step 3 — Terminate** (see `references/session-restart.md` for the wait/escalate
timing):

```
$ kill 5561
$ sleep 5 && ps -p 5561          # expect "No such process"
```

**Step 4 — Switch account**, entirely inside the target pane, via `send-keys` (never
from the supervisor's own shell — see "why this must run inside the pane" in
`references/account-management.md`):

```
$ tmux send-keys -t main:2.1 'agyp best --min 20 --json' Enter
$ tmux capture-pane -p -t main:2.1 | tail -8
$ tmux send-keys -t main:2.1 'eval "$(agyp use onurssenoglu@gmail.com)"' Enter
$ tmux send-keys -t main:2.1 'agyp current --json' Enter
$ tmux capture-pane -p -t main:2.1 | tail -6
```

Confirm the capture — read from the target pane, not inferred from your own shell —
shows the new account as `sessionAccount` before continuing. If it still shows the
old one, you likely sent the keys to the wrong pane — re-run `tmux list-panes` and
compare.

**Step 5 — Relaunch and resume.** The conversation lookup is a filesystem read; run
it in the _supervisor's own_ shell, not through `send-keys` — only binding the
account and launching `agy` need to happen inside the worker's pane:

```
$ DB="/Users/onurseckinsenoglu/.agyp/accounts/onurssenoglu@gmail.com/home/.gemini/antigravity-cli/conversation_summaries.db"
$ sqlite3 -json "$DB" \
    "SELECT conversation_id, title, last_modified_time, killed, not_fully_idle
     FROM conversation_summaries
     WHERE workspace_uris LIKE '%/repos/resume-writer%'
     ORDER BY last_modified_time DESC LIMIT 1;"
```

Real result, captured live for this exact repo/window pairing:

```json
[
  {
    "conversation_id": "c9056309-a72f-42db-ad81-f96422c24860",
    "title": "Orchestrator System Development Setup",
    "last_modified_time": "2026-09-08 06:35:10.463979+00:00",
    "killed": 0,
    "not_fully_idle": 0
  }
]
```

Only the short final command goes into the pane:

```
$ tmux send-keys -t main:2.1 'agy --conversation c9056309-a72f-42db-ad81-f96422c24860' Enter
$ sleep 3 && tmux capture-pane -p -t main:2.1 | tail -20
```

Confirm from the capture that `pane_current_command` for `main:2.1` actually became
`agy` again and the resumed content is recognizable — not a fresh empty session, not
an error. Full lookup ladder (index → directory scan → supervisor's own transcript →
`--continue` as last resort) in `references/session-restart.md`.

**Step 6 — Re-establish coordination.** This repo's real coordination substrate is
the `chatroom` skill; the worker's own repo carries a binding file that survives the
restart even though the process didn't. Real example from this exact repo:

```
$ cat /Users/onurseckinsenoglu/repos/resume-writer/.chatroom/binding.json
{ "host": "antigravity", "member_id": "antigravity-builder", "room_id": "resume-writer" }
```

Hand that back to the worker explicitly rather than assuming conversation-resume
restored it — see `references/handoff-protocol.md` for the full recipe and the
communicator-subagent mandate.

## Reference Index

- `references/account-management.md` — the full `agyp` surface, real JSON shapes,
  the `use`-vs-`global` distinction, `--cached` vs. live probing, and why `agyp use`
  needs `eval` to actually take effect.
- `references/tmux-targeting.md` — finding the window, the verified pid-to-pane
  recipe, the two-independent-confirmations check, `send-keys`/`capture-pane`
  addressing, and why env bindings are per-pane.
- `references/session-restart.md` — the real `agy` flags (including the `--resume`
  correction), kill discipline, and the full conversation-resume ladder.
- `references/handoff-protocol.md` — rejoining shared coordination and spawning the
  dedicated communicator subagent.
- `references/failure-modes.md` — quota exhaustion vs. crash vs. hang vs. restart,
  how to tell them apart, and common mistakes.

## Not Yet Wired Into Sync

This skill lives at `agy-switch-helper/` and is **not** currently registered in
`bun run sync` or anything under `scripts/sync/**`. Wiring it into that pipeline is a
separate decision left to the maintainer.

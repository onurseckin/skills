# Finding And Addressing The Worker's Pane

Verified on this machine: `tmux 3.7c` (macOS/zsh).

## Discovery: A Convention, Not The Convention

Real layout captured live with:

```
tmux list-windows -a -F '#{session_name}:#{window_index}.#{pane_index} #{window_name} #{pane_current_command} #{pane_pid}'
```

```
main:1.1 resume-writer 2.1.263 5424
main:2.1 resume-impl   agy     5601
main:3.1 skills-claude 2.1.263 9152
main:4.1 skills-agy    zsh     65288
main:5.1 limo-claude   2.1.263 83991
main:6.1 limo-agy      zsh     85865
```

The owner pairs windows as `<project>-<tool>` (`skills-claude` / `skills-agy`) or
`<project>-writer` / `<project>-impl`. Use window names as a _hint_ to shortlist
candidates, never as proof — names are free text, another owner or another day could
use a different scheme entirely. `pane_current_command` showing `agy` vs. `zsh` is a
cheap liveness signal (a pane currently running the worker vs. an idle shell waiting
for one to be relaunched), but it is still just a hint until you confirm pid lineage
below.

## Forbidden: Killing By Process Name

`pkill agy`, `killall agy`, and `kill $(pgrep agy)` are **never acceptable**, no
matter how confident you are about what's running. None of them carry any window
information — they act on every matching process on the machine. Real proof this
isn't paranoia, captured live on this exact machine while writing this skill:

```
$ pgrep agy
5561
```

There was exactly one `agy` process running on the machine at that moment — but it
belonged to `main:2.1` (`resume-impl`), a project completely unrelated to whichever
window an agent might have actually been asked to recover. On a machine running
several project pairs at once (the owner's normal state), a name-based kill has no
way to distinguish "the one I was asked about" from "someone else's, right now." The
only legitimate kill target is a pid you have traced to the specific pane_pid of the
window you were asked to act on — see the recipe immediately below.

## The Verified pid-to-pane Recipe

`pane_pid` (from tmux) is the **pid of the pane's shell** — fixed for the life of the
pane. The `agy` process is a **child** of that shell, with its own, different,
changing pid. This parent/child relationship is the actual mechanism for scoping a
kill to one window, and it is what both directions of the recipe below rely on.

**Direction 1 — pane known, want the worker pid.** List children of the pane's shell
and look for the worker binary:

```
$ tmux list-panes -a -F '#{session_name}:#{window_index}.#{pane_index} pane_pid=#{pane_pid} cmd=#{pane_current_command}'
main:2.1 pane_pid=5601 cmd=agy

$ pgrep -P 5601 -l
5561 agy
```

**Direction 2 — worker pid known (e.g. from `agyp doctor --json`'s `liveSessions`),
want the owning pane.** Walk up to the parent and match it against every pane's
`pane_pid`:

```
$ agyp doctor --json | grep -A4 liveSessions
  "liveSessions": [ { "pid": 5561, "port": 57731, "email": "onurssenoglu@gmail.com" } ],

$ ps -o pid=,ppid=,tty=,command= -p 5561
5561  5601 ttys006  agy

$ ps -o pid=,ppid=,tty=,command= -p 5601
5601  3786 ttys006  zsh
```

`5561`'s `ppid` is `5601`, which is exactly `main:2.1`'s `pane_pid` — positive match,
both directions agree, and the `tty` (`ttys006`) matches too as a second sanity
check. Both commands (`pgrep -P` and `ps -o ppid=`) were run on this machine and
cross-checked against each other; either alone is sufficient once you trust it.

**A pid whose `ppid` does not match the pane you're targeting is not your pid.**
Verified live counter-example: `main:4.1` (`skills-agy`) has `pane_pid=65288`, and
`pgrep -P 65288 -l` returns nothing at all — no agy child exists there right now,
even though `pgrep agy` machine-wide finds one (pid `5561`, shown above to belong to
a completely different window). Confirming a _negative_ result this way is just as
important as confirming a positive one — it's what tells you "there is nothing to
kill here" instead of guessing.

## Two Independent Confirmations Before Any Kill

Pid lineage alone is one signal. Cross-check it against account identity as a second,
independent one before treating a pid as confirmed:

```
$ agyp doctor --json | grep -A4 liveSessions
  "liveSessions": [ { "pid": 5561, "port": 57731, "email": "onurssenoglu@gmail.com" } ],

$ tmux send-keys -t main:2.1 'agyp current --json' Enter
$ tmux capture-pane -p -t main:2.1 | tail -6
{ "ok": true, "sessionAccount": "onurssenoglu@gmail.com", ... }
```

The email `doctor` reports for the candidate pid should match the `sessionAccount`
that pane itself reports when asked directly. If they disagree, you do not have the
pid you think you have — stop and re-derive, don't kill. This matters because pid
lineage and account identity fail independently: a pid can coincidentally trace to
the right pane while a stale env binding makes the account wrong, or vice versa.
Requiring both to agree is cheap insurance against either single check being wrong.

**If a `liveSessions` pid's `ppid` does not match any pane's `pane_pid` at all,**
that agy process is not running inside a tmux pane you can see — it may belong to
the IDE, a plain (non-tmux) terminal, or a different tmux server entirely. Per
`SKILL.md`'s scope boundaries, leave it alone.

## Sending Commands Into The Pane

Addressing form, verified working:

```
tmux send-keys -t <session>:<window>.<pane> '<command>' Enter
```

Real example, run against an idle pane during verification:

```
$ tmux send-keys -t main:4.1 'echo agy-switch-helper-verify-1788855979' Enter
$ tmux capture-pane -p -t main:4.1 | tail -3
agy-switch-helper-verify-1788855979
```

The echoed text appeared in the pane's own scrollback — the addressing form works
exactly as `<session>:<window>.<pane>`. Always spell out the full `-t` target on
every command; never issue a bare command hoping it lands on "whatever window is
current" (see "The One Way To Cause Real Damage" in `SKILL.md`).

**Practical gotcha:** anything beyond a simple one-liner gets painful to send through
`send-keys` because of shell quoting nested inside the string you're already
quoting for the outer `tmux` call. For a multi-line or heavily-quoted command (a SQL
query, a multi-flag `agy` invocation with an embedded prompt string), write it to a
small throwaway script instead and `send-keys` the short `bash /path/to/script.sh`
invocation. Reserve raw `send-keys` one-liners for short, simple commands like
`eval "$(agyp use <account>)"` or the final `agy --conversation <id>`.

## Reading The Pane Without Touching It

`tmux capture-pane -p -t <target>` is read-only — safe to run against a pane that's
actively busy. Verified against a live, busy worker pane (`main:2.1`, mid-session):
capture-pane returned the full live TUI, including a bottom status bar of the shape

```
? for shortcuts   Gemini 3.8 Flash · high · 5 subagent(s) · AI: Out of credits
```

That status line is a useful **corroborating** liveness/exhaustion signal — you can
read it without interacting with the pane at all — but treat the exact wording as
liable to change across agy versions. `agyp quota --json` is the authoritative check
for exhaustion; `capture-pane` is how you confirm state _after_ you've acted (did the
account switch really show up in `agyp current --json`? did `agy` actually relaunch
instead of erroring?). Always read the confirmation from the target pane itself —
never infer success from the absence of an error in your own shell; a command sent to
the wrong pane produces no error anywhere, it just silently does nothing to the pane
you meant to change.

## Why The Env Binding Is Per-Pane (And Can't Be Set From Elsewhere)

Covered in full in `references/account-management.md`, but the short version
belongs here too since it's a targeting mistake, not just an account mistake:
`AGYP_ACCOUNT`/`AGYP_HOME` are ordinary shell environment variables. They only ever
propagate from a parent process to the children it spawns. `send-keys` works because
it types the command into the pane's own long-lived shell — the `export` (via
`eval "$(agyp use ...)"`) genuinely happens _in_ that shell, so every subsequent
child of it (including the `agy` you launch next) inherits it normally. Running
`agyp use` anywhere else — the supervisor's own shell, a one-off SSH command, a
different pane — changes nothing in the target pane, because there is no process
relationship between them for the environment to travel through. This failure mode
is silent: your own shell reports success (it genuinely did bind _your own_
environment), and the target pane is simply untouched.

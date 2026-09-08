# Account Management (`agyp`)

`agyp` lives at `~/.local/bin/agyp`. It is a **plain compiled binary**, not a shell
function or alias (verified: `type agyp` resolves straight to the path; no
`agyp`/`AGYP` reference exists anywhere in `~/.zshrc`, `~/.zprofile`, `~/.zshenv`, or
the active shell's function table). That fact matters and is explained below — it is
_why_ `agyp use` needs `eval` to actually bind anything.

## Full Command Surface

Verified via `agyp help`:

```
use      Bind an account to this shell.
global   Mirror an account into the login keychain for the IDE and bare agy.
sync     Re-push this shell's account, or the global one, into the login keychain.
list     List accounts with their quota.                          (alias: ls)
quota    Report remaining Gemini quota, probing accounts that are not running.
best     Print the account with the most quota left.
auto     Switch this shell to the best account when the current one is running low.
current  Show this shell's account and the global default.        (alias: whoami)
login    Sign in to an additional account. Needs a terminal.
claim    Attach a kept sign-in whose account could not be identified.
import   Adopt whatever account the login keychain currently holds.
logout   Forget an account and delete its sandbox. The stored sign-in is lost.
doctor   Report vault health, stored sign-ins, their backups, and running agy instances.
menu     Open the interactive account menu. This is what a bare `agyp` runs.
help     Show help for agyp or for one command.
```

Every command accepts `--json` and `--help`.

**Exit codes** (verified via `agyp help`): `0` success, `1` operation failed,
`2` bad usage, `3` no account satisfied the request (`best`/`auto` with `--min`).

## Two Scopes — and Why They're Different

```
this shell  AGYP_ACCOUNT and AGYP_HOME; the agy wrapper points HOME at the sandbox.
global      The login keychain, used by the Antigravity IDE and any bare agy.
```

- `AGYP_ACCOUNT` — account bound to this shell.
- `AGYP_HOME` — sandbox home the agy wrapper uses as `HOME`.
- `AGYP_KEYCHAIN_MODE` — `strict` stops sandboxes falling back to the login keychain.
- `AGYP_NO_TUI` — set to any value to refuse the interactive menu; use this if you
  ever invoke a bare `agyp` non-interactively, so it can't block waiting on a TUI.

This is _why_ each tmux window can hold a different account: the binding lives in
that pane's own shell environment, never in a single shared file. Changing it from
another window can't reach it — environment variables only ever flow from a parent
process to its children, never sideways between unrelated shells, and never
backwards from a child into the parent that spawned it.

`agyp global`/`agyp sync`, by contrast, rewrite the **login keychain** — a single
machine-wide default that the IDE and every _unbound_ shell fall back to. Both
carry this exact line in their own `--help` text that `use` does not:

```
$ agyp help global
...
This command changes stored state.

$ agyp help sync
...
This command changes stored state.
```

`agyp help use` has no such line. That asymmetry is the tool's own signal for which
one is the heavier, more permanent operation. Prefer `use` for this skill's purpose
every time — you are fixing one pane, not the machine's default.

## `agyp use` Does Not Mutate Your Shell By Itself — Verified

This is the one thing that looks like it should "just work" and doesn't, and it is
worth being precise about because getting it wrong means the switch silently has no
effect.

`agyp use <account>` is a child process. A child process cannot write into its
parent shell's environment — this is a hard OS-level fact, not a quirk of this tool.
Verified directly: running `agyp use <other-account>` as a plain command, then
checking `$AGYP_ACCOUNT` and `agyp current --json` _in the same shell, immediately
after_, showed the **old** account, unchanged. The `use` call did succeed (it updated
its own bookkeeping — `~/.agyp/registry.json`'s `lastUsedAt` for that account moved
forward), but nothing in the calling shell's own environment changed.

What actually works: run `agyp use <account>` **without** `--json`. It prints exactly
two lines, ready to `eval`:

```
$ agyp use onurssenoglu@gmail.com
export AGYP_ACCOUNT="onurssenoglu@gmail.com"
export AGYP_HOME="/Users/onurseckinsenoglu/.agyp/accounts/onurssenoglu@gmail.com/home"
```

So the correct invocation, run **inside the target shell itself** (which in this
skill's context means: sent into the worker's tmux pane via `send-keys`, never run
in the supervisor's own shell), is:

```
eval "$(agyp use <account>)"
```

`eval` runs those two `export` lines _as that shell_, which is what makes them stick
for every command typed into that pane afterward, including the `agy` you launch
next — it will inherit them normally, the way any child process inherits its
parent's environment. This is also why trying to set `AGYP_ACCOUNT` from the
supervisor's own shell, or from any process other than the pane's own shell, can
never work: there is no path from that process's environment into the pane's.

The `--json` form is still useful — for validating that an account name/prefix
resolves to what you expect, and for reading the exact `shadowHome` path — but do not
expect it to bind anything by itself:

```json
{
  "ok": true,
  "command": "use",
  "account": "onurseckinsenoglu@gmail.com",
  "shadowHome": "/Users/onurseckinsenoglu/.agyp/accounts/onurseckinsenoglu@gmail.com/home",
  "env": {
    "AGYP_ACCOUNT": "onurseckinsenoglu@gmail.com",
    "AGYP_HOME": "/Users/onurseckinsenoglu/.agyp/accounts/onurseckinsenoglu@gmail.com/home"
  }
}
```

**Testing note:** the only account-mutating command exercised while writing this
skill was `agyp use`, which only rebinds the caller's own shell — never the target
worker's — and was switched back immediately after. No `agyp global`, `agyp sync`,
`agyp login`, or `agyp logout` was run.

## Real JSON Shapes

`agyp current --json`:

```json
{
  "ok": true,
  "command": "current",
  "sessionAccount": "onurssenoglu@gmail.com",
  "globalAccount": "onurssenoglu@gmail.com"
}
```

`agyp quota --cached --json` / `agyp list --json` (accounts array; `list` also
carries top-level `sessionAccount`/`globalAccount`, `quota` does not):

```json
{
  "ok": true,
  "command": "quota",
  "accounts": [
    {
      "account": "onurssenoglu@gmail.com",
      "isSessionAccount": true,
      "isGlobalAccount": true,
      "runningSessions": 1,
      "quota": {
        "remainingPercentage": 52.8,
        "resetTime": "2026-09-08T11:14:22Z",
        "modelCount": 11,
        "planName": "Pro",
        "source": "live_session",
        "capturedAt": "2026-09-08T08:23:12.598Z"
      }
    },
    {
      "account": "onurseckinsenoglu@gmail.com",
      "isSessionAccount": false,
      "isGlobalAccount": false,
      "runningSessions": 0,
      "quota": {
        "remainingPercentage": 1.9,
        "resetTime": "2026-09-08T08:26:58Z",
        "modelCount": 11,
        "planName": "Pro",
        "source": "cache",
        "capturedAt": "2026-09-08T07:59:37.693Z"
      }
    }
  ]
}
```

`source` is `"live_session"` for an account with a running agy, `"cache"` otherwise —
you can see both in one real response above.

`agyp doctor --json` (trimmed; the full shape has more fields than originally
expected — `sandboxReady` and `sandboxOnlyEntries` per account, confirmed live):

```json
{
  "ok": true,
  "command": "doctor",
  "vault": "/Users/onurseckinsenoglu/.agyp",
  "keychainMode": "layered",
  "sessionAccount": "onurssenoglu@gmail.com",
  "globalAccount": "onurssenoglu@gmail.com",
  "liveSessions": [{ "pid": 5561, "port": 57731, "email": "onurssenoglu@gmail.com" }],
  "accounts": [
    {
      "account": "onurssenoglu@gmail.com",
      "hasStoredSignIn": true,
      "hasRecoverableBackup": true,
      "backups": { "store": true, "login": true },
      "keychain": "/Users/onurseckinsenoglu/.agyp/accounts/onurssenoglu@gmail.com/home/Library/Keychains/agyp.keychain-db",
      "credentialExpiry": "2026-09-08T01:41:33.59482-07:00",
      "sandboxReady": true,
      "sandboxOnlyEntries": []
    }
  ],
  "needsRepair": false,
  "repairs": []
}
```

`liveSessions[].pid` is the authoritative way to map a running agy process to the
account it is using. See `references/tmux-targeting.md` for turning that pid into a
tmux pane.

`agyp best --cached --json` — success and the exit-3 failure, both verified live:

```json
{
  "ok": true,
  "command": "best",
  "account": "onurssenoglu@gmail.com",
  "remainingPercentage": 51.1,
  "quota": { "...": "..." }
}
```

```
$ agyp best --min 99 --cached --json ; echo "exit=$?"
{ "ok": false, "command": "best", "account": null, "error": "No account has at least 99% remaining." }
exit=3
```

## Choosing An Account

1. Prefer `agyp best --min <percent> --cached --json` for the decision itself —
   cheap, no probing, and exit code alone tells you whether anything qualifies.
2. **Exit code 3 means nothing qualifies at your threshold.** Before picking a lower
   threshold out of impatience, check `resetTime` on the current account via
   `agyp quota --cached --json`. If it resets in the next few minutes, waiting is
   often better than switching — a switch costs a kill + relaunch + conversation
   lookup; a wait costs nothing but time you may already have (the worker isn't
   producing anything either way).
3. `agyp auto [--min <percent>]` already implements "switch this shell to the best
   account when the current one is below threshold" as one call (default threshold
   15, verified via `agyp help auto`). For the common case — no need to reason about
   thresholds yourself — send `eval "$(agyp auto)"` into the pane instead of doing
   `best` + `use` by hand. Do the manual `best`-then-`use` sequence only when you
   need to see the ranking first, or need a non-default threshold reasoning step.
4. `agyp quota` **without** `--cached` actively probes accounts that aren't running,
   which costs time and may itself consume a sliver of quota just to check it. Use
   `--cached` for any polling loop that just wants to notice a threshold crossing;
   reserve an uncached call for the actual moment you're about to commit to a
   decision.

## Doctor and Repair

`agyp doctor --json` is a safe read. `agyp doctor --repair` mutates (restores a
missing/unopenable sign-in from backups) — run it only if `needsRepair` is `true`,
and re-run `agyp doctor --json` afterward to confirm `needsRepair` flipped to
`false` and `repairs` lists what it did.

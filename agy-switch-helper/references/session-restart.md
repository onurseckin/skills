# Restarting The Worker And Resuming Its Conversation

## The Real `agy` Flags

`agy` lives at `~/.local/bin/agy`, also a plain binary (not a shell function).
**Correction:** there is no `--resume` flag. The real flags, verified against
`agy --help` on this machine:

```
--conversation <ID>       Resume a previous conversation by ID.
--continue, -c            Continue the most recent conversation.
--prompt-interactive, -i  Run an initial prompt interactively and continue the session.
--print, -p, --prompt     Run a single prompt non-interactively and print the response.
--print-timeout           Default 5m0s.
--output-format           text|json|stream-json
--input-format            text|stream-json
--model, --agent, --effort low|medium|high, --mode accept-edits|plan
--project, --new-project, --add-dir (repeatable)
--dangerously-skip-permissions, --sandbox, --disable-slash-commands
--log-file, --json-schema
```

Subcommands: `agent`/`agents`, `changelog`, `help`, `install`, `mcp`, `mic-serve`,
`models`, `plugin`/`plugins`, `remote-control`, `update`.

**Recommend `--continue`/`-c` as the default resume path** when you don't have (or
don't trust) a specific conversation ID — it needs no ID and is robust for a window
that was running exactly one session. Use `--conversation <ID>` when you know the ID
precisely, which the ladder below gets you most of the time.

Combining `--conversation <ID>` with `-i "<first prompt>"` in one call was **not
executed during verification** (doing so starts a real interactive session, out of
scope for writing this doc). Both flags are independently confirmed to exist in
`agy --help` and nothing there suggests they conflict, but confirm the combination
actually does what you expect the first time you rely on it, and fall back to two
separate `send-keys` calls (resume, then a follow-up prompt) if it doesn't.

## Kill Discipline

Everything in this section assumes you have already completed the two independent
confirmations in `references/tmux-targeting.md` (pid lineage _and_ account identity)
and something is actually running in the target pane. If either confirmation failed,
or nothing is running there, there is nothing to apply this section to — see "The
One Way To Cause Real Damage" in `SKILL.md` and "Check This First" in
`references/failure-modes.md`.

**Not empirically verified** — killing a live agy process was explicitly out of
scope while writing this skill, since the owner has real sessions running. The
recommendation below is standard Unix practice, not something confirmed against
agy's own shutdown behavior specifically:

1. Send a graceful signal first: `kill <pid>` (SIGTERM). This gives the process a
   chance to flush any in-progress state before exiting, if it handles the signal at
   all — unverified whether agy does anything on receipt of SIGTERM.
2. Wait a few seconds (5 is a reasonable default) and confirm it actually exited:
   `ps -p <pid>` should report no such process.
3. **Escalate to `kill -9` only if it's still present after the wait.** SIGKILL gives
   the process no chance to clean up anything — use it as a last resort, not a first
   move.
4. Either way, re-run the pid-to-pane check from `references/tmux-targeting.md`
   after killing, to confirm the pane's shell (not just the worker process) is still
   the one you expect before you relaunch into it.

## Finding The Conversation To Resume

### Where Conversations Actually Live

Antigravity's CLI data lives under `~/.gemini`, not `~/.antigravity` (the latter
holds IDE-adjacent config/extensions and is a dead end for this — verified by
searching it directly and finding only generic Electron/VS-Code-style `Session
Storage`/`User/History` artifacts, nothing resembling a conversation-ID store).

Nominally there are two locations:

```
Global (bare agy / IDE):     ~/.gemini/antigravity-cli/
Per-account sandbox (agyp):  $AGYP_HOME/.gemini/antigravity-cli/
```

**Verified finding, with a correction worth stating plainly:** on this machine,
`$AGYP_HOME/.gemini` is a **symlink to the real `~/.gemini`** — confirmed both by
`ls -la` showing `.gemini -> /Users/onurseckinsenoglu/.gemini` inside each account's
sandbox home, and by `stat`'s inode for `conversation_summaries.db` being _identical_
(`81477912`) across the global path and both account sandbox paths. They are the
same physical file, not three separate stores. (Only `Library/`, and specifically
`Library/Keychains/agyp.keychain-db`, is genuinely separate per account — confirmed
by _different_ inodes there.) Row count in the shared `conversation_summaries`
table was 800 at verification time, with 506 physical `conversations/*.db` files —
the index can outlive or outnumber the per-conversation database files it
summarizes.

This is very likely an implementation detail of how sandboxing is built (isolate
credentials, don't bother isolating conversation history) rather than a documented
guarantee, so **don't hardcode `~/.gemini` and don't assume account-based
isolation either** — always resolve the path through `$AGYP_HOME` (falling back to
`$HOME` if the pane isn't agyp-bound). That resolves correctly today, and stays
correct if a future version genuinely does isolate conversation history per account.

### The Index — Verified, Exact Recipe

`<store>/conversation_summaries.db` is a real SQLite database. Verified schema
(`sqlite3 "$DB" ".schema conversation_summaries"`):

```sql
CREATE TABLE `conversation_summaries` (
  `conversation_id` text, `title` text, `preview` text, `step_count` integer,
  `last_modified_time` datetime NOT NULL, `workspace_uris` text NOT NULL,
  `status` text, `source` text, `project_id` text, `agent_name` text,
  `parent_conversation_id` text, `nesting_depth` integer,
  `battle_id` text, `winning_conversation_id` text,
  `not_fully_idle` numeric NOT NULL DEFAULT false, `killed` numeric NOT NULL DEFAULT false,
  `last_user_input_time` datetime NOT NULL, `last_user_input_step_index` integer,
  `app_data_dir` text, raw_summary BLOB, PRIMARY KEY (`conversation_id`)
);
-- indexed on last_user_input_time and last_modified_time
```

`workspace_uris` is a JSON array of `file://` URIs — this is how you find the
conversation belonging to a specific repository. Verified query and real result
(run against the live database on this machine):

```
$ sqlite3 -json "$DB" \
    "SELECT conversation_id, title, step_count, last_modified_time, not_fully_idle, killed, workspace_uris
     FROM conversation_summaries WHERE workspace_uris LIKE '%/repos/skills%'
     ORDER BY last_modified_time DESC LIMIT 1;"

[{"conversation_id":"7fc55308-39b0-4d40-9d3a-6737a22bffff","title":"limow","step_count":21439,
  "last_modified_time":"2026-09-08 06:36:05.44354+00:00","not_fully_idle":0,"killed":0,
  "workspace_uris":"[\"file:///Users/onurseckinsenoglu/repos/skills\"]"}]
```

`conversation_id` is the UUID; the matching `conversations/<uuid>.db` file exists on
disk (verified: a 121MB file for the id above). That UUID is exactly what you pass to
`agy --conversation <ID>`.

`killed` and `not_fully_idle` are real columns (confirmed via the schema above) whose
semantics are inferred from their names rather than exhaustively tested through every
state transition — but the inference is well supported: prefer a conversation with
`killed = 0`; treat `not_fully_idle = 1` as "this session may still be running —
confirm the process is really gone (`references/tmux-targeting.md`) before resuming
it," which protects against attaching to a conversation another live window still
owns.

**Liveness cross-check, verified end to end:** a conversation with an open
write-ahead log has a non-empty `<uuid>.db-wal` companion. On this machine, the
newest conversation for the `resume-writer` workspace
(`c9056309-a72f-42db-ad81-f96422c24860`) was independently confirmed to be the one
with a live, non-empty `.db-wal`, and that same window's `agy` process was
independently confirmed live via the pid-to-pane recipe — the two signals agreed.
Treat a non-empty `.db-wal` as a useful liveness hint, not the primary method — the
index query above is.

### The Resume Ladder

In order, most precise first. Don't skip to the bottom out of impatience — steps 1–3
are about _precision_ (resuming the exact right conversation), step 4 is about
_guaranteed recovery_ (something that always works but may pick the wrong one):

1. **Query the index** by `workspace_uris` for the repo the window works on, take the
   newest `last_modified_time` with `killed = 0`, resume with
   `agy --conversation <ID>`. Default path; shown above.
2. **Scan the conversations directory directly** — newest `<uuid>.db`/`<uuid>.db-wal`
   by mtime, in the right account's sandbox (or the global path, since on this
   machine they resolve to the same place) — when the index is missing, locked, or
   returns nothing.
3. **Read the supervisor's own transcript/coordination log.** If the two sessions
   have been talking through a shared channel (see `references/handoff-protocol.md`),
   the conversation id may already be sitting in that history — search it before
   falling back to a filesystem guess.
4. **`agy -c` / `--continue`** — opens the most recent conversation for that shell.
   Always works, needs no ID, but "most recent" depends on the shell's account
   binding and can attach to the wrong conversation if the window has run several.
   Last resort, not a shortcut.

## Verifying The Relaunch

```
$ tmux send-keys -t <target> 'agy --conversation <ID>' Enter
$ sleep 3 && tmux capture-pane -p -t <target> | tail -20
```

Confirm the capture shows the actual resumed conversation (recognizable title/recent
context), not a fresh empty session or an error like "conversation not found." If it
errors, drop down the resume ladder one step rather than retrying the same ID.

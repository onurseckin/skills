# Re-Establishing Coordination After A Restart

Resuming the right conversation (`references/session-restart.md`) gets the worker's
own memory back. It does not, by itself, guarantee the worker is listening on
whatever channel the supervisor uses to coordinate — the daemon or process backing
that channel died along with everything else in that pane. Treat "resume the
conversation" and "rejoin coordination" as two separate steps, and verify both.

## What "Rejoin The Shared Chatroom" Concretely Means Here

This repository's real coordination substrate is the `chatroom` skill
(`chatroom/SKILL.md` in this repo) — a room-based messaging system with guaranteed
delivery, independent of any single host. If a different coordination mechanism is in
use elsewhere, adapt the same shape: give the restarted worker its identity in that
system, confirm its delivery daemon/process is actually live, and have it catch up on
anything it missed.

Concretely, for chatroom: a repository carries a small binding file that survives a
process restart because it's on disk, not in memory. Real example, found in this
exact repo pairing while writing this skill:

```
$ cat /Users/onurseckinsenoglu/repos/resume-writer/.chatroom/binding.json
{ "host": "antigravity", "member_id": "antigravity-builder", "room_id": "resume-writer" }
```

If that file exists in the worker's repo, **no new invite is needed** — hand the
restarted worker its own `room_id`/`member_id` explicitly (don't assume
conversation-resume restored that knowledge; re-stating it costs nothing and removes
a whole class of "why isn't it responding" failures) and have it:

```
chatroom daemon --room <room_id> --as <member_id> --status
```

and start it if it isn't live, then

```
chatroom read --room <room_id> --as <member_id>
```

to catch up on anything sent while it was down.

If no `.chatroom/binding.json` exists yet (this worker was never a member), the
supervisor mints an invite and the worker joins fresh:

```
chatroom invite --room <room_id> --ttl-sec <n>     # run by an existing member
chatroom join <invite-uri> --as <member_id> --yes  # run by the (re)joining worker
```

## The Dedicated Communicator Subagent

The chatroom skill's own mandate (`chatroom/SKILL.md`, section "Dedicated
Communicator Agent Mandate") requires every host to materialize a dedicated,
always-live communicator whose _only_ job is messaging — verified real example
config for this exact repo pairing:

```json
{
  "name": "communicator_resume-writer",
  "role": "Resume Writer Communicator",
  "TypeName": "communicator_resume-writer",
  "Role": "Resume Writer Communicator",
  "instructions": "Sole job: Start daemon, read messages via chat:read, peer delivery, chat:ack. Zero task execution, zero file edits. Verify chat:daemon --status reports LIVE or IDLE at start of turn, repair via chat:doctor --fix otherwise."
}
```

The pattern to hand the restarted worker: name the communicator `communicator_<room-
id>`, role `<Room Title> Communicator`, and give it exactly one job — verify the
daemon, read, deliver to the worker's main loop, acknowledge. It must never edit
files, run tests, run git, or otherwise execute task work; a communicator that does
task work is a communicator that goes deaf exactly when a message matters, which is
the whole failure mode this exists to prevent.

If the restarted worker doesn't already have a live communicator for its room (check
`chatroom daemon --room <room_id> --status` — a dead daemon is often the actual
symptom of "the worker looks resumed but isn't responding to anything"), the first
prompt you inject on relaunch (`references/session-restart.md`'s `-i` flag) is the
right place to ask it to spawn one.

## Verification

After handoff, don't just assume it worked:

1. `chatroom daemon --room <room_id> --as <member_id> --status` should report the
   daemon live (or come back live immediately after you start it).
2. Send a trivial message from the supervisor's side and confirm, via
   `tmux capture-pane`, that the worker's pane visibly reacts to it within a
   reasonable window. A resumed conversation that never acknowledges a nudge usually
   means the daemon didn't actually come back up, not that the message was ignored.
3. If it stays silent, re-check `chatroom doctor --room <room_id> --json` for a
   diagnosable state problem before assuming the worker itself is unhealthy again.

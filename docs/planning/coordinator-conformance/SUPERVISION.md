# Session supervision: keeping the work healthy while nobody is watching

Written 2026-08-21 in response to the owner's observation that this session's own operation is the
very thing the skill exists to automate — waves launched by hand, checked by hand, relaunched by hand.

> "It should work in a way that if I am away from the computer I shouldn't worry about what other
> things are currently implementing or whether the system is healthy or not. The system ideally should
> be self-protecting itself to be healthy and continuing to complete these tasks."

## What is armed

`scratchpad/supervise.sh <workflow-id>...` polls the journals of exactly the workflows it is given,
every 120s, and writes `supervisor-state.json` each pass:

```json
{"checked_at":"…","active":2,"stalled":"","quota_pressure":"","progress":"wf_x:3done:303s …","backoff":120}
```

It exits — waking the main thread — only when every tracked workflow has gone quiet. While work is
progressing it says nothing, so a quiet log means healthy rather than dead.

## The rules it follows

**Quota pressure pauses; it never terminates.** On a rate-limit shape inside an *error* record it
doubles its interval (capped at 1800s) and keeps waiting. Nothing is killed, so every agent's work
stays resumable when tokens refresh. This is the owner's explicit requirement and it matches what the
harness itself already does — `orchestrator/failure-classifier.ts` classes `rate_limit` as
**transient** and retries with exponential backoff plus jitter, *unbounded in count but bounded in
total elapsed time*, precisely because giving up on a task that would have succeeded is the worse
failure.

**Progress resets the backoff.** Pressure that clears returns the loop to its base interval rather
than staying punished.

**A stall is not a death.** A workflow whose journal has not moved in 900s is reported as stalled
while others continue; the supervisor keeps running rather than exiting on the first bad sign.

**Recovery uses resume, not restart.** A workflow that dies is relaunched with
`Workflow({scriptPath, resumeFromRunId})` — every completed agent replays from cache, so only the
failed call and what follows re-runs. Restarting from scratch would discard hours of finished work.

## Two lessons this design encodes

**Test the watchdog before arming it.** An earlier watchdog in this project used
`find -newermt '-8 minutes'`; this machine's `find` is `bfs`, which rejects that syntax, so the check
returned nothing and reported IDLE for an hour while two dozen agents were writing. Every construct
here was dry-run first, on this machine, and two real bugs were caught that way: a `grep -c` fallback
emitting `0\n0` and corrupting the JSON, and completed workflows being misreported as stalled.

**Distinguish a signal from its mention.** A naive scan for quota terms matched 473 agent transcripts
— because agents were *reading* `failure-classifier.ts`, whose source text contains
`RESOURCE_EXHAUSTED` and `rate_limit`. The supervisor only matches those shapes inside an actual
`"type":"error"` record. Counting mentions instead of occurrences is how a monitor invents an
emergency.

## The honest boundary

This supervises work **within a live session**. It cannot survive the session closing — the loop and
the agents both end there. Genuinely unattended multi-hour operation needs the harness's own
heartbeat, which landed today as `orchestrator:supervise --watch` but has never been exercised on a
real run. Until it has, "leave it running overnight" means leaving this session open.

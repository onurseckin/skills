# PHASE 6 — the remote container

## 1. Goal

Make "always running" true instead of aspirational, on a machine the owner controls, with the blast
radius removed rather than forbidden.

## 2. The honest premise this phase exists to fix

**On a laptop, under an in-session scheduler, "runs forever" is false.** `CronCreate` is explicitly
session-only, in-memory, idle-gated and auto-expires after 7 days; `Monitor` dies with the session.
What is true — and genuinely valuable — is **perfect resumption**: the mind picks up exactly where it
stopped whenever a session opens, because the capsule is the mind.

"Always running" becomes true on a container with a systemd timer, or through a durable cloud
routine. That is what this phase builds. Everything before it works without it.

## 3. Work items

---

### W6.1 — The timer and the service

**Files:** `deploy/mind.timer`, `deploy/mind.service` (new).

```
mind.timer     OnUnitInactiveSec=15min   Persistent=yes
mind.service   Type=oneshot
                        ExecStart=/opt/mind/pulse.sh /srv/repo/.capsules/mind-gen-1
                        TimeoutStartSec=<pulse deadline + slack>
                        Restart=no
```

Two settings are load-bearing and must not be "tidied up":

- **`Persistent=yes`** — after a reboot or a suspend the timer fires the missed pulse instead of
  silently skipping to the next slot.
- **`Restart=no`** — a pulse that crashes on a poisoned capsule and is restarted immediately becomes
  an infinite crash loop that burns the entire token budget before dawn. Failure must wait for the
  next timer tick, which **is** the backoff.

The honest floor, for a machine with nothing installed:

```sh
while :; do /opt/mind/pulse.sh /srv/repo/.capsules/mind-gen-1 || true; sleep 900; done
```

under any supervisor that restarts **the wrapper** (never the pulse). It satisfies all four driver
obligations and is worse than the timer only in that a reboot loses it unless the supervisor is
itself persistent.

**Acceptance:** the timer fires after a simulated reboot; a deliberately poisoned capsule produces
exactly one failed pulse per timer interval, not a loop.

---

### W6.2 — Persistence, because `.capsules/` is gitignored

**Files:** deployment documentation, backup script.

`.gitignore:18` excludes `.capsules/`. **The mind capsule does not travel with the repository and is
not backed up by pushing.** On a container it needs its own persistent volume and its own backup, or
the mind is amnesiac on every redeploy.

This is the single most likely way a remote deployment quietly loses its history, and it will not
announce itself — a fresh capsule looks exactly like a working one.

**Also measured, and it will bite:** copying a capsule to a box and running `chmod -R u+w` produced,
verbatim, `INTEGRITY: prompt.md is writable (write mode bits 200)`. Any provisioning path that moves
capsules **must preserve `0444` on `prompt.md`** and on every frozen artifact, or the first pulse
refuses. Use an archive format that preserves modes, and verify with `doctor` after every move.

**Acceptance:** a provisioning dry-run that copies a capsule and passes `doctor` on the far side; a
restore-from-backup drill that produces a capsule whose event head matches the source.

---

### W6.3 — Generational rotation

**Files:** `cli/commands/mind-rotate.ts` (new), built on `orchestrator/capsule-chainer.ts`.

Arithmetic from `PLAN.md` §0.2: `store/constants.ts:38` caps a capsule at 100,000 events and
`store/event-append.ts:45-46` throws `INVALID_STATE` past it. At ~20 events per pulse and a 15-minute
pulse, that ceiling arrives in **about 52 days**. A single "timeless" capsule is arithmetically
impossible; rotation is mandatory.

`mind:rotate` seals generation N and chains N+1, carrying forward: the charter pin, every open and
declined candidate, the pulse counter, the budget day key, and `previousEventHead`.

The head-room **warning** shipped in Phase 1 (`CONTRACTS.md` §1.6). This is the action it points at.

**Acceptance:** rotation at a simulated threshold produces a successor whose declined-candidate set
is intact — gate 6 must keep working across a generation boundary, or last month's rejected idea
returns; the sealed generation stays readable by `doctor` and `summary:view`.

---

### W6.4 — Remove the capability, not just the rule

**Files:** deployment documentation.

> Give the box a repository clone with **no push remote at all**, and let the owner pull from it.

That converts "must never push" from a rule an agent could break into a capability it does not have.
**That single decision is worth more than every prohibition in the never-unattended list.**

The real safety bound is a stack of three and this plan must not pretend it is one (`PLAN.md` §11.4):

1. **The host's own permission system** — the first and most important layer.
2. **The blast radius of the account and machine** — no push credentials on the box, a dedicated key
   with no write access to protected branches, no production credentials present at all, branch
   protection enforced server-side.
3. **The harness rails** — excellent at what they cover (state, evidence, contracts, scopes) and
   irrelevant to what they do not.

`assertGrantedCommand` refuses `plan:compile` from a mind grant. It cannot refuse
`rm -rf /`, because that is not a harness command. **The CLI door constrains harness commands. It
does not constrain a shell.** This has always been true of every existing role too.

**Acceptance:** `git remote -v` on the box lists no push URL; a deliberate push attempt fails at the
git layer, not at a policy layer.

---

### W6.5 — External liveness

**Files:** a ~20-line uptime check, running **off the box**.

It reads `.capsules/mind-gen-1/last_pulse.json` and pages the owner when it is stale.

> Nothing inside a dead system can report that it is dead.

The `GAP` line built in Phase 2 catches a *late* driver from the inside. Only something outside
catches a driver that never fires again.

**Acceptance:** stopping the timer produces a page within one interval plus grace; the check itself
failing is distinguishable from the mind failing.

---

## 4. Check and balance — the 72-hour soak

Four injected failures. After each, **the next pulse must resume without human help, and the ledger
must say what happened**:

| Injection                        | Required outcome                                             |
| :------------------------------- | :------------------------------------------------------------ |
| Kill the pulse mid-flight        | Next wake closes it `crashed`, records the deadline evidence  |
| Reboot the box                   | `Persistent=yes` fires the missed pulse; no gap in the ledger |
| Revoke the token for an hour     | Outcome `paused`, interval multiplied, **nothing killed** —   |
|                                  | leases live, attempts open, worktrees in place, all resumable |
| Fill the disk                    | Refuses to write rather than writing a torn capsule; recovers |

The quota case is the owner's explicit requirement and it already matches the harness's own
behaviour: `orchestrator/failure-classifier.ts` classes `rate_limit`, `network`, `provider_5xx` and
`timeout` as transient and unbounded in count, bounded only by elapsed time, with exponential backoff
and jitter. **Pause, never terminate. Progress clears the multiplier.**

And the detection rule that must not decay: a quota signal is observed **in an error record**, never
in prose an agent happened to read. `SUPERVISION.md` records the exact failure — a naive scan for
quota terms matched 473 agent transcripts, because the agents were reading the source file whose text
contains `RESOURCE_EXHAUSTED` and `rate_limit`. The pulse reports it through
`mind:pulse-close --signal rate_limit` as a typed value. The harness greps nothing.

## 5. Exit criteria

1. The soak ran 72 hours with all four injections, and each produced the required outcome.
2. A rotation happened, or was forced at a lowered threshold, and gate 6 still remembers the
   declined set across the boundary.
3. `git remote -v` shows no push URL.
4. The external liveness check paged when the timer was stopped.
5. A restore-from-backup drill produced a capsule `doctor` accepts.

## 6. Failure modes

| Likely mistake                                        | The tell                                                  |
| :---------------------------------------------------- | :---------------------------------------------------------- |
| `Restart=always` on the service                       | A crash loop burns the night's budget before dawn          |
| `chmod -R u+w` during provisioning                    | `INTEGRITY: prompt.md is writable` on the first pulse      |
| Assuming `.capsules/` is backed up because git is     | A redeploy produces an amnesiac mind that looks healthy    |
| Deploying with push credentials "temporarily"         | The one failure mode with real external cost               |
| A liveness check that runs on the box it checks       | It dies with the thing it was watching                     |
| Two drivers armed at once — cron *and* an in-session loop | The measured `INTEGRITY` race, repeatedly              |
| Verifying an untested host scheduler by assumption    | `PLAN.md` §14.1.6 — test it before any table claims it     |

## 7. Rollback

Stop the timer. The capsule is untouched and the mind resumes from its last closed pulse whenever a
driver fires again — which is the property the whole design was built around, and the one thing that
makes an unattended deployment safe to switch off.

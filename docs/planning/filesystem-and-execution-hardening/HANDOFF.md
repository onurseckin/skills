# Filesystem and Execution Hardening — Handoff

Status: hardening landed, remaining exposure listed below is open.
Range: `9365b5b9..b98d2871` on `main`. Suite at close: 9144 pass / 1 skip / 0 fail across 822 files.

## Why this exists

During an agent run, the working repository at `~/repos/skills` was recursively deleted. It survived
only because the machine diverts recursive deletes to the Trash and the owner restored it by hand.
Everything committed was safe on `origin`; roughly one wave of uncommitted work was lost and later
recovered separately.

This document records what was found, what was changed, what is still open, and — importantly — what
remains **unknown**, so a future reader does not mistake a plausible story for a determined cause.

## The cause was not determined

State this plainly rather than inheriting a guess.

Ruled out with evidence:

- **Not an agent shell command.** All 180 session transcripts were searched. Every `rm -rf` targets a
  relative `.tmp/` or `.olt/capsules/` path, or runs after a `cd` into scratch.
- **Not the in-flight feature work.** That diff adds zero `rmSync`, `spawnSync`, or `execSync`.
- One promising lead — `rm -rf ..` appearing in transcripts — turned out to be an attacker agent's own
  decoy `hooks.json` payloads under `.tmp/ATTACK/`, written _after_ the incident, with `cwd` pinned
  inside the decoy tree. Do not re-chase it.

The one hard constraint the evidence gives:

> The repository reached the Trash. The `rm` → `rmtrash` diversion is a shell alias, loaded from the
> user profile. In-process `rmSync` is a syscall and never sees it. `sh -c` does not load the rc file
> either — verified: interactive `type rm` reports the alias, `sh -c 'command -v rm'` reports `/bin/rm`.
> So the delete came from a profile-loading shell, and anything the harness runs via `sh -c` or `rmSync`
> would have destroyed it **permanently** instead.

That last point is the operationally important one: **the machine's safety net does not cover the
harness.** It covers an interactive shell only.

## The governing defect shape

One pattern accounts for most of what was found, across unrelated subsystems:

> **A control that fails open when its input is absent or unrecognized.**
> The check is skipped exactly when it cannot be satisfied, so supplying nothing beats supplying
> something wrong, and being unregistered beats being registered.

Instances found and fixed (each was load-bearing):

1. Screenshot coverage accepted files it never opened — an unreadable path hit `continue`.
2. The authority gate ran only when a role resolved, so an ungranted actor skipped it entirely.
3. `agent:register` was bootstrap-exempt whenever the caller omitted every identity flag.
4. `assertAgentRegisterHierarchy` did `if (childTier > 1) return;` where a `throw` belonged.
5. Session files were trusted as verified merely by existing at a predictable, writable path.
6. An empty declared `spawns: []` was read as "no list to narrow against" rather than "spawn nothing".
7. A binding check guarded on `agentId !== undefined`, so omitting `--actor` skipped it while a _wrong_
   `--actor` was correctly refused.
8. A denylist over shell command text — permitting everything it failed to recognize.
9. `resolveSkillHomeRepo` consulted a global config file **before** the caller's own argument, so a
   general default overrode a specific input.

**The rule to apply:** when a check cannot be performed, it must **deny**, not skip. An absent input is
not a pass. An unreadable file is not a valid file. An unresolvable reference is not an absent
constraint. A caught exception in a validator is not a clean bill of health.

## What was hardened

### 1. Destructive filesystem calls

`olt/scripts/src/core/shared/safe-fs.ts` — one containment module all destructive calls route through.
Exports `safeRmSync`, `safeRenameSync`, `safeCpSync`, `safeWriteFileSync`, `safeMkdirSync`,
`assertSafeToDelete`.

Rules enforced:

- **Repository interlock** — refuses to recursively delete any directory containing a `.git`, or with a
  `.git` in an ancestor up to the allowed root, unless an explicitly named override is passed. This
  single rule would have prevented the incident.
- **Containment** — the target must be _strictly inside_ an allowed root; the root itself, an ancestor,
  or a sibling are all refused. Trailing-separator comparison, so `/a/bc` is not "inside" `/a/b`.
- **Symlink escape** — the target's parent chain is `realpath`'d before the containment test, but the
  final component is never resolved, so deleting a symlink deletes the link and not its target.
- **Absolute denylist** — `/`, home, direct children of home, paths under three segments, the cwd, and
  any ancestor of the cwd. Independent of `allowedRoots`.
- **Never swallows** — every refusal throws `HarnessError("PATH_SAFETY", …)` naming the target, the
  rule, and the allowed roots. Only an explicit `missingOk` tolerates absence, and containment still
  fires first.

Enforced going forward by `tests/unit/architecture/destructive-fs-guard.test.ts`, which forbids direct
`rmSync({recursive: true})` outside the guard module.

**It caught a real problem on its first production push.** The skill-sync's legacy-purge step was
recursively deleting directories inside `~/.agents/skills` and `~/.codex/vendor_imports/skills` — both
git checkouts, the first a clone of this very repository. It had been doing so on every push, with every
error swallowed by the old `safeRemove`'s empty `catch {}`.

### 2. Root resolution — stop guessing

- `resolveSkillHomeRepo` precedence inverted: an explicitly supplied `currentRepoRoot` now wins over the
  global `~/.agents/skills/olt/skill-config.json`. Previously that config — which contains an absolute
  path to this repo — was consulted first, so harness code running in **any** repository resolved "the
  skill home repo" to this one. A sibling repo carries a stray artifact from exactly that misfire.
- The two divergent `findRepoRoot` implementations were consolidated, and the no-anchor case now throws
  instead of falling back to `process.cwd()`. A guessed root feeding a recursive delete is the whole
  failure mode.

### 3. Arbitrary command execution

A guarded `rmSync` is worth little if the harness will run any shell string an agent writes into a
config file. Four separate shell-execution paths existed:

- **Hook dispatcher** (`olt/scripts/src/hooks/dispatcher.ts`) — now requires `commandArgv` as an argv
  array, spawned with `shell: false`, against `ALLOWED_SHELL_EXECUTABLES` resolved to trusted absolute
  paths (it refuses to fall back to a PATH lookup). Audio is a declared action type with a validated
  file path, not a shell string. The old denylist is kept only as a redundant second layer.
- **Gate proof** (`olt/scripts/src/graph/gate-proof.ts`) — the compound-shell path
  (`argv.join(" ")` into `/bin/sh -c` when argv contained `&&`, `||`, or `;`) is removed. Gate commands
  are plain argv. Separately, `node_modules` is now **copied** into the proof sandbox rather than
  symlinked to the real repository, closing a live write-through door out of the sandbox.
- **Completion audio** (`olt/scripts/src/orchestrator/completion-audio.ts`) — an independent
  `spawnSync("sh", ["-c", command])` that no lane owned, because no lane owned `orchestrator/`. Now
  argv-only against an allowlist of audio players, with an injectable player for tests.
- **DAG snapshot telemetry** (`olt/scripts/src/telemetry/dag-snapshot.ts`) — `execSync`, which _always_
  spawns through `/bin/sh`. The argument was a hardcoded literal with no interpolation, so nothing was
  injectable, but it was still a shell and it would have become a real hazard the moment a variable was
  interpolated into it. Now `spawnSync("git", ["status", "--porcelain"], { shell: false })`.

The main command runner used by `run:exec` and `shell` was never a shell path: it goes through
`Bun.spawn({ cmd: argv })`, argv-only.

**There are now zero shell-execution paths in harness source**, enforced by
`tests/unit/architecture/shell-execution-guard.test.ts`, which scans `olt/scripts/src` and `scripts` for
`execSync`, `shell: true`, `/bin/sh`, `sh -c`, and `Bun.$`. It carries its own falsification test proving
the scan detects a real shell invocation and does not flag argv spawning, `can_execute_shell` permission
flags, or comments.

### 4. Authority

- `agent:register` hierarchy bypass closed: naming `--parent-agent X` now requires the acting identity
  to _be_ X, and omitting the identity no longer skips the check.
- Genesis is `ledger.length === 0`, not "no _active_ entries" — previously, releasing the sole grant
  flipped a used run back to genesis.
- The declared `spawns:` allowlist is enforced at `registerAgentGrant`, i.e. at the state-mutation
  layer, not only at the CLI pre-check.
- `gate:prove` removed from the "acting flag is a display filter, not an identity" exemption set. It sat
  beside six genuinely read-only commands but **mutates state** — it appends the `gate-proved` evidence
  record that plan-audit trusts as proof a gate is discriminating. Any caller with zero grants could
  inject a forged `falsifiable: true` verdict attributed to any actor.

### 5. Truthfulness of reports

- Telemetry collectors no longer emit raw OAuth tokens, API-key file contents, or account PII into
  command output. Redaction moved to an allowlist of report fields, with the denylist retained as a
  second layer.
- Unmeasured quota is now a distinct "unknown" rather than a hardcoded `100`, which previously rendered
  as a full green bar indistinguishable from a real measurement.

## Remaining exposure — open

Stated as the lanes reported it, not softened.

1. **Nothing constrains who may plant a `hooks.json`.** This work hardened what a planted hook is
   allowed to _do_, not who may write one. `resolveHookConfigFile` still scans
   `.olt/capsules/hooks.json`, `.capsules/hooks.json`, `olt/hooks.json`, and a bare `hooks.json` in the
   cwd, with no provenance check. Closing this is filesystem-write containment, a different problem.
2. **`gate-proof.ts` is not a self-contained sandbox.** Removing its shell path closed its own escape,
   but argv path-safety is validated only at `plan:compile` time (`gate-argv-policy.ts`,
   `gate-command-policy.ts`). A caller constructing a `GateProveInput` directly — as its own unit tests
   deliberately do — gets none of that protection.
3. **Hook children still inherit the full `process.env`.** Harmless while the allowlist is
   `echo/printf/pwd/date`, none of which can dump their environment. It becomes a live secrets exposure
   the moment that list widens to anything that can.
4. **`node_modules/.bin` symlinks are dropped** from the gate sandbox now that `node_modules` is copied.
   No gate in this repo invokes tools by literal `node_modules/.bin/<tool>` path today; one that did
   would fail loudly with `ENOENT` rather than silently.
5. **The `commandContainsRecursiveDelete` tokenizer is not a shell parser.** Adequate as a redundant
   layer behind a narrow allowlist; it had these gaps when it was the primary control, and would again:
   `rm -r x` (recursive without `-f` — it requires both), `find . -delete`, `git clean -xfd`,
   `python3 -c "shutil.rmtree(...)"`, `node -e "fs.rmSync(...)"`, `$(echo rm) -rf x`, `r""m -rf x`.
6. **Windows hook execution is unchanged and untested.**
7. Several large files under `packets/`, `authority/`, and `workflow/agents/` got a lighter fail-open
   pass than the rest and could still hide an instance.

## If you widen an allowlist, re-attack it

The allowlists above are narrow on purpose. Before adding an entry, ask whether that program can execute
arbitrary code — `git` (`-c core.pager`, aliases, `exec`), `find -exec`, `xargs`, `env`, `sed -e w`, and
any package-runner script all can. An allowlist entry that shells out is a denylist again.

## Verifying this still holds

```
bun run test                    # full suite; 9144 pass / 1 skip / 0 fail at close
bun run typecheck
bun scripts/testing/test-runner.ts tests/unit/architecture/destructive-fs-guard.test.ts
bun scripts/testing/test-runner.ts tests/unit/architecture/shell-execution-guard.test.ts
bun scripts/testing/test-runner.ts tests/unit/core/safe-fs.test.ts
bun scripts/testing/test-runner.ts tests/unit/hooks tests/unit/graph tests/unit/packets
```

A push exercising the sync hook may print `REPOSITORY_INTERLOCK` refusals. That is the guard working
correctly on the legacy purge step; the sync degrades gracefully and the push proceeds. Treat it as a
failure only if the push itself is rejected.

## Method note

The findings above came from adversarial verification, not from implementer self-reports. Each claimed
security fix was handed to an independent agent instructed to _refute_ it — reproduce the original
bypass, then hunt for the same fail-open shape reintroduced by the fix. Seven of the first round's fixes
came back refuted and went to a repair stage before landing.

Two behaviours worth preserving in future work:

- A lane that found the `gate:prove` hole **built the fix, verified it, then reverted it** because it
  broke tests outside its write scope, and reported that instead of reaching across lanes or claiming a
  clean sweep. The sweep stage then applied it properly.
- A sweep stage **refused** a lane's request to add an authority-code allowlist that would have made a
  test pass, on the grounds that a data-only fix already satisfied every test without weakening a
  control.

Self-reported green is worth very little here. Ask for the command that was run and the output observed.

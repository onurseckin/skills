# Capsule and state model

## Run directory

```text
.capsules/<run>/
├── prompt.md             immutable original bytes, mode 0444
├── manifest.json         assurance, prompt digest, pinned runtime digest
├── state.json            canonical current projection
├── events.jsonl          canonical append-only hash chain
├── runtime/              copied Bun/TypeScript entrypoint and modules
├── planning/             planner-created requirements.json and graph.json before apply
├── packets/              immutable role packets and metadata
├── commands/             aggregate command records, attempts, logs, activity
├── evidence/             scoped artifacts and validation receipts
├── findings/             exported open/resolved findings
└── handoff.md            deterministic restart document
```

`state.json` can be reconstructed only from complete valid events. A torn final event is preserved
for diagnosis and excluded from recovery; a corrupt complete event is an integrity failure. Empty
history cannot fabricate state.

Before the first plan applies, `planner-0` is already published and the graph is intentionally
absent. `handoff.md` renders this as `Graph revision: not-applied` and includes the planner packet
record plus exact packet-recovery, validation, and revision-zero apply argv. This pre-plan capsule is
a valid takeover point; do not require a graph before resuming the planner.

## Task states

```text
proposed → ready → leased → running → submitted → validating → validated → gating → done
                         ↘ stale/retry_ready      ↘ changes_requested → repair lease
                                                   ↘ escalated after bounded rejection
```

- Dependencies must be `done` before a task becomes ready/claimable.
- A lease binds agent, role, attempt, scopes, duration, token digest, issuance, heartbeat, and expiry.
- Only a valid token may heartbeat, release, or submit. Tokens are returned once, kept only in the
  host-native dispatch channel, and never persisted in packets, status, or handoff. A lost token is
  not recoverable from its digest: wait for expiry, run `recover`, and issue a new authorization.
  Expired valid-token evidence is quarantined.
- Validation uses a distinct tokenized identity; implementers and prior validators cannot validate
  the same task round.
- `changes_requested` preserves the frozen contract and structured findings. Repair cannot self-close
  findings.
- `done` requires a report, passing independent validation, no open findings, and every applicable
  mandatory gate.
- A `needs_authority` requirement remains paused until one digest-bound `grant` or `decline`
  decision is appended. Grants make it executable; declines dispose it without fabricated evidence
  and cancel only tasks whose requirements are all disposed.
- Orphan evidence is immutable. A separate audited disposition (`rejected`, `superseded`, or
  `ignored_non_authoritative`) closes the blocker without deleting or adopting the late report.

The default task lease is 1,200 seconds; heartbeats move its expiry forward by the configured lease
duration. Validation and completeness-critic authorizations have 1,200-second deadlines. Recovery
uses a 30-second grace by default for task leases and critics, while validation returns to
`submitted` at its deadline. Operators may choose `recover --grace-seconds 0` only after inspecting
durable time/deadline evidence; recovery does not bypass a live authorization.

## Run completion blockers

- prompt/manifest/runtime/state/event/graph integrity issue;
- undisposed prompt line or unsatisfied/unevidenced requirement;
- task not `done`, live/stale lease, active validation, or orphan evidence without disposition;
- open finding or exhausted repair not explicitly escalated;
- missing, skipped, failed, mismatched, or unassociated mandatory command/gate;
- missing or failing completeness-critic approval;
- running command intent or a stale/expired completeness-critic authorization;
- installed/runtime drift that prevents deterministic takeover.

## Repository identity boundary

Mandatory command records name this boundary as `trusted_host_observed_v1` and report
`sandboxed: false`. The trusted boundary includes the local OS user, host-selected toolchain, and
transitive processes. The host or coding application may impose a sandbox, but the harness neither
configures nor attests it. A same-user mutate → execute → restore sequence completed between the two
repository scans is outside the threat model. This is observation evidence, not hermetic, sealed,
reproducible-build, sandboxed, or complete inferred-closure evidence.

Completion binds two matching full scans of every Git-tracked and nonignored untracked node outside
`.git` and `.capsules`. Regular files bind bytes, type, mode, and staged metadata. Symbolic links bind
their link-target bytes and are never followed; symbolic ancestors and unstable component identities
fail closed. Non-regular, non-symlink leaves are rejected before open; regular leaves are opened
nonblocking and no-follow, then required by descriptor inspection to remain regular. The stable
identity also binds bounded Git HEAD, symbolic ref, index, and porcelain-v2 status evidence.

Before every packet Git spawn, a bounded nonblocking/no-follow preflight checks only the direct
worktree `.git` node, linked-worktree `gitdir`/`commondir` linkage, local config files, and local
info attributes/excludes. It deliberately does not recursively traverse objects, refs, or the
index. Those and all other Git reads are instead bounded by a 15-second `spawnSync` timeout that
sends `SIGKILL` only to the spawned Git child, never a process group, ancestor, or unrelated
process. A timeout is reported as operational `INVALID_STATE`; unsafe local controls remain
`INTEGRITY` failures.

Every staged, untracked, injected, or directory-derived path is validated before node traversal.
The shared `harness.repository-content-scan-policy` version 1 defaults cap a path at 4,096 UTF-8
bytes and 128 components, alongside the existing file-count and byte caps. Invalid overrides or a
limit breach fail closed, and the resolved versioned policy is hashed into the content identity.

Gitlink (`160000`) and submodule nodes are intentionally unsupported whether uninitialized,
initialized, clean, or dirty. The runtime cannot prove both the superproject index OID and an
initialized submodule's recursive dirty state within the current repository contract, so inspection
fails with `repository gitlink/submodule nodes are unsupported: <path>` instead of encoding the node
as missing, omitting it, or traversing it. Flatten or remove gitlinks before starting a harness run;
never bypass this blocker with a manual digest.

Gate attachment requires the current assurance label and matching non-null before/after repository
bindings. Completion, while holding the workflow lock, captures the live repository binding and
requires every mandatory gate's `repository_after` to match it. Process ownership and host-ancestor
protection remain independently fail closed before signaling and are not weakened by a matching
repository observation.

## Lock and crash behavior

The POSIX kernel `flock` on the opened lock-file inode is authoritative. Observer metadata is only
diagnostic. Replacing or renaming the visible lock path never authorizes a second writer; missing
ownership fails closed. State writes use temp file → mode → file fsync → rename → directory fsync.
Events fsync before the projection is replaced. Recovery is explicit and event-derived.

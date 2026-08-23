# Capsule and state model

## Run directory

```text
.olt/capsules/<run>/
├── prompt.md             immutable original bytes, mode 0444
├── README.md             generated layout note: one line per entry and what it is for
├── manifest.json         assurance, prompt digest, capture mode, runtime version
├── state.json            canonical current projection
├── events.jsonl          canonical append-only hash chain
├── index.json            derived catalogue of tasks, commands, findings, reports, captures, blobs
├── trace.md              derived step trace, one row per recorded event
├── handoff.md            derived restart document, mode 0444
├── captures.json         capture ledger: every stored blob, its readable name, and its owner
├── planning/             requirements.json, graph.json, and the enhanced plan document
├── packets/              immutable role packets: <packet-id>/packet.md and metadata.json
├── commands/             aggregate command records, attempts, logs, activity
├── blobs/                <aa>/<sha256>: the one physical home for every captured byte-blob
├── evidence/             readable names hardlinked onto blobs/; holds no bytes of its own
├── reports/              submission, review, and critic report records
├── quarantine/           event-log fragments removed by recovery, kept byte for byte
└── summary/              graph.json, timeline.json, metrics.json, summary.md
```

`plan:init` creates the capsule with `prompt.md`, `manifest.json`, `state.json`, `events.jsonl`,
`README.md`, `index.json`, `trace.md` and the `planning/`, `commands/`, `blobs/`, `evidence/` and
`reports/` directories. `captures.json` appears with the first capture, `packets/` when the first
role packet is published, `quarantine/` when recovery removes a fragment, and `summary/` when
`summary:export` runs. `handoff.md` is
rewritten at every task submission, at the escalation that ends the repair budget, and at
`run:complete`: the three points where a run changes hands. It is derived, so it is regenerated
rather than amended, and it is never evidence of anything.

`state.json` can be reconstructed only from complete valid events. A torn final event is preserved
for diagnosis and excluded from recovery; a corrupt complete event is an integrity failure. Empty
history cannot fabricate state.

Every key below is optional. A capsule written before a ledger existed simply has none, which is an
empty ledger and not a defect. A key that is present but malformed can only come from a hand-edited
state file, so it is an `INTEGRITY` failure rather than something to repair silently.

## Task states

```text
proposed → ready → leased → running → submitted → validating → validated → gating → done
                   ↑           ↓                      ↓
                   │        branched              (probe: stays in validating)
                   │           ↓                      ↓
                   │       (collect) ─────────► changes_requested → repair lease
                   │                                  ↓
             retry_ready ◄── lease expired      escalated after max_repair_rounds
```

- `ready` becomes `leased` through `task:claim` or `queue:pop`; the first `task:heartbeat` moves it
  to `running`.
- `branched` is reached from a live lease through `branch:open` and left through `branch:collect` or
  `branch:abandon`, both of which return the task to `running`. It is not terminal and not idle: the
  agent is alive and blocked on children.
- A probe is not a state change. `task:probe` leaves the task in `validating` under the same
  validator and increments `probe_round` only.
- `task:reject` and `task:review --status fail` move the task to `changes_requested` and increment
  `repair_round`; the round that reaches `max_repair_rounds` lands in `escalated` instead.
- An expired lease returns the task to `retry_ready`, or to `changes_requested` when the expired
  attempt was a repair. `task:release` does the same thing voluntarily, with the live token.
- `cancelled` is reached only when every mapped requirement was disposed by an audited decline.

Rules that hold across the machine:

- Dependencies must be `done` before a task becomes ready/claimable.
- A lease binds agent, role, attempt, scopes, duration, token digest, issuance, heartbeat, and expiry.
  `task:claim --role` must be `implementer` for a ready or retry-ready task and `repairer` for one in
  `changes_requested`, and a repair returns only to the recorded repair assignee.
- Only a valid token may heartbeat, release, or submit. Tokens are returned once, kept only in the
  host-native dispatch channel, and never persisted in packets, status, reports, or handoff. A lost
  token is not recoverable from its digest: wait for expiry, run `recover`, and issue a new
  authorization. Expired valid-token evidence is quarantined as orphan evidence.
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

The default task lease is 1,200 seconds; heartbeats move its expiry forward by the lease's own
recorded duration. Validation and completeness-critic authorizations have 1,200-second deadlines.
`recover` uses a 30-second grace by default for task leases, branch sub-leases and critics, while an
interrupted validation returns to `submitted` at its deadline. Operators may choose
`recover --grace-seconds 0` only after inspecting durable time/deadline evidence; recovery does not
bypass a live authorization.

## Lease suspension

A lease carries `suspended_at` while its holder is blocked on a branch. Suspension freezes the
expiry clock: `leaseIsExpired` reports a suspended lease as live, so `recover` never reaps a parent
that is waiting on children rather than dead. `branch:collect` and `branch:abandon` clear the stamp
and restore the lease with a **fresh** full window rather than the remainder that was left when it
froze, because the holder is being handed the work back and needs time to finish it.

A frozen lease is exempt from expiry only while the branch beneath it is moving. See
[failure-modes.md](failure-modes.md) for how chain recovery reclaims a chain whose middle died.

## `state.branches` — the branch ledger

A branch is an execution-time subdivision discovered by a working agent. It is deliberately not a
plan task, so it never touches the plan revision and never fights the frozen task contract.

```ts
interface BranchRecord {
  id: string; // B-<uuid>
  parent_task_id: string; // a plan task, or another branch's sub-task
  parent_agent_id: string;
  reason: string; // why the work had to be subdivided; rendered in the graph
  depth: number; // 1 at the first level; max_branch_depth is an escalation tripwire
  sub_tasks: BranchSubTask[];
  status: "open" | "collecting" | "collected" | "abandoned";
  opened_at: string;
  collected_at?: string;
  abandoned_at?: string;
  outcome_summary?: string;
  files_changed?: Evidenced<string[]>; // harness_observed, measured at collect time
  opened_observation?: BranchRepositoryObservation;
  collected_observation?: BranchRepositoryObservation;
}
```

A sub-task runs `open → claimed → submitted`, with `abandoned` as its failure terminal and
`branched` as the mirror of the parent status when the sub-agent opens a branch of its own. Only
`submitted` and `abandoned` count as terminal for collection, so `branch:collect` refuses while any
sub-task is still live.

Sub-task write scopes must sit inside the parent scope and stay disjoint from their siblings; a
violation is refused, never trimmed. `files_changed` comes from a Git observation of the worktree
delta across the branch window. When the repository cannot be observed, `git_available` is `false`
and the file list stays **absent** rather than becoming an empty one.

An open or collecting branch blocks run completion: an uncollected branch means a working agent is
still waiting on children it never took back, whatever the plan tasks say.

## `state.agents` — the grant ledger

Spawning happens host-side. `agent:register` is how the run learns a subagent exists, and it mints
the grant that later ties every event `actor` back to a role and a parent.

```ts
interface AgentGrantRecord {
  id: string;
  role: AgentRole; // one of the nine canonical roles
  parent_agent_id: null | string; // null for the root
  parent_task_id: null | string; // a plan task or a branch sub-task
  host: string;
  granted_at: string;
  status: "active" | "released";
  released_at?: string;
  release_reason?: string;
  provider?: Evidenced<string>; // agent_reported, or absent
  model?: Evidenced<string>; // agent_reported, or absent — never parsed or matched against
  model_tier?: Evidenced<AgentModelTier>; // agent_reported, or absent — never inferred from model
  thinking_level?: Evidenced<ThinkingLevel>; // agent_reported, or absent
  context_window?: Evidenced<number>; // agent_reported, or absent
  tools_granted?: Evidenced<AgentToolRef[]>;
  tools_used?: AgentToolUse[];
  tokens_in?: Evidenced<number>; // agent_reported, or derived + is_estimated
  tokens_out?: Evidenced<number>; // agent_reported, or derived + is_estimated
  token_extras?: Record<string, Evidenced<number>>; // provider-specific counters, same rule
  last_reported_at?: string;
  report_count?: number;
}
```

Every telemetry field above is `agent_reported`: it arrived as free-text CLI input from whichever
process called the harness, indistinguishable from any other flag. `host_reported` is a defined
evidence class but no current code path assigns it to an agent grant field — a value the harness
independently confirmed off the host's own config or transcript earns `derived` or
`harness_observed` instead, and only ever fills a field with no explicit report already on it (see
[`protocol.md`](protocol.md)).

The parent must already hold a grant, which is what makes lineage a chain rather than a claim; an
unregistered parent is refused rather than recorded as a dangling reference, a duplicate agent id is
refused, and registration stops once the run's configured agent budget is spent.
`agent:report` replaces the running token totals and appends newly reported tools;
`--tokens-estimated` records them as `derived` estimates instead of measurements. `agent:release`
closes the grant, after which the agent can no longer report.

Every telemetry field is optional and stays absent unless the host supplied it. Nothing is inferred
from the machine doing the exporting: a model, tier or thinking level the host never reported is
absent in state and renders as "unknown".

## `state.topology` — the recorded parallelism decision

`plan:compile` runs the scheduler once and writes what it decided, so every later reader agrees.

```ts
interface TopologyRecord {
  revision: number;
  waves: Array<{ wave: number; task_ids: string[] }>;
  decisions: Array<{
    task_id: string;
    wave: number;
    parallel_with: string[];
    serialized_after: string[];
    reason: "dependency" | "write_scope_conflict" | "priority_capacity";
    rationale: string;
    evidence_class: EvidenceClass; // agent_reported when a coordinator supplied the sentence
  }>;
  max_parallel: number; // from config, never hardcoded
}
```

`queue:wave` annotates each task with the wave recorded here, and the summary step calculator reads
this record instead of re-deriving waves. A capsule with no topology reports the absence rather than
defaulting: the wave numbers are then `derived` estimates and say so.

## `state.planning` — the enhanced plan digest

`plan:enhance` writes `planning/enhanced-plan.md` and `planning/enhanced-plan.json` read-only and
records `enhanced_plan` with both digests, the revision, the actor, the counts, and
`evidence_class: "agent_reported"`. The harness reads no repository and asks no model for this
document: every entry arrived through a flag, so the strongest thing that can be said about it is
that an agent claimed it.

The document is explicitly derived. `prompt.md` stays immutable and authoritative, and requirements
keep binding to the raw prompt digest.

## Summary output — one home per fact

`summary:export` writes `graph.json`, `timeline.json`, `metrics.json` and `summary.md` under
`<run>/summary`, and they obey the same discipline as the state they are rendered from:

- A validator is its own node (`kind: "agent"`, `metadata.role: "validator"`), never fused into the
  gate it ran.
- Branch sub-agents are their own nodes, grouped by a section carrying the recorded branch reason,
  so the subdivision is visible rather than inferred from ids.
- `node.assets` is the single canonical home for evidence. A node carries only assets produced by
  commands scoped to that node; no other field duplicates them.
- `node.stateTransitions`, `node.tools` and `node.scripts` each carry their own `evidence_class`, so
  a harness observation and an agent's claim are never rendered as the same kind of fact.

## Run completion blockers

- prompt/manifest/state/event/graph integrity issue;
- undisposed prompt line or unsatisfied/unevidenced requirement;
- task not `done`, live/stale lease, active validation, or orphan evidence without disposition;
- an open or collecting branch that was never collected;
- open finding or exhausted repair not explicitly escalated;
- missing, skipped, failed, mismatched, or unassociated mandatory command/gate;
- missing or failing completeness-critic approval, or a requirement the critic recorded `unproven`;
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

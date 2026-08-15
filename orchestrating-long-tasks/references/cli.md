# Pinned runtime CLI

Always run post-initialization commands with `orchestrating-long-tasks/scripts/harness.ts`. Every successful
process emits one JSON object to stdout; errors emit one structured object to stderr and a stable
nonzero exit. Mutation commands require a recorded actor/agent identity.

## Capture and planning

```text
bun <installed>/scripts/harness.ts init --repo <repo> --run-id <slug> \
  --prompt-file <file> --capture-mode file --source-verified
bun <pinned> packet --run <run> --role planner --agent planner --id planner-0
bun <pinned> inspect-repository --run <run> --actor <planner> --phase current
bun <pinned> validate --run <run> --requirements <requirements.json> --graph <graph.json>
bun <pinned> plan-apply --run <run> --requirements <requirements.json> --graph <graph.json> \
  --expected-revision <n> --actor <planner>
bun <pinned> ready --run <run> --max-parallel <n>
bun <pinned> schedule --run <run> --max-parallel <n> --actor <coordinator>
```

`init` records the baseline inspection and publishes `planner-0`. The planner packet command is an
idempotent recovery operation for a crash after capsule creation. `--expected-revision` is the
current graph revision (zero before the first plan), not the global event/state revision.

The successful `init` object contains `run_root`, `manifest`, `ignore_assurance`, and
`planner_packet`. Dispatch the file named by `planner_packet` before writing the plan. It binds the
complete prompt, capture manifest, baseline repository inspection, revision zero, exact planning
write scope, and exact `validate`/`plan-apply` argv. If the host stops before `plan-apply`, recover
without conversation history:

```text
bun <pinned> status --run <run>
bun <pinned> doctor --run <run>
bun <pinned> handoff --run <run>
bun <pinned> packet --run <run> --role planner --agent planner --id planner-0
```

The pre-plan handoff reports `Graph revision: not-applied`, the `planner-0` record, and literal next
argv. The packet call is an exact idempotent retry: use the durable `planner` identity, no `--task`,
no `--token`, and no different packet ID. Validate any partial planning files before applying them;
the first apply still uses `--expected-revision 0`.

Use `--prompt-stdin --capture-mode stdin --source-verified` instead of the file form only when stdin
is the direct complete source; never provide both sources. A context-transcribed capture must use
`--capture-mode verbatim_context_copy` without `--source-verified`.

## Work and validation

```text
bun <pinned> claim --run <run> --task <id> --agent <id> --role implementer
bun <pinned> heartbeat --run <run> --task <id> --agent <id> --token <secret>
bun <pinned> packet --run <run> --task <id> --role <role> --agent <id> --token <secret> \
  --id <packet-id>
bun <pinned> submit --run <run> --task <id> --agent <id> --token <secret> --report <json>
bun <pinned> begin-validation --run <run> --task <id> --validator <id>
bun <pinned> review --run <run> --task <id> --validator <id> --token <secret> --review <json>
bun <pinned> release --run <run> --task <id> --agent <id> --token <secret>
bun <pinned> assign-repairer --run <run> --task <id> --repairer <fresh-id> \
  --reason <unavailable|stale|repeated_failure> --evidence <recorded-evidence> --actor <coordinator>
bun <pinned> decide-authority --run <run> --requirement <id> --actor <coordinator> \
  --decision <grant|decline> --rationale <recorded-user-decision>
```

Tokens are returned once by `claim`, `begin-validation`, and `begin-critic`, then delivered through
the host-native dispatch channel. Packet Markdown/metadata, handoff, status, and Git never contain
plaintext bearer tokens. The returned `token` is a host-only capability: do not write it to a
packet, report, evidence file, shell history, chat-visible status, or repository path. Only its
digest is durable, and that digest cannot recreate the token.

If a token is lost, do not retry the protected mutation with a guessed or recovered value. Wait for
the recorded authorization deadline, then run:

```text
bun <pinned> recover --run <run> --actor <coordinator> --grace-seconds 0
```

Use zero grace only after `status`/`handoff` proves that the relevant deadline has passed. The
default claim lease is 1,200 seconds and may be shortened with `claim --lease-seconds
<5..86400>`. A heartbeat extends it by the same duration. `recover` defaults to a 30-second grace
for task leases and completeness critics; expired implementation leases become `retry_ready`,
expired repair leases return to `changes_requested`, expired validations return to `submitted`, and
expired critic authorizations become `expired`. Then call `claim`, `begin-validation`, or
`begin-critic` again as appropriate and deliver the newly returned token. `recover` never reveals or
reissues the lost token.

## Commands, gates, and recovery

```text
bun <pinned> run --run <run> --actor <id> [--task <id>] [--gate <id>] \
  --cwd <repo> --wall-ms <n> --idle-ms <n> [--idempotent --retries <n>] -- <literal argv...>
bun <pinned> gate --run <run> --task <id> --gate <id> --command-id <id> --actor <id>
bun <pinned> finish --run <run> --task <id> --actor <id>
bun <pinned> recover --run <run> --actor <id>
bun <pinned> projection-recover --run <run> --actor <id>
bun <pinned> disposition-orphan --run <run> --actor <id> --disposition <json>
```

`run` never invokes a shell. Only declared idempotent transient failures can retry. Gate attachment
checks command fingerprint, success, task association, gate association, and the current
`trusted_host_observed_v1` record. A terminal mandatory gate requires matching non-null
`repository_before` and `repository_after` observations. `complete` compares each mandatory gate's
post-observation to a live repository binding captured while the completion transaction holds the
workflow lock.

This assurance is always reported as
`{"assurance":"trusted_host_observed_v1","sandboxed":false,"trusted_boundary":"local OS user, host-selected toolchain and transitive processes"}`.
The host or coding application may add a sandbox, but the harness neither configures nor attests
it. Same-user mutate → execute → restore entirely between repository observations is outside the
threat model. The record is not hermetic, sealed, reproducible-build evidence, sandboxed, or a
complete inferred input closure. Process ownership and host-ancestor checks remain independently
fail closed before signaling.

Packet Git subprocesses use the same restricted command seam as Git gates. It fixes a
noninteractive pager, disables hooks, pathname fsmonitor, and replacement objects, and prevents
external diff or text conversion. Repository-local `diff.external`, `diff.*.textconv`, executable
`filter.*.clean`, `filter.*.smudge`, `filter.*.process`, and active `core.fsmonitor` are rejected
before status. For the two accepted diff checks, the recorded argv remains the exact graph
command and fingerprint authority while execution deterministically adds `--no-ext-diff`,
`--no-textconv`, and the canonical restricted Git configuration. The bounded `execution_argv` field
persists that exact child form and is independently reconstructed during record verification.

The orphan-disposition JSON must contain the immutable orphan digest, one terminal decision,
substantive rationale, and direct evidence:

```json
{
  "orphan_sha256": "<sha256 from status/handoff>",
  "disposition": "rejected|superseded|ignored_non_authoritative",
  "rationale": "why this late result cannot mutate current task state",
  "evidence": [{ "reference": "event-or-command-id" }]
}
```

Obtain the digest from `status.orphan_evidence[]` (or the matching handoff entry), whose public
shape is `{ "orphan_sha256": "<sha256>", "evidence": { ...immutable late report... } }`. Use
`rejected` when the evidence is invalid or fails its contract, `superseded` when a later
authoritative attempt replaces it, and `ignored_non_authoritative` when it is retained for audit but
cannot affect active state. The successful command returns `{ "run_root": "...", "disposition":
{ ... } }`; the stored object adds `actor`, `decided_at`, and `disposition_sha256`. Never delete or
adopt the original late report.

## Authority decisions

An obligation needing new user authority remains an atomic planned requirement with
`disposition: "needs_authority"`. Record the user's decision before dispatch:

```text
bun <pinned> decide-authority --run <run> --requirement <id> --actor <coordinator> \
  --decision <grant|decline> --rationale <recorded-user-decision>
```

The successful object is `{ "run_root": "...", "requirement": { ... } }`. The requirement keeps
its immutable planned `disposition`, gains `authority_status: "granted"|"declined"`, and gains one
digest-bound history record with this shape:

```json
{
  "decision_id": "authority-<digest-prefix>",
  "requirement_id": "R-002",
  "decision": "grant|decline",
  "actor": "coordinator",
  "rationale": "the user's recorded decision",
  "decided_at": "<ISO-8601>",
  "prior_disposition": "needs_authority",
  "resulting_disposition": "actionable|out_of_scope",
  "decision_sha256": "<sha256>"
}
```

Only a pending `needs_authority` requirement accepts this command, and only once. A decline is
rejected if it would invalidate active or completed work; decide before claiming affected tasks.
A decline cancels a task only when all its mapped requirements are declined. Do not infer authority
from the user's implementation request or use this command to rewrite an actionable requirement.

## Reporting and installation

```text
bun <pinned> status --run <run>
bun <pinned> handoff --run <run>
bun <pinned> doctor --run <run> [--source <skill-root> --home <home> \
  --clients codex,chatgpt,claude,antigravity]
bun <pinned> begin-critic --run <run> --critic <fresh-id>
bun <pinned> packet --run <run> --role completeness-critic --agent <critic> --token <secret> \
  --repository-command-ids <comma-separated-run-command-ids> --id <packet-id>
bun <pinned> review-completion --run <run> --critic <critic> --token <secret> --review <json>
bun <pinned> remediate-completion --run <run> --actor <coordinator> --remediation <json>
bun <pinned> complete --run <run> --actor <coordinator>
bun <installed>/scripts/harness.ts install --source <skill-root> --home <home> \
  --clients codex,chatgpt,claude,antigravity
bun <installed>/scripts/harness.ts installation-status --source <skill-root> --home <home>
```

`install` rejects any source/home ancestor overlap. A repository beneath the target home therefore
must be copied to a real, out-of-home staging directory first. From the repository root, this is an
executable staging workflow (keep the stage until status passes):

```bash
SKILL_SOURCE="$(pwd)/.agents/skills/orchestrating-long-tasks"
STAGE_ROOT="$(mktemp -d /tmp/orchestrating-long-tasks-install.XXXXXX)"
STAGED_SKILL="$STAGE_ROOT/orchestrating-long-tasks"
mkdir -p "$STAGED_SKILL"
rsync -a --delete --exclude '/installation.json' --exclude '/scripts/node_modules/' \
  "$SKILL_SOURCE/" "$STAGED_SKILL/"
bun "$STAGED_SKILL/scripts/harness.ts" install --source "$STAGED_SKILL" --home "$HOME" \
  --clients codex,chatgpt,claude,antigravity
bun "$STAGED_SKILL/scripts/harness.ts" installation-status --source "$STAGED_SKILL" \
  --home "$HOME" --clients codex,chatgpt,claude,antigravity
```

Require `installed: true`, `drifted: false`, and `issues: []` before removing the exact
`STAGE_ROOT`. Do not stage through a symlink or inside the source or target home. Run
`installation-status` against the same staged source used for installation; caches excluded from
the stage are intentionally not part of the installed digest.

The `review-completion --review` file has this required shape. Every check must name a successful
critic-owned command, and `repository_command_ids` must name the successful run-level commands that
were bound into the critic packet:

```json
{
  "packet_id": "critic-1",
  "packet_sha256": "<sha256>",
  "readiness_sha256": "<sha256 returned by begin-critic and bound into the packet>",
  "graph_revision": 1,
  "repository_binding": {
    "schema": "harness.repository-binding",
    "version": 1,
    "inspection_sha256": "<sha256 from the critic packet>",
    "git_identity_sha256": "<Git identity sha256 from the critic packet>",
    "content_sha256": "<sha256 from the critic packet>",
    "file_count": 123,
    "total_bytes": 456789
  },
  "status": "clean",
  "unresolved_finding_ids": [],
  "findings": [],
  "integrity_evidence": [{ "status": "passed", "issues": [] }],
  "repository_command_ids": ["C-RUN-GATE"],
  "checks": [{ "command_id": "C-CRITIC-CHECK" }],
  "requirement_proofs": [
    {
      "requirement_id": "R-001",
      "status": "satisfied",
      "evidence": [
        {
          "kind": "command",
          "reference": "C-REQUIREMENT-CHECK",
          "observation": "the command proves the acceptance criterion"
        }
      ]
    }
  ],
  "residual_risks": []
}
```

For a `findings` review, `findings` contains structured requirement/severity/observation/evidence/
remediation/revalidation records and `unresolved_finding_ids` must equal those IDs exactly. Every
authoritative requirement needs exactly one `satisfied` or `out_of_scope` proof, and residual risks
must be an explicit array. The
`remediate-completion --remediation` file must resolve every ID from that review exactly and bind
each resolution to successful authoritative commands:

```json
{
  "review_sha256": "<review-sha256>",
  "resolutions": [
    {
      "finding_id": "F-COMPLETE-1",
      "method": "implemented the missing requirement and reran its gate",
      "command_ids": ["C-REMEDIATION-CHECK"]
    }
  ]
}
```

`review-completion` requires substantive critic-owned command checks. A findings result requires
complete command-backed remediation and a fresh critic authorization; the same critic cannot
self-recheck. `complete` revalidates every required command and packet artifact from disk and fails
with enumerated blockers until integrity, requirements, tasks, findings, leases, commands, gates,
and a clean completeness review pass.

For a findings review, run each remediation check through `run` as a successful run-level command:
omit `--task`, use the coordinator as actor, and copy the returned command IDs into the remediation
file. `resolutions` must cover every `unresolved_finding_ids` entry exactly once, each `command_ids`
list must be nonempty and duplicate-free, and every named command must be authoritative. The
successful remediation command returns `{ "run_root": "...", "remediation": { ... } }`; the stored
object adds `actor`, `recorded_at`, and `remediation_sha256`. Afterward authorize a different fresh
critic, publish a new critic packet with current run-level command IDs, and re-review. Neither the
old critic nor prose can close a completion finding.

## Runtime contributor test working directory

Repository gates use the managed repository root as `--cwd`; their argv paths are relative to that
root. Tests for this skill's own Bun runtime are different: run them from the skill's `scripts/`
directory so `tests`, `tsconfig.json`, and package scripts resolve correctly.

```text
cd <skill-root>/scripts
bun test tests/<area>/<focused-test>.test.ts
bun test tests
bunx tsc -p tsconfig.json --noEmit
bun test tests/architecture/file-size.test.ts
```

Use only focused tests while implementing a lane. Run `bun test tests` once as a final full gate,
after process-safety checks pass and no implementation agents are concurrently changing the tree.

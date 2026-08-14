---
name: orchestrating-long-tasks
description: Use when a request is long-running, spans multiple files or subsystems, needs parallel agents, must survive restarts or context loss, or requires independent validation and bounded repair before completion.
---

# Orchestrating Long Tasks

Turn a large prompt into a durable, graph-scheduled, independently validated run. The harness keeps
authoritative coordination under `.harness/<run>/`, copies its own Bun/TypeScript runtime into the
run, and can be resumed by Codex, ChatGPT coding agents, Claude Code, or Antigravity without relying
on conversation history or model-provider APIs.

## When to use

Use this skill when any of these are true:

- the prompt contains many instructions, files, phases, or acceptance criteria;
- two or more independent work lanes can run concurrently;
- implementation needs adversarial review, repair loops, or mandatory gates;
- the task may outlive one context window, process, client, or agent;
- repository changes must be isolated among multiple agents;
- command hangs, transient network failures, or stale workers need deterministic recovery.

Do not create a harness for a simple answer, a one-file mechanical edit, or a short diagnostic that
one agent can finish and verify directly.

## Hard rules

1. Preserve the user's complete prompt as immutable bytes before summarizing or planning it.
2. Never treat agent prose as authoritative state or proof.
3. Never let an implementer validate its own work or feed its report into a validator packet.
4. Never dispatch overlapping write scopes in parallel.
5. Never mutate a run with the installed skill after initialization; use its pinned runtime.
6. Never call a model API or launch an LLM CLI. Dispatch only through the current host's native
   subagent mechanism.
7. Never announce completion while the runtime reports a blocker.
8. Describe mandatory gate evidence only as `trusted_host_observed_v1`, never as hermetic, sealed,
   sandboxed, reproducible-build evidence, or a complete inferred input closure.

Read [protocol.md](references/protocol.md) for invariants and the full lifecycle,
[state-model.md](references/state-model.md) for durable state/recovery, and
[schema-examples.md](references/schema-examples.md) before constructing a plan.

## Start a run

### 1. Capture first

Write the exact request to a temporary file without changing whitespace, ordering, or wording. If
the host can retrieve the original source directly, initialize with verified assurance:

```text
bun <skill>/scripts/harness.ts init --repo <repo> --run-id <slug> \
  --prompt-file <exact-prompt-file> --capture-mode file --source-verified
```

Use `--prompt-stdin --capture-mode stdin --source-verified` only when stdin is the direct complete
source. When direct source retrieval is unavailable, capture the visible context exactly with
`--capture-mode verbatim_context_copy` and omit `--source-verified`. Tell the user/run that assurance
is `recorded-unverified`; do not pretend a model-transcribed copy is source-verified.

Initialization creates `.harness/<slug>/runtime/harness.ts`. Set this conceptual entrypoint for the
rest of the run:

```text
PINNED=.harness/<slug>/runtime/harness.ts
RUN=.harness/<slug>
```

Do not depend on shell variables in durable packets; record full literal paths/argv there.
Initialization also records the baseline repository inspection and publishes the immutable
`planner-0` packet. Dispatch the returned `planner_packet` before constructing either planning
document; it is the planner's authoritative pre-plan context and names the only two writable
planning paths. If the process stops before plan application, generate `handoff.md`, inspect its
pre-plan state, and recover `planner-0` idempotently with the exact packet command in
[cli.md](references/cli.md). Reuse the durable planner identity `planner`; a replacement identity
cannot republish the already-bound packet.

### 2. Inspect before tracked writes

Record repository status, applicable instruction files, recent commits, package/runtime versions,
coding and testing conventions, ownership hotspots, existing dirty paths, and final gates. Confirm
`.harness/` is gitignored. Preserve all unrelated staged, unstaged, and untracked work.

### 3. Compile every instruction

Create `requirements.json` with:

- stable requirement and acceptance IDs;
- exact source lines and excerpts;
- expanded implementation meaning;
- objective acceptance criteria;
- one disposition for every nonblank prompt line.

When one source line contains multiple obligations, create one atomic requirement per independently
provable obligation. Give every atomic requirement that full source line in `source_lines` and the
same exact `source_excerpt`, then use one disposition with duplicate-free `requirement_ids`. Declare
exactly one of `requirement_id` or `requirement_ids`. Keep the disposition `kind` as `requirement`
even when an atomic requirement has `disposition: needs_authority`; add a substantive line rationale
when any linked requirement needs authority. See [schema-examples.md](references/schema-examples.md)
for the plural form and its scheduling consequences.

Create `graph.json` with typed requirement/topic/task/artifact/agent/finding/decision/gate nodes,
typed relations, dependency direction, outputs, priorities, effort, creation order, and exact write
scopes. See [schema-examples.md](references/schema-examples.md).

Validate, fix every issue, then apply against the expected revision:

```text
bun <PINNED> validate --run <RUN> --requirements <requirements.json> --graph <graph.json>
bun <PINNED> plan-apply --run <RUN> --requirements <requirements.json> \
  --graph <graph.json> --expected-revision 0 --actor <planner-id>
```

## Execute the graph

Repeat this coordinator loop until the completion critic passes or the run is explicitly escalated.

### A. Schedule safely

Ask the runtime for the conflict-free batch sized to actual host concurrency:

```text
bun <PINNED> ready --run <RUN> --max-parallel <available-agents>
bun <PINNED> schedule --run <RUN> --max-parallel <available-agents> --actor <coordinator-id>
```

Dispatch only returned tasks. If the host has fewer agents than ready tasks, leave the rest queued;
do not invent concurrency. Follow [host-adapters.md](references/host-adapters.md).

### B. Lease and packetize

Claim each task for a named agent and persist the returned secret outside public status/handoff.
Build the role packet from authoritative state plus the matching template in `scripts/assets/` and append
`scripts/assets/common-instructions.md` exactly. Packets declare frozen requirements, write scope, expected
evidence, focused commands, attempt, and deadlines. Bearer tokens are returned once by authority commands,
delivered through the host-native dispatch channel, and never written into packet files, metadata,
status, handoff, Git, or agent-authored evidence. They are host-only capabilities, not durable resume
data. If one is lost, do not guess, regenerate, or extract its digest: wait for its recorded deadline,
then use `recover` as specified in [cli.md](references/cli.md) and issue a fresh authorization.

Use these role templates:

- [planner.md](scripts/assets/planner.md)
- [implementer.md](scripts/assets/implementer.md)
- [validator.md](scripts/assets/validator.md)
- [repairer.md](scripts/assets/repairer.md)
- [completeness-critic.md](scripts/assets/completeness-critic.md)

### C. Dispatch with exclusive ownership

Use native subagents and give each exactly one immutable packet. The coordinator may perform a lane
itself, but it then cannot validate that lane. While agents work:

- heartbeat live leases;
- preserve agent outputs as evidence, not state;
- run implementer/repairer focused tests only;
- monitor commands with the watchdog;
- recover stale leases through the runtime, never by deleting lock/state files.

### D. Submit, distrust, and validate

An implementer submission must cover every mapped requirement and stay within scope. Begin a fresh
validation with an agent that is neither an implementer/repairer nor a prior validator. The runtime
constructs validator context from an allowlist; do not add reports, confidence, decision narrative,
or earlier review notes.

Validators inspect actual repository state and run their own focused proof. They return either:

- `pass` with every requirement and nonempty independent check evidence; or
- `reject` with structured mapped findings and exact revalidation methods.

### E. Repair with pushback

Return rejection findings to the original implementer under a repair lease. Use a recorded
replacement policy only if the original is stale, unavailable, or repeatedly failing. A different
fresh validator rechecks every open finding. After three rejected repair rounds, mark the task
escalated and preserve a resumable handoff; never loop or self-approve indefinitely.

### F. Run authoritative gates

Execute commands through `run`, passing argv after `--`; never quote a shell command string. Attach a
result only when task ID, gate ID, argv fingerprint, exit, logs, and command identity match. Finish a
task only after independent pass, closed findings, and all mandatory gates.

Mandatory gates expose this exact assurance surface:

```json
{
  "assurance": "trusted_host_observed_v1",
  "sandboxed": false,
  "trusted_boundary": "local OS user, host-selected toolchain and transitive processes"
}
```

The host or coding application may add a sandbox, but the harness neither configures nor attests
one. A same-user mutate → execute → restore sequence completed between repository observations is
outside the threat model. Process ownership and host-ancestor checks remain a separate boundary and
must independently fail closed before signaling. Terminal gate evidence requires a non-null
`repository_after` matching its pre-command observation; completion compares every attached
mandatory gate's post-observation with the repository binding captured live while completion holds
the workflow lock.

Packet Git commands and the accepted Git diff gates use one restricted command seam that disables
hooks, pathname fsmonitor, replacement objects, pagers, external diff, and text conversion.
Repository discovery rejects repository-local `diff.external`, `diff.*.textconv`, active
`core.fsmonitor`, or `filter.*.clean`, `filter.*.smudge`, or `filter.*.process` before status. The
declared gate command remains the fingerprint authority; its deterministic restricted execution
form is persisted as `execution_argv`, and that form plus the exact noninteractive environment are
part of the `trusted_host_observed_v1` contract.

See [cli.md](references/cli.md) for exact command forms.

## Recover and hand off

On a hang, interruption, or client change:

1. run `doctor` and inspect integrity before mutation;
2. run `projection-recover --actor <coordinator>` only for a stale/torn projection with a valid
   event chain;
3. run `recover --actor <coordinator>` for expired leases/validations;
4. run `handoff` and give the next client its exact file plus the repository path;
5. resume with the pinned runtime and the reported exact next argv.

If the interruption occurred before the first `plan-apply`, `handoff` emits a pre-plan document with
`Graph revision: not-applied`, `planner-0` publication state, and literal `validate`/`plan-apply`
argv. Resume from that document instead of inventing a task graph from conversation memory.

Retry only declared idempotent transient failures. Do not classify test failures, authorization
errors, unknown nonzero exits, or an unresponsive agent as a network retry.

For host-level connection or service interruptions, use the host's recurring task/thread monitor.
Reinspect durable state before every retry and back off approximately 30 seconds, 1 minute, 2
minutes, 4 minutes, then 5 minutes capped. Never replay a non-idempotent mutation unless its event,
command record, or packet record proves whether it committed. The monitor wakes the coordinator; it
does not call a model API, invoke an LLM CLI, or treat observer metadata as authority.

## Complete mechanically

After every task is independently validated and gated, run mandatory run-level commands, then
dispatch a fresh completeness critic using
the original prompt, dispositions, plan/history, actual diff, integrity, commands, gates, and open
state—but no implementer unit reports. Record its structured approval/finding result.

Authorize the critic with `begin-critic`, publish its immutable packet, run substantive independent
checks, and submit `review-completion`. If it reports findings, record complete command-backed
resolutions with `remediate-completion`, then authorize a different fresh critic. Repeat only within
the runtime's bounded critic-round policy.

Then run:

```text
bun <PINNED> doctor --run <RUN>
bun <PINNED> complete --run <RUN> --actor <coordinator-id>
bun <PINNED> handoff --run <RUN>
```

Completion requires zero integrity/traceability issues, all actionable requirements satisfied with evidence
(and every disposed requirement backed by an audited authority decision),
all tasks done, no live leases/validations/open findings, no skipped or failed mandatory commands,
all gates attached, and completeness approval. If any condition remains, report the exact blocker
and the handoff path rather than claiming success.

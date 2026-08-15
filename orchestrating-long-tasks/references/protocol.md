# Harness protocol

## Non-negotiable invariants

- `prompt.md` is immutable, byte-preserved, read-only, and SHA-256 bound to `manifest.json`.
- A run with unverified capture is labeled `recorded-unverified`; no agent may silently upgrade it.
- Every nonblank prompt line has exactly one disposition, and every obligation maps to an atomic
  requirement through the canonical `requirement` line kind. Atomic requirements independently
  declare actionable or pending-authority disposition; only an audited authority decline disposes
  an obligation.
- Mutations use the pinned runtime, kernel lock, canonical state projection, and append-only hashed
  events. Agent prose and process memory are never authoritative state.
- An agent writes only its leased scope. Validators are independent and receive allowlisted context
  without implementer narrative or prior-review anchoring.
- Retries are bounded and allowed only for declared idempotent transient failures. Unknown,
  authorization, test, and policy failures are terminal until a human/agent decision records a new
  attempt.
- Completion is mechanical: integrity, traceability, task states, findings, leases, validation,
  commands, gates, and completeness-critic approval must all pass.

## Lifecycle

### 1. Capture

Write the user's exact prompt to a file without summarizing or normalizing it. Initialize from that
file when possible. Use stdin only when the host can prove it supplied the complete source. Record
capture mode and assurance. The initializer copies the dependency-free Bun runtime into
`.capsules/<run>/runtime/` and binds the tree digest.

After initialization, execute all run commands with the pinned entrypoint:

```text
bun orchestrating-long-tasks/scripts/harness.ts <command> ...
```

If that runtime is missing or its digest drifts, stop and run `doctor`; never fall back silently to
the mutable installed skill.

### 2. Inspect the repository

Initialization records a digest-bound baseline repository inspection before publishing `planner-0`.
Record applicable instruction files, dirty paths, recent commits, toolchain/runtime versions,
coding/test conventions, package boundaries, architecture limits, and sensitive/shared ownership
points. Pre-existing changes are outside harness ownership unless explicitly placed in a task.

Initialization has already published `planner-0`. Dispatch that immutable pre-plan packet before
authoring `planning/requirements.json` or `planning/graph.json`. If interrupted before application,
generate the pre-plan handoff, idempotently recover `planner-0` with the durable `planner` identity,
validate the partial documents, and apply only at expected graph revision zero.

### 3. Compile the prompt

Create `requirements.json` and `graph.json` using the schemas in `schema-examples.md`. Requirements
preserve source ranges/excerpts and expand what each instruction means for implementation. A
disposition table proves nothing was dropped. A plural obligation may map actionable and
pending-authority atomic requirements together. Each atomic requirement repeats the shared source
line and exact full-line excerpt; the single line disposition declares duplicate-free
`requirement_ids` instead of `requirement_id` and needs a substantive authority rationale when any
mapped requirement needs authority. The line kind remains `requirement`. Validate before plan
application.

### 4. Build the relational graph

Use node types `agent`, `artifact`, `decision`, `finding`, `gate`, `requirement`, `task`, and `topic`.
Use only `assigned_to`, `blocks`, `depends_on`, `discovered_from`, `evidenced_by`, `implements`,
`produces`, `relates_to`, `supersedes`, and `validates` edges. `depends_on` points from a task to its
prerequisite. Execution dependencies must be acyclic; semantic/topic cycles may be valid.

Give every task normalized write scopes. Equal or ancestor/descendant scopes conflict. The scheduler
ranks ready work deterministically by priority, critical depth, distinct descendants, age, effort,
then ASCII ID and packs the largest conflict-free batch within the host's actual concurrency.

### 5. Dispatch native subagents

Construct an immutable packet for each role and persist its Markdown plus metadata before dispatch.
Append the canonical common instructions exactly and bind the packet digest. Use only host-native
agent tools; do not call an API or launch an LLM CLI.

The coordinator holds state ownership. Authority commands return tokens once; the coordinator sends
them through the host-native dispatch channel separately from the immutable packet, and only digests
persist. A lost token cannot be reconstructed or reissued; wait for the recorded deadline, run
`recover`, and authorize a new attempt. Heartbeat active work. Preserve late correct-token
submissions as orphan evidence after expiry/recovery, but never let them mutate active task state.

### 6. Collect evidence and validate

Implementer submissions cover every mapped requirement and include changed paths, artifacts, and
focused command IDs. A fresh validator receives only authoritative, allowlisted context without
implementer narrative or subjective confidence to eliminate anchoring bias. The validator inspects
the repository, executes mandatory gate commands under monitored execution (`run:exec`), and performs
an exhaustive adversarial invariant audit:

- Contract boundaries, input extremes, and edge cases;
- Negative assertions and error handling paths;
- Mathematical, algorithmic, and layout precision;
- Visual/layout bounds, responsive constraints, typography, and styling for generated artifacts;
- Substantive test verification (rejecting tautological, shallow, or mocked-out tests).

Structured rejection findings (`task:reject`) return to the implementer with actionable remediation
instructions and proof evidence; passing prose without verifiable command evidence is invalid. Passing
reviews (`task:review --status pass`) attach command evidence and satisfy the task.

### 7. Repair with bounded feedback

Route the first repair to the original implementer. If recorded policy marks the author unavailable,
stale, or repeatedly failing, lease a replacement with the same frozen task contract. A fresh
validator must re-verify the repaired code against prior findings and re-run gate proofs with nonempty
revalidation evidence. After max repair rounds (default 5, configurable via `max_repair_rounds`),
escalate to the coordinator/user and preserve the exact handoff instead of self-approving.

### 8. Gates and completeness

Run mandatory focused, integration, and final commands through the watchdog. Gate contracts use
literal direct argv and a strict verification grammar: shells, inline runtime modes, no-op tools,
permissive no-test modes, and help/list/watch/dry-run commands are invalid. Runtime commands use
explicit repository-relative scripts or test targets. Recognized test, lint, build, format, and
package-script forms remain valid only with a bare executable name. A path-qualified executable uses
the custom-verifier grammar even if its basename matches a recognized tool. `env` may only wrap a
literal command, with an optional `--`; environment assignments and options are forbidden. Package
scripts accept no trailing or passthrough argv. The only Git proofs are operand-free
`git diff --check` and `git diff --cached --check`. Declared Git and wrapper executable names must be bare;
canonical absolute paths appear only in the execution form after path binding. Any custom verifier must be invoked through its
repository-local executable path, such as `./scripts/check`; reserved tool, wrapper, shell, and no-op
basenames cannot masquerade as custom verifiers. A custom verifier accepts no dash-prefixed arguments;
optional arguments are separate non-option safe tokens or repository-relative paths. A gate accepts
only a successful command whose literal argv fingerprint, task ID, and gate ID match the graph
contract. Then dispatch a completeness critic with the prompt, plans, actual diff, integrity, and gate
records but no implementer reports.

Mandatory gate evidence is labeled `trusted_host_observed_v1` and is explicitly unsandboxed. The
trusted boundary is the local OS user plus the host-selected toolchain and transitive processes. A
host or coding application may add a sandbox, but the harness neither configures nor attests it.
The before/after observations do not cover a same-user mutate → execute → restore sequence completed
entirely between them; that sequence is outside the threat model. Do not describe this evidence as
hermetic, sealed, reproducible-build evidence, sandboxed, or a complete inferred input closure.

Every terminal mandatory gate must carry a non-null `repository_after` matching its pristine
pre-command repository binding. Gate attachment rejects missing, unknown, or stale assurance.
Completion rechecks each attached gate's post-binding against the live repository binding captured
inside the locked completion transaction. Process ownership and host-ancestor checks are independent
of repository evidence and remain fail closed before any signal is sent.

All packet Git subprocesses use a sanitized seam that disables hooks, pathname fsmonitor, pagers,
external diff, text conversion, and replacement objects with `GIT_NO_REPLACE_OBJECTS=1`.
Repository discovery rejects local `diff.external`, every `diff.*.textconv`, every executable
`filter.*.clean`, `filter.*.smudge`, or `filter.*.process`, and any non-disabled `core.fsmonitor`
before porcelain status. Indexed gitlinks are rejected before porcelain status can inspect an
initialized nested worktree. The two accepted
Git diff checks add `--no-ext-diff` and `--no-textconv` at execution; the declared Git gate argv and fingerprint remain unchanged and remain the graph-contract authority.
The exact child form is separately bound in the command record's persisted `execution_argv`; shape
and disk verification reconstruct it from the declared argv and canonical executable binding. Any
other gate-tagged effective Git command is rejected before command intent publication or process spawn.

### 9. Complete or hand off

Complete only when the runtime reports zero blockers. Otherwise generate `handoff.md`; it contains
assurance, revisions, tasks, owners, leases, findings, recent events, and exact next argv so another
supported client can continue with no conversational context.

## Host interruption monitor

The host may attach a recurring thread/task monitor for connection, service, or usage-limit
interruptions. The monitor reads the run capsule and Git state before acting, never trusts an
in-memory attempt, and uses exponential backoff near 30 seconds, 1 minute, 2 minutes, 4 minutes,
then 5 minutes capped. A retry is safe only when the operation is read-only, explicitly idempotent,
or durable evidence proves that the prior mutation did not commit. Otherwise it resumes from the
recorded event/packet/command state instead of replaying work. The monitor uses the host's native
wakeup mechanism only; provider APIs and LLM CLIs remain forbidden.

## Graph revision policy

A revision increments by exactly one and archives exact prior requirement/graph documents. Source
requirements are immutable. Once execution begins, structural task fields, dependencies, produced
artifacts, and write scopes freeze. Runtime fields—leases, attempts, findings, reports, validation,
commands, gates, and histories—survive a valid revision.

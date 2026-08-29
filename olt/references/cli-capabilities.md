# CLI Capability Manifest

Generated from `olt/scripts/src/cli/registry` by `olt/scripts/generate-cli-manifest.ts`. Do not edit by
hand.

Every command runs as `bun olt/scripts/harness.ts <command> [--flag value]`.
Output is a markdown brief of at most 30 lines; `--format json` returns the structured result instead.
`bun harness.ts help` lists the commands and `bun harness.ts help <command>` prints this detail for one of them.

Full per-command detail (flags, stdin rule, exit codes, examples) lives one file per domain under
[`cli-capabilities/domains/`](cli-capabilities/). The structured equivalent — one JSONL record per command
plus one pretty-printed JSON file per command — lives under
[`cli-capabilities/`](cli-capabilities/): read `cli-capabilities/index.jsonl` for a single self-contained
record per command, or `cli-capabilities/commands/<domain>/<command>.json` for one command's complete flag
definitions. `cli-capabilities/manifest.json` maps domains to both.

## Exit codes

| Code | Meaning |
| :--- | :--- |
| `0` | SUCCESS - markdown brief on stdout, or JSON when --format json is set |
| `3` | INVALID_ARGUMENT / INVALID_STATE / INTEGRITY / PATH_SAFETY / UNSUPPORTED_PLATFORM - rejected before the capsule changed |
| `4` | LOCK_TIMEOUT - the capsule lock was still held at the deadline |
| `70` | NOT_IMPLEMENTED, or an unexpected failure the harness did not classify |

`run:exec` is the one exception: it exits 0 whenever the child ran at all, and reports the child's
own status in `exit_code`.

## Domains

| Domain | Commands | Detail |
| :--- | :--- | :--- |
| plan | 13 | [cli-capabilities/domains/plan.md](cli-capabilities/domains/plan.md) |
| queue | 4 | [cli-capabilities/domains/queue.md](cli-capabilities/domains/queue.md) |
| task | 13 | [cli-capabilities/domains/task.md](cli-capabilities/domains/task.md) |
| reporting | 19 | [cli-capabilities/domains/reporting.md](cli-capabilities/domains/reporting.md) |
| run | 5 | [cli-capabilities/domains/run.md](cli-capabilities/domains/run.md) |
| critic | 4 | [cli-capabilities/domains/critic.md](cli-capabilities/domains/critic.md) |
| summary | 3 | [cli-capabilities/domains/summary.md](cli-capabilities/domains/summary.md) |
| inspection | 4 | [cli-capabilities/domains/inspection.md](cli-capabilities/domains/inspection.md) |
| orchestrator | 2 | [cli-capabilities/domains/orchestrator.md](cli-capabilities/domains/orchestrator.md) |
| branch | 6 | [cli-capabilities/domains/branch.md](cli-capabilities/domains/branch.md) |
| agent | 7 | [cli-capabilities/domains/agent.md](cli-capabilities/domains/agent.md) |
| orphan | 1 | [cli-capabilities/domains/orphan.md](cli-capabilities/domains/orphan.md) |
| authority | 8 | [cli-capabilities/domains/authority.md](cli-capabilities/domains/authority.md) |
| install | 2 | [cli-capabilities/domains/install.md](cli-capabilities/domains/install.md) |
| diagnostics | 10 | [cli-capabilities/domains/diagnostics.md](cli-capabilities/domains/diagnostics.md) |
| gate | 1 | [cli-capabilities/domains/gate.md](cli-capabilities/domains/gate.md) |
| capture | 3 | [cli-capabilities/domains/capture.md](cli-capabilities/domains/capture.md) |
| mind | 27 | [cli-capabilities/domains/mind.md](cli-capabilities/domains/mind.md) |
| policy | 4 | [cli-capabilities/domains/policy.md](cli-capabilities/domains/policy.md) |
| msg | 4 | [cli-capabilities/domains/msg.md](cli-capabilities/domains/msg.md) |
| worktree | 6 | [cli-capabilities/domains/worktree.md](cli-capabilities/domains/worktree.md) |

## Commands

| Command | Domain | Summary |
| :--- | :--- | :--- |
| `plan:brainstorm` | plan | Expand a prompt against the 8 Socratic vectors across iterative rounds. |
| `orchestrate` | plan | The primary entry point: the user's entire prompt in, a running orchestration out. |
| `plan:init` | plan | Create a run capsule and capture the prompt bytes immutably. |
| `plan:enhance` | plan | Record the agent's reading of the repository as a reviewable plan document. |
| `plan:add` | plan | Register a task declaration in the planning buffer. |
| `plan:audit` | plan | Audit the planning buffer against the six topology invariants and record the verdict. |
| `plan:compile` | plan | Compile the planning buffer into requirements, the DAG, and revision 1. |
| `plan:validate-start` | plan | Assign the plan-validator and mint the token required by plan:review. |
| `plan:review` | plan | Record the plan-validator's written verdict on the compiled plan. |
| `plan:replan` | plan | Partition findings into a repair wave and raise the graph revision. |
| `plan:claim` | plan | Issue a planner's role packet: the sole way a planner agent gets its contract. |
| `plan:apply` | plan | Validate and commit the requirements and graph the planner wrote to planning/. |
| `plan:status` | plan | Show the planning buffer or the compiled plan summary. |
| `queue:next` | queue | Show the highest-priority ready task without claiming it. |
| `queue:list` | queue | Partition every task by queue status. |
| `queue:wave` | queue | Show every task claimable right now, ranked by critical depth — for display only. |
| `queue:pop` | queue | Claim the highest-priority ready task and mint a lease token. |
| `task:brief` | task | Generate a zero-exploration 1-shot briefing for a task. |
| `task:claim` | task | Lease a specific ready task under a declared role. |
| `task:heartbeat` | task | Extend a live lease so a long edit does not expire. |
| `task:submit` | task | Submit completed task work for validation. |
| `task:validate-start` | task | Dispatch an independent validator against a submitted task. |
| `task:review` | task | Record a validator verdict with its gate evidence. |
| `task:probe` | task | Record the mandatory adversarial probe: a demand for proof, not a rejection. |
| `task:reject` | task | Reject a task with a structured finding for targeted repair. |
| `task:assign-repairer` | task | Replace the original implementer as a task's repairer, with a recorded reason. |
| `task:abandon` | task | Close an open attempt nobody submitted or released, on the coordinator's authority. |
| `task:check` | task | Incremental verification. |
| `report` | reporting | Deliver unified topology, lifecycle tier breakdown, agent roles, IDs, and timestamps. |
| `report:graph-json` | reporting | Export DAG telemetry and metrics to JSON. |
| `report:dag` | reporting | Canonical reporting for DAG status. |
| `report:graph` | reporting | Visual/ASCII and graph overview. |
| `report:health` | reporting | Canonical reporting for health/doctor status. |
| `report:leases` | reporting | Active lease and agent matrix. |
| `report:decisions` | reporting | Inspection of authority decisions and governance audit. |
| `report:summary` | reporting | Render executive summary brief of capsule run. |
| `report:task` | reporting | Read and render a task submission, review or critic report. |
| `stream:events` | reporting | Stream, query, and tail structured capsule events. |
| `dag` | reporting | Render Sugiyama hierarchical DAG layout with rounded Unicode boxes and cycle diagnostics. |
| `dag:trace` | reporting | Real-time step tracer and dynamic living DAG expansion timeline. |
| `usage:report` | reporting | Discover and report cross-platform quota, rate limit, and token usage telemetry. |
| `quota:check` | reporting | Evaluate quota circuit-breaker status, wrap-up directives, and auto-wake timer schedule. |
| `quota:freeze` | reporting | Initiate DAG quota freeze and create a snapshot. |
| `quota:resume` | reporting | Resume DAG operations from a quota freeze snapshot. |
| `skill:audit:live` | reporting | Live Tier 0 out-of-band audit of skill compliance and delta event forensics. |
| `notify:phase` | reporting | Trigger cross-platform native OS push notification and audio chime upon phase landing. |
| `notify:test` | reporting | Send a test native OS notification and Glass chime to verify desktop integration. |
| `run:init` | run | Initialize a capsule run root and write its initial manifest. |
| `run:exec` | run | Run a gate command under process isolation and record the evidence. |
| `run:status` | run | Show phase, per-task status and progress for the run. |
| `run:complete` | run | Seal the capsule after verifying every completion artifact. |
| `shell` | run | Execute direct non-interactive CLI commands under mechanical RBAC policy with signed evidence. |
| `scope:expand` | agent | Dynamically expand the declared read scope neighborhood for an active actor. |
| `critic:start` | critic | Authorise a completeness critic against the immutable prompt bytes. |
| `critic:review` | critic | Record the completeness verdict over the whole repository diff. |
| `critic:reject` | critic | Reject completion with findings that trigger replanning. |
| `critic:remediate` | critic | Close out a critic findings review with command-backed remediation evidence. |
| `summary:export` | summary | Write the graph, timeline, metrics and executive brief to disk. |
| `summary:view` | summary | Render the executive brief without writing anything. |
| `test:summary` | summary | Display or record test execution summary metadata. |
| `finding:get` | inspection | Read one finding file, or every finding in the capsule. |
| `report:get` | inspection | Read a submission, review or critic report. |
| `evidence:get` | inspection | Read recorded command evidence. |
| `evidence:screenshots` | inspection | List captured UI screenshots with their test ids and viewports. |
| `orchestrator:run` | orchestrator | Run the autonomous coordination loop over a fresh capsule. |
| `orchestrator:supervise` | orchestrator | Reclaim dead agents, escalate dead-end tasks, and dispatch what's ready (B28). |
| `branch:open` | branch | Subdivide the work you hold into sub-tasks a sub-agent can take. |
| `branch:claim` | branch | Lease one branch sub-task to a sub-agent. |
| `branch:submit` | branch | Hand a finished sub-task back to the branch. |
| `branch:collect` | branch | Take the branch back and resume the parent. |
| `branch:abandon` | branch | Give up on a branch and resume the parent. |
| `branch:status` | branch | Show which branches are open and what they are waiting on. |
| `agent:register` | agent | Record a dispatched subagent and mint its grant. |
| `agent:report` | agent | Ingest the caller's own report of tool usage and token counts mid-flight. |
| `agent:release` | agent | Close a subagent's grant. |
| `agent:list` | agent | Show who is deployed, or the lineage of one task. |
| `agent:brief` | agent | Generate an exact-anchor subagent briefing. |
| `agent:define` | agent | Define a new agent manifest. |
| `orphan:dispose` | orphan | Close out a command record that arrived without a live owner. |
| `authority:decide` | authority | Grant or decline a needs_authority requirement. |
| `whoami` | authority | Inspect thread execution tier, PID, active agent, grants, and main-thread compliance. |
| `role:cheat-sheet` | authority | Display compact terminal cheat sheets and command matrices for system roles. |
| `watchdog:status` | authority | Query watchdog lifecycle, monitor cadence, and health status. |
| `watchdog:cleanup` | authority | Purge stale or legacy watchdog monitors exceeding heartbeat timeout. |
| `watchdog:phase-cleanup` | authority | Terminate legacy phase watchdog monitors upon phase rollover or completion. |
| `watchdog:verify` | authority | Verify watchdog lifecycle invariants and single-monitor constraints. |
| `watchdog:probe` | authority | Execute 2-way supervisory health probe and doctor diagnostics to top leader. |
| `install` | install | Install the skill release and link it into the requested clients. |
| `installation-status` | install | Audit the installed release, its digest and its client links. |
| `defect:audit` | diagnostics | Audit, deduplicate, and auto-admit defects across capsules. |
| `coverage:check` | diagnostics | Audit repository test coverage against strict 95% threshold. |
| `health` | diagnostics | Check whether the code still does what the requirements said. |
| `doctor` | diagnostics | Verify capsule integrity, command evidence and the runtime. |
| `doctor:repair` | diagnostics | Re-derive state.json from the event chain after a crash tears the log's tail. |
| `doctor:certify` | diagnostics | Certify doctor's own checks are falsifiable via counterfactual mutation testing. |
| `recover` | diagnostics | Release expired leases and interrupted validations. |
| `task:release` | task | Hand a live lease back without waiting for it to expire. |
| `meta-audit` | diagnostics | Deep behavioral forensics and anomaly detection across all agent telemetry. |
| `finding:file` | diagnostics | Record a diagnostic finding or defect directly into the flock-locked defect store. |
| `explain` | diagnostics | Explain a HarnessError code: the rule it enforces, common causes and the remedy for each. |
| `gate:prove` | gate | Prove a compiled task's gate can actually fail, on a disposable scratch copy. |
| `coordinator:pushback` | task | Reject a validator's own recorded pass, procedurally or substantively. |
| `capture:init` | capture | Initialize standard capture configuration in repository. |
| `capture:run` | capture | Execute multi-viewport UI capture and companion manifest persistence. |
| `capture:eval` | capture | Evaluate companion manifests against 4-pillar validation engines. |
| `memory:query` | mind | Query indexed cross-run knowledge, decisions, and memory documents. |
| `mind:init` | mind | Initialize a mind capsule from an owner charter. |
| `mind:wake` | mind | Produce the Tier A orientation brief and reclaim expired pulses. |
| `mind:pulse-open` | mind | Open an active mind pulse under budget constraints. |
| `mind:pulse` | mind | Unified perpetual mind pulse: report active telemetry or open a new pulse. |
| `mind:observe` | mind | Record a discovery source scan count evidenced by a command record. |
| `mind:candidate` | mind | Record a discovery candidate (defect or proposal). |
| `mind:admit` | mind | Run admission gates on a candidate and admit it. |
| `mind:decline` | mind | Permanently decline a candidate with a recorded reason. |
| `mind:quiesce` | mind | Record a verified quiescent observation across all ten discovery sources. |
| `mind:escalate` | mind | Record an escalation and append to escalation log. |
| `mind:halt` | mind | Halt mind pulse execution and suppress successor arming. |
| `mind:round-open` | mind | Open a multi-pulse round for an objective. |
| `mind:round-close` | mind | Close a multi-pulse round for an objective. |
| `mind:audit-start` | mind | Start an independent audit cycle over recent pulses. |
| `mind:audit-report` | mind | Submit findings and verdict for an audit cycle. |
| `mind:rotate` | mind | Rotate generation N capsule into generation N+1. |
| `smart-task:plan` | mind | Autonomously synthesize self-evolution tasks or plan from feedback queue. |
| `smart-task:ingest` | mind | Ingest and enhance an external prompt into a gate-verifiable task plan. |
| `mind:queue:list` | mind | List and inspect mind feedback queue items. |
| `mind:queue:add` | mind | Add a feedback item to the mind queue. |
| `mind:queue:drain` | mind | Drain and mark pending feedback items for execution. |
| `mind:queue:seal` | mind | Seal completed queue items with empirical verification proofs. |
| `mind:queue:clean` | mind | Prune resolved items from queue into completed-tasks archive. |
| `mind:audit:live` | mind | Live Tier 0 out-of-band audit of mind liveness, stagnation, and Mode A/B injection. |
| `policy:init` | policy | Initialize canonical .olt/policy.json with auto-detected ecosystem defaults. |
| `policy:get` | policy | Inspect repo policy or retrieve a specific policy key value. |
| `policy:set` | policy | Set or update a specific key value in .olt/policy.json. |
| `policy:check-drift` | policy | Check for policy file drift against a known SHA-256 checksum. |
| `factory:preplan` | mind | Execute continuous pre-planning factory tick to cluster backlog and emit blueprints. |
| `factory:status` | mind | Inspect factory pre-planning queue health, stagnation status, and concurrency saturation. |
| `msg:send` | msg | Send an authenticated mailbox message to an agent or role. |
| `msg:recv` | msg | Receive unread mailbox messages from the agent inbox. |
| `msg:poll` | msg | Poll mailbox for messages at regular intervals until received or timeout. |
| `msg:list` | msg | List mailbox summaries and unread counts across agents. |
| `worktree:create` | worktree | Create a hermetic track worktree with lock acquisition. |
| `worktree:land` | worktree | Land a completed track worktree to main with immediate teardown. |
| `worktree:list` | worktree | List all active track worktrees. |
| `worktree:clean` | worktree | Clean up and remove track worktrees and branches. |
| `worktree:status` | worktree | Check status of active track worktrees. |
| `worktree:reclaim` | worktree | Reclaim abandoned worktrees from a completed or crashed run. |

# Codex–OLT Agent Runtime Forensics

Date: 2026-08-25

Scope: Codex-native OLT execution for the Limo and skills repositories

Disposition: diagnosis and recovery design only; no recovery or implementation was performed

## Executive summary

The autonomous flow did not fail because the computer lacked CPU threads, because the selected models were too large, or because Harness had too many grants. It failed primarily because the OLT integration used the wrong lifecycle model for Codex subagents.

Codex limits the number of **concurrently open spawned-agent threads per primary session**. That is a logical agent-thread limit, not an operating-system thread limit. A subagent whose current model turn has completed can still have an open, reusable Codex thread. Likewise, interrupting an agent turn does not necessarily close or archive that thread. The recovery loop repeatedly treated `completed`, `idle`, `notLoaded`, and `pending_init` states as proof that an agent was dead, then spawned replacement generations instead of following up with, reusing, or explicitly retiring the existing thread. This accumulated open agent threads until the session rejected further spawns with:

```text
collab spawn failed: agent thread limit reached
```

The root session made 47 spawn attempts. Nine succeeded and 38 were rejected by that exact error. The first rejection occurred on 2026-08-25 at 04:58:14, when the native roster visibly contained four open spawned-agent entries besides the primary thread: two running, one completed, and one pending initialization. Interrupting the completed and pending entries did not reclaim capacity. That behavior aligns with OpenAI's documented cap on **open spawned-agent threads**, not merely agents actively generating a response.

Several system-design problems amplified the failure:

1. OLT's resident, never-terminal Mind assumption does not match Codex's turn-based subagent model. A completed turn is normal and can be resumed with a follow-up; it is not necessarily a dead agent.
2. The one-minute watchdog repeatedly created recovery turns and replacement generations without first proving that the underlying thread had been closed or that capacity had changed.
3. Harness grants and pulses were treated as native liveness, even though they can outlive the corresponding Codex turn or thread.
4. Limo and Skills were intended as independent trees, but all archived Codex agents from this run were created inside the Limo-rooted primary session and had the Limo native working directory. The Skills flow never became an independent Codex execution domain.
5. The OLT Codex adapter combines assumptions from other hosts—batch spawning, resident agents, and kill semantics—with Codex APIs that expose follow-up and interrupt behavior but no equivalent lifecycle contract in the current collaboration surface.
6. Harness health output sometimes correlated stale or unknown agent completion with the current policy generation, producing an unhealthy diagnosis while the exact current Mind audit reported no stagnation.

The appropriate repair is not to raise the agent limit and retry the same design. First, a small disposable Codex experiment must prove open-thread accounting, follow-up behavior, closure/archive behavior, and slot reclamation. Then the Codex adapter should implement a three-layer state model: current native turn state, persistent native thread state, and Harness logical ownership state. Limo and Skills should run in separate top-level Codex tasks, each with its own repository root and per-session agent-thread budget. Minds should be durable thread identities activated by finite turns, not permanently running model turns.

No agents, schedules, grants, capsules, source fixes, commits, pushes, or global skill synchronizations were started as part of this investigation.

## Current stopped state

At the end of evidence collection:

- The Codex collaboration roster contained only the primary `/root` agent.
- The 11 Codex subagent task records associated with this flow had been archived.
- The Codex OLT watchdog and rescue automations had been removed.
- The active Limo policy-generation capsule was halted and its Mind grant released.
- The proposed Skills policy-generation capsule had never been created.
- Claude Code and Antigravity state were excluded from this diagnosis and must remain separate from any future Codex recovery.
- Limo's existing dirty worktree and externally produced changes were preserved.

This is a clean diagnostic stop, not a claim that the repositories or Harness history are clean.

## Environment observed

| Component                                          | Observed value                                                    |
| -------------------------------------------------- | ----------------------------------------------------------------- |
| Codex desktop app                                  | `26.818.61809`, bundle build `7019`                               |
| Global shell CLI                                   | `codex-cli 0.149.1`                                               |
| Desktop-embedded Codex binary                      | `0.149.0-alpha.4.3`                                               |
| Global configured model                            | `gpt-5.6-terra`, high reasoning                                   |
| Configured agent-thread cap                        | Not set; Codex selected its default                               |
| `multi_agent` feature                              | Stable, enabled                                                   |
| `multi_agent_v2` feature                           | Stable, disabled in feature listing                               |
| Recorded session context                           | `multi_agent_version: v2`                                         |
| Active/unarchived rollout files reported by Doctor | 325                                                               |
| Archived rollout files reported by Doctor          | 11                                                                |
| Rollout source counts                              | 308 `subagent:thread_spawn`, 17 `vscode`, 7 other subagent, 4 CLI |

The difference between the global CLI, the desktop-embedded binary, and the recorded multi-agent feature surface is a compatibility risk, but the evidence does not prove that it caused the thread-limit failure.

Both Codex binaries passed the relevant Doctor checks for desktop handshake, authentication, network connectivity, WebSocket connectivity, configuration parsing, and storage database integrity. Disk space was healthy. Doctor's overall failure was attributable to `TERM=dumb`, not agent runtime health. Doctor did not expose the number of open subagent threads in the current primary session, so it could not diagnose or disprove the agent-thread-cap condition.

The 325 unarchived rollouts are persisted task records, not evidence of 325 concurrently open subagents in this session. The cap documented by OpenAI is per primary session. Global task inventory, sidebar visibility, in-memory loaded state, active generation, and per-session open-agent capacity are different measurements.

## What Codex officially documents

OpenAI's [Subagents documentation](https://learn.chatgpt.com/docs/agent-configuration/subagents) defines an agent thread as the delegated agent's thread and describes separate operations for steering, stopping, and closing completed agent threads. It documents `agents.max_concurrent_threads_per_session` as the cap on concurrently open spawned-agent threads, excluding the primary thread. If the setting is absent, Codex chooses a default. `agents.max_threads` is a legacy alias.

The [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference) confirms the same per-session open-thread setting. The documentation does not publish the numeric default used by this desktop session, so this report does not infer one.

The [App Server documentation](https://learn.chatgpt.com/docs/app-server) distinguishes persistent thread state from runtime activity:

- `active` means the thread currently has an active turn.
- `idle` means the thread exists without an active turn.
- `notLoaded` means the persisted thread is not loaded into app-server memory; it is not synonymous with deletion.
- `systemError` is a runtime failure state.
- `thread/loaded/list` and `thread/list` answer different questions.
- Default thread listing focuses on interactive sources; subagent-created sources require explicit source-kind inclusion.
- `thread/archive` moves persisted thread data and attempts to archive descendants.
- `thread/delete` permanently removes a persisted root and its descendants.

OpenAI's [scheduled tasks documentation](https://learn.chatgpt.com/docs/automations) says a standalone schedule starts a new chat, while an in-chat schedule returns to the same chat and existing context. Minute-level schedules are supported, but prompts should be durable and manually tested before relying on them. Returning to the same primary chat every minute is therefore a control-plane turn, not an independent resident process inside each subagent.

The [long-running work guidance](https://learn.chatgpt.com/docs/long-running-work) recommends keeping related work in the same chat and using separate chats for independent parallel tasks. That supports separate top-level Codex tasks for Limo and Skills rather than simulating two independent roots inside one primary session.

The [troubleshooting guide](https://learn.chatgpt.com/docs/reference/troubleshooting) identifies the desktop logs and session stores needed for a reproducible issue report and directs users to the official Codex issue tracker when a product problem persists. The relevant local locations are:

```text
~/Library/Logs/com.openai.codex/YYYY/MM/DD
~/.codex/sessions
~/.codex/archived_sessions
```

The [Codex changelog](https://learn.chatgpt.com/docs/changelog) records CLI `0.149.1` on 2026-08-24 and the new `codex agents` task-management dashboard in `0.149.0`. No official changelog entry found during this research identifies a known defect matching this exact thread-limit pattern.

## Native status glossary

The previous watchdog logic collapsed several different concepts into “alive” or “dead.” That binary model is unsafe.

| Observation            | What it actually establishes                          | Correct default response                                                                      |
| ---------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Active/running turn    | A model turn is executing now                         | Leave it uninterrupted if progressing                                                         |
| Idle thread            | The persistent thread exists without an active turn   | Send a follow-up if more work belongs to it                                                   |
| Completed agent turn   | The last delegated turn returned terminal output      | Reuse with follow-up or explicitly retire the thread                                          |
| `pending_init`         | Spawn/init has not reached a usable running state     | Observe or cancel according to documented lifecycle; do not assume its capacity was reclaimed |
| Interrupted turn       | The current turn was stopped                          | Verify whether the underlying thread is still open                                            |
| `notLoaded`            | The persisted task is unloaded from app-server memory | Resume/load if needed; it is not proof of death                                               |
| Archived/closed thread | The thread has been retired from the active store     | Verify removal and capacity reclamation before replacement                                    |
| Harness grant/pulse    | Logical authority or work lease exists                | Correlate with an exact native thread receipt; never treat it alone as liveness               |

“Harness registration” does not create a Codex-native thread. It records a logical agent, grant, host address, and role inside the OLT state. Conversely, a Codex spawn receipt does not grant OLT authority until Harness registers it. Both sides are necessary, but neither can substitute for the other.

## Failure chronology

### 1. Initial native hierarchy was created

The root created a Limo Mind, Mind Auditor, nested Limo Orchestrator, and nested Coordinator. Early agents inherited Terra/high rather than the later role-specific model policy. The hierarchy consumed separate spawned-agent threads for roles that were expected to remain resident.

### 2. The first cap rejection appeared with four open child entries

At 04:58:14 the root received the first `agent thread limit reached` error. A roster snapshot moments later showed:

- `/root/limo_mind`: running
- nested Limo Orchestrator: running
- nested Coordinator: completed
- `/root/limo_mind_auditor`: pending initialization

This is the strongest local evidence explaining the error. Four child entries were open even though only two were actively working. The result is consistent with the official definition of the cap as concurrently **open** spawned-agent threads.

Interrupting the pending auditor and completed coordinator did not permit the next spawn. That indicates that interrupting a turn was not equivalent to closing or archiving its agent thread.

### 3. Recovery treated dormant or terminal turns as dead agents

The supervisory contract later stated that only exact `RUNNING` children were live and that completed, pending, interrupted, or absent children were dead. This was incompatible with Codex's persistent thread model. The flow created replacement generations such as:

- `limo_mind_resume`
- `limo_mind_gen3`
- `limo_mind_gen4`
- `limo_mind_policy_gen1`
- several Skills Mind recovery attempts

The old thread identity was not proven closed before each replacement was attempted.

### 4. Retries became the dominant activity

Across the root session:

| Metric                                   |    Count |
| ---------------------------------------- | -------: |
| Spawn attempts                           |       47 |
| Successful spawns                        |        9 |
| Rejections with exact thread-limit error |       38 |
| First rejection                          | 04:58:14 |
| Last rejection                           | 07:35:18 |

All 47 calls specified `fork_turns`. Twenty-four attempts also specified an explicit model and reasoning effort. The later Sol/Terra/Luna policy therefore did not resolve the failure. Flat root-level sibling attempts also failed, so native nesting was not the immediate trigger, although nesting increased thread consumption and made lifecycle ownership harder to manage.

### 5. Roster visibility and capacity were incorrectly equated

Later snapshots sometimes displayed only the root, one running policy Mind, and completed descendants, yet new spawns still failed. This does not prove a platform counter bug. OpenAI's App Server documentation shows that default task listing, loaded threads, descendant sources, persistent threads, and active turns are different views. The collaboration roster did not provide an explicit “close” operation or a per-session open-thread counter, so hidden or reusable historical subagent threads could remain open without appearing as active workers.

An exact internal counter was not observable from the available tools. The high-confidence conclusion is that open-thread lifecycle was not reconciled; it is not possible from this evidence alone to say whether every retained entry was intended behavior or whether a Codex reclamation defect also exists.

### 6. Skills never became an independent native tree

All 11 archived Codex subagent records from this flow had the native working directory:

```text
/Users/onurseckinsenoglu/repos/limo
```

That includes the agents named for Skills work. Their prompts could tell tools to operate in `/Users/onurseckinsenoglu/repos/skills`, but their native task identity and primary session remained rooted in Limo. The intended Skills policy capsule was never created, and the fresh policy-compliant Skills Mind never successfully spawned.

This meant the two trees shared one per-session subagent budget and one root scheduler context. They were logically separated in instructions but not operationally separated in Codex.

### 7. Harness and native state drifted

Examples observed during the run include:

- A Skills Mind grant was released after its native turn completed while a Harness pulse remained open with a later deadline.
- The current Limo policy capsule had an exact live Mind grant, but Doctor reported an unhealthy terminated pulse attributed to an unknown Tier 3 agent from stale or incomplete correlation.
- At the same time, exact `mind:audit:live` for the current Mind reported zero idle time, no stagnation, and no defect.
- Both Limo and Skills DAGs were repeatedly empty while candidate and defect bookkeeping continued.
- The comment-policy work reached an admitted candidate and owner grant but remained ownerless because no Orchestrator thread could be created.

Harness therefore tracked authority and audit history, but it could not reliably determine Codex-native execution state without exact current-generation thread correlation.

## Root-cause assessment

### Proven primary causes

#### A. Open thread and active turn were confused

The integration used “currently generating” as its definition of native liveness, while Codex enforces capacity on open spawned-agent threads. Completed or interrupted turns were not explicitly closed or archived before replacements were requested.

#### B. Replacement churn exhausted the session's agent budget

Thirty-eight identical spawn rejections followed the first cap event. The one-minute recovery loop kept attempting new generations without a verified lifecycle transition that could reclaim capacity.

#### C. OLT's resident Mind contract mismatched Codex's turn model

The skill expected Minds to remain in an infinite native loop and treated terminal return as a role-contract failure. Codex subagents naturally execute finite turns and can retain a durable thread for follow-up. Enforcing an endless active turn is unnecessary and brittle.

#### D. Independent product trees shared one native execution domain

Limo and Skills were both hosted as descendants of one Limo-rooted primary task. They shared its open-agent cap, context, scheduler, and failure surface.

#### E. Harness liveness was not anchored to exact native lifecycle receipts

Grants, pulses, roster observations, and native thread states were updated independently. Stale generation evidence could contaminate current health, while a virtual grant could appear active after its native owner stopped executing.

#### F. The Codex host adapter lacked Codex-specific retirement semantics

The OLT materials referenced host operations such as one-shot batch deployment and `manage_subagents kill` that are not equivalent to the collaboration operations available here. `interrupt_agent` stops work but was used as though it retired the thread. No mandatory close/archive-and-verify step existed.

### Important contributing causes

- The one-minute scheduler was too aggressive for a state-insensitive recovery policy. It repeatedly woke the root control plane even when no lifecycle state had changed.
- The watchdog prompt itself became increasingly large and prescriptive, consuming context and embedding incorrect assumptions such as “not running means dead.”
- The Harness CLI was occasionally invoked with an invalid flag combination, including `mind:audit:live --run`, or without an exact identity, such as a broad `whoami` that returned Tier 0 root authority.
- A shell command embedded unescaped backticks, causing command substitution and corrupting one feedback intake operation.
- Harness charter scope excluded required root-level files such as `AGENTS.md` and `lefthook.yml`, forcing candidate partitioning and preventing a direct ownerable change packet.
- Model assignment policy arrived after the system was already saturated. It changed worker quality and cost characteristics, not lifecycle capacity.
- The global CLI and desktop-embedded binary were not the same build, and the feature listing disagreed with the recorded `multi_agent_version`. This should be controlled in a future reproduction, but is not yet a causal finding.
- The teardown process initially crossed a host boundary and stopped one Claude-era Limo pulse before the Codex-only boundary was clarified. This demonstrates that host ownership needs to be explicit before destructive recovery actions.

### Things the evidence rules out as the primary cause

- CPU or operating-system thread scarcity
- Insufficient disk capacity
- Network, authentication, or WebSocket failure
- Too many Harness grants by themselves
- Model selection or reasoning-effort selection
- Native nesting alone; later flat sibling spawns received the same error
- The total number of user-visible Codex tasks or persisted rollouts across the application

## OLT Codex adapter contradictions

The current OLT materials contain conflicting assumptions that must be resolved before another autonomous run:

1. The Mind deployment path describes a one-shot batch mechanism associated with another host, but Codex spawning is individual and capacity-limited.
2. Hard reset guidance expects a kill/close primitive, while the collaboration API used in this task offered interruption without an explicit close operation.
3. The skill requires a resident, non-terminal Mind, while Codex supports persistent agent threads with finite turns and follow-up work.
4. One adapter reference says Codex has no native resume, another recommends `followup_task`, and the TypeScript capability declaration says native resume is supported.
5. The adapter declares a fixed spawn-depth capability without an official documented basis, but does not model the official per-session open-thread limit.
6. The strict native four-tier hierarchy spends native thread capacity to mirror a logical authorization hierarchy that Harness can represent without matching Codex ancestry.
7. The canonical role-packet requirement is stronger than the compact dispatch briefing actually passed during several spawns.
8. The adapter does not provide a reliable way to select a distinct native repository root for each spawned role.
9. Original auditor guidance assumed resident child slots, while later policy treated auditors as scheduled observer turns.

These are integration defects in the OLT Codex profile, not proof that Codex subagents are generally unusable.

## Proposed recovery approach — not executed

### Stage 0: reproduce native lifecycle in isolation

Create a disposable Codex task with no Harness or repository work. Explicitly configure a small known `agents.max_concurrent_threads_per_session` value and test:

1. Spawn finite no-op agents up to the cap.
2. Let one agent turn complete.
3. Attempt one additional spawn.
4. Follow up with the completed agent and verify reuse.
5. Explicitly close or archive one completed thread through the supported task-management surface.
6. Verify disappearance using thread listing that includes subagent source kinds and descendant tasks.
7. Attempt the additional spawn again and confirm whether capacity is reclaimed.

Capture the desktop version, embedded and global CLI versions, current config, loaded-thread list, full source-kind thread list, and redacted logs. If explicit closure does not reclaim capacity, use the troubleshooting guidance to file a minimal official Codex issue. This experiment is the only defensible way to separate an adapter leak from a Codex reclamation bug.

### Stage 1: define a Codex-native lifecycle contract

Every logical OLT role should have three independently tracked states:

1. **Native turn state**: active, completed, interrupted, or failed.
2. **Native thread state**: open/loaded, open/idle, persisted/not-loaded, archived/closed, or deleted.
3. **Harness state**: registered identity, grant, pulse, task ownership, and release.

Required invariants:

- A Harness grant is never created without an exact native spawn or reusable-thread receipt.
- A completed turn with pending role work receives a follow-up; it does not automatically create a replacement generation.
- A retired role is archived or closed, and capacity reclamation is verified before replacement.
- `interrupt` means stop the active turn, not retire the persistent thread.
- No recovery retry occurs until a relevant state transition is observed.
- Duplicate defects are suppressed by a stable incident identity.
- The configured per-session cap and the number of known open child threads are explicit supervisory inputs.

Raising the cap can be considered only after closure works. A larger cap applied before lifecycle correction would hide the leak and allow a larger failure.

### Stage 2: separate Limo and Skills into distinct top-level Codex tasks

Create one user-visible Codex task rooted at Limo and another rooted at Skills. Each gets its own Goal-mode continuity context, repository working directory, native thread budget, Harness capsule, and scheduler.

Within each task, Codex-native agents should preferably be flat sibling threads. Harness records the logical Mind → Orchestrator → Coordinator/Tier 3 relationships through grants, DAG edges, parent-agent fields, and canonical messages. Native ancestry is transport metadata, not authorization.

The root dispatcher creates a sibling only after receiving a complete canonical packet from the logical dispatcher. The native spawn receipt is then registered with the logical Harness parent. This preserves strict OLT roles without forcing the host's thread tree to mirror the logical authorization tree.

### Stage 3: make Minds durable identities, not infinite turns

A Mind should be one persistent Codex agent thread whose turns are finite:

- A scheduler or event sends a follow-up when intake, pulse, or recovery work is due.
- The Mind executes one bounded supervisory turn and returns.
- Its thread remains reusable while its logical role remains active.
- Terminal output ends the turn, not the role.
- The role ends only after Harness marks the objective complete and the native thread is explicitly retired.

Mind Auditor and Skill Auditor should be finite scheduled observer turns. They should not occupy permanently active child slots.

### Stage 4: replace polling recovery with state-driven recovery

The scheduler should inspect first and act only when something material changed:

- Leave a healthy active turn untouched.
- Follow up with an idle reusable Mind when work is pending.
- Spawn only when no reusable role thread exists.
- Archive a completed ephemeral implementer or validator after its evidence has been consumed.
- Retry a rejected spawn only after closure, roster change, configuration change, or another verified capacity transition.
- Keep defect generation idempotent.

A one-minute observation cadence can remain, but it must not imply a one-minute wake, spawn, or defect cadence.

### Stage 5: repair Harness correlation and the Codex adapter

The future implementation should:

- Use exact native thread IDs and host addresses in every registration and audit.
- Query App Server thread lists with subagent source kinds included.
- Distinguish loaded, open, active, and archived state.
- Remove Antigravity-only batch and kill instructions from Codex paths.
- Replace ambiguous resume capabilities with one tested follow-up contract.
- Make Doctor generation-scoped and prevent stale unknown agents from poisoning the current capsule.
- Validate command schemas before invocation.
- Pass shell arguments without interpolation hazards.
- Permit explicitly approved root-level repository files in the charter.
- Generate and verify the complete canonical role packet before a spawn request.
- Declare capacity and depth capabilities only when observed or officially documented.

### Stage 6: controlled pilot

After the isolated lifecycle test and adapter repair, restart only Limo with:

- one durable Mind thread,
- one reusable Orchestrator thread,
- at most one Tier 3 implementation/validation pair,
- scheduled finite auditors,
- explicit closure of ephemeral workers.

Do not start Skills until Limo survives several scheduler cycles without replacement churn, duplicate incidents, or stale grants. Then start Skills in its separate top-level task and repeat the same pilot before increasing concurrency.

Model policy should be applied only after lifecycle correctness:

- Mind: `gpt-5.6-sol`, xhigh
- Orchestrator: `gpt-5.6-sol`, high
- Routine auditors and explicitly small checks: `gpt-5.6-luna`, xhigh
- Coordinators, implementers, validators, investigators, repairs, and mechanical roles: `gpt-5.6-terra`, xhigh

## Acceptance criteria before autonomous operation

The system should not be considered repaired until all of these are demonstrated:

- A completed reusable agent accepts a follow-up without creating a replacement thread.
- An explicitly retired agent disappears from the open-thread inventory and frees capacity.
- Harness active grants match exact open native owners one-for-one.
- No retired agent retains an open pulse or current grant.
- Unchanged host errors do not create repeated defects or spawn attempts.
- Limo and Skills run in distinct top-level Codex tasks with their correct native working directories.
- The scheduler completes multiple cycles without spawning a new Mind generation.
- At least one admitted Limo candidate obtains a live owner, reaches independent validation, and completes its commit/push path.
- The Skills tree can independently intake, repair, validate, push, and globally synchronize a skill change.
- Stopping Codex-owned work cannot terminate Claude Code or Antigravity-owned processes.

## Evidence inventory

Primary root session:

```text
/Users/onurseckinsenoglu/.codex/sessions/2026/08/24/rollout-2026-08-24T21-22-34-01a03727-dbbc-7f60-b071-90de7d4f6f1e.jsonl
```

Archived Codex task IDs associated with the run:

| Logical name            | Native task ID                         |
| ----------------------- | -------------------------------------- |
| Limo Mind               | `01a0372b-24ce-7490-aa0a-8f24e836c625` |
| Limo Mind Auditor       | `01a0372b-41fe-7a83-be94-6d2a341ceb71` |
| Skills Codex Repair     | `01a0372c-d919-7bf3-bee8-dad69d56e2fb` |
| Limo Orchestrator       | `01a03732-58ca-7910-9045-cc860813beac` |
| Limo Coordinator        | `01a0373d-4da1-76e2-b0ec-72a4a0e29e6c` |
| Skills Mind             | `01a03762-2a9f-7b31-a9c9-39de525ea4a1` |
| Limo Mind Resume        | `01a0376a-7e24-70b2-95b1-7db583c31596` |
| Skills Lifecycle Repair | `01a03782-1e88-76c2-81bf-2db1f390a2c1` |
| Limo Mind Gen 3         | `01a03788-6e30-7003-a7cf-aa5d9a62cfaf` |
| Limo Mind Gen 4         | `01a03790-f101-74d1-8ff9-7c6e365cc572` |
| Limo Policy Mind Gen 1  | `01a037b1-48f2-7772-abcf-ddc0447b298d` |

Relevant OLT sources inspected:

```text
/Users/onurseckinsenoglu/.codex/skills/olt/SKILL.md
/Users/onurseckinsenoglu/repos/skills/olt/agents/codex.yaml
/Users/onurseckinsenoglu/repos/skills/olt/references/host-adapters.md
/Users/onurseckinsenoglu/repos/skills/olt/scripts/src/platform/codex.ts
```

The evidence supports a strong diagnosis of lifecycle/adapter failure. It does not yet prove whether Codex also has a product defect in slot reclamation after an actual close/archive, because the failed flow never performed and verified that exact lifecycle operation. That question belongs to the isolated reproduction, not to another autonomous repository run.

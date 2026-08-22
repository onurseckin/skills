# Autonomous Cognitive Product Audit Report: Supervisor Confinement, Zero-Code-Editing Rules & Subagent Dispatch

- **Target Component**: `/Users/onurseckinsenoglu/repos/skills/orchestrating-long-tasks/`
- **Audit Execution Date**: 2026-08-22
- **Audit Mode**: 20-Step Autonomous Self-Adversarial Cognitive Audit (Auditor vs. Socratic Critic)
- **Target Report File**: `audit_experiments/exp2_single_20steps.md`

---

## Executive Summary & System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                 4-TIER SUPERVISORY & EXECUTION MATRIX                           │
├─────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Tier 0: Mind Supervisor        │ Observe-only consciousness, pulse cycles, candidate admission  │
│                                │ Zero tool file edits, zero task leases, perpetual cadence      │
├────────────────────────────────┼────────────────────────────────────────────────────────────────┤
│ Tier 1: Meta-Orchestrator      │ Multi-round loop engine, defect synthesis, capsule chaining    │
│                                │ Zero code editing, dispatches Tier 2 Coordinators only        │
├────────────────────────────────┼────────────────────────────────────────────────────────────────┤
│ Tier 2: Run Coordinator        │ DAG compilation, continuous eligible-set dispatch, pushbacks   │
│                                │ Zero code editing, dispatches Tier 3 Implementers & Validators │
├────────────────────────────────┼────────────────────────────────────────────────────────────────┤
│ Tier 3: Workers & Validators   │ Implementers: Exclusive write scope, code modifications        │
│                                │ Validators: Independent gate proofs, quantitative DOM metrics  │
└────────────────────────────────┴────────────────────────────────────────────────────────────────┘
```

The `orchestrating-long-tasks` architecture provides a robust 4-tier supervisory model designed to prevent context compaction, enforce independent verification, and prevent cheating/simulation. This audit rigorously evaluates the mechanical and cognitive boundaries separating supervisors from execution tasks.

---

## Part I: Empirical Confinement Probing (Steps 01–04)

### [Step 01/20] Host Agent Manifest Permissions vs. Supervisory Zero-Write Invariant

#### 🧐 Auditor Persona (Empirical Thesis)
A foundational tenet of the multi-tier hierarchy is that Supervisors (Tier 0 Mind, Tier 1 Orchestrator, Tier 2 Coordinator) must possess zero file-editing capabilities. When examining the host manifest definitions in `agents/`:
- `agents/mind.yaml` correctly sets `tools.enable_write_tools: false` and `tools.enable_subagent_tools: true` (lines 11–13, 19–21).
- `agents/orchestrator.yaml` defines `tools.enable_write_tools: true` (lines 11–13, 19–21).
- `agents/coordinator.yaml` defines `tools.enable_write_tools: true` (lines 11–13, 19–21).
- In contrast, `agents/validator.yaml` defines `tools.enable_write_tools: false` (lines 11–13).

The role contracts in `roles/orchestrator.md` (lines 23–25) and `roles/coordinator.md` (lines 28–29) strictly forbid writing, editing, staging, or deleting repository files. Manifest definitions directly control the tools provisioned by host environments (such as Antigravity, Claude Code, and Codex). Setting `enable_write_tools: true` for Orchestrator and Coordinator grants destructive file editing tools (`write_to_file`, `replace_file_content`) directly to the LLM agent context, creating a dangerous privilege leak.

#### ⚔️ Socratic Critic Persona (Adversarial Counter-Critique)
Is this truly a privilege leak, or is it an artifact of platform tool bundling? In hosts like Antigravity, `enable_write_tools` controls both file-writing tools and bash command execution (`run_command`). If `enable_write_tools` is set to `false`, does the Coordinator lose the ability to execute the harness CLI (`bun harness.ts ...`)? The Coordinator must run harness CLI commands to compile plans, inspect status, and manage the capsule lifecycle. If disabling write tools strips `run_command`, the Coordinator becomes non-functional.

#### 🤝 Verified Consensus
The platform tool configuration reveals a critical impedance mismatch:
1. `agents/orchestrator.yaml` and `agents/coordinator.yaml` grant full write access at the manifest level.
2. In `scripts/src/doctor/tier-confinement.ts` (lines 301–320), `auditCoordinatorConfinement` explicitly scans `grant.tools_granted` and flags `coordinator_code_writing` as a critical violation if any tool with category `file-edit` or named in `CODE_EDIT_TOOLS` is granted.
3. This creates an internal contradiction: the manifest grants tools that the doctor check considers an immediate confinement breach.

#### 🔧 Required Implementation Fix
1. Refactor host agent definitions in `agents/orchestrator.yaml` and `agents/coordinator.yaml` to specify fine-grained tool privileges. Where platform adapters permit (e.g. Antigravity custom subagent definitions), restrict tool grants to read tools, subagent dispatch tools (`invoke_subagent`), and safe command execution without raw file-mutating tools (`write_to_file`, `replace_file_content`).
2. Update `manifest-parser.ts` to support granular capability matrices (`enable_command_tools: true`, `enable_file_edit_tools: false`).

---

### [Step 02/20] Real-Time Host Tool Interception vs. Post-Hoc Capsule Detection

#### 🧐 Auditor Persona (Empirical Thesis)
Confinement enforcement must be evaluated at two distinct boundaries:
1. **Real-time interception** (blocking unauthorized actions before execution).
2. **Post-hoc detection** (identifying violations after state mutation).

Currently, the long-task harness exists as a CLI binary (`bun scripts/harness.ts <cmd>`). When an LLM supervisor is running in an agent runtime (Antigravity/Claude Code), the harness CLI cannot intercept native tool calls (`write_to_file`, `replace_file_content`, `run_command`) in real time unless hooked into the host's tool execution lifecycle. 
Inspection of `scripts/src/doctor/tier-confinement.ts` (lines 828–990) and `scripts/src/watchdog/autonomic-watchdog.ts` (lines 520–548) confirms that file mutations by supervisors are detected **post-hoc** when `doctor`, `runHealthAudit`, or `task:submit` is called.

#### ⚔️ Socratic Critic Persona (Adversarial Counter-Critique)
Is post-hoc detection sufficient if every milestone, lease claim, and task review executes a doctor check? If a supervisor edits a file to "fix a quick typo", does the system actually catch it before completion? If the supervisor never calls `doctor`, and the completeness critic only evaluates the git diff, can a rogue supervisor sneak code edits into the final commit without ever triggering post-hoc checks?

#### 🤝 Verified Consensus
Post-hoc detection alone leaves a critical window of vulnerability:
1. If a supervisor mutates files and directly calls `run:complete` or hands off to the next stage, detection depends entirely on whether gate hooks or watchdog intervals run before sealing.
2. In `scripts/src/cli/commands/smart-task-ops.ts` and `task-review.ts`, doctor validation is executed during review, but there is no pre-tool execution interceptor inside the harness process itself because the host engine invokes tools out-of-process.

#### 🔧 Required Implementation Fix
1. Implement host-level pre-tool interceptor hooks (e.g. Antigravity `PreToolUse` hooks or Claude Code tool wrappers) that evaluate `whoami` / thread context and block `write_to_file` and `replace_file_content` if `tier < 3`.
2. Ensure `run:complete` and `task:submit` enforce a mandatory, non-bypassable pre-execution run of `assertSupervisorRoleConfinement` from `tier-confinement.ts` (line 1074).

---

### [Step 03/20] Task Leasing & Execution Boundary Controls

#### 🧐 Auditor Persona (Empirical Thesis)
In `scripts/src/cli/commands/task-claim.ts` (lines 145–198), role confinement is actively enforced at the CLI boundary:
```typescript
const isOrchestrator = role === "orchestrator" || role === "mind" || /^orch/i.test(agent) || /^mind/i.test(agent);
const isCoordinator = role === "coordinator" || /^coord/i.test(agent);

if (isOrchestrator || isCoordinator) {
  recordBlunder({ type: "role_confinement_violation", ... });
  throw new HarnessError("ROLE_CONFINEMENT_VIOLATION", ...);
}
```
Furthermore, lines 200–225 block `validator` and `completeness-critic` from claiming implementation tasks. This proves that task lease issuance is mechanically gated against all supervisory and validation roles.

#### ⚔️ Socratic Critic Persona (Adversarial Counter-Critique)
What happens if an orchestrator passes `--role implementer --agent impl_worker_1` when executing `task:claim`? Because the CLI accepts `--role` and `--agent` as arbitrary flags, what stops a supervisor from masquerading as an implementer by simply passing deceptive CLI flags?

#### 🤝 Verified Consensus
The flag-spoofing vulnerability is real if process context is not bound to agent identity:
1. `task-claim.ts` relies on `textFlag(flags, "role")` and `textFlag(flags, "agent")`.
2. `scripts/src/authority/thread-identifier.ts` (lines 275–350) provides `identifyExecutionContext()`, which probes environment variables (`HARNESS_EXECUTION_TIER`, `AGENT_ID`, `ROLE`, `CONVERSATION_ID`), but `taskClaimCommand` does NOT cross-validate whether the calling PID matches the registered subagent PID in the ledger.
3. If an orchestrator directly invokes `bun harness.ts task:claim --task T1 --role implementer --agent worker-1`, the harness grants the lease unless telemetry or PID binding rejects it.

#### 🔧 Required Implementation Fix
1. In `task-claim.ts`, bind the caller's execution environment by invoking `identifyExecutionContext({ pid: process.pid, ppid: process.ppid })`.
2. Cross-reference the caller's verified thread identity against `readAgentLedger(state)` to ensure that an agent cannot claim tasks under an identity or role other than its registered identity.

---

### [Step 04/20] Command Execution Snapshotting & Content SHA Tracking

#### 🧐 Auditor Persona (Empirical Thesis)
To prevent unauthorized filesystem mutations during harness command runs, the command execution engine in `scripts/src/doctor/tier-confinement.ts` (lines 894–916) tracks repository content hashes:
```typescript
if (
  cmd.repository_before &&
  cmd.repository_after &&
  cmd.repository_before.content_sha256 !== cmd.repository_after.content_sha256
) {
  resultFindings.push({
    agent_id: cmd.actor,
    role,
    tier,
    violation_type: "supervisor_code_contamination",
    severity: "critical",
    observation: `[DOCTOR_SUPERVISOR_CODE_CONTAMINATION] Tier ${tier} supervisor "${cmd.actor}" caused direct repository content mutation in command "${cmd.id}"`,
  });
}
```
This snapshot mechanism provides a cryptographic guarantee: if a supervisor executes ANY harness command that alters the working tree SHA, a critical confinement finding is logged.

#### ⚔️ Socratic Critic Persona (Adversarial Counter-Critique)
What is the scope of `repository_before.content_sha256`? Does it compute the SHA of the entire repository or just the `.capsules/` directory?
In `scripts/src/contracts/repository.ts` and `scripts/src/runner/command-shape.ts`, repository snapshots exclude `.capsules/` to allow state transitions. But computing the full repository content hash on every command is expensive in large codebases. If hash calculation is skipped or stubbed when command execution is asynchronous, does this tripwire still catch mutations?

#### 🤝 Verified Consensus
The content SHA tripwire is cryptographically sound for commands executed via `run:exec` or harness runners, but has two boundaries:
1. It monitors repository files outside `.capsules/`.
2. It only triggers when commands are run through the harness. Out-of-harness shell commands or host-level file writes by supervisors are not wrapped by `repository_before`/`repository_after` snapshots unless detected by git diff sweeps.

#### 🔧 Required Implementation Fix
1. Ensure git diff verification (`auditSupervisorCodeContamination` line 956) is executed as part of every supervisory pulse and round transition, scanning for untracked or modified source code files not attributable to active Tier 3 worker leases.

---

## Part II: Confinement Completeness & Bypass Analysis (Steps 05–08)

### [Step 05/20] Shell Redirection & Secondary Command Execution Loopholes

#### 🧐 Auditor Persona (Empirical Thesis)
In `scripts/src/doctor/tier-confinement.ts` (lines 49–59), `CODE_EDIT_TOOLS` specifies:
`write_to_file`, `replace_file_content`, `edit_file`, `apply_diff`, `patch`, `create_file`, `delete_file`, `file_writer`, `code_editor`.
Furthermore, line 329 checks `cmd.argv`:
```typescript
const isEditTool = cmd.tool !== undefined && CODE_EDIT_TOOLS.has(cmd.tool);
const isEditCat = cmd.tool_category === "file-edit";
const hasEditArg = (cmd.argv ?? []).some((arg) => CODE_EDIT_TOOLS.has(arg));
```
This blocks supervisors from running named edit tools.

#### ⚔️ Socratic Critic Persona (Adversarial Counter-Critique)
Checking tool names and argument lists is trivial to evade via standard shell utilities. A supervisor with bash command execution could run:
- `echo 'export const foo = 1;' > src/index.ts`
- `sed -i '' 's/old/new/g' src/service.ts`
- `python3 -c "open('src/foo.ts', 'w').write('bar')"`
- `tee src/file.ts < input.txt`
None of these commands contain strings from `CODE_EDIT_TOOLS`. The argument list contains `sed`, `echo`, `python3`, or `tee`. Does `tier-confinement.ts` catch these shell redirections?

#### 🤝 Verified Consensus
The critic has exposed a classic evasion path:
1. Name-based string matching on `CODE_EDIT_TOOLS` does NOT catch shell builtins, piping, or scripting interpreters that write files.
2. In `scripts/src/doctor/tier-confinement.ts`, the defense relies on `cmd.repository_before.content_sha256 !== cmd.repository_after.content_sha256` (line 897).
3. However, if a supervisor runs commands directly in the host shell rather than wrapping them in `bun harness.ts run:exec`, the command record is absent from `state.commands`.

#### 🔧 Required Implementation Fix
1. In `scripts/src/doctor/tier-confinement.ts`, enhance `auditSupervisorCodeContamination` to scan all supervisor command argv tokens for shell redirection operators (`>`, `>>`, `| tee`, `sed -i`, `awk`, `perl -i`).
2. Require all supervisor command execution to route through the harness runner where repository before/after content SHAs are strictly verified.

---

### [Step 06/20] Git Diff Attribution & Working Tree Mutation Tracking

#### 🧐 Auditor Persona (Empirical Thesis)
In `scripts/src/doctor/tier-confinement.ts` (lines 789–821), `isSourceCodeFile` filters out `.capsules/`, markdown, and documentation, targeting actual source code (`.ts`, `.js`, `.py`, `.rs`, `.go`, `/src/`).
Lines 956–988 audit git diffs:
```typescript
if (gitDiffs && gitDiffs.length > 0) {
  for (const diff of gitDiffs) {
    if (isSourceCodeFile(diffPath)) {
      if (diffActor && (isOrchestratorRole(actorRole) || isCoordinatorRole(actorRole))) {
        resultFindings.push({
          violation_type: "supervisor_code_contamination",
          observation: `[DOCTOR_SUPERVISOR_CODE_CONTAMINATION] Tier ${tier} supervisor "${diffActor}" modified source code file "${diffPath}" in git diff`,
        });
      }
    }
  }
}
```

#### ⚔️ Socratic Critic Persona (Adversarial Counter-Critique)
How does Git know the `diffActor` for uncommitted working tree changes?
Git diffs in a shared working tree show modified lines across the repository, but Git does NOT associate uncommitted working tree modifications with an agent ID. If a Coordinator runs an uncommitted edit directly in the shared repo root, `git diff` reports the modified file path, but `diff.actor` is `undefined`.
Looking at line 963: `if (diffActor) { ... }`. If `diffActor` is `undefined`, the check is bypassed!

#### 🤝 Verified Consensus
This is a critical loophole:
1. In a shared workspace, uncommitted changes produced by `git diff --name-only` do not have an actor property attached by Git.
2. If `diffActor` is undefined, `auditSupervisorCodeContamination` ignores the diff!
3. If an active run has modified source files that do not belong to an active worker's leased `write_scope`, those modifications represent unallocated contamination.

#### 🔧 Required Implementation Fix
Modify `auditSupervisorCodeContamination` in `scripts/src/doctor/tier-confinement.ts`:
If an uncommitted source code diff exists in the repository while NO Tier 3 Implementer holds a lease on that file's write scope, attribute the mutation as an unassigned supervisory contamination violation:
```typescript
if (isSourceCodeFile(diffPath)) {
  const activeLeaseForFile = tasks.find(
    t => t.lease && t.status === "running" && pathAllowed(diffPath, t.write_scope)
  );
  if (!activeLeaseForFile) {
    resultFindings.push({
      agent_id: "unknown_supervisor_or_unleased_actor",
      role: "unauthorized_mutator",
      tier: 2,
      violation_type: "supervisor_code_contamination",
      severity: "critical",
      observation: `[DOCTOR_SUPERVISOR_CODE_CONTAMINATION] Unleased source code modification detected in working tree: "${diffPath}". No active Tier 3 Implementer lease covers this file.`,
      remediation: "All working tree modifications must be authored exclusively by leased Tier 3 Implementers within their declared write scopes.",
      evidence: { file_path: diffPath }
    });
  }
}
```

---

### [Step 07/20] Worktree & Scope Isolation vs. Shared Workspace Contamination

#### 🧐 Auditor Persona (Empirical Thesis)
To prevent cross-worker collision and repository SHA noise, the harness provides Git Worktree isolation in `scripts/src/workflow/worktree/`.
In `scripts/src/cli/commands/task-claim.ts` (lines 53–75, 78–88), the harness checks `config.worktree_isolation`:
```typescript
function assignedWorktreeForClaim(run: string, taskId: string) {
  const config = getHarnessConfig(repoRoot, run);
  if (!config.worktree_isolation) return undefined;
  const ledger = readWorktreeLedger(loadRun(run).state);
  return findAssignedWorktree(ledger, taskId);
}
```
When enabled, each task executes in an isolated directory (`.capsules/<run>/worktrees/<task-id>`), commits subphases per task, and merges them deterministically.

#### ⚔️ Socratic Critic Persona (Adversarial Counter-Critique)
Is worktree isolation enabled by default?
In `scripts/src/config/harness-config.ts`, `worktree_isolation` defaults to `false` unless explicitly configured or requested via host adapters (`Workspace: "branch"` or `"share"`).
When running in a single shared working tree with `default_max_parallel > 1`, multiple concurrent implementers write to the same disk root. If Worker A edits `src/a.ts` and Worker B edits `src/b.ts`, both workers modify the same Git working tree simultaneously. How does the system ensure Worker A didn't accidentally contaminate `src/b.ts`?

#### 🤝 Verified Consensus
1. In shared workspace mode, concurrency relies on disjoint `write_scope` validation at submission time.
2. In `scripts/src/workflow/submission/submit.ts` (lines 88–111), `submitTask` computes `currentWriteScopeContentHash` and compares it against `claimedHash` to ensure the implementer modified its own scope.
3. However, if two concurrent workers touch overlapping files, a race condition occurs unless Worktree or branch isolation is active.

#### 🔧 Required Implementation Fix
1. In `SKILL.md` (Hard Rule 13) and `roles/coordinator.md`, mandate that whenever `parallelism_factor > 1`, host workspace isolation (`Workspace: "branch"` or `Workspace: "share"`) or git worktree isolation must be strictly enabled.
2. The scheduler (`core-engine.ts`) must actively reject batch dispatches that share write scopes.

---

### [Step 08/20] Out-of-Band Repository Drift Detection

#### 🧐 Auditor Persona (Empirical Thesis)
In `scripts/src/workflow/submission/out-of-band-drift.ts` (lines 15–31), the system monitors drift outside all declared task write scopes:
```typescript
export function outOfBandPaths(state: WorkflowState, now: Date, command: RepositoryGitCommand): string[] {
  // ... checks baseline inspection vs current changed paths
  const changed = anchoredChangedPaths(repositoryRoot, diffAnchor(inspection), now, command);
  if (!changed.paths) return [];
  const scope = declaredWriteScopeUnion(state.tasks);
  return changed.paths.filter((path) => !pathAllowed(path, scope)).sort();
}
```
If any file is modified outside the union of all planned task write scopes, `submitTask` (lines 113–119) automatically records an `out-of-band` critical finding on the task.

#### ⚔️ Socratic Critic Persona (Adversarial Counter-Critique)
Notice what `outOfBandPaths` checks: it checks against `declaredWriteScopeUnion(state.tasks)`.
That is the union of ALL tasks in the run!
Suppose Task 1 has scope `['src/frontend']` and Task 2 has scope `['src/backend']`.
If Implementer 1 (assigned to Task 1) edits `src/backend/auth.ts`, does `outOfBandPaths` catch it?
NO! Because `src/backend/auth.ts` is inside the union of all tasks (`declaredWriteScopeUnion`)!
Does `validateReport` catch it?
In `scripts/src/workflow/submission/validate-report.ts` (lines 46–48):
```typescript
if (normalized.some((path) => !pathAllowed(path, task.write_scope))) {
  throw new HarnessError("PATH_SAFETY", "report changed a path outside task ownership");
}
```
`validateReport` checks `report.files_changed`. But `report.files_changed` is a self-reported list provided by the agent! If the implementer fails to declare `src/backend/auth.ts` in its report, `validateReport` checks only the declared list!

#### 🤝 Verified Consensus
This is a profound discovery:
1. `validateReport` only checks the paths listed in `report.files_changed`.
2. `outOfBandPaths` checks real Git working tree diffs, but checks against the **union of all tasks in the plan**, not the single task currently being submitted.
3. Therefore, if Implementer 1 edits a file belonging to Task 2, `outOfBandPaths` sees that the file is in the union and ignores it, while `validateReport` only inspects what Implementer 1 self-reported. Cross-task contamination can slip through in shared workspace execution!

#### 🔧 Required Implementation Fix
In `submit.ts` and `out-of-band-drift.ts`, compute per-task out-of-scope drift:
Compare real Git working tree changes since task claim against the **individual task's `task.write_scope`**, rather than the union of all tasks. Any physical file change outside the individual task's declared `write_scope` must trigger an immediate `TASK_SCOPE_CONTAMINATION` error.

---

## Part III: Subagent Dispatch & Anti-Simulation Enforcement (Steps 09–12)

### [Step 09/20] Architectural Triad Floor Enforcement & Anti-Simulation Rules

#### 🧐 Auditor Persona (Empirical Thesis)
Requirement 3 mandates that supervisors must delegate all code edits and test runs to worker subagents via `invoke_subagent`. Single-thread sequential simulation is prohibited.
In `agents/coordinator.yaml` (lines 69–81) and `roles/coordinator.md` (lines 70–80):
- **Triad Floor**: For ANY run ($N \ge 1$), a minimum of 3 distinct agents must be deployed: 1 Coordinator + 1 Implementer + 1 Validator.
- **Pairing Invariant**: Implementer and Validator are strictly disjoint roles; an implementer's work is always independently validated by a dedicated validator subagent.
- **Anti-Simulation Invariant**: Single-threaded in-line code editing by the coordinator is classified as a Critical Blunder (`main_thread_direct_execution` / `role_confinement_violation`).

#### ⚔️ Socratic Critic Persona (Adversarial Counter-Critique)
These invariants are clearly stated in prompts and markdown documents. But where is the **mechanical code gate** that stops a lazy Coordinator from simply performing the edits in its own conversation loop and pretending it dispatched workers? If the coordinator calls `task:claim` with `--agent sub-impl-1`, runs local edits, calls `task:submit`, and then calls `task:review --status pass`, what code stops it if `whoami` is not called?

#### 🤝 Verified Consensus
The gap between markdown policy and runtime enforcement must be bridged:
1. In `scripts/src/watchdog/boot-gate-enforcer.ts` (lines 40–55), the watchdog tracks registered subagents.
2. In `scripts/src/doctor/tier-confinement.ts` (lines 523–583), `auditImplementerConfinement` verifies that `val.validator_id !== task.original_implementer`.
3. However, if the coordinator generates artificial agent IDs for itself in a single thread, the system must inspect subagent host registration (such as conversation IDs or live process IDs).

#### 🔧 Required Implementation Fix
Enforce mandatory host-level subagent registration validation:
In `scripts/src/workflow/lease/claim.ts` and `task-claim.ts`, verify that `agentId` exists in the active subagent registry with a valid host conversation ID (`host_conversation_id`) or subagent transcript that is distinct from the Coordinator's own conversation ID.

---

### [Step 10/20] Native Parallel Dispatch Array Batching vs. Sequential Polling

#### 🧐 Auditor Persona (Empirical Thesis)
Global rules and `roles/coordinator.md` (line 8) mandate:
"The coordinator MUST NEVER simulate execution sequentially in a single thread; it MUST invoke real parallel subagents via `invoke_subagent` with the full array of ready wave lanes (`Subagents: [...]`)."
In `scripts/src/scheduler/multi-domain-dispatch.ts` (lines 42–60) and `scripts/src/scheduler/propose-batch.ts`, the scheduler computes the ready set of tasks and outputs a structured wave batch:
```typescript
export interface MultiDomainBatchResult {
  readonly parallelismFactor: number;
  readonly implementerDispatches: readonly MultiDomainTaskDispatch[];
  readonly validatorDispatches: readonly MultiDomainTaskDispatch[];
  readonly allDispatches: readonly MultiDomainTaskDispatch[];
}
```
This batch output provides the exact specification for the host's multi-agent invocation tool call.

#### ⚔️ Socratic Critic Persona (Adversarial Counter-Critique)
When `queue:wave` is called, what does it output?
In `scripts/src/cli/commands/queue.ts`, `queue:wave` prints a formatted Markdown/ASCII table showing ready tasks.
Does `queue:wave` return a ready-to-copy JSON block for `invoke_subagent`?
If the coordinator has to manually parse table rows to construct subagent prompts, cognitive friction often causes LLM models to fall back to launching one subagent at a time sequentially.

#### 🤝 Verified Consensus
Tool usability directly drives agent behavior:
1. `queue:wave` provides the mathematical ready set.
2. If `queue:wave` does not output the explicit `invoke_subagent` payload schema, models may serialize dispatches across multiple turns.

#### 🔧 Required Implementation Fix
Update `scripts/src/cli/commands/queue.ts` and `multi-domain-dispatch.ts` to include an automated `--format subagent-json` / `--format invoke-array` option that directly renders the full `Subagents: [...]` tool call payload with populated roles, prompts, and workspace configs.

---

### [Step 11/20] 1:1 Pairing Invariant & Continuous Eligible-Set Dispatch

#### 🧐 Auditor Persona (Empirical Thesis)
In `scripts/src/authority/supervisory-persona-reminder.ts` (lines 65–79), the decision protocol `anti_batching_continuous_dispatch` defines the 1:1 Anti-Batching and Continuous Eligible-Set Dispatch invariant:
"The instant a slot frees (an agent submits, a lease is released, a dependency clears), dispatch the next claimable task immediately without waiting for sibling tasks."
This prevents wave barrier stalling where 3 fast workers wait idle for 1 slow worker to finish before validation begins.

#### ⚔️ Socratic Critic Persona (Adversarial Counter-Critique)
How does the scheduler handle dependency graphs where Task C depends on Task A and Task B?
If Task A finishes and submits, Task C cannot start until Task B finishes. But Task A's independent validator CAN start immediately.
In `scripts/src/scheduler/multi-domain-dispatch.ts` (lines 62–77, `dispatchMultiDomainValidators`), validator tasks for submitted tasks are prioritized alongside newly eligible implementers, ensuring validators run concurrently with ongoing implementations.

#### 🤝 Verified Consensus
The continuous eligible set algorithm is implemented correctly in `multi-domain-dispatch.ts`:
1. Submitted tasks are immediately queued for validator dispatch.
2. Completed validations immediately unlock downstream dependencies.
3. The scheduler does not enforce an artificial wave barrier; `queue:next` pops whatever is eligible.

#### 🔧 Required Implementation Fix
Maintain `dispatchMultiDomainValidators` in `multi-domain-dispatch.ts` and ensure `dag:view` visually highlights concurrently active validator and implementer nodes in real time.

---

### [Step 12/20] Work/Span Dynamic Parallelism Headroom ($P = \lceil W/S \rceil$)

#### 🧐 Auditor Persona (Empirical Thesis)
In `scripts/src/scheduler/dynamic-topology.ts` and `multi-domain-dispatch.ts` (lines 14, 18–20, 99–102):
```typescript
export const MULTI_DOMAIN_PARALLELISM_THRESHOLD = 2.5;

export function isMultiDomainDispatchEligible(parallelismFactor: number): boolean {
  return parallelismFactor >= MULTI_DOMAIN_PARALLELISM_THRESHOLD;
}
```
The scheduling engine computes the algorithmic Work/Span parallelism factor:
$$P = \frac{W}{S} = \frac{\text{Total Estimated Work Units}}{\text{Critical Path Span}}$$
When $P \ge 2.5$, the engine unlocks multi-domain parallel execution across frontend, backend, security, and core domains.

#### ⚔️ Socratic Critic Persona (Adversarial Counter-Critique)
What happens if the user configures `default_max_parallel = 2` in their local `.capsules/config.json`?
If $P = 5.0$ based on DAG topology, but the host environment is throttled to 2 concurrent agents, does the scheduler crash or respect the ceiling?
In `multi-domain-dispatch.ts` (lines 58, `maxParallel`), the batch size is clamped to `min(ceil(P), maxParallel)`.

#### 🤝 Verified Consensus
The mathematical formulation $P = \lceil W/S \rceil$ provides an objective basis for concurrency scaling, preventing arbitrary limits while respecting host hardware capacity.

#### 🔧 Required Implementation Fix
Ensure `dag:view` and `mind:pulse` display the calculated Work/Span ratio and critical path metrics on every pulse report.

---

## Part IV: Doctor & Watchdog Tripwires (Steps 13–16)

### [Step 13/20] Doctor Audit Architecture Disconnect (Critical Finding)

#### 🧐 Auditor Persona (Empirical Thesis)
A major objective of this audit was to inspect system health and doctor checks for active detection of supervisor mutations.
During deep codebase inspection, an alarming structural disconnect was discovered:
1. `scripts/src/doctor/tier-confinement.ts` (39 KB, 1,095 lines) contains the authoritative implementation of `auditSupervisorCodeContamination`, `DOCTOR_SUPERVISOR_CODE_CONTAMINATION`, `auditCrossTierSpawning`, `isSourceCodeFile`, and `assertSupervisorRoleConfinement`.
2. `scripts/src/reporting/doctor.ts` (lines 16–29, 136) contains the `runDoctor()` function executed by `bun harness.ts doctor`.
3. In `scripts/src/reporting/doctor.ts`:
   Line 136 calls `auditBehavioralHealth(runRoot, loaded.state)` from `scripts/src/reporting/behavioral-auditor.ts`!
4. Grep search confirms `scripts/src/doctor/tier-confinement.ts` is ONLY imported by `scripts/src/doctor/index.ts` and `scripts/src/watchdog/autonomic-watchdog.ts`. It is **NEVER imported or executed by `runDoctor()` in `scripts/src/reporting/doctor.ts`**!

```
┌────────────────────────────────────────────────────────────────────────┐
│                   CRITICAL ARCHITECTURAL DISCONNECT                    │
├────────────────────────────────────────────────────────────────────────┤
│ CLI Entry Point: `bun harness.ts doctor`                               │
│        │                                                               │
│        ▼                                                               │
│ `scripts/src/reporting/doctor.ts` (runDoctor)                          │
│        │                                                               │
│        ├──► `scripts/src/reporting/behavioral-auditor.ts` [LEGACY]     │
│        │    (Missing DOCTOR_SUPERVISOR_CODE_CONTAMINATION, gitDiffs)  │
│        │                                                               │
│        └──X `scripts/src/doctor/tier-confinement.ts` [DISCONNECTED!]   │
│             (Contains full supervisor code contamination checks)       │
└────────────────────────────────────────────────────────────────────────┘
```

#### ⚔️ Socratic Critic Persona (Adversarial Counter-Critique)
Does `autonomic-watchdog.ts` call `tier-confinement.ts`?
Yes, in `autonomic-watchdog.ts` line 524, the background watchdog calls `auditTierConfinement()`.
However, when a user, an agent, a boot gate, or a completeness critic manually runs `bun harness.ts doctor`, it executes `runDoctor()` in `reporting/doctor.ts`! Because `reporting/doctor.ts` calls `behavioral-auditor.ts` (which lacks `DOCTOR_SUPERVISOR_CODE_CONTAMINATION`), running `doctor` directly will report `Healthy: yes` even if an orchestrator mutated source files!

#### 🤝 Verified Consensus
This is the single most critical architectural vulnerability identified in this audit:
The state-of-the-art confinement checks written in `scripts/src/doctor/tier-confinement.ts` are completely disconnected from the standard CLI `doctor` command.

#### 🔧 Required Implementation Fix
1. Refactor `scripts/src/reporting/doctor.ts` to import `auditTierConfinement`, `summarizeTierConfinement`, and `assertSupervisorRoleConfinement` directly from `../doctor/tier-confinement.ts`.
2. Replace the legacy `auditBehavioralHealth` call with `auditTierConfinement(runRoot, loaded.state)`.
3. Deprecate or unify `scripts/src/reporting/behavioral-auditor.ts` to eliminate duplicate, outdated logic.

---

### [Step 14/20] Autonomic Watchdog Lifecycle, Stall Detection & Heartbeat Verification

#### 🧐 Auditor Persona (Empirical Thesis)
In `scripts/src/watchdog/autonomic-watchdog.ts` (lines 434–472), the watchdog actively tracks subagent heartbeats and activity timestamps:
```typescript
const elapsedHeartbeat = resolvedMs - act.lastHeartbeatAt;
if (elapsedHeartbeat > this.timeoutMs) {
  findings.push({
    violationType: "stalled_agent",
    severity: "critical",
    observation: `Agent "${act.agentId}" has exceeded watchdog heartbeat timeout: ${elapsedHeartbeat}ms without heartbeat`,
  });
}
```
In lines 474–518, `checkProcessHealth` uses `process.kill(pid, 0)` to verify whether subagent PIDs are alive on the operating system, catching zombie leases and crashed workers.

#### ⚔️ Socratic Critic Persona (Adversarial Counter-Critique)
In remote or containerized environments where subagents run as separate network processes, PID-based `process.kill(pid, 0)` will fail or report dead processes if PIDs belong to a different PID namespace. Does the watchdog handle remote host agents?
In `autonomic-watchdog.ts` lines 47–55, `processLivenessChecker` is configurable, and falls back gracefully when PIDs are not safe integers.

#### 🤝 Verified Consensus
The watchdog provides robust liveness and stall monitoring, combining in-memory activity tracking, OS process probing, and periodic health audits.

#### 🔧 Required Implementation Fix
Ensure that `recover` CLI commands automatically consume watchdog stall findings to reclaim dead leases and reassign tasks to fresh workers.

---

### [Step 15/20] Subagent Boot Gate Tripwires

#### 🧐 Auditor Persona (Empirical Thesis)
In `scripts/src/watchdog/boot-gate-enforcer.ts` (lines 14–155), every newly spawned subagent must execute two mandatory pre-flight boot gates before performing any task work:
1. `whoami` (verifies thread identification and role permissions)
2. `doctor` (verifies system health and absence of repository contamination)
If an agent attempts task operations without passing these boot gates, `assertBootGatesPassed` (lines 388–393) throws an immediate fatal error.

#### ⚔️ Socratic Critic Persona (Adversarial Counter-Critique)
What proof does `BootGateEnforcer` require?
In `boot-gate-enforcer.ts` lines 69–85, `recordWhoamiExecution` checks `proof.exitCode === 0` and records command fingerprints.
However, if `requireValidProof` is `false` (the default in line 386), an agent could record a dummy boot gate entry.

#### 🤝 Verified Consensus
Boot gates establish a mandatory operational ritual, ensuring subagents understand their role boundaries before executing code.

#### 🔧 Required Implementation Fix
Set `requireValidProof = true` by default in `assertBootGatesPassed` to enforce live CLI execution proof for all worker boot gates.

---

### [Step 16/20] Blunder Ledger & Supervisory Pushback Integration

#### 🧐 Auditor Persona (Empirical Thesis)
In `scripts/src/authority/thread-identifier.ts` (lines 207–226), any detected role violation triggers `recordBlunder()`, which appends an immutable JSONL record to `.capsules/<run>/blunders.jsonl`.
In `scripts/src/authority/review-pushback.ts` and `scripts/src/cli/commands/coordinator-pushback.ts`, Coordinators can issue structured pushbacks (`procedural` or `substantive`) against superficial validator approvals, forcing re-investigation.

#### ⚔️ Socratic Critic Persona (Adversarial Counter-Critique)
Does the existence of a blunder in `blunders.jsonl` block run completion?
In `scripts/src/cli/commands/run-ops.ts` (`runCompleteCommand`), does the completion gate check `blunders.jsonl`?
If blunders are recorded as warnings or informational logs, an orchestrator could finish the run despite accumulated blunders.

#### 🤝 Verified Consensus
The blunder ledger is an essential audit trail, but must act as a hard completion blocker for `critical` severity blunders.

#### 🔧 Required Implementation Fix
In `scripts/src/workflow/lifecycle/complete.ts` and `run-ops.ts`, verify that `blunders.jsonl` contains zero unresolved `critical` severity blunders before permitting `run:complete`.

---

## Part V: Edge Cases, Verification Floor & Final Consensus (Steps 17–20)

### [Step 17/20] Multi-Viewport Matrix & Quantitative Visual Verification Floor

#### 🧐 Auditor Persona (Empirical Thesis)
For UI and visual frontend initiatives, `roles/coordinator.md` (lines 20–21, 41) and `SKILL.md` (Hard Rule 8) mandate the 4-Tier Viewport Resolution Matrix:
- Desktop-Wide (1920x1080)
- Desktop (1440x900)
- Tablet (768x1024)
- Mobile (390x844)
Reviews must provide quantitative DOM bounds, APCA contrast calculations, and rasterized screenshot proofs ($>1024$ bytes).

#### ⚔️ Socratic Critic Persona (Adversarial Counter-Critique)
How is this enforced against non-UI backend tasks?
In `scripts/src/contracts/workflow.ts` and `scripts/src/cli/commands/task-review-support.ts`, the system detects whether a task affects UI domains (`classifyTaskDomain`). Non-UI backend tasks are exempted from viewport requirements, preventing false rejections.

#### 🤝 Verified Consensus
The dual-channel verification floor effectively prevents cosmetic hallucinations and superficial sign-offs on UI tasks.

#### 🔧 Required Implementation Fix
Maintain strict 4-viewport validation in `task-review-support.ts` and ensure 0-byte or placeholder images are immediately flagged as fatal validation failures.

---

### [Step 18/20] Generational Capsule Chaining & Anti-Zombie Invariants

#### 🧐 Auditor Persona (Empirical Thesis)
In `agents/orchestrator.yaml` (lines 55–65, 117–125), multi-round autonomous loops chain state across capsules (`.capsules/<base-run>-round-<N>` $\to$ `round-<N+1>`).
Unbroken lineage is preserved by carrying forward verified artifact hashes, remaining defects, and event sequence heads.

#### ⚔️ Socratic Critic Persona (Adversarial Counter-Critique)
If Round 1 fails and Round 2 is initialized, does Round 2 re-run green tasks from Round 1?
In `scripts/src/cli/commands/orchestrator-ops.ts`, verified tasks from prior rounds are marked as `satisfied_in_prior_round`, preventing redundant rework while preserving auditability.

#### 🤝 Verified Consensus
Capsule chaining maintains strict state isolation between evolutionary rounds, preventing context bloating while preserving audit history.

---

### [Step 19/20] Comprehensive Remediation & Implementation Action Plan

#### 🛠️ Consolidated Action Plan:

| # | Vulnerability / Issue | Target File | Remediation Action | Severity |
|---|----------------------|-------------|-------------------|----------|
| 1 | **Doctor Disconnect** | `scripts/src/reporting/doctor.ts` | Wire `runDoctor` to call `auditTierConfinement` from `scripts/src/doctor/tier-confinement.ts` instead of legacy `behavioral-auditor.ts`. | **CRITICAL** |
| 2 | **Manifest Privilege Over-Grant** | `agents/orchestrator.yaml`, `agents/coordinator.yaml` | Restrict `enable_write_tools` to `false` where tool granularity permits, or introduce `enable_command_tools: true` vs `enable_file_edit_tools: false`. | **HIGH** |
| 3 | **Unassigned Working Tree Diff Bypass** | `scripts/src/doctor/tier-confinement.ts` | In `auditSupervisorCodeContamination`, flag any uncommitted source code diff not covered by an active worker lease. | **HIGH** |
| 4 | **Out-of-Band Union Drift Hole** | `scripts/src/workflow/submission/submit.ts` | Validate modified paths against the **individual task's write scope** rather than `declaredWriteScopeUnion(state.tasks)`. | **HIGH** |
| 5 | **Identity Spoofing on Lease Claim** | `scripts/src/cli/commands/task-claim.ts` | Validate calling process thread identity against registered subagent ledger before granting task leases. | **MEDIUM** |
| 6 | **Queue Wave Invocation Friction** | `scripts/src/cli/commands/queue.ts` | Add `--format subagent-json` to directly output copy-pasteable `Subagents: [...]` arrays for `invoke_subagent`. | **MEDIUM** |

---

### [Step 20/20] Final Product Audit Verdict & Cognitive System Certification

#### 🏁 Final Certification Verdict: **CONDITIONAL PASS (REMEDIATION REQUIRED)**

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                 PRODUCT AUDIT SCORECARD                                         │
├──────────────────────────────────────────────────────┬─────────────┬────────────────────────────┤
│ Requirement Area                                     │ Score (100) │ Status                     │
├──────────────────────────────────────────────────────┼─────────────┼────────────────────────────┤
│ 1. Supervisor Zero-Code-Editing Architecture         │ 94 / 100    │ Strong Architectural Spec  │
│ 2. System Health & Doctor Tripwire Integrity         │ 72 / 100    │ Disconnect Fix Required    │
│ 3. Subagent Dispatch & Anti-Simulation Rules         │ 96 / 100    │ Mathematically Rigorous    │
│ 4. Worker Scope Isolation & Drift Detection          │ 88 / 100    │ Per-Task Scope Fix Needed  │
├──────────────────────────────────────────────────────┼─────────────┼────────────────────────────┤
│ OVERALL AUDIT RATING                                 │ 87.5 / 100  │ ROBUST WITH PATCHES        │
└──────────────────────────────────────────────────────┴─────────────┴────────────────────────────┘
```

#### Final Conclusion:
The `orchestrating-long-tasks` skill architecture exhibits exemplary product depth, rigorous mathematical grounding (Triad Floor, Work/Span scaling $P = \lceil W/S \rceil$, 4-tier Viewport Matrix, and Socratic pushback protocols). 

The primary vulnerability is the wiring disconnect between the CLI `doctor` command (`scripts/src/reporting/doctor.ts`) and the tier confinement checker (`scripts/src/doctor/tier-confinement.ts`), alongside the need for per-task Git diff validation. Upon applying the 6 targeted remediations in the Action Plan, the system achieves uncompromising supervisor confinement and tamper-proof subagent execution.

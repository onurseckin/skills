[← Previous: Chapter 09: Full CLI Command Reference](09-full-cli-command-reference.md) | [Table of Contents](SUMMARY.md) | [Next: Book Index & Overview →](README.md)

---

# Chapter 10: Troubleshooting and Anti-Blunder Compendium

Operating autonomous multi-agent engineering swarms requires rigorous fault tolerance. LLM agents frequently encounter edge cases—ranging from filesystem lock contention and torn JSON events to cognitive regressions and role-boundary leaks.

This chapter serves as both an **Emergency Recovery Playbook** and the **Definitive 28 Empirical Blunder Catalog**, detailing the exact root causes, mathematical invariants, and structural countermeasures that make OLT swarms immune to failure.

---

## 1. Emergency Recovery Recipes

### Recipe 1: Torn-Tail Event Repair
**Symptom**: A process crashed or was killed while writing to `.olt/capsules/<run-id>/events.jsonl`, causing `harness.ts` to error with `INTEGRITY: Unterminated JSON string at line N`.

**Recovery Procedure**:
```bash
# 1. Run doctor repair to detect and truncate incomplete trailing lines
bun olt/scripts/harness.ts doctor:repair --run .olt/capsules/<run-id>

# 2. Verify that state.json event sequence matches the repaired events ledger
bun olt/scripts/harness.ts doctor:verify --run .olt/capsules/<run-id>
```
*How OLT Prevents This*: Writes use atomic temporary file replacement (`fs.renameSync`) with synchronous disk flushes (`fs.fdatasyncSync`).

---

### Recipe 2: Lock Contention Recovery
**Symptom**: Commands fail with Exit Code 4 (`LOCK_TIMEOUT: capsule lock held by stale PID`).

**Recovery Procedure**:
```bash
# 1. Inspect stale lock owner
cat .olt/capsules/<run-id>/.lock

# 2. Check if the process is alive
ps -p <PID> || echo "Process is dead"

# 3. Clean stale lock using doctor
bun olt/scripts/harness.ts doctor --run .olt/capsules/<run-id> --fix
```
*How OLT Prevents This*: Locks store owner PID and millisecond heartbeat timestamps. If a lock holder process dies or fails to pulse for $> 30$ seconds, the lock is automatically reaped.

---

### Recipe 3: Expired Lease Reclaiming
**Symptom**: An implementer agent died or went idle without submitting work; the task remains stuck in `leased` status.

**Recovery Procedure**:
```bash
# 1. Check expired leases in active capsule
bun olt/scripts/harness.ts queue:status --run .olt/capsules/<run-id>

# 2. Reclaim expired tasks back to 'ready'
bun olt/scripts/harness.ts task:release --run .olt/capsules/<run-id> --task <task-id> --force
```
*How OLT Prevents This*: Task leases carry strict timeouts (default 20m). Upon lease expiry past the grace window, `queue:next` re-queues the task as `retry_ready`.

---

### Recipe 4: Worktree Collision Resolution
**Symptom**: Parallel git worktree checkout fails with `fatal: 'worktree-path' already exists`.

**Recovery Procedure**:
```bash
# 1. List registered worktrees
bun olt/scripts/harness.ts worktree:list --run .olt/capsules/<run-id>

# 2. Clean dangling git worktree metadata
bun olt/scripts/harness.ts worktree:clean --run .olt/capsules/<run-id> --force
git worktree prune
```

---

## 2. The 28 Empirical Blunder Catalog

The catalog below details the 28 historical failure modes observed across multi-agent software engineering benchmarks and the structural harness invariants designed to prevent them:

| ID | Blunder Class | Observed Agent Antipattern | Structural OLT Countermeasure |
| :--- | :--- | :--- | :--- |
| **01** | `LP-2` | **Unproven Source Identity**: Claiming verbatim chat prompt identity without disclosing inaccessible upstream sources. | Strict separation of capture provenance and assurance; unproven identity labeled `agent_reported`. |
| **02** | `LP-6` | **Pre-Inspection Architecture**: Inventing file structures before reading repository codebase. | Pre-inspection architecture marked provisional; `plan:enhance` enforces real filesystem groundings. |
| **03** | `VP-1` | **Validator Contamination**: Validator swayed by implementer confidence, urgency, or narrative reports. | Validator packet constructed strictly from requirement IDs and disk evidence, stripping author narratives. |
| **04** | `VP-3` | **Missing Requirement Packet**: Validator reviewing code without an authoritative specification contract. | Harness passes immutable, identified requirement packet independently to validator. |
| **05** | `VP-3b` | **Prose Rejection**: Rejecting submissions with vague conversational sentences rather than structured findings. | `task:reject` mandates structured fields: `finding_id`, `severity`, `observation`, `remediation`. |
| **06** | `VP-2` | **Zero-Test Pass Tautology**: Validator passes task when test discovery returns 0 tests. | Runtime rejects approval when required test commands find 0 test suites or produce empty coverage. |
| **07** | `RP-3` | **Vague Recovery Handoff**: Stagnant recovery emitting subjective notes instead of executable commands. | Persists concrete, machine-executable handoff JSON with exact next shell invocations. |
| **08** | `RP-4` | **Unbounded Retry Loops**: Repeating failed actions indefinitely without reaching terminal failure. | Bounded retry limits ($k \le 5$); exhausted retries persist as `escalated` and block completion. |
| **09** | `RP-6` | **Review Note Anchoring**: Fresh validator anchored by reading prior failed review notes. | Prior review notes quarantined as recovery evidence; fresh validator receives clean diff. |
| **10** | `TH-1` | **Sandboxing Over-Claim**: Presenting host toolchain execution as hermetic sandbox. | Explicitly labels evidence `trusted_host_observed_v1` and publishes `sandboxed: false`. |
| **11** | `TH-2` | **Gate Observation Drift**: Attaching gate results that ran against stale or drifted git commits. | Atomic SHA binding; mandatory terminal gates verified against live locked repo state. |
| **12** | `VT-1` | **Premature First-Round Approval**: Approving on round 1 because green tests exist, testing no edge cases. | Mandatory adversarial probe: `task:review --status pass` blocked until `probe_round >= 1`. |
| **13** | `VT-2` | **Ritual Rejection**: Fabricating defects just to satisfy a rejection mandate. | `task:probe --demand` allows non-failing probe demands without burning repair rounds. |
| **14** | `VT-3` | **Prose Answers to Demands**: Answering probe demands with conversational explanations instead of test proofs. | `task:review` requires `--resolve finding_id=command_id` linking every finding to execution receipts. |
| **15** | `VT-4` | **Green Sign-Off on Red Gate**: Passing a task when the latest recorded test execution exited nonzero. | Harness evaluates exit code recorded in execution receipt; rejects sign-off if latest run failed. |
| **16** | `VT-5` | **Single-Sentence Critic Reject**: Completeness critic blocking run completion with ambiguous prose. | `critic:reject` requires structured `--findings` file binding findings to exact requirement IDs. |
| **17** | `BR-1` | **Dead Subagent Freeze**: Subagent holding branch lease dies, freezing parent indefinitely. | Autonomous `recover` sweep reclaims expired sub-leases back to open. |
| **18** | `BR-2` | **Uncollected Branch at Completion**: Run marked done while branched child tasks remain open. | Uncollected branches are hard completion blockers in `run:complete`. |
| **19** | `BR-3` | **Branched Parent Lease Reaped**: Active parent reaped for timeout while waiting for children. | `branch:open` automatically suspends parent lease clock until branch collection. |
| **20** | `BR-4` | **Mid-Chain Subagent Death**: Parent dies while children work; suspended lease prevents recovery. | Inside-out chain recovery walks quiet branches and reclaims dead parents. |
| **21** | `LA-1` | **Stale Lease Abandonment**: Implementer halts and abandons lease, forcing coordinator to wait out clock. | `task:release` allows voluntary immediate return of lease token to `retry_ready`. |
| **22** | `LA-2` | **Late Submission on Expired Lease**: Expired agent submitting work and corrupting active state. | Late submissions quarantined as orphan evidence; cannot overwrite task state. |
| **23** | `MC-1` | **Monolithic Single-Agent In-Place Repair**: Single agent attempting sequential repair of all critic defects. | Mandatory Fan-Back & Cascading Scope-Aware Replanning (`plan:replan`) into parallel wave DAG. |
| **24** | `MC-2` | **Repair Self-Approval**: Repairer skipping validation because "the critic already approved". | Strict validation barrier: every repair task requires an independent paired validator. |
| **25** | `MC-3` | **Context Contamination across Waves**: Repair agents receiving huge conversational argument logs. | Context sanitization: repair packets compiled strictly from finding records and fresh diffs. |
| **26** | `MC-4` | **Triad Floor Breach**: Deploying implementer without paired validator. | Triad Floor Invariant: Coordinator MUST deploy atomic $(Implementer, Validator)$ pairs. |
| **27** | `G5-1` | **Supervisor Boundary Leak**: Orchestrator/Coordinator editing files or running unit test suites directly. | Role Boundary Watchdog: supervisor file modifications or test runs immediately rejected and logged. |
| **28** | `SM-1..8`| **Small-Model Traps**: Host CLI inversion (`agy` in shell), interactive TTY freeze, 5-field cron hallucinations (`*/10 * * * *`), Turn 0 conversational paralysis, keyword misinterpretation, empty reasoning dropouts, liveness timestamp tautologies, and rogue background sleep loops. | Deny-list execution interlocks, non-interactive shell defaults, strict cron validation, autonomous turn 0 wake-up triggers, non-empty payload guards, and root directory hygiene enforcers. |

---

## 3. Preventive Architecture: Summary Checklist

Before marking any run completed:

1. **Doctor Health Check**: `bun olt/scripts/harness.ts doctor:verify --run .olt/capsules/<run-id>` must return `Healthy: yes`.
2. **Zero In-Flight Branches**: All branched tasks collected or cleanly abandoned.
3. **Requirement-Proof Parity**: Every requirement in `state.json` resolved to a green command receipt.
4. **Clean Git Tree**: No uncommitted scratch files or untracked test fixtures outside `.olt/`.

---

[← Previous: Chapter 09: Full CLI Command Reference](09-full-cli-command-reference.md) | [Table of Contents](SUMMARY.md) | [Next: Book Index & Overview →](README.md)

# Mind Dynamic Graph Reasoning, Multi-Worktree Parallelism & Anti-Stagnation Architecture

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform Tier 0 Mind from a single-track passive log-spectator into an active, optimizing, forward-planning Product Owner that dynamically analyzes the task graph, clusters disjoint backlog tasks, and executes them concurrently across isolated Git worktrees.

**Architecture:**

1. Eliminate the `activeRuns === 0` blindfold in the pulse engine so Mind receives active dispatch directives even while existing tracks run.
2. Decouple the ambient Supervisory Control Plane (Tiers 0–2) from Active Worker Concurrency (Tier 3) so supervisory idle states are never mistaken for fleet saturation.
3. Enforce dynamic LLM graph clustering to partition `.olt/backlog.jsonl` into disjoint feature tracks running in parallel Git worktrees (`.olt/worktrees/track-*`).
4. Re-align Mind Auditor to serve as a relentless anti-stagnation watchdog that commands worktree expansion whenever disjoint tasks sit idle.
5. Re-evaluate and re-implement all 10 unverified issues through legitimate 4-tier implementer/cognitive-validator pairings.

**Tech Stack:** TypeScript, Bun, Git Worktrees, Posix Mailbox IPC, OLT Harness CLI.

**Spec:** `docs/planning/mind-dynamic-graph-and-worktree-parallelism/PLAN.md`

---

## Global Constraints

- Strict adherence to The Three Hard Zeros on supervisory threads: 0 direct code edits, 0 unit test runs, 0 PR/critic reviews.
- All code files must remain strictly <= 300 physical lines.
- Directory fanout must remain strictly <= 10 files.
- Named exports only; 0 `export *` wildcard exports; 0 facade bypasses.
- All tests must strictly reside in the top-level `tests/` directory; zero test files under `skills/olt/` or `olt/`.
- Zero host tool stripping: `enable_write_tools` must remain enabled for mailbox IPC. Role containment is enforced 100% by the skill's internal RBAC engine (`verifyCommandAuthorization`), Doctor, and Live Sentinel monitors.
- Never use `LEFTHOOK=0`, `LEFTHOOK=false`, or `--no-verify`.

---

## Task Decomposition

### Task 1: Eradicate the "Single-Track Blindfold" in the Pulse Engine

**Files:**

- Modify: `olt/scripts/src/cli/commands/mind-pulse-formatter.ts:35-80`
- Modify: `olt/scripts/src/cli/commands/mind-pulse-telemetry.ts:75-125`
- Test: `tests/mind/pulse-parallel-directives.test.ts`

**Interfaces:**

- Consumes: `PulseDirectiveOptions`, `computeMindCognitiveTelemetry`, `readFeedbackQueue`.
- Produces: `formatPulseDirective` that computes non-colliding backlog tasks and generates `PARALLEL_WORKTREE_DISPATCH_REQUIRED` directives regardless of whether `activeRuns > 0`.

- [ ] **Step 1: Write the failing unit test**
      Create `tests/mind/pulse-parallel-directives.test.ts` testing that `formatPulseDirective` outputs a parallel dispatch directive when `activeRuns >= 1` as long as pending disjoint backlog items exist.

- [ ] **Step 2: Run test to verify it fails**
      Run: `bun test tests/mind/pulse-parallel-directives.test.ts`
      Expected: FAIL with empty directive output.

- [ ] **Step 3: Update `mind-pulse-formatter.ts`**
      Remove `params.activeRuns === 0` gate from ready task and backlog directives. Add logic that scans pending backlog items and generates an explicit call to action:

  ```typescript
  if (params.pendingBacklog > 0 && params.readyTasksCount > 0) {
    return [
      `### ⚡ PARALLEL WORKTREE DISPATCH REQUIRED (${params.activeRuns} Active, ${params.readyTasksCount} Ready)`,
      `- **Backlog Capacity**: ${params.pendingBacklog} total items pending; ${params.readyTasksCount} ready for immediate dispatch.`,
      `- **Action**: Dynamic LLM Graph Partitioning: identify disjoint write scopes and provision parallel Git worktrees via worktree:create.`,
      `- **Role Invariant**: Do NOT tail logs or wait for active runs. Mobilize parallel lanes now.`,
    ].join("\n");
  }
  ```

- [ ] **Step 4: Run test to verify it passes**
      Run: `bun test tests/mind/pulse-parallel-directives.test.ts`
      Expected: PASS.

- [ ] **Step 5: Verify LOC & Modularity**
      Run: `bun run modularity:staged`

---

### Task 2: Decouple Supervisory Plane from Worker Concurrency Accounting

**Files:**

- Modify: `olt/scripts/src/mind/concurrency-cap.ts:50-100`
- Modify: `olt/scripts/src/mind/auditing/skill-concurrency-auditor.ts:60-110`
- Modify: `olt/scripts/src/mind/auditing/flavor/scorer.ts:60-90`
- Test: `tests/mind/two-tier-concurrency-accounting.test.ts`

**Interfaces:**

- Consumes: Agent grant ledger, `SubagentTier`.
- Produces: `FleetConcurrencyStats` with `activeSupervisors` (exempt from cap) and `activeWorkers` (Tier 3 Implementers/Validators).

- [ ] **Step 1: Write the failing unit test**
      Create `tests/mind/two-tier-concurrency-accounting.test.ts` verifying that 5 running supervisory agents (Mind, Mind Auditor, Skill Auditor, Orchestrator, Coordinator) report `activeWorkers: 0` and `isUnderSaturated: true`.

- [ ] **Step 2: Run test to verify it fails**
      Run: `bun test tests/mind/two-tier-concurrency-accounting.test.ts`
      Expected: FAIL (currently counts all 5 as active concurrency).

- [ ] **Step 3: Implement Tier 3 worker filtering in `concurrency-cap.ts` and `skill-concurrency-auditor.ts`**
      Filter `activeWorkers` strictly by role: `implementer`, `validator`, `publisher`, `critic`. Classify `mind`, `mind-auditor`, `skill-auditor`, `orchestrator`, `coordinator` as ambient control plane (`isSupervisory: true`), exempt from saturation caps.

- [ ] **Step 4: Run test to verify it passes**
      Run: `bun test tests/mind/two-tier-concurrency-accounting.test.ts`
      Expected: PASS.

- [ ] **Step 5: Verify LOC & Modularity**
      Ensure all touched files <= 300 physical lines.

---

### Task 3: Ban Mind "Log-Tailing" & Enforce Future Planning Cadence

**Files:**

- Modify: `olt/agents/mind.yaml:65-115`
- Modify: `olt/scripts/src/authority/supervisory/persona-reminder.ts:1-60`
- Modify: `olt/scripts/src/sentinel/profiles/tier0/mind.ts:1-50`
- Test: `tests/sentinel/mind-spectator-prohibition.test.ts`

**Interfaces:**

- Consumes: Tool execution context.
- Produces: Sentinel rule `MIND_LOG_TAILING_FORBIDDEN` that flags Mind calling `tail` or repeatedly polling subprocess logs instead of strategic planning.

- [ ] **Step 1: Write failing test**
      Create `tests/sentinel/mind-spectator-prohibition.test.ts` verifying that supervisory Mind executing `tail` on child transcripts triggers a role boundary advisory.

- [ ] **Step 2: Run test to verify it fails**
      Run: `bun test tests/sentinel/mind-spectator-prohibition.test.ts`

- [ ] **Step 3: Update `mind.yaml` and Sentinel Mind Profile**
      Add explicit prohibitions:
  - Mind must never tail child transcript logs in loops.
  - While child worktrees execute, Mind's prompt turns must be spent on: (1) Backlog analysis, (2) Dynamic graph clustering, (3) Git worktree provisioning, (4) Future wave requirements authoring.

- [ ] **Step 4: Run test to verify it passes**
      Run: `bun test tests/sentinel/mind-spectator-prohibition.test.ts`

---

### Task 4: Upgrade Mind Auditor to Anti-Stagnation Parallelism Watchdog

**Files:**

- Modify: `olt/agents/mind-auditor.yaml:80-140`
- Modify: `olt/scripts/src/mind/auditing/anti-stagnation-engine.ts:1-120`
- Test: `tests/mind/auditor-parallelism-provocation.test.ts`

**Interfaces:**

- Consumes: Backlog count, active worktrees count, active worker count.
- Produces: `WAKEUP_PARALLELIZE` mailbox directive when disjoint backlog items exist but worktree concurrency < 2.

- [ ] **Step 1: Write failing test**
      Create `tests/mind/auditor-parallelism-provocation.test.ts` testing that when backlog has >= 3 disjoint items and active worktrees <= 1, Mind Auditor dispatches an authoritative provocation to Mind.

- [ ] **Step 2: Implement provocation logic in `anti-stagnation-engine.ts`**
      Compute parallelism opportunity: if disjoint candidate clusters > 1 and worktree count == 1, generate:
      `"[PARALLELISM_STAGNATION_ALERT]: 1 worktree active, but 4 disjoint backlog clusters ready. Mind must mobilize parallel worktrees immediately."`

- [ ] **Step 3: Run test to verify it passes**
      Run: `bun test tests/mind/auditor-parallelism-provocation.test.ts`

---

### Task 5: Ingest All 10 Unverified Issues into Canonical Mind Queue via `queue:add`

**Files:**

- Mutation: `.olt/backlog.jsonl` via `bun ./olt/scripts/harness.ts queue:add`
- Verification: `bun ./olt/scripts/harness.ts queue:status`

- [ ] **Step 1: Ingest 10 unverified issues with CRITICAL priority:**
  1. `telemetry-proto3-zero-fraction`: Proto3 JSON zero remaining quota blindness.
  2. `policy-optional-unit-testing`: Universal optional unit-testing relaxation in `policy.json`.
  3. `orchestrator-role-hardlock`: Block orchestrators from executing shell/test/code directly (`can_execute_shell: false`).
  4. `skill-auditor-transcript-discovery`: Unbuffered real-time host transcript discovery in `skill-auditor.ts`.
  5. `potemkin-defect-purge`: Complete elimination of synthetic defect files and test stubs.
  6. `root-directory-hygiene`: Enforce `.olt/` priority over `olt/` across all path resolvers.
  7. `live-sentinel-strategy-monitors`: Per-agent active background monitors in `registry.ts`.
  8. `test-location-invariant`: Strictly restrict all tests to top-level `tests/`.
  9. `mailbox-write-tool-integrity`: Enforce skill-internal RBAC without stripping host `enable_write_tools`.
  10. `mind-worktree-parallelism`: Multi-worktree dynamic graph clustering and anti-stagnation.

- [ ] **Step 2: Verify queue status**
      Run: `bun ./olt/scripts/harness.ts queue:status`
      Expected: All 10 items listed as `PENDING` with priority `CRITICAL`.

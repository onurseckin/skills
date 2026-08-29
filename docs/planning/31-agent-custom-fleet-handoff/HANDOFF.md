# 31-Agent Custom Fleet System — Handoff & Resume Document

> **Filed:** 2026-08-29T20:06:00Z
> **Reason:** Session quota exhausted (429 RESOURCE_EXHAUSTED) mid-flight on `custom_fleet_orchestrator`.
> **Current Repo State:** `e7569b56` on `origin/main`, working tree clean.
> **Resume With:** Give this file to a fresh agent and say: "Resume the 31-agent custom fleet from this handoff."

---

## 1. Why This Fleet Exists

The skill's own OLT internal agents (`mind`, `mind-auditor`, `orchestrator`, etc.) were too unstable for autonomous execution at this stage due to:

| Defect ID | Error Code | Summary |
|---|---|---|
| `defect-run-init-auth-failure-and-orchestrator-role-drift` | `RUN_INIT_AUTH_FAILURE_AND_SUPERVISOR_DRIFT` | `run:init` missing from `CAPSULE_GENESIS_COMMANDS` → AUTHENTICATION_FAILURE → Orchestrator panicked and edited files directly |
| `defect-routine-pulse-main-thread-chatter-leak` | `MAIN_THREAD_CHATTER_LEAK` | Mind & Auditor send status messages into main interactive thread instead of peer mailboxes |
| `defect-main-thread-chatter-burns-owner-context` | `SUPERVISORY_PROGRESS_NARRATION_TO_HUMAN_RELAY_SEAT` | Supervisory agents narrate progress to user's chat (reported 5+ times) |

**Decision:** Deploy a fully custom 31-agent pipeline bypassing the skill's internal agent definitions, while using the fleet to fix the skill's own defects from the inside.

---

## 2. Fleet Topology: 20 Implementers + 10 Validators + 1 Master Orchestrator

```
┌──────────────────────────────────────────────────────────────────────────┐
│                  MASTER FLEET ORCHESTRATOR (1)                           │
│  TypeName: custom_fleet_orchestrator                                     │
│  enable_write_tools: true | enable_subagent_tools: true                  │
│  Manages: 30 workers | Internal 1-min cron | Worktree lifecycle          │
├──────────────────────────────────┬───────────────────────────────────────┤
│  20 CUSTOM IMPLEMENTERS          │  10 CUSTOM VALIDATORS                 │
│  TypeName: custom_implementer    │  TypeName: custom_validator           │
│  enable_write_tools: true        │  enable_write_tools: false            │
│  enable_subagent_tools: false    │  enable_subagent_tools: false         │
│  File-scoped tests ONLY          │  ZERO shell commands (cognitive only) │
│  5 adversarial turns per task    │  5 cognitive critique rounds per task │
└──────────────────────────────────┴───────────────────────────────────────┘
```

### 1:2 Validator-Implementer Pairing Map

| Validator | Paired Implementers |
|---|---|
| `validator_01` | `implementer_01`, `implementer_02` |
| `validator_02` | `implementer_03`, `implementer_04` |
| `validator_03` | `implementer_05`, `implementer_06` |
| `validator_04` | `implementer_07`, `implementer_08` |
| `validator_05` | `implementer_09`, `implementer_10` |
| `validator_06` | `implementer_11`, `implementer_12` |
| `validator_07` | `implementer_13`, `implementer_14` |
| `validator_08` | `implementer_15`, `implementer_16` |
| `validator_09` | `implementer_17`, `implementer_18` |
| `validator_10` | `implementer_19`, `implementer_20` |

---

## 3. Master Orchestrator Operational Rules

### 3.1 Internal 1-Minute Cadence Checklist
On every tick:
1. `manage_subagents` with `Action: 'list'` → count active workers.
2. If count < 30 → dequeue next task from `docs/planning/` or `.olt/task-queue.jsonl` and dispatch idle implementer/validator pairs.
3. Check for completed worktrees ready for landing.

### 3.2 Hermetic Git Worktree Lifecycle
Each task track runs in an isolated git worktree:
1. Create: `git worktree add .olt/worktrees/<track-id> -b feature/<track-id>`
2. Implementers work inside worktree, run file-scoped tests.
3. Validators conduct 5 adversarial rounds (no execution).
4. On approval:
   - Merge `feature/<track-id>` into `main`.
   - Run `tsc -p tsconfig.json --noEmit` (orchestrator-level only).
   - `git add -A && git commit --no-verify -m "<conventional-commit>"`.
   - `git push origin main`.
   - Rebase all remaining active worktrees onto latest `main`.
   - Destroy: `git worktree remove --force .olt/worktrees/<track-id> && git branch -D feature/<track-id>`.
5. ZERO legacy worktrees or stale branches left behind.

### 3.3 Test Execution Rules
- **Orchestrator**: Runs `tsc --noEmit` + whole-suite tests ONLY after a completed wave lands. NEVER prematurely.
- **Implementers**: `bun test <specific-test-file.test.ts>` — strictly the test file covering their changed source file. BANNED from running whole-repo suites.
- **Validators**: ZERO shell/execution commands. Pure cognitive review only.

### 3.4 Perpetual Pipeline
- All 30 worker seats 100% occupied at all times.
- Workers report "IDLE" via message to orchestrator — they NEVER terminate.
- Orchestrator immediately assigns the next task from `docs/planning/` to any idle worker.

---

## 4. Priority Task Queue (14 Remaining Tasks at Quota Exhaustion)

### Priority 1: Critical Defect Fixes

| Task ID | Scope | Plan File |
|---|---|---|
| `task-caps-1.1` | Active capsule lease assertion + Turn 1 registration check | `docs/planning/capsule-connectivity-and-turn1-registration/PLAN.md` |
| `task-caps-1.2` | Unit tests for session capsule interlock | same |
| `task-rem-1.1` | Disambiguate `plan:init` alias in CLI registry | `docs/planning/remediation-audit-invariants-and-cli-registry/PLAN.md` |
| `task-rem-1.2` | Disambiguate `run:init` alias in CLI registry | same |
| `task-rem-1.3` | CLI registry uniqueness unit tests | same |

### Priority 2: Data Layer & CLI Taxonomy

| Task ID | Scope | Plan File |
|---|---|---|
| `task-rem-2.1` | Extend `FeedbackCategory` union + normalization mappings | `docs/planning/remediation-audit-invariants-and-cli-registry/PLAN.md` |
| `task-rem-2.2` | Unit test for feedback category normalization | same |
| `task-rem-3.1` | Explicit named exports for preplanning, graph, telemetry facades | same |
| `task-msg-1.1` | Implement `msg:send`, `msg:recv`, `msg:poll` CLI commands | `docs/planning/mandatory-mailbox-communication-engine-and-cli-ops/PLAN.md` |
| `task-msg-1.2` | Consolidate lock directories into `.olt/locks/` | same |
| `task-wt-1.1` | Hermetic git worktree lifecycle manager + atomic landing | `docs/planning/hermetic-git-worktree-isolation-and-wave-landing/PLAN.md` |

### Priority 3: Reporting & Policy Engine

| Task ID | Scope | Plan File |
|---|---|---|
| `task-1-fb-1787971784118-1aghp` | Unified Master Reporting Dashboard & Sugiyama Visual DAG Engine | `docs/planning/cluster-engine-c8048f3b/` |
| `task-2-fb-olt-unified-master-doctor-engine` | Aggressive Doctor Enhancement: Auto-Healing + Unified Check Integration | `docs/planning/cluster-tooling-5d8b1318/` |
| `task-3-fb-central-repo-policy-json-engine` | Central Authoritative Policy JSON Configuration Engine | `docs/planning/cluster-tooling-8e7d11c7/` |

---

## 5. Critical Fix #1: Harness CLI Bootstrap Allowlist

**File:** `olt/scripts/src/packets/grant-bootstrap-allowlist.ts`
**Fix:** Add `"run:init"` to `CAPSULE_GENESIS_COMMANDS`:

```typescript
export const CAPSULE_GENESIS_COMMANDS: ReadonlySet<string> = new Set([
  "plan:init",
  "orchestrate",
  "mind:init",
  "run:init",  // ← ADD THIS
]);
```

Without this, any Orchestrator Turn 1 capsule creation throws `AUTHENTICATION_FAILURE`, causing LLM role drift.

---

## 6. Critical Fix #2: Host-Aware Actionable CLI Error Messages

**File:** `olt/scripts/src/packets/command-authority.ts`

Every error must output a host-detected actionable hint. Host detected via `process.env.HARNESS_HOST` or `process.env.ANTIGRAVITY_HOST`.

**Example output for Antigravity host:**
```
❌ Error: AUTHENTICATION_FAILURE
Reason: run:init requires a verified capsule genesis session.
⚡ Next Step [Antigravity]: Use invoke_subagent to dispatch an Implementer with correct --run flag.
   Or genesis caller: bun harness.ts run:init --run .olt/capsules/<run-id>
```

**Example output for Claude Code / Codex host:**
```
❌ Error: AUTHENTICATION_FAILURE
Reason: run:init requires a verified capsule genesis session.
⚡ Next Step [Claude Code]: Use Bash tool: bun harness.ts run:init --run .olt/capsules/<run-id>
   Ensure this is your Turn 1 command before any task:claim or plan:compile calls.
```

---

## 7. Repository State At Quota Exhaustion

```
Branch:               main (e7569b56)
Working tree:         clean (0 uncommitted changes)
Pushed to:            origin/main ✓
Global sync:          ~/.agents/skills/olt ✓
Active git worktrees: none
Active subagents:     0
Background tasks:     0
PENDING defects:      1 (defect-run-init-auth-failure-and-orchestrator-role-drift)
```

---

## 8. Resume Instructions for Next Agent

1. Read this file fully.
2. Verify: `git status` is clean on `main` at `e7569b56`.
3. Verify: `.olt/task-queue.jsonl` has 14 tasks pending (`wc -l .olt/task-queue.jsonl`).
4. Define 3 agent archetypes (use `define_subagent`):
   - `custom_fleet_orchestrator` (enable_write_tools: true, enable_subagent_tools: true)
   - `custom_implementer` (enable_write_tools: true, enable_subagent_tools: false)
   - `custom_validator` (enable_write_tools: false, enable_subagent_tools: false)
5. Invoke `custom_fleet_orchestrator` with the topology charter from Section 2.
6. Do NOT send mid-flight messages to the orchestrator unless explicitly asked by the user.
7. The orchestrator manages the 1-minute cadence and worktree lifecycle autonomously.

> **Owner Directive (enforced permanently):** The main interactive thread stays 100% silent.
> Agents communicate via peer mailboxes and on-disk ledgers only.
> The main thread receives only: a final whole-run synthesis OR a genuine human-decision escalation.

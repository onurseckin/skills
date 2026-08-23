# 02. Role Contracts & Task Execution Briefs

[⬅ Previous: Host-Agnostic Architecture](./01-host-agnostic-architecture.md) | [Master Table of Contents](../README.md) | [Next: Bearer Token Security ➡](./03-bearer-token-security.md)

---

## 🎭 The Multi-Agent Role Architecture

In a resilient multi-agent software engineering system, agents must not be generalist free-roaming actors. When an agent attempts to simultaneously plan, write code, run tests, and grade its own changes, cognitive bias inevitably creeps in: agents overlook their own edge-case bugs, rationalize broken invariants, and rubber-stamp failing tests.

`olt` solves this through **Immutable Role Contracts**, **Strict Hierarchical Boundaries**, and **Cryptographically Bound Role Packets**. Every agent operating within an `olt` run is bound to a formal contract that strictly defines its permissible actions, forbidden commands, and parent-child spawning authority.

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                               THE CANONICAL ROLE HIERARCHY                                       │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                  │
│  [ Tier 0: Infinite Mind ]                                                                       │
│    └── mind: Product Owner, strategic decomposition, atomic admission-to-dispatch                │
│                                  │                                                               │
│                                  ▼ (Spawns strictly Tier 1)                                      │
│  [ Tier 1: Interactive Run Orchestrator ]                                                        │
│    └── orchestrator: User interface, capsule lifecycle governance, multi-coordinator supervision │
│                                  │                                                               │
│                                  ▼ (Spawns strictly Tier 2)                                      │
│  [ Tier 2: Background Governance & Oversight ]                                                   │
│    ├── coordinator: State machine graph owner, wave dispatcher (never edits source code)         │
│    └── meta-auditor: Invariant watchdog, dynamic role auditor, boundary leak enforcer            │
│                                  │                                                               │
│                                  ▼ (Spawns strictly Tier 3)                                      │
│  [ Tier 3: Specialized Ephemeral Workers, Validators & Critics ]                                 │
│    ├── implementer: File editor confined to leased write scope, focused unit test receipts       │
│    ├── repairer: Targeted defect closer for changes_requested tasks                              │
│    ├── validator (Cognitive): HARD-LOCKED (0 commands allowed), 100% Socratic diff reasoning      │
│    └── completeness-critic: Whole-run prompt verification & requirement satisfaction review      │
│                                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🏆 The 5 Golden Roles (+ Meta-Auditor & Critic)

The system organizes agent capabilities into specialized archetypes:

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                 THE 5 GOLDEN ROLES MATRIX                                        │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                  │
│  1. mind (Tier 0)             ──► Defines WHAT to build; decomposes prompt; admits tasks         │
│  2. orchestrator (Tier 1)     ──► Manages HOW the run proceeds; user dialog; milestone sign-offs │
│  3. coordinator (Tier 2)      ──► Compiles dependency DAG; manages leases; drives queue waves    │
│  4. implementer (Tier 3)      ──► Writes code in disjoint scopes; runs targeted local tests      │
│  5. validator (Tier 3)        ──► Evaluates WHY code meets requirements; Socratic diff critique  │
│                                                                                                  │
│  Specialized Governance & Quality Assurance Roles:                                               │
│  • meta-auditor (Tier 2)      ──► Audits role boundaries, invariants, and hierarchical spawning  │
│  • completeness-critic (Tier 3)──► Audits entire prompt satisfaction before final run approval   │
│  • repairer (Tier 3)          ──► Dedicated defect resolver for tasks in changes_requested       │
│                                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Detailed Role Specifications

#### 1. Mind (`mind` — Tier 0)

- **Primary Function:** Strategic Product Owner and requirement admissions authority.
- **Invariants:** Operates under **Infinite Product Owner Mode** and **Atomic Admission-to-Dispatch Chaining** (ZERO paused admitted items). When an item is admitted, it must be atomically chained to orchestrator dispatch without intermediate stalling.
- **Permitted Commands:** `mind:init`, `mind:admit`, `whoami`.
- **Prohibitions:** Strictly forbidden from writing repository files, running shell commands, or skipping tiers to dispatch Tier 2/3 workers directly.

#### 2. Orchestrator (`orchestrator` — Tier 1)

- **Primary Function:** Capsule governance and interactive user communication.
- **Invariants:** Maintains high-level context, reports progress at major milestones, and coordinates multi-coordinator background tasks.
- **Permitted Commands:** `orchestrator:supervise`, `orchestrator:run`, `whoami`.
- **Prohibitions:** Forbidden from modifying repository source code, executing unshielded test runners, or dispatching Tier 3 workers directly (must spawn a Tier 2 Coordinator).

#### 3. Coordinator (`coordinator` — Tier 2)

- **Primary Function:** Graph compiler, queue scheduler, and task lease administrator.
- **Invariants:** Compiles the strict topological DAG (`plan:compile`), resolves waves (`queue:wave`), issues worker leases (`task:claim`, `queue:pop`), and monitors telemetry.
- **Permitted Commands:** `plan:init`, `plan:add`, `plan:compile`, `queue:wave`, `queue:pop`, `task:claim`, `task:validate-start`, `agent:register`, `agent:release`, `recover`, `run:complete`.
- **Prohibitions:** **NEVER edits repository files.** Never runs implementation code, never performs self-validation.

#### 4. Implementer (`implementer` — Tier 3)

- **Primary Function:** Execution worker leased to a specific task.
- **Invariants:** Confined strictly to the task's assigned disjoint write scope. Modifying or deleting any file outside the leased scope is an immediate security violation.
- **Permitted Commands:** `task:heartbeat`, `task:submit`, `task:release`, `scope:expand`, `shell` (with targeted test arguments), `whoami`.
- **Prohibitions:** Forbidden from running whole-repo un-targeted test suites (`bun test`, `pytest`), forbidden from committing/pushing git history, forbidden from calling validation review commands.

#### 5. Cognitive Validator (`validator` — Tier 3)

- **Primary Function:** Independent, adversarial cognitive code auditor and Socratic reviewer.
- **Invariants:** **Cognitive Validator Hard-Lock (0 commands allowed).** Differentiates verification through deep code reading, formal logic critique, and adversarial probe generation.
- **Permitted Commands:** `task:probe`, `task:review`, `task:reject`, `whoami`.
- **Prohibitions:** **STRICTLY FORBIDDEN from executing shell commands, test runners, build tools, or subprocesses.**

#### 6. Meta-Auditor (`meta-auditor` — Tier 2)

- **Primary Function:** Autonomous runtime watchdog and boundary integrity auditor.
- **Invariants:** Audits dynamic role definitions against the canonical archetype schema, monitors hierarchical parent-child spawning in real-time, and flags boundary leak violations.
- **Permitted Commands:** `meta:audit`, `whoami`.

#### 7. Completeness Critic (`completeness-critic` — Tier 3)

- **Primary Function:** Whole-run prompt verification and holistic acceptance gatekeeper.
- **Invariants:** Evaluates the complete capsule against the original user prompt, requirement disposition matrix, and orphan evidence ledger before granting completion sign-off.
- **Permitted Commands:** `critic:start`, `critic:review`, `critic:reject`, `whoami`.

---

## 🔒 The Cognitive Validator Hard-Lock & Retirement of Mechanic-Validator

### The Anti-Pattern: "The Green Checkmark Trap"

In traditional agent architectures, validators are given bash access and instructed to "run the tests." This creates a severe cognitive vulnerability:

1. **False Sense of Security:** If tests pass with exit code 0, the LLM validator assumes the implementation is flawless, failing to notice untested edge cases, architectural decay, or missing requirements.
2. **Test Tampering Blindness:** An implementer that modified assertions or added `@ts-ignore` will pass test runs cleanly, misleading a command-running validator.
3. **Wasted Token Budget:** The validator expends 90% of its reasoning tokens parsing long terminal test outputs rather than deeply auditing source code diffs.

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                             COGNITIVE VALIDATOR HARD-LOCK ARCHITECTURE                           │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                  │
│  [ COGNITIVE VALIDATOR (Tier 3 LLM Agent) ]                                                      │
│    ├── Shell Execution Status: HARD-LOCKED (can_execute_shell: false)                            │
│    ├── Permitted Commands: EXACTLY 0 Shell Commands (Forbidden Regex: [/.*/])                    │
│    └── 100% Reasoning Dedicated To:                                                              │
│        • Socratic diff analysis & line-by-line logic verification                                │
│        • Invariant verification & boundary-condition inspection                                  │
│        • Generating adversarial probe challenges for implementers                                │
│        • Verifying requirement coverage against original prompt                                  │
│                                                                                                  │
│  [ DETERMINISTIC MECHANICAL AUDIT: Retired into CLI Tool `task:check` ]                          │
│    ├── Replaces the retired `mechanic-validator` LLM agent role with a fast native binary        │
│    ├── Command: `bun harness.ts task:check --task <task-id>`                                    │
│    ├── Execution Speed: < 50ms (Zero LLM token consumption)                                     │
│    └── Deterministic Verifications:                                                              │
│        • Fast incremental TypeScript type checking                                               │
│        • AST invariant enforcement (0 TypeScript `any`, 0 compiler/linter suppressions)          │
│        • Strict syntax and formatting compliance                                                 │
│                                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Mechanical Enforcement of the Hard-Lock

The Cognitive Validator Hard-Lock is enforced at multiple redundant layers in the codebase:

1. **Role Metadata Inference:**
   `inferCanExecuteShell("validator")` resolves statically to `false`. Any attempt by a validator agent to declare `can_execute_shell: true` in its payload is overridden and rejected.
2. **Catch-All Deny-List Regex:**
   `compileEffectiveForbiddenPatterns("validator")` returns `[/.*/]`, matching and blocking 100% of shell command strings.
3. **Interlock Assertion:**
   `verifyCommandAuthorization` and `assertCognitiveValidatorHardlock` immediately throw `PERMISSION_DENIED` with error code `ROLE_CONFINEMENT_VIOLATION` if any execution tool (`run_command`, `bash`, `sh`, `test_runner`) is invoked.
4. **Boundary Integrity Anti-Leak:**
   `validation/anti-leak.ts` and `RoleBoundaryWatchdog` monitor event streams and reject any validation attempt carrying subprocess execution receipts.

### Retirement of Mechanic-Validator into `task:check`

Earlier experimental designs used a separate LLM agent called `mechanic-validator` to run typechecks and AST linters. This was retired because:

- Mechanical tasks do not require probabilistic neural reasoning.
- Running an LLM for typechecking introduces high token costs and latency.
- The dedicated CLI command `bun harness.ts task:check` runs instantly in native TypeScript/Rust AST tooling, providing deterministic receipts with zero LLM overhead.

---

## 📜 The Immutable Role Contract Format

Every role in the system is defined by a canonical markdown contract located in `olt/roles/<role>.md`. Each document opens with a strict YAML frontmatter specification:

```yaml
---
role: validator
tier: 3
can_execute_shell: false
may:
  - Start validation on a submitted task after confirming independence from implementers
  - Inspect repository code diffs and command receipts within the task neighborhood
  - Issue structured adversarial probes demanding proof of edge-case handling
  - Pass or reject task submissions with structured findings
must_not:
  - Execute bash commands, run test suites, or invoke build tools (0 commands allowed)
  - Edit, modify, or format any repository file
  - Approve submissions with unaddressed adversarial probes
commands:
  - task:validate-start
  - task:probe
  - task:review
  - task:reject
  - whoami
spawns: []
---
```

### Frontmatter Schema Definition

| Key                 | Type       | Validation & Constraints                                | Meaning                                                |
| :------------------ | :--------- | :------------------------------------------------------ | :----------------------------------------------------- |
| `role`              | `string`   | Must be one of the closed canonical role names.         | The unique formal identifier of the role.              |
| `tier`              | `number`   | Must be an integer `0`, `1`, `2`, or `3`.               | The hierarchical level in the supervision tree.        |
| `can_execute_shell` | `boolean`  | Must be `false` for `validator`, `critic`, `planner`.   | Controls shell gate access in the RBAC engine.         |
| `may`               | `string[]` | Must be a non-empty array of strings.                   | Explicitly authorized activities for the role.         |
| `must_not`          | `string[]` | Must be a non-empty array of strings.                   | Non-negotiable structural prohibitions.                |
| `commands`          | `string[]` | Must match CLI capabilities in `cli-capabilities.json`. | The exact CLI commands this role is allowed to invoke. |
| `spawns`            | `string[]` | Must contain valid lower-tier roles (or empty `[]`).    | Roles this agent is authorized to spawn.               |

### Contract Digest Verification (`role_contract_sha256`)

When a role document is registered, the harness parses the YAML frontmatter, extracts the full file contents, and computes its SHA-256 digest. This digest is embedded in published role packets (`role_contract_sha256`) and recorded in the immutable capsule ledger. Any tampering with role definitions on disk causes immediate verification failure.

---

## 🛡️ Context Isolation Pipelines (`isolateValidatorContext`)

When an implementer submits a task, their report typically contains subjective prose, emotional confidence assertions (_"I am 100% confident this fixes the problem"_), and explanations for why certain tests were skipped.

If a validator reads this narrative, **sycophantic cognitive bias** occurs: the validator anchors on the implementer's narrative and looks for confirming evidence rather than defects.

`olt` eliminates this contamination through an automated **Context Isolation Pipeline** (`isolateValidatorContext`, `excludeValidatorContamination`, `isolateCriticContext`).

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                            CONTEXT ISOLATION & SANITIZATION PIPELINE                             │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                  │
│  [ Raw Task Submission / Capsule State ]                                                         │
│    ├── Implementer prose: "Fixed edge cases, auth looks rock solid!"                             │
│    ├── Subjective confidence scores: `confidence: 0.99`                                          │
│    ├── Previous review notes & implementer rationalizations                                      │
│    └── Objective evidence: Git diffs, task contract, requirement IDs                             │
│                                  │                                                               │
│                                  ▼                                                               │
│  [ isolateValidatorContext / excludeValidatorContamination Engine ]                              │
│    ├── Recursively scrubs all forbidden keys (VALIDATOR_EXCLUSIONS)                              │
│    ├── Strips out all conversational justifications and confidence claims                        │
│    └── Retains ONLY ground-truth objective code state & requirement obligations                  │
│                                  │                                                               │
│                                  ▼                                                               │
│  [ Sanitized Lean Validator Packet (Token-Budgeted ≤ 4KB) ]                                      │
│    ├── `baseline_repository_state`: Git commit SHA before task execution                         │
│    ├── `current_repository_state`: Exact git diff and modified file list                         │
│    ├── `task_contract`: Assigned ID, write scope, and priority                                   │
│    ├── `mapped_requirements`: Specific prompt obligation statements                              │
│    ├── `original_prompt`: Verbatim prompt requirement text                                       │
│    └── `command_evidence`: Real execution receipts from `run:exec` / `shell`                     │
│                                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### The Strict Validator Exclusion Set (`VALIDATOR_EXCLUSIONS`)

The context isolation pipeline recursively purges the following key families from validator packets:

| Excluded Key Family                  | Why It Is Stripped from Validator Context                                  |
| :----------------------------------- | :------------------------------------------------------------------------- |
| `confidence`                         | Prevents anchoring on the implementer's self-reported certainty.           |
| `decision_narrative`                 | Eliminates conversational excuses and post-hoc rationalizations.           |
| `implementer_report` / `task_report` | Strips implementer prose; forces validator to inspect raw source code.     |
| `previous_review` / `prior_reviews`  | Prevents multi-round validators from inheriting earlier reviewers' biases. |
| `validator_report`                   | Prevents circular feedback loops across review rounds.                     |

### Critic Context Isolation (`isolateCriticContext`)

The whole-run Completeness Critic operates under a dedicated context filter that includes full requirements coverage, topological dependency graphs, orphan evidence ledgers, and completion gate receipts, while excluding individual task narrative noise.

---

## ⚡ Task Execution Briefs & Compact Markdown Format

Rather than forcing agents to parse hundreds of lines of complex JSON, `olt` emits compact, human- and LLM-readable markdown briefs (≤ 30 lines) directly to standard output:

```bash
bun harness.ts task:claim --run .olt/capsules/<run-id> --task task-db --agent worker-2 --role implementer
```

```markdown
### Task Leased: task-db

- **Agent**: `worker-2`
- **Lease Token**: `K6QeJSe2sZ4n4kcMTiH1oxGbXEKstjtLEBxG2F-2-5A`
- **Duration**: 20 minutes
- **Assigned Write Scope**: `src/db/schema.ts`, `src/db/migrations/`
- **Suggested Target Files**: `src/db/schema.ts`
- **Recommended Commands**:
  - `bun test tests/db/schema.test.ts`
- **Note**: Pass `--token K6QeJSe2sZ4n4kcMTiH1oxGbXEKstjtLEBxG2F-2-5A` to `task:submit`.
```

### Scripted JSON Access

When invoked in programmatic pipelines, passing `--format json` **before** any `--` separator causes the command to emit the structured JSON payload.

---

## ⚙️ Budgets & Global Invariants

Every role operates within immutable global resource budgets:

```json
{
  "min_adversarial_probes": 1,
  "max_repair_rounds": 6,
  "max_branch_depth": 5,
  "max_agents": 100,
  "max_output_bytes": 10485760,
  "default_lease_seconds": 1800,
  "default_max_parallel": 4
}
```

- **Mandatory Adversarial Probes:** A task validation cannot pass until at least `min_adversarial_probes` (default 1) probe round has been recorded.
- **Escalation Cap:** If a task reaches `max_repair_rounds` (default 6) rejections, it transitions to `escalated` and requires human intervention.
- **Branch Depth Tripwire:** Sub-agent branch nesting past depth 5 triggers an automatic escalation.
- **Agent Grant Ceiling:** A capsule enforces an upper ceiling of `max_agents` (default 100) registered grants to prevent runaway subagent generation.

---

[⬅ Previous: Host-Agnostic Architecture](./01-host-agnostic-architecture.md) | [Master Table of Contents](../README.md) | [Next: Bearer Token Security ➡](./03-bearer-token-security.md)

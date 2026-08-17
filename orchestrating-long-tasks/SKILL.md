---
name: orchestrating-long-tasks
description: Use when a request is long-running, spans multiple files or subsystems, needs parallel agents, must survive restarts or context loss, or requires independent validation and bounded repair before completion.
---

# Orchestrating Long Tasks

Turn a large prompt into a durable, graph-scheduled, independently validated run. The harness keeps
authoritative coordination under `.capsules/<run>/`, stores lightweight, verifiable state artifacts,
and can be resumed by Codex, ChatGPT coding agents, Claude Code, or Antigravity without relying
on conversation history or model-provider APIs.

This guide serves as the **high-level orchestrator manual** directing orchestrators on how to leverage the specialized agent configurations under `agents/` and detailed protocol references under `references/`.

---

## Specialized Agent Archetypes (`agents/`)

The harness partitions responsibilities across four distinct agent archetypes defined under `agents/`:

| Agent Spec                                           |  Tier  | Role & Responsibilities                                                                                                                                                                                                                                                                                                                                                                                                                          |
| :--------------------------------------------------- | :----: | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`agents/coordinator.yaml`](agents/coordinator.yaml) | Tier 2 | **Long Task Coordinator**: Owns capsule lifecycle, prompt capture, graph compilation, concurrency wave management, heartbeat tracking, and run completion. Dispatches Tier 3 workers and validators in the background.                                                                                                                                                                                                                           |
| [`agents/worker.yaml`](agents/worker.yaml)           | Tier 3 | **Task Worker**: Implements features strictly within assigned `write_scope`, conducts local pre-submission testing (unit/integration/negative tests), and resolves validator findings during repair rounds.                                                                                                                                                                                                                                      |
| [`agents/validator.yaml`](agents/validator.yaml)     | Tier 3 | **Adversarial Validator**: Executes mandatory gate proof commands via `run:exec`, enforces the Dual-Channel Validator Protocol & Automated UI Task Mandate (synthesizing DOM metrics and Playwright screenshots), performs adversarial invariant audits (edge cases, contract boundaries, layout math, text clipping, visual collisions, negative assertions), and issues formal structured pushbacks (`task:reject`) or passes (`task:review`). |
| [`agents/critic.yaml`](agents/critic.yaml)           | Tier 3 | **Completeness Critic**: Evaluates whole-repository git diff against original immutable prompt bytes, audits requirement coverage, verifies run completion gates, and issues final sign-off (`critic:review`).                                                                                                                                                                                                                                   |
| [`agents/openai.yaml`](agents/openai.yaml)           |   —    | **OpenAI / Codex Profile**: System interface definition for OpenAI Codex and ChatGPT coding agent environments.                                                                                                                                                                                                                                                                                                                                  |

---

## Specialized Reference Manuals (`references/`)

Deep technical documentation and operational contracts are available under `references/`:

- [`references/protocol.md`](references/protocol.md): Non-negotiable invariants, immutable prompt capture, role packet sanitization, and gate execution rules.
- [`references/cli.md`](references/cli.md): Exhaustive reference for every `harness.ts` command (`plan:*`, `queue:*`, `task:*`, `run:*`, `critic:*`, `summary:*`, `finding:*`, `report:*`, `evidence:*`, `orchestrator:*`).
- [`references/state-model.md`](references/state-model.md): Run directory structure, task state transitions, lease/recovery mechanics, and event stream integrity.
- [`references/host-adapters.md`](references/host-adapters.md): Two-tier agent architecture, main-thread isolation, and host-native subagent adapters for AGY, Claude Code, and Codex.
- [`references/failure-modes.md`](references/failure-modes.md): Complete failure mode taxonomy (stale leases, worker crashes, scope collisions, gate mismatches) and deterministic recovery strategies.
- [`references/parity-matrix.md`](references/parity-matrix.md): Host capability parity matrix across AI agent execution platforms.
- [`references/schema-examples.md`](references/schema-examples.md): Canonical JSON schemas for requirements, DAG graphs, submissions, findings, and reviews.

---

## Mandatory Multi-Agent Dispatch, The "Triad Floor" & The "$2N + 1$" Sizing Invariant

When running long-task execution waves, the orchestrator MUST enforce the **"Triad Floor" Invariant** (minimum 3 agents deployed) and the **"$2N + 1$" Agent Sizing Formula**, dispatching all concurrent implementers and validators simultaneously using a **single batch `invoke_subagent` tool call**:

### The Triad Floor & Atomic Implementer-Validator Pair Invariant

1. **Atomic Pair Rule**: When the Coordinator deploys an Implementer agent for any task, it **MUST ALWAYS** deploy a paired independent Validator agent simultaneously. An Implementer is **NEVER** dispatched alone.
2. **The Triad Minimum (Floor $\ge 3$)**: For any long-task workflow—even a single sequential task ($N = 1$)—there must **ALWAYS be at least 3 agents deployed**:
   - **1 Run Coordinator (Tier 2)**: Persistent manager of the capsule lifecycle, wave transitions, and milestone delivery.
   - **1 Task Implementer (Tier 3)**: Dedicated executor modifying code strictly within the leased `write_scope`.
   - **1 Adversarial Validator (Tier 3)**: Independent verifier executing monitored gate proofs and the multi-round rejection gauntlet.
3. **Linear Sizing Flexibility ($2N + 1$)**: For $N$ parallel tasks, the system scales with full flexibility:
   - $N = 1 \implies$ **3 Agents** (1 Coordinator + 1 Implementer + 1 Validator)
   - $N = 2 \implies$ **5 Agents** (1 Coordinator + 2 Implementers + 2 Validators)
   - $N = 3 \implies$ **7 Agents** (1 Coordinator + 3 Implementers + 3 Validators)
   - $N = 4 \implies$ **9 Agents** (1 Coordinator + 4 Implementers + 4 Validators)
   - $N = 6 \implies$ **13 Agents** (1 Coordinator + 6 Implementers + 6 Validators)

```typescript
// Correct: Single batch tool call deploying the 3-agent Triad (N=1) or multi-pair wave (N=2+)
invoke_subagent({
  Subagents: [
    {
      Role: "Implementer 1 (Task T-01)",
      TypeName: "self",
      Prompt: "Claim and implement task T-01 in run $RUN...",
    },
    {
      Role: "Validator 1 (Task T-01)",
      TypeName: "self",
      Prompt: "Adversarially audit task T-01 in run $RUN...",
    },
    {
      Role: "Implementer 2 (Task T-02)",
      TypeName: "self",
      Prompt: "Claim and implement task T-02 in run $RUN...",
    },
    {
      Role: "Validator 2 (Task T-02)",
      TypeName: "self",
      Prompt: "Adversarially audit task T-02 in run $RUN...",
    },
  ],
});
```

- **NEVER** deploy an Implementer without its paired Validator.
- **NEVER** run a single subagent loop to execute multiple tasks sequentially.
- **NEVER** block the Tier 1 main interactive thread; all workers and validators run in the background tree and report exclusively to the Tier 2 Coordinator.

---

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

---

## Hard rules

1. Preserve the user's complete prompt as immutable bytes before summarizing or planning it.
2. Never treat agent prose as authoritative state or proof.
3. Never let an implementer validate its own work or feed its report into a validator packet.
4. Never dispatch overlapping write scopes in parallel.
5. Never mutate a run with an unauthenticated external tool; dispatch mutations strictly through the harness CLI.
6. Never call a model API or launch an LLM CLI. Dispatch only through the current host's native subagent mechanism.
7. Never announce completion while the runtime reports a blocker.
8. Describe mandatory gate evidence only as `trusted_host_observed_v1`, never as hermetic, sealed, or sandboxed.
   Packet Git commands and the accepted Git diff gates use one restricted command seam that disables
   hooks, pathname fsmonitor, replacement objects, pagers, external diff, and text conversion.
   Repository discovery rejects repository-local `diff.external`, `diff.*.textconv`, active
   `core.fsmonitor`, or `filter.*.clean`, `filter.*.smudge`, or `filter.*.process` before status.

---

## Orchestrator Guidance: Multi-Agent Dispatch & Adversarial Validation

### 1. Two-Tier Agent Architecture & Main Thread Isolation (3-Tier Hierarchy & "$2N + 1$" Formula)

To keep the user's interactive conversation clean, responsive, and completely isolated from worker tool churn, adhere strictly to the 3-tier hierarchy:

1. **Tier 1 (Main Interactive Thread)**:
   - Dedicated exclusively to user interaction, requirement intake, and final delivery.
   - Spawns **exactly one** child: the `Background Run Coordinator` (Tier 2).
   - Never runs implementer/validator tool loops, git operations, or background command polling directly.
2. **Tier 2 (Background Run Coordinator)**:
   - Owns capsule lifecycle, planning, dependency graph compilation, concurrency waves, and lease management.
   - Dispatches and supervises all Tier 3 workers and validators using the $2N + 1$ sizing formula.
   - Reports to Tier 1 parent **only at major milestones** (Plan Ready, Wave Complete, Escalation, Final Sign-off).
3. **Tier 3 (Worker & Validator Subagents)**:
   - Ephemeral executors assigned disjoint write scopes.
   - $N$ implementers + $N$ validators running concurrently.
   - Message and report exclusively to the Tier 2 Coordinator via host-native messaging.

See [references/host-adapters.md](references/host-adapters.md) for adapter implementations across Antigravity, Claude Code, and Codex.

### 2. Context Sanitization & Independent Validation

Self-grading and conversational bias lead to unhandled edge cases, missing assertions, and overlooked defects. The harness enforces **Adversarial Role Separation**:

- **Context Sanitization**: When a worker submits a task via `task:submit`, implementer prose and subjective confidence claims are completely stripped from the validator's packet.
- **Pure Allowlisted Context**: The validator receives only immutable prompt requirements, acceptance criteria, write scope, changed file paths, physical git diff, and mandatory gate command contracts.

### 3. Dual-Channel Validator Protocol, Invariant Audits & Automated UI Task Mandate

The coordinator must direct Tier 3 validators to perform rigorous, multi-round adversarial verification across all system dimensions (detailed agent instructions defined in [`agents/validator.yaml`](agents/validator.yaml)):

- **Mandatory Gate Execution**: Execute test suites via `run:exec` under process monitoring and verify exit code 0.
- **Dual-Channel Validator Protocol & Architectural Rationale**:
  - **Architectural Rationale ("Why" over "What")**:
    Headless DOM assertions (such as jsdom or shallow render `.toBeVisible()` checks) operate solely on virtual DOM nodes and CSS property declarations in memory. Consequently, they fail completely to detect actual visual rendering regressions: subpixel layout arithmetic rounding overflows, GPU rasterization text clipping, font-fallback baseline misalignments, descending glyph clipping under fixed line-height/overflow:hidden boundaries, flex-wrap child layout collisions, and complex runtime `z-index` stacking context overlaps. Conversely, visual screenshot inspection alone may miss computed subpixel metrics, exact color contrast ratios, or invisible DOM stacking collisions. The Validator MUST synthesize BOTH channels:
    1. **Channel 1 - Computed DOM Metrics (`visual-report.json`)**: Bounding box geometry, computed styles, scrollWidth/clientWidth overflow measurements, line-height text clipping, z-index stacking hierarchy, WCAG AA contrast ratios, and origin coordinate invariants.
    2. **Channel 2 - Visual Screenshots (`.png`)**: High-resolution rasterized layout captures across target viewports (mobile 375x667, tablet 768x1024, desktop 1280x800) validating authentic Chromium/WebKit layout engine rendering.
  - **Dual-Channel Gap Filling Principle**:
    If one channel lacks information or is temporarily unavailable, the other channel fills the gap. When computed DOM metrics are missing, visual screenshots provide empirical visual proof. When screenshots are partial, DOM metrics provide mathematical precision. When both channels are present, cross-channel corroboration guarantees zero discrepancies.
  - **Automated UI Task Mandate**:
    Any task touching UI/frontend files (e.g., `.tsx`, `.jsx`, `.vue`, `.svelte`, `.html`, `.css`, `.scss`, `.less`, `.svg`, components, views, pages, styles, or canvas engines) AUTOMATICALLY mandates dual-channel visual validation. Approving any UI change without dual-channel visual evaluation is strictly prohibited.
  - **Negative Visual Validation & Anti-Mocking Rules**:
    1. **Zero Mocked/Stubbed Screenshots**: Validators **MUST REJECT** empty (0-byte) screenshot captures, stubbed image outputs, bypassed canvas contexts, or test runs that skip authentic Playwright browser layout rendering.
    2. **Strict Failure on Visual Threshold Breaches & Missing Viewports**: Validators **MUST REJECT** submissions where pixel differences exceed strict visual regression thresholds or where the required multi-viewport matrix (mobile 375x667, tablet 768x1024, desktop 1280x800) is omitted or incomplete.
    3. **Concrete Negative Testing Requirements**: Negative visual tests **MUST** prove that broken layouts, unlinked stylesheets/fonts, missing SVG assets, or container collisions actively trigger test failures and screenshot diff rejections.
  - **Automated Artifact Ingestion**: In `run:exec`, `task:review`, or `task:reject`, when a test/check command outputs screenshots or DOM reports (or writes to `test-results/` / `screenshots/`), the harness automatically detects and ingests them into `.capsules/<run>/evidence/` and `.capsules/<run>/reports/`, recording artifact paths in the evidence and report JSON records.
  - **Harness Screenshot & Evidence Inspection Commands**: Inspect captured evidence using `bun $PINNED evidence:get --run $RUN --task <task-id> --screenshots`, `bun $PINNED report:get --run $RUN --task <task-id> --screenshots`, or `bun $PINNED evidence:screenshots --run $RUN`.
  - **Dual-Channel Evaluation Invariant in Reviews**: Validators **MUST** inspect both DOM metrics and captured screenshots, evaluating them explicitly in their review findings and markdown before issuing any approval:
    - **Layout Overflow**: Detect and reject unintentional horizontal scrollbars (`overflow-x` leaks) on 375px mobile, 768px tablet, and 1280px desktop viewports. Detect flex/grid child overflow where child containers exceed parent boundaries (e.g. missing `min-width: 0` or unconstrained flex items).
    - **Text Clipping & Descending Glyphs**: Reject premature or unintended ellipsis truncation, unnatural mid-word breaks or orphan words, and clipped descending glyphs ('g', 'y', 'p', 'q', 'j') caused by tight `line-height` combined with `overflow: hidden` or fixed container heights.
    - **Visual Collisions & Stacking Contexts**: Enforce strict `z-index` stacking hierarchy across modals, fixed/sticky headers, floating action buttons (FABs), dropdowns, and tooltips. Ensure notification badges or floating overlays never collide with or obscure interactive tap targets (minimum 44x44px touch targets).
    - **Responsive Constraints**: Ensure visual fidelity across all standard breakpoints (mobile 375px, tablet 768px, desktop 1280px+) without collapsed panels or squished inputs.
    - **Typography & Accessibility**: Verify correct letter-spacing/tracking, font hierarchy, semantic HTML tags, ARIA attributes, and WCAG AA contrast.
  - **Prohibition of Blind UI Approvals**: Issuing an approval (`task:review --status pass`) on UI changes without empirical dual-channel visual evaluation is strictly prohibited.
  - **Render Cache & Database Reset Mandate**: When validating layout rendering or running visual checks against stateful or caching UI engines (e.g., in-memory layout caches, local database stores, persistent viewport storage), Validators **MUST** ensure the render cache is reset prior to screenshot capture (e.g., clearing layout caches, resetting local storage/database) to guarantee that fresh layout engine geometry is computed and regressions are not masked by stale cache.
  - **Top-Left / Origin Orphan Text Invariant**: Ensure that no orphan text, unplaced edge badges, or unpositioned labels appear stuck at canvas origin `(0, 0)` or fail to refresh when panning/dragging away. Unpositioned elements without valid coordinates MUST NOT render at `(0, 0)`.
  - **Canvas Reset Action Invariant**: Verify that pressing the Reset button (or `R` keyboard shortcut) not only resets viewport zoom/pan but also cleanly purges cached layout geometry for the active dataset to trigger fresh layout recalculation.
- **Contract & Boundary Stress-Testing**: Test boundary conditions, input extremes (empty collections, maximum byte buffers, invalid unicode), and type contracts.
- **Negative Assertions & Error Handling**: Prove that unauthorized requests, invalid arguments, and failure conditions are explicitly tested and cleanly handled.
- **Substantive Test Audit**: Reject tautological, empty, or mocked-out tests that bypass actual business logic.
- **Zero-Any TypeScript Audit**: Prohibit all forms of TypeScript `any` (`: any`, `Promise<any>`, `as any`, `<any>x`, `T = any`) and lint suppressions (`@ts-ignore`, `@ts-expect-error`, `eslint-disable`).

### 4. Structured Pushback, Minimum Mandatory Rejection Gauntlet & Bounded Repair Loops

To guarantee publication-grade code robustness, the harness enforces a **Mandatory Multi-Round Adversarial Rejection Gauntlet** (implemented by [`agents/validator.yaml`](agents/validator.yaml)):

1. **Minimum Mandatory Rejections (Min 1 Rejection)**:
   - **Round 1 MUST BE REJECTED** by the Validator (`task:reject`), regardless of whether the initial code passes basic tests.
   - The Validator must actively question and stress-test the implementation:
     - **Round 1 Pushback**: Stress-tests boundary inputs, empty/large collections, typing strictness, zero-any compliance, negative invariants, visual layout bounds, and demands explicit negative test assertions.
2. **Conditional Approval (Round 2+) & Additional Pushbacks**:
   - In Round 2+, the Validator may issue `task:review --status pass` ONLY IF all prior pushback demands have been comprehensively satisfied with empirical test proofs and zero defects.
   - If any defects or gaps remain in Round 2+, the Validator issues additional structured pushbacks (`task:reject`) until fully satisfied.
3. **Configurable Pushback Thresholds**:
   - `min_adversarial_rejections`: Default `1` (minimum mandatory pushback round).
   - `max_repair_rounds`: Default `6` (maximum 6 total rounds: 1 mandatory rejection + up to 5 repair rounds before escalation).
   - Both parameters are fully configurable via config files (`.capsulerc`, `harness.config.json`, or agent YAML).
4. **Bounded Escalation**: If a task fails across max repair rounds (default 6), the harness transitions the task to `escalated` and alerts the coordinator/user.

### 5. The 4 Non-Negotiable Coordinator Laws

To prevent single-agent collapse and preserve multi-agent integrity:

1. **Mandatory No-Code Edit Law**: The Coordinator is strictly forbidden from writing, editing, or patching application source code, test files, or scripts. All code modifications must be delegated to Tier 3 Implementers via `invoke_subagent`.
2. **Harness-Only Workflow Management**: The Coordinator drives the workflow exclusively through the pinned harness CLI (`bun $PINNED <cmd>`) and host subagent dispatch (`invoke_subagent`).
3. **Persistent Lifecycle Law (Coordinator Stays as the Last)**: The Coordinator remains active from start to final sealing, observing wave barriers and dispatching subsequent subagent waves.
4. **Cascading Rule Invocation**: When gaps or pushbacks arise, the Coordinator invokes the Cascading Fan-Back Protocol (`plan:replan`) to partition scopes and dispatch fresh repair subagent pairs.

### 6. Cascading Scope-Aware Replanning & Fan-Back Protocol

When late-stage completeness verification reveals defects, the orchestrator MUST NOT attempt in-place monolithic patching. Instead, follow the formal **Fan-Back Protocol**:

1. **Late-Stage Defect Detection**:
   - The Completeness Critic reviews the full repository diff against immutable prompt bytes during `critic:start`.
   - If missing requirements, cross-subsystem defects, or contract gaps are identified, the critic rejects the run via `critic:reject` with structured findings.
2. **Critic Rejection (`critic:reject`)**:
   - The critic submits actionable findings specifying finding IDs, affected file paths, observation, remediation requirements, and revalidation gates.
   - Run state records `request_changes` and completion is halted.
3. **Scope-Aware Dynamic Replanning (`plan:replan`)**:
   - The Tier 2 Coordinator executes `plan:replan --run $RUN --actor coordinator`.
   - The harness ingests critic findings, clusters them by file paths into disjoint write scopes, increments the graph revision ($R \to R+1$), and compiles a new Repair Wave $R$ DAG containing modular repair tasks (e.g. `task-repair-r1-1`, `task-repair-r1-2`) with mandatory revalidation gates.
4. **Parallel Batch Repair Wave Dispatch ($2N + 1$)**:
   - The coordinator calculates the repair wave size $N$ and dispatches $N$ repair implementers and $N$ adversarial validators simultaneously in a single `invoke_subagent` call.
   - Repair workers execute remediation strictly within their partitioned disjoint write scopes.
5. **Validation Barriers & Re-Convergence**:
   - Every repair task must independently pass adversarial validation and mandatory gate execution via `run:exec` and `task:review`.
   - All repair tasks in Wave $R$ form an atomic validation barrier; once all are `done`, the repair wave converges.
   - The coordinator dispatches a fresh completeness critic session (`critic:start` -> `critic:review`) to verify whole-repository compliance before final sealing (`run:complete`).

---

## Standard CLI & API Protocol

The harness CLI provides colon-based domain commands that output concise markdown briefs (<= 30 lines)
for direct agent consumption with zero raw JSON authoring required:

```text
PINNED=orchestrating-long-tasks/scripts/harness.ts
RUN=.capsules/<slug>
```

### Phase 1: Planning & Compilation

Initialize the capsule with exact prompt capture:

```bash
printf "%s" "$PROMPT" | bun $PINNED plan:init --repo . --run <slug> --prompt-stdin
```

Register modular tasks with disjoint write scopes:

```bash
bun $PINNED plan:add --run $RUN --id <task-id> --label "<label>" --scope <path> --gate "<gate-cmd>" [--deps <dep-id>]
```

Check plan status and compile the dependency graph:

```bash
bun $PINNED plan:status --run $RUN
bun $PINNED plan:compile --run $RUN --actor planner
```

Dynamic scope-aware replanning from critic/validator findings:

```bash
# Ingest critic rejection findings, partition scopes, and compile Repair Wave DAG (Revision R+1)
bun $PINNED plan:replan --run $RUN --actor coordinator [--findings-file <file> | --findings '<json>'] [--gate "<reval-gate>"]
```

`plan:compile` and `plan:replan` automatically perform atomic prompt decomposition, line-by-line coverage analysis,
scope independence validation, and graph construction.

### Phase 2: Queue Management & Concurrency

Inspect ready and partitioned tasks:

```bash
bun $PINNED queue:next --run $RUN
bun $PINNED queue:list --run $RUN
```

Pop the highest-priority task and lease it to a worker:

```bash
bun $PINNED queue:pop --run $RUN --agent <worker-id> --lease-seconds 1800
```

### Phase 3: Task Implementation & Review Lifecycle

Claim, heartbeat, and submit implementation:

```bash
# Claim explicit task (or use queue:pop)
bun $PINNED task:claim --run $RUN --task <task-id> --agent <worker-id>

# Heartbeat active lease during work
bun $PINNED task:heartbeat --run $RUN --task <task-id> --agent <worker-id> --token <token>

# Submit work when ready
bun $PINNED task:submit --run $RUN --task <task-id> --agent <worker-id> --token <token> --summary "<summary>"
```

Independent Validation & Review:

```bash
# Start independent validation (dispatches validator packet)
bun $PINNED task:validate-start --run $RUN --task <task-id> --validator <val-agent>

# Validator executes the mandatory gate command under monitoring
bun $PINNED run:exec --run $RUN --task <task-id> --gate <gate-id> --actor <val-agent> -- <gate-argv...>

# Execute frontend visual validation gate (Playwright screenshot test suite)
bun $PINNED run:exec --run $RUN --task <task-id> --gate gate-ui-visual --actor <val-agent> -- bun test tests/visual/...

# Inspect captured screenshot evidence
bun $PINNED evidence:get --run $RUN --task <task-id> --screenshots

# Record validation approval (including visual screenshot evaluation)
bun $PINNED task:review --run $RUN --task <task-id> --validator <val-agent> --token <token> --status pass --summary "<summary>"

# Or reject with findings for implementer repair (including visual defects)
bun $PINNED task:reject --run $RUN --task <task-id> --validator <val-agent> --token <token> --reason "<reason>" --finding "<remediation>" [--evidence <cmd-id>]
```

### Phase 4: Completeness Critic & Lifecycle Completion

Run final completion gate and completeness critic:

```bash
# Run completion gate
bun $PINNED run:exec --run $RUN --gate gate-run-completion --actor coordinator -- bun test tests

# Initialize completeness critic session
bun $PINNED critic:start --run $RUN --critic <critic-id>

# Critic approves all requirements and gate evidence
bun $PINNED critic:review --run $RUN --critic <critic-id> --token <token> --decision approve --summary "<summary>"

# Or critic rejects with structured findings triggering fan-back replanning
bun $PINNED critic:reject --run $RUN --critic <critic-id> --token <token> --reason "<reason>" --finding "<remediation>" [--findings-file <file>]

# Complete the run and seal artifacts (only after critic approval)
bun $PINNED run:complete --run $RUN --actor coordinator
bun $PINNED run:status --run $RUN
```

### Phase 5: Visual Reporting & Summary Suite

Export graph summary, visual dashboard, and import into GVUI:

```bash
# Export summary suite (graph dataset, metrics, timeline)
bun $PINNED summary:export --run $RUN

# View human-readable summary
bun $PINNED summary:view --run $RUN

# Inspect captured screenshots across tasks and runs
bun $PINNED evidence:screenshots --run $RUN

# Import execution graph into GVUI (run from gvui repo)
bun run gvui:import --capsule $RUN
```

---

## Harness Configuration (`harness.config.json`)

Harness behavior can be customized by placing a `harness.config.json` or `.harness.config.json` file in the repository root (or per-capsule `config.json`):

```json
{
  "max_repair_rounds": 5,
  "max_output_bytes": 10485760,
  "default_lease_seconds": 1800,
  "default_max_parallel": 4,
  "strict_validation": true
}
```

- **`max_repair_rounds`** (default `5`): Maximum repair rounds allowed for a rejected task or completeness critic remediation before transitioning to `escalated`.
- **`max_output_bytes`** (default `10MB`): Maximum stdout/stderr output size captured per command execution.
- **`default_lease_seconds`** (default `1800`): Default worker lease duration for task claims.
- **`default_max_parallel`** (default `4`): Default concurrency limit for independent task execution.
- **`strict_validation`** (default `true`): Enforces mandatory gate coverage and independent validator checks.

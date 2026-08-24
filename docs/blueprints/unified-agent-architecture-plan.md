# Unified Agent Architecture & Deterministic Dispatch: Master Quality & Implementation Blueprint

## 1. Executive Summary & Quality Strategy

### The Core Problem: The Dispatch Degradation Vector

Historical agent runs suffered from **conversational prompt degradation**:

- When parent agents invoked child subagents, they generated ad-hoc, lossy summary strings in `define_subagent` / `invoke_subagent`, completely stripping away core invariants.
- Maintaining two separate file trees per agent (`olt/agents/*.yaml` vs `olt/roles/*.md`) multiplied cognitive drift and led to stale, out-of-sync instructions.
- Using boolean toggles (`flag: true`) for universal invariants created an anti-pattern where non-negotiable laws of the codebase were falsely represented as configurable settings.

### The Quality Maximization Architecture

To achieve 100% deterministic quality, this blueprint establishes a **4-Tier Hardened Quality Engine**:

1. **Single Source of Truth (SSoT) Unified YAML Manifest**: Every agent is defined by exactly one comprehensive YAML file (`olt/agents/<role>.yaml`) containing metadata, tool toggles, capabilities, permissions (`may`/`must_not`), and complete operational runbooks.
2. **Universal Invariants Hardcoded in Engine (0 Booleans)**: Universal laws (0-any TypeScript, 0 compiler suppressions, scratch directory hygiene, zero tool hallucination, evidence over assertion) are enforced unconditionally by the engine and `doctor`. Fake boolean toggles are permanently removed.
3. **Permission Anti-Collision & Health Verification Engine**: A mechanical check ensuring strictly disjoint sets (`Allowed ∩ Forbidden = ∅`), capability registry resolution, and role-hierarchy boundary enforcement.
4. **Deterministic Harness Dispatch Engine (`agent:brief` / `agent:define`)**: A typed TypeScript compiler that ingests the unified YAML, repository policy (`policy.json`), and task context to output the **exact 100% complete landing prompt** for native host tools (`define_subagent` / `invoke_subagent`).

---

## 2. The 3-Layer Permission Resolution & Policy Ingestion Pipeline

To guarantee that no agent runs unauthorized commands or bypasses repository boundaries, permissions are resolved through a hardened 3-layer pipeline:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                     3-LAYER PERMISSION RESOLUTION PIPELINE                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [ Layer 1: Repository Policy (`policy.json` / `repo-policy.ts`) ]         │
│  • Global ecosystem bounds: `allowed_commands`, `forbidden_commands`,      │
│    `test_runner` patterns, `read_scope_neighborhood_depth`, and scratch     │
│    hygiene boundaries.                                                      │
│                                                                             │
│  [ Layer 2: Agent Unified Permissions (`olt/agents/<role>.yaml`) ]          │
│  • Agent-specific bounds: `permissions.may`, `permissions.must_not`,        │
│    `permissions.commands` (CLI whitelist), and `permissions.spawns`.        │
│                                                                             │
│  [ Layer 3: Runtime RBAC Guard (`olt/scripts/src/policy/rbac-engine.ts`) ]  │
│  • Static & dynamic regex denylist: `STATIC_SUPERVISOR_FORBIDDEN_PATTERNS`, │
│    `STATIC_IMPLEMENTER_FORBIDDEN_PATTERNS`, and subshell guards.            │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                         HOW AND WHEN THEY ARE COMBINED                      │
│                                                                             │
│  1. Dispatch Time (`agent:brief` / `task:brief`):                           │
│     The prompt compiler loads the YAML manifest (Layer 2) and merges it     │
│     with the active `policy.json` (Layer 1), emitting a dedicated           │
│     "SECTION 3: REPOSITORY POLICY & PERMISSION BOUNDARIES" inside the       │
│     compiled landing prompt before calling `define_subagent`.               │
│                                                                             │
│  2. Execution Time (`bun harness.ts shell -- <cmd>`):                       │
│     The RBAC engine intercepts the command and verifies against all 3       │
│     layers. Any violation throws a signed `PERMISSION_DENIED` defect.       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Permission System Health & Anti-Collision Engine

To prevent permission loopholes, conflicting directives, or security bypasses, `doctor` and the AST manifest validator execute these **4 Mathematical Anti-Collision Proofs**:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                     PERMISSION ANTI-COLLISION PROOFS                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Proof 1: Disjoint Set Invariant (Allowed ∩ Forbidden = ∅)                  │
│  • No command pattern present in `allowed_commands` or `permissions.commands`│
│    can overlap with any entry in `forbidden_commands` or static denylists.  │
│                                                                             │
│  Proof 2: Capability Registry Whitelist Resolution                          │
│  • Every CLI command in `permissions.commands` MUST resolve to an existing,  │
│    actively registered spec in `olt/references/cli-capabilities.json`.      │
│                                                                             │
│  Proof 3: Role-Hierarchy Boundary Confinement                               │
│  • Cognitive Validators: `can_execute_shell === false` (0 commands).        │
│  • Supervisory Tiers (Mind, Orchestrator, Coordinator): 0 file-edit tools    │
│    and 0 direct unit test execution commands (`bun test`).                  │
│  • Implementers: Confined strictly to file-scoped tests; whole-repo test    │
│    suites (`^bun test$`, `^npm test$`) are permanently in forbidden list.   │
│                                                                             │
│  Proof 4: Spawning Authority DAG Validation                                 │
│  • An agent can ONLY spawn roles declared in its `permissions.spawns` list. │
│  • Cross-tier spawning (e.g. Mind spawning Implementers) is blocked.        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Canonical Unified Agent YAML Schema Specification (0 Boolean Invariants)

Every agent manifest in `olt/agents/<role>.yaml` MUST strictly conform to this typed schema:

```yaml
name: "implementer"
role: "implementer"
tier: 3
provider:
  - antigravity
  - agy
  - claude
  - codex
  - cursor
  - generic
tools:
  enable_subagent_tools: false
  enable_write_tools: true
interface:
  display_name: "Task Implementer"
  short_description: "Tier 3 leased implementer operating within disjoint write scopes with in-lease micro-cycles"
permissions:
  may:
    - "Claim ready or retry-ready tasks holding exactly one lease token"
    - "Create, edit, and delete files strictly within the leased write scope"
    - "Execute 1-hop in-lease micro-cycles (task:reject --in-lease) directly remediating findings"
    - "Run incremental typechecks and AST audits via task:check"
  must_not:
    - "Ask user for prompts or instructions during execution"
    - "Hallucinate nonexistent host tool SDKs or pseudo-commands"
    - "Touch or modify any file outside the leased write scope"
    - "Validate, review, or probe its own work (independent validation invariant)"
    - "Write loose scratch files or logs in repository root (must use scratch/)"
    - "Run whole-repository test suites (must use file-scoped tests only)"
  commands:
    - "task:brief"
    - "task:claim"
    - "task:check"
    - "task:heartbeat"
    - "run:exec"
    - "task:submit"
    - "task:release"
    - "doctor"
    - "whoami"
  spawns:
    - "sub-implementer"
    - "sub-investigator"
protocol:
  cli: "bun ~/.agents/skills/olt/scripts/harness.ts"
  zero_json: true
instructions: |
  ### Step 1: Pre-Flight Doctor Check
  Run `bun harness.ts doctor` upon lease claim to verify capsule integrity and permission health.

  ### Step 2: Zero-Exploration Exact-Anchor Implementation
  Implement code strictly inside the leased write scope.

  ### Step 3: Fast Incremental Verification
  Run `bun harness.ts task:check --file <path>` for millisecond typechecking and invariant verification.

  ### Step 4: Submission & Proofs
  Submit with mandatory `--summary` and cited command evidence.
```

---

## 5. Parallel Execution Topology & Brent Work/Span Matrix

We structure the implementation using **Brent's Work/Span Theorem ($P = \lceil W / S \rceil = 4 \text{ Lanes}$)** with **100% Disjoint Write Scopes**:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                       PARALLEL EXECUTION TOPOLOGY MATRIX                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [ PHASE 1: CORE FOUNDATION & QUALITY GATE (Serial - Main Thread) ]         │
│  • Task 1.1: `scripts/validate-agent-manifests.ts` (AST Schema Validator)   │
│  • Task 1.2: `olt/scripts/src/authority/manifest-schema.ts` (Type Schema)   │
│  • Task 1.3: `olt/scripts/src/policy/permission-health.ts` (Anti-Collision) │
│  • Task 1.4: `olt/scripts/src/cli/commands/agent-brief.ts` (Prompt Compiler)│
│  • Task 1.5: `olt/scripts/src/cli/registry/agent.ts` (CLI Command Binding)  │
│                         │                                                   │
│                         ▼                                                   │
│  [ PHASE 2: MASSIVE PARALLEL SSoT WAVE (4 Fully Disjoint Lanes) ]           │
│  ┌──────────────────┬──────────────────┬──────────────────┬──────────────┐  │
│  │ Lane A:          │ Lane B:          │ Lane C:          │ Lane D:      │  │
│  │ Supervisors      │ Coordinators     │ Workers          │ Planners     │  │
│  ├──────────────────┼──────────────────┼──────────────────┼──────────────┤  │
│  │ • mind.yaml      │ • coordinator    │ • implementer    │ • planner    │  │
│  │ • orchestrator   │ • meta-auditor   │ • validator      │ • plan-valid │  │
│  │                  │ • mind-auditor   │ • completeness-  │ • ind-plan   │  │
│  │                  │                  │   critic         │ • ind-audit  │  │
│  └──────────────────┴──────────────────┴──────────────────┴──────────────┘  │
│                         │                                                   │
│                         ▼                                                   │
│  [ GATE 2: MECHANICAL AST MANIFEST AUDIT (`validate-agent-manifests.ts`) ]  │
│  • Automated assertion: 100% of YAMLs pass schema, 0 collisions, 0 booleans │
│                         │                                                   │
│                         ▼                                                   │
│  [ PHASE 3: CONVERGENCE & VERIFICATION (2 Disjoint Lanes) ]                 │
│  ┌─────────────────────────────────────┬─────────────────────────────────┐  │
│  │ Lane E: Legacy Roles Retirement     │ Lane F: Comprehensive Unit Tests│  │
│  │ • Safely remove `olt/roles/` dir    │ • `tests/unit/authority/`       │  │
│  │ • Update core path references       │ • `tests/unit/cli/commands/`    │  │
│  └─────────────────────────────────────┴─────────────────────────────────┘  │
│                         │                                                   │
│                         ▼                                                   │
│  [ PHASE 4: FINAL SYSTEM RELEASE (Serial - Main Thread) ]                   │
│  • Format (`oxfmt`), Typecheck (`tsc --noEmit`), Git Commit, Push & Sync    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Disjoint Write Scope Isolation Guarantee

| Lane                      | Assigned Disjoint Write Scope                                 | Target Files                                                                                        |
| :------------------------ | :------------------------------------------------------------ | :-------------------------------------------------------------------------------------------------- |
| **Lane A (Supervisors)**  | `olt/agents/{mind,orchestrator}.yaml`                         | `mind.yaml`, `orchestrator.yaml`                                                                    |
| **Lane B (Coordinators)** | `olt/agents/{coordinator,meta-auditor,mind-auditor}.yaml`     | `coordinator.yaml`, `meta-auditor.yaml`, `mind-auditor.yaml`                                        |
| **Lane C (Workers)**      | `olt/agents/{implementer,validator,completeness-critic}.yaml` | `implementer.yaml`, `validator.yaml`, `completeness-critic.yaml`                                    |
| **Lane D (Planners)**     | `olt/agents/{planner,plan-validator,independent-*}.yaml`      | `planner.yaml`, `plan-validator.yaml`, `independent-planner.yaml`, `independent-planner-audit.yaml` |
| **Lane E (Cleanup)**      | `olt/roles/`, `olt/scripts/src/core/paths.ts`                 | Path redirection and legacy role retirement                                                         |
| **Lane F (Tests)**        | `tests/unit/authority/`, `tests/unit/cli/`                    | Unit test suite & automated test receipts                                                           |

---

## 7. Incision-by-Incision Quality Checklist

### Incision 1: Core Engine & Automated AST Validator

1. Implement `olt/scripts/src/authority/manifest-schema.ts` defining `UnifiedAgentManifest` interface (0 boolean invariants).
2. Implement `olt/scripts/src/policy/permission-health.ts` executing the 4 Anti-Collision Proofs (`Allowed ∩ Forbidden = ∅`).
3. Implement `scripts/validate-agent-manifests.ts` CLI validator checking every YAML in `olt/agents/`.
4. Implement `olt/scripts/src/cli/commands/agent-brief.ts` producing 1-shot prompt briefings.
5. Register `agent:brief` and `agent:define` in `olt/scripts/src/cli/registry/agent.ts`.
6. Run `bun scripts/validate-agent-manifests.ts` (Pre-flight baseline).

### Incision 2: SSoT Manifest Consolidation (Lanes A, B, C, D)

1. **Lane A**: Merge `roles/mind.md` $\rightarrow$ `agents/mind.yaml`, `roles/orchestrator.md` $\rightarrow$ `agents/orchestrator.yaml`.
2. **Lane B**: Merge `roles/coordinator.md` $\rightarrow$ `agents/coordinator.yaml`, `roles/meta-auditor.md` $\rightarrow$ `agents/meta-auditor.yaml`, `roles/mind-auditor.md` $\rightarrow$ `agents/mind-auditor.yaml`.
3. **Lane C**: Merge `roles/implementer.md` $\rightarrow$ `agents/implementer.yaml`, `roles/validator*.md` $\rightarrow$ `agents/validator.yaml`, `roles/completeness-critic.md` $\rightarrow$ `agents/completeness-critic.yaml`.
4. **Lane D**: Merge `roles/planner.md` $\rightarrow$ `agents/planner.yaml`, `roles/plan-validator.md` $\rightarrow$ `agents/plan-validator.yaml`, `roles/independent-*.md` $\rightarrow$ `agents/independent-*.yaml`.
5. Run `bun scripts/validate-agent-manifests.ts` (All 12 agents MUST pass with Exit Code 0, 0 collisions).

### Incision 3: Step-by-Step Runbooks & Doctor Integration

1. Verify every manifest's `instructions:` block starts with:
   - **Step 1: Pre-Flight Doctor Check** (`bun harness.ts doctor`).
   - **Step 2: Subagent Dispatching Protocol** (Must run `bun harness.ts agent:brief --role <child>` before `define_subagent` / `invoke_subagent`).
   - **Step 3: Execution & Verification** (`task:check` for typechecks & AST invariants).
   - **Step 4: Submission & Reset** (`task:submit`, `manage_subagents Action: 'kill'`).

### Incision 4: Retirement of Legacy `olt/roles/`

1. Safely remove all files in `olt/roles/`.
2. Update all imports and references in `olt/scripts/` to reference `olt/agents/`.
3. Update `AGENTS.md` and `SKILL.md` to reflect SSoT architecture.

### Incision 5: Full Integration & Global Sync

1. Run `bun run format`.
2. Run `bun run typecheck` (`tsc -p tsconfig.json --noEmit` exits 0).
3. Run `bun test` (All unit tests pass).
4. Commit: `feat(agents): consolidate SSoT unified agent architecture and deterministic dispatch engine`.
5. Push to `origin/main` and run `bun scripts/sync-global.ts`.

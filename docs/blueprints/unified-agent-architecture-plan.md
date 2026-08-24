# Unified Agent Architecture & Deterministic Dispatch: Master Quality & Implementation Blueprint

## 1. Executive Summary & Quality Strategy

### The Core Problem: The Dispatch Degradation Vector
Historical agent runs suffered from **conversational prompt degradation**:
- When parent agents invoked child subagents, they generated ad-hoc, lossy summary strings in `define_subagent` / `invoke_subagent`, completely stripping away core invariants (0-any TypeScript, scope isolation, 0-command cognitive validator locks, scratch hygiene, doctor pre-flight checks).
- Maintaining two separate file trees per agent (`olt/agents/*.yaml` vs `olt/roles/*.md`) multiplied cognitive drift and led to stale, out-of-sync instructions.

### The Quality Maximization Architecture
To achieve 100% deterministic quality, this blueprint establishes a **3-Tier Hardened Quality Engine**:
1. **Single Source of Truth (SSoT) Unified YAML Manifest**: Every agent is defined by exactly one comprehensive YAML file (`olt/agents/<role>.yaml`) containing metadata, tool toggles, capabilities, permissions (`may`/`must_not`), invariants, and complete operational runbooks.
2. **Deterministic Harness Dispatch Engine (`agent:brief` / `agent:define`)**: A typed TypeScript compiler that ingests the unified YAML, repository policy (`policy.json`), and task context to output the **exact 100% complete landing prompt** for native host tools (`define_subagent` / `invoke_subagent`).
3. **Automated AST Manifest Quality Gate (`scripts/validate-agent-manifests.ts`)**: A strict validation script that mechanically verifies every YAML manifest against an exhaustive schema (0 missing fields, mandatory `must_not` clauses, valid CLI commands whitelisted in `cli-capabilities.json`, and explicit `doctor` pre-flight steps).

---

## 2. Canonical Unified Agent YAML Schema Specification

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
invariants:
  disjoint_write_scope_isolation: true
  zero_any_typescript: true
  zero_compiler_suppressions: true
  file_scoped_testing_only: true
  non_empty_payload_mandate: true
  no_root_scratch_files: true
  no_hallucinated_sdks: true
  doctor_preflight_required: true
protocol:
  cli: "bun ~/.agents/skills/olt/scripts/harness.ts"
  zero_json: true
instructions: |
  # Full operational step-by-step runbook...
```

---

## 3. Parallel Execution Topology & Brent Work/Span Matrix

We structure the implementation using **Brent's Work/Span Theorem ($P = \lceil W / S \rceil = 4 \text{ Lanes}$)** with **100% Disjoint Write Scopes**:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                       PARALLEL EXECUTION TOPOLOGY MATRIX                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [ PHASE 1: CORE FOUNDATION & QUALITY GATE (Serial - Main Thread) ]         │
│  • Task 1.1: `scripts/validate-agent-manifests.ts` (AST Schema Validator)   │
│  • Task 1.2: `olt/scripts/src/authority/manifest-schema.ts` (Type Schema)   │
│  • Task 1.3: `olt/scripts/src/cli/commands/agent-brief.ts` (Prompt Compiler)│
│  • Task 1.4: `olt/scripts/src/cli/registry/agent.ts` (CLI Command Binding)  │
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
│  • Automated assertion: 100% of YAMLs pass schema, 0 missing invariants     │
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

## 4. Disjoint Write Scope Isolation Guarantee

| Lane | Assigned Disjoint Write Scope | Target Files |
| :--- | :--- | :--- |
| **Lane A (Supervisors)** | `olt/agents/{mind,orchestrator}.yaml` | `mind.yaml`, `orchestrator.yaml` |
| **Lane B (Coordinators)** | `olt/agents/{coordinator,meta-auditor,mind-auditor}.yaml` | `coordinator.yaml`, `meta-auditor.yaml`, `mind-auditor.yaml` |
| **Lane C (Workers)** | `olt/agents/{implementer,validator,completeness-critic}.yaml` | `implementer.yaml`, `validator.yaml`, `completeness-critic.yaml` |
| **Lane D (Planners)** | `olt/agents/{planner,plan-validator,independent-*}.yaml` | `planner.yaml`, `plan-validator.yaml`, `independent-planner.yaml`, `independent-planner-audit.yaml` |
| **Lane E (Cleanup)** | `olt/roles/`, `olt/scripts/src/core/paths.ts` | Path redirection and legacy role retirement |
| **Lane F (Tests)** | `tests/unit/authority/`, `tests/unit/cli/` | Unit test suite & automated test receipts |

---

## 5. Incision-by-Incision Quality Checklist

### Incision 1: Core Engine & Automated AST Validator
1. Implement `olt/scripts/src/authority/manifest-schema.ts` defining `UnifiedAgentManifest` interface with Zod / TypeScript schemas.
2. Implement `scripts/validate-agent-manifests.ts` CLI validator checking every YAML in `olt/agents/`.
3. Implement `olt/scripts/src/cli/commands/agent-brief.ts` producing 1-shot prompt briefings.
4. Register `agent:brief` and `agent:define` in `olt/scripts/src/cli/registry/agent.ts`.
5. Run `bun scripts/validate-agent-manifests.ts` (Pre-flight baseline).

### Incision 2: SSoT Manifest Consolidation (Lanes A, B, C, D)
1. **Lane A**: Merge `roles/mind.md` $\rightarrow$ `agents/mind.yaml`, `roles/orchestrator.md` $\rightarrow$ `agents/orchestrator.yaml`.
2. **Lane B**: Merge `roles/coordinator.md` $\rightarrow$ `agents/coordinator.yaml`, `roles/meta-auditor.md` $\rightarrow$ `agents/meta-auditor.yaml`, `roles/mind-auditor.md` $\rightarrow$ `agents/mind-auditor.yaml`.
3. **Lane C**: Merge `roles/implementer.md` $\rightarrow$ `agents/implementer.yaml`, `roles/validator*.md` $\rightarrow$ `agents/validator.yaml`, `roles/completeness-critic.md` $\rightarrow$ `agents/completeness-critic.yaml`.
4. **Lane D**: Merge `roles/planner.md` $\rightarrow$ `agents/planner.yaml`, `roles/plan-validator.md` $\rightarrow$ `agents/plan-validator.yaml`, `roles/independent-*.md` $\rightarrow$ `agents/independent-*.yaml`.
5. Run `bun scripts/validate-agent-manifests.ts` (All 12 agents MUST pass with Exit Code 0).

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

# Validation Continuous Pre-Planning Domain Cluster Master Plan

> **Tracking ID:** `fb-cluster-validation-8974e6e7`  
> **Status:** `PHASE 1 - EXHAUSTIVE ARCHITECTURAL SPECIFICATION & TASK BREAKDOWN`  
> **Target Subsystems:** `olt/scripts/src/validation/`, `tests/unit/validation/`  
> **Author:** Tier 0 Strategic Mind Supervisor & Infinite Product Owner  
> **Created:** 2026-08-29

---

## 1. Executive Summary & The Assembly Pipeline Vision

This Phase 1 blueprint coordinates the implementation of the VALIDATION domain cluster.
It addresses 1 backlog requirement(s) and 12 defect remediation(s) under the zero-idle asynchronous pre-planning pipeline.

```text
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                    VALIDATION DOMAIN ARCHITECTURAL ASSEMBLY MATRIX                             │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│  Cluster ID: cluster-validation-8974e6e7                                                 │
│  Planned At: 2026-08-29T15:05:58.831Z                                                    │
│  Backlog Count: 1                                                                        │
│  Defect Count:  12                                                                       │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Core Architectural Pillars & Design Specifications

1. **Zero TypeScript `any` & Zero Suppressions**: Strictly enforced across all domain components.
2. **Subdomain Git Staging Invariant (Reflog Safety)**: Execute `git add -A` upon task verification.
3. **5-Minute Straggler SLA**: Partition any work exceeding 300s into parallel subagents ($P = \lceil W/S \rceil$).
4. **Deterministic Traceability**: Every requirement and defect maps to verified unit and integration tests.

---

## 3. Work Breakdown & Disjoint Task Specifications

### Task 1.1: Feature: Enforce Singleton Skill Auditor Fleet Constraint Across All Orchestrators

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Backlog Ref:** `fb-enforce-singleton-skill-auditor-fleet-constraint`
- **Write Scope:** `olt/scripts/src/validation/fb-enforce-singleton-skill-auditor-fleet-constraint.ts`
- **Read-Only Scope:** `olt/scripts/src/validation/`
- **Acceptance Criteria (Stub Must Fail):**
  - Implement: Owner-reported defect: Prevent spawning multiple redundant skill auditors. Enforce that exactly one Skill Auditor instance monitors the entire execution fleet (Tiers 1-3) across all concurrent orchestrators, preventing token burn, conflicting locks, and redundant audit cycles.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/validation/fb-enforce-singleton-skill-auditor-fleet-constraint.test.ts` (100% PASS).

### Task 1.2: Defect Remediation: Unresolved import '../../reporting/core/certify-command' in cli/registry/diagnostics.ts

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-cli-diagnostics-unresolved-certify-import` (Error Code: `UNRESOLVED_MODULE_IMPORT_IN_CLI`)
- **Write Scope:** `olt/scripts/src/validation/defect-cli-diagnostics-unresolved-certify-import.ts`
- **Read-Only Scope:** `olt/scripts/src/validation/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: olt/scripts/src/cli/registry/diagnostics.ts imports '../../reporting/core/certify-command', but certify-command was relocated to 'reporting/doctor/certify-command.ts'. This breaks harness live audit and CLI registry startup.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/validation/defect-cli-diagnostics-unresolved-certify-import.test.ts` (100% PASS).

### Task 1.3: Defect Remediation: Unterminated template literal TS1160 in scripts/testing/reporting/html/

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-html-reporter-escaped-backtick-unterminated-literal` (Error Code: `ESCAPED_TEMPLATE_LITERAL_SYNTAX_ERROR`)
- **Write Scope:** `olt/scripts/src/validation/defect-html-reporter-escaped-backtick-unterminated-literal.ts`
- **Read-Only Scope:** `olt/scripts/src/validation/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: scripts/testing/reporting/html/client-script.ts and styles.ts contain escaped backticks or unmatched multiline template delimiters causing TS1160 compilation errors.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/validation/defect-html-reporter-escaped-backtick-unterminated-literal.test.ts` (100% PASS).

### Task 1.4: Defect Remediation: Missing module doctor/rules/behavioral/coordinator-behavior.ts imported by reporting/behavioral-auditor.ts

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-reporting-behavioral-auditor-missing-coordinator-behavior` (Error Code: `UNRESOLVED_MODULE_IMPORT_IN_REPORTING`)
- **Write Scope:** `olt/scripts/src/validation/defect-reporting-behavioral-auditor-missing-coordinator-behavior.ts`
- **Read-Only Scope:** `olt/scripts/src/validation/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: olt/scripts/src/reporting/behavioral-auditor.ts imports './doctor/rules/behavioral/coordinator-behavior.ts', but this file does not exist in reporting/doctor/rules/behavioral/. This breaks harness live audit.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/validation/defect-reporting-behavioral-auditor-missing-coordinator-behavior.test.ts` (100% PASS).

### Task 1.5: Defect Remediation: Unterminated template literals (TS1160) and invalid characters in agents/ module files

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-agent-triad-and-naming-unterminated-template-literals` (Error Code: `ESCAPED_TEMPLATE_LITERAL_SYNTAX_ERROR`)
- **Write Scope:** `olt/scripts/src/validation/defect-agent-triad-and-naming-unterminated-template-literals.ts`
- **Read-Only Scope:** `olt/scripts/src/validation/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: agent-triad-loaders.ts, agent-triad-references.ts, agent-triad-validators.ts, and naming.ts contain syntax errors (TS1127, TS1136, TS1160 unterminated template literals) breaking type checking.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/validation/defect-agent-triad-and-naming-unterminated-template-literals.test.ts` (100% PASS).

### Task 1.6: Defect Remediation: Missing function 'resolveIsLargeText' in reporting/theme/evaluation.ts

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-doctor-reporting-theme-resolve-is-large-text-undefined` (Error Code: `UNDEFINED_SYMBOL_IN_THEME_EVALUATION`)
- **Write Scope:** `olt/scripts/src/validation/defect-doctor-reporting-theme-resolve-is-large-text-undefined.ts`
- **Read-Only Scope:** `olt/scripts/src/validation/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: Doctor checkDualChannelUi fails during theme contrast evaluation because resolveIsLargeText is referenced but not imported or declared in reporting/theme/evaluation.ts.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/validation/defect-doctor-reporting-theme-resolve-is-large-text-undefined.test.ts` (100% PASS).

### Task 1.7: Defect Remediation: Unresolved import './paths-and-io.ts' in authority/session/index.ts

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-authority-session-unresolved-paths-and-io` (Error Code: `UNRESOLVED_MODULE_IMPORT_IN_AUTHORITY`)
- **Write Scope:** `olt/scripts/src/validation/defect-authority-session-unresolved-paths-and-io.ts`
- **Read-Only Scope:** `olt/scripts/src/validation/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: olt/scripts/src/authority/session/index.ts imports from non-existent './paths-and-io.ts'. This breaks harness doctor and skill:audit:live startup.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/validation/defect-authority-session-unresolved-paths-and-io.test.ts` (100% PASS).

### Task 1.8: Defect Remediation: Missing module '../anti-mock-types.ts' imported across validation engine and rules

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-validation-unresolved-anti-mock-types` (Error Code: `UNRESOLVED_MODULE_IMPORT_IN_VALIDATION`)
- **Write Scope:** `olt/scripts/src/validation/defect-validation-unresolved-anti-mock-types.ts`
- **Read-Only Scope:** `olt/scripts/src/validation/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: validation/engine/mutation-generator.ts, mutation-runner.ts, validation/index.ts, mutation-gate/types.ts, and rules/mutation-visitors.ts fail to resolve '../anti-mock-types.ts' due to directory modularization.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/validation/defect-validation-unresolved-anti-mock-types.test.ts` (100% PASS).

### Task 1.9: Defect Remediation: Missing exported member 'MutationCandidate' in validation/engine/index.ts

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-validation-index-missing-mutation-candidate-export` (Error Code: `UNEXPORTED_MEMBER_IMPORT`)
- **Write Scope:** `olt/scripts/src/validation/defect-validation-index-missing-mutation-candidate-export.ts`
- **Read-Only Scope:** `olt/scripts/src/validation/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: olt/scripts/src/validation/index.ts imports MutationCandidate from './engine/index.ts', but engine/index.ts does not export MutationCandidate.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/validation/defect-validation-index-missing-mutation-candidate-export.test.ts` (100% PASS).

### Task 1.10: Defect Remediation: Doctor AST purity engine flags regex patterns in test files as violations

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-doctor-ast-purity-test-regex-false-positive` (Error Code: `AST_PURITY_REGEX_FALSE_POSITIVE`)
- **Write Scope:** `olt/scripts/src/validation/defect-doctor-ast-purity-test-regex-false-positive.ts`
- **Read-Only Scope:** `olt/scripts/src/validation/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: reporting/doctor/ast-purity-engine.ts scans file contents for literal strings like '<any>' and 'as any', triggering false positive AST purity violations when test assertions check for the absence of those tokens via RegExp.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/validation/defect-doctor-ast-purity-test-regex-false-positive.test.ts` (100% PASS).

### Task 1.11: Defect Remediation: ReferenceError analyzeRunForensics is not defined in skill-audit.ts

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-skill-audit-live-missing-analyze-run-forensics` (Error Code: `UNDEFINED_FUNCTION_REFERENCE`)
- **Write Scope:** `olt/scripts/src/validation/defect-skill-audit-live-missing-analyze-run-forensics.ts`
- **Read-Only Scope:** `olt/scripts/src/validation/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: skill:audit:live crashes with Fatal Internal Error: analyzeRunForensics is not defined.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/validation/defect-skill-audit-live-missing-analyze-run-forensics.test.ts` (100% PASS).

### Task 1.12: Defect Remediation: Automated mechanical file splitting created meaningless *-chunkN.ts and *_partN.ts files instead of domain-semantic modularization

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-mechanical-chunk-naming-anti-pattern` (Error Code: `MECHANICAL_CHUNK_NAMING_BLUNDER`)
- **Write Scope:** `olt/scripts/src/validation/defect-mechanical-chunk-naming-anti-pattern.ts`
- **Read-Only Scope:** `olt/scripts/src/validation/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: Subagents satisfied the line-count limit (<=300 lines) by mechanically splitting files into arbitrary numbered chunks (e.g. pushbacks-chunk1.ts, rotate-chunk2.ts, proposal-chunk5.ts, memory-chunk3.ts) rather than decomposing code by semantic responsibility (e.g. parser.ts, types.ts, validator.ts, rotator.ts, storage.ts). This causes severe developer confusion, makes source code look like temporary log files or data dumps, and harms LLM context efficiency. MANDATE: All files and directories must be given clear, meaningful, domain-semantic names reflecting their specific responsibility while strictly preserving the <=300 lines/file and <=10 files/dir limits.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/validation/defect-mechanical-chunk-naming-anti-pattern.test.ts` (100% PASS).

### Task 1.13: Defect Remediation: Monolithic multi-subsystem bundling in docs/planning/documentation-orchestrator-engine/PLAN.md

- **Owner / Tier:** Tier 3 Implementer + Independent Validator
- **Defect Ref:** `defect-plan-granularity-monolithic-docs-orchestrator` (Error Code: `MONOLITHIC_PLAN_DEFECT`)
- **Write Scope:** `olt/scripts/src/validation/defect-plan-granularity-monolithic-docs-orchestrator.ts`
- **Read-Only Scope:** `olt/scripts/src/validation/`
- **Acceptance Criteria (Stub Must Fail):**
  - Remediate: Plan "Dedicated Documentation Orchestrator Engine" bundles 7 orthogonal subsystems (Agent manifest & role configs, Policy generator, AST doc extraction, Continuous sync, Socratic validator, Chapter dispatcher, Docs CLI & RBAC) into a single monolithic plan. Requires decomposition into atomic sub-plans.
  - Zero TypeScript `any`, zero compiler suppressions.
  - Command: `bun test tests/unit/validation/defect-plan-granularity-monolithic-docs-orchestrator.test.ts` (100% PASS).

---

## 4. Sequential Execution Order & Critical Path

```text
Execution Order: [Task 1.1] ──► [Verification] ──► [Git Staging: git add -A] ──► [Landing]
```

---

## 5. Exhaustive Traceability Matrix

| Defect / Backlog ID                                                | Resolved By Task | Verification Test File                                                                           |
| :----------------------------------------------------------------- | :--------------- | :----------------------------------------------------------------------------------------------- |
| `fb-enforce-singleton-skill-auditor-fleet-constraint`              | Task 1.x         | `tests/unit/validation/fb-enforce-singleton-skill-auditor-fleet-constraint.test.ts`              |
| `defect-cli-diagnostics-unresolved-certify-import`                 | Task 1.x         | `tests/unit/validation/defect-cli-diagnostics-unresolved-certify-import.test.ts`                 |
| `defect-html-reporter-escaped-backtick-unterminated-literal`       | Task 1.x         | `tests/unit/validation/defect-html-reporter-escaped-backtick-unterminated-literal.test.ts`       |
| `defect-reporting-behavioral-auditor-missing-coordinator-behavior` | Task 1.x         | `tests/unit/validation/defect-reporting-behavioral-auditor-missing-coordinator-behavior.test.ts` |
| `defect-agent-triad-and-naming-unterminated-template-literals`     | Task 1.x         | `tests/unit/validation/defect-agent-triad-and-naming-unterminated-template-literals.test.ts`     |
| `defect-doctor-reporting-theme-resolve-is-large-text-undefined`    | Task 1.x         | `tests/unit/validation/defect-doctor-reporting-theme-resolve-is-large-text-undefined.test.ts`    |
| `defect-authority-session-unresolved-paths-and-io`                 | Task 1.x         | `tests/unit/validation/defect-authority-session-unresolved-paths-and-io.test.ts`                 |
| `defect-validation-unresolved-anti-mock-types`                     | Task 1.x         | `tests/unit/validation/defect-validation-unresolved-anti-mock-types.test.ts`                     |
| `defect-validation-index-missing-mutation-candidate-export`        | Task 1.x         | `tests/unit/validation/defect-validation-index-missing-mutation-candidate-export.test.ts`        |
| `defect-doctor-ast-purity-test-regex-false-positive`               | Task 1.x         | `tests/unit/validation/defect-doctor-ast-purity-test-regex-false-positive.test.ts`               |
| `defect-skill-audit-live-missing-analyze-run-forensics`            | Task 1.x         | `tests/unit/validation/defect-skill-audit-live-missing-analyze-run-forensics.test.ts`            |
| `defect-mechanical-chunk-naming-anti-pattern`                      | Task 1.x         | `tests/unit/validation/defect-mechanical-chunk-naming-anti-pattern.test.ts`                      |
| `defect-plan-granularity-monolithic-docs-orchestrator`             | Task 1.x         | `tests/unit/validation/defect-plan-granularity-monolithic-docs-orchestrator.test.ts`             |

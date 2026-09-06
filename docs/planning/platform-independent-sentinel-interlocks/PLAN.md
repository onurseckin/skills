# Architecture Plan: Platform-Independent In-Harness Sentinel Interlocks & Cross-Tier Spawning Enforcement

## 1. Executive Summary & Core Architectural Problem

- **Tracking ID**: `track-sentinel-platform-independent`
- **Severity**: Critical
- **Problem Statement**:
  1. The sentinel system previously relied on out-of-band commands (`doctor:agent`, `sentinel:watch`, host hooks) rather than being embedded directly as unbypassable middleware in the harness command execution path.
  2. In Step 158, Mind bypassed Tier 1 Orchestrator and Tier 2 Coordinator to spawn Tier 3 Implementers directly. `mindProfile.evaluate` in `olt/scripts/src/sentinel/profiles/tier0/mind.ts` completely lacked `CROSS_TIER_SPAWNING` detection, allowing the 4-tier hierarchy to collapse undetected.
  3. `orchestratorProfile.evaluate` in `tier1/orchestrator.ts` similarly lacked `CROSS_TIER_SPAWNING` enforcement.

---

## 2. Architectural Axioms & Interlock Invariants

1. **Pure In-Harness Platform-Independent Sentinel Interlocks**:
   - Zero host configuration dependencies (no reliance on `.gemini/`, `.claude/`, etc.). Pure TypeScript running natively inside the OLT harness.
   - `executePreActionHook` embedded directly in `olt/scripts/src/cli/execute.ts` before command execution.
   - `executePostActionHook` embedded directly in `olt/scripts/src/cli/execute.ts` (or command completion) to audit modified files and verify AST purity / line budgets.

2. **Cross-Tier Spawning Detection**:
   - In `tier0/mind.ts`: Mind can ONLY spawn Tier 1 Orchestrators (and Tier 0 Auditors). If Mind registers or attempts to spawn Tier 2 or Tier 3 roles, emit immediate `CROSS_TIER_SPAWNING_VIOLATION` violation.
   - In `tier1/orchestrator.ts`: Orchestrators can ONLY delegate to Tier 2 Coordinators. If an Orchestrator attempts to register or spawn Tier 3 workers directly, emit immediate `CROSS_TIER_SPAWNING_VIOLATION` violation.

3. **Mechanical Enforcement in `agent:register` & Command Authority**:
   - In `command-authority-hierarchy.ts` and `command-authority-grants.ts`, any cross-tier violation triggers a fatal `ROLE_CONFINEMENT_VIOLATION` with exact actionable remediation.

---

## 3. Work Breakdown Structure (WBS) & Exact File Anchors

### Task 1: Sentinel Profile Hardening with Cross-Tier Spawning

- **Target File**: `olt/scripts/src/sentinel/profiles/tier0/mind.ts`
  - Add `CROSS_TIER_SPAWNING_VIOLATION` check: if context includes child registrations or target actions where parent is Mind and child role is not Orchestrator or Auditor, emit critical violation.
- **Target File**: `olt/scripts/src/sentinel/profiles/tier1/orchestrator.ts`
  - Add `CROSS_TIER_SPAWNING_VIOLATION` check: if context includes child role not equal to Coordinator, emit critical violation.

### Task 2: Pure In-Harness Pre-Action and Post-Action Interlock Middleware

- **Target File**: `olt/scripts/src/cli/execute.ts`
  - Before calling `spec.handler(...)`, invoke `executePreActionHook`:
    - For file-writing commands, verify file write privileges and write scope.
    - For shell execution commands, verify shell privileges.
    - If `executePreActionHook` returns `allowed: false`, throw `HarnessError("ROLE_CONFINEMENT_VIOLATION", ...)` or `HarnessError("PERMISSION_DENIED", ...)`.
  - After calling `spec.handler(...)`, if modified files are tracked, invoke `executePostActionHook` and enforce AST purity and line budgets.

### Task 3: Unit Test Suite & Regression Verification

- **Target File**: `tests/sentinel/platform-independent-interlocks.test.ts`
  - Verify `executePreActionHook` in `execute.ts` blocks prohibited shell execution or file mutations.
  - Verify `mindProfile` emits `CROSS_TIER_SPAWNING_VIOLATION` when Mind attempts to spawn Tier 3 Implementers.
  - Verify `orchestratorProfile` emits `CROSS_TIER_SPAWNING_VIOLATION` when Orchestrator attempts to spawn Tier 3 Implementers.

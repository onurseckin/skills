# Validation, Pushback Pipeline & Skill Configuration: Architecture & Plan

**Created**: 2026-08-14  
**Status**: Approved & Executing  
**Location**: `docs/planning/orchestrating-long-tasks-enhancements/03-validation-pushback-and-config-plan.md`

---

## 1. Overview & Objectives

This plan formalizes:
1. **Configurable Skill Settings (`harness.config.json`)**:
   - Dynamic configuration support for `max_repair_rounds` (updated default from 3 to **5**).
   - Configurable timeout bounds, default concurrency limits, and output quotas.
   - Search order: Local `.harness.config.json` / `harness.config.json` $\to$ Capsule config $\to$ Built-in defaults.
2. **Enhanced Validation & Feedback Pushback Engine**:
   - Automatic finding injection and targeted Markdown pushback briefs on rejection.
   - Dynamic repair loop bounding based on configured `max_repair_rounds`.
   - Escalation mechanics when repair rounds are exhausted.
3. **Full System Stability & Zero-JSON Enforcement**:
   - 100% test coverage for config loader and validation flows.
   - Adherence to file-size limits ($\le 200$ prod lines, $\le 250$ test lines).

---

## 2. Configuration System Architecture (`src/config/`)

### 2.1 Configuration Schema
```typescript
export interface HarnessConfig {
  max_repair_rounds: number;      // Default: 5
  max_output_bytes: number;       // Default: 10 * 1024 * 1024 (10MB)
  default_lease_seconds: number;  // Default: 1800 (30m)
  default_max_parallel: number;   // Default: 4
  strict_validation: boolean;     // Default: true
}
```

### 2.2 Default Values
```typescript
export const DEFAULT_CONFIG: HarnessConfig = {
  max_repair_rounds: 5,
  max_output_bytes: 10 * 1024 * 1024,
  default_lease_seconds: 1800,
  default_max_parallel: 4,
  strict_validation: true,
};
```

### 2.3 Discovery & Loading Priority
1. `harness.config.json` or `.harness.config.json` in repository root.
2. `config.json` inside `.capsules/<run_id>/`.
3. Fallback to `DEFAULT_CONFIG`.

---

## 3. Implementation Phasing & Tasks

### Task 1: Config Loader Module (`src/config/harness-config.ts`)
- Implement `loadHarnessConfig(repoRoot?: string, capsuleRoot?: string): HarnessConfig`.
- Validate schema, clamp integer bounds, and provide safe defaults.

### Task 2: Config Integration in Workflow & Critic
- Update `src/workflow/review/record-review.ts` to use configured `max_repair_rounds` (default: 5).
- Update `src/workflow/completion/begin-completeness-critic.ts` to use configured `max_repair_rounds` (default: 5).
- Update CLI commands (`plan:init`, `task:claim`, `queue:next`) to respect configuration.

### Task 3: Unit Tests & Verification
- `tests/unit/config/harness-config.test.ts`: Test loading, defaults, invalid JSON recovery, and overrides.
- `tests/unit/workflow/repair-rounds-config.test.ts`: Verify 5-round default and custom round limits.
- Verify `bun test --timeout 30000 tests/unit` and `bun run typecheck`.

### Task 4: Documentation & Global Sync
- Update `orchestrating-long-tasks/SKILL.md` to document `harness.config.json`.
- Commit, push, and sync globally via `bun run skill:update`.

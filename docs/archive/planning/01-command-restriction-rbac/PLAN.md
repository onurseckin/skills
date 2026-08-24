# Plan 1: Hard-Coded RBAC & Command Restriction Enforcement

## 1. Context & Problem Statement

During previous execution runs, a Tier 2 Coordinator was observed executing unit test commands (`bun test`) directly against the repository. This is a critical role boundary violation according to our canonical architecture:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                           ROLE COMMAND AUTHORITY MATRIX                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [ Tier 0: Mind ]                                                           │
│    • Allowed: mind:*, authority:*, memory:*, dag                       │
│    • Forbidden: ANY code edits, ANY unit test executions, ANY worker spawns │
│                                                                             │
│  [ Tier 1: Orchestrator ]                                                   │
│    • Allowed: orchestrator:*, queue:wave, plan:*, report:*                  │
│    • Forbidden: Direct test execution, direct file edits, Tier 3 worker spawning │
│                                                                             │
│  [ Tier 2: Coordinator ]                                                    │
│    • Allowed: task:*, agent:*, run:*, git commits/pushes/syncs              │
│    • Forbidden: Code edits, unit test execution, claiming tasks directly   │
│                                                                             │
│  [ Tier 3: Implementer ]                                                    │
│    • Allowed: Code edits within leased write_scope, file-scoped unit tests  │
│    • Forbidden: Broad repo-wide test suites (bun test, vitest), git push    │
│                                                                             │
│  [ Tier 3: Cognitive Validator ]                                            │
│    • Allowed: Socratic code analysis, structured critiques, task:review     │
│    • Forbidden: ANY command execution (0 run:exec, 0 bash, 0 tests)         │
│                                                                             │
│  [ Tier 3: Mechanic Validator ]                                             │
│    • Allowed: Typechecks (tsc --noEmit), AST static invariant audits (task:check)│
│    • Forbidden: Application code edits, whole-repo test suites              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**The Vulnerability:** If agents bypass the shielded shell or if the RBAC engine (`rbac-engine.ts`) does not mechanically intercept direct CLI / bash commands, supervisory roles can leak into implementation work.

---

## 2. Objectives & Acceptance Criteria

1. **Mechanical Interlock for Cognitive Validators (`can_execute_shell: false`):**
   - Cognitive Validators must have 0 command privileges. Any attempt to invoke `run:exec` or `shell` by a Cognitive Validator must immediately throw `[ROLE_BOUNDARY_VIOLATION] Cognitive Validators are locked to 0 command execution`.
2. **Strict Test Execution Ban on Coordinators & Orchestrators:**
   - Any execution of `bun test`, `vitest`, `npm test`, `pytest`, `cargo test`, or test file execution (`*.test.ts`, `*.spec.ts`) by a `coordinator`, `orchestrator`, or `mind` grant must be blocked before child process spawn.
3. **Whole-Suite Test Ban on Implementers:**
   - Implementers are restricted strictly to targeted, file-scoped test executions (e.g. `bun test tests/unit/parser.test.ts`). Whole-suite broad invocations (`^bun test$`, `^npm test$`) must be rejected.
4. **Tamper-Evident Command Execution Receipts (`.olt/scratch/evidence/`):**
   - Every authorized command must emit a signed execution receipt with SHA-256 digest recorded to `.olt/telemetry.jsonl`.

---

## 3. Detailed Technical Architecture

### 3.1 Shielded Shell Policy Compiler (`olt/scripts/src/policy/rbac-engine.ts`)

```typescript
export interface CommandAuthRule {
  readonly role: AgentRole;
  readonly allowedCommandPatterns: readonly RegExp[];
  readonly deniedCommandPatterns: readonly RegExp[];
  readonly maxBufferBytes: number;
}

export const STRICT_RBAC_RULES: Record<AgentRole, CommandAuthRule> = {
  mind: {
    role: "mind",
    allowedCommandPatterns: [/^bun harness\.ts (mind|memory|authority|dag):/],
    deniedCommandPatterns: [/test/i, /git\s+(commit|push)/i, /rm\s+-rf/i],
    maxBufferBytes: 1024 * 64,
  },
  orchestrator: {
    role: "orchestrator",
    allowedCommandPatterns: [/^bun harness\.ts (orchestrator|plan|queue|report|dag):/],
    deniedCommandPatterns: [/test/i, /git\s+(commit|push)/i],
    maxBufferBytes: 1024 * 64,
  },
  coordinator: {
    role: "coordinator",
    allowedCommandPatterns: [
      /^bun harness\.ts (task|agent|run|branch|critic|dag|report):/,
      /^git\s+(status|diff|add|commit|push)/,
      /^bun scripts\/sync-global\.ts$/,
    ],
    deniedCommandPatterns: [/bun\s+test/i, /vitest/i, /npm\s+test/i],
    maxBufferBytes: 1024 * 128,
  },
  validator: {
    role: "validator",
    allowedCommandPatterns: [], // HARD-LOCK: 0 commands allowed
    deniedCommandPatterns: [/.*/],
    maxBufferBytes: 0,
  },
  implementer: {
    role: "implementer",
    allowedCommandPatterns: [
      /^bun test\s+\S+\.(test|spec)\.ts$/, // Targeted test files ONLY
      /^bun harness\.ts (task:check|scope:expand)/,
    ],
    deniedCommandPatterns: [
      /^bun\s+test\s*$/, // No broad suite runs
      /^npm\s+test\s*$/,
      /^git\s+(commit|push|checkout)/i,
    ],
    maxBufferBytes: 1024 * 512,
  },
};
```

### 3.2 Enforcement Flow

```text
[ Subagent Command Request ]
            │
            ▼
[ RBAC Policy Check: verifyCommandAuthorization(actor, argv) ]
            │
    ┌───────┴───────┐
    ▼               ▼
 [ DENIED ]     [ ALLOWED ]
    │               │
    ▼               ▼
 Throw HarnessError Spawn Child Process
 (ROLE_BOUNDARY)    │
                    ▼
            Record Receipt to .olt/scratch/evidence/<sha>.json
            Append Log to .olt/telemetry.jsonl
```

---

## 4. Implementation Steps

1. **Step 1:** Audit `verifyCommandAuthorization` in `olt/scripts/src/policy/rbac-engine.ts` against the `STRICT_RBAC_RULES` matrix.
2. **Step 2:** Wrap all command execution entry points (`shell.ts`, `run-ops.ts`, `harness.ts shell`) to strictly enforce the rule before process spawning.
3. **Step 3:** Add negative unit tests in `tests/unit/policy/rbac-engine.test.ts` verifying that:
   - Coordinator running `bun test` throws `ROLE_BOUNDARY_VIOLATION`.
   - Validator running any command throws `ROLE_BOUNDARY_VIOLATION`.
   - Implementer running whole-suite `bun test` throws `POLICY_VIOLATION`.
   - Implementer running `bun test tests/unit/my-target.test.ts` succeeds and records receipt.

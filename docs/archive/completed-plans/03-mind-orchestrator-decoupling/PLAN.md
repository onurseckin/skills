# Plan 3: Mind State Decoupling from Orchestrator Lifecycle

## 1. Context & Problem Statement

When the user launched two Tier 1 Orchestrator runs to work on feature tasks, a `mind/` state directory and Mind memory records were unexpectedly generated in memory and on disk.

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                       TIER 0 MIND vs TIER 1 ORCHESTRATOR                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [ Tier 0: Infinite Mind Supervisor (Mode A & Mode B) ]                     │
│    • Invocations: `mind:init`, `mind:pulse`, `mind:observe`, `mind:admit`   │
│    • Governance Scope: Autonomous candidate discovery, backlog PO mode     │
│    • Storage: `.olt/policy.json`, `.olt/backlog.jsonl`, `.olt/memory.json`   │
│                                                                             │
│  [ Tier 1: Standalone Orchestrator (Long-Task Capsule Mode) ]               │
│    • Invocations: `orchestrate`, `plan:init`, `plan:compile`, `queue:wave`  │
│    • Execution Scope: Bounded task graph compilation, wave lane dispatch    │
│    • Storage: Strictly confined to `.olt/capsules/<run-id>/`                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**The Flaw:** Several helper functions in `store/capsule.ts`, `plan.ts`, and `diagnostics.ts` were eagerly bootstrapping Mind memory records, reading `CHARTER.md`, or writing default `mind` state keys into standalone feature capsule manifests.

---

## 2. Objectives & Acceptance Criteria

1. **Zero Unsolicited Mind Initialization:**
   - Initializing a feature run via `orchestrate`, `plan:init`, or `initRun()` must **never** create `mind` keys in `state.json`, never touch `olt/memory.json`, and never require `CHARTER.md` presence unless `mind:init` was explicitly requested.
2. **Explicit Mode Separation:**
   - **Mode 1: Feature Capsule Run (`run-<name>`)**: Isolated under `.olt/capsules/run-<name>/`. Contains only requirements, DAG graph, tasks, gates, leases, and completion verdicts.
   - **Mode 2: Autonomous Mind Run (`mind-gen-<N>`)**: Explicitly initialized via `bun harness.ts mind:init`. Contains charter hash, candidate pool, admission gates, and generational memory.
3. **Clean Teardown & Scratch Boundaries:**
   - Standalone orchestrators must not scan global mind queues or trigger candidate auto-admissions unless running under the `mind` actor grant.

---

## 3. Detailed Technical Architecture

### 3.1 Capsule State Partitioning (`olt/scripts/src/store/capsule.ts`)

```typescript
export type CapsuleMode = "feature" | "mind";

export function initRun(
  repoRoot: string,
  runId: string,
  promptBytes: Uint8Array,
  captureMode: "file" | "stdin" | "synthetic" = "file",
  isSourceVerified = false,
  mode: CapsuleMode = "feature", // Default to isolated feature mode
): string {
  const capsulesDir = resolveCapsulesDir(repoRoot);
  const runRoot = join(capsulesDir, runId);

  mkdirSync(runRoot, { recursive: true });

  // Write immutable prompt
  writeFileSync(join(runRoot, "prompt.md"), promptBytes);

  // Write minimal manifest
  const manifest: RunManifest = {
    schema: "harness.run-manifest",
    version: 3,
    run_id: runId,
    mode,
    created_at: new Date().toISOString(),
    capture_mode: captureMode,
    source_verified: isSourceVerified,
    prompt_sha256: sha256Bytes(promptBytes),
  };
  writeFileSync(join(runRoot, "manifest.json"), JSON.stringify(manifest, null, 2));

  // Initialize clean state - Mind properties are omitted in feature mode
  const state: RunState = {
    schema: "harness.run-state",
    version: 3,
    run_id: runId,
    revision: 1,
    status: "initialized",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    tasks: {},
    gates: {},
    agents: [],
    ...(mode === "mind" ? { mind: { generation: 1, candidates: [] } } : {}),
  };
  writeFileSync(join(runRoot, "state.json"), JSON.stringify(state, null, 2));

  return runRoot;
}
```

### 3.2 Command Guarding (`olt/scripts/src/mind/smart-task-manager.ts`)

```typescript
export function assertMindModeAllowed(runRoot: string, commandName: string): void {
  const manifest = loadRunManifest(runRoot);
  if (manifest.mode !== "mind") {
    throw new HarnessError(
      "INVALID_STATE",
      `command '${commandName}' is exclusive to Tier 0 Mind capsules. Current capsule '${manifest.run_id}' is running in feature mode.`,
    );
  }
}
```

---

## 4. Implementation Steps

1. **Step 1:** Add explicit `mode: "feature" | "mind"` discriminator to `RunManifest` and `initRun()`.
2. **Step 2:** Ensure feature capsule initialization (`plan.ts`, `orchestrateCommand`) defaults strictly to `"feature"` mode with 0 Mind state pollution.
3. **Step 3:** Restrict Mind-exclusive commands (`mind:*`, `memory:*`) from running against `"feature"` capsules via `assertMindModeAllowed`.
4. **Step 4:** Add unit tests in `tests/unit/store/capsule-mode.test.ts` verifying complete isolation between Feature Capsules and Mind Governance Capsules.

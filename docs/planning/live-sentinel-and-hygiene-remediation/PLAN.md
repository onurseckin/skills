# Master Architectural Plan: Live Registered Sentinel Strategy Monitors, Potemkin Defect-CLI Purge & Root Directory Hygiene

**Plan ID**: `plan-live-sentinel-and-hygiene-remediation`  
**Target Repository**: `@onurseckin/skills`  
**Execution Worktree**: `.olt/worktrees/track-sentinel-hygiene`  
**Target Branch**: `track/track-sentinel-hygiene`  
**Supervising Orchestrator**: `orchestrator_sentinel_hygiene`

---

## Executive Summary & Problem Formulation

Recent forensic investigations revealed four critical architectural flaws in the OLT skill system:

1. **Potemkin "Defect-CLI" Blunder**: Over 100 source files in `olt/scripts/src/` (`core/`, `engine/`, `mind/`, `reporting/`, `validation/`) and 326 test files were synthetically created with defect ID filenames (e.g. `defect-cli-1788679500002-auditorblind.ts`) containing dummy stubs returning `{ remediated: true }`. They pollute the directory fanout budget, mask real underlying bugs, and constitute pure dead code.
2. **Directory Resolution Bleed (`olt` vs `.olt`)**: Several engine modules hardcode `join(repoRoot, "olt", ...)` instead of `join(repoRoot, ".olt", ...)`, causing OLT to look for or erroneously create an unhidden `olt/` directory in external/consumer repositories.
3. **Passive / Blind Sentinel Architecture**: The "Live Sentinel" system was implemented as passive command-wrapped hooks inside `cli/execute.ts` (`executePreActionHook`), executing _only_ when an agent explicitly routes through `harness.ts <command>`. When subagents invoke host tools (`run_command("cat > file")`), Sentinel never executes. Furthermore, `orchestratorProfile` had `can_execute_shell: true`, and `context.modified_files` was never passed during watch loops.
4. **Host Transcript Blindness in Supervisory Audits**: `SkillAuditorEngine` in `skill-auditor.ts` and `checkRoleBoundaryInterlock` in `role-boundary-engine.ts` inspect only `events.jsonl`, which does not record native host tool calls, leaving host transcripts (`transcript.jsonl`) uninspected.

This plan details the full end-to-end remediation to be executed in an isolated worktree (`track-sentinel-hygiene`) by a dedicated Tier 1 Orchestrator (`orchestrator_sentinel_hygiene`).

### Registered Canonical Defects

- `doctor-orchestrator-role-boundary-violation-fd3e726f1752`: Tier 1 Orchestrator bypassed subagent hierarchy and directly executed shell commands, ran test suites, and authored code directly using host `run_command` instead of delegating to Tier 2 Coordinator and Tier 3 Implementers.
- `doctor-skill-auditor-transcript-blindness-and-oversight-failure-9513c5bdd75a`: Skill Auditor failed to detect active orchestrators executing out of role for an extended period due to scanning only capsule `events.jsonl` and git diffs, remaining completely blind to host-level conversation transcripts (`transcript.jsonl`).

---

## 1. Workstream Architecture & Phase Breakdown

```
+----------------------------------------------------------------------------------------------------+
| ORCHESTRATOR: orchestrator_sentinel_hygiene (in worktree .olt/worktrees/track-sentinel-hygiene)   |
+----------------------------------------------------------------------------------------------------+
       |
       +---> Phase 1: Potemkin Defect-CLI Purge & Test Cleanup
       |     * Remove 103 fake `defect-cli-*.ts` files from `olt/scripts/src/`
       |     * Remove 326 fake `defect-cli-*.test.ts` files from `tests/`
       |     * Clean directory facades and update `defect-audit/command.ts` generator
       |
       +---> Phase 2: Root Directory Hygiene (.olt vs olt Boundary Enforcement)
       |     * Enforce resolveOltDir(repoRoot) -> `.olt` universally
       |     * Eliminate all hardcoded `join(repoRoot, "olt", ...)` across 7 core files
       |     * Add automated test guaranteeing 0 unhidden `olt/` creation in foreign repos
       |
       +---> Phase 3: True Live Registered Sentinel Strategy Monitors (Host-Independent)
       |     * Per-agent live Strategy Monitor spawned upon agent registration
       |     * Real-time transcript tailing (transcript.jsonl) & filesystem mutation watch
       |     * Instant interjection dispatch, strike recording & lease revocation
       |     * Automated lifecycle cleanup and process teardown on agent completion
       |
       +---> Phase 4: Supervisory Boundary Hardlocks & Audit Transparency
       |     * Update orchestrator profile: `can_execute_shell: false`
       |     * Expand `doctor`'s `CODE_EDIT_TOOLS` to flag supervisory `run_command` & shell scripts
       |     * Wire host transcript discovery into `SkillAuditorEngine` (`analyzeRunForensics`)
       |     * Enforce `enable_write_tools: false` on supervisory subagent dispatch definitions
       |
       +---> Phase 5: Two-Key Socratic Cognitive Validation & Clean Worktree Landing
             * Author >= 20 Socratic adversarial probes in `tests/sentinel/strategy-monitor.test.ts`
             * Verify all Lefthook hooks pass on merit (zero bypasses)
             * Land sequentially onto `main` via Tier 3 Publisher and push to `origin/main`
```

---

## 2. Detailed Technical Specifications

### Phase 1: Potemkin Defect-CLI Purge, Test Location Invariant & Generator Safety

- **Dedicated Test Location Invariant (`tests/` ONLY)**:
  - All unit, integration, and regression tests MUST strictly reside inside the dedicated top-level `tests/` directory (e.g. `tests/unit/`, `tests/sentinel/`, `tests/core/`).
  - ZERO test files (`*.test.ts`, `*.spec.ts`) are ever permitted to be placed, authored, or generated under `olt/` or `skills/olt/` or inside source directories.
  - Path resolvers and test generators must reject any test generation request targeting `olt/`.
- **Eradication of Potemkin Tautological Test Generation**:
  - In `olt/scripts/src/mind/defects/loop/regression-gen.ts`, eradicate fake tautological test templates (`const isResolved = true; expect(isResolved).toBe(true);`). Real regression tests must assert empirical conditions, or be authored manually by Tier 3 Implementers.
- **Target Files to Purge**:
  - Delete all 103 `olt/scripts/src/**/defect-cli-*.ts`.
  - Delete all 326 `tests/**/defect-cli-*.test.ts`.
- **Generator Hardening**:
  - In [`olt/scripts/src/cli/commands/defect-audit/command.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/cli/commands/defect-audit/command.ts), ensure `--generate-tests` can only output test suites to specified external test output paths (strictly bounded to `tests/`), and NEVER generates stub production source files inside `olt/scripts/src/`.
- **Facade Re-Export Cleanup**:
  - Audit `olt/scripts/src/validation/index.ts` and ensure clean named exports with zero references to deleted defect-cli files.

### Phase 2: Universal `.olt` vs `olt` Boundary

- **Core Principle**:
  - Only `@onurseckin/skills` contains `olt/` (holding the skill source).
  - External / consumer repositories MUST ONLY EVER contain `.olt/` (hidden dot-folder).
- **Remediation Sites**:
  - [`olt/scripts/src/core/shared/paths.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/core/shared/paths.ts): ensure `OLT_DIR_NAME = ".olt"` is universally respected. Remove fallback `join("olt", OLT_FILES.POLICY)`.
  - [`olt/scripts/src/reporting/doctor/agent-canonical-engine.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/reporting/doctor/agent-canonical-engine.ts): replace `join(repoRoot, "olt", "agents")` with `.olt/agents/` and global skill dir fallback.
  - [`olt/scripts/src/mind/lifecycle/mind-init-flow.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/mind/lifecycle/mind-init-flow.ts): change `join(workspaceRoot, "olt", "agents", "mind.yaml")` to `.olt/agents/mind.yaml` and global skill dir fallback.
  - [`olt/scripts/src/ui-validation/quarantine/parameters/workspace-policy.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/ui-validation/quarantine/parameters/workspace-policy.ts): change `join(repoRoot, "olt", "policy.json")` to `join(repoRoot, ".olt", "policy.json")`.
  - [`olt/scripts/src/reporting/split-channel-defect-router.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/reporting/split-channel-defect-router.ts): change `join(currentRepoRoot, "olt", "policy.json")` to `join(currentRepoRoot, ".olt", "policy.json")`.
  - [`olt/scripts/src/mind/memory/core/indexer.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/mind/memory/core/indexer.ts): change `join(repoRoot, "olt", "references")` to `join(repoRoot, ".olt", "references")`.

### Phase 3: True Live Registered Sentinel Strategy Monitors

- **Monitor Registration Lifecycle**:
  - Add `SentinelMonitorRegistry` in `olt/scripts/src/sentinel/monitor/registry.ts`.
  - When an agent is registered via `agent:register` or spawned by an orchestrator, instantiate a `LiveStrategyMonitor`:
    ```ts
    export interface LiveStrategyMonitor {
      readonly agentId: string;
      readonly role: AgentRole;
      readonly transcriptPath: string;
      readonly targetWorktree?: string;
      start(): void;
      stop(): void;
    }
    ```
- **Real-Time Transcript Tailing (Host-Independent)**:
  - The monitor tails the agent's host transcript (`transcript.jsonl`) using an active file stream / unbuffered reader.
  - Parsed tool calls are evaluated against the agent's role profile in real time:
    - If a supervisory role invokes `run_command`, `write_to_file`, or file mutations -> **INSTANT INTERJECTION**:
      1. Write strike record (`recordStrike(agentId)`).
      2. Dispatch emergency mailbox message to the agent (`msg:send --type EMERGENCY_HALT`).
      3. Set agent status in `state.json` to `quarantined`.
      4. Emit critical incident to `.olt/defects.jsonl` and notify supervisory Mind.
- **Active Filesystem Mutation Watching**:
  - The monitor sets up an `fs.watch` on the assigned worktree or runs diff checks.
  - Any write outside `task.write_scope` triggers immediate halt.
- **Automated Lifecycle Teardown**:
  - When an agent status transitions to `completed`, `failed`, or when the wave is torn down (`manage_subagents kill`), the monitor's interval / file watcher is cleanly closed (`stop()`) and de-registered from `.olt/sentinel-monitors.json`.

### Phase 4: Supervisory Boundary Hardlocks & Audit Transparency

- **Orchestrator Profile Hardlock**:
  - In [`olt/scripts/src/sentinel/profiles/tier1/orchestrator.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/sentinel/profiles/tier1/orchestrator.ts#L8):
    Change `can_execute_shell: true` to `can_execute_shell: false`. Tier 1 Orchestrators must never execute terminal commands.
- **Doctor Role Boundary Engine**:
  - In [`olt/scripts/src/reporting/doctor/role-boundary-engine.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/reporting/doctor/role-boundary-engine.ts#L20), expand forbidden supervisory tools:
    ```ts
    const SUPERVISOR_FORBIDDEN_TOOLS = new Set([
      "write_to_file",
      "replace_file_content",
      "edit_file",
      "apply_diff",
      "patch_file",
      "run_command",
      "execute_command",
      "shell",
      "exec",
    ]);
    ```
- **Skill Auditor Transcript Wiring**:
  - In [`olt/scripts/src/mind/auditing/cognitive/skill-auditor.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/mind/auditing/cognitive/skill-auditor.ts#L47-L75), implement `discoverActiveTranscripts(repoRoot)` to find all active agent transcript files under `~/.gemini/antigravity-cli/brain/*/.system_generated/logs/transcript.jsonl` and pass them into `analyzeRunForensics({ transcripts: activeTranscripts })`.
- **Supervisory Subagent Spawning Guard**:
  - Ensure all `define_subagent` and `invoke_subagent` templates for Tier 0 Mind, Tier 0 Mind Auditor, Tier 0 Skill Auditor, Tier 1 Orchestrator, and Tier 2 Coordinator pass `enable_write_tools: false` so the host model physically lacks write and command tools.

---

## 3. Two-Key Socratic Validation & Gate Criteria

1. **Unit & Integration Suite**:
   - `tests/sentinel/strategy-monitor.test.ts`: verify real-time detection of prohibited tool calls in transcripts, immediate interjection dispatch, and clean teardown on agent stop.
   - `tests/core/root-hygiene.test.ts`: verify that running against a foreign repo root never creates an unhidden `olt/` directory.
   - `tests/reporting/doctor/role-boundary-shell.test.ts`: verify that supervisory `run_command` triggers `ROLE_BOUNDARY_SUPERVISOR_CODE_EDIT` in Doctor.
2. **Repository Modularity & Hygiene**:
   - All files $\le 300$ physical lines.
   - All directories $\le 10$ files.
   - Zero TypeScript `any`, zero compiler suppressions.
   - Zero `defect-cli-*.ts` files remaining in `olt/scripts/src/` or `tests/`.
3. **Pre-Push Validation**:
   - Run `bun run typecheck`.
   - Verify all Lefthook hooks pass on merit (zero bypasses: no `LEFTHOOK=0`, no `--no-verify`).

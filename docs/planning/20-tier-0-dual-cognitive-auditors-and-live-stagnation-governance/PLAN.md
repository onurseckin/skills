# Plan 20: Tier 0 Dual Cognitive Auditors (`mind-auditor` & `skill-auditor`), Live Stagnation Governance & Cross-Repo Mothership Telemetry

> **Status**: Ready for Implementation  
> **Directory**: `docs/planning/20-tier-0-dual-cognitive-auditors-and-live-stagnation-governance/`  
> **Target Subsystems**: `olt/scripts/src/authority/`, `olt/scripts/src/mind/`, `olt/scripts/src/reporting/`, `olt/scripts/src/cli/`, `olt/agents/`, `scripts/sync-global.ts`  
> **Spec Reference**: `AGENTS.md` (Axioms 1, 6, 8, 12, 13, 14, 18, 19, 23, 27, 28, 30)

---

## 1. Executive Summary & First-Principles Vision

Plan 20 establishes the **Tier 0 Dual Out-of-Band Cognitive Auditors** (`mind-auditor` and `skill-auditor`) as autonomous, non-hierarchical companion observers that execute on periodic host schedules (3–5 minute crons), monitor Tier 0 Mind and active OLT skill execution without event dump noise, enforce non-idle creative task discovery (Mode A), inject verbatim role contracts directly from disk manifests (`VerbatimRoleInjector`) upon stagnation (>120s), maintain persistent inspection high-water mark cursors (`AuditorCursor`), and power a **Cross-Repository Mothership Telemetry Engine**.

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│             CROSS-REPOSITORY SKILL EVOLUTION & TELEMETRY TOPOLOGY            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [ Skills Source Repository (Mothership) ]                                 │
│    Path: /Users/onurseckinsenoglu/repos/skills                              │
│    Ledger: /Users/onurseckinsenoglu/repos/skills/.olt/defects.jsonl         │
│                                │                                            │
│                                ▼                                            │
│  [ Global Export & Sync (bun scripts/sync-global.ts) ]                      │
│    • Emits ~/.agents/skills/olt/skill-config.json:                          │
│      {                                                                      │
│        "home_repo_root": "/Users/onurseckinsenoglu/repos/skills",           │
│        "synced_at": "2026-08-24T...",                                       │
│        "version": "1.0.0"                                                   │
│      }                                                                      │
│    • Symlinked across all IDEs and platforms (Antigravity, Cursor, Claude...)│
│                                │                                            │
│                                ▼                                            │
│  [ Foreign / Client Project Repository (e.g. /repos/my-app) ]              │
│    ┌──────────────────────────────────────────────────────────────────┐     │
│    │ • Target Project executes OLT long-task run                      │     │
│    │ • Mind deployed      ──► ALWAYS deploys mind-auditor sidecar     │     │
│    │ • Orchestrator deployed ──► ALWAYS deploys skill-auditor sidecar │     │
│    │                                                                  │     │
│    │  [ Split-Channel Defect & Telemetry Router ]                     │     │
│    │   ├── Project Bug (my-app code defect)                           │     │
│    │   │   └──► Logged to /repos/my-app/.olt/defects.jsonl            │     │
│    │   │                                                              │     │
│    │   └── Skill System Defect (harness bug, contract flaw, blunder)  │     │
│    │       └──► Routed upstream to SKILL MOTHERSHIP:                  │     │
│    │            /Users/onurseckinsenoglu/repos/skills/.olt/defects.jsonl │
│    └──────────────────────────────────────────────────────────────────┘     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Core Architectural Invariants & System Design

### 2.1 Mandatory Companion Deployment Lifecycle

- **Mind Invariant:** Starting the Mind system (`mind:init`, `mind:pulse`, or initial supervisory startup) **ALWAYS** deploys the `mind-auditor` companion observer in an out-of-band background lane (3–5m schedule).
- **Orchestrator Invariant:** Starting an Orchestrator run (`orchestrator:supervise`, `run:init`) **ALWAYS** deploys the `skill-auditor` companion observer in an out-of-band background lane.
- **Concurrent Co-Existence:** When Mind dispatches Orchestrators, **both auditors execute concurrently** without interfering with each other or the operational task execution hierarchy.

### 2.2 Global Skill Metadata & Mothership Discovery (`skill-config.json`)

- `scripts/sync-global.ts` writes a standalone configuration metadata file `~/.agents/skills/olt/skill-config.json` during global deployment.
- `paths.ts` provides `resolveSkillHomeRepo()`, which inspects:
  1. Process environment override `OLT_SKILL_HOME_REPO`.
  2. Local `skill-config.json` adjacent to the running harness script.
  3. Upward directory crawl if executed within the skills repository itself.
- `initRepoPolicy(repoRoot)` automatically records `skill_home_repo_root` into consumer `<repo-root>/.olt/policy.json`.

### 2.3 Split-Channel Upstream Defect Routing (`split-channel-defect-router.ts`)

- **Domain Classification:**
  - `domain: "project"` (e.g. application TypeScript compilation error, broken test in consumer app, business logic failure) $\rightarrow$ Persisted locally in `<consumer-repo>/.olt/defects.jsonl` for the active Implementer/Repairer to remediate in-lease.
  - `domain: "skill-framework"` (e.g. harness CLI parsing crash, tool hallucination, scheduler stall, prompt contract violation, root hygiene breach) $\rightarrow$ Persisted directly to the **Skills Mothership** at `{skill_home_repo_root}/.olt/defects.jsonl` (with graceful fallback to local `.olt/defects.jsonl` if the mothership is unreachable).

### 2.4 Manifest SSoT Realignment (Plan 21 Parity)

- All agent definitions reside exclusively in `olt/agents/<role>.yaml`.
- `VerbatimRoleInjector` reads directly and verbatim from `olt/agents/<role>.yaml` on disk (`readFileSync`), preserving exact instructions, permissions (`may` and `must_not`), charter pillars, and governance invariants without loss, summary, or paraphrasing.

### 2.5 Delta Forensics with High-Water Mark Cursors (`AuditorCursor`)

- `skill-auditor` maintains a stateful high-water mark cursor persisted at `<repo-root>/.olt/auditor-cursors.json` (`lastInspectedTimestamp`, `lastInspectedEventIndex`).
- Audits only incremental delta events ($seq > last\_inspected$) to achieve near-zero token overhead during continuous long-running operations.

---

## 3. System Architecture & Flow Topologies

### 3.1 Live Stagnation Detection & Verbatim Role Injection

```text
┌──────────────┐          ┌──────────────┐          ┌──────────────────────┐          ┌──────────────┐
│ Tier 0 Mind  │          │ mind-auditor │          │ VerbatimRoleInjector │          │Defects Ledger│
└──────┬───────┘          └──────┬───────┘          └──────────┬───────────┘          └──────┬───────┘
       │                         │                             │                             │
       │  (Idle for >120s)       │                             │                             │
       │ ----------------------->│ (Periodic 3m Schedule Tick) │                             │
       │                         │                             │                             │
       │                         │ 1. Evaluate liveness & idle │                             │
       │                         │    duration (>120s detected)│                             │
       │                         │                             │                             │
       │                         │ 2. Query Backlog Queue      │                             │
       │                         │    (Pending Count: 0)       │                             │
       │                         │                             │                             │
       │                         │ 3. Build Verbatim Prompt    │                             │
       │                         │ --------------------------->│                             │
       │                         │                             │ 4. Read olt/agents/mind.yaml│
       │                         │                             │    verbatim from disk       │
       │                         │                             │                             │
       │                         │                             │ 5. Synthesize Mode A        │
       │                         │                             │    Discovery Mandate        │
       │                         │                             │                             │
       │                         │ 6. Return Injection Prompt  │                             │
       │                         │ <---------------------------│                             │
       │                         │                             │                             │
       │                         │ 7. Log Stagnation Defect    │                             │
       │                         │ --------------------------------------------------------->│
       │                         │                             │                             │
       │ 8. Inject Wakeup Prompt │                             │                             │
       │ <-----------------------│                             │                             │
       │                         │                             │                             │
       │ 9. Execute Mode A Scans │                             │                             │
       │    (0 any, Charter,     │                             │                             │
       │     Blunders, Work/Span)│                             │                             │
       │                         │                             │                             │
```

### 3.2 Skill Quality Forensics & High-Water Mark Sequence

```text
┌────────────────┐          ┌───────────────┐          ┌──────────────────────┐          ┌───────────────────────────┐
│  Active Fleet  │          │ skill-auditor │          │ AuditorCursor Storage│          │ Split-Channel Router      │
└───────┬────────┘          └───────┬───────┘          └──────────┬───────────┘          └─────────────┬─────────────┘
        │                           │                             │                                    │
        │ (Emits events & actions)  │                             │                                    │
        │                           │ 1. Load Cursor State        │                                    │
        │                           │ --------------------------->│                                    │
        │                           │                             │                                    │
        │                           │ 2. Return Last Event Seq    │                                    │
        │                           │ <---------------------------│                                    │
        │                           │                             │                                    │
        │                           │ 3. Scan Delta Events Only   │                                    │
        │                           │    (seq > last_inspected)   │                                    │
        │                           │                             │                                    │
        │                           │ 4. Evaluate Cognitive       │                                    │
        │                           │    Contracts (0 any, scopes,│                                    │
        │                           │    exact briefings, P=W/S)  │                                    │
        │                           │                             │                                    │
        │                           │ 5. Save Advanced Cursor     │                                    │
        │                           │ --------------------------->│                                    │
        │                           │                             │                                    │
        │                           │ 6. Route Defect via Router  │                                    │
        │                           │ ---------------------------------------------------------------->│
        │                           │                             │                                    │ (Classify domain)
        │                           │                             │                                    ├── Project Bug -> Local .olt/defects.jsonl
        │                           │                             │                                    └── Skill Bug   -> Mothership .olt/defects.jsonl
```

---

## 4. Architectural Modules & Exact TypeScript AST Interfaces

### 4.1 `VerbatimRoleInjector` (`olt/scripts/src/authority/verbatim-role-injector.ts`)

```typescript
export interface StagnationTelemetry {
  readonly agentId: string;
  readonly conversationId?: string | undefined;
  readonly role: string;
  readonly idleDurationSeconds: number;
  readonly pendingBacklogCount: number;
  readonly pendingPlanCount: number;
  readonly unresolvedDefectCount: number;
  readonly lastActiveTimestamp?: string | undefined;
}

export class VerbatimRoleInjector {
  public static resolveManifestPath(repoRoot: string, role: string): string;
  public static loadVerbatimManifestContent(repoRoot: string, role: string): string;
  public static buildInjectionPrompt(
    repoRoot: string,
    role: string,
    telemetry: StagnationTelemetry,
  ): string;
}
```

### 4.2 `paths.ts` & Global Skill Config (`olt/scripts/src/core/shared/paths.ts`)

```typescript
export interface SkillGlobalConfig {
  readonly home_repo_root: string;
  readonly synced_at: string;
  readonly version: string;
}

export function resolveSkillGlobalConfigPath(): string;
export function loadSkillGlobalConfig(): SkillGlobalConfig | null;
export function resolveSkillHomeRepo(currentRepoRoot?: string): string;
```

### 4.3 `SplitChannelDefectRouter` (`olt/scripts/src/reporting/split-channel-defect-router.ts`)

```typescript
export type DefectDomain = "project" | "skill-framework";

export interface RouteDefectOptions {
  readonly currentRepoRoot: string;
  readonly domain: DefectDomain;
  readonly defect: {
    readonly id?: string | undefined;
    readonly error_code: string;
    readonly title: string;
    readonly description: string;
    readonly actor?: string | undefined;
    readonly timestamp?: string | undefined;
    readonly context?: Record<string, unknown> | undefined;
  };
}

export interface DefectRouteResult {
  readonly targetRepoRoot: string;
  readonly targetDefectsPath: string;
  readonly isMothership: boolean;
  readonly routed: boolean;
}

export class SplitChannelDefectRouter {
  public static routeDefect(options: RouteDefectOptions): DefectRouteResult;
}
```

### 4.4 `cognitive-auditors.ts` (`olt/scripts/src/mind/cognitive-auditors.ts`)

```typescript
import type { ForensicsIncident } from "../reporting/meta-auditor.ts";
import type { StagnationTelemetry } from "../authority/verbatim-role-injector.ts";

export interface AuditorCursor {
  readonly lastInspectedTimestamp: string;
  readonly lastInspectedEventIndex: number;
  readonly lastAuditTimestamp?: string | undefined;
}

export interface MindAuditLiveResult {
  readonly stagnant: boolean;
  readonly idleDurationSeconds: number;
  readonly telemetry: StagnationTelemetry;
  readonly injectionPrompt?: string | undefined;
  readonly defectCreated?: boolean | undefined;
  readonly cursor: AuditorCursor;
  readonly timestamp: string;
}

export interface SkillAuditLiveResult {
  readonly compliant: boolean;
  readonly incidents: readonly ForensicsIncident[];
  readonly defectsLogged: number;
  readonly cursor: AuditorCursor;
  readonly eventsAnalyzed: number;
  readonly timestamp: string;
}

export class MindAuditorEngine {
  public static auditMindPulse(
    repoRoot: string,
    options?: {
      cursor?: AuditorCursor | undefined;
      stagnationThresholdSeconds?: number | undefined;
      conversationId?: string | undefined;
    },
  ): MindAuditLiveResult;
}

export class SkillAuditorEngine {
  public static auditSkillCompliance(
    repoRoot: string,
    options?: {
      cursor?: AuditorCursor | undefined;
      capsuleRunRoot?: string | undefined;
      logDefects?: boolean | undefined;
    },
  ): SkillAuditLiveResult;
}

export class AuditorCursorStore {
  public static loadCursor(repoRoot: string, auditorType: "mind" | "skill"): AuditorCursor;
  public static saveCursor(
    repoRoot: string,
    auditorType: "mind" | "skill",
    cursor: AuditorCursor,
  ): void;
}
```

---

## 5. Work Breakdown & Implementation Tasks

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                          TASK DEPENDENCY & EXECUTION DAG                               │
├────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                        │
│   [ Task 1: VerbatimRoleInjector ]         [ Task 2: Global Config & Home Repo ]       │
│   (olt/scripts/src/authority/)             (olt/scripts/src/core/ & sync-global.ts)    │
│                  │                                            │                        │
│                  ▼                                            ▼                        │
│   [ Task 4: Cognitive Auditors Engine ] <── [ Task 3: Split-Channel Defect Router ]    │
│   (olt/scripts/src/mind/)                   (olt/scripts/src/reporting/)               │
│                  │                                                                     │
│                  ▼                                                                     │
│   [ Task 5: CLI Commands & Registry ]      [ Task 6: Mandatory Policy & Manifests ]    │
│   (olt/scripts/src/cli/)                   (olt/scripts/src/engine/ & olt/agents/)     │
│                  │                                            │                        │
│                  └────────────────────┬───────────────────────┘                        │
│                                       ▼                                                │
│                      [ Task 7: E2E Tests & Global Sync ]                               │
│                      (tests/integration/ & scripts/sync-global.ts)                     │
│                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

### Task 1: Implement `VerbatimRoleInjector` (`olt/scripts/src/authority/verbatim-role-injector.ts`)

**Files:**

- Create: `olt/scripts/src/authority/verbatim-role-injector.ts`
- Test: `tests/unit/authority/verbatim-role-injector.test.ts`

- [ ] **Step 1: Write unit tests for `VerbatimRoleInjector` testing YAML loading, Mode A/B prompt synthesis, and error handling**
- [ ] **Step 2: Implement `VerbatimRoleInjector` class**
- [ ] **Step 3: Verify tests pass (`bun test tests/unit/authority/verbatim-role-injector.test.ts`)**
- [ ] **Step 4: Commit (`feat(authority): implement VerbatimRoleInjector with manifest SSoT`)**

---

### Task 2: Global Skill Config (`skill-config.json`) & Home Repo Discovery

**Files:**

- Modify: `scripts/sync-global.ts`
- Modify: `olt/scripts/src/core/shared/paths.ts`
- Modify: `olt/scripts/src/policy/repo-policy.ts`
- Test: `tests/unit/contracts/shared-paths.test.ts`

- [ ] **Step 1: Update `scripts/sync-global.ts` to write `skill-config.json` with `home_repo_root`, `synced_at`, and `version`**
- [ ] **Step 2: Add `resolveSkillGlobalConfigPath`, `loadSkillGlobalConfig`, and `resolveSkillHomeRepo` to `paths.ts`**
- [ ] **Step 3: Update `initRepoPolicy` to record `skill_home_repo_root` into `.olt/policy.json`**
- [ ] **Step 4: Verify tests pass (`bun test tests/unit/contracts/shared-paths.test.ts`)**
- [ ] **Step 5: Commit (`feat(paths): implement global skill config and mothership home repo resolution`)**

---

### Task 3: Implement `SplitChannelDefectRouter` (`olt/scripts/src/reporting/split-channel-defect-router.ts`)

**Files:**

- Create: `olt/scripts/src/reporting/split-channel-defect-router.ts`
- Test: `tests/unit/reporting/split-channel-defect-router.test.ts`

- [ ] **Step 1: Write unit tests for `SplitChannelDefectRouter` verifying local routing for `domain: "project"` and mothership routing for `domain: "skill-framework"`**
- [ ] **Step 2: Implement `SplitChannelDefectRouter` class**
- [ ] **Step 3: Verify tests pass (`bun test tests/unit/reporting/split-channel-defect-router.test.ts`)**
- [ ] **Step 4: Commit (`feat(reporting): implement SplitChannelDefectRouter for mothership telemetry`)**

---

### Task 4: Implement `MindAuditorEngine` & `SkillAuditorEngine` with Cursor Persistence

**Files:**

- Create: `olt/scripts/src/mind/cognitive-auditors.ts`
- Test: `tests/unit/mind/cognitive-auditors.test.ts`

- [ ] **Step 1: Write unit tests for `AuditorCursorStore`, `MindAuditorEngine` (>120s stagnation detection), and `SkillAuditorEngine` (delta event inspection & defect routing)**
- [ ] **Step 2: Implement `AuditorCursorStore`, `MindAuditorEngine`, and `SkillAuditorEngine`**
- [ ] **Step 3: Verify tests pass (`bun test tests/unit/mind/cognitive-auditors.test.ts`)**
- [ ] **Step 4: Commit (`feat(mind): implement MindAuditorEngine and SkillAuditorEngine with cursor tracking`)**

---

### Task 5: Implement Dedicated CLI Commands (`mind:audit:live` & `skill:audit:live`)

**Files:**

- Create: `olt/scripts/src/cli/commands/mind-audit-live.ts`
- Create: `olt/scripts/src/cli/commands/skill-audit-live.ts`
- Modify: `olt/scripts/src/cli/registry/mind.ts`
- Modify: `olt/scripts/src/cli/registry/reporting.ts`
- Modify: `olt/scripts/src/cli/execute.ts`
- Test: `tests/unit/cli/cognitive-auditor-commands.test.ts`

- [ ] **Step 1: Write CLI command tests verifying <= 30-line Markdown briefs and JSON outputs**
- [ ] **Step 2: Implement `mind-audit-live.ts` and `skill-audit-live.ts`**
- [ ] **Step 3: Register commands in registry and execute middleware**
- [ ] **Step 4: Verify tests pass (`bun test tests/unit/cli/cognitive-auditor-commands.test.ts`)**
- [ ] **Step 5: Commit (`feat(cli): add mind:audit:live and skill:audit:live commands`)**

---

### Task 6: Mandatory Companion Deployment Policy & Manifests

**Files:**

- Modify: `olt/scripts/src/engine/scheduler/meta-auditor-policy.ts`
- Modify: `olt/agents/mind-auditor.yaml`
- Create: `olt/agents/skill-auditor.yaml`
- Test: `tests/unit/scheduler/meta-auditor-policy.test.ts`
- Test: `tests/unit/agents/cognitive-auditor-manifests.test.ts`

- [ ] **Step 1: Update `meta-auditor-policy.ts` to require companion deployment for Mind (`mind-auditor`) and Orchestrator (`skill-auditor`)**
- [ ] **Step 2: Align `olt/agents/mind-auditor.yaml` to Tier 0 out-of-band specifications**
- [ ] **Step 3: Author `olt/agents/skill-auditor.yaml` (Tier 0, `spawns: []`, zero code write tools)**
- [ ] **Step 4: Verify manifest validation (`bun scripts/validate-agent-manifests.ts`)**
- [ ] **Step 5: Commit (`feat(scheduler): enforce mandatory companion deployment for mind and skill auditors`)**

---

### Task 7: End-to-End Integration Tests & Global Skill Synchronization

**Files:**

- Create: `tests/integration/cognitive-auditors-e2e.test.ts`

- [ ] **Step 1: Write comprehensive integration test simulating cross-repo execution, stagnation wakeup, and split-channel mothership defect routing**
- [ ] **Step 2: Verify full test suite pass (`bun test`)**
- [ ] **Step 3: Verify TypeScript type safety (`bun run typecheck`)**
- [ ] **Step 4: Run global skill sync (`bun scripts/sync-global.ts`)**
- [ ] **Step 5: Commit (`test(integration): verify cognitive auditors e2e cross-repo telemetry`)**

---

## 6. Zero-Tolerance Quality Gates

1. **Type Safety:** `tsc -p tsconfig.json --noEmit` exits with 0 errors (0 TypeScript `any`, 0 `@ts-ignore`).
2. **Deterministic Manifest Validation:** `bun scripts/validate-agent-manifests.ts` exits with 22/22 PASS.
3. **CLI Token Efficiency:** All CLI outputs enforce <= 30 lines via `enforceLineLimit`.
4. **Hermetic Test Isolation:** Tests execute inside `scratchRoot()` without polluting the live `.olt/` repository ledgers.
5. **Global Skill Sync:** Pushed to `origin/main` and deployed to `~/.agents/skills/olt/`.

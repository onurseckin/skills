# Plan 20: Tier 0 Dual Cognitive Auditors (`mind-auditor` & `skill-auditor`) & Live Stagnation Governance

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the **Tier 0 Dual Out-of-Band Cognitive Auditors** (`mind-auditor` and `skill-auditor`) as standalone, non-hierarchical free-agent observers that execute on periodic host schedules (3–5 minute crons), monitor the Tier 0 Mind and active OLT skill execution without event dump noise, enforce non-idle creative task discovery (Mode A), inject verbatim role contracts directly from disk manifests (`VerbatimRoleInjector`) upon stagnation (>120s), maintain persistent inspection high-water mark cursors (`AuditorCursor`), persist validated defects directly into `<repo-root>/.olt/defects.jsonl`, and mandate dual companion deployment in `MetaAuditorPolicy`.

---

## 1. Executive Summary & Codebase State

### 1.1 Architectural SSoT Realignment (Plan 21 & Manifest Consolidation)

In accordance with **Plan 21** (`docs/archive/completed-plans/21-mind-directory-consolidation-and-single-source-of-truth/PLAN.md`), markdown role documents under `olt/roles/` were permanently retired and consolidated into unified YAML manifests located exclusively in **`olt/agents/<role>.yaml`**.

Consequently, the `VerbatimRoleInjector` **must not** attempt to load nonexistent `olt/roles/<role>.md` files. Instead, it reads directly and verbatim from `olt/agents/<role>.yaml` on disk (`readFileSync`), preserving exact instructions, permissions (`may` and `must_not`), charter pillars, and governance invariants without loss, summary, or paraphrasing.

### 1.2 Current Codebase Audit & Gap Analysis

| Component                    | Target Location                                           | Current Codebase State                                                             | Status          |
| :--------------------------- | :-------------------------------------------------------- | :--------------------------------------------------------------------------------- | :-------------- |
| **`VerbatimRoleInjector`**   | `olt/scripts/src/authority/verbatim-role-injector.ts`     | Missing on disk. No verbatim manifest read or Mode A prompt injection engine.      | ❌ Pending      |
| **`cognitive-auditors.ts`**  | `olt/scripts/src/mind/cognitive-auditors.ts`              | Missing on disk. No `AuditorCursor`, `MindAuditorEngine`, or `SkillAuditorEngine`. | ❌ Pending      |
| **`mind:audit:live` CLI**    | `olt/scripts/src/cli/commands/mind-audit-live.ts`         | Missing on disk (`mind-audit.ts` exists for static Q1–Q8 charter audits only).     | ❌ Pending      |
| **`skill:audit:live` CLI**   | `olt/scripts/src/cli/commands/skill-audit-live.ts`        | Missing on disk (`meta-audit.ts` exists for Tier 2 post-run forensics only).       | ❌ Pending      |
| **`MetaAuditorPolicy`**      | `olt/scripts/src/engine/scheduler/meta-auditor-policy.ts` | Exists with weak `OR` condition (`meta-auditor \|\| mind-auditor`).                | ⚠️ Needs Update |
| **`mind-auditor` Manifest**  | `olt/agents/mind-auditor.yaml`                            | Exists on disk (marked Tier 1). Needs alignment with Tier 0 out-of-band contract.  | ⚠️ Needs Update |
| **`skill-auditor` Manifest** | `olt/agents/skill-auditor.yaml`                           | Missing on disk.                                                                   | ❌ Pending      |
| **Auditor Cursor Storage**   | `<repo-root>/.olt/auditor-cursors.json`                   | Missing on disk.                                                                   | ❌ Pending      |

---

## 2. Architecture & First-Principles System Design

### 2.1 System Topology

```text
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                   TIER 0 OUT-OF-BAND DUAL COGNITIVE AUDITOR TOPOLOGY                     │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                         │
│  [ Tier 0 Free-Agent Observers (Periodic 3-5m Crons, 0 Spawns, 0 Code Edits, 0 Tests) ]  │
│                                                                                         │
│      ┌─────────────────────────────────┐       ┌─────────────────────────────────┐      │
│      │          mind-auditor           │       │          skill-auditor          │      │
│      │   Strategic Anti-Stagnation     │       │     Skill Quality Forensics     │      │
│      └────────────────┬────────────────┘       └────────────────┬────────────────┘      │
│                       │                                         │                       │
│          Idle Stagnation (>120s)                     Adherence Forensics (0 any,        │
│          Mode A Autonomous Discovery                 Exact Briefings, Disjoint Scopes)  │
│                       │                                         │                       │
│                       ▼                                         ▼                       │
│      ┌─────────────────────────────────┐       ┌─────────────────────────────────┐      │
│      │      VerbatimRoleInjector       │       │          AuditorCursor          │      │
│      │  (Verbatim disk read from       │       │  (Stateful High-Water Mark:     │      │
│      │   olt/agents/<role>.yaml        │       │   last_inspected_timestamp,     │      │
│      │   + Mode A Mandate Injection)   │       │   last_inspected_event_seq)     │      │
│      └────────────────┬────────────────┘       └────────────────┬────────────────┘      │
│                       │                                         │                       │
│                       └────────────────────┬────────────────────┘                       │
│                                            │                                            │
│                                            ▼                                            │
│                        ┌───────────────────────────────────────┐                        │
│                        │       Canonical Defect Ledger         │                        │
│                        │     <repo-root>/.olt/defects.jsonl    │                        │
│                        └───────────────────────────────────────┘                        │
│                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Live Stagnation Detection & Verbatim Role Injection Sequence

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

### 2.3 Skill Quality Forensics & High-Water Mark Sequence

```text
┌────────────────┐          ┌───────────────┐          ┌──────────────────────┐          ┌──────────────┐
│  Active Fleet  │          │ skill-auditor │          │ AuditorCursor Storage│          │Defects Ledger│
└───────┬────────┘          └───────┬───────┘          └──────────┬───────────┘          └──────┬───────┘
        │                           │                             │                             │
        │ (Emits events & actions)  │                             │                             │
        │                           │ 1. Load Cursor State        │                             │
        │                           │ --------------------------->│                             │
        │                           │                             │                             │
        │                           │ 2. Return Last Event Seq    │                             │
        │                           │ <---------------------------│                             │
        │                           │                             │                             │
        │                           │ 3. Scan Delta Events Only   │                             │
        │                           │    (seq > last_inspected)   │                             │
        │                           │                             │                             │
        │                           │ 4. Evaluate Cognitive       │                             │
        │                           │    Contracts (0 any, scopes,│                             │
        │                           │    exact briefings, P=W/S)  │                             │
        │                           │                             │                             │
        │                           │ 5. Save Advanced Cursor     │                             │
        │                           │ --------------------------->│                             │
        │                           │                             │                             │
        │                           │ 6. Log Structured Defect(s) │                             │
        │                           │    (if violations detected) │                             │
        │                           │ --------------------------------------------------------->│
        │                           │                             │                             │
```

---

## 3. Core Architectural Modules & Exact TypeScript AST Interfaces

### 3.1 `VerbatimRoleInjector` (`olt/scripts/src/authority/verbatim-role-injector.ts`)

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
  /**
   * Resolves the canonical manifest path for a given role (olt/agents/<role>.yaml).
   */
  public static resolveManifestPath(repoRoot: string, role: string): string;

  /**
   * Reads raw manifest contents directly from disk without parsing loss or paraphrasing.
   */
  public static loadVerbatimManifestContent(repoRoot: string, role: string): string;

  /**
   * Synthesizes an authoritative injection prompt containing live telemetry, the Mode A mandate
   * (if backlog is empty), and verbatim role instructions loaded directly from disk.
   */
  public static buildInjectionPrompt(
    repoRoot: string,
    role: string,
    telemetry: StagnationTelemetry,
  ): string;
}
```

### 3.2 `cognitive-auditors.ts` (`olt/scripts/src/mind/cognitive-auditors.ts`)

```typescript
import type { ForensicsIncident } from "./meta-auditor.ts";
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

### 3.3 CLI Commands (`mind:audit:live` & `skill:audit:live`)

- **`mind:audit:live`**: Performs a real-time health and liveness audit of Tier 0 Mind. Evaluates active heartbeat freshness, backlog item count, idle duration, builds the verbatim injection prompt if stagnant, and emits a structured Markdown brief ($\le 30$ lines) or JSON.
- **`skill:audit:live`**: Performs real-time forensics on active runs, inspecting only events after the high-water mark cursor. Checks for 0 `any` violations, unbriefed exploratory loops, overlapping write scopes, and artificial serialization, emitting an ASCII/Markdown brief ($\le 30$ lines) or JSON and persisting defects into `.olt/defects.jsonl`.

---

## 4. Atomic Disjoint Work Breakdown

```text
┌────────────────────────────────────────────────────────────────────────────────┐
│                       TASK DEPENDENCY & EXECUTION DAG                          │
├────────────────────────────────────────────────────────────────────────────────┤
│                                                                                │
│   [ Task 1: VerbatimRoleInjector ]       [ Task 5: Manifests & Contracts ]     │
│   (olt/scripts/src/authority/)           (olt/agents/)                         │
│                  │                                      │                      │
│                  ▼                                      │                      │
│   [ Task 2: Cognitive Auditors Engine ] <───────────────┘                      │
│   (olt/scripts/src/mind/)                                                      │
│                  │                                                             │
│                  ▼                                                             │
│   [ Task 3: CLI Commands & Registry ]    [ Task 4: MetaAuditorPolicy Update ]  │
│   (olt/scripts/src/cli/)                 (olt/scripts/src/engine/scheduler/)   │
│                  │                                      │                      │
│                  └──────────────────┬───────────────────┘                      │
│                                     ▼                                          │
│                      [ Task 6: E2E Tests & Global Sync ]                       │
│                      (tests/integration/ & scripts/sync-global.ts)             │
│                                                                                │
└────────────────────────────────────────────────────────────────────────────────┘
```

---

### Task 1: Implement `VerbatimRoleInjector` in `olt/scripts/src/authority/verbatim-role-injector.ts`

**Files:**

- Create: `olt/scripts/src/authority/verbatim-role-injector.ts`
- Test: `tests/unit/authority/verbatim-role-injector.test.ts`

- [ ] **Step 1: Write failing unit test for `VerbatimRoleInjector`**

  ```typescript
  import { describe, it, expect } from "bun:test";
  import {
    VerbatimRoleInjector,
    type StagnationTelemetry,
  } from "../../../olt/scripts/src/authority/verbatim-role-injector.ts";
  import { readFileSync, existsSync } from "node:fs";
  import { join } from "node:path";

  describe("VerbatimRoleInjector", () => {
    const repoRoot = process.cwd();

    it("resolves manifest path to olt/agents/<role>.yaml", () => {
      const manifestPath = VerbatimRoleInjector.resolveManifestPath(repoRoot, "mind");
      expect(manifestPath).toBe(join(repoRoot, "olt", "agents", "mind.yaml"));
      expect(existsSync(manifestPath)).toBe(true);
    });

    it("loads exact verbatim YAML manifest without alteration", () => {
      const expectedContent = readFileSync(join(repoRoot, "olt", "agents", "mind.yaml"), "utf-8");
      const loaded = VerbatimRoleInjector.loadVerbatimManifestContent(repoRoot, "mind");
      expect(loaded).toBe(expectedContent);
    });

    it("builds injection prompt with Mode A Creative Discovery Mandate when backlog is empty", () => {
      const telemetry: StagnationTelemetry = {
        agentId: "mind-supervisor-1",
        conversationId: "conv-98765",
        role: "mind",
        idleDurationSeconds: 180,
        pendingBacklogCount: 0,
        pendingPlanCount: 0,
        unresolvedDefectCount: 0,
      };

      const prompt = VerbatimRoleInjector.buildInjectionPrompt(repoRoot, "mind", telemetry);

      expect(prompt).toContain("[MIND-AUDITOR GOVERNANCE ALERT]: IDLE STAGNATION DETECTED (>120s)");
      expect(prompt).toContain("Agent ID: mind-supervisor-1");
      expect(prompt).toContain("Conversation ID: conv-98765");
      expect(prompt).toContain("Idle: 180s");
      expect(prompt).toContain("MODE A AUTONOMOUS SELF-EVOLUTION & TASK DISCOVERY ACTIVE");
      expect(prompt).toContain("Phase 1: Zero `any` & Type Suppression Audits");
      expect(prompt).toContain("Phase 2: Unfulfilled Charter Goals Audit");
      expect(prompt).toContain("Phase 3: Anti-Blunder Regression Verifications");
      expect(prompt).toContain("Phase 4: Work/Span DAG Optimization");
      expect(prompt).toContain('name: "mind"');
      expect(prompt).toContain('role: "mind"');
    });

    it("builds standard verbatim grounding prompt when backlog has pending items", () => {
      const telemetry: StagnationTelemetry = {
        agentId: "mind-supervisor-1",
        role: "mind",
        idleDurationSeconds: 150,
        pendingBacklogCount: 3,
        pendingPlanCount: 1,
        unresolvedDefectCount: 0,
      };

      const prompt = VerbatimRoleInjector.buildInjectionPrompt(repoRoot, "mind", telemetry);

      expect(prompt).toContain("Pending Backlog Count: 3");
      expect(prompt).toContain("MODE B EXTERNAL INTAKE / BACKLOG DRAINAGE ACTIVE");
      expect(prompt).not.toContain("The feedback queue is empty (0 pending items)");
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails (`bun test tests/unit/authority/verbatim-role-injector.test.ts`)**
- [ ] **Step 3: Implement `VerbatimRoleInjector` in `olt/scripts/src/authority/verbatim-role-injector.ts`**
  ```typescript
  import { existsSync, readFileSync } from "node:fs";
  import { join } from "node:path";
  import { HarnessError } from "../core/errors/harness-error.ts";

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
    public static resolveManifestPath(repoRoot: string, role: string): string {
      const candidatePaths = [
        join(repoRoot, "olt", "agents", `${role}.yaml`),
        join(repoRoot, "olt", "agents", `${role}.yml`),
        join(repoRoot, "agents", `${role}.yaml`),
      ];

      for (const p of candidatePaths) {
        if (existsSync(p)) {
          return p;
        }
      }

      return join(repoRoot, "olt", "agents", `${role}.yaml`);
    }

    public static loadVerbatimManifestContent(repoRoot: string, role: string): string {
      const manifestPath = this.resolveManifestPath(repoRoot, role);
      if (!existsSync(manifestPath)) {
        throw new HarnessError(
          "NOT_FOUND",
          `[VERBATIM_MANIFEST_NOT_FOUND] Cannot load verbatim manifest for role '${role}' at '${manifestPath}'.`,
        );
      }
      return readFileSync(manifestPath, "utf-8");
    }

    public static buildInjectionPrompt(
      repoRoot: string,
      role: string,
      telemetry: StagnationTelemetry,
    ): string {
      const manifestContent = this.loadVerbatimManifestContent(repoRoot, role);

      const header = [
        "================================================================================",
        "[MIND-AUDITOR GOVERNANCE ALERT]: IDLE STAGNATION DETECTED (>120s)",
        `Agent ID: ${telemetry.agentId}${telemetry.conversationId ? ` | Conversation ID: ${telemetry.conversationId}` : ""} | Role: ${telemetry.role.toUpperCase()}`,
        `Idle: ${telemetry.idleDurationSeconds}s | Pending Backlog: ${telemetry.pendingBacklogCount} | Active Plans: ${telemetry.pendingPlanCount} | Open Defects: ${telemetry.unresolvedDefectCount}`,
        "================================================================================",
      ].join("\n");

      let mandateSection = "";
      if (telemetry.pendingBacklogCount === 0) {
        mandateSection = [
          "MANDATE: MODE A AUTONOMOUS SELF-EVOLUTION & TASK DISCOVERY ACTIVE",
          "The feedback queue is empty (0 pending items). You are strictly forbidden from sitting idle,",
          "waiting for user prompts, or emitting passive standby messages. Execute the 4-Phase Discovery Protocol:",
          "  1. Phase 1: Zero `any` & Type Suppression Audits across all repository modules.",
          "  2. Phase 2: Unfulfilled Charter Goals Audit against goals G1, G2, G3.",
          "  3. Phase 3: Anti-Blunder Regression Verifications against historical defects.",
          "  4. Phase 4: Work/Span DAG Optimization (P = W / S concurrency analysis).",
          "================================================================================",
        ].join("\n");
      } else {
        mandateSection = [
          `MANDATE: MODE B EXTERNAL INTAKE / BACKLOG DRAINAGE ACTIVE (Pending Backlog Count: ${telemetry.pendingBacklogCount})`,
          "You have pending feedback items in `.olt/backlog.jsonl`. Proceed with 1:1 Isolated Task Dispatch,",
          "atomic admission-to-dispatch chaining, and subordinate Orchestrator supervision immediately.",
          "================================================================================",
        ].join("\n");
      }

      const footer = [
        `VERBATIM ROLE MANIFEST (Source: olt/agents/${role}.yaml):`,
        manifestContent,
        "================================================================================",
      ].join("\n");

      return `${header}\n${mandateSection}\n${footer}`;
    }
  }
  ```
- [ ] **Step 4: Run test to verify it passes (`bun test tests/unit/authority/verbatim-role-injector.test.ts`)**
- [ ] **Step 5: Commit**
  ```bash
  git add olt/scripts/src/authority/verbatim-role-injector.ts tests/unit/authority/verbatim-role-injector.test.ts
  git commit -m "feat(authority): implement VerbatimRoleInjector with manifest SSoT and Mode A mandate"
  ```

---

### Task 2: Implement `MindAuditorEngine` & `SkillAuditorEngine` with High-Water Mark Forensics

**Files:**

- Create: `olt/scripts/src/mind/cognitive-auditors.ts`
- Test: `tests/unit/mind/cognitive-auditors.test.ts`

- [ ] **Step 1: Write failing unit test for `cognitive-auditors.ts`**

  ```typescript
  import { describe, it, expect, beforeEach, afterEach } from "bun:test";
  import {
    MindAuditorEngine,
    SkillAuditorEngine,
    AuditorCursorStore,
    type AuditorCursor,
  } from "../../../olt/scripts/src/mind/cognitive-auditors.ts";
  import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
  import { join } from "node:path";
  import { scratchRoot } from "../../support/scratch-root.ts";

  describe("Cognitive Auditors Engine", () => {
    let testRepo: string;

    beforeEach(() => {
      testRepo = join(scratchRoot(), `cog-auditor-test-${Date.now()}`);
      mkdirSync(join(testRepo, "olt", "agents"), { recursive: true });
      mkdirSync(join(testRepo, ".olt"), { recursive: true });

      // Create dummy mind.yaml
      writeFileSync(
        join(testRepo, "olt", "agents", "mind.yaml"),
        'name: "mind"\nrole: "mind"\ntier: 0\ninstructions: "Mind Instructions"\n',
      );
    });

    afterEach(() => {
      if (existsSync(testRepo)) {
        rmSync(testRepo, { recursive: true, force: true });
      }
    });

    describe("AuditorCursorStore", () => {
      it("loads default zero cursor when file does not exist", () => {
        const cursor = AuditorCursorStore.loadCursor(testRepo, "skill");
        expect(cursor.lastInspectedEventIndex).toBe(0);
        expect(cursor.lastInspectedTimestamp).toBeDefined();
      });

      it("persists and retrieves updated cursor correctly under .olt/auditor-cursors.json", () => {
        const newCursor: AuditorCursor = {
          lastInspectedEventIndex: 42,
          lastInspectedTimestamp: "2026-08-24T12:00:00.000Z",
          lastAuditTimestamp: "2026-08-24T12:00:05.000Z",
        };
        AuditorCursorStore.saveCursor(testRepo, "skill", newCursor);

        const loaded = AuditorCursorStore.loadCursor(testRepo, "skill");
        expect(loaded.lastInspectedEventIndex).toBe(42);
        expect(loaded.lastInspectedTimestamp).toBe("2026-08-24T12:00:00.000Z");
      });
    });

    describe("MindAuditorEngine", () => {
      it("detects stagnation when idle duration exceeds threshold and emits injection prompt", () => {
        // Mock watchdog with stale timestamp (>120s ago)
        const staleTime = new Date(Date.now() - 180 * 1000).toISOString();
        writeFileSync(
          join(testRepo, ".olt", "watchdogs.json"),
          JSON.stringify({ lastPulseTimestamp: staleTime, activePulseId: "pulse-1" }),
        );

        const result = MindAuditorEngine.auditMindPulse(testRepo, {
          stagnationThresholdSeconds: 120,
        });

        expect(result.stagnant).toBe(true);
        expect(result.idleDurationSeconds).toBeGreaterThanOrEqual(180);
        expect(result.injectionPrompt).toBeDefined();
        expect(result.injectionPrompt).toContain("IDLE STAGNATION DETECTED");
      });

      it("reports non-stagnant when active pulse occurred recently (<120s)", () => {
        const freshTime = new Date(Date.now() - 20 * 1000).toISOString();
        writeFileSync(
          join(testRepo, ".olt", "watchdogs.json"),
          JSON.stringify({ lastPulseTimestamp: freshTime, activePulseId: "pulse-1" }),
        );

        const result = MindAuditorEngine.auditMindPulse(testRepo, {
          stagnationThresholdSeconds: 120,
        });

        expect(result.stagnant).toBe(false);
        expect(result.idleDurationSeconds).toBeLessThan(120);
        expect(result.injectionPrompt).toBeUndefined();
      });
    });

    describe("SkillAuditorEngine", () => {
      it("performs incremental delta inspection without reprocessing old events", () => {
        const capsuleDir = join(testRepo, ".olt", "capsules", "run-1");
        mkdirSync(capsuleDir, { recursive: true });

        // Event stream with 3 events
        const events = [
          JSON.stringify({
            seq: 1,
            type: "task:start",
            actor: "impl-1",
            timestamp: "2026-08-24T10:00:00Z",
          }),
          JSON.stringify({
            seq: 2,
            type: "tool:call",
            actor: "impl-1",
            tool: "edit_file",
            timestamp: "2026-08-24T10:01:00Z",
          }),
          JSON.stringify({
            seq: 3,
            type: "task:submit",
            actor: "impl-1",
            timestamp: "2026-08-24T10:02:00Z",
          }),
        ].join("\n");
        writeFileSync(join(capsuleDir, "events.jsonl"), events);

        // Initial audit
        const firstResult = SkillAuditorEngine.auditSkillCompliance(testRepo, {
          capsuleRunRoot: capsuleDir,
        });
        expect(firstResult.eventsAnalyzed).toBe(3);
        expect(firstResult.cursor.lastInspectedEventIndex).toBe(3);

        // Subsequent audit with no new events
        const secondResult = SkillAuditorEngine.auditSkillCompliance(testRepo, {
          capsuleRunRoot: capsuleDir,
          cursor: firstResult.cursor,
        });
        expect(secondResult.eventsAnalyzed).toBe(0);
      });
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails (`bun test tests/unit/mind/cognitive-auditors.test.ts`)**
- [ ] **Step 3: Implement `cognitive-auditors.ts` in `olt/scripts/src/mind/cognitive-auditors.ts`**
  - Implement `AuditorCursorStore` persisting to `<repo-root>/.olt/auditor-cursors.json`.
  - Implement `MindAuditorEngine.auditMindPulse` reading `.olt/watchdogs.json` / events, computing idle seconds, triggering `VerbatimRoleInjector`, and writing defects via `appendDefectEntry`.
  - Implement `SkillAuditorEngine.auditSkillCompliance` inspecting delta events, running cognitive forensics checks, advancing the high-water mark, and logging genuine defects.
- [ ] **Step 4: Run test to verify it passes (`bun test tests/unit/mind/cognitive-auditors.test.ts`)**
- [ ] **Step 5: Commit**
  ```bash
  git add olt/scripts/src/mind/cognitive-auditors.ts tests/unit/mind/cognitive-auditors.test.ts
  git commit -m "feat(mind): implement MindAuditorEngine and SkillAuditorEngine with cursor tracking"
  ```

---

### Task 3: Implement Dedicated CLI Commands `mind:audit:live` & `skill:audit:live`

**Files:**

- Create: `olt/scripts/src/cli/commands/mind-audit-live.ts`
- Create: `olt/scripts/src/cli/commands/skill-audit-live.ts`
- Modify: `olt/scripts/src/cli/registry/mind.ts`
- Modify: `olt/scripts/src/cli/registry/reporting.ts`
- Modify: `olt/scripts/src/cli/execute.ts`
- Test: `tests/unit/cli/cognitive-auditor-commands.test.ts`

- [ ] **Step 1: Write failing unit test for both CLI commands**

  ```typescript
  import { describe, it, expect, beforeEach, afterEach } from "bun:test";
  import { mindAuditLiveCommand } from "../../../olt/scripts/src/cli/commands/mind-audit-live.ts";
  import { skillAuditLiveCommand } from "../../../olt/scripts/src/cli/commands/skill-audit-live.ts";
  import { scratchRoot } from "../../support/scratch-root.ts";
  import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
  import { join } from "node:path";

  describe("Cognitive Auditor CLI Commands", () => {
    let testRepo: string;

    beforeEach(() => {
      testRepo = join(scratchRoot(), `cli-auditor-test-${Date.now()}`);
      mkdirSync(join(testRepo, "olt", "agents"), { recursive: true });
      mkdirSync(join(testRepo, ".olt"), { recursive: true });
      writeFileSync(
        join(testRepo, "olt", "agents", "mind.yaml"),
        'name: "mind"\nrole: "mind"\ntier: 0\ninstructions: "Mind Instructions"\n',
      );
    });

    afterEach(() => {
      if (existsSync(testRepo)) {
        rmSync(testRepo, { recursive: true, force: true });
      }
    });

    it("mind:audit:live returns concise markdown summary within 30 lines", async () => {
      const res = await mindAuditLiveCommand({
        flags: { repo: testRepo, "threshold-seconds": 120 },
      });

      expect(res.markdown).toBeDefined();
      const lines = res.markdown.trim().split("\n");
      expect(lines.length).toBeLessThanOrEqual(30);
      expect(res.markdown).toContain("Mind Live Stagnation Audit");
    });

    it("skill:audit:live returns structured table within 30 lines", async () => {
      const res = await skillAuditLiveCommand({
        flags: { repo: testRepo },
      });

      expect(res.markdown).toBeDefined();
      const lines = res.markdown.trim().split("\n");
      expect(lines.length).toBeLessThanOrEqual(30);
      expect(res.markdown).toContain("Skill Quality Forensics Audit");
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement `mind-audit-live.ts` and `skill-audit-live.ts` with strict line limiter formatting (`enforceLineLimit`)**
- [ ] **Step 4: Register commands in `olt/scripts/src/cli/registry/mind.ts` & `reporting.ts` and export from `execute.ts`**
- [ ] **Step 5: Run tests to verify they pass (`bun test tests/unit/cli/cognitive-auditor-commands.test.ts`)**
- [ ] **Step 6: Commit**
  ```bash
  git add olt/scripts/src/cli/commands/mind-audit-live.ts olt/scripts/src/cli/commands/skill-audit-live.ts olt/scripts/src/cli/registry/mind.ts olt/scripts/src/cli/registry/reporting.ts olt/scripts/src/cli/execute.ts tests/unit/cli/cognitive-auditor-commands.test.ts
  git commit -m "feat(cli): add mind:audit:live and skill:audit:live commands"
  ```

---

### Task 4: Enforce Mandatory Tier 0 Dual Auditor Deployment in `MetaAuditorPolicy`

**Files:**

- Modify: `olt/scripts/src/engine/scheduler/meta-auditor-policy.ts`
- Modify: `tests/unit/scheduler/meta-auditor-policy.test.ts`

- [ ] **Step 1: Write failing unit test in `tests/unit/scheduler/meta-auditor-policy.test.ts`**
  ```typescript
  it("mandates both mind-auditor AND skill-auditor (or meta-auditor) for long-task orchestration", () => {
    const onlyMind = [
      { id: "mind-1", role: "mind", status: "active" },
      { id: "mind-auditor-1", role: "mind-auditor", status: "active" },
    ];

    expect(() => {
      MetaAuditorPolicy.assertDualAuditorRequired("/Users/foo/repos/skills", onlyMind as any);
    }).toThrow(HarnessError);

    const dualActive = [
      { id: "mind-1", role: "mind", status: "active" },
      { id: "mind-auditor-1", role: "mind-auditor", status: "active" },
      { id: "skill-auditor-1", role: "skill-auditor", status: "active" },
    ];

    expect(() => {
      MetaAuditorPolicy.assertDualAuditorRequired("/Users/foo/repos/skills", dualActive as any);
    }).not.toThrow();
  });
  ```
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Update `MetaAuditorPolicy` to enforce dual companion observer verification (`hasMindAuditor && hasSkillAuditor`)**
- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**
  ```bash
  git add olt/scripts/src/engine/scheduler/meta-auditor-policy.ts tests/unit/scheduler/meta-auditor-policy.test.ts
  git commit -m "feat(scheduler): mandate Tier 0 Dual Cognitive Auditor companion deployment"
  ```

---

### Task 5: Agent Manifests (`skill-auditor.yaml` & `mind-auditor.yaml`)

**Files:**

- Create: `olt/agents/skill-auditor.yaml`
- Modify: `olt/agents/mind-auditor.yaml`
- Test: `tests/unit/agents/cognitive-auditor-manifests.test.ts`

- [ ] **Step 1: Author `olt/agents/skill-auditor.yaml`**

  ```yaml
  name: "skill-auditor"
  role: "skill-auditor"
  provider:
    - "antigravity"
    - "agy"
    - "claude"
    - "codex"
    - "cursor"
    - "generic"
  tier: 0
  domain: "forensics"
  tools:
    enable_subagent_tools: false
    enable_write_tools: false
  interface:
    display_name: "OLT Skill Quality Forensics Auditor"
    short_description: "Tier 0 out-of-band observer auditing cognitive contract compliance"
  permissions:
    may:
      - "Inspect execution deltas using stateful high-water mark cursors"
      - "Evaluate cognitive contract adherence: 0 any, exact-anchor briefings, disjoint write scopes, Work/Span concurrency"
      - "Log validated structural and behavioral defects directly into <repo-root>/.olt/defects.jsonl"
      - "Emit concise structured forensics telemetry briefs"
    must_not:
      - "0 code edits: never create, edit, or delete application source files"
      - "0 unit test runs: delegate all unit and integration test executions"
      - "0 subagent spawns: operate as a standalone out-of-band free agent (spawns: [])"
      - "0 lease claims: never claim task leases or issue review approvals"
    commands:
      - "skill:audit:live"
      - "meta-audit"
      - "stream:events"
      - "doctor"
      - "whoami"
    spawns: []
  invariants:
    - "SUPERVISOR_ZERO_CODE_EDITS"
    - "SUPERVISOR_ZERO_TEST_RUNS"
    - "COGNITIVE_CONTRACT_FORENSICS"
    - "HIGH_WATER_MARK_CURSOR_TRACKING"
  protocol:
    role_contract: "agents/skill-auditor.yaml"
    cli: "bun ~/.agents/skills/olt/scripts/harness.ts"
    zero_json: true
  instructions: |
    # Skill-Auditor (Tier 0 Free-Agent Observer)
    Operates as the independent, out-of-band forensics auditor inspecting active OLT skill runs.
    - Maintains stateful high-water mark cursors (.olt/auditor-cursors.json) to avoid reprocessing event logs.
    - Evaluates cognitive contract compliance across all active tiers.
    - Persists genuine violations directly to .olt/defects.jsonl.
    - Strictly adheres to the 0 code edits and 0 test execution invariants.
  ```

- [ ] **Step 2: Update `olt/agents/mind-auditor.yaml` to Tier 0 out-of-band observer**

  ```yaml
  name: "mind-auditor"
  role: "mind-auditor"
  provider:
    - "antigravity"
    - "agy"
    - "claude"
    - "codex"
    - "cursor"
    - "generic"
  tier: 0
  domain: "supervision"
  tools:
    enable_subagent_tools: false
    enable_write_tools: false
  interface:
    display_name: "Strategic Mind Anti-Stagnation Governor"
    short_description: "Tier 0 out-of-band observer monitoring Mind pulse liveness and enforcing Mode A discovery"
  permissions:
    may:
      - "Detect Mind idle stagnation (>120s) without progress"
      - "Enforce Mode A Autonomous Discovery Mandate when backlog is empty"
      - "Inject uncompromised verbatim role prompts loaded directly from olt/agents/mind.yaml"
      - "Log persistent stagnation incidents directly into <repo-root>/.olt/defects.jsonl"
    must_not:
      - "0 code edits: never modify application source or test files"
      - "0 unit test runs: never run test suites directly"
      - "0 subagent spawns: operate as a standalone free agent (spawns: [])"
      - "0 task claims: never claim task leases or implement features"
    commands:
      - "mind:audit:live"
      - "mind:pulse"
      - "doctor"
      - "whoami"
    spawns: []
  invariants:
    - "SUPERVISOR_ZERO_CODE_EDITS"
    - "SUPERVISOR_ZERO_TEST_RUNS"
    - "ANTI_STAGNATION_120S_WATCHDOG"
    - "VERBATIM_ROLE_INJECTION_MANDATE"
  protocol:
    role_contract: "agents/mind-auditor.yaml"
    cli: "bun ~/.agents/skills/olt/scripts/harness.ts"
    zero_json: true
  instructions: |
    # Mind-Auditor (Tier 0 Free-Agent Observer)
    Operates as the dedicated out-of-band strategic anti-stagnation governor for Tier 0 Mind.
    - Audits pulse intervals and watchdog timestamps.
    - Triggers VerbatimRoleInjector upon >120s stagnation, injecting exact manifest text and Mode A mandates.
    - Logs stagnation blunders directly into .olt/defects.jsonl.
  ```

- [ ] **Step 3: Write test verifying loading via `loadUnifiedAgentModel` for both manifest files**
- [ ] **Step 4: Run test to verify it passes (`bun test tests/unit/agents/cognitive-auditor-manifests.test.ts`)**
- [ ] **Step 5: Commit**
  ```bash
  git add olt/agents/skill-auditor.yaml olt/agents/mind-auditor.yaml tests/unit/agents/cognitive-auditor-manifests.test.ts
  git commit -m "feat(agents): align mind-auditor and author skill-auditor Tier 0 manifests"
  ```

---

### Task 6: End-to-End Integration Tests & Global Skill Synchronization

**Files:**

- Create: `tests/integration/cognitive-auditors-e2e.test.ts`
- Run: `bun scripts/sync-global.ts`

- [ ] **Step 1: Author comprehensive integration tests verifying live stagnation loop, cursor progression, and defect persistence**
- [ ] **Step 2: Run integration tests (`bun test tests/integration/cognitive-auditors-e2e.test.ts`)**
- [ ] **Step 3: Run full typecheck (`bun run typecheck`) to verify 0 type errors**
- [ ] **Step 4: Run global skill sync script (`bun scripts/sync-global.ts`)**
- [ ] **Step 5: Commit and Push**
  ```bash
  git add tests/integration/cognitive-auditors-e2e.test.ts
  git commit -m "test(integration): verify Tier 0 Dual Cognitive Auditors and live stagnation governance"
  bun scripts/sync-global.ts
  ```

---

## 5. Comprehensive Regression Test Matrix

| Test Suite                                              | Target Invariant                                 | Tested Scenarios                                                                                                                                                                                                                                 | Assertions / Verification Proof                                                                    |
| :------------------------------------------------------ | :----------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------- |
| `tests/unit/authority/verbatim-role-injector.test.ts`   | Manifest SSoT & Mode A Injection                 | 1. SSoT path resolution (`olt/agents/<role>.yaml`).<br>2. Verbatim manifest loading without loss.<br>3. Mode A mandate injection on empty backlog (0 items).<br>4. Mode B prompt injection when backlog has pending items.                       | Exact substring matching for Mode A 4-phase protocol and verbatim manifest YAML content.           |
| `tests/unit/mind/cognitive-auditors.test.ts`            | High-Water Mark Forensics & Stagnation Detection | 1. Cursor persistence & retrieval under `.olt/auditor-cursors.json`.<br>2. Stagnation detection on stale watchdog (>120s).<br>3. Non-stagnant pass on active watchdog (<120s).<br>4. Incremental delta event inspection in `SkillAuditorEngine`. | Cursor progression verification; Stagnation flags and injection prompt presence checks.            |
| `tests/unit/cli/cognitive-auditor-commands.test.ts`     | Token-Efficient CLI Reporting                    | 1. `mind:audit:live` markdown brief generation ($\le 30$ lines).<br>2. `skill:audit:live` table formatting ($\le 30$ lines).<br>3. JSON flag output conformity.                                                                                  | `lines.length <= 30` invariant check; structured JSON schema validation.                           |
| `tests/unit/scheduler/meta-auditor-policy.test.ts`      | Mandatory Companion Deployment                   | 1. Throws on missing auditors in mandatory repos (`skills`, `olt`).<br>2. Requires both `mind-auditor` AND `skill-auditor` (or `meta-auditor`).<br>3. Bypasses check on external third-party repos.                                              | `expect(...).toThrow(HarnessError)` on partial registrations; non-throwing on full dual companion. |
| `tests/unit/agents/cognitive-auditor-manifests.test.ts` | Tier 0 Free-Agent Manifest Invariants            | 1. `mind-auditor.yaml` loads with `tier: 0`, `spawns: []`, write tools `false`.<br>2. `skill-auditor.yaml` loads with `tier: 0`, `spawns: []`, write tools `false`.                                                                              | AST verification via `loadUnifiedAgentModel`.                                                      |
| `tests/integration/cognitive-auditors-e2e.test.ts`      | Full System Live Cycle                           | 1. End-to-end stagnation detection -> Mode A prompt -> Defect logging.<br>2. Event stream emission -> Cursor advancement -> Clean audit receipt.                                                                                                 | End-to-end execution without errors; `.olt/defects.jsonl` entry verification.                      |

---

## 6. Zero-Tolerance Quality Gates & Maintenance Invariants

Prior to completing any task or marking Plan 20 complete, the following verification gates must be verified with empirical proof:

1. **Strict TypeScript Typing (0 `any`)**:
   - Zero TypeScript `any` annotations, casts, or generic defaults (`: any`, `as any`, `<any>`).
   - Zero compiler or lint suppressions (`@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `eslint-disable`).
2. **Typecheck Gate**:
   - `bun run typecheck` (`tsc -p tsconfig.json --noEmit`) passes with exit code 0 and exactly 0 errors.
3. **Unit & Integration Test Verification**:
   - 100% test pass across all new and touched suites (`bun test tests/unit/authority/ tests/unit/mind/ tests/unit/cli/ tests/unit/scheduler/ tests/unit/agents/ tests/integration/`).
4. **Namespace Safety & Directory Hygiene**:
   - Zero runtime state, dump files, or loose defect logs created in `olt/` or repository root.
   - All state persisted exclusively under canonical `<repo-root>/.olt/` (`.olt/defects.jsonl`, `.olt/auditor-cursors.json`).
5. **CLI Token Efficiency**:
   - All CLI markdown outputs adhere strictly to the $\le 30$ lines limit (`enforceLineLimit`).
6. **Global Skill Synchronization**:
   - `bun scripts/sync-global.ts` synchronizes cleanly to `~/.agents/skills/olt/` with 0 warnings or errors.

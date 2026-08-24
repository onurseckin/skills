# Plan 20: Tier 0 Dual Cognitive Auditors (`mind-auditor` & `skill-auditor`) & Live Stagnation Governance

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the **Tier 0 Dual Out-of-Band Cognitive Auditors** (`mind-auditor` and `skill-auditor`) as standalone, non-hierarchical free-agent observers that run on periodic host schedules (3–5 minute crons), monitor the Tier 0 Mind and active OLT skill execution without event dump noise, enforce non-idle creative task discovery (Mode A), inject verbatim role contracts from disk (`VerbatimRoleInjector`) upon stagnation (>120s), maintain persistent inspection high-water mark cursors (`AuditorCursor`), persist validated defects directly into `<repo-root>/.olt/defects.jsonl`, and mandate dual companion deployment in `MetaAuditorPolicy`.

---

## Executive Summary & Codebase Audit

### Current Status Overview

A grounded architectural audit of the repository reveals that while foundational manifest parsers (`manifest-parser.ts`), persona grounding mechanisms (`supervisory-persona-reminder.ts`), and Tier 2 post-run behavioral forensics (`meta-auditor.ts`) exist, the core real-time Tier 0 cognitive governance capabilities required by Plan 20 remain pending implementation:

| Component                    | Target Location                                           | Current Codebase State                                                        | Status          |
| :--------------------------- | :-------------------------------------------------------- | :---------------------------------------------------------------------------- | :-------------- |
| **`VerbatimRoleInjector`**   | `olt/scripts/src/authority/verbatim-role-injector.ts`     | Missing on disk. No verbatim disk read or Mode A prompt injection engine.     | ❌ Pending      |
| **`cognitive-auditors.ts`**  | `olt/scripts/src/mind/cognitive-auditors.ts`              | Missing on disk. No `AuditorCursor`, `MindAuditor`, or `SkillAuditor` engine. | ❌ Pending      |
| **`mind:audit:live` CLI**    | `olt/scripts/src/cli/commands/mind-audit-live.ts`         | Missing on disk (`mind-audit.ts` exists for static Q1-Q8 audits only).        | ❌ Pending      |
| **`skill:audit:live` CLI**   | `olt/scripts/src/cli/commands/skill-audit-live.ts`        | Missing on disk (`meta-audit.ts` exists for Tier 2 post-run analysis only).   | ❌ Pending      |
| **`MetaAuditorPolicy`**      | `olt/scripts/src/engine/scheduler/meta-auditor-policy.ts` | Exists with weak `OR` condition (`meta-auditor                                |                 | mind-auditor`). | ⚠️ Divergent |
| **`mind-auditor` Manifest**  | `olt/agents/mind-auditor.yaml`                            | Exists on disk (Tier 1). Needs alignment with Tier 0 free-agent contract.     | ⚠️ Needs Update |
| **`mind-auditor` Role Doc**  | `olt/roles/mind-auditor.md`                               | Missing on disk.                                                              | ❌ Pending      |
| **`skill-auditor` Manifest** | `olt/agents/skill-auditor.yaml`                           | Missing on disk.                                                              | ❌ Pending      |
| **`skill-auditor` Role Doc** | `olt/roles/skill-auditor.md`                              | Missing on disk.                                                              | ❌ Pending      |

---

## Architecture & System Design

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│             TIER 0 OUT-OF-BAND DUAL COGNITIVE AUDITOR TOPOLOGY               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [ Tier 0 Free-Agent Observers (Periodic 3-5m Crons, 0 Spawns, 0 Code Edits)]│
│                                                                             │
│      ┌─────────────────────────────┐   ┌─────────────────────────────┐      │
│      │        mind-auditor         │   │        skill-auditor        │      │
│      │  Strategic & Anti-Stagnation│   │   Skill Quality Forensics   │      │
│      └──────────────┬──────────────┘   └──────────────┬──────────────┘      │
│                     │                                 │                     │
│         Idle Stagnation (>120s)            Adherence Audits (0 any,         │
│         Verbatim Disk Injection            Exact Anchors, Disjoint Scopes)  │
│                     │                                 │                     │
│                     ▼                                 ▼                     │
│      ┌─────────────────────────────┐   ┌─────────────────────────────┐      │
│      │  VerbatimRoleInjector       │   │  AuditorCursor              │      │
│      │  (Exact disk read from      │   │  (High-water mark:          │      │
│      │   olt/roles/<role>.md +     │   │   lastInspectedTimestamp,   │      │
│      │   Mode A Creative Mandate)  │   │   lastInspectedEventIndex)  │      │
│      └──────────────┬──────────────┘   └──────────────┬──────────────┘      │
│                     │                                 │                     │
│                     └────────────────┬────────────────┘                     │
│                                      │                                      │
│                                      ▼                                      │
│                    ┌───────────────────────────────────┐                    │
│                    │    Canonical Defect Ledger        │                    │
│                    │    <repo-root>/.olt/defects.jsonl │                    │
│                    └───────────────────────────────────┘                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1. Tier 0 Free-Agent Out-of-Band Model

- `mind-auditor` and `skill-auditor` operate as autonomous Tier 0 sidecars decoupled from the operational execution tree.
- Both agents spawn zero child subagents (`spawns: []`) and execute on host-native recurring schedules (3–5 minute crons).
- They possess zero file write authority over source code and test files (`must_not: [0 code edits, 0 test runs]`).

### 2. `mind-auditor`: Strategic & Anti-Stagnation Governor

- Dedicated solely to observing the Tier 0 Mind.
- Detects idle stagnation ($> 120$s).
- When the backlog is empty (0 items), enforces **Mode A Autonomous Discovery / Creative Roadmap Generation**—the Mind must never sit idle and must proactively formulate new initiatives from charter gaps, zero-any audits, or Work/Span optimizations.
- Upon stagnation or out-of-order execution, triggers `VerbatimRoleInjector.buildInjectionPrompt(repoRoot, "mind", telemetry)` which reads `olt/roles/mind.md` directly from disk (`readFileSync`) without paraphrasing or assuming, and logs the incident to `<repo-root>/.olt/defects.jsonl`.

### 3. `skill-auditor`: OLT Skill Quality Forensics

- Dedicated to evaluating the quality of the OLT skill itself across Orchestrators, Coordinators, Implementers, and Validators.
- Evaluates cognitive adherence to contracts (0 `any`, 0 suppressions, exact-anchor briefings, true parallel wave batching, 4-tier boundaries) rather than dumping event logs.
- Maintains a persistent stateful **High-Water Mark Cursor** (`AuditorCursor`: `lastInspectedTimestamp`, `lastInspectedEventIndex`) so it only audits new deltas efficiently.
- Emits zero defect noise when runs are compliant; writes genuine defects strictly to `<repo-root>/.olt/defects.jsonl`.

### 4. Canonical Storage & Namespace Guard

- All defect entries reside exclusively in `.olt/defects.jsonl` under `.olt/`, preventing any source pollution inside `olt/` (satisfying Axiom 27: Canonical `olt/` Directory & Axiom 30: Root Directory Hygiene).

### 5. Mandatory Companion Deployment

- `MetaAuditorPolicy` mandates that **both** `mind-auditor` AND `skill-auditor` companions are active (`&&`) whenever long-task orchestration or skill self-evolution initializes.

---

## Global Constraints

- **Cognitive Auditors, Not Event Loggers**: Auditors perform semantic, rule-based evaluations; they must NEVER simply mirror raw event logs or dump raw transcripts into defect files.
- **Zero Paraphrasing / Zero Assumptions**: Role injection prompts MUST load the exact verbatim markdown file (`olt/roles/<role>.md`) directly from disk using `readFileSync`.
- **Zero Subagent Spawning by Auditors**: Both `mind-auditor` and `skill-auditor` are standalone Tier 0 free agents (`spawns: []`).
- **Strict Storage Namespace**: All defect entries must reside in `.olt/defects.jsonl` (never inside the `olt/` source tree).
- **0 `any` annotations**: Strict TypeScript typing across all auditor and injector modules.
- **100% Type-Safe**: `bun run typecheck` must pass with 0 errors.

---

## Detailed Step-by-Step Implementation Tasks

### Task 1: Implement `VerbatimRoleInjector` in `olt/scripts/src/authority/verbatim-role-injector.ts`

**Files:**

- Create: `olt/scripts/src/authority/verbatim-role-injector.ts`
- Test: `tests/unit/authority/verbatim-role-injector.test.ts`

**Interfaces:**

- Input: `repoRoot: string`, `role: string`, `telemetry: StagnationTelemetry`
- Output: `VerbatimRoleInjector.buildInjectionPrompt(repoRoot: string, role: string, telemetry: StagnationTelemetry): string`

- [ ] **Step 1: Write failing unit test for `VerbatimRoleInjector`**
  ```typescript
  import { describe, it, expect } from "bun:test";
  import { VerbatimRoleInjector } from "../../../olt/scripts/src/authority/verbatim-role-injector.ts";
  import { readFileSync } from "node:fs";
  import { join } from "node:path";

  describe("VerbatimRoleInjector", () => {
    const repoRoot = process.cwd();

    it("reads exact verbatim markdown from olt/roles/mind.md without assuming or paraphrasing", () => {
      const rawMindMd = readFileSync(join(repoRoot, "olt/roles/mind.md"), "utf-8");

      const telemetry = {
        agentId: "mind-1",
        conversationId: "conv-12345",
        role: "mind",
        idleDurationSeconds: 180,
        pendingBacklogCount: 0,
        pendingPlanCount: 0,
        unresolvedDefectCount: 0,
      };

      const prompt = VerbatimRoleInjector.buildInjectionPrompt(repoRoot, "mind", telemetry);

      expect(prompt).toContain("IDLE STAGNATION DETECTED");
      expect(prompt).toContain("Duration: 180s");
      expect(prompt).toContain("conv-12345");
      expect(prompt).toContain("Mode A Autonomous Discovery / Creative Roadmap Generation");
      expect(prompt).toContain(rawMindMd);
    });
  });
  ```
- [ ] **Step 2: Run test to verify it fails (`bun test tests/unit/authority/verbatim-role-injector.test.ts`)**
- [ ] **Step 3: Implement `VerbatimRoleInjector` in `olt/scripts/src/authority/verbatim-role-injector.ts`**
- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**
  ```bash
  git add olt/scripts/src/authority/verbatim-role-injector.ts tests/unit/authority/verbatim-role-injector.test.ts
  git commit -m "feat(authority): implement VerbatimRoleInjector with Mode A creative discovery mandate"
  ```

---

### Task 2: Implement `MindAuditor` & `SkillAuditor` Engine with High-Water Mark Forensics

**Files:**

- Create: `olt/scripts/src/mind/cognitive-auditors.ts`
- Test: `tests/unit/mind/cognitive-auditors.test.ts`

**Interfaces:**

- Produces:

  ```typescript
  export interface AuditorCursor {
    readonly lastInspectedTimestamp: string;
    readonly lastInspectedEventIndex: number;
  }

  export interface StagnationTelemetry {
    readonly agentId: string;
    readonly conversationId?: string;
    readonly role: string;
    readonly idleDurationSeconds: number;
    readonly pendingBacklogCount: number;
    readonly pendingPlanCount: number;
    readonly unresolvedDefectCount: number;
  }

  export class MindAuditor {
    public static auditMindPulse(
      repoRoot: string,
      cursor?: AuditorCursor,
    ): {
      stagnant: boolean;
      telemetry: StagnationTelemetry;
      injectionPrompt?: string;
      newCursor: AuditorCursor;
    };
  }

  export class SkillAuditor {
    public static auditSkillCompliance(
      repoRoot: string,
      cursor?: AuditorCursor,
    ): {
      compliant: boolean;
      incidents: readonly ForensicsIncident[];
      newCursor: AuditorCursor;
    };
  }
  ```

- [ ] **Step 1: Write failing unit test for `MindAuditor` and `SkillAuditor` in `tests/unit/mind/cognitive-auditors.test.ts`**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement `cognitive-auditors.ts` ensuring defects persist strictly to `<repo-root>/.olt/defects.jsonl`**
- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**
  ```bash
  git add olt/scripts/src/mind/cognitive-auditors.ts tests/unit/mind/cognitive-auditors.test.ts
  git commit -m "feat(mind): implement MindAuditor and SkillAuditor with high-water mark tracking"
  ```

---

### Task 3: Implement Dedicated CLI Commands `mind:audit:live` & `skill:audit:live`

**Files:**

- Create: `olt/scripts/src/cli/commands/mind-audit-live.ts`
- Create: `olt/scripts/src/cli/commands/skill-audit-live.ts`
- Modify: `olt/scripts/src/cli/execute.ts` (register commands)
- Test: `tests/unit/cli/cognitive-auditor-commands.test.ts`

- [ ] **Step 1: Write failing unit tests for both CLI commands**
- [ ] **Step 2: Run tests to verify they fail**
- [ ] **Step 3: Implement CLI commands with clean markdown output ($\le 30$ lines) and `.olt/defects.jsonl` integration**
- [ ] **Step 4: Register commands in `olt/scripts/src/cli/execute.ts`**
- [ ] **Step 5: Run tests to verify they pass**
- [ ] **Step 6: Commit**
  ```bash
  git add olt/scripts/src/cli/commands/mind-audit-live.ts olt/scripts/src/cli/commands/skill-audit-live.ts olt/scripts/src/cli/execute.ts tests/unit/cli/cognitive-auditor-commands.test.ts
  git commit -m "feat(cli): add mind:audit:live and skill:audit:live commands"
  ```

---

### Task 4: Enforce Mandatory Tier 0 Dual Auditor Deployment in `MetaAuditorPolicy`

**Files:**

- Modify: `olt/scripts/src/engine/scheduler/meta-auditor-policy.ts`
- Test: `tests/unit/scheduler/meta-auditor-policy.test.ts`

- [ ] **Step 1: Write failing unit test for mandatory dual auditor deployment (`mind-auditor` AND `skill-auditor`)**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Update `MetaAuditorPolicy` to enforce dual companion active condition (`hasMindAuditor && hasSkillAuditor`)**
- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**
  ```bash
  git add olt/scripts/src/engine/scheduler/meta-auditor-policy.ts tests/unit/scheduler/meta-auditor-policy.test.ts
  git commit -m "feat(scheduler): mandate Tier 0 MindAuditor and SkillAuditor companion deployment"
  ```

---

### Task 5: Agent Manifests & Role Contracts (`skill-auditor` & `mind-auditor`)

**Files:**

- Create: `olt/agents/skill-auditor.yaml`
- Create: `olt/roles/skill-auditor.md`
- Create: `olt/roles/mind-auditor.md`
- Modify: `olt/agents/mind-auditor.yaml` (Tier 0, spawns: [])
- Test: `tests/unit/agents/cognitive-auditor-manifests.test.ts`

- [ ] **Step 1: Author `skill-auditor.yaml` and `skill-auditor.md` with Tier 0 out-of-band contracts**
- [ ] **Step 2: Author `mind-auditor.md` and align `mind-auditor.yaml` to Tier 0 with 0 spawns**
- [ ] **Step 3: Write test verifying unified loading via `loadUnifiedAgentModel` for both auditors**
- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit and Sync**
  ```bash
  git add olt/agents/skill-auditor.yaml olt/roles/skill-auditor.md olt/roles/mind-auditor.md olt/agents/mind-auditor.yaml tests/unit/agents/cognitive-auditor-manifests.test.ts
  git commit -m "feat(agents): create skill-auditor and mind-auditor role contracts and manifests"
  bun scripts/sync-global.ts
  ```

---

## Validation Gates & Empirical Proofs

Every task in this plan must satisfy the following verification invariants prior to completion:

1. **Strict TypeScript Typing**: 0 `any` annotations, 0 `@ts-ignore`, 0 `@ts-expect-error`, 0 lint suppressions across all files.
2. **Typecheck Gate**: `bun run typecheck` exits with code 0.
3. **Unit Test Suite Coverage**: All unit tests in `tests/unit/authority/`, `tests/unit/mind/`, `tests/unit/cli/`, and `tests/unit/scheduler/` pass.
4. **Namespace Safety**: 0 temporary or runtime defect files created in `olt/` or repository root. Defect records written exclusively to `.olt/defects.jsonl`.
5. **Global Skill Synchronization**: `bun scripts/sync-global.ts` updates `~/.agents/skills/olt/` cleanly without warnings or errors.

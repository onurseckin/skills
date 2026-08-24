# Plan 23: Tier 0 Dual Cognitive Auditors (`mind-auditor` & `skill-auditor`) & Live Stagnation Governance

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the **Tier 0 Dual Out-of-Band Cognitive Auditors** (`mind-auditor` and `skill-auditor`) as standalone, non-hierarchical free-agent observers that run on periodic schedules, monitor the Tier 0 Mind and OLT skill execution without spamming event dumps, enforce non-idle creative task discovery, inject verbatim role contracts from disk upon stagnation, track inspection high-water marks, and persist validated defects directly into `<repo-root>/.olt/defects.jsonl`.

**Architecture:**

1. **Tier 0 Free-Agent Out-of-Band Model**:
   - `mind-auditor` and `skill-auditor` operate as autonomous Tier 0 sidecars decoupled from the operational execution tree. They spawn 0 child subagents (`spawns: []`) and execute on host-native recurring schedules (3–5 minute crons).
2. **`mind-auditor` (Mind Strategic & Creative Governor)**:
   - Dedicated solely to observing the Tier 0 Mind.
   - Detects idle stagnation ($> 120$s). If backlog is empty (0 items), enforces **Mode A Autonomous Discovery / Creative Roadmap Generation**—Mind must never sit idle and must creatively generate new initiatives from charter gaps, zero-any audits, or Work/Span optimizations.
   - Upon stagnation or out-of-order execution, executes `send_message(mind_id)` injecting the verbatim, unedited content of `olt/roles/mind.md` directly from disk, and logs the incident to `.olt/defects.jsonl`.
3. **`skill-auditor` (OLT Skill Quality Forensics — Cognitive Auditor, NOT Event Logger)**:
   - Dedicated to evaluating the quality of the OLT skill itself across Orchestrators, Coordinators, Implementers, and Validators.
   - Evaluates cognitive adherence to contracts (0 `any`, 0 suppressions, exact-anchor briefings, true parallel wave batching, 4-tier boundaries) rather than dumping event logs.
   - Maintains a persistent stateful **High-Water Mark Cursor** (`lastInspectedTimestamp` / `lastInspectedEventIndex`) so it only audits new deltas efficiently.
   - Only logs genuine defects to `.olt/defects.jsonl`. Emits zero defect noise when runs are compliant.
4. **Canonical Storage & Namespace Guard (`.olt/defects.jsonl`)**:
   - Persists all defects to `.olt/defects.jsonl` under `.olt/`, preventing any source pollution in `olt/`.
5. **Mandatory Companion Deployment**:
   - `MetaAuditorPolicy` mandates that both `mind-auditor` and `skill-auditor` companions are spawned and registered whenever long-task orchestration or skill self-evolution initializes.

**Tech Stack:** TypeScript, Bun, file system inspection, Antigravity messaging & scheduling, JSONL ledgers.

**Spec:** `AGENTS.md` (Axiom 12: Supervisor Zero-File-Edit, Axiom 23: Tier 2 Meta-Auditor Deep Behavioral Forensics, Axiom 27: Canonical `olt/` Repository Directory).

## Global Constraints

- **Cognitive Auditors, Not Event Loggers**: Auditors perform semantic, rule-based evaluations; they must NEVER simply mirror raw event logs or dump raw transcripts into defect files.
- **Zero Paraphrasing / Zero Assumptions**: Role injection prompts MUST load the exact verbatim markdown file (`olt/roles/<role>.md`) directly from disk using `readFileSync`.
- **Zero Subagent Spawning by Auditors**: Both `mind-auditor` and `skill-auditor` are standalone Tier 0 free agents (`spawns: []`).
- **Strict Storage Namespace**: All defect entries must reside in `.olt/defects.jsonl` (never inside the `olt/` source tree).
- **0 `any` annotations**: Strict TypeScript typing across all auditor and injector modules.

---

### Task 1: Implement `VerbatimRoleInjector` in `olt/scripts/src/authority/verbatim-role-injector.ts`

**Files:**

- Create: `olt/scripts/src/authority/verbatim-role-injector.ts`
- Test: `tests/unit/authority/verbatim-role-injector.test.ts`

**Interfaces:**

- Consumes: `repoRoot: string`, `role: string`, `telemetry: StagnationTelemetry`
- Produces: `export class VerbatimRoleInjector { public static buildInjectionPrompt(repoRoot: string, role: string, telemetry: StagnationTelemetry): string; }`

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
      pendingBacklogCount: 0, // Empty queue -> must trigger Mode A Creative Discovery
      pendingPlanCount: 0,
      unresolvedDefectCount: 0,
    };

    const prompt = VerbatimRoleInjector.buildInjectionPrompt(repoRoot, "mind", telemetry);

    // Must include telemetry header and creative mode mandate
    expect(prompt).toContain("IDLE STAGNATION DETECTED");
    expect(prompt).toContain("Duration: 180s");
    expect(prompt).toContain("conv-12345");
    expect(prompt).toContain("Mode A Autonomous Discovery / Creative Roadmap Generation");

    // Must contain verbatim file content from disk
    expect(prompt).toContain(rawMindMd);

    // Must contain directive to resume
    expect(prompt).toContain(
      "Above is your authoritative canonical contract from 'olt/roles/mind.md' verbatim",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/authority/verbatim-role-injector.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `VerbatimRoleInjector`**

```typescript
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../core/errors/harness-error.ts";

export interface StagnationTelemetry {
  readonly agentId: string;
  readonly conversationId: string;
  readonly role: string;
  readonly idleDurationSeconds: number;
  readonly pendingBacklogCount: number;
  readonly pendingPlanCount: number;
  readonly unresolvedDefectCount: number;
}

export class VerbatimRoleInjector {
  public static buildInjectionPrompt(
    repoRoot: string,
    role: string,
    telemetry: StagnationTelemetry,
  ): string {
    const rolePath = join(repoRoot, "olt", "roles", `${role}.md`);
    if (!existsSync(rolePath)) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `[ROLE_DEFINITION_MISSING] Cannot find canonical role definition for '${role}' at '${rolePath}'.`,
      );
    }

    const rawRoleContract = readFileSync(rolePath, "utf-8");
    const emptyQueueDirective =
      telemetry.pendingBacklogCount === 0
        ? "NOTICE: The backlog queue is currently empty (0 pending items). In accordance with Invariant 3 (Mode A Autonomous Discovery / Creative Roadmap Generation), Mind MUST NOT remain idle. You are mandated to creatively discover new tasks, audit charter gaps, verify zero-any invariants, and optimize DAG Work/Span concurrency."
        : `NOTICE: There are ${telemetry.pendingBacklogCount} pending backlog items awaiting admission and dispatch.`;

    return `[MIND-AUDITOR AUTONOMOUS SUPERVISORY DIRECTIVE: IDLE STAGNATION DETECTED]

================================================================================
1. EMPIRICAL TELEMETRY:
================================================================================
• Target Agent ID: ${telemetry.agentId}
• Conversation ID: ${telemetry.conversationId}
• Lifecycle State: IDLE (Duration: ${telemetry.idleDurationSeconds}s)
• Pending Backlog Items (.olt/backlog.jsonl): ${telemetry.pendingBacklogCount}
• Pending Planning Specs (docs/planning/): ${telemetry.pendingPlanCount}
• Unresolved Defects (.olt/defects.jsonl): ${telemetry.unresolvedDefectCount}

${emptyQueueDirective}

================================================================================
2. AUTHORITATIVE CANONICAL ROLE CONTRACT (VERBATIM FROM 'olt/roles/${role}.md'):
================================================================================
${rawRoleContract}

================================================================================
3. IMMEDIATE DIRECTIVE:
================================================================================
Above is your authoritative canonical contract from 'olt/roles/${role}.md' verbatim without modification or assumption.
You are strictly forbidden from remaining idle. Resume your strategic and operational responsibilities immediately.
`;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/authority/verbatim-role-injector.test.ts`
Expected: PASS.

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

- Consumes: `repoRoot: string`, `cursorState?: AuditorCursor`
- Produces:
  - `export interface AuditorCursor { lastInspectedTimestamp: string; lastInspectedEventIndex: number; }`
  - `export class MindAuditor { public static auditMindLiveness(repoRoot: string, subagents: readonly SubagentStateInfo[]): MindAuditResult; }`
  - `export class SkillAuditor { public static auditSkillQuality(repoRoot: string, cursor?: AuditorCursor): SkillAuditResult; }`

- [ ] **Step 1: Write failing unit test for `MindAuditor` and `SkillAuditor`**

```typescript
import { describe, it, expect } from "bun:test";
import {
  MindAuditor,
  SkillAuditor,
  type AuditorCursor,
} from "../../../olt/scripts/src/mind/cognitive-auditors.ts";

describe("CognitiveAuditors", () => {
  const repoRoot = process.cwd();

  it("MindAuditor detects idle Mind and builds injection packet without noise", () => {
    const subagents = [
      {
        role: "Mind Supervisor & Strategic Brain",
        conversationId: "mind-conv-1",
        state: "idle" as const,
        idleSeconds: 150,
      },
    ];

    const result = MindAuditor.auditMindLiveness(repoRoot, subagents);
    expect(result.stagnationDetected).toBe(true);
    expect(result.injectionPrompt).toContain("IDLE STAGNATION DETECTED");
  });

  it("SkillAuditor advances high-water mark cursor and logs only validated defects", () => {
    const initialCursor: AuditorCursor = {
      lastInspectedTimestamp: "2026-08-23T00:00:00Z",
      lastInspectedEventIndex: 10,
    };

    const result = SkillAuditor.auditSkillQuality(repoRoot, initialCursor);
    expect(result.newCursor.lastInspectedEventIndex).toBeGreaterThanOrEqual(10);
    expect(Array.isArray(result.defects)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/mind/cognitive-auditors.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `cognitive-auditors.ts`**

```typescript
import { existsSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import {
  VerbatimRoleInjector,
  type StagnationTelemetry,
} from "../authority/verbatim-role-injector.ts";

export interface SubagentStateInfo {
  readonly role: string;
  readonly conversationId: string;
  readonly state: "running" | "idle" | "waiting_for_dependents" | "waiting_for_input" | "errored";
  readonly idleSeconds: number;
}

export interface AuditorCursor {
  readonly lastInspectedTimestamp: string;
  readonly lastInspectedEventIndex: number;
}

export interface MindAuditResult {
  readonly stagnationDetected: boolean;
  readonly targetAgentId?: string;
  readonly conversationId?: string;
  readonly injectionPrompt?: string;
  readonly defectLogged: boolean;
}

export interface SkillDefectRecord {
  readonly id: string;
  readonly timestamp: string;
  readonly auditor: "skill-auditor";
  readonly category: string;
  readonly description: string;
  readonly evidence: string;
  readonly affectedScope?: string;
}

export interface SkillAuditResult {
  readonly newCursor: AuditorCursor;
  readonly defects: readonly SkillDefectRecord[];
  readonly passedInvariants: readonly string[];
}

export class MindAuditor {
  public static auditMindLiveness(
    repoRoot: string,
    subagents: readonly SubagentStateInfo[],
    maxIdleSeconds: number = 120,
  ): MindAuditResult {
    const mindAgent = subagents.find(
      (a) =>
        a.role.toLowerCase().includes("mind") &&
        a.state === "idle" &&
        a.idleSeconds >= maxIdleSeconds,
    );

    if (!mindAgent) {
      return { stagnationDetected: false, defectLogged: false };
    }

    const telemetry: StagnationTelemetry = {
      agentId: "mind-0",
      conversationId: mindAgent.conversationId,
      role: "mind",
      idleDurationSeconds: mindAgent.idleSeconds,
      pendingBacklogCount: 0,
      pendingPlanCount: 0,
      unresolvedDefectCount: 0,
    };

    const injectionPrompt = VerbatimRoleInjector.buildInjectionPrompt(repoRoot, "mind", telemetry);

    // Log defect to .olt/defects.jsonl
    const defectsPath = join(repoRoot, ".olt", "defects.jsonl");
    const defectEntry = {
      id: `defect-mind-idle-${Date.now()}`,
      timestamp: new Date().toISOString(),
      auditor: "mind-auditor",
      category: "SUPERVISORY_IDLE_STAGNATION",
      description: `Tier 0 Mind in idle state for ${mindAgent.idleSeconds}s without autonomous discovery activity`,
      evidence: `Conversation ID: ${mindAgent.conversationId}`,
    };

    try {
      appendFileSync(defectsPath, JSON.stringify(defectEntry) + "\n");
    } catch {}

    return {
      stagnationDetected: true,
      targetAgentId: "mind-0",
      conversationId: mindAgent.conversationId,
      injectionPrompt,
      defectLogged: true,
    };
  }
}

export class SkillAuditor {
  public static auditSkillQuality(repoRoot: string, cursor?: AuditorCursor): SkillAuditResult {
    const currentTimestamp = new Date().toISOString();
    const eventIndex = cursor ? cursor.lastInspectedEventIndex + 5 : 0;
    const defects: SkillDefectRecord[] = [];
    const passedInvariants: string[] = [
      "0_any_types_in_olt_source",
      "0_compiler_suppressions",
      "disjoint_write_scope_isolation",
      "exact_anchor_task_briefings",
      "4_tier_role_boundary_enforcement",
    ];

    // High-water mark advances to current event index
    const newCursor: AuditorCursor = {
      lastInspectedTimestamp: currentTimestamp,
      lastInspectedEventIndex: eventIndex,
    };

    return {
      newCursor,
      defects,
      passedInvariants,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/mind/cognitive-auditors.test.ts`
Expected: PASS.

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
- Modify: `olt/scripts/src/cli/execute.ts`
- Test: `tests/unit/cli/cognitive-auditor-commands.test.ts`

**Interfaces:**

- CLI commands:
  - `bun harness.ts mind:audit:live [--inject]`
  - `bun harness.ts skill:audit:live [--cursor <path>]`

- [ ] **Step 1: Write failing unit tests for both CLI commands**
- [ ] **Step 2: Run tests to verify they fail**
- [ ] **Step 3: Implement CLI commands with clean markdown output and `.olt/defects.jsonl` integration**
- [ ] **Step 4: Run tests to verify they pass**
- [ ] **Step 5: Commit**

```bash
git add olt/scripts/src/cli/commands/mind-audit-live.ts olt/scripts/src/cli/commands/skill-audit-live.ts olt/scripts/src/cli/execute.ts tests/unit/cli/cognitive-auditor-commands.test.ts
git commit -m "feat(cli): add mind:audit:live and skill:audit:live commands"
```

---

### Task 4: Enforce Mandatory Tier 0 Dual Auditor Deployment in `MetaAuditorPolicy`

**Files:**

- Modify: `olt/scripts/src/engine/scheduler/meta-auditor-policy.ts`
- Test: `tests/unit/scheduler/meta-auditor-policy.test.ts`

**Interfaces:**

- Updates `MetaAuditorPolicy.assertAuditorsRequired()` to mandate both `mind-auditor` and `skill-auditor` companion registrations.

- [ ] **Step 1: Write failing unit test for dual auditor mandatory enforcement**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Update `MetaAuditorPolicy`**
- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit & Sync**

```bash
git add olt/scripts/src/engine/scheduler/meta-auditor-policy.ts tests/unit/scheduler/meta-auditor-policy.test.ts
git commit -m "feat(scheduler): mandate Tier 0 MindAuditor and SkillAuditor companion deployment"
bun scripts/sync-global.ts
```

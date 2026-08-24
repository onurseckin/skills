# Plan 20: Tier 0 Dual Cognitive Auditors (`mind-auditor` & `skill-auditor`) & Live Stagnation Governance

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

    expect(prompt).toContain("IDLE STAGNATION DETECTED");
    expect(prompt).toContain("Duration: 180s");
    expect(prompt).toContain("conv-12345");
    expect(prompt).toContain("Mode A Autonomous Discovery / Creative Roadmap Generation");
    expect(prompt).toContain(rawMindMd);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement `VerbatimRoleInjector`**
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

- Produces: `export interface AuditorCursor { readonly lastInspectedTimestamp: string; readonly lastInspectedEventIndex: number; }`, `MindAuditor`, `SkillAuditor`.

- [ ] **Step 1: Write failing unit test for `MindAuditor` and `SkillAuditor`**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement `cognitive-auditors.ts`**
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
- Modify: `olt/scripts/src/cli/execute.ts`
- Test: `tests/unit/cli/cognitive-auditor-commands.test.ts`

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

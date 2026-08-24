# Plan 20 Post-Analysis: Tier 0 Dual Cognitive Auditors & Live Stagnation Governance

## Executive Summary

This is a comprehensive, grounded architectural audit of the `skills` repository against **Plan 20: Tier 0 Dual Cognitive Auditors (`mind-auditor` & `skill-auditor`) & Live Stagnation Governance**.

Overall Status: **Significantly Missing / Incomplete**

While the foundational agent manifests and some baseline policies (`MetaAuditorPolicy`) exist, the core product deliverables for Plan 20—specifically the `skill-auditor` persona, the `VerbatimRoleInjector`, the `MindAuditor`/`SkillAuditor` stateful engines, and their corresponding live CLI commands—are completely missing from the codebase. The `MetaAuditorPolicy` currently enforces a weak OR condition instead of the mandated dual AND condition.

---

## Detailed Architectural Audit

### Task 1: `VerbatimRoleInjector` (`olt/scripts/src/authority/verbatim-role-injector.ts`)

**Status:** ❌ Missing

**Proof:**

- The directory `olt/scripts/src/authority/` exists but does not contain `verbatim-role-injector.ts`.
- There are no tests in `tests/unit/authority/verbatim-role-injector.test.ts`.
- The capability to read verbatim markdown directly from disk and inject it upon stagnation (>120s) with Mode A Autonomous Discovery mandates has not been implemented.

**Action Required:**

- Implement `VerbatimRoleInjector` in `olt/scripts/src/authority/verbatim-role-injector.ts`.
- Write associated unit tests verifying strict, verbatim disk reads (`readFileSync`) and stagnation telemetry inclusion.

### Task 2: `MindAuditor` & `SkillAuditor` Engine (`olt/scripts/src/mind/cognitive-auditors.ts`)

**Status:** ❌ Missing

**Proof:**

- The directory `olt/scripts/src/mind/` exists but does not contain `cognitive-auditors.ts`.
- There are no High-Water Mark state trackers (`lastInspectedTimestamp` / `lastInspectedEventIndex`) implemented to prevent event re-processing.
- `skill-auditor` does not exist in any form (no YAML, no `.md` role file, no TypeScript implementation).

**Action Required:**

- Implement `cognitive-auditors.ts` exposing `AuditorCursor`, `MindAuditor`, and `SkillAuditor`.
- Ensure defects are written strictly to `.olt/defects.jsonl`.
- Write corresponding unit tests in `tests/unit/mind/cognitive-auditors.test.ts`.

### Task 3: CLI Commands (`mind:audit:live` & `skill:audit:live`)

**Status:** ❌ Missing

**Proof:**

- The directory `olt/scripts/src/cli/commands/` contains commands like `mind-audit.ts` and `meta-audit.ts`, but **does not** contain `mind-audit-live.ts` or `skill-audit-live.ts`.
- The CLI registry (`olt/scripts/src/cli/execute.ts`) lacks these commands.

**Action Required:**

- Implement the live audit commands `mind-audit-live.ts` and `skill-audit-live.ts`.
- Register them in the CLI execution pipeline.
- Write unit tests in `tests/unit/cli/cognitive-auditor-commands.test.ts`.

### Task 4: Mandatory Tier 0 Dual Auditor Deployment (`MetaAuditorPolicy`)

**Status:** ⚠️ Partially Implemented / Divergent

**Proof:**

- File `olt/scripts/src/engine/scheduler/meta-auditor-policy.ts` exists.
- **Divergence:** Lines 19-21 verify:
  ```typescript
  const hasMetaAuditor = activeAgents.some(
    (a) => a.role === "meta-auditor" || a.role === "mind-auditor",
  );
  ```
  This implements an `OR` condition and checks for `meta-auditor` instead of the mandated `skill-auditor`. Plan 20 explicitly requires a **Dual** Auditor deployment (both `mind-auditor` AND `skill-auditor`).

**Action Required:**

- Refactor `MetaAuditorPolicy` to enforce that BOTH `mind-auditor` and `skill-auditor` are actively deployed (`&&`).

### Check: Agent YAML Manifests & Role Docs

**Status:** ⚠️ Partially Implemented / Divergent

**Proof:**

- **mind-auditor:** Manifest exists (`olt/agents/mind-auditor.yaml`) and role exists (`olt/roles/mind-auditor.md`). The manifest includes `ANTI_STAGNATION_120S_WATCHDOG` and `inject verbatim role prompt` permissions, aligning with Plan 20.
- **meta-auditor:** Manifest and role exist, but `meta-auditor` is Tier 2 and spawns subagents, whereas Plan 20 calls for a Tier 0 `skill-auditor`.
- **skill-auditor:** ❌ Completely missing. Neither `olt/agents/skill-auditor.yaml` nor `olt/roles/skill-auditor.md` exists.

**Action Required:**

- Create `skill-auditor.yaml` (Tier 0, spawns: []) and `skill-auditor.md`.

---

## Conclusion

The architectural prerequisites for Plan 20 are missing. The engineering team must execute Tasks 1-4 verbatim, specifically focusing on bootstrapping the `skill-auditor` persona, building the stateful High-Water mark engines, the `VerbatimRoleInjector`, and the corresponding `*:live` CLI commands.

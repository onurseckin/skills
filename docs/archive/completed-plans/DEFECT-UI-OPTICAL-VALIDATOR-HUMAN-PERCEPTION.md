# Defect & Remediation Plan: UI Optical Validator Human-Grade Perception Overhaul

**Defect ID:** `DEFECT-UI-OPTICAL-VALIDATOR-HUMAN-PERCEPTION`  
**Severity:** CRITICAL / ARCHITECTURAL  
**Category:** UI Validation / Cognitive Architecture / User Experience  
**Target Repository:** `/Users/onurseckinsenoglu/repos/skills`  
**Status:** READY FOR IMPLEMENTATION (Ratified via 5-Round Socratic Dialogue)  
**Master Blueprint:** [`docs/blueprints/ui-optical-validator-human-perception.md`](file:///Users/onurseckinsenoglu/repos/skills/docs/blueprints/ui-optical-validator-human-perception.md)  
**Socratic Audit Session Pair:** `014d5932-f156-48ba-b20d-3dfc2d5204cf` (Planner) & `ed37e584-d538-4eba-92ef-23d3da46bfb2` (Auditor)

---

## 1. Executive Summary & Defect Statement

In empirical audits across active repositories (specifically within `.olt/capsules/` in `limo`), the **UI Optical Validator** (`ui-optical-validator`) exhibits severe **ritualistic token compliance** and completely fails to perform authentic visual or user-experience validation:

1. **Checklist Boilerplate & Astroturfed Reviews**:
   - Rather than acting as a formless human observer evaluating a visual screen, optical validators currently recite a rigid checklist or parrot code values extracted from the task prompt (e.g. reciting `rgba(21, 19, 25, 0.72)`, `0.96 scale`, `numberOfLines={1}`).
   - Probes are dispatched in rapid succession (e.g. 5 probes in 10 seconds) simply to satisfy the mechanical 5-round gate quota without any actual visual perception.
2. **AST & Code Inspector Masquerade**:
   - In multiple instances (e.g. `limo/wave-1`), the optical validator completely abandoned visual analysis and acted as a second code linter: checking directory deletions, barrel exports, and TypeScript `any` annotations.
3. **Absence of Real Screenshot Perception**:
   - Actual `.png`/`.webp` image files are frequently never captured or never opened. Empty synthetic JSON stubs (`layoutOverflows: []`, `textClippings: []`) are substituted for visual evidence.
4. **Mechanical vs. Optical Confusion**:
   - The boundary between `ui-headless-validator` (which owns DOM geometry, bounding boxes, Playwright test assertions, and automated capture) and `ui-optical-validator` has blurred. Optical validators are trying to enforce mechanical rules instead of perceptual aesthetics.

---

## 2. Ratified Remediation Strategy: Formless Human-Grade Perception

The overhaul establishes the **Formless Human Perception Standard** across 4 canonical pillars:

1. **The Natural 3-Stage Human Eye Flow**:
   - Replaces all rigid 8-point checklists and bureaucratic rubrics with a natural human review:
     - **Stage 1: Immediate Visceral Impression**: Gut reaction in the first 3 seconds; orientation and affordance under the active persona.
     - **Stage 2: Responsive Narrative Walkthrough**: Comprehensive journey across Mobile (390px), Tablet (768px), Desktop (1440px), and Desktop-Wide (1920px), evaluating layout rhythm, text wrapping, and whitespace tension.
     - **Stage 3: Clear Verdict & Concrete Guidance**: Separating falsifiable blocking structural defects (Tier A) from non-blocking aesthetic polish notes (Tier B).
2. **The "4 + 2" Screenshot Payload Budget**:
   - Exactly 4 canonical viewports (`390px`, `768px`, `1440px`, `1920px`) plus at most 2 interaction slices per task ($\le 6$ images total), preventing context bloat.
3. **Lightweight Zero-OCR Doctor Interlock**:
   - Harness Doctor mechanically verifies distinct `view_file` calls for all 4 viewports, enforces a $\ge 250$ word depth floor, verifies cross-viewport narrative presence, and regex-bans checklist/JSON boilerplate in $< 5\text{ms}$.
4. **Falsifiable Defect Citation & Auto-Demotion**:
   - Blocking Tier A rejections strictly require named violation pairs (`[Element 1] + [Element 2] + [Physical Structural Violation]`).
   - Vague aesthetic complaints are automatically demoted to Tier B advisory notes, preventing defect inflation and infinite taste loops.
   - 3-strike deadlocks automatically escalate to the Tier 1 Orchestrator for arbitration.

---

## 3. Disjoint Implementation Tasks for Optimizer Orchestrator

```
┌────────────────────────────────────────────────────────────────────────┐
│                   DISJOINT WRITE SCOPE DECOMPOSITION                   │
├────────┬───────────────────────────────────┬───────────────────────────┤
│ Task   │ Target Files                      │ Scope Summary             │
├────────┼───────────────────────────────────┼───────────────────────────┤
│ Task 1 │ olt/agents/                       │ Update instructions,      │
│        │ ui-optical-validator.yaml         │ invariants, permissions,  │
│        │                                   │ and remove checklists.    │
├────────┼───────────────────────────────────┼───────────────────────────┤
│ Task 2 │ olt/scripts/src/reporting/doctor/ │ Implement zero-OCR        │
│        │ guidance.ts                       │ verifyOpticalReview() and │
│        │ olt/scripts/src/sentinel/         │ doctor checks in < 5ms.   │
├────────┼───────────────────────────────────┼───────────────────────────┤
│ Task 3 │ olt/scripts/src/agents/fleet/     │ Build prompt template &   │
│        │ contracts-tier3-quality-ui.ts     │ context isolation layer   │
│        │                                   │ for policy personas.      │
├────────┼───────────────────────────────────┼───────────────────────────┤
│ Task 4 │ olt/SKILL.md                      │ Purge legacy 8-dimension  │
│        │ AGENTS.md                         │ checklist references and  │
│        │ docs/olt/architecture/            │ replace with 3-Stage Flow.│
└────────┴───────────────────────────────────┴───────────────────────────┘
```

---

## 4. Verification & Quality Gates

1. **Manifest Linting**:
   - `bun harness.ts agent:check olt/agents/ui-optical-validator.yaml` passes with zero schema errors.
   - Verifies `can_execute_shell: false`, 0 edit permissions, and required invariants (`OPTICAL_ZERO_COMMAND_HARDLOCK`, `COGNITIVE_CODE_BLINDNESS_INVARIANT`, `FOUR_VIEWPORT_MANDATORY_INSPECTION`, `FORMLESS_HUMAN_PERCEPTION_MANDATE`, `TWO_TIER_DEFECT_SEPARATION_INVARIANT`).
2. **Doctor Verification Engine**:
   - `bun test tests/reporting/doctor/optical-review.test.ts` passes, verifying detection of:
     - Missing viewport image views.
     - Critiques with $< 250$ words.
     - Reviews lacking mobile/tablet/desktop discussion.
     - Banned checklist / JSON patterns.
3. **Legacy Cleanliness**:
   - `grep -rn "8 Optical Dimensions" olt/ docs/` returns zero active requirements (all converted to Formless Human Perception Standard).

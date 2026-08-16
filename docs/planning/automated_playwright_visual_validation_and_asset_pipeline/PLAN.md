# Automated Playwright Visual Validation, Dual-Channel Analysis & Telemetry Asset Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an automated headless Playwright visual validation harness with deterministic screenshot naming/overwrites, a dual-channel analysis engine (automated DOM metrics + visual screenshot inspection), and complete graph telemetry integration across `skills` and `gvui`.

**Architecture:** 
1. **Headless Playwright Visual Capture Engine (`gvui`)**: Fast headless Chromium visual test harness driving full user interactions (sidebar files, canvas zoom/pan, drawer tabs, quick filters, modals) across multi-viewport matrix (desktop 1280x800, tablet 768x1024, mobile 375x667), generating deterministically named screenshots (`<task>-<phase>-<component>-<viewport>.png`) with clean overwrite behavior and structured metric report (`visual-report.json`).
2. **Dual-Channel Validator Analysis & Invariant Engine (`skills`)**: Upstream validator protocol analyzing both automated DOM telemetry (overflow leaks, text clipping, stacking collisions) and empirical visual screenshots, ensuring complete cross-verification where one channel fills gaps in the other.
3. **Automated UI Task Mandate & Screenshot Ingestion Pipeline (`skills`)**: Automatic detection of UI scope in tasks, enforcing mandatory Playwright gate execution in `run:exec`, ingesting and symlinking screenshots into `.capsules/<run>/evidence/screenshots/` and `.capsules/<run>/reports/screenshots/`.
4. **Rich Telemetry Graph Asset Synthesis (`skills`)**: Telemetry crawler mapping visual assets and report findings into `node.mediaAssets`, `node.screenshots`, and `finding.screenshots` with exact dimensions, MIME types, and author metadata.
5. **Downstream GVUI Drawer & Lightbox Visualization (`gvui`)**: Enhancing `AssetsTab`, `ErrorInspector`, and `LightboxDialog` to seamlessly render captured visual assets with 100%/200% zoom, resolution badges, and finding correlation.

**Tech Stack:** TypeScript (strict, zero `any`), Bun, Playwright (Chromium headless), Rust/WASM layout engine, React 19, Vanilla CSS.

---

## Global Constraints

- Zero TypeScript `any` (`: any`, `as any`, generic defaults `T = any`, implicit `any`) across both repositories in source and test files.
- Zero lint/type suppression pragmas (`@ts-ignore`, `@ts-expect-error`, `eslint-disable`, `oxlint-disable`).
- Conventional Commits for every commit with imperative mood and <70 character subjects.
- Deterministic screenshot overwrite: Re-capturing the same component/phase must overwrite the file in place without creating orphan timestamped duplicates.
- Dual-channel fallback: If DOM metrics cannot detect an issue (e.g. subpixel glyph clipping, canvas rasterization), visual screenshot inspection must capture it, and vice versa.
- All test suites must maintain 100% pass rates across `skills` (816+ tests) and `gvui` (2,298+ tests, 288 layout matrix runs).

---

## Phase 1: Headless Playwright Visual Capture Engine in `gvui`

### Task 1.1: Visual Test Harness & Interaction Suite Scaffolding
**Files:**
- Create: `gvui/scripts/visual-capture.ts`
- Create: `gvui/src/testing/visual/playwrightVisualHarness.ts`
- Create: `gvui/src/testing/visual/visualMetricsCollector.ts`
- Modify: `gvui/package.json` (`"test:visual": "bun scripts/visual-capture.ts"`)
- Test: `gvui/src/testing/visual/visualMetricsCollector.test.ts`

**Interfaces:**
- `VisualCaptureOptions`: `{ viewports: ViewportConfig[], targetNodes?: string[], drawerTabs?: string[], outputDir: string, overwrite: boolean }`
- `VisualMetricsReport`: `{ timestamp: string, viewports: Record<string, ViewportMetrics>, layoutOverflows: OverflowViolation[], textClippings: ClippingViolation[], collisions: StackingViolation[] }`

- [ ] **Step 1: Write unit tests for `visualMetricsCollector`** asserting DOM overflow detection, text truncation calculation, and `z-index` collision auditing.
- [ ] **Step 2: Implement `visualMetricsCollector.ts`** executing in-browser evaluation scripts to measure client bounds vs scroll bounds, bounding box overlaps, and computed style contrast.
- [ ] **Step 3: Implement `playwrightVisualHarness.ts`** providing automated headless Chromium navigation, server readiness polling, and element targeting.
- [ ] **Step 4: Implement `scripts/visual-capture.ts`** driving interactions:
  - Phase 1: Left sidebar file selection and filter toggling
  - Phase 2: Canvas viewport rendering and reset (`R`)
  - Phase 3: Node selection and NodeDetailDrawer tabs (Overview, Findings, Assets, I/O)
  - Phase 4: Modal dialogs (Search Notes command palette, Lightbox)
- [ ] **Step 5: Implement deterministic naming and overwrite logic** (`${taskId}-${phase}-${component}-${viewport.name}.png`) ensuring existing files are overwritten cleanly.
- [ ] **Step 6: Run tests and verify clean execution**.

---

## Phase 2: Dual-Channel Validator Protocol & Automated UI Mandate in `skills`

### Task 2.1: Dual-Channel Analysis Protocol & UI Mandate in Validator Agent
**Files:**
- Modify: `skills/orchestrating-long-tasks/agents/validator.yaml`
- Modify: `skills/orchestrating-long-tasks/SKILL.md`
- Create: `skills/orchestrating-long-tasks/scripts/src/validation/dual-channel-analyzer.ts`
- Test: `skills/tests/unit/validation/dual-channel-analyzer.test.ts`

**Interfaces:**
- `DualChannelInput`: `{ metricsReport?: VisualMetricsReport, screenshotPaths: string[], domSnapshot?: string }`
- `DualChannelAuditResult`: `{ status: "pass" | "reject", findings: StructuredFinding[], crossChannelEvidence: CrossChannelProof[] }`

- [ ] **Step 1: Write unit tests for `dual-channel-analyzer.ts`** testing cross-channel synthesis (e.g. when metrics report is empty, analyzer inspects screenshot metadata and image dimensions; when screenshot is standard, analyzer validates metrics report).
- [ ] **Step 2: Implement `dual-channel-analyzer.ts`** verifying that UI validation findings correlate DOM bounding metrics with visual screenshot proofs.
- [ ] **Step 3: Update `validator.yaml` and `SKILL.md`** defining the mandatory dual-channel audit protocol:
  - Step 1: Claim validation lease.
  - Step 2: Execute gate proofs and `test:visual` via `run:exec`.
  - Step 3: Parse `visual-report.json` AND inspect captured screenshots.
  - Step 4: Cross-reference visual findings (overflow, clipping, stacking, responsiveness).
  - Step 5: Issue structured pushback (`task:reject`) with visual evidence or passing review (`task:review --status pass`).
- [ ] **Step 4: Run unit tests in `skills` and verify 100% pass**.

---

## Phase 3: Ingestion, Overwrite & Capsule Storage Pipeline in `skills`

### Task 3.1: Deterministic Screenshot Ingestion & Overwrite Management
**Files:**
- Modify: `skills/orchestrating-long-tasks/scripts/src/reporting/screenshot-ingestion.ts`
- Modify: `skills/orchestrating-long-tasks/scripts/src/reporting/screenshot-store.ts`
- Modify: `skills/orchestrating-long-tasks/scripts/src/cli/commands/run-ops.ts`
- Modify: `skills/orchestrating-long-tasks/scripts/src/cli/commands/task-review-support.ts`
- Test: `skills/tests/unit/cli/visual-validation.test.ts`
- Test: `skills/tests/unit/cli/visual-validation-boundaries.test.ts`

**Interfaces:**
- `IngestScreenshotsOptions`: `{ runRoot: string, taskId?: string, commandId?: string, searchDirs: string[], overwrite?: boolean }`

- [ ] **Step 1: Write unit tests for deterministic screenshot overwrite** asserting that when a screenshot with the same base name is re-ingested from a second run, the destination file is updated in-place and manifest indices remain deduplicated.
- [ ] **Step 2: Update `screenshot-ingestion.ts`** to support atomic overwrites and parse visual metric reports (`visual-report.json`) into capsule reports.
- [ ] **Step 3: Update `task-review-support.ts` and `run-ops.ts`** to ensure captured UI screenshots are automatically indexed under `.capsules/<run>/evidence/screenshots/` and `.capsules/<run>/reports/screenshots/`.
- [ ] **Step 4: Run visual validation test suites in `skills`**.

---

## Phase 4: Graph Summary Telemetry & Visual Asset Mapping in `skills`

### Task 4.1: Rich Visual Asset & Finding Screenshot Enrichment
**Files:**
- Modify: `skills/orchestrating-long-tasks/scripts/src/summary/asset-mapper.ts`
- Modify: `skills/orchestrating-long-tasks/scripts/src/summary/asset-mapper-playwright.ts`
- Modify: `skills/orchestrating-long-tasks/scripts/src/summary/asset-mapper-findings.ts`
- Modify: `skills/orchestrating-long-tasks/scripts/src/summary/graph-generator.ts`
- Test: `skills/tests/unit/summary/validator-finding-assets.test.ts`

**Interfaces:**
- `MediaAsset`: `{ id: string, type: "image" | "video" | "log", url: string, title: string, description?: string, mimeType: string, dimensions?: { width: number, height: number }, timestamp: string, author?: string }`

- [ ] **Step 1: Write unit tests in `validator-finding-assets.test.ts`** verifying that task and gate nodes automatically inherit ingested visual screenshots with correct dimensions, MIME types, and descriptions.
- [ ] **Step 2: Update `asset-mapper.ts` and `asset-mapper-findings.ts`** to recursively link ingested screenshots to task nodes, validator gate nodes, and structured findings.
- [ ] **Step 3: Update `graph-generator.ts`** to serialize non-empty `mediaAssets` and `screenshots` arrays on all UI task/gate nodes when visual evidence is present in the capsule.
- [ ] **Step 4: Run summary generator unit tests**.

---

## Phase 5: Downstream GVUI UI Integration & Visual Lightbox Verification

### Task 5.1: High-Fidelity Asset Inspection & Finding Lightbox in `gvui`
**Files:**
- Modify: `gvui/src/components/NodeDetailDrawer/tabs/AssetsTab.tsx`
- Modify: `gvui/src/components/NodeDetailDrawer/tabs/ErrorInspector.tsx`
- Modify: `gvui/src/components/NodeDetailDrawer/LightboxDialog.tsx`
- Modify: `gvui/src/components/NodeDetailDrawer/NodeDetailDrawer.css`
- Test: `gvui/src/components/NodeDetailDrawer/NodeDetailDrawer.test.tsx`

- [ ] **Step 1: Write component tests for `AssetsTab` and `ErrorInspector`** asserting proper rendering of relative capsule image URLs, resolution pills, download links, and Lightbox zoom controls.
- [ ] **Step 2: Update `AssetsTab.tsx`** to handle local and remote screenshot paths seamlessly with error fallbacks and aspect-ratio preservation.
- [ ] **Step 3: Update `ErrorInspector.tsx`** to display interactive finding screenshot thumbnails that open directly in the full-screen Lightbox.
- [ ] **Step 4: Update `LightboxDialog.tsx`** with responsive pan/zoom controls (100% / 200%) and keyboard shortcut navigation (`z`/`Z`, `Escape`).
- [ ] **Step 5: Run full `gvui` test suite and layout audit** to verify 100% pass and 0 regressions.

---

## Verification & Completion Gates

1. **Quality Gates in `skills`**:
   - `bun run typecheck` (0 errors)
   - `bun test:unit` & `bun test:all` (100% pass across all 816+ tests)
2. **Quality Gates in `gvui`**:
   - `bun run typecheck` (WASM build + TypeScript strict)
   - `bun test` (100% pass across 2,298+ tests)
   - `bun scripts/runLayoutAudit.ts` (100% pass across 288 runs, 0 failures, 0 leader lines)
   - `bun scripts/visual-capture.ts` (Headless Playwright capture generating clean overwritten screenshots)
3. **Git Release Compliance**:
   - Stage and commit under Conventional Commits with zero AI attribution.
   - Pushed to `origin/main` across both repositories with all pre-commit hooks passing legitimately.

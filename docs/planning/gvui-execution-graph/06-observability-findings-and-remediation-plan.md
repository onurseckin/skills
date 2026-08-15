# Observability System Research Findings & Remediation Plan

**Document**: `docs/planning/gvui-execution-graph/06-observability-findings-and-remediation-plan.md`  
**Date**: 2026-08-15  
**Status**: Planning / Alignment Mode (Zero Execution)

---

## 1. Overview & Objectives

This document captures the complete technical findings, root cause analyses, and proposed remediation architecture resulting from deep investigations conducted across:

1. Model attribution sources and authenticity.
2. Canvas rendering performance and frame-rate regressions.
3. Node internal layout, element collisions, and dimension math discrepancies.
4. Edge information section squishing and badge clipping.
5. Runtime environment and agent metadata extraction.

---

## 2. Deep Dive: Finding by Finding

### Finding 1: Model Attribution Sources & Authenticity

#### Problem Statement

Graphs displayed model names like `"Opus 5"`, `"Sonnet 5"`, `"Haiku 4.5"`, and `"Gemini 2.0 Flash"`, creating confusion around whether agentic runs were executing those models or whether the data was synthetic.

#### Exact Code Sources & Root Causes

1. **Static Demonstration Fixtures**:
   - Files: `public/data/graphs/research_judge_panel.json`, `public/data/graphs/bugfix_pr_run.json`, and `public/data/graphs/incident_response_live.json`.
   - **Root Cause**: These files are static benchmark fixtures created to test multi-model orchestration topologies. They explicitly declare Anthropic models to illustrate tiered architectures (e.g. Opus planning, Sonnet writing, Haiku probing).
2. **Generated Capsule Run Fallback**:
   - File: `skills/orchestrating-long-tasks/scripts/src/summary/graph-generator-helpers.ts:23-36`.
   - **Root Cause**: `detectHostModel()` checked `process.env.MODEL`, `process.env.AI_MODEL`, etc. When these environment variables were unset during local execution, it applied a hardcoded default: `{ model: "Gemini 2.0 Flash", tier: "s" }`.
   - The actual host environment is configured as `"Gemini 3.7 Flash (High)"` in `~/.gemini/antigravity-cli/settings.json`.

#### Remediation Architecture

- **Zero Fallback Fabrication**: Inspect `~/.gemini/antigravity-cli/settings.json` dynamically to resolve the authentic host model (`"Gemini 3.7 Flash (High)"`).
- **Telemetry-Driven Model Metadata**: Allow task submission reports to record the specific agent model if subagents run on distinct tiers. If unspecified, use the authentic host model.

---

### Finding 2: Canvas Rendering Performance Regression

#### Problem Statement

Graphs that previously rendered instantly experienced significant sluggishness, frame drops, and latency during initial load and interactive drag/pan/zoom.

#### Exact Code Sources & Root Causes

1. **Synchronous $O(E \times N)$ Collision Checks on Every Render Frame**:
   - File: `src/engine/GraphCanvas/GraphBadgeLayer.tsx:42-51` and `src/primitives/edges/GraphEdge/collision.ts`.
   - **Root Cause**: `computeSafeBadgePlacement()` was executed for every edge on every animation frame. For each edge, it scanned all $N$ nodes, generated up to 8 candidate escape boxes, and sorted them, allocating over 1,500 GC objects per frame.
   - **Key Finding**: The Rust/WASM layout engine already computes collision-free badge rectangles (`edge.badgeRect`, `edge.anchorPoint`, `edge.leaderPoints`). Re-running collision in React was completely redundant.
2. **Synchronous Disk Writes & Dataset Hashing on Every Drag Frame (60–120 FPS)**:
   - File: `src/engine/GraphCanvas/index.tsx:45-56`.
   - **Root Cause**: A `useEffect` listening to `[panOffset, zoomLevel]` ran `generateDatasetSignature(dataset)` (traversing and hashing all nodes/edges) and synchronous `localStorage.setItem()` on every pixel of mouse drag, locking the main thread.
3. **One-Shot Web Worker Spawning per Layout**:
   - File: `src/engine/layout/custom/customLayoutWorkerClient.ts:88-92, 143-145`.
   - **Root Cause**: A new `Worker` was created and terminated for each layout calculation, adding 50–150ms of script parsing and WASM initialization overhead per switch.

#### Remediation Architecture

1. **Direct Precomputed Badge Placement**: Use `edge.badgeRect` from the layout engine directly in `GraphBadgeLayer.tsx`.
2. **Debounced Viewport Persistence**: Debounce `saveStoredViewport` by 400ms or save on drag-end.
3. **Persistent Web Worker Singleton**: Maintain a long-lived Worker instance across layout requests.

---

### Finding 3: Node Internal Layout, Element Spacing & Math Discrepancies

#### Problem Statement

Inside node cards, elements lacked defined spaces: titles were crushed, descriptions left large empty vertical voids, and bottom chips overflowed or clipped.

#### Exact Code Sources & Root Causes

1. **Description Prose Line-Clamp vs Infinite Measurer**:
   - `nodeTemplate.ts:194` measured descriptions with `maxLines: Infinity`.
   - `NodeCardDescription.tsx:26` clamped descriptions to 2 lines (`-webkit-line-clamp: 2`).
   - **Impact**: On an 8-line description, the measurer allocated ~120px of height, while DOM rendered only ~30px, leaving a 90px empty void inside the card.
2. **Header Aside Flex Crushing Title**:
   - `NodeCardHeader.tsx:37` and `NodeCard.css:89-94`: `.node-card-header-aside` had `flex-shrink: 0`.
   - **Impact**: When Step + Model + Badge chips totaled ~250px, the aside consumed almost the entire card width, crushing `.node-card-title` to 0px.
3. **Ghost Rows Measured in Template**:
   - `nodeTemplate.ts` measured body badges (`selectBadges`) and up to 5 file chips (~595px width), but `NodeCard/index.tsx` does not render body badges and `NodeCardFiles.tsx` renders only 1 file summary chip.
4. **Mini-Chip Chrome Under-Measurement**:
   - `nodeTemplate.ts` used `itemChrome: 20`, whereas CSS padding (10px) + border (2px) + icon (11px) + gap (3px) = 26px. The 6px discrepancy per chip caused unpredicted line wrapping that overflowed the card height.

#### Remediation Architecture

1. **Synchronize Description Bounds**: Set `maxLines: 2` in `nodeTemplate.ts` to match `MAX_DESCRIPTION_LINES = 2`.
2. **Header Flex Alignment**: Set `flex: 1 1 auto; min-width: 0;` on `.node-card-header-main` and `flex-shrink: 1; max-width: 60%;` on `.node-card-header-aside`.
3. **Template Pruning**: Measure only elements that are actually rendered in the DOM. Update mini-chip `itemChrome` to 26px.

---

### Finding 4: Edge Badge Compactness & Clipped Information

#### Problem Statement

Edge information sections and badges appeared squished, truncated with `...`, or overly compact.

#### Exact Code Sources & Root Causes

1. **Multi-line Wrapping vs Single-line Render Conflict**:
   - `canvasMeasurer.ts:measureLabel` wrapped text across multiple narrow lines (e.g. 80px width).
   - `EdgeBadgeOverlay.tsx` rendered text on a single line (`white-space: nowrap`), resulting in 60% of the text being truncated.
2. **`customLayoutAdapter.ts` Incomplete Input**:
   - `buildEngineInputs` only measured `edge.label`, omitting `container.title`, `container.detail`, `stepNumber`, and `traffic`.
3. **Narrow `badgeRect` Overriding**:
   - `EdgeBadgeOverlay.tsx:155` used `width = badgeRect ? badgeRect.width : computedWidth`, discarding `computedWidth` if `badgeRect` was narrow.
4. **Missing Prop Forwarding in `GraphBadgeLayer.tsx`**:
   - `traffic`, `isHighTraffic`, and `bundleCount` were omitted when instantiating `EdgeBadgeOverlay`.

#### Remediation Architecture

1. **Single-Line Composite Label Measurement**: Measure composite badge text (`container.title ?? badge?.text ?? label`) on a single line with badge chrome (+32px).
2. **Defensive Badge Sizing**: Use `Math.max(badgeRect?.width ?? 0, computedWidth)` so badges never compress below their required UI width.
3. **Full Prop Forwarding**: Pass `traffic`, `isHighTraffic`, and `bundleCount` in `GraphBadgeLayer.tsx`.

---

### Finding 5: Runtime Environment & Metadata Authenticity

#### Problem Statement

Ensuring all execution metrics, durations, token estimations, and actor identities are 100% reality-grounded without any synthetic constants or fabricated strings.

#### Evidence On Disk

- Capsule `manifest.json`: Verified runtime versions, prompt hash, byte counts, and assurance.
- Capsule `events.jsonl`: Cryptographically chained event records with distinct actor tracking across Coordinator, Implementers, Validators, and Critic.
- Capsule `commands/<id>/record.json`: Exact binary paths, stdout/stderr byte counts, SHA-256 digests, execution durations, and exit codes.
- CLI Configuration `~/.gemini/antigravity-cli/settings.json`: Active model `"Gemini 3.7 Flash (High)"`.

#### Remediation Architecture

- Eliminate synthetic offsets (e.g. `+ tasks.length * 200`).
- Derive all metrics from disk evidence: `prompt_bytes`, `stdout_bytes`, `stderr_bytes`, and file churn stats.

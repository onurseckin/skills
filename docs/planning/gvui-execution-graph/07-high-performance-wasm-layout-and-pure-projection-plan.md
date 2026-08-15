# High-Performance WASM Layout & Pure Visual Projection Architecture

**Document**: `docs/planning/gvui-execution-graph/07-high-performance-wasm-layout-and-pure-projection-plan.md`  
**Date**: 2026-08-15  
**Status**: Planning & Architectural Specification (Zero Execution)

---

## 1. Executive Summary & Core Engineering Principle

The core architectural requirement is strict **separation of concerns**:

- **The Rust/WASM Engine** is the sole authority for all geometric computation: layer ranking, node coordinates, dynamic bounding boxes, collision-free badge placement, and cubic Bézier spline routing.
- **The React Rendering Layer** is a **pure visual projector**: it performs zero runtime collision loops, zero ad-hoc geometric sorting, and zero layout thrashing. It receives positioned coordinates and renders them directly at 120 FPS using GPU-accelerated CSS transforms.

---

## 2. The Architectural Pipeline: End-to-End Flow

```
[ASCII Architectural Flow: From Raw JSON to 120 FPS Canvas]

 ┌────────────────────────┐
 │ Raw Graph Dataset JSON │
 └───────────┬────────────┘
             │
             ▼
 ┌────────────────────────────────────────────────────────┐
 │ 1. Deterministic Text Measurement Pass (DOM/Canvas)    │
 │    • nodeTemplate.ts: Measures exact title (13px),     │
 │      2-line description (30px), mini-chips (26px chrome│
 │    • customLayoutAdapter.ts: Measures single-line      │
 │      composite edge badges (+32px chrome)              │
 └───────────┬────────────────────────────────────────────┘
             │
             ▼
 ┌────────────────────────────────────────────────────────┐
 │ 2. Persistent Rust/WASM v2 Layout Engine (Worker)      │
 │    • Rank Assignment: Longest path + Simplex DAG layer │
 │    • Crossing Minimization: Two-layer barycenter       │
 │    • Coordinate Assignment: Brandes-Köpf / Quadratic   │
 │    • Badge Clearance: Collision-free badgeRect + anchor│
 │    • Spline Routing: Obstacle-avoiding Bézier curves   │
 └───────────┬────────────────────────────────────────────┘
             │
             ▼
 ┌────────────────────────────────────────────────────────┐
 │ 3. Output Data Structures:                             │
 │    • PositionedNode: Exact [x, y, width, height]       │
 │    • PositionedEdge: path string, badgeRect, anchor    │
 └───────────┬────────────────────────────────────────────┘
             │
             ▼
 ┌────────────────────────────────────────────────────────┐
 │ 4. React Pure Visual Projection (Zero Math Overhead)   │
 │    • GraphSvgLayer: Direct SVG paths (<path d={path}/>)│
 │    • GraphHtmlLayer: Direct CSS positioned NodeCards   │
 │    • GraphBadgeLayer: Direct O(1) badge rendering at   │
 │      (badgeRect.x, badgeRect.y) with zero JS collision │
 │    • Camera Pan/Zoom: GPU transform3d (Zero state lag) │
 └────────────────────────────────────────────────────────┘
```

---

## 3. Node Dimension Bounds & Height Invariants

### A. Strict Dimensional Boundaries (Rust & TypeScript Configuration)

To give nodes full content flexibility without horizontal distortion or vertical compression:

```
+─────────────────────────────+───────────────────────────────────────+───────────────────────────────────────+
| Dimension Property          | Configured Value                      | Architectural Behavior                |
+─────────────────────────────+───────────────────────────────────────+───────────────────────────────────────+
| **Minimum Node Width**      | **`200px`** (was 180px)               | Ensures all headers, kind icons, and  |
|                             |                                       | step badges have clean baseline room. |
+─────────────────────────────+───────────────────────────────────────+───────────────────────────────────────+
| **Maximum Node Width**      | **`500px`** (was 420px)               | Allows wide titles, telemetry chips,  |
|                             |                                       | and multi-column tool badges.         |
+─────────────────────────────+───────────────────────────────────────+───────────────────────────────────────+
| **Minimum Node Height**     | **Unconstrained (Natural Content)**   | Fully dynamic based on rendered rows. |
+─────────────────────────────+───────────────────────────────────────+───────────────────────────────────────+
| **Maximum Node Height**     | **Unconstrained (NO Compression)**    | Height is NEVER compressed or capped. |
|                             |                                       | Tall multi-row cards receive full     |
|                             |                                       | vertical space in the Rust DAG layout.|
+─────────────────────────────+───────────────────────────────────────+───────────────────────────────────────+
```

### B. Node Layout & Box Model Invariants

1. **Title & Header Layout**:
   - Title Font Spec: `13px` font size, `600` weight, `18px` line-height (synchronized between `types.ts` and `NodeCard.css`).
   - Flex Rules: `.node-card-header-main` set to `flex: 1 1 auto; min-width: 0;`.
   - Aside Limits: `.node-card-header-aside` set to `flex-shrink: 1; max-width: 60%;` so metadata chips never crush the title.
2. **Uncompressed Vertical Row Accumulation**:
   - Total height is calculated as:
     `height = headerHeight (32px) + bodyPadding (12px) + ∑ (row.lineCount * row.lineHeight + rowGap)`
   - Every rendered row (description, mini-chips, tools, file churn, metrics) expands height dynamically with zero artificial limits.
3. **Mini-Chips & Files Row Synchronization**:
   - Mini-chips `itemChrome` updated to `26px` (10px horizontal padding + 2px border + 11px icon + 3px gap).
   - Files row measures only the single summary churn chip that is actually rendered in the DOM (`NodeCardFiles.tsx`).
   - Prunes phantom body badges that are not rendered in JSX.

### B. Single-Line Edge Badges & Clearance

1. **Measurement Input**:
   - In `customLayoutAdapter.ts`, pass composite text (`container.title ?? badge?.text ?? label`) into `measureLabel` with `maxLines: 1` and `+32px` chrome reservation.
2. **Rust Engine Routing Clearance**:
   - The Rust engine allocates routing space for the measured label width and outputs `edge.badgeRect`.
3. **Pure O(1) Badge Placement in React**:
   - `GraphBadgeLayer.tsx` places `EdgeBadgeOverlay` directly at `edge.badgeRect` (or `labelX, labelY`).
   - Replaces the entire runtime $O(E \times N)$ JavaScript geometric collision loop with $O(1)$ direct rendering.
   - `EdgeBadgeOverlay.tsx` uses `width = Math.max(badgeRect?.width ?? 0, computedWidth)` to prevent text squishing.

### C. Drag Frame Rate & Web Worker Lifecycle

1. **Debounced Viewport Persistence**:
   - `saveStoredViewport` and `generateDatasetSignature` in `GraphCanvas/index.tsx` are debounced to drag-end / 400ms idle.
   - Zero synchronous `localStorage.setItem()` disk writes or full-graph hashing during active mouse movement.
2. **Persistent Singleton Web Worker**:
   - `customLayoutWorkerClient.ts` retains a warm, shared `Worker` instance across layout calculations, eliminating the +150ms worker creation and WASM initialization overhead.

---

## 4. Expected Outcomes & Performance Benchmarks

| Metric                       | Target Post-Implementation                  | Prior Regressed State              |
| :--------------------------- | :------------------------------------------ | :--------------------------------- |
| **Pan / Zoom Frame Rate**    | **Solid 120 FPS** (~1.0 ms frame time)      | 25–40 FPS (~28 ms frame time)      |
| **Badge Collision Overhead** | **0.0 ms** (100% Rust WASM precalculated)   | 14.5 ms per frame (JS brute-force) |
| **Node Height Accuracy**     | **100% exact box match** (0px void space)   | 60–100px empty voids               |
| **Edge Text Visibility**     | **Full unclipped text** with traffic badges | 60% truncated with ellipses        |
| **Initial Load Latency**     | **< 15 ms** (Warm worker & cache reuse)     | 160–250 ms (Worker spawn churn)    |

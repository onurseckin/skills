# Streamlined Edge Information System & Static/Highlight Dynamics Plan

**Document**: `docs/planning/gvui-execution-graph/08-streamlined-edge-system-and-traffic-drawer-plan.md`  
**Date**: 2026-08-15  
**Status**: Approved Architecture & Locked Planning Specification  

---

## 1. Core Visual Principles: Static by Default, Animated on Highlight

### A. Clean, Standard Edge Lines (Zero Clutter)
1. **Static by Default**:
   - All edge lines and arrows on the canvas remain **static, clean, and understated**.
   - No distracting continuous background animations or multi-pattern circus lines when unselected.
2. **Cut-off Animated Dashes on Highlight / Selection Only**:
   - When a **Node or Edge is clicked / selected**:
     - The connected pathway edges activate **cut-off animated dashed lines** (`stroke-dasharray: 6,4` with CSS flow animation) in the active highlight accent color.
     - All other unselected / unrelated edges remain subtle, dimmed, and static.
3. **Standard Clean Arrowheads**:
   - Clean, standard filled directional arrowheads across all edges.

---

## 2. The Edge Information Container (The True Differentiator)

Rather than altering line geometry, the **Information Badge Container** carries the semantic difference:

```
[ASCII Clean Edge Information Container]

  ┌───────────┬──────────────────────────────────────────┐
  │     2     │ Dispatches Worker                        │ ◄── Clean typography,
  └───────────┴──────────────────────────────────────────┘     NO icons, NO tokens
        │                           │
        │                           └─ Action Title / Intent (color-accented border)
        └───────────────────────────── Pure Step Number (e.g. "2" or "3 -> 2", NO "Step" word)
```

### Canvas Invariants:
- **No Decorative Icons**: Removed from edge containers.
- **No Token Chips**: Tokens belong on Node Cards, not on connection lines.
- **Pure Numeric Step Badge**: `2`, `3`, or `3 -> 2` for cycles. Never uses the word `"Step"`.
- **Clickable**: Clicking the edge badge opens the **Edge Information Drawer**.

---

## 3. Dynamic Selection & Path Highlighting Behavior

```
[Default State: Static & Understated]
  [Node A] ────────────────────────────────────────► [Node B]
                 ┌───────────┬──────────────────┐
                 │     2     │ Dispatches Task  │
                 └───────────┴──────────────────┘
  (Clean solid static stroke, zero animation, subtle neutral/slate color)

[Highlighted State (When Node A, Node B, or the Edge is Clicked)]
  [Node A] ─ ─ ─ ► ─ ─ ─ ► ─ ─ ─ ► ─ ─ ─ ► ─ ─ ─ ► [Node B]
                 ┌───────────┬──────────────────┐
                 │     2     │ Dispatches Task  │
                 └───────────┴──────────────────┘
  (Vibrant accent color + active cut-off animated dashed line + opens Edge Drawer)
```

---

## 4. Edge Information Sidebar / Drawer (Inter-Node Communication)

Clicking any edge badge opens the sidebar with the deep inter-node communication trace:

```
[ASCII Edge Information Drawer]

┌─────────────────────────────────────────────────────────────────────────────┐
│ EDGE: worker-t02-measurer ◄──► validator-t02-measurer                       │
├─────────────────────────────────────────────────────────────────────────────┤
│ 📊 INTERACTION SUMMARY                                                      │
│ • Total Inter-Node Calls: 4 Times                                           │
│ • Active Steps: Step 2, Step 3, Step 4                                      │
│ • Calling Relationship: Implementer Work ◄──► Adversarial Validation Gate   │
├─────────────────────────────────────────────────────────────────────────────┤
│ 🔁 CHRONOLOGICAL CALL LOG & CONTEXT                                         │
│                                                                             │
│ 1. [Step 2] Submission ──► worker-t02 to validator-t02                      │
│    • Input Goal: Implement canvas measurer bounds & dynamic height          │
│    • Output Passed: Dynamic box calculations & template sync                │
│    • Files Transferred: src/engine/layout/measurement/canvasMeasurer.ts     │
│                                                                             │
│ 2. [Step 3] Rejection Pushback ──► validator-t02 to worker-t02              │
│    • Audit Finding: finding-T-02-reject (Critical Severity)                 │
│    • Context / Observation:                                                 │
│      "Need explicit regression verification on zero-width bounds."          │
│    • Required Remediation:                                                  │
│      "Defensively clamp non-positive width inputs in measurer."             │
│                                                                             │
│ 3. [Step 4] Repair Submission ──► worker-t02 to validator-t02               │
│    • Remediated Payload: Math.max(min, width) bounds clamp + test assertions│
│                                                                             │
│ 4. [Step 4] Approval Review ──► validator-t02 to gate-t02-measurer          │
│    • Verdict: PASS (Finding finding-T-02-reject RESOLVED)                   │
│    • Evidence: Monitored gate command exit code 0                           │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Summary of Implementation Actions

1. **`GraphEdge.css`**:
   - By default: All edge paths are **static** (no infinite keyframe animations running when unselected).
   - On `.is-highlighted` / `.selected`: Enable `stroke-dasharray: 6,4` with the animated dash-offset flow.
2. **`EdgeBadgeOverlay.tsx`**:
   - Strip icon rendering (`IconComp`).
   - Strip token chip rendering.
   - Ensure step badge renders pure numbers (`2`, `3 -> 2`).
3. **`EdgeDetailDrawer/index.tsx`**:
   - Top summary card: "Called X times across Steps Y, Z".
   - Structured In/Out payload context for every exchange.

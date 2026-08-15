# Node Archetypes, Canvas System & Step Navigation

**Document**: `03-node-archetypes-and-canvas-system.md`  
**Status**: Modular Planning Specification (Part 3 of 5)  
**Workspaces**: `skills` (`orchestrating-long-tasks`) & `gvui` (`graph-visualizer-ui`)  
**Line Bound**: Strictly $\le 500$ lines

---

## 1. Overview

To eliminate visual homogeneity, each node archetype is rendered with a distinct structural header, Tabler icon, accent color, and visible 2-line summary.

Edges carry rich interactive badge overlays, and a top navigation step scrubber enables progressive execution playback.

---

## 2. Differentiated Node Card Anatomy

Cards convey high-signal context directly on the canvas without requiring a click:

```
┌────────────────────────────────────────────────────────────────────────┐
│ [IconRobot] WORKER: T-02 (Update Auth Guard)      [Step 2] [Sonnet 4.5]│ <── Archetype Header
├────────────────────────────────────────────────────────────────────────┤
│ Rewrites JWT validation middleware to handle expired refresh tokens    │ <── 2-Line High-Signal
│ and persists refreshed session state.                                  │     Summary
├────────────────────────────────────────────────────────────────────────┤
│ [IconFolder] src/auth/ (+14, -2)  [IconClock] 1.4s  [IconShieldCheck]  │ <── Live Mini-Chips
└────────────────────────────────────────────────────────────────────────┘
```

### Archetype Visual Specifications

1. **`InputNode` (`kind: "input"`)**:
   - **Tabler Icon**: `IconTerminal2`
   - **Header Label**: `USER PROMPT` (Violet accent `#8b5cf6`)
   - **Body**: Distinct quote block previewing the verbatim user instruction (2 lines).
   - **Mini-Chips**: `Stdin (Verified)`, `4.1 KB`, `Step 1`.

2. **`OrchestratorNode` (`kind: "orchestrator"`)**:
   - **Tabler Icon**: `IconHierarchy2`
   - **Header Label**: `COORDINATOR` (Electric Blue `#3b82f6`)
   - **Body**: Decomposition objective, total task count, parallel wave count.
   - **Mini-Chips**: `13 Tasks`, `4 Waves`, `Step 1`.

3. **`AgentNode` (`kind: "agent"`)**:
   - **Tabler Icon**: `IconRobot`
   - **Header Label**: `WORKER: <TaskId>` (Cyan `#06b6d4`)
   - **Body**: High-level goal and implementation summary.
   - **Mini-Chips**: `src/auth/ (+14, -2)`, `Sonnet 4.5 [M]`, `1.4s`, `Step X`.

4. **`ToolNode` (`kind: "tool"`)**:
   - **Tabler Icon**: `IconCode`
   - **Header Label**: `CLI COMMAND` (Slate Dark `#64748b`)
   - **Body**: Monospace shell container with command line: `$ bun test tests/unit/auth.test.ts`.
   - **Mini-Chips**: `Exit: 0`, `142ms`, `Output: 1.2 KB`, `Step X`.

5. **`GateNode` (`kind: "gate"`)**:
   - **Tabler Icon**: `IconShieldCheck`
   - **Header Label**: `VALIDATOR GATE` (Amber `#f59e0b` / Emerald `#10b981`)
   - **Body**: Verification scope and required gate commands.
   - **Mini-Chips**: `agent-val`, `2/2 Passed`, `Step X+1`.

6. **`CriticNode` (`kind: "critic"`)**:
   - **Tabler Icon**: `IconScale`
   - **Header Label**: `COMPLETENESS CRITIC` (Gold `#d97706` / Indigo `#6366f1`)
   - **Body**: Holistic completeness proof audit and repository integrity check.
   - **Mini-Chips**: `Whole-Run Scope`, `0 Residual Risks`, `Approved`, `Step N`.

7. **`TerminalNode` (`kind: "terminal"`)**:
   - **Tabler Icon**: `IconFlagCheckered`
   - **Header Label**: `SEALED OUTCOME` (Emerald `#059669`)
   - **Body**: Final run status, sealed capsule hash, and total compute time.
   - **Mini-Chips**: `Status: Complete`, `Wall: 42s`, `Tokens: 19.4k`, `Step N+1`.

---

## 3. Rich Edge Semantics & Interactive Overlays

Edges carry rich interactive badge overlays along their spline curves:

```
[Agent: T-01] ─────────────── (Sequence: Submit) ───────────────► [Gate: T-01]
      ▲                                                                │
      │                                                                │
      └────── [IconAlertCircle] PUSHBACK: Round 1 (1 Finding) ─────────┘
                 (Loop Edge: Amber Dashed + Reverse Particle)
```

```typescript
export interface GraphEdgeData {
  id: string;
  source: string;
  target: string;
  kind?: "sequence" | "spawn" | "loop" | "conditional" | "data" | "fallback" | "join";
  label?: string;
  badge?: {
    text: string;
    variant?: "info" | "warning" | "error" | "success" | "neutral";
    icon?: string; // Tabler icon name
    clickable?: boolean;
    targetTab?: "overview" | "io" | "files" | "commands" | "feedback";
  };
  condition?: string;
  handoff?: {
    kind: "prompt" | "full-context" | "summary" | "artifact" | "decision" | "file";
    summary?: string;
    tokens?: number;
  };
  weight?: number;
}
```

### Edge Archetype Visuals:

- **`loop` (Feedback Pushback)**: Thick amber/red dashed spline with pulsating reverse particle animation. Badge: `[IconAlertCircle] Pushback: Round X (Y Findings) ↳ Re-assigned`. Clicking opens Tab 5 (_Feedback_).
- **`spawn`**: Blue dotted spline with `[IconRocket] Dispatches Worker` badge.
- **`sequence`**: Solid forward spline with `[IconArrowRight] Submit for Review` badge.
- **`data`**: Emerald dash-dotted spline with `[IconFileText] Evidence: +14, -2 lines` badge.

---

## 4. Top Navigation Bar & Step Scrubber

A sticky glassmorphic navigation bar sits at the top of the canvas:

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│ [IconChartDots] Run: 2026-08-14-gvui-integration  [All Steps] [Step 1] [Step 2] [Step 3]    │
│ Filters: [All Kinds v] [All Statuses v]   [IconPlayerPlay] Playback (1x)   [IconSearch] ... │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

1. **Step Filter Pills**:
   - `[All Steps]` — Renders all nodes in normal state.
   - `[Step 1: Setup & Planning]` — Spotlights Step 1 nodes; dims all others.
   - `[Step 2: Wave 1 Tasks]` — Spotlights parallel Wave 1 tasks.
   - `[Step 3: Wave 1 Validation]` — Spotlights Wave 1 validation gates.
2. **Progressive Playback Animation**:
   - Clicking `[IconPlayerPlay] Playback` (0.5x, 1x, 2x speeds) walks through steps $1 \dots N$ sequentially, illustrating the chronological flow of the multi-agent run.
3. **Causal Lineage Spotlight**:
   - Clicking any node highlights its upstream ancestors and downstream consequences with a distinct accent glow.

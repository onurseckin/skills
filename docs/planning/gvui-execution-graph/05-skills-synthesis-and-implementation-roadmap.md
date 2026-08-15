# Synthesis Engine, Data Contracts & Implementation Roadmap

**Document**: `05-skills-synthesis-and-implementation-roadmap.md`  
**Status**: Authoritative Planning Specification (Part 5 of 5)  
**Workspaces**: `skills` (`orchestrating-long-tasks`) & `gvui` (`graph-visualizer-ui`)  
**Line Bound**: Strictly $\le 500$ lines

---

## 1. Summary Synthesis Pipeline in `skills`

The deterministic summary engine in `skills/orchestrating-long-tasks/scripts/src/summary/` compiles runtime state into rich `GraphDataset` objects in $< 50\text{ms}$:

```typescript
export interface GraphNodeData {
  id: string;
  name: string;
  kind?: "input" | "orchestrator" | "agent" | "tool" | "gate" | "critic" | "router" | "terminal";
  status?: "pending" | "running" | "success" | "warning" | "error" | "skipped";
  step?: number;
  stepLabel?: string;
  model?: string;
  tier?: "xs" | "s" | "m" | "l";
  description?: string;
  files?: Array<{
    path: string;
    mode: "read" | "write" | "attach";
    additions?: number;
    deletions?: number;
  }>;
  io?: {
    inputs?: Array<{ kind: string; label: string; preview?: string; tokens?: number }>;
    outputs?: Array<{ kind: string; label: string; preview?: string; tokens?: number }>;
  };
  metadata?: Record<string, unknown>;
}

export interface GraphEdgeData {
  id: string;
  source: string;
  target: string;
  kind?: "sequence" | "spawn" | "loop" | "conditional" | "data" | "fallback" | "join";
  stepNumber?: number | string;
  label?: string;
  container?: {
    stepBadge: string;
    title: string;
    detail?: string;
    variant: "info" | "warning" | "error" | "success" | "neutral" | "cyan";
    icon?: string;
  };
  isCycle?: boolean;
}
```

---

## 2. Implementation File Matrix across Repositories

### Group A: `skills` Repository (`/Users/onurseckinsenoglu/repos/skills`)
1. **`src/summary/types.ts`**: Update contracts for `GraphNodeData`, `GraphEdgeData`, `container`, `stepNumber`, `additions`, `deletions`.
2. **`src/summary/step-calculator.ts`**: Topological wave-to-step computation with explicit step numbers.
3. **`src/summary/graph-generator.ts`**: Emits the 7+ node archetypes, diamond routers, rich edge containers, and unclipped I/O streams.
4. **Unit Tests**: `tests/unit/summary/` (100% pass rate).

### Group B: `gvui` Repository (`/Users/onurseckinsenoglu/repos/gvui`)
1. **`src/types/graphData.ts`**: Mirror all extended node/edge properties.
2. **`src/primitives/nodes/NodeCard/`**:
   - Distinct geometric card components for each archetype (Input stadium, Tool monospace console, Agent worker card, Gate shield, Critic certificate, Decision diamond, Terminal capsule).
   - Prominent Step Number badges (`[Step 1]`, `[Step 2]`, `[Step 3]`) on every card.
   - Clean sub-element chips (`+900, -300 lines in 4 files`).
3. **`src/primitives/edges/GraphEdge/` & `EdgeBadgeOverlay.tsx`**:
   - Rich Edge Information Containers with top-corner Step badges (`[7]`, `[3 → 4]`).
   - Pulsating reverse dash animations for pushback loops.
4. **Top Navigation Bar (`src/components/Controls/` & `src/engine/GraphCanvas/`)**:
   - `Steps [▼]` Dropdown with multi-select checkboxes, Select/Clear All, and Playback controls.
5. **Detail Drawer (`src/components/NodeDetailDrawer/`)**:
   - Expanded 560px–680px width.
   - Dynamic adaptive tabs with zero overflow.
   - Deep sub-view panels (Overview, I/O, File Tree & Diff Viewer, CLI Terminal, Feedback Accordion, Raw JSON).
6. **Dynamic Highlighter (`src/engine/GraphCanvas/`)**:
   - Illuminates connected edges and ancestor/descendant pathways with the selected node's dominant accent color.
7. **Unit & Integration Tests**: Run `bun test` in `gvui` (100% pass rate).

---

## 3. Visual UI/UX Validation Gate with Chrome MCP
- Prior to declaring completion, validator agents will use **Chrome DevTools MCP** (`navigate_page`, `take_screenshot`) to visually audit the rendered application in a real browser session, verifying:
  - Removal of left-side colored strips and status circles.
  - Distinct geometric silhouettes per archetype.
  - Step numbers on nodes and edge containers.
  - Clean `Steps [▼]` dropdown in the top navbar.
  - Flawless drawer layout with syntax-highlighted diffs and zero tab header overflow.

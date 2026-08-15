# Edge Information Containers & Dynamic Canvas Highlighting

**Document**: `03-edge-containers-and-dynamic-highlighter.md`  
**Status**: Authoritative Planning Specification (Part 3 of 5)  
**Workspaces**: `skills` (`orchestrating-long-tasks`) & `gvui` (`graph-visualizer-ui`)  
**Line Bound**: Strictly $\le 500$ lines

---

## 1. Rich Edge Information Containers (Beyond Simple Badges)

Edges are not just lines with simple labels. They are **rich communicative containers** positioned along spline curves that tell the chronological story of the handoff:

```
[Step 2: Worker T-02]
         │
         │  ┌────────────────────────────────────────────────────────┐
         └──┤ [3] Step 2 ──► Step 3 : Submits Diff (+900, -300 lines) │
            └────────────────────────┬───────────────────────────────┘
                                     │
                                     ▼
                          [Step 3: Validator Gate-02]
                                     │
         ┌───────────────────────────┴───────────────────────────────┐
         │ [4] ❌ PUSHBACK: "Missing expired token test" (Round 1)   │
         │ (Reverse pulsating amber dashed spline)                   │
         └───────────────────────────┬───────────────────────────────┘
                                     │
                                     ▼
                          [Step 4: Worker T-02 (Repair)]
```

### 1.1 Anatomy of the Edge Information Container

```typescript
export interface GraphEdgeData {
  id: string;
  source: string;
  target: string;
  kind?: "sequence" | "spawn" | "loop" | "conditional" | "data" | "fallback" | "join";
  stepNumber?: number | string; // e.g. 7, "3 -> 4"
  label?: string;
  container?: {
    stepBadge: string;          // e.g. "3", "7", "3 -> 4"
    title: string;              // e.g. "Submits Implementation", "Validator Pushback"
    detail?: string;            // e.g. "Diff: +900, -300 lines", "1 Finding"
    variant: "info" | "warning" | "error" | "success" | "neutral" | "cyan";
    icon?: string;              // Tabler icon identifier
  };
  isCycle?: boolean;
}
```

- **Top-Left Step Number Pill**: Every edge information container prominently displays its **Step Number** (e.g. `[7]` or `[3 → 4]`).
- **Context Body**: Tells the viewer what was transferred (e.g. `Diff: +900, -300 lines`, `Dispatches Worker Lease`, `Approved: 2/2 Gates`).
- **Minimal Fallback**: If an edge has no custom textual context, it at least cleanly displays the step number badge `[7]`.

---

## 2. Dynamic Canvas Path Highlighting

### 2.1 The Visual Highlighting Problem
In a large graph with 30+ nodes, clicking a node shouldn't just highlight one box with a static border. The viewer wants to see the **causal flow**: where did this node come from, and what downstream nodes did it influence?

### 2.2 Dynamic Accent Illumination Algorithm

When a node is selected on the canvas:
1. **Dominant Accent Color Inheritance**:
   - The selected node's primary archetype accent color (e.g. Cyan for Worker, Violet for Prompt, Amber for Gate, Electric Blue for Planner) becomes the **Active Accent Hue**.
2. **Path Illumination**:
   - All **upstream incoming edges** and **parent ancestor nodes** are illuminated with a bright highlight in the Active Accent Color.
   - All **downstream outgoing edges** and **child descendant nodes** are illuminated with a secondary glow in the Active Accent Color.
3. **Canvas Dimming**:
   - All unrelated nodes and edges fade to a subtle 20% opacity against the dark background, instantly spotlighting the active execution path.
4. **Interactive Hover Feedback**:
   - Hovering an edge highlights the connected source and target nodes with that edge's variant color.

---

## 3. Dark Mode Palette & Contrast Matrix

All colors are meticulously tuned for dark mode canvas contrast:

| Entity Type | Accent Hue | Stroke Color (Dark Canvas) | Container Background |
| :--- | :--- | :--- | :--- |
| **Prompt (`input`)** | Royal Violet | `#a78bfa` (Violet 400) | `#1e1533` (Deep Violet Black) |
| **Planner (`orchestrator`)** | Sapphire Blue | `#60a5fa` (Blue 400) | `#0f1d38` (Deep Blue Black) |
| **Worker (`agent`)** | Cyan / Teal | `#22d3ee` (Cyan 400) | `#09222c` (Deep Cyan Black) |
| **Tool (`tool`)** | Slate Dark | `#94a3b8` (Slate 400) | `#0a0e17` (Monospace Jet Black) |
| **Router (`router`)** | Amber Gold | `#fcd34d` (Amber 300) | `#261a08` (Deep Amber Black) |
| **Gate (`gate`)** | Emerald / Orange | `#34d399` / `#fb923c` | `#0d281e` / `#2b1408` |
| **Critic (`critic`)** | Indigo Gold | `#818cf8` / `#f59e0b` | `#1a1638` |
| **Terminal (`terminal`)** | Emerald Seal | `#10b981` (Emerald 500) | `#062419` |
| **Pushback Loop** | Crimson Amber | `#f87171` (Red 400) | `#2a0e14` (Pulsating reverse dashes) |

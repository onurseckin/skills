# Adaptive Polymorphic Detail Drawer & Top Navigation Dropdown

**Document**: `04-adaptive-polymorphic-drawer-and-sections.md`  
**Status**: Authoritative Planning Specification (Part 4 of 5)  
**Workspaces**: `skills` (`orchestrating-long-tasks`) & `gvui` (`graph-visualizer-ui`)  
**Line Bound**: Strictly $\le 500$ lines

---

## 1. Top Navigation Bar: Steps Dropdown & Playback Controller

To keep the graph canvas clean and uncluttered, all step navigation and playback controls are located inside the **Top Navigation Bar**.

```
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│ [IconChartDots] 2026-08-14-gvui-run   Steps [▼] (3/7 Active)   [IconPlayerPlay]   Search... │
└───────────────────────────────────────────┬──────────────────────────────────────────────────┘
                                            │ (Expanded Dropdown)
                                            ▼
                    ┌────────────────────────────────────────────────────┐
                    │ 📋 EXECUTION STEPS                                 │
                    │ [Select All]   [Clear All]                         │
                    ├────────────────────────────────────────────────────┤
                    │ ☑ [1] Step 1: User Prompt & Planning               │
                    │ ☑ [2] Step 2: Wave 1 Tasks (Auth & Core Engine)    │
                    │ ☑ [3] Step 3: Wave 1 Validation Gates              │
                    │ ☐ [4] Step 4: Wave 2 Tasks (UI & Integration)      │
                    │ ☐ [5] Step 5: Wave 2 Validation Gates              │
                    │ ☐ [6] Step 6: Completeness Critic Audit            │
                    │ ☐ [7] Step 7: Sealed Run Outcome                   │
                    ├────────────────────────────────────────────────────┤
                    │ ⏯️ Playback: [Play] [Pause]   Speed: [0.5x] [1x] [2x]│
                    └────────────────────────────────────────────────────┘
```

### Top Nav Dropdown Features:
1. **Multi-Select Checkboxes**: Check or uncheck individual steps to filter and highlight nodes on the canvas.
2. **Global Toggles**: "Select All" and "Clear All" buttons for instant batch selection.
3. **Playback Animation**: Integrated Play/Pause and speed multiplier (0.5x, 1x, 2x) to animate the graph chronologically step by step.

---

## 2. Expanded Detail Drawer (Sidebar Architecture)

The sidebar expands to **560px** (resizable up to **680px**) to give code diffs and terminal streams comfortable breathing room:

```
┌─────────────────────────────────────────────────────────────┐
│ 1. DRAWER TOP HEADER                                    [X] │
│    [IconRobot] WORKER NODE : T-02 (Update Auth Guard)       │
│    Ribbon: [Step 2] [Sonnet 4.5] [3 Rounds (2 Pushbacks)]   │
├─────────────────────────────────────────────────────────────┤
│ 2. ADAPTIVE TAB BAR (Wrapped & Auto-Hiding Empty Tabs)      │
│    [Overview]  [I/O (2)]  [Files (4)]  [Commands (2)]  ...  │
├─────────────────────────────────────────────────────────────┤
│ 3. ACTIVE TAB CONTENT VIEW                                  │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Detailed Tab Sub-Views

### 3.1 Overview Tab (Unclipped Purpose & Operational Context)
- **Full Purpose Text**: The complete, unclipped task specification or user prompt.
- **Operational Grid**: Write scopes, lease agent ID, start/finish timestamps, wall duration, active compute time.
- **Causal Lineage**: Triggered by parent node(s) $\to$ Unblocks downstream task(s).

### 3.2 Inputs & Outputs (I/O) Tab
- **Incoming Payloads**:
  - `[IconTerminal2] Prompt`: Verbatim prompt / instructions (token count, originating node).
  - `[IconFile] Input Context`: Ingested file references and configurations.
- **Outgoing Payloads**:
  - `[IconFileText] Submission Report`: Detailed implementation report and decision rationales.

### 3.3 Files & Diffs Tab
- **File Churn Bar**: `4 files modified (+900, -300 lines)`.
- **Interactive File Tree**: Grouped by directory hierarchy with fuzzy search filtering.
- **Unified Diff Inspector**: Full syntax-highlighted code diffs with line numbers and addition/deletion highlighting.

### 3.4 Commands & Tools Tab
- **Terminal Window Accordion**:
  - Command Header: `$ bun test tests/unit/summary/graph-generator.test.ts` with `[Exit 0]` badge and execution time (`142ms`).
  - Terminal Window Body: Full monospace `stdout` and `stderr` streams with a one-click copy button.

### 3.5 Feedback & Quality Reviews Tab (Polymorphic)
- **Multi-Round Pushback Accordion**:
  - *Round 1 (Rejected)*:
    - Validator Observation: `"Missing edge-case unit test for expired token refresh"`.
    - Severity: `Important`.
    - Failed Test Stack Trace.
    - Remediation Prompt.
  - *Round 2 (Approved)*:
    - Implementer Fix Note: `"Added test in auth-expired.test.ts (+14 lines)"`.
    - Passing Gate Proof: `bun test` passed cleanly with exit code `0`.

### 3.6 Raw Provenance Tab
- **Merkle Event Chain Link**: Transaction hash in `events.jsonl`.
- **Raw JSON Viewer**: Collapsible JSON definition of the `GraphNodeData` object.

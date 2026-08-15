# Universal Polymorphic Detail Drawer Specification

**Document**: `04-universal-polymorphic-drawer.md`  
**Status**: Modular Planning Specification (Part 4 of 5)  
**Workspaces**: `skills` (`orchestrating-long-tasks`) & `gvui` (`graph-visualizer-ui`)  
**Line Bound**: Strictly $\le 500$ lines

---

## 1. Overview & Key Enhancements

The right-hand inspection drawer is upgraded with:
1. **Expanded Width**: Width increased to **560px** (resizable up to **680px**) to comfortably display code diffs, logs, and I/O previews without cramped wrapping.
2. **Adaptive Dynamic Tabs**: Tabs dynamically adapt to the selected node archetype. Empty sections are automatically hidden (e.g. no Files tab if no files were touched).
3. **Dynamic Header & Archetype Titles**: Header displays the exact archetype badge and full unclipped node title.
4. **Strict Tabler Icons**: Clean, systematic Tabler icons across all tab triggers and section headers.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ [IconRobot] WORKER: node-task-T-02 (Update Auth Guard)                      │
│ Status: [Success]  Model: [Sonnet 4.5 (M)]  Step: [Step 2]  Duration: [1.4s]│
├─────────────────────────────────────────────────────────────────────────────┤
│ [IconInfo] Overview  [IconArrows] I/O (2)  [IconFiles] Files (2)  ...       │
├─────────────────────────────────────────────────────────────────────────────┤
│ 📋 Task Purpose & Scope:                                                    │
│   Full unclipped goal description and implementation requirements.          │
│   • Write Scopes: src/auth/                                                 │
│   • Lease Agent: worker-agent-01 (Lease duration: 300s)                     │
│   • Active Compute: 890ms | Retries: 0                                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Adaptive Tab Visibility Matrix

Tabs conditionally render based on payload availability, ensuring zero empty states:

| Tab Name | Tabler Icon | Render Condition | Content Provided |
| :--- | :--- | :--- | :--- |
| **1. Overview** | `IconInfoCircle` | Always rendered | Unclipped purpose, goals, model tier, status, step #, duration, write scopes, and parent/child lineage. |
| **2. Inputs & Outputs (I/O)** | `IconArrowsExchange` | Rendered if `node.io` has inputs or outputs | Expandable cards for each I/O stream with payload types, token sizes, source/target nodes, and full preview text. |
| **3. Files & Diffs** | `IconFiles` | Rendered only if `node.files` has $\ge 1$ entry | Touched file paths with addition/deletion chips and expandable syntax-highlighted unified diff views. |
| **4. Executions** | `IconTerminal` | Rendered only if `metadata.commands` has $\ge 1$ entry | Monitored CLI commands with working directory, duration, exit code, and terminal-style expandable stdout/stderr. |
| **5. Feedback & Reviews** | `IconShieldSearch` | Rendered if findings, reviews, or critic proofs exist | Polymorphic panel: validator pushbacks, finding details, remediation plans, and passing gate records. |
| **6. Raw Provenance** | `IconBinary` | Always rendered (collapsible) | Merkle event chain links and full node JSON. |

---

## 3. Tab Sub-View Specifications

### Tab 1: Overview & Context
- **Archetype Banner**: Displays archetype badge, model tier chip, and execution status pill.
- **Full Purpose Text**: Complete, unclipped task description or verbatim user prompt.
- **Operational Metadata Grid**:
  - `Write Scopes`: File/directory boundaries.
  - `Lease Identity`: Agent identifier and lease duration.
  - `Duration Metrics`: Wall-clock duration and active compute time.
  - `Lineage`: Direct parent trigger and downstream dependencies.

### Tab 2: Inputs & Outputs (I/O)
- **Input Stream Cards**:
  - Payload Kind Badge: `[IconTerminal] Prompt`, `[IconFile] File`, `[IconPackage] Artifact`.
  - Originating Node Reference.
  - Token Count Chip.
  - Full, scrollable payload preview.
- **Output Stream Cards**:
  - Payload Kind Badge: `[IconFileText] Submission Report`, `[IconCheck] Decision`.
  - Destination Node Reference.
  - Full output body.

### Tab 3: Files & Diffs Inspector
- **Summary Bar**: Total files touched, total line additions ($+$), and deletions ($-$).
- **File List with Tree View**: Grouped by directory hierarchy with search filter.
- **Diff Viewer**: Syntax-highlighted unified diff inspector with line numbers and copy-diff button.

### Tab 4: Executions & Command Terminal
- **Command List**: Each executed command renders as a terminal card:
  - Header: Exit code badge (`[IconCheck] Exit 0` / `[IconX] Exit 1`), execution duration (`142ms`), actor ID.
  - Monospace Command Line: `$ bun test tests/unit/auth.test.ts`
  - Collapsible Stdout / Stderr streams with syntax highlighting and copy-log trigger.

### Tab 5: Feedback, Pushbacks & Quality Reviews (Polymorphic)
- **Multi-Round Pushback Accordion**:
  - *Round 1 (Rejected)*:
    - Finding List: Observation, severity badge (`Critical` / `Important`), remediation instructions.
    - Failed Gate Output: Test failure stack trace.
  - *Round 2 (Re-validation)*:
    - Implementer Fix Notes & Incremental Diff.
    - Validator Sign-off Verdict (`[IconCheck] Approved`).
- **Completeness Critic Scorecard**:
  - Authority token digest, verified readiness hash, residual risks assessment ($0$), and whole-run gate proofs.

### Tab 6: Raw Provenance & Event Chain
- **Merkle Event Proof**: Hash of the triggering event in `events.jsonl`.
- **Raw JSON Viewer**: Collapsible, syntax-highlighted JSON viewer of the complete `GraphNodeData` object.

# Node Shapes, Flowchart Geometry & Sub-Element Taxonomy

**Document**: `02-node-shapes-and-visual-flowchart-taxonomy.md`  
**Status**: Authoritative Planning Specification (Part 2 of 5)  
**Workspaces**: `skills` (`orchestrating-long-tasks`) & `gvui` (`graph-visualizer-ui`)  
**Line Bound**: Strictly $\le 500$ lines

---

## 1. Node Geometric Shapes & Visual Silhouettes

Nodes do not have to be uniform rectangles. Different entities earn distinct geometric silhouettes:

```
┌─────────────────────────┐          ◇ DIAMOND ROUTER ◇
│  📥 USER PROMPT STADIUM  │          (Decision / Branching)
│  (Rounded 12px pill)    │          
└─────────────────────────┘          
                                     ┌─────────────────────────┐
┌─────────────────────────┐          │  🛡️ VALIDATOR CHECKPOINT │
│  💻 MONOSPACE CLI TOOL  │          │  (Chamfered Top Corners)│
│  (Terminal Window Box)  │          └─────────────────────────┘
└─────────────────────────┘          
                                     ┌─────────────────────────┐
┌─────────────────────────┐          │  ⚖️ CRITIC CERTIFICATE  │
│  🤖 AGENT WORKER CARD   │          │  (Double-Bordered Frame)│
│  (Squared + Model Chip) │          └─────────────────────────┘
└─────────────────────────┘
```

### 1.1 Detailed Node Archetype Geometries

1. **User Prompt (`kind: "input"`)**:
   - **Shape**: Rounded Stadium / Chat Entry Capsule (`border-radius: 12px`).
   - **Visual Metaphor**: Quoted external instruction.
   - **On-Card Fields**: `[IconTerminal2] USER PROMPT`, `[Step 1]`, 2-line quoted excerpt, prompt length (`4.1 KB`).
   - **Accent Color**: Deep Royal Violet (`#8b5cf6`).

2. **Coordinator Plan (`kind: "orchestrator"`)**:
   - **Shape**: Wide Structured Dispatch Manifest Board.
   - **Visual Metaphor**: Mission control project board.
   - **On-Card Fields**: `[IconHierarchy2] COORDINATOR PLAN`, `[Step 1]`, plan goal, total tasks (`13 Tasks`), wave count (`4 Waves`).
   - **Accent Color**: Electric Sapphire (`#3b82f6`).

3. **Autonomous Worker Agent (`kind: "agent"`)**:
   - **Shape**: Clean Worker Card with embedded Model Tier Chip (`[Sonnet 4.5]`).
   - **Visual Metaphor**: Cognitive agent worker.
   - **On-Card Fields**: `[IconRobot] WORKER: T-02`, `[Step X]`, 2-line action goal, line churn summary (`+900, -300 lines in 4 files`), duration (`1.4s`).
   - **Accent Color**: Cyan / Teal (`#06b6d4`).

4. **CLI Command & Tool Call (`kind: "tool"`)**:
   - **Shape**: Dark Monospace Terminal Box with top console bar.
   - **Visual Metaphor**: A native shell terminal window.
   - **On-Card Fields**: `[IconCode] CLI COMMAND`, `[Step X]`, command line `$ bun test ...`, exit code chip (`Exit 0`), execution duration (`142ms`).
   - **Accent Color**: Monospace Slate Dark (`#64748b` / `#0f172a`).

5. **Decision / Branching Router (`kind: "router"`)**:
   - **Shape**: **Flowchart Diamond (`rotate(45deg)` container or SVG diamond path)**.
   - **Visual Metaphor**: Conditional branch / decision gateway.
   - **On-Card Fields**: `[IconGitBranch] ROUTER`, Decision condition (`"Tests Pass? Yes/No"`), Step number.
   - **Accent Color**: Amber Gold (`#f59e0b`).

6. **Validator Gate Checkpoint (`kind: "gate"`)**:
   - **Shape**: Chamfered Shield Checkpoint (cut 45-degree top corners).
   - **Visual Metaphor**: Quality assurance security gate.
   - **On-Card Fields**: `[IconShieldCheck] VALIDATOR GATE`, `[Step X+1]`, target test suites, gate verdict (`Passed` / `Pushback: 1 Finding`), repair round count.
   - **Accent Color**: Emerald Green (`#10b981`) on pass / Orange-Red (`#ef4444`) on pushback.

7. **Completeness Critic (`kind: "critic"`)**:
   - **Shape**: Double-Bordered Formal Audit Scorecard.
   - **Visual Metaphor**: Official whole-run audit certificate.
   - **On-Card Fields**: `[IconScale] COMPLETENESS CRITIC`, `[Step N]`, whole-run verification scorecard (`13/13 Verified, 0 Residual Risks`), authority token digest.
   - **Accent Color**: Deep Indigo / Metallic Gold (`#6366f1` / `#d97706`).

8. **Terminal Outcome (`kind: "terminal"`)**:
   - **Shape**: Compact Hexagonal / Pill End-Cap.
   - **Visual Metaphor**: Final sealed run lockbox.
   - **On-Card Fields**: `[IconFlagCheckered] SEALED OUTCOME`, `[Step N+1]`, final status, total wall clock (`42s`), total tokens (`19.4k`).
   - **Accent Color**: Emerald Green (`#059669`).

---

## 2. Node Sub-Element Taxonomy (Condensed Card vs Expanded Drawer)

To prevent visual clutter, node cards on the canvas show high-signal summary metrics, while the expanded sidebar contains full unclipped details:

| Information Domain | What Appears on the Node Card (Condensed Summary) | What Appears in the Detail Drawer (Expanded View) |
| :--- | :--- | :--- |
| **Changed Files** | `📁 +900, -300 lines (4 files)` | Full interactive file tree, line-by-line stats, and syntax-highlighted unified diffs. |
| **Command Executions** | `💻 2 commands (Exit 0, 142ms)` | Monospace terminal window with expandable, copyable `stdout` and `stderr` logs. |
| **User Input Prompt** | 2-line quoted excerpt with `4.1 KB` length chip | Complete, verbatim unclipped prompt with token counts and source verification proof. |
| **Output Artifacts** | `📦 Submission Report (180 tokens)` | Full markdown report text, exported data files, and decision rationales. |
| **Validator Findings** | `🔄 Round 2 (1 pushback resolved)` | Multi-round accordion: Round 1 finding observations $\to$ remediation notes $\to$ Round 2 passing test proof. |
| **Causal Lineage** | Step number `[Step 2]` and parent link count | Complete causal graph: Triggered by Node A $\to$ Unblocks Node B, C. |

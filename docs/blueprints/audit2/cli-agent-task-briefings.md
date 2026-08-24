# Audit Report: CLI Agent and Task Briefings

## Overview
This report provides a detailed audit of `olt/scripts/src/cli/commands/agent-brief.ts` and `olt/scripts/src/cli/commands/task-brief.ts`, including related formatter and briefing builder modules.

## Native Host Tool Interaction
The `agent:brief` and `task:brief` commands act as the primary zero-exploration entry points for spawned subagents.
- **`agent:brief`**: Guides agents by injecting their specific constitutional permissions, invariants, allowed commands, and scratch directory hygiene mandates. It explicitly prohibits whole-repo test executions (`bun test`) and forces cognitive validators to execute zero commands.
- **`task:brief`**: Generates a zero-exploration exact-anchor briefing. It dynamically determines target files, associated gate test commands, and exact line ranges. By directly embedding AST-extracted snippets and Drop-in Chunks, it bypasses the need for subagents to execute exploratory `grep` or `cat` commands on the host.

## Current Health & Optimization Assessment
The system is highly optimized for 1-shot execution.
- **AST Parsing**: `mind/briefing-builder.ts` utilizes `typescript` AST parsing to accurately determine symbol boundaries, signatures, and docstrings.
- **Explicit Line Ranges**: `task-brief.ts` enforces precise `StartLine` and `EndLine` parameters inside the markdown output via regex transformations on the generated exact anchor string.
- **Drop-in Chunk Guidance**: Emits pre-formatted `Drop-in chunk` blocks to guide the subagents directly into immediate file edits.
- **Next Steps Resolution**: Dynamically calculates the next command (e.g., `task:claim`, `task:submit`, `task:validate-start`) based on the current state.

## Call Graphs & Flag Routing Mechanics
- **`agentBriefCommand`**:
  - Requires `--role` flag.
  - Calls `executeAgentBrief`, which parses `manifest-schema.ts` and `policy.json`.
  - Returns `{ markdown: output }`.
- **`taskBriefCommand`**:
  - Requires `--run` flag and either `--task` or `--agent`.
  - Resolves ledger state and worktrees via `loadRun`, `workflowPort`, `readAgentLedger`, `findAssignedWorktree`.
  - Determines targets via `deriveTargetFiles` and `deriveRecommendedCommands`.
  - Calls `buildExactAnchorBriefing` (from `briefing-builder.ts`).
  - Calls `formatAgentBrief` if an agent grant is available.
  - Formats output utilizing regex string replacements for `StartLine`/`EndLine`.
  - Returns a combined object including `markdown`, `exact_anchor_briefing`, `anchors`, and `symbols`.

## Zero-JSON Compliance
- **`agent-brief.ts`**: Strictly compliant. Returns purely `{ markdown: ... }`.
- **`task-brief.ts`**: Mostly compliant in textual markdown generation, but the function signature still returns raw structured data alongside `markdown` (`task`, `grant`, `anchors`, `symbols`). Depending on the outer CLI layer, this might leak JSON into the tool output if not exclusively filtered for `markdown`. The internal formatters (`agent-formatter.ts`, `task-formatter.ts`) are completely JSON-free and rigorously enforce character limits (`enforceLineLimit(md, 30)`).

## Unconstrained Finding Count
- **Finding 1**: `agentDefineCommand` in `agent-brief.ts` is a raw stub (`agent:define not fully implemented yet`).
- **Finding 2**: `taskBriefCommand` leaks JSON payload artifacts in its return object instead of returning purely `{ markdown }`.
- **Finding 3**: Hardcoded acceptance criteria injection in `task-brief.ts` replaces missing criteria with generic placeholders (`Strict adherence to project architecture...`), potentially hallucinating requirements not explicitly in the state graph.

## Current Live Code Verification Assessment
The current live code effectively implements the 1-hop micro-cycle and zero-exploration requirements outlined in `AGENTS.md`. Subagents receive perfectly anchored code targets with exact line coordinates, fully realizing the "Zero-Exploration Exact-Anchor Briefings" architectural mandate.

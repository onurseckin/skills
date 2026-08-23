# Plan 13: Exact-Anchor Turn-0 Briefing & Zero-Exploration Dispatch Enforcement

## 1. Problem Statement & Context

In high-efficiency agent orchestration, **Zero-Exploration Exact-Anchor Briefings** (Axiom 4 in `AGENTS.md`) dictate that every deployed subagent must receive an instant, all-inclusive 1-shot briefing in its initial prompt containing:

- Assigned task ID & title.
- Exact disjoint write scope.
- Target files with explicit line coordinates (`StartLine`, `EndLine`).
- Concrete TypeScript symbols and drop-in replacement chunks.
- Allowed & recommended test commands (`bun test <path.test.ts>`).
- Full AST capability contracts from `roles/<role>.md`.

### Observed Systemic Failure Mode:

Parent Orchestrators and Coordinators consistently take shortcuts when calling `invoke_subagent`. Instead of compiling a structured briefing via `task:brief` and injecting it into `Prompt: "..."`, dispatchers write a brief 3-5 line prompt stating:

> _"Claim task pkt_foo using task:claim. Run task:brief yourself to get your exact anchors."_

As a consequence, newly spawned subagents arrive in Turn 0 without explicit anchors and spend their initial turns and context tokens executing exploratory probe commands (`ls`, `find_by_name`, `grep_search`, `cat`), diluting context and delaying Turn-1 code edits.

---

## 2. Root Cause Analysis & Behavioral Dynamics

1. **Dispatcher Prompt-Writing Laziness**:
   - Compiling exact line coordinates and replacement chunks before dispatching requires extra supervisory steps. Dispatchers offload this work onto the subagent by telling it to query `task:brief` post-dispatch.
2. **Disconnected Dispatch Tooling**:
   - `invoke_subagent` is a native host tool that accepts arbitrary prompt text without verifying whether the prompt contains structured anchors.
3. **`task:claim` Lacked Turn-0 Briefing Delivery**:
   - When the worker executes `task:claim`, the CLI previously output minimal confirmation JSON rather than directly delivering the full exact-anchor briefing and capability contract to stdout.

---

## 3. Scope of the Problem & Affected Subsystems

- **Briefing Commands**: `olt/scripts/src/cli/commands/task-brief.ts`, `agent-brief.ts`.
- **Packet & Claim Engine**: `olt/scripts/src/packets/render-packet.ts`, `olt/scripts/src/cli/commands/task-claim.ts`.
- **Dispatcher Roles**: `orchestrator`, `coordinator`.

---

## 4. Key Invariants & Acceptance Criteria

Future orchestrators, planners, and implementers designing the solution for this plan must ensure the following non-negotiable invariants are met:

1. **Mandatory Exact-Anchor Turn-0 Delivery**:
   - The moment a subagent claims a task or receives a briefing, the complete exact-anchor packet (line ranges, symbols, replacement chunks, test commands, role markdown) must be delivered directly into stdout.
2. **Elimination of Exploratory Reads**:
   - Implementers must achieve immediate Turn-1 file modifications (`replace_file_content`) without needing exploratory `ls`, broad `grep`, or directory discovery.
3. **Structured 1-Shot Dispatch Integrity**:
   - Dispatchers must be held accountable to compile full structured briefings prior to subagent invocation.

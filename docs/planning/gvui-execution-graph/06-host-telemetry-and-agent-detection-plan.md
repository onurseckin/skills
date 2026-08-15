# Host Application Telemetry, Agent Discovery & Token/Cache Accounting Plan

**Document**: `docs/planning/gvui-execution-graph/06-host-telemetry-and-agent-detection-plan.md`  
**Date**: 2026-08-15  
**Status**: Approved Architecture & Locked Planning Specification

---

## 1. Core Operating Paradigm & Philosophy

### A. Host Tool Integration vs. Raw API

We do not interact with raw LLM APIs directly. Instead, we operate inside **host coding applications and CLI environments** (e.g., Google Antigravity CLI, Claude Code, Cursor, Codex, OpenCode).

The host application manages:

- Subagent spawning, conversation lifecycle, and hierarchy.
- LLM model routing, reasoning/thinking budget levels (e.g., `High`, `Low`, `Off`).
- Token accounting, context caching (cache creation vs. cache read), and cost telemetry.
- Local transcript logs, SQLite conversation databases, and execution telemetry.

### B. The Zero-Assumption & Zero-Fabrication Invariant

- **Rule 1**: The harness must **never** assume or hardcode a fallback model string (e.g. `Gemini 2.0 Flash` was an erroneous assumption).
- **Rule 2**: If the host tool does not report model or agent metadata, the harness returns `undefined`.
- **Rule 3**: On the GVUI graph canvas, if `node.model` is `undefined`, **no model chip is rendered** on the card.
- **Rule 4**: In the human-readable summary (`summary.md`), un-detected models are explicitly labeled as `Host Managed / Unspecified`, with zero fabricated strings.

---

## 2. Pluggable Host Application Adapter Architecture

```
[ASCII Pluggable Host Telemetry Architecture]

                      ┌─────────────────────────────────────────┐
                      │    Harness Host Telemetry Discovery     │
                      └────────────────────┬────────────────────┘
                                           │
         ┌─────────────────────────────────┼─────────────────────────────────┐
         ▼                                 ▼                                 ▼
┌──────────────────┐             ┌───────────────────┐             ┌───────────────────┐
│ Antigravity CLI  │             │    Claude Code    │             │   Cursor / Codex  │
│ Adapter          │             │    Adapter        │             │   Adapter         │
├──────────────────┤             ├───────────────────┤             ├───────────────────┤
│ • settings.json  │             │ • config.json     │             │ • state.vscdb     │
│ • logs/cli-*.log │             │ • session logs    │             │ • extension logs  │
│ • <id>.db        │             │ • cost accounting │             │ • telemetry JSON  │
└────────┬─────────┘             └─────────┬─────────┘             └─────────┬─────────┘
         │                                 │                                 │
         └─────────────────────────────────┼─────────────────────────────────┘
                                           │
                                           ▼
                      ┌─────────────────────────────────────────┐
                      │ Normalized Telemetry Payload:           │
                      │ • Model Name: "Gemini 3.7 Flash"        │
                      │ • Thinking Level: "High"                │
                      │ • Input Tokens & Output Tokens          │
                      │ • Cache Creation vs Cache Read Tokens   │
                      │ • Estimated API Cost (if logged)        │
                      └─────────────────────────────────────────┘
```

---

## 3. Host-Specific Log Parsing Specifications

### A. Google Antigravity CLI Adapter

1. **Model & Thinking Level Discovery**:
   - Location: `~/.gemini/antigravity-cli/settings.json` and session logs `~/.gemini/antigravity-cli/log/cli-*.log`.
   - Parses:
     - `model`: e.g. `"Gemini 3.7 Flash"`.
     - `thinkingLevel` / `reasoningEffort`: e.g. `"High"`, `"Medium"`, `"Low"`.
     - Combined Badge Label: `"Gemini 3.7 Flash (High)"`.
2. **Subagent & Conversation Mapping**:
   - Location: `~/.gemini/antigravity-cli/conversations/<id>.db` and `.system_generated/logs/transcript.jsonl`.
   - Extracts exact subagent session IDs, roles, and parent-child linkage.
3. **Token & Cache Accounting**:
   - Parses stream response chunks for token blocks:
     - `input_tokens` (Prompt tokens).
     - `output_tokens` (Generation + reasoning tokens).
     - `cache_creation_input_tokens` (Tokens written to context cache).
     - `cache_read_input_tokens` (Tokens retrieved from cache / prompt cache hits).

### B. Claude Code Adapter

1. **Model & Thinking Discovery**:
   - Location: `~/.claude/` session transcripts and config files.
   - Parses: `model` (e.g. `"Claude 3.7 Sonnet"`), `extended_thinking_budget`.
2. **Token & Cache Accounting**:
   - Extracts from session cost logs:
     - `input_tokens`, `output_tokens`.
     - `cache_creation_input_tokens`, `cache_read_input_tokens`.
     - Reported dollar cost (`cost_usd`).

### C. Fallback / Generic Host Adapter

- When running in an unrecognized environment:
  - Model: `undefined` (Chip hidden).
  - Thinking Level: `undefined`.
  - Token Accounting: Uses exact byte counts from disk commands (`stdout.bytes`, `stderr.bytes`) marked explicitly as _Estimated Bytes-to-Tokens_.

---

## 4. Token & Cache Usage Data Model

We define a standardized TypeScript interface in `src/types/graphData.ts` and `scripts/src/summary/types.ts`:

```typescript
export interface TokenUsageDetail {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  isEstimated?: boolean;
}

export interface HostAgentMetadata {
  hostTool: "antigravity" | "claude-code" | "cursor" | "codex" | "custom" | "unknown";
  modelName?: string;
  thinkingLevel?: "high" | "medium" | "low" | "off" | string;
  modelTier?: "xs" | "s" | "m" | "l";
  tokens?: TokenUsageDetail;
}
```

---

## 5. Summary & UI Rendering Invariants

1. **Node Card Render Rule**:
   - If `node.model` is present $\to$ Render Model Chip with thinking level (e.g. `Gemini 3.7 Flash [High]`).
   - If `node.model` is `undefined` $\to$ Do **NOT** render the chip. Header flex space flows naturally to the title.
2. **Node Detail Drawer Metrics Tab**:
   - Renders a dedicated **Token & Cache Breakdown Card**:
     - 📥 **Input Tokens**: `14,200`
     - 📤 **Output Tokens**: `1,850` (Reasoning: `1,200`)
     - 💾 **Cache Created**: `12,000`
     - ⚡ **Cache Read (Hits)**: `8,500` (60% hit rate)
     - 💵 **Host Estimated Cost**: `$0.042` (if provided by host tool)
3. **Executive Summary (`summary.md`)**:
   - Renders token and cache efficiency statistics per wave and across the entire capsule run.

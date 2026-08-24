# Plan 21: Cross-Platform Multi-Provider Usage & Quota Normalization Telemetry Engine

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an extensible, cross-platform usage and quota telemetry engine within the OLT harness that discovers, extracts, and normalizes real-time rate limit, token consumption, and quota refresh window telemetry across all major frontier LLM assistant platforms (Antigravity CLI, Antigravity IDE, Claude Code CLI, OpenAI Codex / ChatGPT Desktop, and Cursor). The engine preserves the verbatim raw identity emitted natively by each application while mapping them into a unified canonical schema.

**Architecture:** Implement a modular collector architecture under `olt/scripts/src/telemetry/`:

1. `NormalizedQuotaReport` canonical schema storing both **verbatim raw identities** (`rawModelFamily`, `rawQuotaName`, `rawClientName`) and **canonical groupings** (`canonicalProvider`, `canonicalWindowType`).
2. Platform-specific telemetry extractors (`AntigravityCliCollector`, `AntigravityIdeCollector`, `ClaudeCodeCollector`, `CursorCollector`, `OpenAiCodexCollector`).
3. `VerbatimIdentityMatcher` registry that dynamically detects, matches, and groups native application names to prevent categorization drift.
4. `UniversalUsageTelemetryEngine` aggregator that auto-detects host platforms, queries available CLIs/APIs/caches, and produces normalized snapshots.
5. CLI command `usage:report` to render formatted markdown tables and JSON receipts.

**Tech Stack:** TypeScript, Bun, Node.js child_process / SQLite APIs, Antigravity / Claude / Cursor / OpenAI local telemetry stores.

**Spec:** `AGENTS.md` (Axiom 14: Live Cognitive Telemetry), Ecosystem Interoperability Specification.

## Global Constraints

- **Verbatim Native Identity Preservation**: Collectors must NEVER discard or guess names. The exact string returned by the CLI/IDE (e.g. `"Gemini Models"`, `"Claude and GPT models"`, `"Five Hour Limit Remaining"`) must be stored in `rawModelFamily` and `rawQuotaName`.
- **Decoupled from Mind Decision Loop**: This plan focuses exclusively on discovery, extraction, normalization, and reporting. It does NOT bind to automated task throttling or Mind scheduling logic.
- **Graceful Degradation**: If a provider or platform is not installed or active in the local environment, the collector must return a clean `absent: true` status without throwing fatal errors.
- **Zero `any`**: Strict TypeScript typing across all collector interfaces, parsers, and normalized DTOs.

---

## 1. Universal Normalized Data Schema with Verbatim Preservation

All platform-specific collectors normalize extracted metrics into this canonical structure:

```typescript
export type CanonicalProvider =
  "google_gemini" | "anthropic_claude" | "openai_gpt" | "cursor_ai" | "custom";

export type CanonicalWindowType =
  | "five_hour"
  | "daily"
  | "weekly"
  | "monthly"
  | "rolling_window"
  | "tokens_per_minute"
  | "requests_per_minute"
  | "unknown";

export type PlatformCategory =
  "cli" | "ide_extension" | "desktop_app" | "headless_agent" | "unknown";

export interface NormalizedQuotaBucket {
  // 1. Verbatim Native Identifiers (Exact string emitted by the application)
  readonly rawModelFamily: string; // E.g., "Gemini Models", "Claude and GPT models", "claude-3-7-sonnet"
  readonly rawQuotaName: string; // E.g., "Five Hour Limit Remaining", "Weekly Limit Remaining", "Fast Requests"
  readonly rawSource: string; // E.g., "agy -p /usage", "~/.cursor/state.vscdb"

  // 2. Canonical Normalized Mappings
  readonly canonicalProvider: CanonicalProvider;
  readonly canonicalWindowType: CanonicalWindowType;

  // 3. Quantitative Telemetry
  readonly remainingPercent: number; // 0.0 - 100.0
  readonly usedPercent: number; // 0.0 - 100.0
  readonly resetsAt: string | null; // ISO-8601 UTC timestamp or null if static
  readonly resetDurationMs: number | null; // Milliseconds until reset
  readonly tokenBudget?: {
    readonly allocatedTokens?: number;
    readonly consumedTokens?: number;
    readonly remainingTokens?: number;
  };
}

export interface PlatformEnvironmentInfo {
  readonly rawClientName: string; // E.g., "Antigravity CLI", "Claude Code", "Cursor IDE"
  readonly rawExecutablePath?: string; // E.g., "/Users/.../.local/bin/agy"
  readonly platformCategory: PlatformCategory;
  readonly platformVersion?: string;
  readonly isInteractive: boolean;
  readonly userAccount?: string;
}

export interface NormalizedQuotaReport {
  readonly capturedAt: string; // ISO-8601 UTC
  readonly platform: PlatformEnvironmentInfo;
  readonly buckets: readonly NormalizedQuotaBucket[];
  readonly aggregateStatus: "nominal" | "warning" | "exhausted" | "unknown";
}
```

---

## 2. Verbatim Application Identity Matching & Extraction Strategies

| Application / Platform     | Native Invocation & Source                         | Verbatim Model Family Output                 | Verbatim Quota Window Output                                     | Canonical Mapping                                                     |
| :------------------------- | :------------------------------------------------- | :------------------------------------------- | :--------------------------------------------------------------- | :-------------------------------------------------------------------- |
| **Antigravity CLI**        | `agy -p "/usage"` or `agy -p "/quota"`             | `"Gemini Models"`, `"Claude and GPT models"` | `"Five Hour Limit Remaining"`, `"Weekly Limit Remaining"`        | `"google_gemini"` / `"anthropic_claude"` + `"five_hour"` / `"weekly"` |
| **Antigravity IDE**        | `jetski_state.pbtxt` & `conversation_summaries.db` | Model identifier protobufs                   | Context token windows                                            | `"google_gemini"` + `"rolling_window"`                                |
| **Claude Code CLI**        | `~/.claude/` state & HTTP response headers         | `anthropic-model` / session config           | `"anthropic-ratelimit-requests-remaining"`, `"tokens-reset"`     | `"anthropic_claude"` + `"tokens_per_minute"`                          |
| **Cursor IDE**             | `state.vscdb` in `Cursor/User/globalStorage/`      | Cursor model selector IDs                    | `"fastUsageRemaining"`, `"proMonthlyTokens"`                     | `"cursor_ai"` + `"monthly"`                                           |
| **OpenAI Codex / ChatGPT** | `~/.codex` local state & rate headers              | `"gpt-4o"`, `"o3-mini"`                      | `"x-ratelimit-remaining-tokens"`, `"x-ratelimit-reset-requests"` | `"openai_gpt"` + `"tokens_per_minute"`                                |

---

### Task 1: Implement `VerbatimIdentityMatcher` & Canonical Types

**Files:**

- Create: `olt/scripts/src/telemetry/types.ts`
- Create: `olt/scripts/src/telemetry/identity-matcher.ts`
- Test: `tests/unit/telemetry/types.test.ts`
- Test: `tests/unit/telemetry/identity-matcher.test.ts`

**Interfaces:**

- Produces: `VerbatimIdentityMatcher.matchProvider(rawName: string): CanonicalProvider`, `VerbatimIdentityMatcher.matchWindow(rawWindow: string): CanonicalWindowType`.

- [ ] **Step 1: Write failing unit test for `VerbatimIdentityMatcher`**

```typescript
import { describe, it, expect } from "bun:test";
import { VerbatimIdentityMatcher } from "../../../olt/scripts/src/telemetry/identity-matcher.ts";

describe("VerbatimIdentityMatcher", () => {
  it("maps exact verbatim model strings from Antigravity CLI", () => {
    expect(VerbatimIdentityMatcher.matchProvider("Gemini Models")).toBe("google_gemini");
    expect(VerbatimIdentityMatcher.matchProvider("Claude and GPT models")).toBe("anthropic_claude");
  });

  it("maps exact verbatim quota strings from Antigravity CLI", () => {
    expect(VerbatimIdentityMatcher.matchWindow("Five Hour Limit Remaining")).toBe("five_hour");
    expect(VerbatimIdentityMatcher.matchWindow("Weekly Limit Remaining")).toBe("weekly");
  });

  it("falls back gracefully to custom/unknown for unrecognized raw names", () => {
    expect(VerbatimIdentityMatcher.matchProvider("Custom Experimental LLM")).toBe("custom");
    expect(VerbatimIdentityMatcher.matchWindow("Rolling 3-Minute Burst")).toBe("unknown");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/telemetry/identity-matcher.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `identity-matcher.ts` and `types.ts`**

Export canonical types and `VerbatimIdentityMatcher` with verbatim string mapping dictionary.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/telemetry/identity-matcher.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add olt/scripts/src/telemetry/ tests/unit/telemetry/
git commit -m "feat(telemetry): implement VerbatimIdentityMatcher and canonical telemetry types"
```

---

### Task 2: Implement `AntigravityCliCollector` with Exact Verbatim Parsing

**Files:**

- Create: `olt/scripts/src/telemetry/collectors/antigravity-cli.ts`
- Test: `tests/unit/telemetry/antigravity-cli-collector.test.ts`

- [ ] **Step 1: Write failing unit test verifying verbatim field preservation**

```typescript
import { describe, it, expect } from "bun:test";
import { AntigravityCliCollector } from "../../../olt/scripts/src/telemetry/collectors/antigravity-cli.ts";

describe("AntigravityCliCollector", () => {
  const sampleAgyOutput = `Gemini Models\tWeekly Limit Remaining\t24%\t2026-08-27T21:36:12Z
Gemini Models\tFive Hour Limit Remaining\t27%\t2026-08-24T04:18:42Z
Claude and GPT models\tWeekly Limit Remaining\t100%\t2026-08-31T01:33:44Z
Claude and GPT models\tFive Hour Limit Remaining\t100%\t2026-08-24T06:33:44Z`;

  it("preserves exact rawModelFamily and rawQuotaName while assigning canonical mappings", () => {
    const buckets = AntigravityCliCollector.parseUsageOutput(sampleAgyOutput);
    expect(buckets.length).toBe(4);

    const gemini5h = buckets.find(
      (b) => b.rawModelFamily === "Gemini Models" && b.rawQuotaName === "Five Hour Limit Remaining",
    );
    expect(gemini5h).toBeDefined();
    expect(gemini5h?.rawModelFamily).toBe("Gemini Models");
    expect(gemini5h?.rawQuotaName).toBe("Five Hour Limit Remaining");
    expect(gemini5h?.canonicalProvider).toBe("google_gemini");
    expect(gemini5h?.canonicalWindowType).toBe("five_hour");
    expect(gemini5h?.remainingPercent).toBe(27);
    expect(gemini5h?.resetsAt).toBe("2026-08-24T04:18:42Z");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement `AntigravityCliCollector`**
- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**

```bash
git add olt/scripts/src/telemetry/collectors/antigravity-cli.ts tests/unit/telemetry/antigravity-cli-collector.test.ts
git commit -m "feat(telemetry): implement AntigravityCliCollector with verbatim identity preservation"
```

---

### Task 3: Implement `CursorCollector` & `ClaudeCodeCollector` with Verbatim Matching

**Files:**

- Create: `olt/scripts/src/telemetry/collectors/cursor.ts`
- Create: `olt/scripts/src/telemetry/collectors/claude-code.ts`
- Test: `tests/unit/telemetry/cursor-collector.test.ts`
- Test: `tests/unit/telemetry/claude-code-collector.test.ts`

- [ ] **Step 1: Write failing unit tests for Cursor & Claude Code collectors**
- [ ] **Step 2: Run tests to verify they fail**
- [ ] **Step 3: Implement collectors capturing raw storage values and mapping to canonical groups**
- [ ] **Step 4: Run tests to verify they pass**
- [ ] **Step 5: Commit**

```bash
git add olt/scripts/src/telemetry/collectors/ tests/unit/telemetry/
git commit -m "feat(telemetry): implement Cursor and ClaudeCode collectors with verbatim field capture"
```

---

### Task 4: Implement `UniversalUsageTelemetryEngine` & `usage:report` CLI

**Files:**

- Create: `olt/scripts/src/telemetry/engine.ts`
- Create: `olt/scripts/src/cli/commands/usage-report.ts`
- Test: `tests/unit/telemetry/engine.test.ts`

- [ ] **Step 1: Write failing unit test for `UniversalUsageTelemetryEngine`**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement engine aggregating all detected collectors into `NormalizedQuotaReport`**
- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**

```bash
git add olt/scripts/src/telemetry/engine.ts olt/scripts/src/cli/commands/usage-report.ts tests/unit/telemetry/engine.test.ts
git commit -m "feat(telemetry): implement UniversalUsageTelemetryEngine and usage:report command"
```

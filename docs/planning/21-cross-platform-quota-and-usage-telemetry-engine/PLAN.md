# Plan 21: Cross-Platform Multi-Provider Usage & Quota Normalization Telemetry Engine

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an extensible, cross-platform usage and quota telemetry engine within the OLT harness that discovers, extracts, and normalizes real-time rate limit, token consumption, and quota refresh window telemetry across all major frontier LLM assistant platforms (Antigravity CLI, Antigravity IDE, Claude Code CLI, OpenAI Codex / ChatGPT Desktop, and Cursor) into a single, unified canonical data structure.

**Architecture:** Implement a modular collector architecture under `olt/scripts/src/telemetry/`:

1. `NormalizedQuotaReport` canonical schema defining provider-agnostic quota windows, percentage remaining, reset ISO timestamps, and token counters.
2. Platform-specific telemetry extractors (`AntigravityCliCollector`, `AntigravityIdeCollector`, `ClaudeCodeCollector`, `CursorCollector`, `OpenAiCodexCollector`).
3. `UniversalUsageTelemetryEngine` aggregator that auto-detects the host environment, queries available platform APIs/caches/CLIs, and produces normalized snapshots.
4. CLI command `usage:report` to render formatted markdown tables and JSON receipts.

**Tech Stack:** TypeScript, Bun, Node.js process / child_process / SQLite APIs, Antigravity / Claude / Cursor / OpenAI local telemetry stores.

**Spec:** `AGENTS.md` (Axiom 14: Live Cognitive Telemetry), Ecosystem Interoperability Specification.

## Global Constraints

- **Decoupled from Mind Decision Loop**: This plan focuses exclusively on discovery, extraction, normalization, and reporting. It does NOT bind to automated task throttling or Mind scheduling logic.
- **Graceful Degradation**: If a provider or platform is not installed or active in the local environment, the collector must return a clean `absent: true` status without throwing fatal errors.
- **Zero `any`**: Strict TypeScript typing across all collector interfaces, parsers, and normalized DTOs.

---

## 1. Universal Normalized Data Schema

All platform-specific collectors normalize their extracted metrics into this canonical structure:

```typescript
export type ProviderName =
  "google_gemini" | "anthropic_claude" | "openai_gpt" | "cursor_ai" | "custom";

export type QuotaWindowType =
  | "five_hour"
  | "daily"
  | "weekly"
  | "monthly"
  | "rolling_window"
  | "tokens_per_minute"
  | "requests_per_minute";

export interface NormalizedQuotaBucket {
  readonly provider: ProviderName;
  readonly modelFamily: string;
  readonly windowType: QuotaWindowType;
  readonly remainingPercent: number; // 0.0 - 100.0
  readonly usedPercent: number; // 0.0 - 100.0
  readonly resetsAt: string | null; // ISO-8601 UTC timestamp or null if static
  readonly resetDurationMs: number | null; // Milliseconds until reset
  readonly tokenBudget?: {
    readonly allocatedTokens?: number;
    readonly consumedTokens?: number;
    readonly remainingTokens?: number;
  };
  readonly rawSource: string; // E.g., "agy -p /usage", "~/.cursor/state.vscdb"
}

export interface PlatformEnvironmentInfo {
  readonly platformId:
    "antigravity_cli" | "antigravity_ide" | "claude_code" | "cursor" | "openai_codex" | "unknown";
  readonly platformVersion?: string;
  readonly isInteractive: boolean;
  readonly userAccount?: string;
}

export interface NormalizedQuotaReport {
  readonly capturedAt: string; // ISO-8601
  readonly platform: PlatformEnvironmentInfo;
  readonly buckets: readonly NormalizedQuotaBucket[];
  readonly aggregateStatus: "nominal" | "warning" | "exhausted" | "unknown";
}
```

---

## 2. Platform Telemetry Extraction Strategies

| Platform / Tool            | Information Source & Extraction Method                                                                                                                 | Extracted Information                                                                                          |
| :------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------- |
| **Antigravity CLI**        | Execute `agy -p "/usage"` / `agy -p "/quota"` in non-interactive print mode                                                                            | 5-hour limit remaining %, weekly limit remaining %, ISO-8601 refresh timestamps for Gemini & Claude/GPT pools. |
| **Antigravity IDE**        | Read local session presence & protobuf state in `~/.gemini/antigravity-cli/jetski_state.pbtxt` and `conversation_summaries.db`                         | Model selections, session tokens, user login identity.                                                         |
| **Claude Code CLI**        | Inspect `~/.claude/` state files, `claude` config, and response headers (`anthropic-ratelimit-requests-remaining`, `anthropic-ratelimit-tokens-reset`) | TPM/RPM limits, 5-hour rolling context quota, subscription tier limits.                                        |
| **Cursor**                 | Query Cursor global storage SQLite (`state.vscdb` / `ItemTable` in `~/Library/Application Support/Cursor/User/globalStorage/`)                         | Cursor Fast Request remaining count, monthly credit reset date, active model backend.                          |
| **OpenAI Codex / ChatGPT** | Inspect OpenAI session headers (`x-ratelimit-remaining-tokens`, `x-ratelimit-reset-requests`) and `~/.codex` local state                               | TPM/RPM tokens, request limit resets.                                                                          |

---

### Task 1: Define Canonical Types & Interfaces

**Files:**

- Create: `olt/scripts/src/telemetry/types.ts`
- Test: `tests/unit/telemetry/types.test.ts`

**Interfaces:**

- Produces: `NormalizedQuotaBucket`, `NormalizedQuotaReport`, `ProviderName`, `QuotaWindowType`, `PlatformEnvironmentInfo`.

- [ ] **Step 1: Write the failing unit test**

```typescript
import { describe, it, expect } from "bun:test";
import type {
  NormalizedQuotaReport,
  NormalizedQuotaBucket,
} from "../../../olt/scripts/src/telemetry/types.ts";

describe("Normalized Quota Types", () => {
  it("enforces valid bucket structure and percentage bounds", () => {
    const bucket: NormalizedQuotaBucket = {
      provider: "google_gemini",
      modelFamily: "Gemini Models",
      windowType: "five_hour",
      remainingPercent: 27.0,
      usedPercent: 73.0,
      resetsAt: "2026-08-24T04:18:42Z",
      resetDurationMs: 9900000,
      rawSource: "agy -p /usage",
    };
    expect(bucket.remainingPercent).toBe(27.0);
    expect(bucket.usedPercent).toBe(73.0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/telemetry/types.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `olt/scripts/src/telemetry/types.ts`**

Export all canonical TypeScript types and interfaces.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/telemetry/types.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add olt/scripts/src/telemetry/types.ts tests/unit/telemetry/types.test.ts
git commit -m "feat(telemetry): define canonical cross-platform quota & usage types"
```

---

### Task 2: Implement `AntigravityCliCollector`

**Files:**

- Create: `olt/scripts/src/telemetry/collectors/antigravity-cli.ts`
- Test: `tests/unit/telemetry/antigravity-cli-collector.test.ts`

**Interfaces:**

- Consumes: Raw tab-separated output from `agy -p "/usage"` or mock text fixture.
- Produces: `export class AntigravityCliCollector { public static parseUsageOutput(rawOutput: string): NormalizedQuotaBucket[]; public static async collect(): Promise<NormalizedQuotaBucket[]>; }`

- [ ] **Step 1: Write the failing unit test**

```typescript
import { describe, it, expect } from "bun:test";
import { AntigravityCliCollector } from "../../../olt/scripts/src/telemetry/collectors/antigravity-cli.ts";

describe("AntigravityCliCollector", () => {
  const sampleAgyOutput = `Gemini Models\tWeekly Limit Remaining\t24%\t2026-08-27T21:36:12Z
Gemini Models\tFive Hour Limit Remaining\t27%\t2026-08-24T04:18:42Z
Claude and GPT models\tWeekly Limit Remaining\t100%\t2026-08-31T01:33:44Z
Claude and GPT models\tFive Hour Limit Remaining\t100%\t2026-08-24T06:33:44Z`;

  it("correctly parses tab-separated agy -p /usage output into normalized buckets", () => {
    const buckets = AntigravityCliCollector.parseUsageOutput(sampleAgyOutput);
    expect(buckets.length).toBe(4);

    const gemini5h = buckets.find(
      (b) => b.provider === "google_gemini" && b.windowType === "five_hour",
    );
    expect(gemini5h).toBeDefined();
    expect(gemini5h?.remainingPercent).toBe(27);
    expect(gemini5h?.usedPercent).toBe(73);
    expect(gemini5h?.resetsAt).toBe("2026-08-24T04:18:42Z");

    const claudeWeekly = buckets.find(
      (b) => b.provider === "anthropic_claude" && b.windowType === "weekly",
    );
    expect(claudeWeekly).toBeDefined();
    expect(claudeWeekly?.remainingPercent).toBe(100);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/telemetry/antigravity-cli-collector.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `AntigravityCliCollector`**

Implement TS parser mapping "Weekly Limit Remaining" $\rightarrow$ `weekly`, "Five Hour Limit Remaining" $\rightarrow$ `five_hour`, mapping model strings to `google_gemini` / `anthropic_claude` / `openai_gpt`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/telemetry/antigravity-cli-collector.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add olt/scripts/src/telemetry/collectors/antigravity-cli.ts tests/unit/telemetry/antigravity-cli-collector.test.ts
git commit -m "feat(telemetry): implement AntigravityCliCollector for live quota extraction"
```

---

### Task 3: Implement `CursorCollector` & `ClaudeCodeCollector`

**Files:**

- Create: `olt/scripts/src/telemetry/collectors/cursor.ts`
- Create: `olt/scripts/src/telemetry/collectors/claude-code.ts`
- Test: `tests/unit/telemetry/cursor-collector.test.ts`
- Test: `tests/unit/telemetry/claude-code-collector.test.ts`

**Interfaces:**

- Produces: `CursorCollector.collect()`, `ClaudeCodeCollector.collect()`.

- [ ] **Step 1: Write the failing unit tests for Cursor & Claude Code collectors**
- [ ] **Step 2: Run tests to verify they fail**
- [ ] **Step 3: Implement collectors with local disk cache parsing and fallback detection**
- [ ] **Step 4: Run tests to verify they pass**
- [ ] **Step 5: Commit**

```bash
git add olt/scripts/src/telemetry/collectors/ tests/unit/telemetry/
git commit -m "feat(telemetry): implement Cursor and ClaudeCode telemetry collectors"
```

---

### Task 4: Implement `UniversalUsageTelemetryEngine` & `usage:report` CLI

**Files:**

- Create: `olt/scripts/src/telemetry/engine.ts`
- Create: `olt/scripts/src/cli/commands/usage-report.ts`
- Test: `tests/unit/telemetry/engine.test.ts`

**Interfaces:**

- Consumes: All platform collectors.
- Produces: `UniversalUsageTelemetryEngine.getReport()` returning `NormalizedQuotaReport`, rendered in `usage:report` command.

- [ ] **Step 1: Write the failing unit test**

```typescript
import { describe, it, expect } from "bun:test";
import { UniversalUsageTelemetryEngine } from "../../../olt/scripts/src/telemetry/engine.ts";

describe("UniversalUsageTelemetryEngine", () => {
  it("aggregates available collectors into a single unified report", async () => {
    const report = await UniversalUsageTelemetryEngine.getReport();
    expect(report.capturedAt).toBeDefined();
    expect(Array.isArray(report.buckets)).toBe(true);
    expect(["nominal", "warning", "exhausted", "unknown"]).toContain(report.aggregateStatus);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/telemetry/engine.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `UniversalUsageTelemetryEngine` & `usage:report`**

Assemble all collectors, compute aggregate status (`warning` if any bucket $< 20\%$, `exhausted` if $< 5\%$), and output a clean ASCII telemetry table.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/telemetry/engine.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add olt/scripts/src/telemetry/engine.ts olt/scripts/src/cli/commands/usage-report.ts tests/unit/telemetry/engine.test.ts
git commit -m "feat(telemetry): implement UniversalUsageTelemetryEngine and usage:report command"
```

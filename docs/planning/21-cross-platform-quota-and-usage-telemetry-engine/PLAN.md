# Plan 21: Flexible Cross-Platform Multi-Tier Quota & Usage Discovery Engine

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a flexible, multi-tiered discovery and telemetry extraction engine within the OLT harness that autonomously probes, inspects, and normalizes rate limits, token usage, and quota refresh metrics across frontier LLM platforms (Antigravity, Claude, Cursor, OpenAI/Codex, etc.). The engine avoids rigid assumptions, using empirical on-the-spot discovery across three extraction tiers (CLI probing $\rightarrow$ Local storage inspection $\rightarrow$ Session/process metadata) and dynamically normalizes discovered data into a unified canonical format.

**Architecture:** Implement a tiered, discovery-driven pipeline under `olt/scripts/src/telemetry/`:

1. **Universal 3-Tier Probing Lifecycle**: Every platform adapter implements a 3-tier fallback strategy:
   - **Tier 1 (CLI & Executable Probing)**: Non-destructively probes installed CLI binaries for native flags, print options, or usage subcommands.
   - **Tier 2 (Local Storage & Cache Probing)**: Scans local application data directories (SQLite, JSON, protobufs, log files) for persisted quota caches and session metrics.
   - **Tier 3 (Runtime, Environment & Header Probing)**: Checks environment variables, active process context, and HTTP session headers.
2. **Flexible Telemetry Collector Protocol (`TelemetryCollector`)**: Lightweight, resilient adapter interface returning empirical raw observations alongside detected metrics.
3. **Dynamic Normalization Aggregator (`TelemetryNormalizationEngine`)**: Ingests heterogeneous observations from all probed tiers, dynamically extracts recognized quota/usage attributes, and preserves all unmapped raw telemetry without data loss.
4. **Interactive CLI Reporter (`usage:report`)**: Generates comprehensive telemetry briefs adapting dynamically to whatever metrics implementers uncover.

**Tech Stack:** TypeScript, Bun, Node.js child_process / filesystem / SQLite APIs.

**Spec:** `AGENTS.md` (Axiom 14: Live Cognitive Telemetry), Ecosystem Interoperability Specification.

## Global Constraints

- **Empirical Discovery Over Assumption**: Implementers and collectors must empirically discover what each tool provides on the host system rather than assuming static commands or fixed file structures.
- **Graceful Multi-Tier Fallback**: If Tier 1 (CLI) is unavailable or returns partial data, the collector automatically falls back to Tier 2 (Local Storage), then Tier 3 (Runtime Metadata).
- **Open Raw Observation Preservation**: Any raw metric, gauge, or string that does not map directly to a known field must be preserved verbatim in `rawObservations: Record<string, unknown>`.
- **Decoupled from Mind Decision Loop**: This plan strictly implements discovery, extraction, normalization, and reporting. It does NOT throttle tasks or alter Mind scheduling.
- **Zero `any`**: Strict TypeScript typing across all collectors and normalization engines.

---

## 1. Flexible Canonical Data Schema

The schema accommodates both strongly-typed normalized gauges and open raw discovery payloads:

```typescript
export type TelemetrySourceTier =
  "tier1_cli_command" | "tier2_local_storage" | "tier3_runtime_metadata" | "composite";

export type QuotaConfidence = "verified_exact" | "inferred_metric" | "approximate";

export interface NormalizedQuotaMetric {
  // Verbatim Identifiers as Emitted by the Platform
  readonly rawMetricName: string; // E.g., "Five Hour Limit Remaining", "fastUsageRemaining", "requests-remaining"
  readonly rawGroupName?: string; // E.g., "Gemini Models", "Claude and GPT models"

  // Inferred Canonical Categorization
  readonly canonicalProvider: string; // E.g., "google_gemini", "anthropic_claude", "openai_gpt", "cursor_ai", "custom"
  readonly windowType:
    "burst" | "short_window" | "daily" | "weekly" | "monthly" | "token_rate" | "custom";

  // Quantitative Gauges (if available)
  readonly remainingPercentage?: number; // 0.0 - 100.0
  readonly usedPercentage?: number; // 0.0 - 100.0
  readonly remainingCount?: number; // E.g., request count, token count
  readonly totalLimit?: number;

  // Refresh & Reset Timing
  readonly resetsAtIso?: string | null; // ISO-8601 UTC timestamp
  readonly resetDurationSeconds?: number | null;

  // Provenance
  readonly sourceTier: TelemetrySourceTier;
  readonly confidence: QuotaConfidence;
  readonly rawPayload: unknown;
}

export interface PlatformProbeResult {
  readonly platformId: string; // E.g., "antigravity", "claude_code", "cursor", "openai_codex"
  readonly isDetected: boolean;
  readonly primaryTierUsed: TelemetrySourceTier | "none";
  readonly executablePath?: string;
  readonly storagePath?: string;
  readonly metrics: readonly NormalizedQuotaMetric[];
  readonly rawObservations: Record<string, unknown>; // Preserves all empirical discovery data
  readonly errors: readonly string[]; // Non-fatal probing errors
}

export interface UnifiedTelemetryReport {
  readonly timestamp: string; // ISO-8601
  readonly hostEnvironment: {
    readonly os: string;
    readonly detectedPlatforms: readonly string[];
  };
  readonly results: readonly PlatformProbeResult[];
  readonly summary: {
    readonly activeModelPools: number;
    readonly lowestRemainingQuotaPercent?: number;
    readonly nextResetTimestamp?: string | null;
  };
}
```

---

## 2. The 3-Tier Universal Probing Strategy

Every platform adapter follows a standard, non-prescriptive probing protocol:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                    3-TIER UNIVERSAL PROBING PROTOCOL                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [ Tier 1: CLI & Command Probing ]                                          │
│    • Probe PATH for platform binaries (e.g. agy, claude, cursor, codex)     │
│    • Probe non-interactive usage flags (-p /usage, --usage, --status, etc.) │
│    • If successful: capture structured stdout records                       │
│    • If absent or partial: proceed to Tier 2                                │
│                          │                                                  │
│                          ▼                                                  │
│  [ Tier 2: Local Application Storage Probing ]                              │
│    • Probe home and system directories (~/.gemini, ~/.claude, ~/.cursor, etc│
│    • Inspect local SQLite stores, JSON configs, protobufs, and log streams   │
│    • Extract persisted token meters, quota caches, and refresh timers        │
│    • If absent or partial: proceed to Tier 3                                │
│                          │                                                  │
│                          ▼                                                  │
│  [ Tier 3: Runtime Context & Process Metadata ]                             │
│    • Inspect session environment variables (e.g. ANTHROPIC_*, OPENAI_*)     │
│    • Inspect active process execution context and HTTP response headers     │
│                          │                                                  │
│                          ▼                                                  │
│  [ Dynamic Normalization & Schema Assembly ]                                │
│    • Ingest all raw observations into UnifiedTelemetryReport                │
│    • Map recognized gauges while preserving full unmapped raw payloads      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

### Task 1: Define Resilient Schemas and Universal Probing Interfaces

**Files:**

- Create: `olt/scripts/src/telemetry/types.ts`
- Create: `olt/scripts/src/telemetry/probe-interface.ts`
- Test: `tests/unit/telemetry/probe-resilience.test.ts`

**Interfaces:**

- Produces: `TelemetryCollector`, `NormalizedQuotaMetric`, `PlatformProbeResult`, `UnifiedTelemetryReport`.

- [ ] **Step 1: Write failing unit test verifying resilient normalization and open raw capture**

```typescript
import { describe, it, expect } from "bun:test";
import type {
  PlatformProbeResult,
  NormalizedQuotaMetric,
} from "../../../olt/scripts/src/telemetry/types.ts";

describe("Telemetry Resilience", () => {
  it("preserves unmapped empirical observations without data loss", () => {
    const rawDiscovery: PlatformProbeResult = {
      platformId: "custom_frontier_agent",
      isDetected: true,
      primaryTierUsed: "tier1_cli_command",
      metrics: [
        {
          rawMetricName: "Dynamic Burst Tokens",
          canonicalProvider: "custom",
          windowType: "burst",
          remainingPercentage: 82.5,
          sourceTier: "tier1_cli_command",
          confidence: "verified_exact",
          rawPayload: { burstRemaining: 82500, burstTotal: 100000 },
        },
      ],
      rawObservations: {
        vendorExperimentalFlag: "v2-active",
        discoveredSubcommands: ["--stats", "--quota-v2"],
      },
      errors: [],
    };

    expect(rawDiscovery.metrics[0]?.remainingPercentage).toBe(82.5);
    expect(rawDiscovery.rawObservations["vendorExperimentalFlag"]).toBe("v2-active");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement `types.ts` and `probe-interface.ts`**
- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**

```bash
git add olt/scripts/src/telemetry/ tests/unit/telemetry/
git commit -m "feat(telemetry): define resilient 3-tier probing schema and interfaces"
```

---

### Task 2: Implement Base Tiered Discovery Engine (`BaseTieredCollector`)

**Files:**

- Create: `olt/scripts/src/telemetry/base-collector.ts`
- Test: `tests/unit/telemetry/base-collector.test.ts`

**Interfaces:**

- Produces: `export abstract class BaseTieredCollector implements TelemetryCollector { public async probe(): Promise<PlatformProbeResult>; protected abstract probeTier1Cli(): Promise<TierResult | null>; protected abstract probeTier2Storage(): Promise<TierResult | null>; protected abstract probeTier3Runtime(): Promise<TierResult | null>; }`

- [ ] **Step 1: Write failing unit test for fallback escalation across tiers**

```typescript
import { describe, it, expect } from "bun:test";
import {
  BaseTieredCollector,
  type TierResult,
} from "../../../olt/scripts/src/telemetry/base-collector.ts";

class MockCollector extends BaseTieredCollector {
  readonly platformId = "mock_app";
  protected async probeTier1Cli(): Promise<TierResult | null> {
    return null; /* CLI absent */
  }
  protected async probeTier2Storage(): Promise<TierResult | null> {
    return {
      sourceTier: "tier2_local_storage",
      metrics: [
        {
          rawMetricName: "Cached Quota",
          canonicalProvider: "mock",
          windowType: "daily",
          remainingPercentage: 45,
          sourceTier: "tier2_local_storage",
          confidence: "inferred_metric",
          rawPayload: { diskQuota: 45 },
        },
      ],
      rawObservations: { foundDb: "/path/to/mock.db" },
    };
  }
  protected async probeTier3Runtime(): Promise<TierResult | null> {
    return null;
  }
}

describe("BaseTieredCollector", () => {
  it("escalates cleanly from Tier 1 to Tier 2 when CLI is absent", async () => {
    const collector = new MockCollector();
    const result = await collector.probe();
    expect(result.isDetected).toBe(true);
    expect(result.primaryTierUsed).toBe("tier2_local_storage");
    expect(result.metrics[0]?.remainingPercentage).toBe(45);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement `BaseTieredCollector` with cascading fallbacks and non-fatal error isolation**
- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**

```bash
git add olt/scripts/src/telemetry/base-collector.ts tests/unit/telemetry/base-collector.test.ts
git commit -m "feat(telemetry): implement BaseTieredCollector with automatic tier escalation"
```

---

### Task 3: Implement Discovery Collectors for Antigravity, Claude, Cursor & Codex

**Files:**

- Create: `olt/scripts/src/telemetry/collectors/antigravity.ts`
- Create: `olt/scripts/src/telemetry/collectors/claude.ts`
- Create: `olt/scripts/src/telemetry/collectors/cursor.ts`
- Create: `olt/scripts/src/telemetry/collectors/codex.ts`
- Test: `tests/unit/telemetry/collectors.test.ts`

**Methodology for Implementers:**

- **Antigravity**: Probe Tier 1 `agy -p "/usage"` / `/quota` $\rightarrow$ Tier 2 `~/.gemini/antigravity-cli/` state files and databases $\rightarrow$ Tier 3 environment tokens.
- **Claude**: Probe Tier 1 `claude --version` / commands $\rightarrow$ Tier 2 `~/.claude/` state and config $\rightarrow$ Tier 3 `ANTHROPIC_*` tokens / session headers.
- **Cursor**: Probe Tier 1 CLI $\rightarrow$ Tier 2 global storage SQLite (`state.vscdb` / `ItemTable`) $\rightarrow$ Tier 3 process context.
- **OpenAI/Codex**: Probe Tier 1 CLI $\rightarrow$ Tier 2 `~/.codex` / config stores $\rightarrow$ Tier 3 rate limit headers.

- [ ] **Step 1: Write failing unit tests with flexible mock fixtures for each collector**
- [ ] **Step 2: Run tests to verify they fail**
- [ ] **Step 3: Implement collectors using the 3-tier fallback pattern**
- [ ] **Step 4: Run tests to verify they pass**
- [ ] **Step 5: Commit**

```bash
git add olt/scripts/src/telemetry/collectors/ tests/unit/telemetry/
git commit -m "feat(telemetry): implement tiered collectors for Antigravity, Claude, Cursor, and Codex"
```

---

### Task 4: Implement `TelemetryNormalizationEngine` & `usage:report` CLI

**Files:**

- Create: `olt/scripts/src/telemetry/engine.ts`
- Create: `olt/scripts/src/cli/commands/usage-report.ts`
- Test: `tests/unit/telemetry/engine.test.ts`

**Interfaces:**

- Produces: `TelemetryNormalizationEngine.collectReport(): Promise<UnifiedTelemetryReport>`, and CLI command `usage:report [--json] [--verbose]`.

- [ ] **Step 1: Write failing unit test for dynamic multi-collector aggregation**

```typescript
import { describe, it, expect } from "bun:test";
import { TelemetryNormalizationEngine } from "../../../olt/scripts/src/telemetry/engine.ts";

describe("TelemetryNormalizationEngine", () => {
  it("aggregates all detected platform collectors into unified report", async () => {
    const report = await TelemetryNormalizationEngine.collectReport();
    expect(report.timestamp).toBeDefined();
    expect(Array.isArray(report.results)).toBe(true);
    expect(report.summary).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement aggregator and clean ASCII table renderer command**
- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Commit**

```bash
git add olt/scripts/src/telemetry/engine.ts olt/scripts/src/cli/commands/usage-report.ts tests/unit/telemetry/engine.test.ts
git commit -m "feat(telemetry): implement TelemetryNormalizationEngine and usage:report CLI command"
```

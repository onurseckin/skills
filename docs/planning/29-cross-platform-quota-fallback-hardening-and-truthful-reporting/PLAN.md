# Plan 29: Cross-Platform Quota Fallback Hardening & Truthful "Not Detected" Reporting

**Status:** Proposed  
**Objective:** Harden the multi-tiered fallback architecture (Tier 2 Local Storage, Tier 3 Internet API / Env Key, and Terminal "Not Detected" states) across Antigravity, Claude Code, and OpenAI/Codex in the telemetry engine, enforcing truthful reporting without false 100% metrics and guaranteeing the non-blocking invariant for offline platforms.

---

## 1. Executive Summary & Core Requirements

Currently, our Tier 1 live collectors for Antigravity (Connect-RPC), Claude Code (OAuth / `~/.claude.json`), and OpenAI/Codex (rollout session streams) are working properly. We now need to harden the fallback pathways for scenarios where daemons or applications are offline, and ensure the system behaves reliably and truthfully across all states.

### Key Requirements & Invariants

1. **Multi-Tier Fallback Resilience:**
   - **Tier 1 (Live Service / Stream):** Live RPC, OAuth usage endpoint, or real-time session logs (`confidence: "verified_exact"`).
   - **Tier 2 (Persistent Local Storage & Config Cache):** Static local files on disk (e.g., `~/.claude.json`, `~/.codex/`, `~/.gemini/`) when daemons are offline (`confidence: "cached"`).
   - **Tier 3 (Runtime Environment & API Keys):** Process environment variables (`GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`).
   - **Terminal State ("Not Detected"):** When all tiers fail, record the specific empirical reason (e.g., `"Daemon Offline · No Storage Quota"`, `"No Claude Session · No API Key"`).
2. **Truthful Telemetry Reporting (No False 100% Claims):**
   - If a platform is offline and has no credentials or session data, the telemetry engine must render `[░░░░░░] Not Detected` with the exact failure reason in the ASCII table, rather than fabricating a false 100% metric.
3. **Non-Blocking Invariant for Offline Platforms:**
   - In `QuotaCircuitBreaker`, `Not Detected` platforms are strictly **non-blocking** (assumed safe, $> 5\%$). An unconfigured or offline secondary platform must never halt or freeze long tasks.
4. **Sanitized Fixtures (Zero Personal Information):**
   - Offline test fixtures in `olt/scripts/src/telemetry/fixtures/` must strictly contain zero personal emails, names, or real UUIDs.
5. **100% Mocked Hermetic Unit Tests:**
   - All unit tests in `tests/unit/telemetry/` must execute in-memory with mocked environments (0 live network calls during test runs).

---

## 2. Platform Fallback Matrix

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                               MULTI-TIER FALLBACK RESOLUTION MATRIX                              │
├──────────────┬──────────────────────────────┬──────────────────────────────┬─────────────────────┤
│ Platform     │ Tier 1 (Live / Session)      │ Tier 2 (Local Storage Cache) │ Tier 3 (API Key)    │
├──────────────┼──────────────────────────────┼──────────────────────────────┼─────────────────────┤
│ Antigravity  │ Connect-RPC (127.0.0.1:<port>)│ ~/.gemini/ configs           │ GEMINI_API_KEY      │
│ Claude Code  │ OAuth API (/api/oauth/usage) │ ~/.claude.json (cached)      │ ANTHROPIC_API_KEY   │
│ OpenAI/Codex │ Session Rollouts (rollout-*.jsonl)│ ~/.codex/auth.json, config   │ OPENAI_API_KEY      │
│ Cursor       │ cursor --version CLI         │ Cursor storage DB / state    │ CURSOR_API_KEY      │
└──────────────┴──────────────────────────────┴────────────-─────────────────┴─────────────────────┘
```

### Detailed Fallback Behaviors per Platform

#### A. Antigravity (`AntigravityCollector`)

- **Tier 1:** Probes local listening ports for Connect-RPC `GetUserStatus`.
- **Tier 2 (When daemon is offline):** Checks local storage in `~/.gemini/` or `~/.config/antigravity/`. If no quota metrics are present, sets empirical reason: `"Daemon Offline · No Quota in Storage"`.
- **Tier 3:** Checks `GEMINI_API_KEY` / `GOOGLE_API_KEY` in environment.
- **Terminal:** Returns `isDetected: false` with reason `"Daemon Offline · No Quota in Storage"`.

#### B. Claude Code (`ClaudeCollector`)

- **Tier 1:** Queries live Anthropic OAuth API (`GET /api/oauth/usage`).
- **Tier 2 (When CLI is offline):** Reads static `~/.claude.json` (`cachedUsageUtilization`, `oauthAccount`) and returns metrics with `confidence: "cached"`.
- **Tier 3:** Checks `ANTHROPIC_API_KEY` in environment.
- **Terminal:** Returns `isDetected: false` with reason `"No Claude Session · No API Key"`.

#### C. OpenAI / Codex (`CodexCollector` & `OpenAICollector`)

- **Tier 1:** Reads latest `~/.codex/sessions/**/rollout-*.jsonl` and evaluates time-aware decay against `resets_at`.
- **Tier 2 (When app is offline):** Reads `~/.codex/auth.json` / `~/.codex/config.toml` and returns metrics with `confidence: "cached"`.
- **Tier 3:** Checks `OPENAI_API_KEY` / `CODEX_API_KEY` in environment.
- **Terminal:** Returns `isDetected: false` with reason `"No Codex Sessions · No API Key"`.

---

## 3. Telemetry Engine & Circuit-Breaker Enhancements

### A. Telemetry Types (`types.ts` & `base-collector.ts`)

- Add `"cached"` to `ConfidenceLevel` union (`"verified_exact" | "cached" | "inferred" | "heuristic"`).
- Add optional `reason?: string | undefined` to `PlatformProbeResult` and `TierResult`.
- Add optional `getTerminalReason(): Promise<string | undefined> | string | undefined` hook on `BaseTieredCollector`.

### B. ASCII Table Formatter (`engine.ts`)

- When a platform is `isDetected: false` or returns zero metrics:
  - Render an explicit, truthful row:
    ```text
    │ platform_id  │ (not detected)                 │ -          │ [░░░░░░] Not Detected │ Reason           │ Tier 0 (none)│
    ```
- Avoid fabricating false 100% metrics for missing platforms.

### C. Circuit-Breaker Non-Blocking Guard (`circuit-breaker.ts`)

- Verify that `QuotaCircuitBreaker.evaluate()` filters for `res.isDetected !== false && res.metrics.length > 0`.
- Offline / undetected platforms are treated as non-blocking (assumed safe, $> 5\%$), preventing spurious task freezes.

---

## 4. Work Breakdown & Implementation Steps

| Step       | Scope                                  | Target Files                                                                                                                         | Description                                                                                                     |
| :--------- | :------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------- |
| **Task 1** | **Type & Base Collector Extensions**   | `olt/scripts/src/telemetry/types.ts`<br>`olt/scripts/src/telemetry/base-collector.ts`                                                | Add `"cached"` confidence level, `reason` fields, and `getTerminalReason()` hook to `BaseTieredCollector`.      |
| **Task 2** | **Antigravity Fallback Hardening**     | `olt/scripts/src/telemetry/collectors/antigravity.ts`<br>`olt/scripts/src/telemetry/collectors/common.ts`                            | Implement storage inspection, environment key check, and empirical terminal reason when daemon is offline.      |
| **Task 3** | **Claude Code Fallback Hardening**     | `olt/scripts/src/telemetry/collectors/claude.ts`                                                                                     | Implement cached `~/.claude.json` parsing with `"cached"` confidence, env key check, and terminal reason.       |
| **Task 4** | **OpenAI / Codex Fallback Hardening**  | `olt/scripts/src/telemetry/collectors/openai.ts`<br>`olt/scripts/src/telemetry/collectors/codex.ts`                                  | Implement static auth/config parsing with `"cached"` confidence, env key check, and terminal reason.            |
| **Task 5** | **Engine & Table Formatting**          | `olt/scripts/src/telemetry/engine.ts`                                                                                                | Render truthful `Not Detected (Reason)` rows for offline platforms with zero fabricated metrics.                |
| **Task 6** | **Circuit-Breaker Non-Blocking Guard** | `olt/scripts/src/telemetry/circuit-breaker.ts`                                                                                       | Verify and test that `Not Detected` platforms never trigger circuit breaker freeze.                             |
| **Task 7** | **Sanitized Fixtures**                 | `olt/scripts/src/telemetry/fixtures/*.json`                                                                                          | Verify all sample fixtures contain 0 personal emails, names, or real UUIDs.                                     |
| **Task 8** | **Hermetic Unit Test Suite**           | `tests/unit/telemetry/collectors.test.ts`<br>`tests/unit/telemetry/engine.test.ts`<br>`tests/unit/telemetry/circuit-breaker.test.ts` | Add comprehensive tests covering all fallback tiers, offline states, and non-blocking circuit breaker behavior. |

---

## 5. Verification & Testing Strategy

1. **Unit Test Suite (`bun test tests/unit/telemetry/`):**
   - Test that Antigravity falls back cleanly to Tier 2 storage and Tier 3 env key when RPC fails.
   - Test that Claude Code extracts cached utilization from `~/.claude.json` with `"cached"` confidence.
   - Test that Codex handles offline states with time-decayed session parsing and env keys.
   - Test that all platforms report `isDetected: false` and truthful `reason` when completely absent.
   - Test that `engine.ts` renders `Not Detected` rows with `[░░░░░░]`.
   - Test that `QuotaCircuitBreaker` skips `Not Detected` platforms without halting.
2. **Live Execution Verification:**
   - Run `olt usage:report` to verify live table formatting.
   - Run `olt quota:check` to verify non-blocking circuit breaker evaluation.
   - Verify `tsc -p tsconfig.json --noEmit` passes with 0 errors.

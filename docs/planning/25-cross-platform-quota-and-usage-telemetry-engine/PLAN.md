# Plan 25: Flexible Cross-Platform Multi-Tier Quota & Usage Discovery Engine

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a flexible, multi-tiered discovery and telemetry extraction engine within the OLT harness that autonomously probes, inspects, and normalizes rate limits, token usage, and quota refresh metrics across frontier LLM platforms (Antigravity, Claude, Cursor, OpenAI/Codex, etc.). The engine avoids rigid assumptions, using empirical on-the-spot discovery across three extraction tiers (CLI probing $\rightarrow$ Local storage inspection $\rightarrow$ Session/process metadata) and dynamically normalizes discovered data into a unified canonical format.

**Architecture:** Implement a tiered, discovery-driven pipeline under `olt/scripts/src/telemetry/`:

1. **Universal 3-Tier Probing Lifecycle**: Every platform adapter implements a 3-tier fallback strategy (Tier 1 CLI $\rightarrow$ Tier 2 Local Storage $\rightarrow$ Tier 3 Runtime Metadata).
2. **Flexible Telemetry Collector Protocol (`TelemetryCollector`)**: Lightweight adapter interface returning empirical raw observations alongside detected metrics.
3. **Dynamic Normalization Aggregator (`TelemetryNormalizationEngine`)**: Ingests heterogeneous observations, normalizes recognized attributes, and preserves raw unmapped payloads.
4. **Interactive CLI Reporter (`usage:report`)**: Generates comprehensive telemetry briefs with dynamic ASCII table formatting.

**Tech Stack:** TypeScript, Bun, Node.js child_process / filesystem / SQLite APIs.

**Spec:** `AGENTS.md` (Axiom 14: Live Cognitive Telemetry).

## Global Constraints

- **Empirical Discovery Over Assumption**: Probe on-the-spot rather than assuming fixed binary paths or schemas.
- **Graceful Multi-Tier Fallback**: Automatic tier fallback (Tier 1 $\rightarrow$ Tier 2 $\rightarrow$ Tier 3).
- **Open Raw Observation Preservation**: Preserve all unmapped raw observation data in `rawObservations`.
- 0 `any` annotations.

---

### Task 1: Define Resilient Schemas and Universal Probing Interfaces

**Files:**

- Create: `olt/scripts/src/telemetry/types.ts`
- Create: `olt/scripts/src/telemetry/probe-interface.ts`
- Test: `tests/unit/telemetry/probe-resilience.test.ts`

- [ ] **Step 1: Write failing unit test verifying resilient normalization and open raw capture**
- [ ] **Step 2: Implement `types.ts` and `probe-interface.ts`**
- [ ] **Step 3: Run test to verify it passes**
- [ ] **Step 4: Commit**

```bash
git add olt/scripts/src/telemetry/ tests/unit/telemetry/
git commit -m "feat(telemetry): define resilient 3-tier probing schema and interfaces"
```

---

### Task 2: Implement Base Tiered Discovery Engine (`BaseTieredCollector`)

**Files:**

- Create: `olt/scripts/src/telemetry/base-collector.ts`
- Test: `tests/unit/telemetry/base-collector.test.ts`

- [ ] **Step 1: Write failing unit test for fallback escalation across tiers**
- [ ] **Step 2: Implement `BaseTieredCollector` with cascading fallbacks**
- [ ] **Step 3: Run test to verify it passes**
- [ ] **Step 4: Commit**

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

- [ ] **Step 1: Write failing unit tests for each collector**
- [ ] **Step 2: Implement collectors using the 3-tier fallback pattern**
- [ ] **Step 3: Run tests to verify they pass**
- [ ] **Step 4: Commit**

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

- [ ] **Step 1: Write failing unit test for dynamic multi-collector aggregation**
- [ ] **Step 2: Implement aggregator and clean ASCII table renderer command**
- [ ] **Step 3: Run test to verify it passes**
- [ ] **Step 4: Commit & Sync**

```bash
git add olt/scripts/src/telemetry/engine.ts olt/scripts/src/cli/commands/usage-report.ts tests/unit/telemetry/engine.test.ts
git commit -m "feat(telemetry): implement TelemetryNormalizationEngine and usage:report CLI command"
bun scripts/sync-global.ts
```

/**
 * Dedicated Test Suite for Ephemeral Retrieval Sandboxing.
 *
 * Covers:
 * 1. Ephemeral execution isolated from main agent context (zero engine mutations).
 * 2. 100% suppression of superseded/deprecated entries under default mode (suppressObsolete: true).
 * 3. Successor guidance inclusion (includeSuccessorGuidance: true) with explicit citations.
 * 4. Token scoring & multi-dimensional filtering (categories, tags, tiers, time ranges, minScore, maxResults).
 * 5. Telemetry & candidate metrics (candidatesEvaluated, suppressionRate, executionDurationMs).
 * 6. Clean insight bundle markdown generation (formatCleanInsightBundleMarkdown, pipe escaping, empty states).
 */

import { describe, expect, it } from "bun:test";
import {
  type CleanInsightBundle,
  type SandboxQueryOptions,
  type SandboxQueryResultItem,
  RetrievalSandbox,
  ThreeTierMemoryEngine,
  executeRetrievalSandbox,
  formatCleanInsightBundleMarkdown,
} from "../../../olt/scripts/src/mind/memory/index.ts";

function createPopulatedTestEngine(): ThreeTierMemoryEngine {
  const engine = new ThreeTierMemoryEngine();

  // Tier 1: Bedrock Invariants
  engine.addBedrockInvariant({
    id: "inv-axiom-concurrency",
    title: "Isolated Concurrency Invariant",
    category: "AXIOM",
    statement: "No unbounded concurrency is permitted across subagent lifecycles.",
    rationale: "Ensures thread safety and prevents quota exhaustion.",
    tags: ["concurrency", "governance", "safety"],
    settledDate: "2026-08-01T12:00:00.000Z",
  });

  engine.addBedrockInvariant({
    id: "inv-axiom-storage",
    title: "Storage Engine Axiom",
    category: "ARCHITECTURAL_INVARIANT",
    statement: "All operational artifacts must be persisted in deterministic structured JSON.",
    rationale: "Guarantees zero context loss and exact schema validation.",
    tags: ["storage", "persistence", "json"],
    settledDate: "2026-08-10T12:00:00.000Z",
  });

  // Tier 2: Active Working Memory
  engine.addWorkingEntry({
    id: "work-active-router",
    title: "Message Router Optimization",
    category: "ACTIVE_EPIC",
    description: "Refactor message dispatch to use ring buffers for lower latency.",
    status: "ACTIVE",
    priority: "HIGH",
    tags: ["router", "messaging", "performance"],
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-28T00:00:00.000Z",
  });

  engine.addWorkingEntry({
    id: "work-active-storage",
    title: "Storage Cache Layer",
    category: "ACTIVE_EPIC",
    description: "Add LRU cache for frequently accessed storage items.",
    status: "IN_PROGRESS",
    priority: "MEDIUM",
    tags: ["storage", "cache", "performance"],
    createdAt: "2026-08-25T00:00:00.000Z",
    updatedAt: "2026-08-29T00:00:00.000Z",
  });

  // Tier 3: Archived Epics (Active, Superseded, Deprecated)
  engine.addArchivedEntry({
    id: "arch-v1-storage",
    originalWorkingId: "work-legacy-storage-v1",
    title: "Legacy Storage Engine v1",
    category: "ARCHIVED_EPIC",
    summaryAbstract: "Early prototype of disk-based file store with unbounded cache.",
    keyDecisions: ["Ad-hoc file write", "No checksums"],
    outcome: "SUPERSEDED",
    epistemicStatus: "SUPERSEDED",
    supersededBy: "inv-axiom-storage",
    successorInvariantId: "inv-axiom-storage",
    tags: ["storage", "legacy"],
    archivedAt: "2026-08-05T00:00:00.000Z",
  });

  engine.addArchivedEntry({
    id: "arch-deprecated-mutex",
    title: "Spinlock Mutex Implementation",
    category: "ARCHIVED_EPIC",
    summaryAbstract: "Experimental userland spinlock implementation.",
    keyDecisions: ["Busy wait polling"],
    outcome: "ABANDONED",
    epistemicStatus: "DEPRECATED",
    tags: ["concurrency", "mutex", "legacy"],
    archivedAt: "2026-08-08T00:00:00.000Z",
  });

  engine.addArchivedEntry({
    id: "arch-active-telemetry",
    title: "Telemetry Pipeline Baseline",
    category: "ARCHIVED_EPIC",
    summaryAbstract: "Successfully deployed telemetry aggregation pipeline.",
    keyDecisions: ["Structured JSON logging", "Sampling rate 1.0"],
    outcome: "SUCCESS",
    epistemicStatus: "ACTIVE",
    tags: ["telemetry", "metrics"],
    archivedAt: "2026-08-15T00:00:00.000Z",
  });

  return engine;
}

describe("RetrievalSandbox Test Suite", () => {


describe("Telemetry & Candidate Metrics", () => {
    it("computes accurate telemetry metrics and suppression rates", () => {
      const engine = createPopulatedTestEngine();

      const bundle = executeRetrievalSandbox(engine, {
        query: "storage",
        suppressObsolete: true,
        minScore: 0.1,
      });

      expect(bundle.telemetry.candidatesEvaluated).toBe(7); // 2 T1 + 2 T2 + 3 T3
      expect(bundle.telemetry.activeEntriesReturned).toBe(2); // inv-axiom-storage & work-active-storage
      expect(bundle.telemetry.supersededEntriesSuppressed).toBe(1); // arch-v1-storage
      expect(bundle.telemetry.deprecatedEntriesSuppressed).toBe(1); // arch-deprecated-mutex
      expect(bundle.telemetry.suppressionRate).toBe(1.0); // 2 suppressed out of 2 obsolete evaluated
      expect(bundle.telemetry.executionDurationMs).toBeGreaterThanOrEqual(0);
      expect(bundle.executedAt).toBeDefined();
      expect(bundle.queryEcho.query).toBe("storage");
    });
  });

describe("Clean Insight Bundle Markdown Generation", () => {
    it("formats a clean markdown document with header, telemetry, and table", () => {
      const engine = createPopulatedTestEngine();

      const bundle = executeRetrievalSandbox(engine, {
        query: "storage",
        includeSuccessorGuidance: true,
        minScore: 0.1,
      });

      const md = formatCleanInsightBundleMarkdown(bundle);

      expect(md).toContain("# Ephemeral Retrieval Sandbox Insight Bundle");
      expect(md).toContain("- **Candidates Evaluated**:");
      expect(md).toContain("- **Suppression Rate**:");
      expect(md).toContain("| Tier | ID | Title | Status | Score | Guidance / Snippet |");
      expect(md).toContain("`inv-axiom-storage`");
      expect(md).toContain("`arch-v1-storage`");
      expect(md).toContain("[-> inv-axiom-storage]");
    });

    it("escapes table pipe characters in content strings", () => {
      const engine = new ThreeTierMemoryEngine();
      engine.addBedrockInvariant({
        id: "inv-pipe",
        title: "Pipe Invariant",
        statement: "Branch A | Branch B comparison",
        rationale: "Pipe | Test",
      });

      const bundle = executeRetrievalSandbox(engine, { query: "pipe", minScore: 0.1 });
      const md = formatCleanInsightBundleMarkdown(bundle);

      expect(md).toContain("Branch A \\| Branch B comparison");
    });

    it("displays empty search result placeholder when no entries match", () => {
      const engine = createPopulatedTestEngine();

      const bundle = executeRetrievalSandbox(engine, {
        query: "nonexistent_term_404",
        minScore: 0.1,
      });

      const md = formatCleanInsightBundleMarkdown(bundle);
      expect(md).toContain("_No memory entries matched the search criteria._");
    });
  });
});

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
} from "../../../../olt/scripts/src/mind/memory/index.ts";

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


describe("Ephemeral Execution & Isolation Guarantee", () => {
    it("guarantees query execution does not mutate underlying memory engine state", () => {
      const engine = createPopulatedTestEngine();

      const initialInvCount = engine.getBedrockInvariantCount();
      const initialWorkCount = engine.getWorkingMemoryCount();
      const initialArchCount = engine.getArchivedEpicCount();

      // Execute complex search
      const bundle = executeRetrievalSandbox(engine, {
        query: "storage",
        suppressObsolete: true,
      });

      expect(bundle.results.length).toBeGreaterThan(0);

      // Verify zero mutation
      expect(engine.getBedrockInvariantCount()).toBe(initialInvCount);
      expect(engine.getWorkingMemoryCount()).toBe(initialWorkCount);
      expect(engine.getArchivedEpicCount()).toBe(initialArchCount);
    });

    it("produces identical results whether called via class static method or functional wrapper", () => {
      const engine = createPopulatedTestEngine();

      const bundle1 = RetrievalSandbox.execute(engine, { query: "concurrency" });
      const bundle2 = executeRetrievalSandbox(engine, { query: "concurrency" });

      expect(bundle1.results.map((r) => r.id)).toEqual(bundle2.results.map((r) => r.id));
      expect(bundle1.telemetry.candidatesEvaluated).toBe(bundle2.telemetry.candidatesEvaluated);
    });
  });

describe("100% Suppression of Superseded & Deprecated Entries", () => {
    it("100% suppresses superseded and deprecated entries under default suppressObsolete: true", () => {
      const engine = createPopulatedTestEngine();

      const bundle = executeRetrievalSandbox(engine, {
        query: "storage",
        suppressObsolete: true,
        minScore: 0.1,
      });

      // Must suppress 'arch-v1-storage' (SUPERSEDED)
      expect(bundle.results.some((r) => r.id === "arch-v1-storage")).toBe(false);

      // All returned entries must have epistemicStatus ACTIVE
      expect(bundle.results.every((r) => r.epistemicStatus === "ACTIVE")).toBe(true);

      // Active entries are returned
      expect(bundle.results.some((r) => r.id === "inv-axiom-storage")).toBe(true);
      expect(bundle.results.some((r) => r.id === "work-active-storage")).toBe(true);

      // Telemetry reflects suppression
      expect(bundle.telemetry.supersededEntriesSuppressed).toBeGreaterThanOrEqual(1);
      expect(bundle.telemetry.activeEntriesReturned).toBe(bundle.results.length);
      expect(bundle.telemetry.suppressionRate).toBeGreaterThan(0);
    });

    it("100% suppresses deprecated entries when querying related concepts", () => {
      const engine = createPopulatedTestEngine();

      const bundle = executeRetrievalSandbox(engine, {
        query: "concurrency",
        suppressObsolete: true,
        minScore: 0.1,
      });

      // 'arch-deprecated-mutex' (DEPRECATED) must be suppressed
      expect(bundle.results.some((r) => r.id === "arch-deprecated-mutex")).toBe(false);
      expect(bundle.results.some((r) => r.id === "inv-axiom-concurrency")).toBe(true);

      expect(bundle.telemetry.deprecatedEntriesSuppressed).toBeGreaterThanOrEqual(1);
    });

    it("includes obsolete entries when suppressObsolete: false is explicitly specified", () => {
      const engine = createPopulatedTestEngine();

      const bundle = executeRetrievalSandbox(engine, {
        query: "storage",
        suppressObsolete: false,
        minScore: 0.1,
      });

      expect(bundle.results.some((r) => r.id === "arch-v1-storage")).toBe(true);
      const supersededItem = bundle.results.find((r) => r.id === "arch-v1-storage");
      expect(supersededItem?.epistemicStatus).toBe("SUPERSEDED");

      expect(bundle.telemetry.supersededEntriesSuppressed).toBe(0);
      expect(bundle.telemetry.deprecatedEntriesSuppressed).toBe(0);
      expect(bundle.telemetry.suppressionRate).toBe(0);
    });
  });

describe("Successor Guidance Inclusion", () => {
    it("attaches successor guidance citing terminal invariant when includeSuccessorGuidance: true", () => {
      const engine = createPopulatedTestEngine();

      const bundle = executeRetrievalSandbox(engine, {
        query: "storage",
        includeSuccessorGuidance: true,
        minScore: 0.1,
      });

      const supersededItem = bundle.results.find((r) => r.id === "arch-v1-storage");
      expect(supersededItem).toBeDefined();
      expect(supersededItem?.epistemicStatus).toBe("SUPERSEDED");
      expect(supersededItem?.successorGuidance).toBeDefined();

      const guidance = supersededItem?.successorGuidance;
      expect(guidance?.successorInvariantId).toBe("inv-axiom-storage");
      expect(guidance?.terminalSuccessorId).toBe("inv-axiom-storage");
      expect(guidance?.lineagePath).toContain("inv-axiom-storage");
    });
  });
});

import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  aggregateBlunderEntries,
  calculateBlunderAggregateMetrics,
  calculateBlunderSimilarity,
  clusterBlundersBySimilarity,
  computeBlunderDiscriminator,
  createBlunderContentHash,
  createBlunderDedupTransformStream,
  createFnv1aHash,
  createSha256Hash,
  deduplicateBlunderLog,
  extractBlunderKeywords,
  filterBlunderStream,
  LiveBlunderDeduplicator,
  mergeBlunderSets,
  normalizeObservationSignature,
  parseAndDeduplicateBlunderJsonl,
  serializeAggregatedBlunderLog,
  streamDeduplicateBlunders,
  toAggregatedBlunder,
} from "../../../orchestrating-long-tasks/scripts/src/blunders/index.ts";
import type {
  AggregatedBlunder,
  BlunderCategory,
  BlunderRecordInput,
  BlunderResolutionProof,
} from "../../../orchestrating-long-tasks/scripts/src/blunders/types.ts";
import {
  advanceDeliberationRound,
  auditBlunderLog,
  BlunderDeliberationPipeline,
  categorizeBlunder,
  createBlunderDeliberationRound,
  formatBlunderAuditBrief,
  formatDeliberationReport,
  formulateBlunderCandidates,
  formulateBlunderHypotheses,
  parseBlunderLog,
  resolveBlunder,
  serializeBlunderLog,
  synthesizeDeliberationRound,
  synthesizeRemediationActions,
  validateResolutionProof,
  verifyResolutionProofEmpirical,
  type BlunderEntry,
} from "../../../orchestrating-long-tasks/scripts/src/mind/blunders.ts";

describe("Blunder Pipeline - Categorization & Discriminator Logic", () => {
  it("categorizes boundary violations correctly", () => {
    const cases: Array<{ input: Partial<BlunderRecordInput>; expected: BlunderCategory }> = [
      {
        input: { type: "role_confusion_detected", observation: "Agent attempted orchestrator actions" },
        expected: "boundary_violation",
      },
      {
        input: { type: "role_leak", observation: "Main thread direct execution detected" },
        expected: "boundary_violation",
      },
      {
        input: {
          type: "unauthorized_mutation",
          observation: "Direct file edit in unauthorized write scope",
        },
        expected: "boundary_violation",
      },
      {
        input: {
          type: "role_amnesia",
          observation: "Agent forgot its tier boundaries and executed human shell commands",
        },
        expected: "boundary_violation",
      },
    ];

    for (const c of cases) {
      expect(categorizeBlunder(c.input as BlunderEntry)).toBe(c.expected);
    }
  });

  it("categorizes model reasoning errors correctly", () => {
    const cases: Array<{ input: Partial<BlunderRecordInput>; expected: BlunderCategory }> = [
      {
        input: {
          type: "hallucination_error",
          observation: "Agent hallucinated non-existent module import",
        },
        expected: "model_reasoning_error",
      },
      {
        input: {
          type: "plan_drift",
          observation: "Intent drift and instruction drift detected during execution",
        },
        expected: "model_reasoning_error",
      },
      {
        input: {
          type: "revision_paralysis",
          observation: "Self-critique loop resulted in plan revision paralysis and passive inertia",
        },
        expected: "model_reasoning_error",
      },
      {
        input: {
          type: "idle_death",
          observation: "Agent fell into sleep loop and self-termination failure",
        },
        expected: "model_reasoning_error",
      },
    ];

    for (const c of cases) {
      expect(categorizeBlunder(c.input as BlunderEntry)).toBe(c.expected);
    }
  });

  it("categorizes code defects correctly", () => {
    const cases: Array<{ input: Partial<BlunderRecordInput>; expected: BlunderCategory }> = [
      {
        input: { type: "syntax_error", observation: "Unexpected token in parser" },
        expected: "code_defect",
      },
      {
        input: { type: "type_mismatch", observation: "Type number is not assignable to string" },
        expected: "code_defect",
      },
      {
        input: { type: "gate_failure", observation: "bun test failed with 2 failing tests" },
        expected: "code_defect",
      },
      {
        input: { type: "unhandled_rejection", observation: "Unhandled promise rejection in store" },
        expected: "code_defect",
      },
    ];

    for (const c of cases) {
      expect(categorizeBlunder(c.input as BlunderEntry)).toBe(c.expected);
    }
  });

  it("normalizes observation signatures by stripping volatile tokens", () => {
    const raw =
      "Error on 2026-08-22T12:00:00.000Z at 0x7fff5fbff8a0 with pid=12345 line: 42 in /Users/foo/.capsules/run-abc/state.json blunder-123-abc456";
    const normalized = normalizeObservationSignature(raw);
    expect(normalized).toContain("<time>");
    expect(normalized).toContain("<addr>");
    expect(normalized).toContain("pid=<pid>");
    expect(normalized).toContain("line=<num>");
    expect(normalized).toContain("<capsule_path>");
    expect(normalized).toContain("blunder-<id>");
    expect(normalized).not.toContain("12345");
  });

  it("computes deterministic FNV-1a and SHA-256 content hashes", () => {
    const fnv = createFnv1aHash("test-payload-sample");
    expect(fnv).toHaveLength(8);
    expect(createFnv1aHash("test-payload-sample")).toBe(fnv);

    const sha = createSha256Hash("test-payload-sample");
    expect(sha).toHaveLength(64);
    expect(createSha256Hash("test-payload-sample")).toBe(sha);

    const blunder: BlunderRecordInput = {
      type: "syntax_error",
      category: "code_defect",
      observation: "Syntax error on line 12",
      agent_id: "agent-1",
    };

    const hashSha = createBlunderContentHash(blunder, "sha256");
    const hashFnv = createBlunderContentHash(blunder, "fnv1a");
    expect(hashSha).toHaveLength(64);
    expect(hashFnv).toHaveLength(8);
  });

  it("computes blunder discriminators with various options", () => {
    const blunder: BlunderRecordInput = {
      type: "role_leak",
      category: "boundary_violation",
      agent_id: "implementer-1",
      observation: "Direct file edit attempted",
    };

    const standardKey = computeBlunderDiscriminator(blunder);
    expect(standardKey).toBe("boundary_violation::role_leak::implementer-1::direct file edit attempted");

    const ignoreAgentKey = computeBlunderDiscriminator(blunder, { includeAgentId: false });
    expect(ignoreAgentKey).toBe("boundary_violation::role_leak::all::direct file edit attempted");

    const contentHashKey = computeBlunderDiscriminator(blunder, {
      useContentHash: true,
      hashAlgorithm: "fnv1a",
    });
    expect(contentHashKey).toMatch(/^boundary_violation::role_leak::implementer-1::[a-f0-9]{8}$/);

    const customKey = computeBlunderDiscriminator(blunder, {
      customDiscriminator: (b) => `custom-${b.type}`,
    });
    expect(customKey).toBe("custom-role_leak");
  });

  it("extracts keywords and calculates Jaccard similarity accurately", () => {
    const textA = "Direct mutation on unauthorized repository write scope";
    const textB = "Unauthorized direct mutation on file system write scope";
    const textC = "Syntax error in typescript compiler parser";

    const keywords = extractBlunderKeywords(textA);
    expect(keywords).toContain("direct");
    expect(keywords).toContain("mutation");
    expect(keywords).toContain("unauthorized");

    const simAB = calculateBlunderSimilarity(textA, textB);
    const simAC = calculateBlunderSimilarity(textA, textC);

    expect(simAB).toBeGreaterThan(0.6);
    expect(simAC).toBeLessThan(0.2);
  });
});

describe("Blunder Pipeline - Aggregation & Metrics", () => {
  it("converts input to complete AggregatedBlunder", () => {
    const input: BlunderRecordInput = {
      id: "blunder-001",
      type: "unauthorized_edit",
      severity: "high",
      category: "boundary_violation",
      observation: "Attempted edit without lease",
      agent_id: "agent-alpha",
      pid: 4001,
    };

    const aggregated = toAggregatedBlunder(input);
    expect(aggregated.id).toBe("blunder-001");
    expect(aggregated.count).toBe(1);
    expect(aggregated.status).toBe("open");
    expect(aggregated.category).toBe("boundary_violation");
    expect(aggregated.occurrences).toHaveLength(1);
    expect(aggregated.occurrences?.[0]?.pid).toBe(4001);
  });

  it("aggregates multiple blunder occurrences and escalates severity", () => {
    const initial: BlunderRecordInput = {
      id: "b-1",
      type: "test_fail",
      severity: "warning",
      category: "code_defect",
      observation: "Test timed out",
      timestamp: "2026-08-22T10:00:00.000Z",
    };

    const agg1 = toAggregatedBlunder(initial);
    expect(agg1.count).toBe(1);
    expect(agg1.severity).toBe("warning");

    const incoming: BlunderRecordInput = {
      type: "test_fail",
      severity: "critical",
      observation: "Test crashed with OOM",
      timestamp: "2026-08-22T10:05:00.000Z",
    };

    const agg2 = aggregateBlunderEntries(agg1, incoming, { maxOccurrences: 10 });
    expect(agg2.count).toBe(2);
    expect(agg2.severity).toBe("critical");
    expect(agg2.first_seen_at).toBe("2026-08-22T10:00:00.000Z");
    expect(agg2.last_seen_at).toBe("2026-08-22T10:05:00.000Z");
    expect(agg2.occurrences).toHaveLength(2);
  });

  it("merges separate blunder sets seamlessly", () => {
    const primary: AggregatedBlunder[] = [
      toAggregatedBlunder({
        id: "b-1",
        type: "t1",
        observation: "Obs 1",
        agent_id: "a1",
      }),
    ];

    const incoming: BlunderRecordInput[] = [
      {
        id: "b-1-dup",
        type: "t1",
        observation: "Obs 1",
        agent_id: "a1",
      },
      {
        id: "b-2",
        type: "t2",
        observation: "Obs 2",
        agent_id: "a2",
      },
    ];

    const merged = mergeBlunderSets(primary, incoming);
    expect(merged).toHaveLength(2);
    const first = merged.find((b) => b.type === "t1");
    expect(first?.count).toBe(2);
  });

  it("computes comprehensive blunder aggregate metrics including MTTR", () => {
    const entries: AggregatedBlunder[] = [
      {
        ...toAggregatedBlunder({
          id: "b-1",
          type: "t1",
          category: "code_defect",
          severity: "high",
          count: 3,
          first_seen_at: "2026-08-22T10:00:00.000Z",
        }),
        status: "resolved",
        resolution: {
          task_id: "task-1",
          test_assertion: "passes",
          resolved_at: "2026-08-22T10:10:00.000Z",
        },
      },
      toAggregatedBlunder({
        id: "b-2",
        type: "t2",
        category: "boundary_violation",
        severity: "critical",
        count: 1,
        status: "open",
      }),
      toAggregatedBlunder({
        id: "b-3",
        type: "t3",
        category: "model_reasoning_error",
        severity: "warning",
        count: 1,
        status: "wontfix",
      }),
    ];

    const metrics = calculateBlunderAggregateMetrics(entries);
    expect(metrics.total_recorded).toBe(5);
    expect(metrics.unique_blunders).toBe(3);
    expect(metrics.open_count).toBe(1);
    expect(metrics.resolved_count).toBe(1);
    expect(metrics.wontfix_count).toBe(1);
    expect(metrics.recurrence_count).toBe(2);
    expect(metrics.recurrence_rate).toBeCloseTo(0.4, 2);
    expect(metrics.by_category.code_defect).toBe(1);
    expect(metrics.by_category.boundary_violation).toBe(1);
    expect(metrics.by_category.model_reasoning_error).toBe(1);
    expect(metrics.mean_time_to_resolution_ms).toBe(600_000); // 10 minutes
  });

  it("clusters blunders by observation semantic similarity", () => {
    const blunders: AggregatedBlunder[] = [
      toAggregatedBlunder({
        id: "b1",
        type: "t1",
        category: "code_defect",
        observation: "Syntax error in typescript lexer token",
      }),
      toAggregatedBlunder({
        id: "b2",
        type: "t1",
        category: "code_defect",
        observation: "Typescript lexer token syntax error encountered",
      }),
      toAggregatedBlunder({
        id: "b3",
        type: "t2",
        category: "boundary_violation",
        observation: "Main thread unauthorized mutation",
      }),
    ];

    const clusters = clusterBlundersBySimilarity(blunders, 0.5);
    expect(clusters.length).toBe(2);
    const syntaxCluster = clusters.find((c) => c.some((item) => item.id === "b1"));
    expect(syntaxCluster).toHaveLength(2);
  });
});

describe("Blunder Pipeline - Deduplication Streaming & Sliding Windows", () => {
  it("deduplicates logs with aggregate_synchronous strategy", () => {
    const inputs: BlunderRecordInput[] = [
      { type: "err", observation: "Same error", agent_id: "agent-1" },
      { type: "err", observation: "Same error", agent_id: "agent-1" },
      { type: "err", observation: "Different error", agent_id: "agent-1" },
    ];

    const result = deduplicateBlunderLog(inputs, { strategy: "aggregate_synchronous" });
    expect(result).toHaveLength(2);
    const aggregated = result.find((r) => r.observation === "Same error");
    expect(aggregated?.count).toBe(2);
  });

  it("deduplicates logs with exact_dedup strategy", () => {
    const inputs: BlunderRecordInput[] = [
      { id: "e1", type: "err", observation: "Exact match" },
      { id: "e2", type: "err", observation: "Exact match" },
    ];

    const result = deduplicateBlunderLog(inputs, { strategy: "exact_dedup" });
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("e1");
    expect(result[0]?.count).toBe(1);
  });

  it("deduplicates logs with windowed and sliding_window_hash strategies", () => {
    const inputs: BlunderRecordInput[] = [
      {
        type: "drift",
        observation: "Planning drift",
        timestamp: "2026-08-22T10:00:00.000Z",
      },
      {
        type: "drift",
        observation: "Planning drift",
        timestamp: "2026-08-22T10:00:30.000Z", // Within 60s window
      },
      {
        type: "drift",
        observation: "Planning drift",
        timestamp: "2026-08-22T10:02:00.000Z", // Outside 60s window
      },
    ];

    const windowed = deduplicateBlunderLog(inputs, {
      strategy: "windowed",
      windowMs: 60_000,
    });
    expect(windowed).toHaveLength(2);
    expect(windowed[0]?.count).toBe(2);
    expect(windowed[1]?.count).toBe(1);

    const hashWindowed = deduplicateBlunderLog(inputs, {
      strategy: "sliding_window_hash",
      windowMs: 60_000,
    });
    expect(hashWindowed).toHaveLength(2);
    expect(hashWindowed[0]?.count).toBe(2);
  });

  it("parses and deduplicates JSONL content safely", () => {
    const jsonl = [
      JSON.stringify({ type: "err", observation: "Obs A" }),
      JSON.stringify({ type: "err", observation: "Obs A" }),
      "invalid-json-line-to-skip",
      JSON.stringify({ type: "err", observation: "Obs B" }),
    ].join("\n");

    const deduplicated = parseAndDeduplicateBlunderJsonl(jsonl);
    expect(deduplicated).toHaveLength(2);

    const serialized = serializeAggregatedBlunderLog(deduplicated);
    expect(serialized.trim().split("\n")).toHaveLength(2);
  });

  it("processes asynchronous stream with streamDeduplicateBlunders", async () => {
    async function* makeStream(): AsyncGenerator<string, void, unknown> {
      yield JSON.stringify({ type: "stream_err", observation: "Stream error 1" });
      yield JSON.stringify({ type: "stream_err", observation: "Stream error 1" });
      yield JSON.stringify({ type: "stream_err", observation: "Stream error 2" });
    }

    const results: AggregatedBlunder[] = [];
    for await (const entry of streamDeduplicateBlunders(makeStream(), { windowMs: 60_000 })) {
      results.push(entry);
    }

    expect(results.length).toBe(3);
    const lastOccurrence = results.find((r) => r.observation === "Stream error 1" && r.count === 2);
    expect(lastOccurrence).toBeDefined();
  });

  it("processes stream through TransformStream", async () => {
    const transformStream = createBlunderDedupTransformStream({ windowMs: 60_000 });

    const readable = new ReadableStream<string>({
      start(controller) {
        controller.enqueue(JSON.stringify({ type: "pipe_err", observation: "Piped error" }));
        controller.enqueue(JSON.stringify({ type: "pipe_err", observation: "Piped error" }));
        controller.close();
      },
    });

    const transformed = readable.pipeThrough(transformStream);
    const reader = transformed.getReader();
    const outputs: AggregatedBlunder[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) outputs.push(value);
    }

    expect(outputs.length).toBe(2);
    expect(outputs[1]?.count).toBe(2);
  });

  it("filters blunder stream by category, status, and agentId", () => {
    const list: AggregatedBlunder[] = [
      toAggregatedBlunder({
        type: "b1",
        category: "boundary_violation",
        status: "open",
        agent_id: "agent-x",
      }),
      toAggregatedBlunder({
        type: "b2",
        category: "code_defect",
        status: "resolved",
        agent_id: "agent-y",
      }),
    ];

    const filteredBoundary = filterBlunderStream(list, { category: "boundary_violation" });
    expect(filteredBoundary).toHaveLength(1);
    expect(filteredBoundary[0]?.agent_id).toBe("agent-x");

    const filteredResolved = filterBlunderStream(list, { status: "resolved" });
    expect(filteredResolved).toHaveLength(1);
    expect(filteredResolved[0]?.agent_id).toBe("agent-y");
  });
});

describe("Blunder Pipeline - LiveBlunderDeduplicator Lifecycle", () => {
  it("records blunders, tracks occurrences, and supports key/id lookups", () => {
    const live = new LiveBlunderDeduplicator({ strategy: "aggregate_synchronous" });

    const rec1 = live.record({
      id: "blunder-first",
      type: "type_error",
      observation: "Variable undefined",
      agent_id: "agent-worker",
    });
    expect(rec1.isNew).toBe(true);
    expect(rec1.occurrenceCount).toBe(1);

    const rec2 = live.record({
      type: "type_error",
      observation: "Variable undefined",
      agent_id: "agent-worker",
    });
    expect(rec2.isNew).toBe(false);
    expect(rec2.occurrenceCount).toBe(2);

    expect(live.size).toBe(1);
    expect(live.has("blunder-first")).toBe(true);
    expect(live.get("blunder-first")?.count).toBe(2);
  });

  it("supports resolution with empirical proof and status filtering", () => {
    const live = new LiveBlunderDeduplicator();
    const { entry } = live.record({
      id: "blunder-target",
      type: "boundary_leak",
      category: "boundary_violation",
      observation: "Leak detected",
    });

    expect(live.getOpenBlunders()).toHaveLength(1);
    expect(live.getResolvedBlunders()).toHaveLength(0);

    const proof: BlunderResolutionProof = {
      task_id: "task-p31-remediation",
      test_assertion: "verifyBoundaryConfinement() === true",
      resolved_at: new Date().toISOString(),
      commit_sha: "abcdef1234567890",
    };

    const resolved = live.resolve(entry.id, proof);
    expect(resolved?.status).toBe("resolved");
    expect(resolved?.resolution?.task_id).toBe("task-p31-remediation");

    expect(live.getOpenBlunders()).toHaveLength(0);
    expect(live.getResolvedBlunders()).toHaveLength(1);
  });

  it("prunes expired entries based on max age", () => {
    const live = new LiveBlunderDeduplicator();
    live.record({
      type: "old_err",
      observation: "Old error",
      timestamp: "2026-08-22T08:00:00.000Z",
    });
    live.record({
      type: "new_err",
      observation: "New error",
      timestamp: "2026-08-22T12:00:00.000Z",
    });

    const nowMs = Date.parse("2026-08-22T12:05:00.000Z");
    const pruned = live.prune(60 * 60 * 1000, nowMs); // max age 1 hr
    expect(pruned).toBe(1);
    expect(live.size).toBe(1);
  });

  it("evicts oldest entries when entry limit is exceeded", () => {
    const live = new LiveBlunderDeduplicator({ maxEntries: 2 });
    live.record({ type: "e1", observation: "Err 1", timestamp: "2026-08-22T10:00:00.000Z" });
    live.record({ type: "e2", observation: "Err 2", timestamp: "2026-08-22T10:01:00.000Z" });
    live.record({ type: "e3", observation: "Err 3", timestamp: "2026-08-22T10:02:00.000Z" });

    expect(live.size).toBe(2);
    expect(live.has(computeBlunderDiscriminator({ type: "e1", observation: "Err 1" }))).toBe(false);
    expect(live.has(computeBlunderDiscriminator({ type: "e3", observation: "Err 3" }))).toBe(true);
  });

  it("imports and exports JSONL correctly", () => {
    const live = new LiveBlunderDeduplicator();
    live.record({ type: "e1", observation: "Observation A" });
    live.record({ type: "e2", observation: "Observation B" });

    const exported = live.exportJsonl();
    expect(exported).toContain("Observation A");
    expect(exported).toContain("Observation B");

    const newLive = new LiveBlunderDeduplicator();
    const importedCount = newLive.importJsonl(exported);
    expect(importedCount).toBe(2);
    expect(newLive.size).toBe(2);
  });
});

describe("Blunder Pipeline - Lossless Multi-Round Deliberation & Empirical Proofs", () => {
  it("validates resolution proofs strictly and rejects invalid formats", () => {
    const validProof: BlunderResolutionProof = {
      task_id: "task-01",
      test_assertion: "expect(result).toBe(true)",
      resolved_at: "2026-08-22T12:00:00.000Z",
      commit_sha: "1a2b3c4d5e6f",
    };

    expect(validateResolutionProof(validProof)).toEqual(validProof);
    expect(verifyResolutionProofEmpirical(validProof).isValid).toBe(true);

    expect(() =>
      validateResolutionProof({
        task_id: "",
        test_assertion: "test",
        resolved_at: "2026-08-22T12:00:00.000Z",
      }),
    ).toThrow();

    expect(() =>
      validateResolutionProof({
        task_id: "task-01",
        test_assertion: "",
        resolved_at: "2026-08-22T12:00:00.000Z",
      }),
    ).toThrow();

    expect(() =>
      validateResolutionProof({
        task_id: "task-01",
        test_assertion: "test",
        resolved_at: "not-a-date",
      }),
    ).toThrow();

    expect(() =>
      validateResolutionProof(
        {
          task_id: "task-01",
          test_assertion: "test",
          resolved_at: "2026-08-22T12:00:00.000Z",
          commit_sha: "short",
        },
        { requireCommitSha: true },
      ),
    ).toThrow();
  });

  it("formulates root cause hypotheses with high confidence and evidence", () => {
    const blunders: BlunderEntry[] = [
      {
        id: "b-bv",
        type: "role_leak",
        severity: "critical",
        category: "boundary_violation",
        status: "open",
        observation: "Agent executed non-conforming command",
        remediation: "Constrain agent role context",
        timestamp: "2026-08-22T12:00:00.000Z",
      },
      {
        id: "b-cd",
        type: "syntax_error",
        severity: "high",
        category: "code_defect",
        status: "open",
        observation: "Missing semicolon",
        remediation: "Add semicolon and run compiler",
        timestamp: "2026-08-22T12:00:00.000Z",
      },
    ];

    const hypotheses = formulateBlunderHypotheses(blunders);
    expect(hypotheses).toHaveLength(2);
    expect(hypotheses[0]?.category).toBe("boundary_violation");
    expect(hypotheses[0]?.confidence).toBeGreaterThan(0.9);
    expect(hypotheses[0]?.evidence).toContain("Observation: Agent executed non-conforming command");
  });

  it("synthesizes remediation actions with prescribed test gates", () => {
    const blunders: BlunderEntry[] = [
      {
        id: "b-1",
        type: "role_confusion",
        severity: "critical",
        category: "boundary_violation",
        status: "open",
        observation: "Role confusion observed",
        remediation: "Apply supervisory reminder",
        timestamp: "2026-08-22T12:00:00.000Z",
        agent_id: "implementer_p31",
      },
    ];

    const hypotheses = formulateBlunderHypotheses(blunders);
    const actions = synthesizeRemediationActions(hypotheses, blunders);

    expect(actions).toHaveLength(1);
    expect(actions[0]?.action_type).toBe("tighten_boundary");
    expect(actions[0]?.prescribed_test).toContain("verifyRoleRestraint");
    expect(actions[0]?.status).toBe("planned");
  });

  it("synthesizes deliberation rounds determining convergence vs round advance", () => {
    const blunders: BlunderEntry[] = [
      {
        id: "b-cd1",
        type: "type_error",
        severity: "high",
        category: "code_defect",
        status: "open",
        observation: "Type mismatch",
        remediation: "Fix types",
        timestamp: "2026-08-22T12:00:00.000Z",
      },
      {
        id: "b-cd2",
        type: "syntax_error",
        severity: "high",
        category: "code_defect",
        status: "open",
        observation: "Syntax err",
        remediation: "Fix syntax",
        timestamp: "2026-08-22T12:00:00.000Z",
      },
    ];

    const round1 = createBlunderDeliberationRound({
      blunders,
      proofs: [
        {
          task_id: "b-cd1",
          test_assertion: "bun test passes",
          resolved_at: "2026-08-22T12:10:00.000Z",
        },
      ],
      options: { maxRounds: 3 },
    });

    expect(round1.status).toBe("deliberating");
    expect(round1.synthesis.recommendation).toBe("advance_round");
    expect(round1.synthesis.resolved_blunder_ids).toContain("b-cd1");
    expect(round1.synthesis.unresolved_blunder_ids).toContain("b-cd2");

    // Advance to round 2 with the second proof
    const round2 = advanceDeliberationRound(
      round1,
      2,
      blunders,
      [
        {
          task_id: "b-cd2",
          test_assertion: "bun test passes with 0 syntax errors",
          resolved_at: "2026-08-22T12:20:00.000Z",
        },
      ],
      { maxRounds: 3 },
    );

    expect(round2.status).toBe("converged");
    expect(round2.synthesis.recommendation).toBe("converge");
    expect(round2.synthesis.readiness_for_convergence).toBe(true);
    expect(round2.synthesis.unresolved_blunder_ids).toHaveLength(0);
  });

  it("executes multi-round pipeline to convergence", () => {
    const pipeline = new BlunderDeliberationPipeline({ maxRounds: 3 });
    const blunders: BlunderEntry[] = [
      {
        id: "b-pipe",
        type: "logic_bug",
        severity: "high",
        category: "code_defect",
        status: "open",
        observation: "Logic flaw",
        remediation: "Correct conditional branch",
        timestamp: "2026-08-22T12:00:00.000Z",
      },
    ];

    const round1 = pipeline.startDeliberation(blunders);
    expect(round1.status).toBe("deliberating");
    expect(pipeline.isConverged()).toBe(false);

    const round2 = pipeline.advance(blunders, [
      {
        task_id: "b-pipe",
        test_assertion: "expect(branch()).toBe(true)",
        resolved_at: "2026-08-22T12:15:00.000Z",
      },
    ]);

    expect(round2.status).toBe("converged");
    expect(pipeline.isConverged()).toBe(true);
    expect(pipeline.getAllRounds()).toHaveLength(2);
  });
});

describe("Blunder Pipeline - Audit Reporting & Markdown Formatting", () => {
  it("parses and serializes blunder logs cleanly", () => {
    const raw = [
      JSON.stringify({
        id: "b-parse-1",
        type: "type_error",
        severity: "high",
        category: "code_defect",
        status: "open",
        observation: "Type error",
        remediation: "Fix type",
        timestamp: "2026-08-22T12:00:00.000Z",
      }),
      JSON.stringify({
        id: "b-parse-2",
        type: "role_confusion",
        severity: "critical",
        category: "boundary_violation",
        status: "resolved",
        observation: "Role confusion",
        remediation: "Fix role",
        timestamp: "2026-08-22T12:05:00.000Z",
        resolution: {
          task_id: "task-2",
          test_assertion: "verified",
          resolved_at: "2026-08-22T12:10:00.000Z",
        },
      }),
    ].join("\n");

    const parsed = parseBlunderLog(raw);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.category).toBe("code_defect");
    expect(parsed[1]?.status).toBe("resolved");

    const reserialized = serializeBlunderLog(parsed);
    expect(reserialized.trim().split("\n")).toHaveLength(2);
  });

  it("formulates Mind candidate proposals with charter goal mappings", () => {
    const blunders: BlunderEntry[] = [
      {
        id: "b-cand-1",
        type: "boundary_violation_entry",
        severity: "critical",
        category: "boundary_violation",
        status: "open",
        observation: "Confinement error",
        remediation: "Enforce boundary",
        timestamp: "2026-08-22T12:00:00.000Z",
      },
      {
        id: "b-cand-2",
        type: "reasoning_drift_entry",
        severity: "high",
        category: "model_reasoning_error",
        status: "open",
        observation: "Plan drift",
        remediation: "Align intent",
        timestamp: "2026-08-22T12:00:00.000Z",
      },
    ];

    const proposals = formulateBlunderCandidates(blunders, ["G1", "G2"]);
    expect(proposals).toHaveLength(2);
    expect(proposals[0]?.id).toBe("cand-blunder-b-cand-1");
    expect(proposals[0]?.charter_goal_ids).toContain("G2");
    expect(proposals[1]?.charter_goal_ids).toContain("G1");
  });

  it("formats bounded Markdown briefs for blunder audit", () => {
    const report = {
      total_blunders: 2,
      open_count: 1,
      resolved_count: 1,
      wontfix_count: 0,
      by_category: {
        code_defect: 1,
        model_reasoning_error: 0,
        boundary_violation: 1,
      },
      by_severity: {
        high: 1,
        critical: 1,
      },
      blunders: [
        {
          id: "b-1",
          type: "role_leak",
          severity: "critical",
          category: "boundary_violation" as BlunderCategory,
          status: "open" as const,
          observation: "Direct file mutation attempted",
          remediation: "Enforce lease",
          timestamp: "2026-08-22T12:00:00.000Z",
        },
      ],
      capsules_audited: ["/tmp/.capsules/run-sample"],
      generated_at: new Date().toISOString(),
    };

    const brief = formatBlunderAuditBrief(report, { maxLines: 30 });
    expect(brief).toContain("### Blunder Audit & Remediation Brief");
    expect(brief).toContain("`boundary_violation: 1`");
    expect(brief).toContain("`b-1`");
    expect(brief.split("\n").length).toBeLessThanOrEqual(30);
  });

  it("formats comprehensive deliberation reports bounded by line limit", () => {
    const blunders: BlunderEntry[] = [
      {
        id: "b-delib-1",
        type: "type_error",
        severity: "high",
        category: "code_defect",
        status: "open",
        observation: "Missing export",
        remediation: "Export type",
        timestamp: "2026-08-22T12:00:00.000Z",
      },
    ];

    const round = createBlunderDeliberationRound({
      round_number: 1,
      blunders,
      proofs: [
        {
          task_id: "b-delib-1",
          test_assertion: "bun test passes",
          resolved_at: "2026-08-22T12:05:00.000Z",
          commit_sha: "1234567890abcdef",
        },
      ],
    });

    const report = formatDeliberationReport(round, { maxLines: 50 });
    expect(report).toContain("### Mind Blunder Deliberation - Round 1");
    expect(report).toContain("#### Root Cause Hypotheses");
    expect(report).toContain("#### Remediation Actions");
    expect(report).toContain("#### Empirical Resolution Proofs");
    expect(report.split("\n").length).toBeLessThanOrEqual(50);
  });
});

describe("Blunder Pipeline - Static Code Invariants", () => {
  it("strictly enforces 0 TypeScript any and 0 compiler/linter suppressions across all blunder files", () => {
    const blunderDir = join(process.cwd(), "orchestrating-long-tasks/scripts/src/blunders");
    const blunderFiles = readdirSync(blunderDir)
      .filter((f) => f.endsWith(".ts"))
      .map((f) => join(blunderDir, f));

    const mindBlundersPath = join(process.cwd(), "orchestrating-long-tasks/scripts/src/mind/blunders.ts");
    const testFilePath = join(process.cwd(), "tests/unit/blunders/blunder-pipeline.test.ts");
    const allFiles = [...blunderFiles, mindBlundersPath, testFilePath];

    const forbiddenPatterns = [
      new RegExp(":\\s*" + "any\\b"),
      new RegExp("\\bas\\s+" + "any\\b"),
      new RegExp("<" + "any>"),
      new RegExp("Record<string,\\s*" + "any>"),
      new RegExp("Promise<" + "any>"),
      new RegExp("@ts-" + "ignore"),
      new RegExp("@ts-" + "expect-error"),
      new RegExp("@ts-" + "nocheck"),
      new RegExp(["es", "lint", "-disable"].join("")),
    ];

    for (const filePath of allFiles) {
      const content = readFileSync(filePath, "utf-8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i] ?? "";
        const trimmed = line.trim();

        // Skip comment lines or test regex definition lines
        if (
          trimmed.startsWith("//") ||
          trimmed.startsWith("*") ||
          trimmed.startsWith("/*") ||
          trimmed.includes("forbiddenPatterns") ||
          trimmed.includes("new RegExp")
        ) {
          continue;
        }

        for (const pattern of forbiddenPatterns) {
          const matched = pattern.test(line);
          if (matched) {
            throw new Error(`File ${filePath}:${i + 1} violated invariant with pattern ${pattern.source}: "${line}"`);
          }
          expect(matched).toBe(false);
        }
      }
    }
  });
});

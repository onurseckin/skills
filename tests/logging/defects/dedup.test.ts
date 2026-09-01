import { describe, expect, test } from "bun:test";
import {
  categorizeDefect,
  computeDefectDedupKey,
  createDefectContentHash,
  createFnv1aHash,
  createSha256Hash,
  deduplicateDefectLog,
  deserializeDefectRecord,
  mergeDuplicateDefect,
  mergeStatus,
  normalizeText,
  parseDefectLog,
  pickHigherSeverity,
  resolveDefect,
  resolveDefectRecord,
  serializeAggregatedDefectLog,
  serializeDefectLog,
  toAggregatedDefect,
  validateResolutionProof,
  verifyResolutionProofEmpirical,
} from "../../../olt/scripts/src/logging/defects/index.ts";
import type {
  AggregatedDefect,
  DefectEntry,
  DefectRecordInput,
  DefectResolutionProof,
} from "../../../olt/scripts/src/logging/defects/index.ts";

describe("Defect Deduplication and Lifecycle Engine", () => {
  test("computeDefectDedupKey normalizes variable patterns in observations", () => {
    const k1 = computeDefectDedupKey({
      category: "code_defect",
      type: "syntax_error",
      agent_id: "agent-1",
      observation:
        "Error at 2026-08-29T12:00:00.000Z in /repo/.capsules/run-123/main.ts line: 42 with hash 1234567890abcdef1234567890abcdef",
    });
    const k2 = computeDefectDedupKey({
      category: "code_defect",
      type: "syntax_error",
      agent_id: "agent-1",
      observation:
        "Error at 2026-08-29T14:30:00.000Z in /repo/.capsules/run-999/main.ts line: 99 with hash abcdef1234567890abcdef1234567890",
    });
    expect(k1).toBe(k2);
  });

  test("computeDefectDedupKey handles content hashing with fnv1a and sha256", () => {
    const input: DefectRecordInput = {
      category: "boundary_violation",
      type: "unauthorized_write",
      observation: "Agent wrote to protected path",
    };
    const fnvKey = computeDefectDedupKey(input, { useContentHash: true, hashAlgorithm: "fnv1a" });
    const shaKey = computeDefectDedupKey(input, { useContentHash: true, hashAlgorithm: "sha256" });
    expect(fnvKey).toContain("boundary_violation::unauthorized_write");
    expect(shaKey).toContain("boundary_violation::unauthorized_write");
    expect(fnvKey).not.toBe(shaKey);
    expect(createFnv1aHash("test string")).toHaveLength(8);
    expect(createSha256Hash("test string")).toHaveLength(64);
    expect(createDefectContentHash(input, "fnv1a")).toHaveLength(8);
  });

  test("categorizeDefect classifies defect types and heuristic keywords", () => {
    expect(categorizeDefect({ category: "security_risk" })).toBe("security_risk");
    expect(categorizeDefect({ category: "confinement_breach" })).toBe("boundary_violation");
    expect(categorizeDefect({ category: "hallucination" })).toBe("model_reasoning_error");
    expect(categorizeDefect({ observation: "Supervisor leaked write scope boundary" })).toBe(
      "boundary_violation",
    );
    expect(
      categorizeDefect({ observation: "Model experienced reasoning drift during planning" }),
    ).toBe("model_reasoning_error");
    expect(categorizeDefect({ observation: "TypeError: undefined is not a function" })).toBe(
      "code_defect",
    );
  });

  test("mergeStatus and pickHigherSeverity handle precedence rules", () => {
    expect(pickHigherSeverity("low", "critical")).toBe("critical");
    expect(pickHigherSeverity("warning", "high")).toBe("high");
    expect(pickHigherSeverity("info", "warning")).toBe("warning");
    expect(mergeStatus("open", "resolved")).toBe("resolved");
    expect(mergeStatus("resolved", "open")).toBe("resolved");
    expect(mergeStatus("open", "wontfix")).toBe("wontfix");
    expect(mergeStatus("open", "open")).toBe("open");
  });

  test("mergeDuplicateDefect aggregates counts, occurrences, and metadata", () => {
    const init = toAggregatedDefect({
      id: "defect-1",
      category: "code_defect",
      type: "syntax_error",
      severity: "low",
      status: "open",
      observation: "Missing semicolon",
      timestamp: "2026-08-29T10:00:00.000Z",
    });
    const merged = mergeDuplicateDefect(
      init,
      {
        id: "defect-2",
        category: "code_defect",
        type: "syntax_error",
        severity: "critical",
        status: "open",
        observation: "Missing semicolon",
        timestamp: "2026-08-29T11:00:00.000Z",
      },
      "run-abc",
    );
    expect(merged.count).toBe(2);
    expect(merged.severity).toBe("critical");
    expect(merged.first_seen_at).toBe("2026-08-29T10:00:00.000Z");
    expect(merged.last_seen_at).toBe("2026-08-29T11:00:00.000Z");
    expect(merged.occurrences).toHaveLength(2);
    expect(merged.occurrences[1]?.metadata).toEqual({ run_id: "run-abc" });
  });

  test("deduplicateDefectLog supports aggregate_synchronous and exact_dedup strategies", () => {
    const inputs: DefectRecordInput[] = [
      { id: "d1", type: "t1", category: "code_defect", observation: "Same error" },
      { id: "d2", type: "t1", category: "code_defect", observation: "Same error" },
      { id: "d3", type: "t2", category: "code_defect", observation: "Different error" },
    ];
    const syncAgg = deduplicateDefectLog(inputs, { strategy: "aggregate_synchronous" });
    expect(syncAgg).toHaveLength(2);
    expect(syncAgg[0]?.count).toBe(2);
    expect(syncAgg[1]?.count).toBe(1);
    const exact = deduplicateDefectLog(inputs, { strategy: "exact_dedup" });
    expect(exact).toHaveLength(2);
    expect(exact[0]?.count).toBe(1);
  });

  test("deduplicateDefectLog supports windowed deduplication", () => {
    const inputs: DefectRecordInput[] = [
      { id: "d1", type: "t1", observation: "Err", timestamp: "2026-08-29T10:00:00.000Z" },
      { id: "d2", type: "t1", observation: "Err", timestamp: "2026-08-29T10:00:30.000Z" },
      { id: "d3", type: "t1", observation: "Err", timestamp: "2026-08-29T12:00:00.000Z" },
    ];
    const windowed = deduplicateDefectLog(inputs, { strategy: "windowed", windowMs: 60_000 });
    expect(windowed).toHaveLength(2);
    expect(windowed[0]?.count).toBe(2);
    expect(windowed[1]?.count).toBe(1);
  });

  test("serializeAggregatedDefectLog and deserializeDefectRecord serialize/deserialize records", () => {
    const defect = toAggregatedDefect({
      id: "defect-jsonl-1",
      type: "test_type",
      category: "code_defect",
      observation: "Testing serialization",
    });
    const serialized = serializeAggregatedDefectLog([defect]);
    expect(serialized).toContain("defect-jsonl-1");
    expect(serialized.endsWith("\n")).toBeTrue();
    const deserialized = deserializeDefectRecord(serialized.trim());
    expect(deserialized?.id).toBe("defect-jsonl-1");
    expect(deserialized?.category).toBe("code_defect");
    expect(deserializeDefectRecord("")).toBeNull();
    expect(deserializeDefectRecord("invalid json")).toBeNull();
    expect(serializeAggregatedDefectLog([])).toBe("");
  });

  test("validateResolutionProof validates required fields and timestamps", () => {
    const validProof: DefectResolutionProof = {
      task_id: "task-123",
      test_assertion: "bun test tests/logging/foo.test.ts",
      resolved_at: "2026-08-29T12:00:00.000Z",
      commit_sha: "abcdef123",
    };
    const validated = validateResolutionProof(validProof, { requireCommitSha: true });
    expect(validated.task_id).toBe("task-123");
    expect(validated.commit_sha).toBe("abcdef123");
    expect(() => validateResolutionProof(null)).toThrow(/must be an object/);
    expect(() =>
      validateResolutionProof({ test_assertion: "t", resolved_at: "2026-08-29T12:00:00.000Z" }),
    ).toThrow(/task_id/);
    expect(() =>
      validateResolutionProof({ task_id: "t", test_assertion: "a", resolved_at: "invalid-date" }),
    ).toThrow(/ISO date timestamp/);
    expect(() =>
      validateResolutionProof(
        { task_id: "t", test_assertion: "a", resolved_at: "2026-08-29T12:00:00.000Z" },
        { requireCommitSha: true },
      ),
    ).toThrow(/commit_sha/);
  });

  test("resolveDefectRecord updates defect status to resolved with proof", () => {
    const defect: AggregatedDefect = {
      id: "defect-1",
      dedup_key: "key-1",
      category: "code_defect",
      type: "syntax_error",
      status: "open",
      severity: "critical",
      observation_signature: "syntax error",
      count: 1,
      occurrences: [
        { id: "defect-1", timestamp: "2026-08-29T12:00:00.000Z", observation: "syntax error" },
      ],
      created_at: "2026-08-29T12:00:00.000Z",
      updated_at: "2026-08-29T12:00:00.000Z",
    };
    const proof: DefectResolutionProof = {
      task_id: "task-456",
      commit_sha: "def5678",
      test_assertion: "bun test tests/logging/fix.test.ts",
      resolved_at: "2026-08-29T13:00:00.000Z",
    };
    const resolved = resolveDefectRecord(defect, proof);
    expect(resolved.status).toBe("resolved");
    expect(resolved.resolution?.task_id).toBe("task-456");
  });

  test("parseDefectLog parses raw JSONL logs with various statuses and capsule options", () => {
    expect(parseDefectLog("")).toEqual([]);
    const raw = [
      JSON.stringify({
        id: "d1",
        type: "t1",
        status: "WontFix",
        severity: "high",
        message: "m1",
        remediation: "r1",
      }),
      JSON.stringify({
        id: "d2",
        type: "t2",
        status: "resolved",
        severity: "unknown_sev",
        observation: "o2",
      }),
      "invalid-line",
      JSON.stringify({ id: "d3", type: "t3", status: "wont-fix" }),
    ].join("\n");
    const parsed = parseDefectLog(raw, { capsuleRoot: "/virtual/capsule-1" });
    expect(parsed).toHaveLength(3);
    expect(parsed[0]?.status).toBe("wontfix");
    expect(parsed[0]?.severity).toBe("high");
    expect(parsed[0]?.observation).toBe("m1");
    expect(parsed[1]?.status).toBe("resolved");
    expect(parsed[1]?.severity).toBe("warning");
    expect(parsed[2]?.status).toBe("wontfix");
    expect(serializeDefectLog([])).toBe("");
    expect(serializeDefectLog(parsed)).toContain('"id":"d1"');
    expect(normalizeText("  padded text  ")).toBe("padded text");
    expect(normalizeText(123)).toBe("");
  });

  test("verifyResolutionProofEmpirical and resolveDefect test verification and defect resolution", () => {
    const validProof: DefectResolutionProof = {
      task_id: "task-99",
      test_assertion: "bun test tests/logging/pass.test.ts",
      resolved_at: "2026-08-29T12:00:00.000Z",
    };
    expect(verifyResolutionProofEmpirical(validProof).isValid).toBe(true);
    const briefProof: DefectResolutionProof = {
      task_id: "task-99",
      test_assertion: "ok",
      resolved_at: "2026-08-29T12:00:00.000Z",
    };
    expect(verifyResolutionProofEmpirical(briefProof).isValid).toBe(false);
    const invalidProof = { task_id: "" } as DefectResolutionProof;
    expect(verifyResolutionProofEmpirical(invalidProof).isValid).toBe(false);
    const sampleEntry = {
      id: "entry-1",
      type: "t1",
      status: "open" as const,
      severity: "low" as const,
      timestamp: "2026-08-29T12:00:00.000Z",
    };
    const resolvedEntry = resolveDefect(sampleEntry as unknown as DefectEntry, validProof);
    expect(resolvedEntry.status).toBe("resolved");
  });
});

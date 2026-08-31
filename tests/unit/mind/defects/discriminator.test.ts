/**
 * @file discriminator.test.ts
 * Unit tests for Defect Discriminators, Hash Functions, and Similarity Analysis
 */

import { describe, expect, it } from "bun:test";
import {
  calculateDefectSimilarity,
  computeDefectDiscriminator,
  createDefectContentHash,
  createFnv1aHash,
  createSha256Hash,
  extractDefectKeywords,
  normalizeObservationSignature,
  type DefectRecordInput,
} from "../../../../olt/scripts/src/mind/defects/index.ts";

describe("Defect Discriminator & Hash Suite", () => {
  describe("normalizeObservationSignature", () => {
    it("normalizes timestamps, addresses, hashes, pids, line numbers, and capsule paths", () => {
      const raw =
        "Error at 2026-08-24T12:34:56.789Z addr 0xdeadbeef1234 hash a1b2c3d4e5f607182930415263748596 pid=1234 line=42 in defect-123-abc under /home/user/.capsules/cap-123/file.ts";
      const normalized = normalizeObservationSignature(raw);

      expect(normalized).toContain("<time>");
      expect(normalized).toContain("<addr>");
      expect(normalized).toContain("<hash>");
      expect(normalized).toContain("pid=<pid>");
      expect(normalized).toContain("line=<num>");
      expect(normalized).toContain("defect-<id>");
      expect(normalized).toContain("<capsule_path>");
    });

    it("returns empty string for empty string input", () => {
      expect(normalizeObservationSignature("")).toBe("");
    });
  });

  describe("createFnv1aHash and createSha256Hash", () => {
    it("computes deterministic FNV-1a 8-char hex hash", () => {
      const hash1 = createFnv1aHash("hello world");
      const hash2 = createFnv1aHash("hello world");
      const hash3 = createFnv1aHash("different text");

      expect(hash1).toBe(hash2);
      expect(hash1.length).toBe(8);
      expect(hash1).not.toBe(hash3);
    });

    it("computes deterministic SHA-256 hex hash", () => {
      const hash1 = createSha256Hash("test input");
      const hash2 = createSha256Hash("test input");

      expect(hash1).toBe(hash2);
      expect(hash1.length).toBe(64);
    });
  });

  describe("createDefectContentHash", () => {
    it("hashes using sha256 by default and fnv1a when requested", () => {
      const defect: DefectRecordInput = {
        category: "code_defect",
        type: "type_mismatch",
        observation: "Expected string, received number",
        agent_id: "agent-1",
      };

      const sha = createDefectContentHash(defect);
      const fnv = createDefectContentHash(defect, "fnv1a");

      expect(sha.length).toBe(64);
      expect(fnv.length).toBe(8);
    });

    it("handles missing category, type, and falls back to message or role", () => {
      const defect: DefectRecordInput = {
        message: "Fallback message without observation",
        role: "validator",
      };

      const hash = createDefectContentHash(defect);
      expect(typeof hash).toBe("string");
      expect(hash.length).toBe(64);
    });

    it("handles completely empty defect input", () => {
      const defect: DefectRecordInput = {};
      const hash = createDefectContentHash(defect);
      expect(typeof hash).toBe("string");
    });
  });

  describe("computeDefectDiscriminator", () => {
    it("returns custom discriminator when provided", () => {
      const defect: DefectRecordInput = { type: "test" };
      const custom = computeDefectDiscriminator(defect, {
        customDiscriminator: (d) => `custom-${d.type}`,
      });
      expect(custom).toBe("custom-test");
    });

    it("returns dedup_key when already present", () => {
      const defect: DefectRecordInput = { dedup_key: "explicit-key-123" };
      expect(computeDefectDiscriminator(defect)).toBe("explicit-key-123");
    });

    it("computes standard discriminator with options", () => {
      const defect: DefectRecordInput = {
        category: "model_reasoning_error",
        type: "hallucination",
        agent_id: "planner-1",
        observation: "Invalid file reference",
      };

      const standard = computeDefectDiscriminator(defect);
      expect(standard).toBe(
        "model_reasoning_error::hallucination::planner-1::invalid file reference",
      );

      const withContentHash = computeDefectDiscriminator(defect, {
        useContentHash: true,
        hashAlgorithm: "fnv1a",
      });
      expect(withContentHash.startsWith("model_reasoning_error::hallucination::planner-1::")).toBe(
        true,
      );

      const withoutCategory = computeDefectDiscriminator(defect, { includeCategory: false });
      expect(withoutCategory.startsWith("any::hallucination::")).toBe(true);

      const withoutType = computeDefectDiscriminator(defect, { includeType: false });
      expect(withoutType.startsWith("model_reasoning_error::any::")).toBe(true);

      const withoutAgentId = computeDefectDiscriminator(defect, { includeAgentId: false });
      expect(withoutAgentId.startsWith("model_reasoning_error::hallucination::all::")).toBe(true);

      const unnormalized = computeDefectDiscriminator(
        { ...defect, observation: "line 42 error" },
        { normalizeObservation: false },
      );
      expect(unnormalized).toContain("line 42 error");
    });

    it("handles fallback to role, message, and missing attributes", () => {
      const defect: DefectRecordInput = {
        role: "implementer",
        message: "Failed step",
      };

      const key = computeDefectDiscriminator(defect);
      expect(key).toContain("role:implementer");
      expect(key).toContain("failed step");
    });
  });

  describe("extractDefectKeywords", () => {
    it("extracts non-stop-word tokens", () => {
      const text = "The database connection failed with timeout in worker";
      const keywords = extractDefectKeywords(text);

      expect(keywords).toContain("database");
      expect(keywords).toContain("connection");
      expect(keywords).toContain("failed");
      expect(keywords).toContain("timeout");
      expect(keywords).toContain("worker");
      expect(keywords).not.toContain("the");
      expect(keywords).not.toContain("with");
    });
  });

  describe("calculateDefectSimilarity", () => {
    it("returns 1.0 for two empty strings or stop-word-only strings", () => {
      expect(calculateDefectSimilarity("", "")).toBe(1.0);
      expect(calculateDefectSimilarity("the is a", "and with for")).toBe(1.0);
    });

    it("returns 0.0 when one string is empty and the other is not", () => {
      expect(calculateDefectSimilarity("database error", "")).toBe(0.0);
      expect(calculateDefectSimilarity("", "database error")).toBe(0.0);
    });

    it("calculates accurate Jaccard similarity score", () => {
      const textA = "database connection timeout in cluster";
      const textB = "database query timeout in cluster";
      const textC = "unrelated syntax compilation error";

      const simAB = calculateDefectSimilarity(textA, textB);
      const simAC = calculateDefectSimilarity(textA, textC);

      expect(simAB).toBeGreaterThan(0.5);
      expect(simAC).toBe(0.0);
    });
  });
});

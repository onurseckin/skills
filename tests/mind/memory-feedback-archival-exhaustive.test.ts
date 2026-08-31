import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  extractSnippet,
  scoreDocumentBM25,
} from "../../../olt/scripts/src/mind/memory/core/bm25.ts";
import {
  normalizeFeedbackCategory,
  normalizeFeedbackPriority,
  normalizeFeedbackStatus,
} from "../../../olt/scripts/src/mind/feedback/normalizer.ts";
import { parsePushbackMarkdown } from "../../../olt/scripts/src/mind/feedback/pushbacks/parser.ts";
import { rotateMindGeneration } from "../../../olt/scripts/src/mind/archival/rotate/rotator.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { initRun, transact } from "../../../olt/scripts/src/engine/store/index.ts";
import type {
  MemoryDocument,
  MemoryIndex,
} from "../../../olt/scripts/src/mind/memory/core/types.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {}
  }
  roots.length = 0;
});

describe("Memory, Feedback, and Archival - Exhaustive Unit Tests", () => {
  describe("BM25 Scoring & Snippet Extraction", () => {
    it("extracts snippets with boundary ellipses and query token highlights", () => {
      expect(extractSnippet("", ["foo"])).toBe("");
      expect(extractSnippet("Short text", ["text"])).toBe("Short text");

      const longContent = "The quick brown fox jumps over the lazy dog. ".repeat(10);
      const snippet = extractSnippet(longContent, ["lazy", "dog"], 50);
      expect(snippet).toContain("lazy");
      expect(snippet.length).toBeLessThanOrEqual(60);

      const noMatchSnippet = extractSnippet(longContent, ["nonexistent_query_token"], 40);
      expect(noMatchSnippet.endsWith("...")).toBe(true);
    });

    it("scores memory documents with term frequencies, title/id boosts, and tag boosts", () => {
      const doc: MemoryDocument = {
        id: "doc-governance-1",
        title: "Mind Governance Protocol",
        content: "Autonomous mind governance ensures 4-tier boundaries and clean lifecycle.",
        length: 10,
        token_counts: {
          governance: 2,
          mind: 2,
          boundaries: 1,
        },
        tags: ["governance", "architecture"],
        generation: 1,
        kind: "charter",
        path: "doc.md",
      };

      const index: MemoryIndex = {
        total_documents: 5,
        avg_doc_length: 10,
        doc_frequencies: new Map([
          ["governance", 2],
          ["mind", 3],
        ]),
        idf: new Map([
          ["governance", 1.5],
          ["mind", 1.2],
        ]),
        documents: new Map([["doc-governance-1", doc]]),
      };

      // Empty query or doc
      expect(scoreDocumentBM25(doc, [], index).score).toBe(0);
      expect(scoreDocumentBM25({ ...doc, length: 0 }, ["governance"], index).score).toBe(0);

      // Scored query with title and tag boosts
      const scored = scoreDocumentBM25(doc, ["governance", "mind"], index);
      expect(scored.score).toBeGreaterThan(0);
      expect(scored.matchedTerms).toContain("governance");
      expect(scored.matchedTerms).toContain("mind");
    });
  });

  describe("Feedback Normalizer & Pushback Markdown Parsing", () => {
    it("normalizes feedback category, priority, and status with validation", () => {
      expect(normalizeFeedbackCategory("GOVERNANCE")).toBe("GOVERNANCE");
      expect(normalizeFeedbackPriority("critical")).toBe("CRITICAL_USER_FEEDBACK");
      expect(normalizeFeedbackStatus("PENDING")).toBe("PENDING");

      expect(() => normalizeFeedbackCategory("invalid_cat")).toThrow(HarnessError);
      expect(() => normalizeFeedbackPriority("invalid_pri")).toThrow(HarnessError);
      expect(() => normalizeFeedbackStatus("invalid_stat")).toThrow(HarnessError);
    });

    it("parses pushback markdown into structured items and invariant tables", () => {
      expect(parsePushbackMarkdown("")).toEqual([]);

      const markdown = `## Pushback #1 - Generation 2: Boundary Enforcement
- **Pushback Item 1**: Coordinator Direct Code Writing
  - *Issue*: Coordinator modified source file directly without implementer delegation.
  - *Resolution*: Route all code writes through Tier 3 implementers.

### Objective Invariants
| Invariant | Status | Evidence |
| --- | --- | --- |
| INV-1: Single writer lease | SATISFIED | Ledger verified |
| INV-2: Zero supervisory edits | SATISFIED | Hash audit passed |
`;

      const records = parsePushbackMarkdown(markdown);
      const pushbackRec = records.find((r) => r.pushback_number === 1);
      expect(pushbackRec).toBeDefined();
      expect(pushbackRec!.generation).toBe(2);
      expect(pushbackRec!.items.length).toBeGreaterThan(0);
      expect(pushbackRec!.items[0]!.issue).toContain("Coordinator modified");
    });
  });

  describe("Mind Generation Archival & Rotation", () => {
    it("validates and rotates mind generation sealing previous capsule", () => {
      const tmpDir = mkdtempSync(join(tmpdir(), "mind-rotation-test-"));
      roots.push(tmpDir);

      // Create valid live charter in repo
      mkdirSync(join(tmpDir, "olt", "agents"), { recursive: true });
      writeFileSync(
        join(tmpDir, "olt", "agents", "mind.yaml"),
        `
identity: "Sovereign Mind"
goals:
  - id: G1
    statement: "Cognition"
non_goals:
  - "NG1"
`.trim(),
      );

      // Missing or invalid run root
      expect(() => rotateMindGeneration({ sourceRunRoot: "" })).toThrow(HarnessError);
      expect(() => rotateMindGeneration({ sourceRunRoot: join(tmpDir, "nonexistent") })).toThrow(
        HarnessError,
      );

      // Capsule without state.mind
      const invalidRun = initRun(tmpDir, "run-no-mind", Buffer.from("charter"), "file", true);
      roots.push(invalidRun);
      expect(() => rotateMindGeneration({ sourceRunRoot: invalidRun })).toThrow(HarnessError);

      // Capsule with state.mind
      const validRun = initRun(tmpDir, "run-mind-gen1", Buffer.from("charter"), "file", true);
      roots.push(validRun);
      transact(validRun, "owner", "init-mind", {}, (state) => {
        state.mind = {
          generation: 1,
          status: "active",
          identity: "Sovereign Mind",
        } as any;
      });

      const rotated = rotateMindGeneration({
        sourceRunRoot: validRun,
        capsulesDir: join(tmpDir, ".olt", "capsules"),
        newRunId: "mind-gen-2",
      });

      expect(rotated.sourceGeneration).toBe(1);
      expect(rotated.targetGeneration).toBe(2);
      expect(rotated.targetRunId).toBe("mind-gen-2");

      // Attempting to rotate already rotated capsule fails
      expect(() =>
        rotateMindGeneration({
          sourceRunRoot: validRun,
          capsulesDir: join(tmpDir, ".olt", "capsules"),
        }),
      ).toThrow(HarnessError);
    });
  });
});

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { parsePushbackMarkdown } from "../../../../olt/scripts/src/mind/feedback/pushbacks/parser.ts";
import {
  mapFeedbackCategoryToDefectCategory,
  parseInvariantsTable,
  resolvePushbackMarkdownPath,
} from "../../../../olt/scripts/src/mind/feedback/pushbacks/resolver.ts";
import { VirtualMemoryFS } from "../../../../olt/scripts/src/testing/virtual-fs/memory-fs.ts";
import { createVirtualFSSession } from "../../../../olt/scripts/src/testing/virtual-fs/spies.ts";

describe("Pushback Processing Suite", () => {
  let vfs: VirtualMemoryFS;
  let session: ReturnType<typeof createVirtualFSSession>;
  const baseDir = "/virtual/mind/feedback/pushbacks";

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
    vfs.mkdirSync(baseDir, { recursive: true });
  });

  afterEach(() => {
    session.cleanup();
  });

  describe("parsePushbackMarkdown", () => {
    it("returns empty array for empty, whitespace, or non-string inputs", () => {
      expect(parsePushbackMarkdown("")).toEqual([]);
      expect(parsePushbackMarkdown("   \n\t  \n")).toEqual([]);
      expect(parsePushbackMarkdown(null as unknown as string)).toEqual([]);
    });

    it("parses structured pushback sections with items, issues, and resolutions", () => {
      const markdown = [
        "## Pushback #3: Cognitive Loop Concurrency",
        "- **Pushback Item 1 (Concurrency Bug)**: Race condition in queue drain",
        "  *Issue*: Concurrent drain workers overwrite items",
        "  *Resolution*: Implement optimistic locking with atomic swap",
        "- **Pushback Item 2 (Audit Check)**: Verify state consistency",
        "  **Issue**: Inconsistent read during flush",
        "  **Resolution**: Synchronize memory barrier",
      ].join("\n");

      const records = parsePushbackMarkdown(markdown);
      expect(records).toHaveLength(1);
      const record = records[0];
      expect(record?.pushback_number).toBe(3);
      expect(record?.title).toBe("Pushback #3: Cognitive Loop Concurrency");
      expect(record?.items).toHaveLength(2);
      expect(record?.items[0]?.title).toBe("1 (Concurrency Bug)");
      expect(record?.items[0]?.issue).toBe("Concurrent drain workers overwrite items");
      expect(record?.items[0]?.resolution).toBe("Implement optimistic locking with atomic swap");
      expect(record?.items[1]?.title).toBe("2 (Audit Check)");
      expect(record?.items[1]?.issue).toBe("Inconsistent read during flush");
      expect(record?.items[1]?.resolution).toBe("Synchronize memory barrier");
    });

    it("parses generation headers, invariant tables, and merges generation sections", () => {
      const genMarkdown = [
        "## Generation 2 Convergence",
        "| Invariant | Requirement | Status | Evidence |",
        "| --- | --- | --- | --- |",
        "| **Zero Subprocesses** | No child processes spawned | SATISFIED | In-memory verification |",
        "| **Sub-10ms Latency** | Runtime <= 10ms | SATISFIED | Benchmark telemetry |",
        "",
        "### Generation 2 Refinements",
        "- **Pushback Item 1 (Optimization)**: Optimize VFS lookup",
        "  *Issue*: Path resolution cache misses",
        "  *Resolution*: Add prefix trie index",
      ].join("\n");

      const records = parsePushbackMarkdown(genMarkdown);
      expect(records).toHaveLength(1);
      const genRecord = records[0];
      expect(genRecord?.generation).toBe(2);
      expect(genRecord?.invariants).toHaveLength(2);
      expect(genRecord?.invariants[0]?.invariant).toBe("Zero Subprocesses");
      expect(genRecord?.invariants[0]?.status).toBe("SATISFIED");
      expect(genRecord?.items).toHaveLength(2);
      expect(genRecord?.items[0]?.title).toBe("Generation 2 Convergence");
      expect(genRecord?.items[1]?.title).toBe("1 (Optimization)");
      expect(genRecord?.items[1]?.issue).toBe("Path resolution cache misses");
      expect(genRecord?.items[1]?.resolution).toBe("Add prefix trie index");
    });

    it("creates default fallback item when section has no explicit items", () => {
      const emptySection = [
        "## Pushback #7: Policy Boundary Enforcement",
        "Enforce strict virtual memory isolation across test boundaries.",
        "Ensure no disk artifacts leak to physical filesystem.",
      ].join("\n");

      const records = parsePushbackMarkdown(emptySection);
      expect(records).toHaveLength(1);
      expect(records[0]?.items).toHaveLength(1);
      expect(records[0]?.items[0]?.title).toBe("Pushback #7: Policy Boundary Enforcement");
      expect(records[0]?.items[0]?.resolution).toBe(
        "Satisfy all canonical invariants for this generation",
      );
    });
  });

  describe("mapFeedbackCategoryToDefectCategory", () => {
    it("maps exact boundary violation categories", () => {
      expect(mapFeedbackCategoryToDefectCategory("BOUNDARY_VIOLATION")).toBe("boundary_violation");
      expect(mapFeedbackCategoryToDefectCategory("ROLE_CONFUSION")).toBe("boundary_violation");
      expect(mapFeedbackCategoryToDefectCategory("AGENT_CONTRACTS")).toBe("boundary_violation");
      expect(mapFeedbackCategoryToDefectCategory("WATCHDOG")).toBe("boundary_violation");
      expect(mapFeedbackCategoryToDefectCategory("EXECUTION_EFFICIENCY")).toBe(
        "boundary_violation",
      );
    });

    it("maps exact model reasoning error categories", () => {
      expect(mapFeedbackCategoryToDefectCategory("MODEL_REASONING_ERROR")).toBe(
        "model_reasoning_error",
      );
      expect(mapFeedbackCategoryToDefectCategory("DOCUMENTATION")).toBe("model_reasoning_error");
      expect(mapFeedbackCategoryToDefectCategory("GENERAL")).toBe("model_reasoning_error");
      expect(mapFeedbackCategoryToDefectCategory("ARCHITECTURE")).toBe("model_reasoning_error");
    });

    it("maps exact code defect categories", () => {
      expect(mapFeedbackCategoryToDefectCategory("CODE_DEFECT")).toBe("code_defect");
      expect(mapFeedbackCategoryToDefectCategory("CLI_TOOLING")).toBe("code_defect");
      expect(mapFeedbackCategoryToDefectCategory("CORE_ENGINE")).toBe("code_defect");
      expect(mapFeedbackCategoryToDefectCategory("REPAIR")).toBe("code_defect");
      expect(mapFeedbackCategoryToDefectCategory("SCALING")).toBe("code_defect");
      expect(mapFeedbackCategoryToDefectCategory("CORE_SCHEDULER")).toBe("code_defect");
      expect(mapFeedbackCategoryToDefectCategory("VALIDATION_ENGINE")).toBe("code_defect");
    });

    it("maps substring heuristics and unknown values cleanly", () => {
      expect(mapFeedbackCategoryToDefectCategory("agent_restraint_breach")).toBe(
        "boundary_violation",
      );
      expect(mapFeedbackCategoryToDefectCategory("context_hallucination_drift")).toBe(
        "model_reasoning_error",
      );
      expect(mapFeedbackCategoryToDefectCategory("arbitrary_unknown_tag")).toBe("code_defect");
      expect(mapFeedbackCategoryToDefectCategory(123 as unknown as string)).toBe("code_defect");
    });
  });

  describe("parseInvariantsTable", () => {
    it("returns empty array when table headers are missing", () => {
      expect(parseInvariantsTable(["Simple text line", "| Col1 | Col2 |"])).toEqual([]);
    });

    it("parses 4-column invariant rows and ignores formatting delimiters", () => {
      const lines = [
        "| Invariant | Requirement | Status | Evidence |",
        "|:---|:---|:---|:---|",
        "| **Zero Subprocesses** | No child processes spawned | SATISFIED | Clean static scan |",
        "| Fast Execution | Latency under 10ms | SATISFIED | P90 at 1.2ms |",
        "",
        "Other markdown text following the table",
      ];
      const table = parseInvariantsTable(lines);
      expect(table).toHaveLength(2);
      expect(table[0]).toEqual({
        invariant: "Zero Subprocesses",
        requirement: "No child processes spawned",
        status: "SATISFIED",
        evidence: "Clean static scan",
      });
      expect(table[1]?.invariant).toBe("Fast Execution");
    });
  });

  describe("resolvePushbackMarkdownPath", () => {
    it("resolves custom provided path", () => {
      const custom = `${baseDir}/CUSTOM_PUSHBACK.md`;
      expect(resolvePushbackMarkdownPath(custom)).toBe(custom);
    });

    it("resolves direct path in virtual working directory when present", () => {
      const defaultName = "USER_PUSHBACK_AND_SELF_AUDIT.md";
      const direct = `${baseDir}/${defaultName}`;
      vfs.writeFileSync(direct, "# Pushback File\n");
      expect(resolvePushbackMarkdownPath(direct)).toBe(direct);
    });
  });
});

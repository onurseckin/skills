import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memoryQueryCommand } from "../../../olt/scripts/src/cli/commands/memory-ops.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  buildMemoryIndex,
  countTokens,
  createMemoryDocument,
  extractSnippet,
  formatMemoryQueryBrief,
  indexAllMemory,
  indexDefectDocuments,
  indexCapsuleDocuments,
  indexCharterDocuments,
  indexDecisionDocuments,
  indexReportDocuments,
  renderAsciiMemoryTable,
  scoreDocumentBM25,
  searchMemory,
  tokenize,
  type MemoryDocument,
  type MemoryIndex,
  type MemoryKind,
} from "../../../olt/scripts/src/mind/memory/core/index.ts";

const tempRoots: string[] = [];

afterEach(() => {
  for (let i = 0; i < tempRoots.length; i += 1) {
    const r = tempRoots[i];
    if (r !== undefined) {
      try {
        rmSync(r, { recursive: true, force: true });
      } catch {
        // Ignore cleanup failure
      }
    }
  }
  tempRoots.length = 0;
});

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

interface TestWorkspace {
  readonly repoRoot: string;
  readonly capsulesDir: string;
  readonly runRoot: string;
}

function setupTestWorkspace(name: string): TestWorkspace {
  const repoRoot = createTempDir(`memory-test-${name}-`);
  const capsulesDir = join(repoRoot, ".olt", "capsules");
  mkdirSync(capsulesDir, { recursive: true });

  const runRoot = join(capsulesDir, `mind-gen-1`);
  mkdirSync(runRoot, { recursive: true });

  // 1. Charter
  const charterDir = join(repoRoot, "olt", "agents");
  mkdirSync(charterDir, { recursive: true });
  const charterContent = `name: "mind"
role: "mind"
charter:
  identity: "Autonomous Verification Core for test suites and memory indexing."
  goals:
    - id: "G1"
      statement: "Continuously ensure 0 TypeScript any across all modules."
    - id: "G2"
      statement: "Maintain strict multi-agent orchestration invariants."
    - id: "G3"
      statement: "Preserve repository integrity and test speed."
  cognitive_pillars:
    - "Pillar 1: CLI-First Token Leverage"
    - "Pillar 2: Visual Truth & Radical Observability"
    - "Pillar 3: Thread Authority & Zero Main-Thread Spillover"
  non_goals:
    - "Unauthorized mutations"
  repo_roots:
    - "olt/"
`;
  writeFileSync(join(charterDir, "mind.yaml"), charterContent, "utf-8");

  // 2. References
  const refDir = join(repoRoot, "olt", "references");
  mkdirSync(refDir, { recursive: true });
  writeFileSync(
    join(refDir, "protocol.md"),
    "# Protocol Reference\nAutonomous state transitions and bearer authentication.\n",
    "utf-8",
  );

  // 3. Defects
  const rootDefects = [
    JSON.stringify({
      id: "defect-101",
      type: "main_thread_direct_execution",
      category: "boundary_violation",
      severity: "critical",
      status: "open",
      observation: "Main thread executed disk write directly without subagent delegation.",
      remediation: "Enforce thread restraint and dispatch Tier 3 implementer.",
      timestamp: "2026-08-21T10:00:00Z",
    }),
    JSON.stringify({
      id: "defect-102",
      type: "type_defect",
      category: "code_defect",
      severity: "warning",
      status: "resolved",
      observation: "Implicit any discovered in memory indexing parser.",
      remediation: "Replace with unknown and explicit type guards.",
      timestamp: "2026-08-21T11:00:00Z",
    }),
  ].join("\n");
  writeFileSync(join(capsulesDir, "defects.jsonl"), rootDefects, "utf-8");

  // 4. Capsule prompt & trace & state
  writeFileSync(
    join(runRoot, "prompt.md"),
    "# Prompt: Implement Autonomous Mind Memory Search\nIndex all capsules and defects.",
    "utf-8",
  );
  writeFileSync(
    join(runRoot, "trace.md"),
    "# Trace\nExecuted initial pulse and verified invariant checks.",
    "utf-8",
  );

  const stateContent = {
    tasks: [
      {
        id: "task-1-memory",
        label: "Implement memory search CLI",
        status: "completed",
        write_scope: ["olt/scripts/src/mind/memory/core/index.ts"],
      },
    ],
    candidates: [
      {
        id: "cand-1",
        statement: "Admit memory indexing optimization",
        rationale: "Improves query speed and token efficiency",
        status: "admitted",
        decided_by: "mind-lead",
      },
    ],
    audits: [
      {
        id: "audit-1",
        verdict: "approved",
        actor: "auditor-1",
      },
    ],
  };
  writeFileSync(join(runRoot, "state.json"), JSON.stringify(stateContent, null, 2), "utf-8");

  // 5. Reports and packets
  const reportsDir = join(runRoot, "reports");
  mkdirSync(reportsDir, { recursive: true });
  writeFileSync(
    join(reportsDir, "validation.md"),
    "# Validation Report\nAll 15 test assertions passed with exit code 0.",
    "utf-8",
  );

  const packetsDir = join(runRoot, "packets", "implementer-1");
  mkdirSync(packetsDir, { recursive: true });
  writeFileSync(
    join(packetsDir, "packet.md"),
    "# Implementer Packet\nScope: memory.ts and memory-ops.ts",
    "utf-8",
  );

  return { repoRoot, capsulesDir, runRoot };
}

describe("Semantic Knowledge & Memory Search Indexer", () => {
  describe("Tokenization & Token Counting", () => {
    test("tokenizes standard text into normalized terms", () => {
      const tokens = tokenize("Hello World, BM25 memory indexer!");
      expect(tokens).toContain("hello");
      expect(tokens).toContain("world");
      expect(tokens).toContain("bm25");
      expect(tokens).toContain("memory");
      expect(tokens).toContain("indexer");
    });

    test("sub-tokenizes hyphenated and underscored identifiers", () => {
      const tokens = tokenize("mind-gen-6 and thread_identifier execution");
      expect(tokens).toContain("mind-gen-6");
      expect(tokens).toContain("mind");
      expect(tokens).toContain("gen");
      expect(tokens).toContain("6");
      expect(tokens).toContain("thread_identifier");
      expect(tokens).toContain("thread");
      expect(tokens).toContain("identifier");
      expect(tokens).toContain("execution");
    });

    test("filters common stop words while preserving domain keywords", () => {
      const tokens = tokenize("the goal G1 is to ensure zero any in ts codebase");
      expect(tokens).not.toContain("the");
      expect(tokens).not.toContain("is");
      expect(tokens).not.toContain("to");
      expect(tokens).not.toContain("in");
      expect(tokens).toContain("goal");
      expect(tokens).toContain("g1");
      expect(tokens).toContain("zero");
      expect(tokens).toContain("any");
      expect(tokens).toContain("ts");
      expect(tokens).toContain("codebase");
    });

    test("handles empty and whitespace-only inputs gracefully", () => {
      expect(tokenize("")).toEqual([]);
      expect(tokenize("   \n\t  ")).toEqual([]);
      expect(tokenize("!@#$%^&*()")).toEqual([]);
    });

    test("counts token frequencies accurately", () => {
      const tokens = ["memory", "search", "memory", "bm25", "memory"];
      const counts = countTokens(tokens);
      expect(counts["memory"]).toBe(3);
      expect(counts["search"]).toBe(1);
      expect(counts["bm25"]).toBe(1);
    });
  });

  describe("Memory Document Creation", () => {
    test("creates structured document with tokens and snippet", () => {
      const doc = createMemoryDocument({
        id: "doc-1",
        kind: "charter",
        title: "Charter Goal G1",
        source_path: "olt/agents/mind.yaml",
        content: "Continuously ensure 0 TypeScript any across all codebase modules.",
        metadata: { goal: "G1" },
      });

      expect(doc.id).toBe("doc-1");
      expect(doc.kind).toBe("charter");
      expect(doc.title).toBe("Charter Goal G1");
      expect(doc.source_path).toBe("olt/agents/mind.yaml");
      expect(doc.tokens.length).toBeGreaterThan(0);
      expect(doc.token_counts["typescript"]).toBe(1);
      expect(doc.metadata["goal"]).toBe("G1");
    });

    test("truncates long content into snippet when explicit snippet is omitted", () => {
      const longText = "a".repeat(300);
      const doc = createMemoryDocument({
        id: "doc-2",
        kind: "capsule",
        title: "Long Text Document",
        source_path: "test.md",
        content: longText,
      });

      expect(doc.snippet.length).toBeLessThanOrEqual(200);
      expect(doc.snippet.endsWith("...")).toBe(true);
    });
  });

  describe("Index Construction & BM25 Scoring", () => {
    test("builds index from documents and computes IDF and postings", () => {
      const d1 = createMemoryDocument({
        id: "d1",
        kind: "charter",
        title: "TypeScript Safety",
        source_path: "charter.md",
        content: "Zero any and strict type checking in TypeScript.",
      });
      const d2 = createMemoryDocument({
        id: "d2",
        kind: "defect",
        title: "Direct Mutation Defect",
        source_path: "defects.jsonl",
        content: "Main thread direct execution and boundary violation.",
      });

      const index = buildMemoryIndex([d1, d2]);
      expect(index.total_documents).toBe(2);
      expect(index.avg_doc_length).toBeGreaterThan(0);
      expect(index.idf.has("typescript")).toBe(true);
      expect(index.idf.has("mutation")).toBe(true);
      expect(index.postings.has("typescript")).toBe(true);
    });

    test("handles empty document list", () => {
      const index = buildMemoryIndex([]);
      expect(index.total_documents).toBe(0);
      expect(index.avg_doc_length).toBe(0);
      expect(index.idf.size).toBe(0);
      expect(index.postings.size).toBe(0);
    });

    test("scores documents with term saturation and title boosts", () => {
      const d1 = createMemoryDocument({
        id: "d1",
        kind: "charter",
        title: "Zero Any Policy",
        source_path: "charter.md",
        content: "Never allow any in TypeScript codebase.",
      });
      const d2 = createMemoryDocument({
        id: "d2",
        kind: "charter",
        title: "Test Policy",
        source_path: "charter.md",
        content: "Run bun test on every commit.",
      });

      const index = buildMemoryIndex([d1, d2]);
      const res1 = scoreDocumentBM25(d1, ["any", "typescript"], index);
      const res2 = scoreDocumentBM25(d2, ["any", "typescript"], index);

      expect(res1.score).toBeGreaterThan(0);
      expect(res2.score).toBe(0);
      expect(res1.matchedTerms).toContain("any");
    });
  });

  describe("Snippet Extraction", () => {
    test("extracts snippet centered around matching query terms", () => {
      const content =
        "The quick brown fox jumped over the lazy dog and discovered a critical boundary violation in thread authority.";
      const snippet = extractSnippet(content, ["boundary", "violation"], 60);
      expect(snippet.toLowerCase()).toContain("boundary");
      expect(snippet.toLowerCase()).toContain("violation");
    });

    test("handles short content without truncating", () => {
      const content = "Short message";
      const snippet = extractSnippet(content, ["message"], 100);
      expect(snippet).toBe("Short message");
    });
  });

  describe("Memory Searching & Filtering", () => {
    let sampleIndex: MemoryIndex;

    beforeEach(() => {
      const docs: MemoryDocument[] = [
        createMemoryDocument({
          id: "doc-charter-g1",
          kind: "charter",
          title: "Goal G1 Zero Any",
          capsule_id: null,
          source_path: "olt/agents/mind.yaml",
          content: "G1: Zero TypeScript any and 0 compiler suppressions.",
        }),
        createMemoryDocument({
          id: "doc-defect-boundary",
          kind: "defect",
          title: "Main Thread Boundary Violation",
          capsule_id: "mind-gen-1",
          source_path: ".olt/capsules/mind-gen-1/defects.jsonl",
          content: "Direct execution on main thread without subagent delegation.",
        }),
        createMemoryDocument({
          id: "doc-decision-cand-1",
          kind: "decision",
          title: "Candidate 1 Admission",
          capsule_id: "mind-gen-1",
          source_path: ".olt/capsules/mind-gen-1/state.json",
          content: "Candidate cand-1 admitted by mind-lead for memory indexing.",
        }),
        createMemoryDocument({
          id: "doc-report-val-1",
          kind: "report",
          title: "Validation Report Gen 1",
          capsule_id: "mind-gen-1",
          source_path: ".olt/capsules/mind-gen-1/reports/validation.md",
          content: "Validation report: all invariant gates passed.",
        }),
        createMemoryDocument({
          id: "doc-capsule-prompt",
          kind: "capsule",
          title: "Capsule Prompt Gen 2",
          capsule_id: "mind-gen-2",
          source_path: ".olt/capsules/mind-gen-2/prompt.md",
          content: "Prompt: Refactor memory search ranking.",
        }),
      ];
      sampleIndex = buildMemoryIndex(docs);
    });

    test("searches memory and returns ranked results", () => {
      const results = searchMemory(sampleIndex, { query: "boundary violation" });
      expect(results.length).toBeGreaterThan(0);
      const top = results[0];
      expect(top).toBeDefined();
      if (top !== undefined) {
        expect(top.id).toBe("doc-defect-boundary");
        expect(top.kind).toBe("defect");
        expect(top.matched_terms).toContain("boundary");
        expect(top.matched_terms).toContain("violation");
      }
    });

    test("filters by kind", () => {
      const defectResults = searchMemory(sampleIndex, {
        query: "main thread boundary",
        kind: "defect",
      });
      expect(defectResults.every((r) => r.kind === "defect")).toBe(true);

      const charterResults = searchMemory(sampleIndex, {
        query: "zero any",
        kind: "charter",
      });
      expect(charterResults.every((r) => r.kind === "charter")).toBe(true);
    });

    test("filters by comma-separated kinds", () => {
      const multiResults = searchMemory(sampleIndex, {
        query: "memory",
        kind: "decision,report",
      });
      expect(multiResults.every((r) => r.kind === "decision" || r.kind === "report")).toBe(true);
    });

    test("filters by capsule run", () => {
      const gen1Results = searchMemory(sampleIndex, {
        query: "memory",
        capsule: "mind-gen-1",
      });
      expect(gen1Results.every((r) => r.capsule_id === "mind-gen-1")).toBe(true);
    });

    test("applies limit and minScore thresholds", () => {
      const limited = searchMemory(sampleIndex, {
        query: "memory candidate report prompt",
        limit: 2,
      });
      expect(limited.length).toBeLessThanOrEqual(2);

      const highThreshold = searchMemory(sampleIndex, {
        query: "boundary",
        minScore: 100.0,
      });
      expect(highThreshold.length).toBe(0);
    });

    test("returns all matching documents when query is empty but filter is active", () => {
      const allCharter = searchMemory(sampleIndex, {
        query: "",
        kind: "charter",
      });
      expect(allCharter.length).toBe(1);
      expect(allCharter[0]?.id).toBe("doc-charter-g1");
    });
  });

  describe("Workspace Indexing Pipeline", () => {
    test("indexes charter, defects, capsules, decisions, and reports from workspace", () => {
      const ws = setupTestWorkspace("full-scan");
      const charterDocs = indexCharterDocuments(ws.repoRoot);
      expect(charterDocs.length).toBeGreaterThan(0);
      expect(charterDocs.some((d) => d.id === "charter-root")).toBe(true);
      expect(charterDocs.some((d) => d.id === "charter-goal-g1")).toBe(true);

      const defectDocs = indexDefectDocuments(ws.capsulesDir);
      expect(defectDocs.length).toBe(2);
      expect(defectDocs.some((b) => b.id === "defect-defect-101")).toBe(true);

      const capsuleDocs = indexCapsuleDocuments(ws.capsulesDir);
      expect(capsuleDocs.length).toBeGreaterThan(0);
      expect(capsuleDocs.some((c) => c.kind === "capsule")).toBe(true);

      const decisionDocs = indexDecisionDocuments(ws.capsulesDir);
      expect(decisionDocs.length).toBeGreaterThan(0);
      expect(decisionDocs.some((d) => d.kind === "decision")).toBe(true);

      const reportDocs = indexReportDocuments(ws.capsulesDir);
      expect(reportDocs.length).toBeGreaterThan(0);
      expect(reportDocs.some((r) => r.kind === "report")).toBe(true);

      const allIndex = indexAllMemory({
        repoRoot: ws.repoRoot,
        capsulesDir: ws.capsulesDir,
        runRoot: ws.runRoot,
      });

      expect(allIndex.total_documents).toBeGreaterThanOrEqual(5);

      const searchRes = searchMemory(allIndex, { query: "TypeScript any" });
      expect(searchRes.length).toBeGreaterThan(0);
      expect(searchRes[0]?.snippet.toLowerCase()).toContain("typescript");
    });
  });

  describe("ASCII Table & Markdown Output Formatting", () => {
    test("renders ASCII table with Unicode borders for non-empty results", () => {
      const results = [
        {
          id: "defect-101",
          kind: "defect" as MemoryKind,
          title: "Main Thread Execution",
          capsule_id: "mind-gen-1",
          source_path: ".olt/capsules/defects.jsonl",
          score: 4.821,
          snippet: "Direct write without subagent",
          matched_terms: ["thread", "execution"],
          metadata: {},
        },
      ];

      const table = renderAsciiMemoryTable(results);
      expect(table).toContain("┌");
      expect(table).toContain("defect-101");
      expect(table).toContain("4.821");
      expect(table).toContain("└");
    });

    test("renders clean fallback table when no results match", () => {
      const table = renderAsciiMemoryTable([]);
      expect(table).toContain("No memory records discovered matching query");
    });

    test("formats markdown brief within line limits", () => {
      const results = [
        {
          id: "charter-g1",
          kind: "charter" as MemoryKind,
          title: "Goal G1",
          capsule_id: null,
          source_path: "olt/agents/mind.yaml",
          score: 3.5,
          snippet: "0 TypeScript any",
          matched_terms: ["any"],
          metadata: {},
        },
      ];

      const brief = formatMemoryQueryBrief({
        query: "TypeScript any",
        results,
        totalIndexed: 20,
        capsulesDir: "/tmp/.capsules",
        runRoot: null,
      });

      expect(brief).toContain("Semantic Knowledge & Memory Search Report");
      expect(brief).toContain("Total Memory Documents Indexed");
      expect(brief).toContain("Match Forensics & Context");
      expect(brief.split("\n").length).toBeLessThanOrEqual(35);
    });
  });

  describe("CLI Command memoryQueryCommand", () => {
    test("executes query against workspace and returns structured result", () => {
      const ws = setupTestWorkspace("cli-test");
      const res = memoryQueryCommand({
        query: "TypeScript any",
        repo: ws.repoRoot,
        "capsules-dir": ws.capsulesDir,
      });

      expect(res.query).toBe("TypeScript any");
      expect(res.total_indexed).toBeGreaterThan(0);
      expect(res.total_matches).toBeGreaterThan(0);
      expect(res.results.length).toBeGreaterThan(0);
      expect(res.markdown).toContain("Semantic Knowledge & Memory Search Report");
    });

    test("reads query from context inlinePrompt if query flag omitted", () => {
      const ws = setupTestWorkspace("inline-prompt-test");
      const res = memoryQueryCommand(
        {
          repo: ws.repoRoot,
          "capsules-dir": ws.capsulesDir,
        },
        { inlinePrompt: "boundary violation" },
      );

      expect(res.query).toBe("boundary violation");
      expect(res.total_matches).toBeGreaterThan(0);
    });

    test("throws HarnessError on missing query", () => {
      const ws = setupTestWorkspace("err-query");
      expect(() => {
        memoryQueryCommand({
          repo: ws.repoRoot,
          "capsules-dir": ws.capsulesDir,
        });
      }).toThrow(HarnessError);
    });

    test("throws HarnessError on invalid min-score", () => {
      const ws = setupTestWorkspace("err-min-score");
      expect(() => {
        memoryQueryCommand({
          query: "test",
          repo: ws.repoRoot,
          "capsules-dir": ws.capsulesDir,
          "min-score": "-5",
        });
      }).toThrow(HarnessError);
    });

    test("throws HarnessError on invalid unknown option", () => {
      const ws = setupTestWorkspace("err-flags");
      expect(() => {
        memoryQueryCommand({
          query: "test",
          repo: ws.repoRoot,
          "invalid-flag": "abc",
        });
      }).toThrow(HarnessError);
    });

    test("throws HarnessError on invalid --now timestamp", () => {
      const ws = setupTestWorkspace("err-now");
      expect(() => {
        memoryQueryCommand({
          query: "test",
          repo: ws.repoRoot,
          now: "invalid-date-format",
        });
      }).toThrow(HarnessError);
    });

    test("throws HarnessError on non-existent repo", () => {
      expect(() => {
        memoryQueryCommand({
          query: "test",
          repo: "/non/existent/path/repo",
        });
      }).toThrow(HarnessError);
    });

    test("throws HarnessError on non-existent capsules-dir", () => {
      const ws = setupTestWorkspace("err-capsules-dir");
      expect(() => {
        memoryQueryCommand({
          query: "test",
          repo: ws.repoRoot,
          "capsules-dir": "/non/existent/capsules/dir",
        });
      }).toThrow(HarnessError);
    });

    test("supports kind filtering and limits via CLI flags", () => {
      const ws = setupTestWorkspace("cli-filter");
      const res = memoryQueryCommand({
        query: "main thread",
        repo: ws.repoRoot,
        "capsules-dir": ws.capsulesDir,
        kind: "defect",
        limit: "1",
      });

      expect(res.results.length).toBe(1);
      expect(res.results[0]?.kind).toBe("defect");
    });

    test("supports --run flag and resolves relative capsules directory", () => {
      const ws = setupTestWorkspace("cli-run-flag");
      const res = memoryQueryCommand({
        query: "Prompt",
        run: ws.runRoot,
      });

      expect(res.results.length).toBeGreaterThan(0);
      expect(res.run_root).toBe(ws.runRoot);
    });

    test("supports --all flag and preserves full markdown line output", () => {
      const ws = setupTestWorkspace("cli-all-flag");
      const res = memoryQueryCommand({
        query: "memory",
        repo: ws.repoRoot,
        "capsules-dir": ws.capsulesDir,
        all: true,
      });

      expect(res.markdown).toContain("Semantic Knowledge & Memory Search Report");
    });

    test("supports generation, tag, and pattern multi-attribute filtering via CLI flags", () => {
      const ws = setupTestWorkspace("cli-multi-attribute");
      const res = memoryQueryCommand({
        query: "Prompt",
        repo: ws.repoRoot,
        "capsules-dir": ws.capsulesDir,
        generation: "5",
        pattern: ".*",
      });

      expect(res.total_indexed).toBeGreaterThan(0);
      expect(res.generation_filter).toBe("5");
      expect(res.pattern_filter).toBe(".*");
    });
  });
});

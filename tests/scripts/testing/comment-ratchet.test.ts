import { describe, expect, test } from "bun:test";
import {
  COMMENT_BASELINE_SCHEMA,
  DEFAULT_COMMENT_BASELINE,
  assertInsideRepository,
  checkCommentRatchet,
  compareCommentBaseline,
  loadCommentBaseline,
  main,
  parseBaseline,
  parseFlags,
  renderJsonlBaseline,
  renderJsonReport,
  renderMarkdownReport,
  scanCommentsInSource,
  scanFileComments,
  serializeBaseline,
  type CommentAuditSnapshot,
  type CommentBaseline,
  type CommentBaselineEntry,
} from "../../../scripts/testing/comment-ratchet/index.ts";

describe("comment scanner", () => {
  test("detects single-line and multi-line comments", () => {
    const code = "const a = 1; // single\n/* multi\nline */\nconst b = 2;";
    const result = scanCommentsInSource(code, "example.ts");
    expect(result.commentLines).toBe(3);
    expect(result.totalComments).toBe(2);
    expect(result.comments[0]?.kind).toBe("line");
    expect(result.comments[0]?.text).toBe("// single");
    expect(result.comments[1]?.kind).toBe("block");
    expect(result.comments[1]?.startLine).toBe(2);
    expect(result.comments[1]?.endLine).toBe(3);
  });

  test("handles strings and regexes safely without false positives", () => {
    const code = [
      'const s1 = "http://example.com // not comment /* still not */";',
      "const s2 = 'also not // comment';",
      "const r1 = /\\/\\//;",
      "const r2 = /http:\\/\\//g;",
      "const r3 = /a\\/b\\/c/;",
    ].join("\n");
    const result = scanCommentsInSource(code, "regex-strings.ts");
    expect(result.commentLines).toBe(0);
    expect(result.totalComments).toBe(0);
    expect(result.comments).toEqual([]);
  });

  test("handles template literals and template expressions safely", () => {
    const code = "const msg = `hello ${ /* in expr */ 1 + 2 } // in tail`;\n// real trailing";
    const result = scanCommentsInSource(code, "templates.ts");
    expect(result.commentLines).toBe(2);
    expect(result.totalComments).toBe(2);
    expect(result.comments[0]?.text).toBe("/* in expr */");
    expect(result.comments[1]?.text).toBe("// real trailing");
  });

  test("handles division operators without false regex or comment matches", () => {
    const code = "const val = 10 / 2 / 5; // inline comment\nconst x = a / b;";
    const result = scanCommentsInSource(code, "division.ts");
    expect(result.commentLines).toBe(1);
    expect(result.totalComments).toBe(1);
    expect(result.comments[0]?.text).toBe("// inline comment");
  });

  test("handles JSX and TSX syntax cleanly", () => {
    const code =
      'export function View() {\n  return <div>{/* jsx comment */}<span>{"// not"}</span></div>;\n}';
    const result = scanCommentsInSource(code, "component.tsx");
    expect(result.commentLines).toBe(1);
    expect(result.totalComments).toBe(1);
    expect(result.comments[0]?.text).toBe("/* jsx comment */");
  });

  test("handles empty files and comment-only source files", () => {
    expect(scanCommentsInSource("", "empty.ts").comments).toEqual([]);
    expect(scanCommentsInSource("   \n\t\n  ", "spaces.ts").comments).toEqual([]);

    const onlyComments = "// line 1\n/* block 1 */";
    const result = scanCommentsInSource(onlyComments, "only.ts");
    expect(result.commentLines).toBe(2);
    expect(result.totalComments).toBe(2);
  });

  test("scanFileComments generates accurate file metrics", () => {
    const metrics = scanFileComments("src/code.ts", "/* a */ const x = 1; /* b */");
    expect(metrics.file).toBe("src/code.ts");
    expect(metrics.commentLines).toBe(1);
    expect(metrics.totalComments).toBe(2);
  });
});

describe("comment baseline persistence and parsing", () => {
  const entries: readonly CommentBaselineEntry[] = [
    { file: "src/alpha.ts", count: 2, totalComments: 2 },
    { file: "src/beta.ts", count: 5, reason: "legacy tech debt" },
  ];

  test("serializes and parses JSONL format", () => {
    const serialized = serializeBaseline(entries, "jsonl");
    expect(serialized).toContain(`{"schema":"${COMMENT_BASELINE_SCHEMA}"}`);
    const parsed = parseBaseline(serialized);
    expect(parsed.schema).toBe(COMMENT_BASELINE_SCHEMA);
    expect(parsed.entries.length).toBe(2);
    expect(parsed.entries[0]?.file).toBe("src/alpha.ts");
    expect(parsed.entries[0]?.count).toBe(2);
    expect(parsed.entries[1]?.reason).toBe("legacy tech debt");
  });

  test("serializes and parses JSON format", () => {
    const serialized = serializeBaseline(entries, "json");
    const parsed = parseBaseline(serialized);
    expect(parsed.schema).toBe(COMMENT_BASELINE_SCHEMA);
    expect(parsed.entries.length).toBe(2);
    expect(parsed.entries[1]?.file).toBe("src/beta.ts");
  });

  test("rejects invalid baseline formats and schemas", () => {
    expect(() => parseBaseline("")).toThrow("empty baseline content");
    expect(() => parseBaseline('{"schema":"wrong/v1"}\n{"file":"a.ts","count":1}')).toThrow(
      "stale or missing schema",
    );
    expect(() => parseBaseline('{"schema":"comment-ratchet-baseline/v1"}\nnot-json')).toThrow(
      "not valid JSON",
    );
    expect(() =>
      parseBaseline('{"schema":"comment-ratchet-baseline/v1"}\n{"file":"a.ts","count":-1}'),
    ).toThrow("invalid count");
    expect(() =>
      parseBaseline(
        '{"schema":"comment-ratchet-baseline/v1"}\n{"file":"a.ts","count":1}\n{"file":"a.ts","count":2}',
      ),
    ).toThrow("duplicate identity");
  });

  test("assertInsideRepository enforces safe repo containment", () => {
    expect(assertInsideRepository("/repo", "base.jsonl")).toBe("/repo/base.jsonl");
    expect(() => assertInsideRepository("/repo", "../outside.jsonl")).toThrow(
      "baseline path is outside the repository",
    );
  });

  test("loadCommentBaseline reads and parses baseline via custom reader", async () => {
    const baselineText = serializeBaseline(entries, "jsonl");
    const customReader = async (p: string) => (p.includes("base.jsonl") ? baselineText : "");
    const loaded = await loadCommentBaseline("/repo", "base.jsonl", customReader);
    expect(loaded.entries.length).toBe(2);
  });
});

describe("comment baseline comparison", () => {
  const baseline: CommentBaseline = {
    schema: COMMENT_BASELINE_SCHEMA,
    entries: [
      { file: "src/unchanged.ts", count: 3 },
      { file: "src/worsened.ts", count: 2 },
      { file: "src/improved.ts", count: 4 },
      { file: "src/removed.ts", count: 1 },
    ],
  };

  test("identifies unchanged, worsened, improved, added, and resolved deltas", () => {
    const current: readonly CommentBaselineEntry[] = [
      { file: "src/unchanged.ts", count: 3 },
      { file: "src/worsened.ts", count: 5 },
      { file: "src/improved.ts", count: 1 },
      { file: "src/new-file.ts", count: 2 },
    ];

    const { baselineDelta, passed } = compareCommentBaseline(baseline, current);
    expect(passed).toBe(false);
    expect(baselineDelta.unchanged.length).toBe(1);
    expect(baselineDelta.unchanged[0]?.file).toBe("src/unchanged.ts");
    expect(baselineDelta.worsened.length).toBe(1);
    expect(baselineDelta.worsened[0]?.file).toBe("src/worsened.ts");
    expect(baselineDelta.worsened[0]?.diff).toBe(3);
    expect(baselineDelta.improved.length).toBe(1);
    expect(baselineDelta.improved[0]?.file).toBe("src/improved.ts");
    expect(baselineDelta.improved[0]?.diff).toBe(-3);
    expect(baselineDelta.added.length).toBe(1);
    expect(baselineDelta.added[0]?.file).toBe("src/new-file.ts");
    expect(baselineDelta.resolved.length).toBe(1);
    expect(baselineDelta.resolved[0]?.file).toBe("src/removed.ts");
  });

  test("passes when comment counts decrease or remain equal", () => {
    const current: readonly CommentBaselineEntry[] = [
      { file: "src/unchanged.ts", count: 3 },
      { file: "src/worsened.ts", count: 2 },
      { file: "src/improved.ts", count: 2 },
    ];
    const { passed } = compareCommentBaseline(baseline, current);
    expect(passed).toBe(true);
  });
});

describe("comment ratchet engine", () => {
  const baselineDoc: CommentBaseline = {
    schema: COMMENT_BASELINE_SCHEMA,
    entries: [{ file: "src/main.ts", count: 2, reason: "legacy docs" }],
  };

  function mockAudit(commentLines: number): () => CommentAuditSnapshot {
    return () => ({
      scannedFiles: 1,
      totalCommentLines: commentLines,
      totalComments: commentLines,
      files: [
        {
          file: "src/main.ts",
          commentLines,
          totalComments: commentLines,
          comments: [],
        },
      ],
    });
  }

  test("ratchet mode passes when count is within baseline", async () => {
    const report = await checkCommentRatchet({
      repoRoot: "/repo",
      mode: "ratchet",
      audit: mockAudit(2),
      fileLoader: async () => serializeBaseline(baselineDoc.entries),
      baselinePath: "baseline.jsonl",
    });
    expect(report.passed).toBe(true);
    expect(report.current[0]?.reason).toBe("legacy docs");
  });

  test("ratchet mode fails when count worsens", async () => {
    const report = await checkCommentRatchet({
      repoRoot: "/repo",
      mode: "ratchet",
      audit: mockAudit(5),
      fileLoader: async () => serializeBaseline(baselineDoc.entries),
      baselinePath: "baseline.jsonl",
    });
    expect(report.passed).toBe(false);
    expect(report.baselineDelta.worsened.length).toBe(1);
  });

  test("strict mode requires zero comments", async () => {
    const cleanReport = await checkCommentRatchet({
      repoRoot: "/repo",
      mode: "strict",
      audit: mockAudit(0),
    });
    expect(cleanReport.passed).toBe(true);

    const dirtyReport = await checkCommentRatchet({
      repoRoot: "/repo",
      mode: "strict",
      audit: mockAudit(1),
    });
    expect(dirtyReport.passed).toBe(false);
  });

  test("check mode reports deltas without failing", async () => {
    const report = await checkCommentRatchet({
      repoRoot: "/repo",
      mode: "check",
      audit: mockAudit(10),
      fileLoader: async () => serializeBaseline(baselineDoc.entries),
      baselinePath: "baseline.jsonl",
    });
    expect(report.passed).toBe(true);
    expect(report.baselineDelta.worsened.length).toBe(1);
  });
});

describe("comment ratchet CLI and reporters", () => {
  test("parseFlags parses supported flags and options", () => {
    expect(parseFlags([])).toEqual({ mode: "ratchet", format: "markdown" });
    expect(parseFlags(["--mode", "strict", "--format", "json"])).toEqual({
      mode: "strict",
      format: "json",
    });
    expect(parseFlags(["--mode=check", "--format=jsonl"])).toEqual({
      mode: "check",
      format: "jsonl",
    });
    expect(parseFlags(["--baseline", "base.jsonl", "--staged"])).toEqual({
      mode: "ratchet",
      format: "markdown",
      baselinePath: "base.jsonl",
      staged: true,
    });
    expect(parseFlags(["--files", "a.ts,b.ts"])).toEqual({
      mode: "ratchet",
      format: "markdown",
      files: ["a.ts", "b.ts"],
    });
    expect(() => parseFlags(["--unknown"])).toThrow("Invalid comment ratchet flag");
    expect(() => parseFlags(["--mode", "bad"])).toThrow("Invalid comment ratchet flag value");
  });

  test("renders reports across markdown, json, and jsonl formats", () => {
    const report = {
      mode: "ratchet" as const,
      scannedFiles: 10,
      totalCommentLines: 2,
      totalComments: 2,
      current: [{ file: "a.ts", count: 2 }],
      baselineDelta: {
        added: [{ file: "b.ts", observed: 1, baseline: 0, diff: 1 }],
        worsened: [],
        improved: [],
        unchanged: [],
        resolved: [],
      },
      passed: false,
    };

    const md = renderMarkdownReport(report);
    expect(md).toContain("# Comment Ratchet Guard Report");
    expect(md).toContain("FAILED");
    expect(md).toContain("`b.ts`");

    const json = renderJsonReport(report);
    expect(JSON.parse(json).scannedFiles).toBe(10);

    const jsonl = renderJsonlBaseline(report);
    expect(jsonl).toContain(COMMENT_BASELINE_SCHEMA);
  });

  test("main returns exit code 0 on pass and 1 on fail", async () => {
    const passingSnapshot: CommentAuditSnapshot = {
      scannedFiles: 2,
      totalCommentLines: 1,
      totalComments: 1,
      files: [{ file: "a.ts", commentLines: 1, totalComments: 1, comments: [] }],
    };

    const baseText = serializeBaseline([{ file: "a.ts", count: 1 }]);
    const originalStdout = process.stdout.write;
    const originalStderr = process.stderr.write;
    const originalExitCode = process.exitCode;
    process.stdout.write = (() => true) as typeof process.stdout.write;
    process.stderr.write = (() => true) as typeof process.stderr.write;
    try {
      const passCode = await main(["--mode", "ratchet"], "/repo", {
        audit: () => passingSnapshot,
        fileLoader: async () => baseText,
      });
      expect(passCode).toBe(0);

      const failCode = await main(["--mode", "strict"], "/repo", {
        audit: () => passingSnapshot,
      });
      expect(failCode).toBe(1);
    } finally {
      process.stdout.write = originalStdout;
      process.stderr.write = originalStderr;
      process.exitCode = originalExitCode;
    }
  });

  test("default baseline path matches standard repository location", () => {
    expect(DEFAULT_COMMENT_BASELINE).toBe("scripts/testing/comment-ratchet/baseline/index.jsonl");
  });
});

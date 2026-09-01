import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import {
  parseLcov,
  buildCoverageSummary,
  generateInteractiveHtml,
  writeInteractiveHtml,
  getHtmlStyles,
  getClientScript,
  buildHtmlDocument,
  extractCoverageFileData,
  processCoverageArtifacts,
  main,
  type FileCoverageMetric,
  type CoverageSummary,
} from "../../../scripts/testing/reporting/index.ts";

describe("Coverage HTML Dashboard and Artifact Pipeline (in-memory virtual)", () => {
  const testScratchDir = `${process.cwd()}/.olt/virtual-cov-html`;
  const mockFiles = new Map<string, string>();
  const mockDirs = new Set<string>();
  const spies: { mockRestore: () => void }[] = [];

  beforeEach(() => {
    mockFiles.clear();
    mockDirs.clear();
    mockDirs.add(testScratchDir);

    spies.push(
      spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        return mockFiles.has(s) || mockDirs.has(s);
      }),
    );

    spies.push(
      spyOn(fs, "readFileSync").mockImplementation((p: fs.PathOrFileDescriptor) => {
        const val = mockFiles.get(String(p));
        if (val !== undefined) return val;
        throw new Error(`ENOENT: no such file, open '${String(p)}'`);
      }),
    );

    spies.push(
      spyOn(fs, "writeFileSync").mockImplementation((p, data) => {
        mockFiles.set(
          String(p),
          typeof data === "string" ? data : Buffer.from(data as Uint8Array).toString("utf-8"),
        );
      }),
    );

    spies.push(
      spyOn(fs, "mkdirSync").mockImplementation((p) => {
        mockDirs.add(String(p));
        return undefined as unknown as string;
      }),
    );

    spies.push(
      spyOn(fs, "lstatSync").mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        if (mockDirs.has(s)) {
          return {
            isSymbolicLink: () => false,
            isDirectory: () => true,
            isFile: () => false,
          } as unknown as fs.Stats;
        }
        if (mockFiles.has(s)) {
          return {
            isSymbolicLink: () => false,
            isDirectory: () => false,
            isFile: () => true,
          } as unknown as fs.Stats;
        }
        const err = new Error(
          `ENOENT: no such file or directory, lstat '${s}'`,
        ) as NodeJS.ErrnoException;
        err.code = "ENOENT";
        throw err;
      }),
    );

    spies.push(spyOn(fs, "realpathSync").mockImplementation((p: fs.PathLike) => String(p)));
  });

  afterEach(() => {
    while (spies.length > 0) spies.pop()?.mockRestore();
  });

  describe("html-reporter", () => {
    test("getHtmlStyles returns valid CSS string", () => {
      const styles = getHtmlStyles();
      expect(styles).toContain(":root");
      expect(styles).toContain("--bg-base");
      expect(styles).toContain(".radial-gauge");
      expect(styles).toContain(".code-line.miss");
    });

    test("getClientScript generates functional client JS", () => {
      const script = getClientScript('{"total":{"lines":{"pct":100}},"files":[]}');
      expect(script).toContain("const DATA = ");
      expect(script).toContain("function renderBreadcrumbs()");
      expect(script).toContain("function jumpToLine(");
    });

    test("buildHtmlDocument formats valid HTML5 document", () => {
      const html = buildHtmlDocument("body { color: red; }", "console.log('hi');");
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("<style>\nbody { color: red; }\n  </style>");
      expect(html).toContain("<script>\nconsole.log('hi');\n  </script>");
    });

    test("extractCoverageFileData extracts file info and handles missing files & read errors gracefully", () => {
      const dummyFile = join(testScratchDir, "src/a.ts");
      const dummyDir = join(testScratchDir, "src/dir_as_file.ts");
      mockDirs.add(join(testScratchDir, "src"));
      mockDirs.add(dummyDir);
      mockFiles.set(dummyFile, "line1\nline2");

      const sampleLcov = [
        "SF:src/a.ts",
        "LF:2",
        "LH:1",
        "FNF:1",
        "FNH:1",
        "DA:1,1",
        "DA:2,0",
        "end_of_record",
        "SF:src/missing.ts",
        "LF:1",
        "LH:1",
        "FNF:1",
        "FNH:1",
        "DA:1,1",
        "end_of_record",
        "SF:src/dir_as_file.ts",
        "LF:1",
        "LH:1",
        "FNF:1",
        "FNH:1",
        "DA:1,1",
        "end_of_record",
      ].join("\n");

      const fileMap = parseLcov(sampleLcov, testScratchDir);
      const filesData = extractCoverageFileData(fileMap, testScratchDir);

      expect(filesData.length).toBe(3);
      const fileA = filesData.find((f) => f.path === "src/a.ts");
      expect(fileA).toBeDefined();
      expect(fileA?.sourceLines?.length).toBe(2);
      expect(fileA?.sourceLines?.[0]?.hits).toBe(1);
      expect(fileA?.sourceLines?.[1]?.hits).toBe(0);

      const fileMissing = filesData.find((f) => f.path === "src/missing.ts");
      expect(fileMissing).toBeDefined();
      expect(fileMissing?.sourceLines).toBeUndefined();

      const fileDir = filesData.find((f) => f.path === "src/dir_as_file.ts");
      expect(fileDir).toBeDefined();
      expect(fileDir?.sourceLines).toBeUndefined();
    });

    test("generateInteractiveHtml embeds files, breadcrumbs, and precision line highlights", () => {
      const dummyFile = join(testScratchDir, "src/sample.ts");
      mockDirs.add(join(testScratchDir, "src"));
      mockFiles.set(dummyFile, "const a = 1;\nconst b = 2;\n// comment\nconst c = 3;\n");

      const sampleLcov = [
        "SF:src/sample.ts",
        "LF:3",
        "LH:2",
        "FNF:1",
        "FNH:1",
        "DA:1,1",
        "DA:2,0",
        "DA:4,1",
        "end_of_record",
      ].join("\n");

      const fileMap = parseLcov(sampleLcov, testScratchDir);
      const summary = buildCoverageSummary(fileMap);
      const html = generateInteractiveHtml(fileMap, summary, testScratchDir);

      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("Test Coverage & Runtime Dashboard");
      expect(html).toContain("src/sample.ts");
      expect(html).toContain("DATA");
      expect(html).toContain("miss-chip");
    });

    test("generateInteractiveHtml handles default summary without total", () => {
      const emptyMap = new Map<string, FileCoverageMetric>();
      const emptySummary: CoverageSummary = {};
      const html = generateInteractiveHtml(emptyMap, emptySummary, testScratchDir);
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("Test Coverage & Runtime Dashboard");
    });

    test("writeInteractiveHtml writes index.html file and creates directory if missing", () => {
      const sampleLcov = "SF:src/a.ts\nLF:5\nLH:5\nend_of_record";
      const fileMap = parseLcov(sampleLcov, testScratchDir);
      const summary = buildCoverageSummary(fileMap);

      const htmlPath = writeInteractiveHtml(fileMap, summary, testScratchDir, "nested/cov");
      expect(fs.existsSync(htmlPath)).toBe(true);
      expect(fs.readFileSync(htmlPath, "utf-8")).toContain("<!DOCTYPE html>");
    });
  });

  describe("unified entrypoint processCoverageArtifacts", () => {
    test("returns lcovExists: false when lcov.info is missing", () => {
      const res = processCoverageArtifacts(testScratchDir, "nonexistent");
      expect(res.lcovExists).toBe(false);
      expect(res.filesCount).toBe(0);
      expect(res.totalPct).toBe(0);
    });

    test("orchestrates all 3 artifacts when lcov.info is present", () => {
      const covDir = join(testScratchDir, "coverage");
      mockDirs.add(covDir);
      const sampleLcov = "SF:src/test.ts\nLF:10\nLH:10\nFNF:1\nFNH:1\nend_of_record";
      mockFiles.set(join(covDir, "lcov.info"), sampleLcov);

      const res = processCoverageArtifacts(testScratchDir, "coverage");
      expect(res.lcovExists).toBe(true);
      expect(res.filesCount).toBe(1);
      expect(res.totalPct).toBe(100);

      expect(fs.existsSync(join(covDir, "coverage-summary.json"))).toBe(true);
      expect(fs.existsSync(join(covDir, "REPORT.md"))).toBe(true);
      expect(fs.existsSync(join(covDir, "index.html"))).toBe(true);
    });

    test("recreates coverage directory if removed before artifact writing", () => {
      const covDir = join(testScratchDir, "coverage-recreate");
      mockDirs.add(covDir);
      const sampleLcov = "SF:src/test.ts\nLF:10\nLH:10\nFNF:1\nFNH:1\nend_of_record";
      const lcovPath = join(covDir, "lcov.info");
      mockFiles.set(lcovPath, sampleLcov);

      let checkCount = 0;
      spies.push(
        spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => {
          const s = String(p);
          if (s === lcovPath) return true;
          if (s === covDir) {
            checkCount++;
            if (checkCount === 1) return false;
          }
          return mockFiles.has(s) || mockDirs.has(s);
        }),
      );

      const res = processCoverageArtifacts(testScratchDir, "coverage-recreate");
      expect(res.lcovExists).toBe(true);
    });

    test("executes CLI script via bun execution or direct main() invocation", () => {
      const originalConsoleLog = console.log;
      const logged: string[] = [];
      console.log = ((...args: unknown[]) => {
        logged.push(args.map(String).join(" "));
      }) as typeof console.log;

      try {
        main();
        expect(logged.some((l) => l.includes("[coverage]"))).toBe(true);
      } finally {
        console.log = originalConsoleLog;
      }
    });
  });
});

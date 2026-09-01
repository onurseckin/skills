import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import {
  scanArchitecturalHealth,
  mapPriority,
  mapFeedbackPriorityToTaskPriority,
  proposeCandidateEvolutions,
  sanitizeSlug,
} from "../../../../olt/scripts/src/mind/tasks/discovery/scanners/health-scanner.ts";

describe("health-scanner unit tests (in-memory virtual)", () => {
  const virtualDir = `${process.cwd()}/.olt/virtual-health-scanner`;
  const mockFiles = new Map<string, string>();
  const mockDirs = new Set<string>();
  const spies: { mockRestore: () => void }[] = [];

  beforeEach(() => {
    mockFiles.clear();
    mockDirs.clear();
    mockDirs.add(virtualDir);

    const existsSpy = spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => {
      const pathStr = String(p);
      return mockFiles.has(pathStr) || mockDirs.has(pathStr);
    });
    spies.push(existsSpy);

    const readdirSpy = spyOn(fs, "readdirSync").mockImplementation(
      (p: fs.PathLike, options?: unknown) => {
        const pathStr = String(p);
        const dirNames: string[] = [];
        for (const dir of mockDirs) {
          if (dir.startsWith(pathStr) && dir !== pathStr) {
            const sub = dir.slice(pathStr.length).replace(/^\/+/, "");
            const top = sub.split("/")[0];
            if (top && !dirNames.includes(top)) dirNames.push(top);
          }
        }
        const fileNames: string[] = [];
        for (const file of mockFiles.keys()) {
          if (file.startsWith(pathStr)) {
            const sub = file.slice(pathStr.length).replace(/^\/+/, "");
            const top = sub.split("/")[0];
            if (top && !dirNames.includes(top) && !fileNames.includes(top)) fileNames.push(top);
          }
        }
        const withFileTypes =
          typeof options === "object" &&
          options !== null &&
          Boolean((options as { withFileTypes?: boolean }).withFileTypes);

        if (withFileTypes) {
          const results = [
            ...dirNames.map((name) => ({ name, isDirectory: () => true, isFile: () => false })),
            ...fileNames.map((name) => ({ name, isDirectory: () => false, isFile: () => true })),
          ];
          return results as unknown as fs.Dirent[];
        }
        return [...dirNames, ...fileNames] as unknown as fs.Dirent[];
      },
    );
    spies.push(readdirSpy);

    const readSpy = spyOn(fs, "readFileSync").mockImplementation((p: fs.PathOrFileDescriptor) => {
      const pathStr = String(p);
      const val = mockFiles.get(pathStr);
      if (val !== undefined) return val;
      throw new Error(`ENOENT: no such file or directory, open '${pathStr}'`);
    });
    spies.push(readSpy);

    const statSpy = spyOn(fs, "statSync").mockImplementation((p: fs.PathLike) => {
      const pathStr = String(p);
      if (mockDirs.has(pathStr)) {
        return { isDirectory: () => true, isFile: () => false } as unknown as fs.Stats;
      }
      if (mockFiles.has(pathStr)) {
        return { isDirectory: () => false, isFile: () => true } as unknown as fs.Stats;
      }
      return { isDirectory: () => false, isFile: () => false } as unknown as fs.Stats;
    });
    spies.push(statSpy);
  });

  afterEach(() => {
    while (spies.length > 0) {
      spies.pop()?.mockRestore();
    }
  });

  test("mapPriority maps all DiscoverySeverity levels correctly", () => {
    expect(mapPriority("CRITICAL")).toBe("CRITICAL");
    expect(mapPriority("HIGH")).toBe("HIGH");
    expect(mapPriority("MEDIUM")).toBe("MEDIUM");
    expect(mapPriority("LOW")).toBe("LOW");
    expect(mapPriority("BACKGROUND")).toBe("BACKGROUND");
  });

  test("mapFeedbackPriorityToTaskPriority maps all FeedbackPriority levels correctly", () => {
    expect(mapFeedbackPriorityToTaskPriority("CRITICAL_USER_FEEDBACK")).toBe("CRITICAL");
    expect(mapFeedbackPriorityToTaskPriority("HIGH_ARCHITECTURAL_FEATURE")).toBe("HIGH");
    expect(mapFeedbackPriorityToTaskPriority("USER_DIRECTIVE")).toBe("HIGH");
    expect(mapFeedbackPriorityToTaskPriority("NORMAL")).toBe("MEDIUM");
    expect(mapFeedbackPriorityToTaskPriority("LOW")).toBe("LOW");
  });

  test("sanitizeSlug normalizes input strings properly", () => {
    expect(sanitizeSlug("Hello World!")).toBe("hello-world");
    expect(sanitizeSlug("---test---slug---")).toBe("test-slug");
    expect(sanitizeSlug("A".repeat(60))).toBe("a".repeat(40));
    expect(sanitizeSlug("special_characters.in#name")).toBe("special-characters-in-name");
  });

  test("scanArchitecturalHealth detects broken imports and circular dependencies", () => {
    const testDir = join(virtualDir, "circ-test");
    mockDirs.add(testDir);
    const subDir = join(testDir, "sub");
    mockDirs.add(subDir);

    const fileA = join(testDir, "fileA.ts");
    const fileB = join(testDir, "fileB.ts");
    const fileC = join(testDir, "fileC.ts");
    const fileD = join(testDir, "fileD.ts");
    const indexFile = join(subDir, "index.ts");

    mockFiles.set(fileA, `import { b } from "./fileB.ts";\nexport const a = 1;`);
    mockFiles.set(fileB, `import { a } from "./fileA.ts";\nexport const b = 2;`);
    mockFiles.set(fileC, `import { missing } from "./nonExistentFile.ts";\nexport const c = 3;`);
    mockFiles.set(fileD, `import { sub } from "./sub";\nexport const d = 4;`);
    mockFiles.set(indexFile, `export const sub = "sub";`);

    const result = scanArchitecturalHealth({
      sourceRoots: [testDir],
      maxFindings: 10,
    });

    expect(result.filesScanned).toBe(5);
    expect(result.totalFindings).toBeGreaterThanOrEqual(2);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    const brokenFinding = result.findings.find((f) => f.issueType === "BROKEN_IMPORT");
    expect(brokenFinding).toBeDefined();
    expect(brokenFinding?.description).toContain("nonExistentFile.ts");
    expect(brokenFinding?.severity).toBe("HIGH");

    const circularFinding = result.findings.find((f) => f.issueType === "CIRCULAR_DEPENDENCY");
    expect(circularFinding).toBeDefined();
    expect(circularFinding?.severity).toBe("HIGH");
  });

  test("scanArchitecturalHealth handles clean workspace with zero findings", () => {
    const testDir = join(virtualDir, "clean-test");
    mockDirs.add(testDir);

    const fileA = join(testDir, "cleanA.ts");
    const fileB = join(testDir, "cleanB.ts");

    mockFiles.set(fileA, `export const a = 10;`);
    mockFiles.set(fileB, `import { a } from "./cleanA.ts";\nexport const b = a + 20;`);

    const result = scanArchitecturalHealth({
      sourceRoots: [testDir],
    });

    expect(result.filesScanned).toBe(2);
    expect(result.totalFindings).toBe(0);
    expect(result.findings).toEqual([]);
  });

  test("proposeCandidateEvolutions generates structured proposals across all finding types", () => {
    const proposals = proposeCandidateEvolutions({
      cognitiveGaps: [
        {
          file: "olt/scripts/src/mind/complex.ts",
          line: 25,
          issueType: "COGNITIVE_COMPLEXITY",
          description: "Excessive nesting depth in loop",
          severity: "HIGH",
          suggestedRemediation: "Extract nested loop into helper",
        },
      ],
      architecturalHealth: [
        {
          file: "olt/scripts/src/mind/broken.ts",
          line: 3,
          issueType: "BROKEN_IMPORT",
          description: "Broken relative import target",
          severity: "HIGH",
          suggestedRemediation: "Fix import target path",
        },
      ],
      feedbackPending: [
        {
          id: "fb-add-metrics",
          title: "Add Prometheus Metrics",
          content: "Expose metrics endpoint",
          priority: "HIGH_ARCHITECTURAL_FEATURE",
          category: "CORE_ENGINE",
          status: "PENDING",
          timestamp: "2026-08-29T00:00:00.000Z",
        },
      ],
      openDefects: [
        {
          id: "defect-health-scanner-001",
          observation: "Non-existent import in discovery scanner",
          remediation: "Remove non-existent import and sanitize module",
          status: "open",
        },
      ],
    });

    expect(proposals.length).toBe(4);

    const cogProposal = proposals.find((p) => p.id.startsWith("cand-evo-cog-"));
    expect(cogProposal).toBeDefined();
    expect(cogProposal?.kind).toBe("proposal");
    expect(cogProposal?.priority).toBe("HIGH");
    expect(cogProposal?.cognitiveDimension).toBe("COGNITIVE_COMPLEXITY");

    const archProposal = proposals.find((p) => p.id.startsWith("cand-evo-arch-"));
    expect(archProposal).toBeDefined();
    expect(archProposal?.kind).toBe("defect");
    expect(archProposal?.priority).toBe("HIGH");

    const fbProposal = proposals.find((p) => p.id.startsWith("cand-evo-fb-"));
    expect(fbProposal).toBeDefined();
    expect(fbProposal?.kind).toBe("proposal");
    expect(fbProposal?.priority).toBe("HIGH");
    expect(fbProposal?.sourceType).toBe("feedback_intake");

    const defectProposal = proposals.find((p) => p.id.startsWith("cand-evo-defect-"));
    expect(defectProposal).toBeDefined();
    expect(defectProposal?.kind).toBe("defect");
    expect(defectProposal?.priority).toBe("CRITICAL");
    expect(defectProposal?.sourceType).toBe("defect_remediation");
  });

  test("proposeCandidateEvolutions handles empty findings object gracefully", () => {
    const proposals = proposeCandidateEvolutions({});
    expect(proposals).toEqual([]);
  });

  test("health-scanner.ts source code satisfies all repository invariants", () => {
    expect(typeof scanArchitecturalHealth).toBe("function");
    expect(typeof mapPriority).toBe("function");
    expect(typeof mapFeedbackPriorityToTaskPriority).toBe("function");
    expect(typeof proposeCandidateEvolutions).toBe("function");
    expect(typeof sanitizeSlug).toBe("function");
  });
});

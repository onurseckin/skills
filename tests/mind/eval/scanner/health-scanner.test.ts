import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  scanArchitecturalHealth,
  mapPriority,
  mapFeedbackPriorityToTaskPriority,
  proposeCandidateEvolutions,
  sanitizeSlug,
} from "../../../../olt/scripts/src/mind/tasks/discovery/scanners/health-scanner.ts";

describe("health-scanner unit tests", () => {
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
    const testDir = join(tmpdir(), `test-health-scanner-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    try {
      const fileA = join(testDir, "fileA.ts");
      const fileB = join(testDir, "fileB.ts");
      const fileC = join(testDir, "fileC.ts");
      const fileD = join(testDir, "fileD.ts");
      const subDir = join(testDir, "sub");
      mkdirSync(subDir, { recursive: true });
      const indexFile = join(subDir, "index.ts");

      writeFileSync(fileA, `import { b } from "./fileB.ts";\nexport const a = 1;`, "utf8");
      writeFileSync(fileB, `import { a } from "./fileA.ts";\nexport const b = 2;`, "utf8");
      writeFileSync(
        fileC,
        `import { missing } from "./nonExistentFile.ts";\nexport const c = 3;`,
        "utf8",
      );
      writeFileSync(fileD, `import { sub } from "./sub";\nexport const d = 4;`, "utf8");
      writeFileSync(indexFile, `export const sub = "sub";`, "utf8");

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
    } finally {
      if (existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
      }
    }
  });

  test("scanArchitecturalHealth handles clean workspace with zero findings", () => {
    const testDir = join(tmpdir(), `test-health-clean-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    try {
      const fileA = join(testDir, "cleanA.ts");
      const fileB = join(testDir, "cleanB.ts");

      writeFileSync(fileA, `export const a = 10;`, "utf8");
      writeFileSync(fileB, `import { a } from "./cleanA.ts";\nexport const b = a + 20;`, "utf8");

      const result = scanArchitecturalHealth({
        sourceRoots: [testDir],
      });

      expect(result.filesScanned).toBe(2);
      expect(result.totalFindings).toBe(0);
      expect(result.findings).toEqual([]);
    } finally {
      if (existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
      }
    }
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
    const filePath = join(
      process.cwd(),
      "olt/scripts/src/mind/tasks/discovery/scanners/health-scanner.ts",
    );
    expect(existsSync(filePath)).toBe(true);

    const content = readFileSync(filePath, "utf8");
    const lines = content.split("\n");

    expect(lines.length).toBeLessThanOrEqual(300);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const trimmed = line.trim();
      const lineNum = i + 1;

      expect(trimmed.startsWith("//")).toBe(false);
      expect(trimmed.startsWith("/*")).toBe(false);
      expect(trimmed.startsWith("*")).toBe(false);

      expect(trimmed.includes("@" + "ts-ignore")).toBe(false);
      expect(trimmed.includes("@" + "ts-expect-error")).toBe(false);
      expect(trimmed.includes("@" + "ts-nocheck")).toBe(false);
      expect(trimmed.includes("eslint" + "-disable")).toBe(false);

      const hasAny =
        /\b:\s*any\b/.test(trimmed) ||
        /\bas\s+any\b/.test(trimmed) ||
        /<unknown>/.test(trimmed) ||
        /Record<[^,]+,\s*any>/.test(trimmed) ||
        /Promise<unknown>/.test(trimmed);

      if (hasAny) {
        throw new Error(`any found at line ${lineNum}: ${trimmed}`);
      }
      expect(hasAny).toBe(false);
    }

    expect(content.includes("findDefectsForTask")).toBe(false);
  });
});

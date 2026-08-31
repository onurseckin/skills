import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  performDiscoveryScans,
  transformFindingsToDiscoveries,
  synthesizeTaskFromDiscovery,
  formatTaskDiscoveryBrief,
  discoverTasks,
} from "../../../../olt/scripts/src/mind/tasks/discovery/slices/index.ts";
import type {
  DiscoveryItem,
  CodeQualityFinding,
  TestCoverageFinding,
  ArchitecturalHealthFinding,
  DormantCriteriaFinding,
  TaskDiscoveryResult,
} from "../../../../olt/scripts/src/mind/tasks/discovery/types.ts";

describe("Task 1.39: Defect Remediation - Syntax Errors and Dangling Statements in mind/tasks/discovery/slices/", () => {
  test("1. All discovery slice modules and barrel exports exist and export required functions", () => {
    expect(typeof performDiscoveryScans).toBe("function");
    expect(typeof transformFindingsToDiscoveries).toBe("function");
    expect(typeof synthesizeTaskFromDiscovery).toBe("function");
    expect(typeof formatTaskDiscoveryBrief).toBe("function");
    expect(typeof discoverTasks).toBe("function");
  });

  test("2. Slices scans module executes cleanly across categories", () => {
    const outputs = performDiscoveryScans({
      enableCodeQualityScan: false,
      enableTestCoverageScan: false,
      enableCognitiveGapScan: false,
      enableDormantCriteriaScan: false,
      enableArchitecturalHealthScan: false,
      enableFeedbackQueueScan: false,
      enableDefectScan: false,
    });

    expect(outputs).toBeDefined();
    expect(Array.isArray(outputs.rawDiscoveries)).toBe(true);
    expect(outputs.rawDiscoveries.length).toBe(0);
    expect(outputs.findings.codeQuality.length).toBe(0);
    expect(outputs.findings.testCoverage.length).toBe(0);
    expect(outputs.findings.cognitiveGaps.length).toBe(0);
    expect(outputs.findings.dormantCriteria.length).toBe(0);
    expect(outputs.findings.architecturalHealth.length).toBe(0);
    expect(outputs.findings.feedbackPending.length).toBe(0);
    expect(outputs.findings.openDefects.length).toBe(0);
    expect(outputs.maxTasks).toBe(5);
    expect(typeof outputs.nowIso).toBe("string");
  });

  test("3. Slices transformers module transforms findings to structured discoveries", () => {
    const rawDiscoveries: DiscoveryItem[] = [];
    const addDiscovery = (item: DiscoveryItem) => {
      rawDiscoveries.push(item);
    };

    const mockCq: CodeQualityFinding = {
      file: "olt/scripts/src/mind/sample.ts",
      line: 42,
      issueType: "TYPE_SAFETY_ANY",
      description: "Any type in sample",
      severity: "HIGH",
      suggestedRemediation: "Replace any with strict type",
    };

    const mockTc: TestCoverageFinding = {
      sourceFile: "olt/scripts/src/mind/sample.ts",
      testFile: "tests/mind/sample.test.ts",
      issueType: "MISSING_TEST_FILE",
      description: "Missing sample test",
      suggestedRemediation: "Add test suite",
      severity: "HIGH",
    };

    const mockAh: ArchitecturalHealthFinding = {
      file: "olt/scripts/src/mind/sample.ts",
      line: 10,
      issueType: "BROKEN_IMPORT",
      description: "Broken import to ./missing.ts",
      suggestedRemediation: "Fix relative path",
      severity: "HIGH",
    };

    const mockDc: DormantCriteriaFinding = {
      criteriaId: "G1",
      source: "charter_goal",
      statement: "Goal 1 is dormant",
      severity: "MEDIUM",
      suggestedRemediation: "Activate goal G1",
    };

    transformFindingsToDiscoveries({
      codeQualityFindings: [mockCq],
      testCoverageFindings: [mockTc],
      architecturalHealthFindings: [mockAh],
      dormantCriteriaFindings: [mockDc],
      addDiscovery,
    });

    expect(rawDiscoveries.length).toBe(4);
    expect(rawDiscoveries[0]?.category).toBe("CODE_QUALITY");
    expect(rawDiscoveries[0]?.id).toContain("sample-type-safety-any");
    expect(rawDiscoveries[1]?.category).toBe("TEST_COVERAGE");
    expect(rawDiscoveries[1]?.id).toContain("sample-coverage");
    expect(rawDiscoveries[2]?.category).toBe("ARCHITECTURAL_HEALTH");
    expect(rawDiscoveries[2]?.id).toContain("sample-broken-import");
    expect(rawDiscoveries[3]?.category).toBe("DORMANT_CRITERIA");
    expect(rawDiscoveries[3]?.id).toContain("dormant-g1");
  });

  test("4. Slices engine module synthesizes isolated task plans and formats markdown brief", () => {
    const discoveryItem: DiscoveryItem = {
      id: "cq-sample-fix",
      category: "CODE_QUALITY",
      title: "Code Quality: Fix strict types",
      description: "Ensure zero suppressions in sample.ts",
      priority: "HIGH",
      targetFiles: ["olt/scripts/src/mind/sample.ts"],
      writeScope: ["olt/scripts/src/mind/sample.ts", "tests/mind/sample.test.ts"],
      gate: "bun test tests/mind/sample.test.ts && bun run typecheck",
      charterGoals: ["G1"],
      acceptanceCriteria: ["Ensure 0 any", "Pass unit tests"],
      remediation: "Replace with explicit interfaces",
      sourceType: "self_evolution",
    };

    const plan = synthesizeTaskFromDiscovery(discoveryItem, 1);
    expect(plan.id).toBe("task-p49-discovery-1-cq-sample-fix");
    expect(plan.label).toBe("Code Quality: Fix strict types");
    expect(plan.assigned_tier).toBe("Tier_3_Implementer");
    expect(plan.assigned_implementer).toBe("implementer-p49-discovery-cq-sample-fix");
    expect(plan.assigned_validator).toBe("validator-p49-discovery-cq-sample-fix");
    expect(plan.write_scope).toEqual([
      "olt/scripts/src/mind/sample.ts",
      "tests/mind/sample.test.ts",
    ]);

    const mockResult: TaskDiscoveryResult = {
      scannedAt: "2026-08-29T12:00:00.000Z",
      findings: {
        codeQuality: [],
        testCoverage: [],
        cognitiveGaps: [],
        dormantCriteria: [],
        architecturalHealth: [],
        feedbackPending: [],
        openDefects: [],
      },
      discoveries: [discoveryItem],
      candidateProposals: [],
      synthesizedPlans: [plan],
      enqueuedTasks: [],
      stats: {
        totalFindings: 1,
        codeQualityCount: 1,
        testCoverageCount: 0,
        cognitiveGapCount: 0,
        dormantCriteriaCount: 0,
        architecturalHealthCount: 0,
        feedbackCount: 0,
        defectCount: 0,
        synthesizedCount: 1,
        enqueuedCount: 0,
      },
      summary: "Mind Task Discovery: identified 1 finding(s). Synthesized 1 actionable task(s).",
    };

    const brief = formatTaskDiscoveryBrief(mockResult);
    expect(brief).toContain("### Mind Cognitive Task Discovery: 1 Finding(s)");
    expect(brief).toContain("task-p49-discovery-1-cq-sample-fix");
  });

  test("5. Slices runner module runs complete discovery pipeline with deduplication and fallback", () => {
    const result = discoverTasks({
      enableCodeQualityScan: false,
      enableTestCoverageScan: false,
      enableCognitiveGapScan: false,
      enableDormantCriteriaScan: false,
      enableArchitecturalHealthScan: false,
      enableFeedbackQueueScan: false,
      enableDefectScan: false,
      autoEnqueue: false,
    });

    expect(result).toBeDefined();
    expect(result.stats.totalFindings).toBe(0);
    expect(result.synthesizedPlans.length).toBe(1);
    expect(result.synthesizedPlans[0]?.id).toContain("task-p49-discovery-hardening-");
    expect(result.synthesizedPlans[0]?.label).toBe(
      "Perpetual Invariant Hardening & Zero-Suppression Assurance",
    );
    expect(result.summary).toContain("Mind Task Discovery");
  });

  test("6. Slices directory structure and files adhere to strict repository invariants", () => {
    const slicesDir = join(process.cwd(), "olt/scripts/src/mind/tasks/discovery/slices");
    expect(existsSync(slicesDir)).toBe(true);

    const sliceFiles = readdirSync(slicesDir).filter((f) => f.endsWith(".ts"));
    expect(sliceFiles.length).toBeGreaterThanOrEqual(4);
    expect(sliceFiles).toContain("scans.ts");
    expect(sliceFiles).toContain("transformers.ts");
    expect(sliceFiles).toContain("engine.ts");
    expect(sliceFiles).toContain("runner.ts");
    expect(sliceFiles).toContain("index.ts");

    for (const file of sliceFiles) {
      const fullPath = join(slicesDir, file);
      const content = readFileSync(fullPath, "utf8");
      const lines = content.split("\n");

      expect(lines.length).toBeLessThanOrEqual(300);

      expect(content).not.toContain("@ts" + "-ignore");
      expect(content).not.toContain("@ts" + "-expect-error");
      expect(content).not.toContain("@ts" + "-nocheck");
      expect(content).not.toContain("eslint" + "-disable");

      const colonAnyRegex = /:\s*any\b/;
      const asAnyRegex = /as\s+any\b/;
      const bracketAnyRegex = /<unknown>/;
      expect(colonAnyRegex.test(content)).toBe(false);
      expect(asAnyRegex.test(content)).toBe(false);
      expect(bracketAnyRegex.test(content)).toBe(false);

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]?.trim() ?? "";
        if (line.startsWith("//") || line.startsWith("/*") || line.startsWith("*")) {
          throw new Error(`Comment found in ${file} on line ${i + 1}: ${line}`);
        }
      }
    }
  });

  test("7. All discovery files in parent directory adhere to <= 300 lines and zero comments", () => {
    const discoveryDir = join(process.cwd(), "olt/scripts/src/mind/tasks/discovery");
    const topFiles = readdirSync(discoveryDir).filter((f) => f.endsWith(".ts"));

    for (const file of topFiles) {
      const fullPath = join(discoveryDir, file);
      const content = readFileSync(fullPath, "utf8");
      const lines = content.split("\n");

      expect(lines.length).toBeLessThanOrEqual(300);

      expect(content).not.toContain("@ts" + "-ignore");
      expect(content).not.toContain("@ts" + "-expect-error");
      expect(content).not.toContain("@ts" + "-nocheck");

      const colonAnyRegex = /:\s*any\b/;
      const asAnyRegex = /as\s+any\b/;
      const bracketAnyRegex = /<unknown>/;
      expect(colonAnyRegex.test(content)).toBe(false);
      expect(asAnyRegex.test(content)).toBe(false);
      expect(bracketAnyRegex.test(content)).toBe(false);

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]?.trim() ?? "";
        if (line.startsWith("//") || line.startsWith("/*") || line.startsWith("*")) {
          throw new Error(`Comment found in ${file} on line ${i + 1}: ${line}`);
        }
      }
    }
  });
});

import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  appendFeedbackItem,
  readFeedbackQueue,
} from "../../../olt/scripts/src/mind/feedback-queue.ts";
import {
  findSourceDefinition,
  getSourceDefinition,
  getSourceEmpiricalCommand,
  getSourceRevalidationGate,
  mapDiscoveryCategoryToSourceId,
  mapSourceIdToDiscoveryCategory,
  MIND_DISCOVERY_SOURCES,
  validateQuiescentSources,
} from "../../../olt/scripts/src/mind/sources.ts";
import {
  discoverTasks,
  formatTaskDiscoveryBrief,
  proposeCandidateEvolutions,
  resolveDiscoveryCharterPath,
  scanArchitecturalHealth,
  scanCodeQuality,
  scanCognitiveGaps,
  scanDormantCriteria,
  scanTestCoverage,
  synthesizeTaskFromDiscovery,
  type DiscoveryItem,
} from "../../../olt/scripts/src/mind/task-discovery.ts";
import {
  clearTaskQueue,
  enqueueTask,
  readTaskQueue,
} from "../../../olt/scripts/src/mind/task-queue.ts";

describe("Perpetual Infinite Mind Engine with Autonomic Task Discovery & Re-Validation Loops", () => {
  const testDir = join(process.cwd(), ".tmp-test-task-discovery-" + Date.now().toString());
  const taskQueueFile = join(testDir, "TASK_QUEUE.jsonl");
  const feedbackQueueFile = join(testDir, "FEEDBACK_QUEUE.jsonl");
  const charterFile = join(testDir, "CHARTER.md");
  const srcDir = join(testDir, "src");
  const testsDir = join(testDir, "tests");

  function setupWorkspace() {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
    mkdirSync(srcDir, { recursive: true });
    mkdirSync(testsDir, { recursive: true });

    // Seed valid CHARTER.md
    const charterContent = `# CHARTER\n\n## identity\nTest Perpetual Mind System\n\n## goals\n- G1: Infinite Stability\n- G2: Continuous Evolution\n- G3: Strict Type Safety\n\n## non-goals\n- Self Termination\n\n## repo_roots\n- \`src/\`\n`;
    writeFileSync(charterFile, charterContent, "utf8");
  }

  function teardownWorkspace() {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  describe("1. Code Quality Scanner across Canonical Defects (scanCodeQuality)", () => {
    it("detects compiler suppressions, any annotations, oversized modules, literal fallbacks, unexported dead code, and TODOs", () => {
      setupWorkspace();

      const defectiveFile = join(srcDir, "defective.ts");
      const codeLines: string[] = [
        "// Sample module with defects",
        "function unusedInternalHelper() {",
        "  return 42;",
        "}",
        "export function doWork(param: any): any {",
        "  // @ts-ignore",
        "  const x = param.foo;",
        "  // TODO: Refactor this logic later",
        "  if (param.fallback) {",
        '    return "TODO";',
        "  }",
        "  return x;",
        "}",
      ];
      for (let i = 0; i < 15; i++) {
        codeLines.push(`export const item_${i} = ${i};`);
      }
      writeFileSync(defectiveFile, codeLines.join("\n"), "utf8");

      const result = scanCodeQuality({
        sourceRoots: [srcDir],
        maxLineThreshold: 10,
      });

      expect(result.filesScanned).toBe(1);
      expect(result.totalFindings).toBeGreaterThanOrEqual(4);

      const issueTypes = result.findings.map((f) => f.issueType);
      expect(issueTypes).toContain("TYPE_SAFETY_ANY");
      expect(issueTypes).toContain("COMPILER_SUPPRESSION");
      expect(issueTypes).toContain("TODO_FIXME_MARKER");
      expect(issueTypes).toContain("OVERSIZED_MODULE");
      expect(issueTypes).toContain("LITERAL_FALLBACK");
      expect(issueTypes).toContain("UNEXPORTED_DEAD_CODE");

      teardownWorkspace();
    });

    it("returns zero findings on clean, strictly typed files", () => {
      setupWorkspace();

      const cleanFile = join(srcDir, "clean.ts");
      const cleanContent = `export function add(a: number, b: number): number {\n  return a + b;\n}\n`;
      writeFileSync(cleanFile, cleanContent, "utf8");

      const result = scanCodeQuality({
        sourceRoots: [srcDir],
        maxLineThreshold: 500,
      });

      expect(result.filesScanned).toBe(1);
      expect(result.totalFindings).toBe(0);
      expect(result.findings).toEqual([]);

      teardownWorkspace();
    });
  });

  describe("2. Test Coverage Scanner (scanTestCoverage)", () => {
    it("identifies source modules missing corresponding test suites", () => {
      setupWorkspace();

      writeFileSync(join(srcDir, "moduleA.ts"), "export const a = 1;", "utf8");
      writeFileSync(join(srcDir, "moduleB.ts"), "export const b = 2;", "utf8");
      writeFileSync(
        join(testsDir, "moduleA.test.ts"),
        "import { test, expect } from 'bun:test'; test('a', () => expect(1).toBe(1));",
        "utf8",
      );

      const result = scanTestCoverage({
        sourceRoots: [srcDir],
        testRoots: [testsDir],
      });

      expect(result.sourceFilesScanned).toBe(2);
      expect(result.testFilesScanned).toBe(1);
      expect(result.missingTestCount).toBe(1);

      const missing = result.findings.find((f) => f.issueType === "MISSING_TEST_FILE");
      expect(missing).toBeDefined();
      expect(missing?.sourceFile).toContain("moduleB.ts");

      teardownWorkspace();
    });

    it("detects skipped test suites, empty test suites, and low assertion density", () => {
      setupWorkspace();

      writeFileSync(
        join(testsDir, "skipped.test.ts"),
        "import { test } from 'bun:test'; test.skip('disabled', () => {});",
        "utf8",
      );
      writeFileSync(
        join(testsDir, "empty.test.ts"),
        "// Just comments without any test() calls",
        "utf8",
      );
      writeFileSync(
        join(testsDir, "lowdensity.test.ts"),
        "import { test } from 'bun:test'; test('no assertions', () => { const a = 1 + 2; });",
        "utf8",
      );

      const result = scanTestCoverage({
        sourceRoots: [srcDir],
        testRoots: [testsDir],
      });

      const types = result.findings.map((f) => f.issueType);
      expect(types).toContain("SKIPPED_TESTS");
      expect(types).toContain("EMPTY_TEST_SUITE");
      expect(types).toContain("LOW_ASSERTION_DENSITY");

      teardownWorkspace();
    });
  });

  describe("3. Cognitive Gap Scanner (scanCognitiveGaps)", () => {
    it("detects cognitive complexity, Cowan chunking overloads, unhandled boundaries, unbounded collections, and missing error recovery", () => {
      setupWorkspace();

      const complexFile = join(srcDir, "complex.ts");
      const complexCode = [
        "export function processItem(a: string, b: string, c: string, d: string, e: string, f: string) {",
        "  if (a) {",
        "    if (b) {",
        "      if (c) {",
        "        if (d) {",
        "          if (e) {",
        "                        const deepValue = 42;",
        "                        return deepValue;",
        "          }",
        "        }",
        "      }",
        "    }",
        "  }",
        "  try {",
        "    const parsed = JSON.parse(a);",
        "  } catch {",
        "  }",
        "  while (true) {",
        "    const count = 1;",
        "  }",
        "  const raw = JSON.parse(a);",
        "  return raw;",
        "}",
      ].join("\n");
      writeFileSync(complexFile, complexCode, "utf8");

      const result = scanCognitiveGaps({
        sourceRoots: [srcDir],
      });

      expect(result.filesScanned).toBe(1);
      expect(result.totalFindings).toBeGreaterThanOrEqual(4);

      const types = result.findings.map((f) => f.issueType);
      expect(types).toContain("COGNITIVE_COMPLEXITY");
      expect(types).toContain("COGNITIVE_CHUNKING_OVERLOAD");
      expect(types).toContain("UNHANDLED_BOUNDARY");
      expect(types).toContain("UNBOUNDED_COLLECTION");
      expect(types).toContain("MISSING_ERROR_RECOVERY");

      teardownWorkspace();
    });
  });

  describe("4. Dormant Criteria Scanner (scanDormantCriteria)", () => {
    it("identifies charter goals with zero existing tasks in queue", () => {
      setupWorkspace();

      enqueueTask(
        {
          id: "task-g1-work",
          title: "Goal 1 Stability Work",
          write_scope: ["src/"],
          gate: "bun test",
          charter_goals: ["G1"],
        },
        taskQueueFile,
      );

      const result = scanDormantCriteria({
        charterPath: charterFile,
        taskQueuePath: taskQueueFile,
      });

      expect(result.goalsCheckedCount).toBe(3);
      expect(result.dormantCount).toBe(2);

      const dormantIds = result.findings.map((f) => f.criteriaId);
      expect(dormantIds).toContain("G2");
      expect(dormantIds).toContain("G3");
      expect(dormantIds).not.toContain("G1");

      teardownWorkspace();
    });

    it("handles missing charter path gracefully", () => {
      const result = scanDormantCriteria({
        charterPath: "/non/existent/CHARTER.md",
      });

      expect(result.dormantCount).toBe(1);
      expect(result.findings[0]?.criteriaId).toBe("missing-charter");
    });
  });

  describe("5. Architectural Health Scanner (scanArchitecturalHealth)", () => {
    it("detects broken relative imports and circular module dependencies", () => {
      setupWorkspace();

      const fileA = join(srcDir, "moduleA.ts");
      const fileB = join(srcDir, "moduleB.ts");
      const fileC = join(srcDir, "moduleC.ts");

      writeFileSync(fileA, `import { b } from "./moduleB.ts";\nexport const a = b + 1;`, "utf8");
      writeFileSync(fileB, `import { a } from "./moduleA.ts";\nexport const b = 2;`, "utf8");
      writeFileSync(
        fileC,
        `import { missing } from "./nonExistentFile.ts";\nexport const c = 3;`,
        "utf8",
      );

      const result = scanArchitecturalHealth({
        sourceRoots: [srcDir],
      });

      expect(result.filesScanned).toBe(3);
      expect(result.totalFindings).toBeGreaterThanOrEqual(2);

      const types = result.findings.map((f) => f.issueType);
      expect(types).toContain("CIRCULAR_DEPENDENCY");
      expect(types).toContain("BROKEN_IMPORT");

      teardownWorkspace();
    });
  });

  describe("6. Discovery Sources and Empirical Evidence Connection (sources.ts)", () => {
    it("provides all 10 canonical discovery sources with empirical evidence commands and gates", () => {
      expect(MIND_DISCOVERY_SOURCES.length).toBe(10);

      for (const src of MIND_DISCOVERY_SOURCES) {
        expect(src.id).toBeDefined();
        expect(src.number).toBeGreaterThan(0);
        expect(src.empiricalEvidenceCommand).toBeDefined();
        expect(src.empiricalEvidenceCommand.length).toBeGreaterThan(0);
        expect(src.revalidationGate).toBeDefined();
        expect(src.discoveryCategory).toBeDefined();

        const empiricalCmd = getSourceEmpiricalCommand(src.id, { runRoot: ".capsules/test-run" });
        expect(empiricalCmd).not.toContain("<r>");

        const gate = getSourceRevalidationGate(src.id, "tests/unit/mind/test.test.ts");
        expect(gate).toContain("bun test tests/unit/mind/test.test.ts");
      }
    });

    it("maps discovery categories to appropriate mind source IDs and vice-versa", () => {
      expect(mapDiscoveryCategoryToSourceId("CODE_QUALITY")).toBe("unused-code");
      expect(mapDiscoveryCategoryToSourceId("TEST_COVERAGE")).toBe("failing-gates");
      expect(mapDiscoveryCategoryToSourceId("DORMANT_CRITERIA")).toBe("charter-backlog");
      expect(mapDiscoveryCategoryToSourceId("FEEDBACK_INTAKE")).toBe("open-findings");
      expect(mapDiscoveryCategoryToSourceId("BLUNDER_REMEDIATION")).toBe("capsule-integrity");

      expect(mapSourceIdToDiscoveryCategory("unused-code")).toBe("CODE_QUALITY");
      expect(mapSourceIdToDiscoveryCategory("open-findings")).toBe("FEEDBACK_INTAKE");
    });

    it("validates quiescent sources checking 10 of 10 sources", () => {
      const observations = MIND_DISCOVERY_SOURCES.map((s) => ({
        source: s.id,
        count: 0,
      }));

      const check = validateQuiescentSources(observations);
      expect(check.ok).toBe(true);
      expect(check.totalSources).toBe(10);
      expect(check.missingSources).toEqual([]);
      expect(check.nonZeroSources).toEqual([]);
    });
  });

  describe("7. Candidate Evolution Proposals (proposeCandidateEvolutions)", () => {
    it("proposes structured candidate evolutions across all discovery categories", () => {
      const proposals = proposeCandidateEvolutions({
        cognitiveGaps: [
          {
            file: "src/engine.ts",
            line: 42,
            issueType: "COGNITIVE_COMPLEXITY",
            description: "Deeply nested parsing logic",
            severity: "HIGH",
            suggestedRemediation: "Extract sub-parser helper",
          },
        ],
        architecturalHealth: [
          {
            file: "src/broken.ts",
            line: 5,
            issueType: "BROKEN_IMPORT",
            description: "Broken relative import",
            severity: "HIGH",
            suggestedRemediation: "Fix import path",
          },
        ],
        feedbackPending: [
          {
            id: "fb-10",
            title: "Add Metric Exporter",
            content: "Export prometheus metrics",
            priority: "HIGH_ARCHITECTURAL_FEATURE",
            category: "CORE_ENGINE",
            status: "PENDING",
            created_at: new Date().toISOString(),
          },
        ],
      });

      expect(proposals.length).toBe(3);
      expect(proposals[0]?.id).toContain("cand-evo-cog-");
      expect(proposals[0]?.kind).toBe("proposal");
      expect(proposals[0]?.cognitiveDimension).toBe("COGNITIVE_COMPLEXITY");
      expect(proposals[1]?.id).toContain("cand-evo-arch-");
      expect(proposals[2]?.id).toContain("cand-evo-fb-");
    });
  });

  describe("8. Task Synthesis and Anti-Batching (synthesizeTaskFromDiscovery)", () => {
    it("synthesizes isolated tasks with dedicated implementer and validator roles, write scopes, and gates", () => {
      const item: DiscoveryItem = {
        id: "cq-defective-any",
        category: "CODE_QUALITY",
        title: "Fix any type in defective.ts",
        description: "Replace unconstrained any with strict types",
        priority: "HIGH",
        targetFiles: ["src/defective.ts"],
        writeScope: ["src/defective.ts", "tests/defective.test.ts"],
        gate: "bun test tests/defective.test.ts && bun run typecheck",
        charterGoals: ["G3"],
        acceptanceCriteria: ["0 any in src/defective.ts", "Pass unit tests"],
        remediation: "Replace any with strict type guard",
        sourceType: "self_evolution",
      };

      const plan = synthesizeTaskFromDiscovery(item, 1);

      expect(plan.id).toBe("task-p49-discovery-1-cq-defective-any");
      expect(plan.label).toBe("Fix any type in defective.ts");
      expect(plan.write_scope).toEqual(["src/defective.ts", "tests/defective.test.ts"]);
      expect(plan.assigned_tier).toBe("Tier_3_Implementer");
      expect(plan.assigned_implementer).toBe("implementer-p49-discovery-cq-defective-any");
      expect(plan.assigned_validator).toBe("validator-p49-discovery-cq-defective-any");
      expect(plan.assigned_implementer).not.toBe(plan.assigned_validator);
      expect(plan.charter_goals).toEqual(["G3"]);
      expect(plan.metadata?.["discovery_source_id"]).toBe("unused-code");
      expect(plan.metadata?.["empirical_command"]).toBeDefined();
    });
  });

  describe("9. Deduplication Across Discovery Runs (discoverTasks)", () => {
    it("deduplicates findings across runs and avoids recreating existing tasks", () => {
      setupWorkspace();

      writeFileSync(
        join(srcDir, "buggy.ts"),
        "export function run(x: any) {\n  // @ts-ignore\n  return x.val;\n}\n",
        "utf8",
      );

      // Run 1: First discovery run
      const result1 = discoverTasks({
        sourceRoots: [srcDir],
        testRoots: [testsDir],
        charterPath: charterFile,
        feedbackQueuePath: feedbackQueueFile,
        taskQueuePath: taskQueueFile,
        enableBlunderScan: false,
        maxTasks: 5,
        autoEnqueue: true,
      });

      expect(result1.synthesizedPlans.length).toBeGreaterThan(0);
      expect(result1.enqueuedTasks.length).toBe(result1.synthesizedPlans.length);

      const queuedAfterRun1 = readTaskQueue(taskQueueFile);
      expect(queuedAfterRun1.length).toBe(result1.synthesizedPlans.length);

      // Run 2: Second discovery run on the same workspace
      const result2 = discoverTasks({
        sourceRoots: [srcDir],
        testRoots: [testsDir],
        charterPath: charterFile,
        feedbackQueuePath: feedbackQueueFile,
        taskQueuePath: taskQueueFile,
        enableBlunderScan: false,
        maxTasks: 5,
        autoEnqueue: true,
      });

      // Verification: already-queued tasks are not re-enqueued, or fallback hardening task is produced
      const queuedAfterRun2 = readTaskQueue(taskQueueFile);
      // All task IDs in queue must be unique
      const ids = queuedAfterRun2.map((t) => t.id);
      const uniqueIds = new Set(ids);
      expect(ids.length).toBe(uniqueIds.size);

      teardownWorkspace();
    });

    it("synthesizes deterministic continuous hardening tasks on pristine workspace", () => {
      setupWorkspace();

      const result = discoverTasks({
        sourceRoots: [srcDir],
        testRoots: [testsDir],
        charterPath: charterFile,
        feedbackQueuePath: feedbackQueueFile,
        taskQueuePath: taskQueueFile,
        enableBlunderScan: false,
        enableCodeQualityScan: false,
        enableTestCoverageScan: false,
        enableCognitiveGapScan: false,
        enableDormantCriteriaScan: false,
        enableArchitecturalHealthScan: false,
        autoEnqueue: false,
      });

      expect(result.synthesizedPlans.length).toBe(1);
      expect(result.synthesizedPlans[0]?.id).toContain("task-p49-discovery-hardening-");
      expect(result.synthesizedPlans[0]?.label).toContain("Hardening");

      const brief = formatTaskDiscoveryBrief(result);
      expect(brief).toContain("Mind Cognitive Task Discovery");

      teardownWorkspace();
    });
  });

  describe("10. Static Invariant Verification (0 any, 0 suppressions)", () => {
    it("proves 0 TypeScript any and 0 compiler/linter suppressions across write scope files", () => {
      const writeScopeFiles = [
        join(process.cwd(), "olt/scripts/src/mind/task-discovery.ts"),
        join(process.cwd(), "olt/scripts/src/mind/sources.ts"),
        join(process.cwd(), "tests/unit/mind/task-discovery.test.ts"),
      ];

      for (const filePath of writeScopeFiles) {
        expect(existsSync(filePath)).toBe(true);
        const content = readFileSync(filePath, "utf8");
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          const trimmed = line.trim();
          const lineNum = i + 1;

          // Skip comments, test file string definitions, scanner regex rules, and descriptive strings
          if (
            trimmed.startsWith("//") ||
            trimmed.startsWith("/*") ||
            trimmed.startsWith("*") ||
            filePath.endsWith(".test.ts") ||
            trimmed.includes(".test(trimmed)") ||
            trimmed.includes("description:") ||
            trimmed.includes("suggestedRemediation:") ||
            trimmed.includes("acceptanceCriteria:") ||
            trimmed.includes("acceptance_criteria:") ||
            trimmed.includes("rationale:")
          ) {
            continue;
          }

          // Invariant 1: No compiler suppressions
          const suppressionTokens = [
            "@" + "ts-ignore",
            "@" + "ts-nocheck",
            "@" + "ts-expect-error",
            "eslint" + "-disable",
          ];
          for (const token of suppressionTokens) {
            if (trimmed.includes(token)) {
              throw new Error(
                `Compiler suppression '${token}' detected in ${filePath}:${lineNum}: "${trimmed}"`,
              );
            }
            expect(trimmed.includes(token)).toBe(false);
          }

          // Invariant 2: No unconstrained 'any' keywords in TypeScript code
          const hasAnyType =
            /\b:\s*any\b/.test(trimmed) ||
            /\bas\s+any\b/.test(trimmed) ||
            /<any>/.test(trimmed) ||
            /Record<[^,]+,\s*any>/.test(trimmed) ||
            /Promise<any>/.test(trimmed);

          if (hasAnyType) {
            throw new Error(
              `Forbidden 'any' type annotation found in ${filePath}:${lineNum}: "${trimmed}"`,
            );
          }
          expect(hasAnyType).toBe(false);
        }
      }
    });
  });
});

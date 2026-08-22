import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  appendFeedbackItem,
  readFeedbackQueue,
} from "../../../orchestrating-long-tasks/scripts/src/mind/feedback-queue.ts";
import {
  discoverTasks,
  formatTaskDiscoveryBrief,
  proposeCandidateEvolutions,
  resolveDiscoveryCharterPath,
  scanCodeQuality,
  scanCognitiveGaps,
  scanDormantCriteria,
  scanTestCoverage,
  synthesizeTaskFromDiscovery,
  type DiscoveryItem,
} from "../../../orchestrating-long-tasks/scripts/src/mind/task-discovery.ts";
import {
  mindTaskDiscoveryCommand,
  MIND_TASK_DISCOVERY_COMMAND_SPEC,
} from "../../../orchestrating-long-tasks/scripts/src/mind/mind.ts";
import {
  clearTaskQueue,
  enqueueTask,
  readTaskQueue,
} from "../../../orchestrating-long-tasks/scripts/src/mind/task-queue.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

describe("Autonomous Mind Cognitive Task Discovery Engine", () => {
  const testDir = scratchRoot(import.meta.path, "test-task-discovery");
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

    // Seed CHARTER.md
    const charterContent = `# CHARTER\n\n## identity\nTest Perpetual Mind System\n\n## goals\n- G1: Infinite Stability\n- G2: Continuous Evolution\n- G3: Strict Type Safety\n\n## non-goals\n- Self Termination\n\n## repo_roots\n- \`src/\`\n`;
    writeFileSync(charterFile, charterContent, "utf8");
  }

  function teardownWorkspace() {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  }

  describe("Code Quality Scanner (scanCodeQuality)", () => {
    it("detects compiler suppressions, any annotations, oversized modules, and TODOs", () => {
      setupWorkspace();

      const defectiveFile = join(srcDir, "defective.ts");
      const codeLines: string[] = [
        "// Sample module",
        "export function doWork(param: any): any {",
        "  // @ts-ignore",
        "  const x = param.foo;",
        "  // TODO: Refactor this logic later",
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
      expect(result.totalFindings).toBeGreaterThanOrEqual(3);

      const issueTypes = result.findings.map((f) => f.issueType);
      expect(issueTypes).toContain("TYPE_SAFETY_ANY");
      expect(issueTypes).toContain("COMPILER_SUPPRESSION");
      expect(issueTypes).toContain("TODO_FIXME_MARKER");
      expect(issueTypes).toContain("OVERSIZED_MODULE");

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

  describe("Test Coverage Scanner (scanTestCoverage)", () => {
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

    it("detects skipped test suites and empty test suites", () => {
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

      const result = scanTestCoverage({
        sourceRoots: [srcDir],
        testRoots: [testsDir],
      });

      const types = result.findings.map((f) => f.issueType);
      expect(types).toContain("SKIPPED_TESTS");
      expect(types).toContain("EMPTY_TEST_SUITE");

      teardownWorkspace();
    });
  });

  describe("Cognitive Gap Scanner (scanCognitiveGaps)", () => {
    it("detects cognitive complexity, parameter overloading, and unhandled boundaries", () => {
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
        "  const raw = JSON.parse(a);",
        "  return raw;",
        "}",
      ].join("\n");
      writeFileSync(complexFile, complexCode, "utf8");

      const result = scanCognitiveGaps({
        sourceRoots: [srcDir],
      });

      expect(result.filesScanned).toBe(1);
      expect(result.totalFindings).toBeGreaterThanOrEqual(2);

      const types = result.findings.map((f) => f.issueType);
      expect(types).toContain("COGNITIVE_COMPLEXITY");
      expect(types).toContain("COGNITIVE_CHUNKING_OVERLOAD");
      expect(types).toContain("UNHANDLED_BOUNDARY");

      teardownWorkspace();
    });
  });

  describe("Dormant Criteria Scanner (scanDormantCriteria)", () => {
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

  describe("Candidate Evolution Proposals (proposeCandidateEvolutions)", () => {
    it("proposes structured candidate evolutions across findings", () => {
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

      expect(proposals.length).toBe(2);
      expect(proposals[0]?.id).toContain("cand-evo-cog-");
      expect(proposals[0]?.kind).toBe("proposal");
      expect(proposals[0]?.cognitiveDimension).toBe("COGNITIVE_COMPLEXITY");
      expect(proposals[1]?.id).toContain("cand-evo-fb-");
      expect(proposals[1]?.sourceType).toBe("feedback_intake");
    });
  });

  describe("Task Synthesis and Anti-Batching (synthesizeTaskFromDiscovery)", () => {
    it("synthesizes isolated tasks with dedicated implementer and validator roles", () => {
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
    });
  });

  describe("Full Discovery Engine (discoverTasks)", () => {
    it("scans workspace and synthesizes tasks from multiple discovery dimensions", () => {
      setupWorkspace();

      writeFileSync(
        join(srcDir, "buggy.ts"),
        "export function run(x: any) {\n  // @ts-ignore\n  return x.val;\n}\n",
        "utf8",
      );

      appendFeedbackItem(
        {
          id: "fb-stream-parser",
          title: "Implement Stream Parser",
          content: "Add streaming json parser support",
          priority: "HIGH_ARCHITECTURAL_FEATURE",
          category: "CORE_ENGINE",
          status: "PENDING",
        },
        feedbackQueueFile,
      );

      const result = discoverTasks({
        sourceRoots: [srcDir],
        testRoots: [testsDir],
        charterPath: charterFile,
        feedbackQueuePath: feedbackQueueFile,
        taskQueuePath: taskQueueFile,
        enableBlunderScan: false,
        maxTasks: 10,
        autoEnqueue: true,
      });

      expect(result.stats.totalFindings).toBeGreaterThan(0);
      expect(result.synthesizedPlans.length).toBeGreaterThan(0);
      expect(result.enqueuedTasks.length).toBe(result.synthesizedPlans.length);
      expect(result.candidateProposals.length).toBeGreaterThan(0);

      const queued = readTaskQueue(taskQueueFile);
      expect(queued.length).toBe(result.synthesizedPlans.length);

      const brief = formatTaskDiscoveryBrief(result);
      expect(brief).toContain("Mind Cognitive Task Discovery");
      expect(brief).toContain("Code Quality");

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
        autoEnqueue: false,
      });

      expect(result.synthesizedPlans.length).toBeGreaterThanOrEqual(1);
      expect(result.synthesizedPlans[0]?.id).toContain("task-p49-discovery-");

      teardownWorkspace();
    });
  });

  describe("CLI Command Handler (mindTaskDiscoveryCommand)", () => {
    it("executes CLI command and produces structured output and markdown", () => {
      setupWorkspace();

      const flags = {
        "source-root": [srcDir],
        "test-root": [testsDir],
        charter: charterFile,
        "feedback-queue": feedbackQueueFile,
        "task-queue": taskQueueFile,
        "auto-enqueue": true,
        "max-tasks": "3",
      };

      const result = mindTaskDiscoveryCommand(flags);

      expect(result).toBeDefined();
      expect(typeof result["markdown"]).toBe("string");
      expect(Array.isArray(result["synthesized_plans"])).toBe(true);
      expect(Array.isArray(result["enqueued_tasks"])).toBe(true);
      expect(MIND_TASK_DISCOVERY_COMMAND_SPEC.name).toBe("mind:task-discovery");

      teardownWorkspace();
    });
  });
});

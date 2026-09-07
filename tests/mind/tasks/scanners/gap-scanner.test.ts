import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import {
  scanCognitiveGaps,
  scanDormantCriteria,
} from "../../../../olt/scripts/src/mind/tasks/discovery/scanners/gap-scanner.ts";
import type { TaskQueueItem } from "../../../../olt/scripts/src/task/queue/index.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("Mind Task Discovery Gap Scanner Suite", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession;
  const spies: Array<{ mockRestore: () => void }> = [];

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
  });

  afterEach(() => {
    for (const spy of spies) {
      spy.mockRestore();
    }
    spies.length = 0;
    session.cleanup();
  });

  describe("scanCognitiveGaps", () => {
    it("returns zero findings when directory contains no source files", () => {
      const result = scanCognitiveGaps({ sourceRoots: ["/virtual/empty"] });
      expect(result.filesScanned).toBe(0);
      expect(result.totalFindings).toBe(0);
      expect(result.findings).toHaveLength(0);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("detects excessive nesting depth (COGNITIVE_COMPLEXITY) while ignoring comments", () => {
      const code = [
        "function deeplyNested() {",
        "                    const deep = 42;",
        "                    // comment with spaces",
        "                    * multiline comment space",
        "}",
      ].join("\n");

      vfs.mkdirSync("/virtual/code", { recursive: true });
      vfs.writeFileSync("/virtual/code/nested.ts", code);

      const result = scanCognitiveGaps({ sourceRoots: ["/virtual/code"] });
      expect(result.totalFindings).toBe(1);
      expect(result.findings[0]?.issueType).toBe("COGNITIVE_COMPLEXITY");
      expect(result.findings[0]?.severity).toBe("MEDIUM");
      expect(result.findings[0]?.line).toBe(2);
    });

    it("detects >5 parameter chunking overload in functions and arrow functions", () => {
      const code = [
        "function fnA(a, b, c, d, e, f) { return 1; }",
        "const fnB = (p1: string, p2: string, p3: string, p4: string, p5: string, p6: string) => 2;",
      ].join("\n");

      vfs.mkdirSync("/virtual/chunking", { recursive: true });
      vfs.writeFileSync("/virtual/chunking/chunking.ts", code);

      const result = scanCognitiveGaps({ sourceRoots: ["/virtual/chunking"] });
      expect(result.totalFindings).toBe(2);
      expect(result.findings[0]?.issueType).toBe("COGNITIVE_CHUNKING_OVERLOAD");
      expect(result.findings[1]?.issueType).toBe("COGNITIVE_CHUNKING_OVERLOAD");
    });

    it("detects unprotected JSON.parse boundaries and ignores protected ones", () => {
      const code = [
        "const unprotected = JSON.parse(raw);",
        "try {",
        "  const protectedParsed = JSON.parse(data);",
        "} catch (err) {",
        "  console.error(err);",
        "}",
      ].join("\n");

      vfs.mkdirSync("/virtual/json", { recursive: true });
      vfs.writeFileSync("/virtual/json/json.ts", code);

      const result = scanCognitiveGaps({ sourceRoots: ["/virtual/json"] });
      expect(result.totalFindings).toBe(1);
      expect(result.findings[0]?.issueType).toBe("UNHANDLED_BOUNDARY");
      expect(result.findings[0]?.severity).toBe("HIGH");
      expect(result.findings[0]?.line).toBe(1);
    });

    it("detects unbounded while(true) loops lacking exit points", () => {
      const code = [
        "while (true) {",
        "  doSomething();",
        "}",
        "while (1) {",
        "  if (check()) break;",
        "}",
      ].join("\n");

      vfs.mkdirSync("/virtual/loop", { recursive: true });
      vfs.writeFileSync("/virtual/loop/loop.ts", code);

      const result = scanCognitiveGaps({ sourceRoots: ["/virtual/loop"] });
      expect(result.totalFindings).toBe(1);
      expect(result.findings[0]?.issueType).toBe("UNBOUNDED_COLLECTION");
      expect(result.findings[0]?.severity).toBe("HIGH");
    });

    it("detects single-line and multi-line empty catch blocks", () => {
      const code = [
        "try { run(); } catch {}",
        "try { work(); } catch (err) {}",
        "try { action(); } catch {",
        "}",
        "try { step(); } catch {",
        "  // swallowed",
        "}",
      ].join("\n");

      vfs.mkdirSync("/virtual/catch", { recursive: true });
      vfs.writeFileSync("/virtual/catch/catch.ts", code);

      const result = scanCognitiveGaps({ sourceRoots: ["/virtual/catch"] });
      expect(result.totalFindings).toBe(4);
      for (const finding of result.findings) {
        expect(finding.issueType).toBe("MISSING_ERROR_RECOVERY");
      }
    });

    it("respects maxFindings limit and handles read errors gracefully", () => {
      const code = [
        "const p1 = JSON.parse(a);",
        "const p2 = JSON.parse(b);",
        "const p3 = JSON.parse(c);",
      ].join("\n");

      vfs.mkdirSync("/virtual/cap", { recursive: true });
      vfs.writeFileSync("/virtual/cap/err.ts", code);
      vfs.writeFileSync("/virtual/cap/valid.ts", code);

      spies.push(
        spyOn(vfs, "readFileSync").mockImplementation((p: string) => {
          if (String(p).includes("err.ts")) throw new Error("unreadable");
          return code;
        }),
      );

      const result = scanCognitiveGaps({
        sourceRoots: ["/virtual/cap"],
        maxFindings: 2,
      });
      expect(result.totalFindings).toBe(2);
      expect(result.findings).toHaveLength(2);
    });
  });

  describe("scanDormantCriteria", () => {
    it("returns critical missing-charter finding when charter does not exist", () => {
      const result = scanDormantCriteria({ charterPath: "/virtual/missing.yaml" });
      expect(result.dormantCount).toBe(1);
      expect(result.goalsCheckedCount).toBe(0);
      expect(result.findings[0]?.criteriaId).toBe("missing-charter");
      expect(result.findings[0]?.severity).toBe("CRITICAL");
    });

    it("identifies dormant charter goals and empty stability checks using recentTasksHistory", () => {
      const charterYaml = [
        "identity: TestMind",
        "goals:",
        "  - id: G1",
        "    statement: Target latency reduction",
        "  - id: G2",
        "    statement: Eliminate memory leaks",
        "non_goals:",
        "  - Do not alter external APIs",
        "stability:",
        '  - command: ""',
        "    expectedExit: 0",
      ].join("\n");

      const recentTasks: readonly TaskQueueItem[] = [
        {
          id: "task-1",
          label: "Latency fix",
          charter_goals: ["G1"],
          write_scope: ["src/latency.ts"],
          status: "completed",
        } as unknown as TaskQueueItem,
      ];

      vfs.mkdirSync("/virtual", { recursive: true });
      vfs.writeFileSync("/virtual/charter.yaml", charterYaml);

      const result = scanDormantCriteria({
        charterPath: "/virtual/charter.yaml",
        recentTasksHistory: recentTasks,
        maxFindings: 10,
      });

      expect(result.goalsCheckedCount).toBe(2);
      expect(result.dormantCount).toBe(2);
      const g2Finding = result.findings.find((f) => f.criteriaId === "G2");
      expect(g2Finding).toBeDefined();
      expect(g2Finding?.statement).toBe("Eliminate memory leaks");
      expect(g2Finding?.source).toBe("charter_goal");

      const stabFinding = result.findings.find((f) => f.source === "charter_stability");
      expect(stabFinding).toBeDefined();
      expect(stabFinding?.severity).toBe("LOW");
    });

    it("falls back to task queue when recentTasksHistory is omitted and respects maxFindings", () => {
      const charterYaml = [
        "identity: QueueMind",
        "goals:",
        "  - id: G1",
        "    statement: First goal",
        "  - id: G2",
        "    statement: Second goal",
        "non_goals:",
        "  - Out of scope",
      ].join("\n");

      vfs.mkdirSync("/virtual", { recursive: true });
      vfs.writeFileSync("/virtual/charter.yaml", charterYaml);
      vfs.writeFileSync(
        "/virtual/tasks.json",
        JSON.stringify({
          tasks: [{ id: "t1", charter_goals: ["G1"], status: "completed" }],
        }),
      );

      const result = scanDormantCriteria({
        charterPath: "/virtual/charter.yaml",
        taskQueuePath: "/virtual/tasks.json",
        maxFindings: 1,
      });

      expect(result.dormantCount).toBe(1);
      expect(result.findings).toHaveLength(1);
    });

    it("emits critical finding when charter fails schema validation (HarnessError)", () => {
      vfs.mkdirSync("/virtual", { recursive: true });
      vfs.writeFileSync("/virtual/corrupt.yaml", 'identity: ""\n');

      const result = scanDormantCriteria({ charterPath: "/virtual/corrupt.yaml" });
      expect(result.dormantCount).toBe(1);
      expect(result.findings[0]?.criteriaId).toBe("charter-parse-error");
      expect(result.findings[0]?.severity).toBe("CRITICAL");
    });

    it("handles generic errors during charter parse without crashing", () => {
      vfs.mkdirSync("/virtual", { recursive: true });
      vfs.writeFileSync("/virtual/charter.yaml", "identity: Test\n");

      spies.push(
        spyOn(vfs, "readFileSync").mockImplementation(() => {
          throw new TypeError("Generic JS type error");
        }),
      );

      const result = scanDormantCriteria({ charterPath: "/virtual/charter.yaml" });
      expect(result.dormantCount).toBe(0);
      expect(result.findings).toHaveLength(0);
    });
  });
});

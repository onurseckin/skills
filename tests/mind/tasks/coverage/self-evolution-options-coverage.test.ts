import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { synthesizeSmartTasksFromSelfEvolution } from "../../../../olt/scripts/src/mind/tasks/smart/executor/evolution/self-evolution.ts";

describe("Self-Evolution Options & Structure Variations Suite", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(
      tmpdir(),
      `self-evo-opts-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    );
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("maxTasks & Truncation Handling", () => {
    it("respects maxTasks limit when set smaller than available tasks", () => {
      const result = synthesizeSmartTasksFromSelfEvolution({
        capsulesDir: tempDir,
        workspaceRoot: tempDir,
        maxTasks: 2,
      });

      expect(result.tasks.length).toBe(2);
      expect(result.tasks[0]?.id).toBe("task-1-invariant-hardening");
      expect(result.tasks[1]?.id).toBe("task-2-product-ux-quality-audit");
    });

    it("handles maxTasks = 1 cleanly", () => {
      const result = synthesizeSmartTasksFromSelfEvolution({
        capsulesDir: tempDir,
        workspaceRoot: tempDir,
        maxTasks: 1,
      });

      expect(result.tasks.length).toBe(1);
      expect(result.tasks[0]?.id).toBe("task-1-invariant-hardening");
    });
  });

  function runInNonTestEnvironment<T>(fn: () => T): T {
    const origNodeEnv = process.env["NODE_ENV"];
    const origBunTest = process.env["BUN_TEST"];
    const origTest = process.env["TEST"];
    const origArgv = [...process.argv];
    try {
      process.env["NODE_ENV"] = "production";
      delete process.env["BUN_TEST"];
      delete process.env["TEST"];
      process.argv = ["bun", "run.js"];
      return fn();
    } finally {
      if (origNodeEnv !== undefined) process.env["NODE_ENV"] = origNodeEnv;
      else delete process.env["NODE_ENV"];
      if (origBunTest !== undefined) process.env["BUN_TEST"] = origBunTest;
      else delete process.env["BUN_TEST"];
      if (origTest !== undefined) process.env["TEST"] = origTest;
      else delete process.env["TEST"];
      process.argv = origArgv;
    }
  }

  describe("Repository Structure Scope & Gate Adaptations", () => {
    it("adapts step 2 scope when repository contains packages/ but no apps/", () => {
      mkdirSync(join(tempDir, "packages", "pkg-a"), { recursive: true });
      mkdirSync(join(tempDir, "tests", "unit"), { recursive: true });

      const result = runInNonTestEnvironment(() =>
        synthesizeSmartTasksFromSelfEvolution({
          capsulesDir: tempDir,
          repoRoot: tempDir,
        }),
      );

      const step2 = result.tasks[1];
      expect(step2?.write_scope[0]).toContain("packages");
      expect(step2?.gate).toContain("bun test");
    });

    it("adapts step 2 scope when repository contains src/ only", () => {
      mkdirSync(join(tempDir, "src", "core"), { recursive: true });

      const result = runInNonTestEnvironment(() =>
        synthesizeSmartTasksFromSelfEvolution({
          capsulesDir: tempDir,
          repoRoot: tempDir,
        }),
      );

      const step2 = result.tasks[1];
      expect(step2?.write_scope[0]).toContain("src");
    });

    it("falls back to default gates when no test directories exist", () => {
      const emptyDir = join(tempDir, "empty-repo");
      mkdirSync(emptyDir, { recursive: true });

      const result = runInNonTestEnvironment(() =>
        synthesizeSmartTasksFromSelfEvolution({
          capsulesDir: emptyDir,
          repoRoot: emptyDir,
        }),
      );

      const step1 = result.tasks[0];
      expect(step1?.gate).toBe("bun test tests/unit && bun run typecheck");

      const step2 = result.tasks[1];
      expect(step2?.gate).toBe("bun test && bun run typecheck");
    });
  });

  describe("Auto-Enqueue & Cognitive Memory Updates", () => {
    it("enqueues tasks batch to queuePath when autoEnqueue is enabled", () => {
      const queuePath = join(tempDir, ".olt", "task-queue.jsonl");

      const result = synthesizeSmartTasksFromSelfEvolution({
        capsulesDir: tempDir,
        workspaceRoot: tempDir,
        autoEnqueue: true,
        queuePath,
      });

      expect(result.enqueued_count).toBe(3);
      expect(existsSync(queuePath)).toBe(true);

      const queueLines = readFileSync(queuePath, "utf-8").trim().split("\n");
      expect(queueLines.length).toBe(3);
    });

    it("updates cognitive memory file with hypotheses and macro metrics", () => {
      const memPath = join(tempDir, ".olt", "cognitive-memory.json");

      const result = synthesizeSmartTasksFromSelfEvolution({
        capsulesDir: tempDir,
        workspaceRoot: tempDir,
        cognitiveMemoryPath: memPath,
      });

      expect(result.tasks.length).toBe(3);
      expect(existsSync(memPath)).toBe(true);

      const memContent = JSON.parse(readFileSync(memPath, "utf-8")) as {
        strategic_focus: string[];
        active_hypotheses: Array<{ id: string; confidence: number }>;
      };
      expect(memContent.strategic_focus.length).toBeGreaterThan(0);
      expect(memContent.active_hypotheses[0]?.id).toBe("hyp-creative-pm-flow");
      expect(memContent.active_hypotheses[0]?.confidence).toBe(0.96);
    });
  });
});

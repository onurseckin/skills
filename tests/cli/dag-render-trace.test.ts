import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { writeFile, mkdir } from "node:fs/promises";
import { execute } from "../../olt/scripts/src/cli/execute.ts";
import {
  dagRenderCommand,
  dagTraceCommand,
  executeDagRenderCommand,
  executeDagTraceCommand,
} from "../../olt/scripts/src/cli/commands/dag.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

describe("CLI dag:render and dag:trace commands", () => {
  describe("dagRenderCommand and executeDagRenderCommand", () => {
    test("renders uncompiled planning buffer DAG with box-styles", async () => {
      const scratch = scratchRoot(import.meta.path, "dag-render-uncompiled");
      const promptPath = join(scratch, "prompt.txt");
      await writeFile(promptPath, "Test uncompiled DAG rendering");

      const init = await execute([
        "plan:init",
        "--repo",
        scratch,
        "--run",
        "dag-run-uncompiled",
        "--prompt-file",
        promptPath,
      ]);
      const runRoot = init.run_root as string;

      await execute([
        "plan:add",
        "--run",
        runRoot,
        "--id",
        "task-1",
        "--label",
        "Task 1",
        "--scope",
        "src/a",
        "--gate",
        "bun test src/a",
        "--actor",
        "planner",
      ]);

      await execute([
        "plan:add",
        "--run",
        runRoot,
        "--id",
        "task-2",
        "--label",
        "Task 2",
        "--scope",
        "src/b",
        "--gate",
        "bun test src/b",
        "--deps",
        "task-1",
        "--dep-reason",
        "task-1:data dependency",
        "--actor",
        "planner",
      ]);

      const resRounded = dagRenderCommand({ run: runRoot, "box-style": "rounded", all: true });
      expect(String(resRounded.markdown)).toContain("task-1");
      expect(String(resRounded.markdown)).toContain("task-2");

      const resSharp = dagRenderCommand({ run: runRoot, "box-style": "sharp", detailed: true });
      expect(resSharp.markdown).toBeDefined();

      const resAscii = dagRenderCommand({ run: runRoot, "box-style": "ascii" });
      expect(resAscii.markdown).toBeDefined();

      const execRes = executeDagRenderCommand(["--run", runRoot, "--all"]);
      expect(execRes.nodes.length).toBe(2);
      expect(execRes.totalTasks).toBe(2);

      const execFlagsRes = executeDagRenderCommand({ run: runRoot, detailed: true });
      expect(execFlagsRes.nodes.length).toBe(2);
    });

    test("renders compiled graph DAG with tasks, leases, and agents", async () => {
      const scratch = scratchRoot(import.meta.path, "dag-render-compiled");
      const promptPath = join(scratch, "prompt.txt");
      await writeFile(promptPath, "Test compiled DAG rendering");
      await mkdir(join(scratch, "src/core"), { recursive: true });
      await writeFile(join(scratch, "gate-core.ts"), "console.log('ok');\n");

      const init = await execute([
        "plan:init",
        "--repo",
        scratch,
        "--run",
        "dag-run-compiled",
        "--prompt-file",
        promptPath,
      ]);
      const runRoot = init.run_root as string;

      await execute([
        "plan:add",
        "--run",
        runRoot,
        "--id",
        "task-core",
        "--label",
        "Core Task",
        "--scope",
        "src/core",
        "--gate",
        "bun gate-core.ts",
        "--actor",
        "planner",
      ]);

      await execute(["plan:brainstorm", "--run", runRoot, "--actor", "planner"]);
      await execute([
        "plan:compile",
        "--run",
        runRoot,
        "--actor",
        "planner",
        "--completion-gate",
        "bun gate-core.ts",
      ]);

      await execute([
        "agent:register",
        "--run",
        runRoot,
        "--agent",
        "worker-1",
        "--role",
        "implementer",
        "--host",
        "antigravity",
      ]);

      await execute([
        "task:claim",
        "--run",
        runRoot,
        "--task",
        "task-core",
        "--agent",
        "worker-1",
        "--role",
        "implementer",
      ]);

      const res = dagRenderCommand({ run: runRoot, repo: scratch, all: true });
      expect(String(res.markdown)).toContain("task-core");

      const execTokens = executeDagRenderCommand(["dag:render", "--run", runRoot]);
      expect(execTokens.isCompiled).toBe(true);
    });
  });

  describe("dagTraceCommand and executeDagTraceCommand", () => {
    test("traces living execution events with filters and sequencing", async () => {
      const scratch = scratchRoot(import.meta.path, "dag-trace-run");
      const promptPath = join(scratch, "prompt.txt");
      await writeFile(promptPath, "Test living trace rendering");

      const init = await execute([
        "plan:init",
        "--repo",
        scratch,
        "--run",
        "trace-run-01",
        "--prompt-file",
        promptPath,
      ]);
      const runRoot = init.run_root as string;

      await execute([
        "plan:add",
        "--run",
        runRoot,
        "--id",
        "task-trace",
        "--label",
        "Trace Task",
        "--scope",
        "src/trace",
        "--gate",
        "echo ok",
        "--actor",
        "planner",
      ]);

      const resDefault = dagTraceCommand({ run: runRoot, all: true });
      expect(resDefault.markdown).toBeDefined();

      const resFiltered = dagTraceCommand({
        run: runRoot,
        "from-seq": "1",
        "to-seq": "10",
        "max-steps": "5",
        task: "task-trace",
        actor: "planner",
        "filter-kind": "plan-task-added",
        detailed: true,
      });
      expect(resFiltered.markdown).toBeDefined();

      const resTypeFilter = dagTraceCommand({
        run: runRoot,
        "filter-type": "plan-task-added",
      });
      expect(resTypeFilter.markdown).toBeDefined();

      const execTokens = executeDagTraceCommand(["--run", runRoot, "--all"]);
      expect(execTokens.dynamicDag.runId).toBe("trace-run-01");

      const execNamedTokens = executeDagTraceCommand(["dag:trace", "--run", runRoot]);
      expect(execNamedTokens.dynamicDag.runId).toBe("trace-run-01");

      const execFlags = executeDagTraceCommand({ run: runRoot, detailed: true });
      expect(execFlags.dynamicDag.runId).toBe("trace-run-01");
    });
  });

  describe("Static Invariant Verification: Zero TypeScript any & Zero Suppressions", () => {
    test("verifies dag-render-trace test file contains zero any and zero suppressions", async () => {
      const testContent = await Bun.file(import.meta.path).text();
      const forbiddenAnyRegex = new RegExp(":[ \\t]*" + "any\\b");
      const forbiddenCastRegex = new RegExp("\\bas[ \\t]+" + "any\\b");
      const forbiddenSuppressionsRegex = new RegExp("@ts-" + "(ignore|expect-error|nocheck)");
      const forbiddenLintRegex = new RegExp("(eslint|oxlint)" + "-disable");

      expect(testContent).not.toMatch(forbiddenAnyRegex);
      expect(testContent).not.toMatch(forbiddenCastRegex);
      expect(testContent).not.toMatch(forbiddenSuppressionsRegex);
      expect(testContent).not.toMatch(forbiddenLintRegex);
    });
  });
});

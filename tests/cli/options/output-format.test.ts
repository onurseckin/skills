import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stripOutputFormat } from "../../../olt/scripts/src/cli/output-format.ts";
import { main } from "../../../olt/scripts/harness.ts";
import { scratchRoot } from "../../../support/scratch-root.ts";

const MIN_MIND_MANIFEST_YAML = `role: mind
tier: 0
spawns:
  - orchestrator
may:
  - Coordinate strategic goals
must_not:
  - Implement code directly
`;

async function runHarnessInProcess(
  argv: readonly string[],
): Promise<{ stdout: string; isJson: boolean }> {
  let output = "";
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: unknown) => {
    output += String(chunk);
    return true;
  }) as typeof process.stdout.write;

  try {
    const format = stripOutputFormat(argv);
    await main(argv);
    return { stdout: output, isJson: format.json };
  } finally {
    process.stdout.write = originalWrite;
  }
}

describe("harness output format scan", () => {
  test("removes the harness --format flag in both spellings", () => {
    expect(stripOutputFormat(["run:status", "--run", "/tmp/run", "--format=json"])).toEqual({
      json: true,
      argv: ["run:status", "--run", "/tmp/run"],
    });
    expect(stripOutputFormat(["run:status", "--format", "json", "--run", "/tmp/run"])).toEqual({
      json: true,
      argv: ["run:status", "--run", "/tmp/run"],
    });
  });

  test("reports markdown output when no format flag is present", () => {
    expect(stripOutputFormat(["run:status", "--run", "/tmp/run"])).toEqual({
      json: false,
      argv: ["run:status", "--run", "/tmp/run"],
    });
  });

  test("leaves a child command's own --format untouched after the -- boundary", () => {
    expect(
      stripOutputFormat(["run:exec", "--run", "/tmp/run", "--", "bun", "test", "--format", "json"]),
    ).toEqual({
      json: false,
      argv: ["run:exec", "--run", "/tmp/run", "--", "bun", "test", "--format", "json"],
    });
    expect(
      stripOutputFormat([
        "run:exec",
        "--format",
        "json",
        "--run",
        "/tmp/run",
        "--",
        "x",
        "--format=json",
      ]),
    ).toEqual({ json: true, argv: ["run:exec", "--run", "/tmp/run", "--", "x", "--format=json"] });
  });

  test("passes the child argv through the harness unchanged", async () => {
    const repo = scratchRoot(import.meta.path, "harness-format-child-argv");
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(repo, "src", "file.ts"), "export const x = 1;\n");
    const prompt = join(repo, "prompt.txt");
    writeFileSync(prompt, "verbatim prompt");

    await main(["plan:init", "--repo", repo, "--run-id", "format-run", "--prompt-file", prompt]);

    const runRoot = join(repo, ".olt", "capsules", "format-run");
    await main([
      "plan:add",
      "--run",
      runRoot,
      "--id",
      "task-1",
      "--label",
      "Task 1",
      "--scope",
      "src",
      "--gate",
      "bun test src/file.ts",
      "--actor",
      "planner",
    ]);

    await main(["plan:brainstorm", "--run", runRoot, "--actor", "planner"]);
    await main([
      "plan:compile",
      "--run",
      runRoot,
      "--actor",
      "planner",
      "--completion-gate",
      "bun test src/file.ts",
    ]);

    await main([
      "agent:register",
      "--run",
      runRoot,
      "--agent",
      "implementer-1",
      "--role",
      "implementer",
      "--host",
      "antigravity",
      "--parent-task",
      "task-1",
    ]);

    const res = await runHarnessInProcess([
      "run:exec",
      "--run",
      runRoot,
      "--actor",
      "implementer-1",
      "--format",
      "json",
      "--",
      "echo",
      "--format=json",
    ]);

    const parsed = JSON.parse(res.stdout) as {
      ok: boolean;
      result: { command: { argv: string[] }; exit_code: number };
    };
    expect(parsed.ok).toBeTrue();
    expect(parsed.result.command.argv).toEqual(["echo", "--format=json"]);
    expect(parsed.result.exit_code).toBe(0);
  });

  test("mind:audit:live --format json emits exactly one JSON value on stdout", async () => {
    const repo = scratchRoot(import.meta.path, "mind-audit-live-format-json");
    mkdirSync(join(repo, ".olt"), { recursive: true });
    mkdirSync(join(repo, "olt", "agents"), { recursive: true });
    writeFileSync(join(repo, "olt", "agents", "mind.yaml"), MIN_MIND_MANIFEST_YAML);

    const res = await runHarnessInProcess(["mind:audit:live", "--repo", repo, "--format", "json"]);
    const stdout = res.stdout;
    const nonEmptyLines = stdout.split("\n").filter((line) => line.trim() !== "");
    expect(nonEmptyLines).toHaveLength(1);
    expect(() => JSON.parse(stdout)).not.toThrow();
    const parsed = JSON.parse(stdout) as { ok: boolean; result: { stagnant: boolean } };
    expect(parsed.ok).toBeTrue();
    expect(typeof parsed.result.stagnant).toBe("boolean");
  });

  test("skill:audit:live --format json emits exactly one JSON value on stdout", async () => {
    const repo = scratchRoot(import.meta.path, "skill-audit-live-format-json");
    mkdirSync(join(repo, ".olt"), { recursive: true });

    const res = await runHarnessInProcess(["skill:audit:live", "--repo", repo, "--format", "json"]);
    const stdout = res.stdout;
    const nonEmptyLines = stdout.split("\n").filter((line) => line.trim() !== "");
    expect(nonEmptyLines).toHaveLength(1);
    expect(() => JSON.parse(stdout)).not.toThrow();
    const parsed = JSON.parse(stdout) as { ok: boolean; result: { compliant: boolean } };
    expect(parsed.ok).toBeTrue();
    expect(typeof parsed.result.compliant).toBe("boolean");
  });
});

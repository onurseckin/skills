import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripOutputFormat } from "../../../olt/scripts/src/cli/output-format.ts";

const roots: string[] = [];
const entrypoint = join(import.meta.dir, "..", "..", "..", "olt", "scripts", "harness.ts");
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

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
    const repo = await mkdtemp(join(tmpdir(), "harness-format-"));
    roots.push(repo);
    await mkdir(join(repo, "src"), { recursive: true });
    await writeFile(join(repo, "src", "file.ts"), "export const x = 1;\n");
    const prompt = join(repo, "prompt.txt");
    await writeFile(prompt, "verbatim prompt");
    const init = Bun.spawn(
      [
        "bun",
        entrypoint,
        "plan:init",
        "--repo",
        repo,
        "--run-id",
        "format-run",
        "--prompt-file",
        prompt,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    expect(await init.exited).toBe(0);

    const runRoot = join(repo, ".olt", "capsules", "format-run");
    const add = Bun.spawn(
      [
        "bun",
        entrypoint,
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
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    expect(await add.exited).toBe(0);

    const brainstorm = Bun.spawn(
      ["bun", entrypoint, "plan:brainstorm", "--run", runRoot, "--actor", "planner"],
      { stdout: "pipe", stderr: "pipe" },
    );
    expect(await brainstorm.exited).toBe(0);

    const compile = Bun.spawn(
      [
        "bun",
        entrypoint,
        "plan:compile",
        "--run",
        runRoot,
        "--actor",
        "planner",
        "--completion-gate",
        "bun test src/file.ts",
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    expect(await compile.exited).toBe(0);

    const exec = Bun.spawn(
      [
        "bun",
        entrypoint,
        "run:exec",
        "--run",
        join(repo, ".olt", "capsules", "format-run"),
        "--actor",
        "coordinator",
        "--format",
        "json",
        "--",
        "echo",
        "--format=json",
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    expect(await exec.exited).toBe(0);
    const parsed = JSON.parse(await new Response(exec.stdout).text()) as {
      ok: boolean;
      result: { command: { argv: string[] }; exit_code: number };
    };
    expect(parsed.ok).toBeTrue();
    expect(parsed.result.command.argv).toEqual(["echo", "--format=json"]);
    expect(parsed.result.exit_code).toBe(0);
  });
});

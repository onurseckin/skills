import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const roots: string[] = [];
const entrypoint = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "orchestrating-long-tasks",
  "scripts",
  "harness.ts",
);
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

async function output(process: ReturnType<typeof Bun.spawn>) {
  return {
    exit: await process.exited,
    stdout: await new Response(process.stdout).text(),
    stderr: await new Response(process.stderr).text(),
  };
}

describe("CLI process contract", () => {
  test("emits one success JSON object to stdout", async () => {
    const repo = await mkdtemp(join(tmpdir(), "harness-process-"));
    roots.push(repo);
    const prompt = join(repo, "prompt.txt");
    await writeFile(prompt, "verbatim prompt");
    const result = await output(
      Bun.spawn(
        [
          "bun",
          entrypoint,
          "plan:init",
          "--repo",
          repo,
          "--run-id",
          "process-run",
          "--prompt-file",
          prompt,
          "--capture-mode",
          "file",
          "--source-verified",
          "--format",
          "json",
        ],
        { stdout: "pipe", stderr: "pipe" },
      ),
    );
    expect(result.exit).toBe(0);
    expect(result.stderr).toBe("");
    const lines = result.stdout.trimEnd().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      ok: true,
      result: { manifest: { run_id: "process-run" } },
    });

    const status = await output(
      Bun.spawn(
        [
          "bun",
          entrypoint,
          "run:status",
          "--run",
          join(repo, ".capsules", "process-run"),
          "--format",
          "json",
        ],
        {
          stdout: "pipe",
          stderr: "pipe",
        },
      ),
    );
    expect(status.exit).toBe(0);
    expect(JSON.parse(status.stdout)).toMatchObject({
      ok: true,
      result: { run_root: join(repo, ".capsules", "process-run") },
    });
  });

  test("emits one structured error to stderr with a stable exit", async () => {
    const result = await output(
      Bun.spawn(["bun", entrypoint, "unknown"], { stdout: "pipe", stderr: "pipe" }),
    );
    expect(result.exit).toBe(3);
    expect(result.stdout).toBe("");
    const lines = result.stderr.trimEnd().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
  });
});

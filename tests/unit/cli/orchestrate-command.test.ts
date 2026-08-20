import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import {
  deriveRunId,
  firstAvailableRunId,
} from "../../../orchestrating-long-tasks/scripts/src/cli/commands/orchestrate-slug.ts";
import { cleanupRoots } from "./full-lifecycle-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

function stdinFor(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

// Every other test in this file calls `execute()` directly with `context.stdin` already
// populated, which never exercises `harness.ts`'s own stdin gate (`shouldReadPromptStdin`) —
// the exact seam that let a bare `printf ... | bun harness.ts orchestrate --repo .` (no
// `--prompt-stdin`) ship as a documented example while actually failing with INVALID_ARGUMENT.
// These two spawn the real entrypoint so a regression here fails a test again.
const entrypoint = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "orchestrating-long-tasks",
  "scripts",
  "harness.ts",
);

async function spawnOrchestrate(args: readonly string[], stdin: Uint8Array) {
  const proc = Bun.spawn(["bun", entrypoint, "orchestrate", ...args], {
    stdin,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exit: await proc.exited,
    stdout: await new Response(proc.stdout).text(),
    stderr: await new Response(proc.stderr).text(),
  };
}

describe("deriveRunId", () => {
  const fixedDate = new Date("2026-08-20T12:00:00Z");

  test("prefixes today's date and the first few words, hyphenated", () => {
    expect(deriveRunId("Add a slugify helper to the CLI", fixedDate)).toBe(
      "2026-08-20-add-a-slugify-helper-to-the",
    );
  });

  test("collapses punctuation instead of leaving empty segments", () => {
    expect(deriveRunId("Fix the parser: reject empty payloads!", fixedDate)).toBe(
      "2026-08-20-fix-the-parser-reject-empty-payloads",
    );
  });

  test("falls back to the bare date when the prompt has no word characters", () => {
    expect(deriveRunId("!!! ??? ---", fixedDate)).toBe("2026-08-20");
    expect(deriveRunId("", fixedDate)).toBe("2026-08-20");
  });

  test("never ends on a hyphen, so RUN_ID_PATTERN still accepts it", () => {
    const id = deriveRunId("x".repeat(200), fixedDate);
    expect(id.endsWith("-")).toBe(false);
    expect(id).toMatch(/^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9])?$/);
  });

  test("is a pure function of its inputs: same prompt and date, same id", () => {
    expect(deriveRunId("Ship the feature", fixedDate)).toBe(
      deriveRunId("Ship the feature", fixedDate),
    );
  });
});

describe("firstAvailableRunId", () => {
  test("returns the base id untouched when nothing is taken", () => {
    expect(firstAvailableRunId("my-run", () => false)).toBe("my-run");
  });

  test("appends the smallest free numeric suffix on collision", () => {
    const taken = new Set(["my-run", "my-run-2", "my-run-3"]);
    expect(firstAvailableRunId("my-run", (candidate) => taken.has(candidate))).toBe("my-run-4");
  });
});

describe("orchestrate", () => {
  test("captures the prompt from stdin and opens the capsule with a derived run id", async () => {
    const repo = await mkdtemp(join(tmpdir(), "harness-orchestrate-"));
    roots.push(repo);
    const prompt = "Add a slugify helper that lowercases text and collapses punctuation.";

    const result = await execute(["orchestrate", "--repo", repo], { stdin: stdinFor(prompt) });

    expect(result.run_id_derived).toBe(true);
    expect(String(result.run_id)).toMatch(
      /^\d{4}-\d{2}-\d{2}-add-a-slugify-helper-that-lowercases$/,
    );
    const manifest = result.manifest as { prompt_sha256: string; prompt_bytes: number };
    expect(manifest.prompt_sha256).toBe(createHash("sha256").update(prompt).digest("hex"));
    expect(manifest.prompt_bytes).toBe(Buffer.byteLength(prompt));

    const markdown = String(result.markdown);
    expect(markdown).toContain("### Orchestration Opened:");
    expect(markdown).toContain("plan:enhance");
    expect(markdown).toContain("plan:add");
    expect(markdown).toContain("plan:compile");
    expect(markdown).toContain("queue:wave");
  });

  test("honours an explicit --run instead of deriving one", async () => {
    const repo = await mkdtemp(join(tmpdir(), "harness-orchestrate-explicit-"));
    roots.push(repo);

    const result = await execute(["orchestrate", "--repo", repo, "--run", "my-chosen-id"], {
      stdin: stdinFor("Whatever the user wrote"),
    });

    expect(result.run_id).toBe("my-chosen-id");
    expect(result.run_id_derived).toBe(false);
    expect(String(result.run_root)).toContain("my-chosen-id");
  });

  test("a second orchestrate on the same day and prompt gets a distinct derived run id", async () => {
    const repo = await mkdtemp(join(tmpdir(), "harness-orchestrate-collide-"));
    roots.push(repo);
    const prompt = "Refactor the widget layer";

    const first = await execute(["orchestrate", "--repo", repo], { stdin: stdinFor(prompt) });
    const second = await execute(["orchestrate", "--repo", repo], { stdin: stdinFor(prompt) });

    expect(second.run_id).not.toBe(first.run_id);
    expect(String(second.run_id)).toBe(`${String(first.run_id)}-2`);
  });

  test("refuses to run with no prompt source at all", async () => {
    const repo = await mkdtemp(join(tmpdir(), "harness-orchestrate-noprompt-"));
    roots.push(repo);

    await expect(execute(["orchestrate", "--repo", repo], {})).rejects.toThrow(
      "the prompt is unavailable",
    );
  });

  test("accepts --prompt-file exactly like plan:init", async () => {
    const repo = await mkdtemp(join(tmpdir(), "harness-orchestrate-file-"));
    roots.push(repo);
    const promptPath = join(repo, "prompt.txt");
    await Bun.write(promptPath, "Build the reporting dashboard");

    const result = await execute([
      "orchestrate",
      "--repo",
      repo,
      "--run",
      "from-file",
      "--prompt-file",
      promptPath,
    ]);

    const manifest = result.manifest as { prompt_sha256: string };
    expect(manifest.prompt_sha256).toBe(
      createHash("sha256").update("Build the reporting dashboard").digest("hex"),
    );
  });

  test("spawned as a real process, the documented --prompt-stdin example succeeds", async () => {
    const repo = await mkdtemp(join(tmpdir(), "harness-orchestrate-spawn-ok-"));
    roots.push(repo);

    const result = await spawnOrchestrate(
      ["--repo", repo, "--prompt-stdin", "--format", "json"],
      stdinFor("Ship the reporting dashboard"),
    );

    expect(result.exit).toBe(0);
    expect(JSON.parse(result.stdout.trimEnd())).toMatchObject({ ok: true });
  });

  test("spawned as a real process, a bare pipe with no --prompt-stdin refuses (the CLI's stdin gate " +
    "is opt-in; orchestrate does not bypass it)", async () => {
    const repo = await mkdtemp(join(tmpdir(), "harness-orchestrate-spawn-noflag-"));
    roots.push(repo);

    const result = await spawnOrchestrate(
      ["--repo", repo, "--format", "json"],
      stdinFor("Ship the reporting dashboard"),
    );

    expect(result.exit).not.toBe(0);
    expect(JSON.parse(result.stderr.trimEnd())).toMatchObject({
      ok: false,
      error: { code: "INVALID_ARGUMENT" },
    });
  });
});

import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import {
  deriveRunId,
  firstAvailableRunId,
} from "../../../orchestrating-long-tasks/scripts/src/cli/commands/orchestrate-slug.ts";
import {
  extractOrchestrateInlinePrompt,
  shouldAutoReadOrchestrateStdin,
} from "../../../orchestrating-long-tasks/scripts/src/cli/prompt-input.ts";
import { cleanupRoots } from "./full-lifecycle-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

function stdinFor(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

// Every other test in this file calls `execute()` directly with `context.stdin`/`context.inlinePrompt`
// already populated, which never exercises `harness.ts`'s own entrypoint (argv extraction, the
// stdin gate). These spawn the real entrypoint so a regression in that wiring fails a test here.
const entrypoint = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "orchestrating-long-tasks",
  "scripts",
  "harness.ts",
);

async function spawnOrchestrate(
  args: readonly string[],
  stdin: Uint8Array | "ignore",
  cwd?: string,
) {
  const proc = Bun.spawn(["bun", entrypoint, "orchestrate", ...args], {
    stdin,
    stdout: "pipe",
    stderr: "pipe",
    ...(cwd === undefined ? {} : { cwd }),
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

    const manifest = result.manifest as { prompt_sha256: string; capture_mode: string };
    expect(manifest.prompt_sha256).toBe(
      createHash("sha256").update("Build the reporting dashboard").digest("hex"),
    );
    expect(manifest.capture_mode).toBe("file");
  });

  test("captures an inline free-text prompt passed through context, with its own capture mode", async () => {
    const repo = await mkdtemp(join(tmpdir(), "harness-orchestrate-inline-"));
    roots.push(repo);
    const prompt = "Add a greeting banner to the dashboard";

    const result = await execute(["orchestrate", "--repo", repo], { inlinePrompt: prompt });

    const manifest = result.manifest as {
      prompt_sha256: string;
      prompt_bytes: number;
      capture_mode: string;
      source_verified: boolean;
    };
    expect(manifest.prompt_sha256).toBe(createHash("sha256").update(prompt).digest("hex"));
    expect(manifest.prompt_bytes).toBe(Buffer.byteLength(prompt));
    expect(manifest.capture_mode).toBe("argv");
    expect(manifest.source_verified).toBe(true);
    expect(String(result.run_id)).toMatch(/^\d{4}-\d{2}-\d{2}-add-a-greeting-banner-to-the$/);
  });

  test("an inline prompt wins over stdin when both are present", async () => {
    const repo = await mkdtemp(join(tmpdir(), "harness-orchestrate-inline-wins-"));
    roots.push(repo);

    const result = await execute(["orchestrate", "--repo", repo], {
      inlinePrompt: "Use the inline text",
      stdin: stdinFor("Ignore the piped text"),
    });

    const manifest = result.manifest as { prompt_sha256: string };
    expect(manifest.prompt_sha256).toBe(
      createHash("sha256").update("Use the inline text").digest("hex"),
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

  test("spawned as a real process, a bare pipe with no flags at all is read automatically", async () => {
    const repo = await mkdtemp(join(tmpdir(), "harness-orchestrate-spawn-bare-pipe-"));
    roots.push(repo);

    const result = await spawnOrchestrate(
      ["--format", "json"],
      stdinFor("Ship the reporting dashboard"),
      repo,
    );

    expect(result.exit).toBe(0);
    const parsed = JSON.parse(result.stdout.trimEnd()) as {
      ok: true;
      result: { manifest: { prompt_sha256: string; capture_mode: string } };
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.result.manifest.prompt_sha256).toBe(
      createHash("sha256").update("Ship the reporting dashboard").digest("hex"),
    );
    expect(parsed.result.manifest.capture_mode).toBe("stdin");
  });

  test("spawned as a real process, inline free text with no flags at all becomes the prompt", async () => {
    const repo = await mkdtemp(join(tmpdir(), "harness-orchestrate-spawn-inline-"));
    roots.push(repo);

    const result = await spawnOrchestrate(
      ["Add", "a", "greeting", "banner", "component", "--format", "json"],
      "ignore",
      repo,
    );

    expect(result.exit).toBe(0);
    const parsed = JSON.parse(result.stdout.trimEnd()) as {
      ok: true;
      result: { manifest: { prompt_sha256: string; capture_mode: string } };
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.result.manifest.prompt_sha256).toBe(
      createHash("sha256").update("Add a greeting banner component").digest("hex"),
    );
    expect(parsed.result.manifest.capture_mode).toBe("argv");
  });

  test("spawned as a real process, --repo trailing inline text is refused, never silently applied", async () => {
    // End-to-end regression for the same bug the pure-function test above proves: run the real
    // entrypoint from an unrelated cwd, naming the actual target repo with a trailing --repo, and
    // assert the target repo's capsule is never created — the old behaviour opened it against cwd
    // instead, with exit 0 and no error at all.
    const targetRepo = await mkdtemp(join(tmpdir(), "harness-orchestrate-spawn-target-"));
    const cwdRepo = await mkdtemp(join(tmpdir(), "harness-orchestrate-spawn-cwd-"));
    roots.push(targetRepo, cwdRepo);

    const result = await spawnOrchestrate(
      ["Add", "input", "validation", "--repo", targetRepo, "--format", "json"],
      "ignore",
      cwdRepo,
    );

    expect(result.exit).not.toBe(0);
    expect(JSON.parse(result.stderr.trimEnd())).toMatchObject({
      ok: false,
      error: { code: "INVALID_ARGUMENT" },
    });
    expect(existsSync(join(targetRepo, ".capsules"))).toBe(false);
    expect(existsSync(join(cwdRepo, ".capsules"))).toBe(false);
  });
});

describe("extractOrchestrateInlinePrompt", () => {
  test("joins every token after the command name when the first one is not a flag", () => {
    expect(extractOrchestrateInlinePrompt(["orchestrate", "Fix", "the", "login", "bug"])).toEqual({
      argv: ["orchestrate"],
      inlinePrompt: "Fix the login bug",
    });
  });

  test("leaves argv untouched when the first token after the command is a flag", () => {
    expect(extractOrchestrateInlinePrompt(["orchestrate", "--repo", "."])).toEqual({
      argv: ["orchestrate", "--repo", "."],
    });
  });

  test("leaves argv untouched when there is nothing after the command name", () => {
    expect(extractOrchestrateInlinePrompt(["orchestrate"])).toEqual({ argv: ["orchestrate"] });
  });

  test("refuses a registered flag trailing the inline text instead of swallowing it as prompt bytes", () => {
    // Regression: `orchestrate <text> --repo /other` used to join "--repo /other" into the prompt
    // and silently drop the flag, so the run opened against cwd instead of the named repo with no
    // error at all. It must fail loudly instead of ever capturing that flag as prose.
    expect(() =>
      extractOrchestrateInlinePrompt(["orchestrate", "Fix", "the", "bug", "--repo", "/other"]),
    ).toThrow(/--repo cannot follow inline prompt text/);
    expect(() =>
      extractOrchestrateInlinePrompt(["orchestrate", "Fix", "the", "bug", "--run", "my-run"]),
    ).toThrow(/--run cannot follow inline prompt text/);
  });

  test("still treats an unrecognised --like token as ordinary prompt text", () => {
    // Only orchestrate's OWN registered flags trigger the guard; a prompt that genuinely discusses
    // CLI flags in prose (a word that merely starts with "--") is not mistaken for one.
    expect(
      extractOrchestrateInlinePrompt(["orchestrate", "Explain", "--verbose", "logging"]),
    ).toEqual({
      argv: ["orchestrate"],
      inlinePrompt: "Explain --verbose logging",
    });
  });

  test("does nothing for any command other than orchestrate", () => {
    expect(extractOrchestrateInlinePrompt(["plan:status", "extra"])).toEqual({
      argv: ["plan:status", "extra"],
    });
  });
});

describe("shouldAutoReadOrchestrateStdin", () => {
  test("reads a bare orchestrate with piped (non-TTY) stdin", () => {
    expect(shouldAutoReadOrchestrateStdin(["orchestrate"], false)).toBe(true);
  });

  test("never blocks an interactive terminal", () => {
    expect(shouldAutoReadOrchestrateStdin(["orchestrate"], true)).toBe(false);
  });

  test("stands down once an inline prompt is present", () => {
    expect(shouldAutoReadOrchestrateStdin(["orchestrate", "Fix", "the", "bug"], false)).toBe(false);
  });

  test("stands down for --prompt-file, which already names its own source", () => {
    expect(
      shouldAutoReadOrchestrateStdin(["orchestrate", "--prompt-file", "prompt.txt"], false),
    ).toBe(false);
  });

  test("still reads when other flags like --repo are present, as long as none is --prompt-file", () => {
    expect(shouldAutoReadOrchestrateStdin(["orchestrate", "--repo", "."], false)).toBe(true);
  });

  test("does nothing for any command other than orchestrate", () => {
    expect(shouldAutoReadOrchestrateStdin(["plan:init", "--prompt-stdin"], false)).toBe(false);
  });
});

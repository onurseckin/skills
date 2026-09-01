import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../../../../olt/scripts/src/cli/execute.ts";
import {
  extractOrchestrateInlinePrompt,
  shouldAutoReadOrchestrateStdin,
} from "../../../../../olt/scripts/src/cli/prompt-input.ts";
import { cleanupRoots } from "../../fixtures/full-lifecycle-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

function stdinFor(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

const entrypoint = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "..",
  "..",
  "olt",
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

describe("orchestrate - Process Spawning & Prompt Input", () => {
  test("captures an inline free-text prompt passed through context, with its own capture mode", async () => {
    const inlineResult = await execute(["orchestrate"], {
      inlinePrompt: "Deploy the billing subsystem without regressions",
    });

    expect(inlineResult.run_id_derived).toBe(true);
    expect(inlineResult.run_root).toBeDefined();
    expect(inlineResult.markdown).toContain("### Orchestration Opened:");
    roots.push(inlineResult.run_root as string);
  });

  test("an inline prompt wins over stdin when both are present", async () => {
    const mixed = await execute(["orchestrate"], {
      inlinePrompt: "Winner prompt",
      stdin: stdinFor("Loser prompt"),
    });

    expect(mixed.markdown).toContain("winner-prompt");
    roots.push(mixed.run_root as string);
  });

  test("spawned as a real process, the documented --prompt-stdin example succeeds", async () => {
    const repo = await mkdtemp(join(tmpdir(), "orchestrate-spawn-test-"));
    writeFileSync(join(repo, "package.json"), "{}");
    roots.push(repo);

    const result = await spawnOrchestrate(
      ["--repo", repo, "--prompt-stdin", "--format", "json"],
      stdinFor("Ship the reporting dashboard"),
    );

    expect(result.exit).toBe(0);
    expect(existsSync(join(repo, ".olt", "capsules"))).toBe(true);
  });

  test("spawned as a real process, a bare pipe with no flags at all is read automatically", async () => {
    const repo = await mkdtemp(join(tmpdir(), "orchestrate-pipe-test-"));
    writeFileSync(join(repo, "package.json"), "{}");
    roots.push(repo);

    const result = await spawnOrchestrate(
      ["--repo", repo, "--format", "json"],
      stdinFor("Ship the reporting dashboard"),
      repo,
    );

    expect(result.exit).toBe(0);
    expect(existsSync(join(repo, ".olt", "capsules"))).toBe(true);
  });

  test("spawned as a real process, inline free text with no flags at all becomes the prompt", async () => {
    const repo = await mkdtemp(join(tmpdir(), "orchestrate-inline-test-"));
    writeFileSync(join(repo, "package.json"), "{}");
    roots.push(repo);

    const result = await spawnOrchestrate(
      ["--repo", repo, "Add", "a", "greeting", "banner", "component", "--format", "json"],
      "ignore",
      repo,
    );

    expect(result.exit).toBe(0);
    expect(existsSync(join(repo, ".olt", "capsules"))).toBe(true);
  });

  test("spawned as a real process, --repo trailing inline text is refused, never silently applied", async () => {
    const cwdRepo = await mkdtemp(join(tmpdir(), "orchestrate-bad-trailing-cwd-"));
    const trailingRepo = await mkdtemp(join(tmpdir(), "orchestrate-bad-trailing-arg-"));
    writeFileSync(join(cwdRepo, "package.json"), "{}");
    writeFileSync(join(trailingRepo, "package.json"), "{}");
    roots.push(cwdRepo, trailingRepo);

    const result = await spawnOrchestrate(
      ["Ship", "the", "dashboard", "--repo", trailingRepo, "--format", "json"],
      "ignore",
      cwdRepo,
    );

    expect(result.exit).not.toBe(0);
  });

  test("extractOrchestrateInlinePrompt joins tokens after command name", () => {
    const { inlinePrompt, argv } = extractOrchestrateInlinePrompt([
      "orchestrate",
      "add",
      "a",
      "flag",
    ]);
    expect(inlinePrompt).toBe("add a flag");
    expect(argv).toEqual(["orchestrate"]);
  });

  test("extractOrchestrateInlinePrompt leaves argv untouched when first token is flag", () => {
    const { inlinePrompt, argv } = extractOrchestrateInlinePrompt([
      "orchestrate",
      "--repo",
      "/tmp/repo",
    ]);
    expect(inlinePrompt).toBeUndefined();
    expect(argv).toEqual(["orchestrate", "--repo", "/tmp/repo"]);
  });

  test("extractOrchestrateInlinePrompt leaves argv untouched when empty", () => {
    const { inlinePrompt, argv } = extractOrchestrateInlinePrompt(["orchestrate"]);
    expect(inlinePrompt).toBeUndefined();
    expect(argv).toEqual(["orchestrate"]);
  });

  test("extractOrchestrateInlinePrompt refuses a registered flag trailing the inline text", () => {
    expect(() =>
      extractOrchestrateInlinePrompt(["orchestrate", "some", "prompt", "--repo", "/tmp/repo"]),
    ).toThrow(/cannot follow inline prompt text/);
  });

  test("extractOrchestrateInlinePrompt still treats an unrecognised --like token as ordinary prompt text", () => {
    const { inlinePrompt } = extractOrchestrateInlinePrompt([
      "orchestrate",
      "inspect",
      "--not-a-registered-flag",
    ]);
    expect(inlinePrompt).toBe("inspect --not-a-registered-flag");
  });

  test("extractOrchestrateInlinePrompt does nothing for any command other than orchestrate", () => {
    const { inlinePrompt, argv } = extractOrchestrateInlinePrompt(["plan:init", "some", "text"]);
    expect(inlinePrompt).toBeUndefined();
    expect(argv).toEqual(["plan:init", "some", "text"]);
  });

  test("shouldAutoReadOrchestrateStdin predicates correctly", () => {
    expect(shouldAutoReadOrchestrateStdin(["orchestrate"], false)).toBe(true);
    expect(shouldAutoReadOrchestrateStdin(["orchestrate"], true)).toBe(false);
    expect(shouldAutoReadOrchestrateStdin(["orchestrate", "--prompt-file", "p.txt"], false)).toBe(
      false,
    );
    expect(shouldAutoReadOrchestrateStdin(["orchestrate", "--repo", "/tmp/r"], false)).toBe(true);
    expect(shouldAutoReadOrchestrateStdin(["plan:init"], false)).toBe(false);
  });
});

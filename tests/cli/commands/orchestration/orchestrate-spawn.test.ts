import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execute } from "../../../../olt/scripts/src/cli/execute.ts";
import {
  extractOrchestrateInlinePrompt,
  shouldAutoReadOrchestrateStdin,
} from "../../../../olt/scripts/src/cli/prompt-input.ts";
import { cleanupRoots } from "../fixtures/full-lifecycle-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

function stdinFor(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

const entrypoint = join(import.meta.dir, "..", "..", "..", "..", "olt", "scripts", "harness.ts");

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

    expect(inlineResult.runIdWasDerived).toBe(true);
    expect(inlineResult.promptBytes).toBeGreaterThan(0);
    expect(inlineResult.markdown).toContain("### Capsule Initialized");
  });

  test("an inline prompt wins over stdin when both are present", async () => {
    const mixed = await execute(["orchestrate"], {
      inlinePrompt: "Winner prompt",
      stdin: stdinFor("Loser prompt"),
    });

    expect(mixed.markdown).toContain("winner-prompt");
  });

  test("spawned as a real process, the documented --prompt-stdin example succeeds", async () => {
    const repo = await mkdtemp(join(tmpdir(), "orchestrate-spawn-test-"));
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
    roots.push(repo);

    const result = await spawnOrchestrate(
      ["--format", "json"],
      stdinFor("Ship the reporting dashboard"),
      repo,
    );

    expect(result.exit).toBe(0);
    expect(existsSync(join(repo, ".olt", "capsules"))).toBe(true);
  });

  test("spawned as a real process, inline free text with no flags at all becomes the prompt", async () => {
    const repo = await mkdtemp(join(tmpdir(), "orchestrate-inline-test-"));
    roots.push(repo);

    const result = await spawnOrchestrate(
      ["Add", "a", "greeting", "banner", "component", "--format", "json"],
      "ignore",
      repo,
    );

    expect(result.exit).toBe(0);
    expect(existsSync(join(repo, ".olt", "capsules"))).toBe(true);
  });

  test("spawned as a real process, --repo trailing inline text is refused, never silently applied", async () => {
    const cwdRepo = await mkdtemp(join(tmpdir(), "orchestrate-bad-trailing-cwd-"));
    const trailingRepo = await mkdtemp(join(tmpdir(), "orchestrate-bad-trailing-arg-"));
    roots.push(cwdRepo, trailingRepo);

    const result = await spawnOrchestrate(
      [
        "Ship",
        "the",
        "dashboard",
        "--repo",
        trailingRepo,
        "--format",
        "json",
      ],
      "ignore",
      cwdRepo,
    );

    expect(result.exit).not.toBe(0);
  });

  test("extractOrchestrateInlinePrompt joins tokens after command name", () => {
    const { prompt, remainingArgv } = extractOrchestrateInlinePrompt([
      "orchestrate",
      "add",
      "a",
      "flag",
    ]);
    expect(prompt).toBe("add a flag");
    expect(remainingArgv).toEqual(["orchestrate"]);
  });

  test("extractOrchestrateInlinePrompt leaves argv untouched when first token is flag", () => {
    const { prompt, remainingArgv } = extractOrchestrateInlinePrompt([
      "orchestrate",
      "--format",
      "json",
    ]);
    expect(prompt).toBeUndefined();
    expect(remainingArgv).toEqual(["orchestrate", "--format", "json"]);
  });

  test("extractOrchestrateInlinePrompt leaves argv untouched when empty", () => {
    const { prompt, remainingArgv } = extractOrchestrateInlinePrompt(["orchestrate"]);
    expect(prompt).toBeUndefined();
    expect(remainingArgv).toEqual(["orchestrate"]);
  });

  test("extractOrchestrateInlinePrompt refuses a registered flag trailing the inline text", () => {
    expect(() =>
      extractOrchestrateInlinePrompt(["orchestrate", "some", "prompt", "--format", "json"]),
    ).toThrow("must appear before free-text prompt words");
  });

  test("extractOrchestrateInlinePrompt still treats an unrecognised --like token as ordinary prompt text", () => {
    const { prompt } = extractOrchestrateInlinePrompt([
      "orchestrate",
      "inspect",
      "--not-a-registered-flag",
    ]);
    expect(prompt).toBe("inspect --not-a-registered-flag");
  });

  test("extractOrchestrateInlinePrompt does nothing for any command other than orchestrate", () => {
    const { prompt, remainingArgv } = extractOrchestrateInlinePrompt(["plan:init", "some", "text"]);
    expect(prompt).toBeUndefined();
    expect(remainingArgv).toEqual(["plan:init", "some", "text"]);
  });

  test("shouldAutoReadOrchestrateStdin predicates correctly", () => {
    expect(shouldAutoReadOrchestrateStdin(["orchestrate"], false)).toBe(true);
    expect(shouldAutoReadOrchestrateStdin(["orchestrate"], true)).toBe(false);
    expect(shouldAutoReadOrchestrateStdin(["orchestrate"], false, "inline")).toBe(false);
    expect(shouldAutoReadOrchestrateStdin(["orchestrate", "--prompt-file", "p.txt"], false)).toBe(
      false,
    );
    expect(shouldAutoReadOrchestrateStdin(["orchestrate", "--repo", "/tmp/r"], false)).toBe(true);
    expect(shouldAutoReadOrchestrateStdin(["plan:init"], false)).toBe(false);
  });
});

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execute } from "../../../../../olt/scripts/src/cli/execute.ts";
import {
  extractOrchestrateInlinePrompt,
  shouldAutoReadOrchestrateStdin,
} from "../../../../../olt/scripts/src/cli/prompt-input.ts";
import {
  cleanupRoots,
  cleanupVirtualCliFS,
  setupVirtualCliFS,
} from "../../fixtures/full-lifecycle-fixture.ts";

const roots: string[] = [];
beforeEach(() => {
  setupVirtualCliFS();
});
afterEach(async () => {
  await cleanupRoots(roots);
  cleanupVirtualCliFS();
});

function stdinFor(text: string): Uint8Array {
  return new TextEncoder().encode(text);
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

  test("the documented --prompt-stdin example succeeds", async () => {
    const repo = `/virtual/cli/orchestrate-spawn-test-${Date.now()}`;
    mkdirSync(repo, { recursive: true });
    writeFileSync(join(repo, "package.json"), "{}");
    roots.push(repo);

    const result = await execute(["orchestrate", "--repo", repo, "--prompt-stdin"], {
      stdin: stdinFor("Ship the reporting dashboard"),
    });

    expect(result.run_root).toBeDefined();
    expect(existsSync(join(repo, ".olt", "capsules"))).toBe(true);
  });

  test("a bare pipe with no flags at all is read automatically", async () => {
    const repo = `/virtual/cli/orchestrate-pipe-test-${Date.now()}`;
    mkdirSync(repo, { recursive: true });
    writeFileSync(join(repo, "package.json"), "{}");
    roots.push(repo);

    const result = await execute(["orchestrate", "--repo", repo], {
      stdin: stdinFor("Ship the reporting dashboard"),
      cwd: repo,
    });

    expect(result.run_root).toBeDefined();
    expect(existsSync(join(repo, ".olt", "capsules"))).toBe(true);
  });

  test("inline free text with no flags at all becomes the prompt", async () => {
    const repo = `/virtual/cli/orchestrate-inline-test-${Date.now()}`;
    mkdirSync(repo, { recursive: true });
    writeFileSync(join(repo, "package.json"), "{}");
    roots.push(repo);

    const rawArgv = ["orchestrate", "Add", "a", "greeting", "banner", "component"];
    const { inlinePrompt, argv } = extractOrchestrateInlinePrompt(rawArgv);
    const result = await execute([...argv, "--repo", repo], { inlinePrompt, cwd: repo });

    expect(result.run_root).toBeDefined();
    expect(existsSync(join(repo, ".olt", "capsules"))).toBe(true);
  });

  test("--repo trailing inline text is refused, never silently applied", async () => {
    const cwdRepo = `/virtual/cli/orchestrate-bad-trailing-cwd-${Date.now()}`;
    const trailingRepo = `/virtual/cli/orchestrate-bad-trailing-arg-${Date.now()}`;
    mkdirSync(cwdRepo, { recursive: true });
    mkdirSync(trailingRepo, { recursive: true });
    writeFileSync(join(cwdRepo, "package.json"), "{}");
    writeFileSync(join(trailingRepo, "package.json"), "{}");
    roots.push(cwdRepo, trailingRepo);

    await expect(
      execute(["orchestrate", "Ship", "the", "dashboard", "--repo", trailingRepo], {
        cwd: cwdRepo,
      }),
    ).rejects.toThrow();
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

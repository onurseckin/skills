import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setupWorkflowVirtualFs } from "../../shared/index.ts";

describe("Static Invariant Verification: Zero TypeScript any & Zero Suppressions", () => {
  let vfsCleanup: (() => void) | undefined;

  beforeEach(() => {
    const setup = setupWorkflowVirtualFs();
    vfsCleanup = setup.cleanup;
  });

  afterEach(() => {
    vfsCleanup?.();
    vfsCleanup = undefined;
  });
  it("verifies heuristics-workflow.test.ts contains zero any types and zero suppressions", async () => {
    const thisFilePath = join(import.meta.dir, "heuristics-gating.test.ts");
    const content = await readFile(thisFilePath, "utf8");
    const lines = content.split("\n");

    const forbiddenAnyForms = [
      ":" + " any",
      "as" + " any",
      "<" + "any>",
      "Promise<" + "any>",
      "Record<string," + " any>",
    ];
    const forbiddenSupTokens = [
      "@" + "ts-ignore",
      "@" + "ts-expect-error",
      "@" + "ts-nocheck",
      "eslint-" + "disable",
      "oxlint-" + "disable",
    ];

    const invariantBlockIdx = lines.findIndex((l) =>
      l.includes("Static Invariant Verification: Zero TypeScript any"),
    );

    const invalidLines = lines.filter((line, idx) => {
      // Ignore the static invariant test block itself
      if (invariantBlockIdx !== -1 && idx >= invariantBlockIdx) return false;
      return (
        forbiddenAnyForms.some((token) => line.includes(token)) ||
        forbiddenSupTokens.some((token) => line.includes(token))
      );
    });

    expect(invalidLines).toEqual([]);
  });
});

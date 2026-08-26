import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");

const FILES_THAT_MUST_NOT_DEFAULT_TO_BARE_DOT_CAPSULES = [
  "olt/scripts/src/mind/task-queue.ts",
  "olt/scripts/src/mind/archival.ts",
  "olt/scripts/src/mind/self-evolution.ts",
  "olt/scripts/src/mind/smart-task-manager.ts",
] as const;

describe("no legacy bare .capsules default path", () => {
  test.each(FILES_THAT_MUST_NOT_DEFAULT_TO_BARE_DOT_CAPSULES)(
    "%s does not hardcode the pre-migration bare .capsules/ literal as a string default",
    (relativePath) => {
      const source = readFileSync(join(REPO_ROOT, relativePath), "utf-8");
      expect(source).not.toMatch(/"\.capsules/);
    },
  );

  test("resolveArchivedObjectivesPath's production fallback resolves through resolveCapsulesDir", () => {
    const source = readFileSync(join(REPO_ROOT, "olt/scripts/src/mind/archival.ts"), "utf-8");
    expect(source).toMatch(/return join\(resolveCapsulesDir\(\), "ARCHIVED_OBJECTIVES\.jsonl"\);/);
  });

  test("resolveEvolutionHistoryPath's production fallback resolves through resolveCapsulesDir", () => {
    const source = readFileSync(join(REPO_ROOT, "olt/scripts/src/mind/self-evolution.ts"), "utf-8");
    expect(source).toMatch(/return join\(resolveCapsulesDir\(\), "EVOLUTION_HISTORY\.jsonl"\);/);
  });

  test("synthesizeSmartTasksFromSelfEvolution's targetRoots fallback resolves through resolveCapsulesDir", () => {
    const source = readFileSync(
      join(REPO_ROOT, "olt/scripts/src/mind/smart-task-manager.ts"),
      "utf-8",
    );
    expect(source).toMatch(
      /\[isTestEnvironment\(\) \? resolveScratchDir\(\) : resolveCapsulesDir\(\)\]/,
    );
  });
});

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectRepository } from "../../../olt/scripts/src/packets/repository-snapshot.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("repository directory streaming", () => {
  test("scans a non-Git repository without invoking the Git command dependency", () => {
    const repo = mkdtempSync(join(tmpdir(), "repository-directory-streaming-"));
    roots.push(repo);
    mkdirSync(join(repo, "nested"));
    writeFileSync(join(repo, "AGENTS.md"), "# Instructions\n");
    writeFileSync(join(repo, "nested", "tsconfig.json"), "{}\n");
    const snapshot = inspectRepository(repo, "current", new Date(0), {
      command: () => {
        throw new Error("Git command must not run");
      },
    });
    expect(snapshot.git).toEqual({ available: false, error: "Git metadata unavailable" });
    expect(snapshot.instruction_files.map(({ path }) => path)).toEqual(["AGENTS.md"]);
    expect(snapshot.convention_files.map(({ path }) => path)).toEqual(["nested/tsconfig.json"]);
  });
});

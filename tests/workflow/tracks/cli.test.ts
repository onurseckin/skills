import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import {
  worktreeCleanCommand,
  worktreeCreateCommand,
  worktreeLandCommand,
  worktreeListCommand,
  worktreeStatusCommand,
} from "../../../olt/scripts/src/cli/commands/worktree-ops.ts";
import { findCommand } from "../../../olt/scripts/src/cli/registry/index.ts";

const TEST_DIR = "/virtual/worktree-cli-repo";

describe("worktree CLI commands & registry (in-memory virtualization)", () => {
  let existsSpy: ReturnType<typeof spyOn>;
  let readdirSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    existsSpy = spyOn(fs, "existsSync").mockReturnValue(false);
    readdirSpy = spyOn(fs, "readdirSync").mockReturnValue([]);
  });

  afterEach(() => {
    existsSpy.mockRestore();
    readdirSpy.mockRestore();
  });

  test("CLI registry includes all worktree commands", () => {
    expect(findCommand("worktree:create")).toBeDefined();
    expect(findCommand("worktree:land")).toBeDefined();
    expect(findCommand("worktree:list")).toBeDefined();
    expect(findCommand("worktree:clean")).toBeDefined();
    expect(findCommand("worktree:status")).toBeDefined();
    expect(findCommand("worktree:reclaim")).toBeDefined();

    const createSpec = findCommand("worktree:create")!;
    expect(createSpec.domain).toBe("worktree");
    expect(createSpec.tier).toBe("primary");
    expect(createSpec.flags.some((f) => f.name === "track")).toBe(true);
  });

  test("worktreeListCommand returns structured list", () => {
    const res = worktreeListCommand({ "repo-root": TEST_DIR });
    expect(res.count).toBe(0);
    expect(Array.isArray(res.worktrees)).toBe(true);
    expect(typeof res.markdown).toBe("string");
  });

  test("worktreeStatusCommand returns status for track", () => {
    const res = worktreeStatusCommand({ "repo-root": TEST_DIR, track: "non-existent" });
    expect(res.active).toBe(false);
    expect(res.track_id).toBe("non-existent");
  });
});

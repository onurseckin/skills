import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("agent manifests worktree permissions", () => {
  const root = process.cwd();

  test("orchestrator.yaml declares all worktree commands", () => {
    const filePath = join(root, "olt", "agents", "orchestrator.yaml");
    const content = readFileSync(filePath, "utf8");

    expect(content).toContain('"worktree:create"');
    expect(content).toContain('"worktree:land"');
    expect(content).toContain('"worktree:list"');
    expect(content).toContain('"worktree:clean"');
    expect(content).toContain('"worktree:status"');
    expect(content).toContain('"worktree:reclaim"');
    expect(content.toLowerCase()).toContain("worktree");
  });

  test("coordinator.yaml declares all worktree commands", () => {
    const filePath = join(root, "olt", "agents", "coordinator.yaml");
    const content = readFileSync(filePath, "utf8");

    expect(content).toContain('"worktree:create"');
    expect(content).toContain('"worktree:land"');
    expect(content).toContain('"worktree:list"');
    expect(content).toContain('"worktree:clean"');
    expect(content).toContain('"worktree:status"');
    expect(content).toContain('"worktree:reclaim"');
    expect(content.toLowerCase()).toContain("worktree");
  });
});

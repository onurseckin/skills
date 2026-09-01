import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  cleanupVirtualTracksFS,
  getVirtualTracksFS,
  setupVirtualTracksFS,
} from "./tracks-fixture.ts";

describe("agent manifests worktree permissions (in-memory virtualization)", () => {
  beforeEach(() => {
    setupVirtualTracksFS();
  });

  afterEach(() => {
    cleanupVirtualTracksFS();
  });

  test("orchestrator.yaml declares all worktree commands", () => {
    const vfs = getVirtualTracksFS();
    const filePath = join(process.cwd(), "olt", "agents", "orchestrator.yaml");
    const content = vfs.readFileSync(filePath, "utf8");

    expect(content).toContain('"worktree:create"');
    expect(content).toContain('"worktree:land"');
    expect(content).toContain('"worktree:list"');
    expect(content).toContain('"worktree:clean"');
    expect(content).toContain('"worktree:status"');
    expect(content).toContain('"worktree:reclaim"');
    expect(content.toLowerCase()).toContain("worktree");
  });

  test("coordinator.yaml declares all worktree commands", () => {
    const vfs = getVirtualTracksFS();
    const filePath = join(process.cwd(), "olt", "agents", "coordinator.yaml");
    const content = vfs.readFileSync(filePath, "utf8");

    expect(content).toContain('"worktree:create"');
    expect(content).toContain('"worktree:land"');
    expect(content).toContain('"worktree:list"');
    expect(content).toContain('"worktree:clean"');
    expect(content).toContain('"worktree:status"');
    expect(content).toContain('"worktree:reclaim"');
    expect(content.toLowerCase()).toContain("worktree");
  });
});

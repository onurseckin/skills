import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as WorktreeIndex from "../../../../olt/scripts/src/workflow/worktree/index.ts";
import { setupWorkflowVirtualFs } from "../../shared/index.ts";

describe("workflow/worktree index exports", () => {
  let vfsCleanup: (() => void) | undefined;

  beforeEach(() => {
    const setup = setupWorkflowVirtualFs();
    vfsCleanup = setup.cleanup;
  });

  afterEach(() => {
    vfsCleanup?.();
    vfsCleanup = undefined;
  });

  test("re-exports all worktree functions and utilities", () => {
    expect(WorktreeIndex.assignWorktrees).toBeFunction();
    expect(WorktreeIndex.commitSubphase).toBeFunction();
    expect(WorktreeIndex.recordWorktreeCommit).toBeFunction();
    expect(WorktreeIndex.consolidateWorktrees).toBeFunction();
    expect(WorktreeIndex.recordConsolidation).toBeFunction();
    expect(WorktreeIndex.addWorktree).toBeFunction();
    expect(WorktreeIndex.createGitRunner).toBeFunction();
    expect(WorktreeIndex.readWorktreeLedger).toBeFunction();
    expect(WorktreeIndex.writeWorktreeLedger).toBeFunction();
    expect(WorktreeIndex.provisionWorktrees).toBeFunction();
    expect(WorktreeIndex.reclaimOrphanedWorktrees).toBeFunction();
    expect(WorktreeIndex.recordReclaim).toBeFunction();
    expect(WorktreeIndex.createTrackWorktree).toBeFunction();
    expect(WorktreeIndex.destroyTrackWorktree).toBeFunction();
    expect(WorktreeIndex.cleanupTrackWorktree).toBeFunction();
    expect(WorktreeIndex.listTrackWorktrees).toBeFunction();
    expect(WorktreeIndex.landTrackToMain).toBeFunction();
  });
});

import { describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  formatConventionalCommit,
  validatePhaseCommitMessage,
} from "../../../olt/scripts/src/engine/worktree/conventional-commit.ts";
import { isDestructiveGitCommand } from "../../../olt/scripts/src/engine/worktree/zero-destructive-policy.ts";
import { PolicyEngine } from "../../../olt/scripts/src/engine/policy-engine.ts";
import {
  generateDefaultRepoPolicy,
  saveRepoPolicy,
} from "../../../olt/scripts/src/policy/index.ts";

function makeScratchDir(prefix: string): string {
  const dir = join(process.cwd(), "coverage", "scratch", `${prefix}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("engine/worktree/conventional-commit.ts", () => {
  it("formats conventional commit messages correctly", () => {
    const formatted = formatConventionalCommit({
      type: "feat",
      scope: "engine",
      description: "add multi-domain dispatch",
      body: "Implements wave-based scheduling.",
      isBreaking: true,
      breakingChangeDescription: "Alters scheduler interface",
      issuesClosed: ["#101", "#102"],
    });

    expect(formatted).toContain("feat(engine)!: add multi-domain dispatch");
    expect(formatted).toContain("Implements wave-based scheduling.");
    expect(formatted).toContain("BREAKING CHANGE: Alters scheduler interface");
    expect(formatted).toContain("Closes: #101, #102");

    expect(() => formatConventionalCommit({ type: "invalid_type", description: "desc" })).toThrow(
      HarnessError,
    );
    expect(() => formatConventionalCommit({ type: "feat", description: "  " })).toThrow(
      HarnessError,
    );
  });

  it("validates phase commit messages", () => {
    const valid = validatePhaseCommitMessage("fix(core): resolve null pointer");
    expect(valid.valid).toBe(true);

    const empty = validatePhaseCommitMessage("");
    expect(empty.valid).toBe(false);

    const badType = validatePhaseCommitMessage("badtype: something");
    expect(badType.valid).toBe(false);
  });
});

describe("engine/worktree/zero-destructive-policy.ts", () => {
  it("identifies destructive git operations", () => {
    expect(isDestructiveGitCommand(["clean", "-fd"]).destructive).toBe(true);
    expect(isDestructiveGitCommand(["reset", "--hard", "HEAD~1"]).destructive).toBe(true);
    expect(isDestructiveGitCommand(["checkout", "--", "."]).destructive).toBe(true);
    expect(isDestructiveGitCommand(["checkout", "-f", "main"]).destructive).toBe(true);
    expect(isDestructiveGitCommand(["checkout", "."]).destructive).toBe(true);
    expect(isDestructiveGitCommand(["restore", "."]).destructive).toBe(true);

    expect(isDestructiveGitCommand(["status"]).destructive).toBe(false);
    expect(isDestructiveGitCommand(["diff"]).destructive).toBe(false);
    expect(isDestructiveGitCommand(["checkout", "feature-branch"]).destructive).toBe(false);
    expect(isDestructiveGitCommand([]).destructive).toBe(false);
  });
});

describe("engine/policy-engine.ts", () => {
  it("initializes policy engine, handles drift and checks authorization", async () => {
    const tmp = makeScratchDir("policy-engine-test");
    try {
      mkdirSync(join(tmp, ".olt"), { recursive: true });
      const policy = generateDefaultRepoPolicy(tmp);
      saveRepoPolicy(policy, tmp);

      const engine = new PolicyEngine({ repoRoot: tmp });
      expect(engine.getPolicy()).toBeDefined();
      expect(typeof engine.getChecksum()).toBe("string");

      const drift = engine.checkDrift();
      expect(drift.drifted).toBe(false);

      const reload = await engine.reload();
      expect(reload.reloaded).toBe(false);

      const auth = engine.verifyCommand("git status", "implementer");
      expect(auth).toBeDefined();

      let listenerCalled = false;
      const unsubs = engine.subscribe(() => {
        listenerCalled = true;
      });
      expect(unsubs).toBeDefined();

      engine.stopAutoReload();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

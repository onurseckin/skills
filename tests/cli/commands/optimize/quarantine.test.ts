import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as childProcess from "node:child_process";
import { join } from "node:path";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import {
  executeQuarantine,
  optimizeQuarantineCommand,
  setTscRunnerForTesting,
} from "../../../../olt/scripts/src/cli/commands/optimize/quarantine.ts";
import { setGitRunnerForTesting } from "../../../../olt/scripts/src/workflow/worktree/git.ts";
import { type VirtualMemoryFS } from "../../../../olt/scripts/src/testing/virtual-fs/index.ts";
import { cleanupVirtualCliFS, setupVirtualCliFS } from "../fixtures/full-lifecycle-fixture.ts";

interface GitCall {
  readonly cwd: string;
  readonly argv: readonly string[];
}

let vfs: VirtualMemoryFS;
let restoreGitRunner: (() => void) | undefined;
let restoreTscRunner: (() => void) | undefined;
const gitCalls: GitCall[] = [];

beforeEach(() => {
  vfs = setupVirtualCliFS();
  gitCalls.length = 0;
  restoreGitRunner = setGitRunnerForTesting((cwd, argv) => {
    gitCalls.push({ cwd, argv });
    if (argv[0] === "rev-parse" && argv[1] === "HEAD") {
      return { status: 0, stdout: "1111222233334444555566667777888899990000\n", stderr: "" };
    }
    return { status: 0, stdout: "", stderr: "" };
  });
  restoreTscRunner = setTscRunnerForTesting((_repoRoot) => {
    return { success: true, output: "Mock compiler: 0 errors" };
  });
});

afterEach(() => {
  if (restoreGitRunner) {
    restoreGitRunner();
    restoreGitRunner = undefined;
  }
  if (restoreTscRunner) {
    restoreTscRunner();
    restoreTscRunner = undefined;
  }
  cleanupVirtualCliFS();
});

describe("optimize:quarantine command & engine", () => {
  test("quarantine flow: records failure logs and creates QUARANTINED.md", async () => {
    const repoRoot = process.cwd();
    const planSlug = "broken-lane-plan";
    const planDir = join(repoRoot, "docs", "planning", planSlug);
    vfs.mkdirSync(planDir, { recursive: true });
    vfs.writeFileSync(join(planDir, "PLAN.md"), "# Broken Plan\nStep 1: fail\nStep 2: recover");

    const wtDir = join(repoRoot, ".olt", "worktrees", `${planSlug}-lane1`);
    vfs.mkdirSync(wtDir, { recursive: true });
    vfs.writeFileSync(
      join(wtDir, ".worktree-meta.json"),
      JSON.stringify({ trackId: `${planSlug}-lane1`, worktreePath: wtDir, tier: "track" }),
    );

    const result = await optimizeQuarantineCommand({
      plan: planSlug,
      reason: "Type recursion limit exceeded in AST analyzer",
      defect: "DEF-9001",
    });

    expect(result.ok).toBe(true);
    expect(result.plan).toBe(planSlug);
    expect(result.quarantined).toBe(true);
    expect(result.dry_run).toBe(false);
    expect(result.reason).toBe("Type recursion limit exceeded in AST analyzer");
    expect(result.defect).toBe("DEF-9001");
    expect(result.defect_sha).toBe("1111222233334444555566667777888899990000");
    expect(result.next_state).toBe("TRANSITION_NEXT_PLAN_OR_PHASE_2");

    expect(vfs.existsSync(join(planDir, "PLAN.md"))).toBe(false);
    expect(vfs.existsSync(join(planDir, "QUARANTINED.md"))).toBe(true);

    const quarantinedContent = vfs.readFileSync(join(planDir, "QUARANTINED.md"), "utf-8");
    expect(quarantinedContent).toContain(`# Quarantined Plan: ${planSlug}`);
    expect(quarantinedContent).toContain("Type recursion limit exceeded in AST analyzer");
    expect(quarantinedContent).toContain("DEF-9001");
    expect(quarantinedContent).toContain("1111222233334444555566667777888899990000");
    expect(quarantinedContent).toContain("## Preserved Original Plan");
    expect(quarantinedContent).toContain("# Broken Plan");

    const hasReset = gitCalls.some((c) => c.argv[0] === "reset");
    const hasCheckoutMain = gitCalls.some((c) => c.argv[0] === "checkout" && c.argv[1] === "main");
    expect(hasReset).toBe(true);
    expect(hasCheckoutMain).toBe(true);
  });

  test("dry-run: validates actions without mutating disk", async () => {
    const repoRoot = process.cwd();
    const planSlug = "dry-run-plan";
    const planDir = join(repoRoot, "docs", "planning", planSlug);
    vfs.mkdirSync(planDir, { recursive: true });
    const originalContent = "# Dry Run Plan\nOriginal untouched content";
    vfs.writeFileSync(join(planDir, "PLAN.md"), originalContent);

    const wtDir = join(repoRoot, ".olt", "worktrees", `${planSlug}-lane1`);
    vfs.mkdirSync(wtDir, { recursive: true });
    vfs.writeFileSync(
      join(wtDir, ".worktree-meta.json"),
      JSON.stringify({ trackId: `${planSlug}-lane1`, worktreePath: wtDir, tier: "track" }),
    );

    const mutatingCallCountBefore = gitCalls.filter(
      (c) => c.argv[0] === "reset" || c.argv[0] === "checkout",
    ).length;

    const result = await optimizeQuarantineCommand({
      plan: planSlug,
      reason: "Simulated quarantine validation",
      "dry-run": true,
    });

    expect(result.ok).toBe(true);
    expect(result.dry_run).toBe(true);
    expect(result.quarantined).toBe(false);
    expect(result.plan).toBe(planSlug);
    expect(result.worktrees_cleaned).toEqual([`${planSlug}-lane1`]);

    // Verify disk was NOT mutated (neither plan nor worktree deleted)
    expect(vfs.existsSync(join(planDir, "PLAN.md"))).toBe(true);
    expect(vfs.readFileSync(join(planDir, "PLAN.md"), "utf-8")).toBe(originalContent);
    expect(vfs.existsSync(join(planDir, "QUARANTINED.md"))).toBe(false);
    expect(vfs.existsSync(wtDir)).toBe(true);

    const mutatingCallCountAfter = gitCalls.filter(
      (c) => c.argv[0] === "reset" || c.argv[0] === "checkout",
    ).length;
    expect(mutatingCallCountAfter).toBe(mutatingCallCountBefore);
    expect(String(result.markdown)).toContain("DRY RUN (Simulated)");
  });

  test("missing plan slug throws HarnessError('INVALID_ARGUMENT', '--plan is required')", async () => {
    expect(() => optimizeQuarantineCommand({})).toThrow(HarnessError);
    try {
      await optimizeQuarantineCommand({});
      expect.unreachable("Should have thrown missing plan error");
    } catch (error) {
      expect(error).toBeInstanceOf(HarnessError);
      const harnessError = error as HarnessError;
      expect(harnessError.code).toBe("INVALID_ARGUMENT");
      expect(harnessError.message).toBe("--plan is required");
    }
  });

  test("invalid plan slug format throws HarnessError('INVALID_ARGUMENT')", () => {
    expect(() => executeQuarantine("../unsafe-path")).toThrow(HarnessError);
    try {
      executeQuarantine("invalid/slug/chars");
      expect.unreachable("Should have thrown invalid slug error");
    } catch (error) {
      expect(error).toBeInstanceOf(HarnessError);
      const harnessError = error as HarnessError;
      expect(harnessError.code).toBe("INVALID_ARGUMENT");
      expect(harnessError.message).toContain("Invalid plan slug");
    }
  });

  test("supports explicit 40-character defect SHA and --json flag", async () => {
    const planSlug = "sha-json-plan";
    const explicitSha = "abcdef0123456789abcdef0123456789abcdef01";

    const result = await optimizeQuarantineCommand({
      plan: planSlug,
      defect: explicitSha,
      json: true,
    });

    expect(result.ok).toBe(true);
    expect(result.defect_sha).toBe(explicitSha);
    expect(result.defect).toBe(explicitSha);
    expect(result.json).toBe(true);
  });

  test("records compiler errors into QUARANTINED.md when tsc fails", () => {
    const planSlug = "failing-compiler-plan";
    const result = executeQuarantine(planSlug, {
      reason: "Compilation broken by implementer",
      tscRunner: () => ({
        success: false,
        output: "error TS2322: Type 'string' is not assignable to type 'number'.",
      }),
    });

    expect(result.compilerHealth.healthy).toBe(false);
    expect(result.compilerHealth.output).toContain("error TS2322");
    expect(result.nextState).toBe("TRANSITION_NEXT_PLAN_OR_PHASE_2");

    const repoRoot = process.cwd();
    const qFile = join(repoRoot, "docs", "planning", planSlug, "QUARANTINED.md");
    expect(vfs.existsSync(qFile)).toBe(true);
    const content = vfs.readFileSync(qFile, "utf-8");
    expect(content).toContain("error TS2322");
    expect(content).toContain("FAILED (compiler defects present)");
  });

  test("captures exception thrown by tscRunner gracefully", () => {
    const planSlug = "throwing-compiler-plan";
    const result = executeQuarantine(planSlug, {
      tscRunner: () => {
        throw new Error("Compiler process crashed");
      },
    });

    expect(result.compilerHealth.healthy).toBe(false);
    expect(result.compilerHealth.output).toBe("Compiler process crashed");
  });

  test("cleans orchestrator worktrees matching plan slug", () => {
    const repoRoot = process.cwd();
    const planSlug = "orch-test-plan";
    const wtDir = join(repoRoot, ".olt", "worktrees", `orch-${planSlug}`);
    vfs.mkdirSync(wtDir, { recursive: true });
    vfs.writeFileSync(
      join(wtDir, ".worktree-meta.json"),
      JSON.stringify({
        trackId: `orch-${planSlug}`,
        domain: planSlug,
        worktreePath: wtDir,
        tier: "orchestrator",
      }),
    );

    const result = executeQuarantine(planSlug);
    expect(result.worktreesCleaned).toContain(`orch-${planSlug}`);
  });

  test("handles git runner failures during SHA lookup and index restoration", () => {
    const failingGitRunner = () => {
      throw new Error("Git lock acquisition error");
    };

    const result = executeQuarantine("git-failure-plan", {
      runner: failingGitRunner,
    });

    expect(result.defectSha).toBe("UNKNOWN_DEFECT_SHA");
    expect(result.gitRestored).toBe(false);
  });

  test("executes custom worktreeCleaner and records cleaned list", () => {
    const planSlug = "custom-cleaner-plan";
    let cleanedCalled = 0;

    const result = executeQuarantine(planSlug, {
      worktreeCleaner: () => {
        cleanedCalled++;
        return {
          cleaned: ["custom-cleaner-plan-worker-1", "custom-cleaner-plan-worker-2"],
          skipped: [],
        };
      },
    });

    expect(cleanedCalled).toBe(1);
    expect(result.worktreesCleaned).toEqual([
      "custom-cleaner-plan-worker-1",
      "custom-cleaner-plan-worker-2",
    ]);
  });

  test("handles plan directory creation when docs/planning/<slug> did not exist", () => {
    const planSlug = "fresh-uncreated-plan";
    const result = executeQuarantine(planSlug, {
      reason: "Quarantined prior to plan authoring",
    });

    expect(result.quarantined).toBe(true);
    const qFile = join(process.cwd(), "docs", "planning", planSlug, "QUARANTINED.md");
    expect(vfs.existsSync(qFile)).toBe(true);
  });

  test("default spawnSync compiler check executes cleanly without tscRunner", () => {
    restoreTscRunner?.();
    restoreTscRunner = undefined;

    const result = executeQuarantine("default-compiler-plan");
    expect(typeof result.compilerHealth.healthy).toBe("boolean");
    expect(typeof result.compilerHealth.output).toBe("string");
  });

  test("handles low-level spawn failure in compiler check gracefully", () => {
    restoreTscRunner?.();
    restoreTscRunner = undefined;

    const spawnSpy = spyOn(childProcess, "spawnSync").mockImplementationOnce(() => {
      throw new Error("Low-level spawn failure");
    });

    const result = executeQuarantine("spawn-error-plan");
    expect(result.compilerHealth.healthy).toBe(false);
    expect(result.compilerHealth.output).toBe("Low-level spawn failure");
    spawnSpy.mockRestore();
  });

  test("preserves unrelated worktrees and avoids substring collisions", async () => {
    const repoRoot = process.cwd();
    const unrelatedDir = join(repoRoot, ".olt", "worktrees", "oauth-login");
    vfs.mkdirSync(unrelatedDir, { recursive: true });
    vfs.writeFileSync(
      join(unrelatedDir, ".worktree-meta.json"),
      JSON.stringify({ trackId: "oauth-login", worktreePath: unrelatedDir, tier: "track" }),
    );

    const result = await optimizeQuarantineCommand({
      plan: "auth",
      reason: "Auth failure",
    });

    expect(result.worktrees_cleaned).toEqual([]);
    expect(vfs.existsSync(unrelatedDir)).toBe(true);

    const resultCleanAll = await optimizeQuarantineCommand({
      plan: "auth",
      "clean-all-worktrees": true,
    });
    expect(resultCleanAll.worktrees_cleaned).toContain("oauth-login");
  });

  test("returns gitRestored: false when git checkout returns exit code 1 without throwing", () => {
    const nonThrowingFailingRunner = (_cwd: string, argv: readonly string[]) => {
      if (argv[0] === "checkout" && argv[1] === "main") {
        return { status: 1, stdout: "", stderr: "error: pathspec 'main' did not match" };
      }
      return { status: 0, stdout: "", stderr: "" };
    };

    const result = executeQuarantine("git-nonzero-status-plan", {
      runner: nonThrowingFailingRunner,
    });

    expect(result.gitRestored).toBe(false);
  });

  test("supports CLI flags --failure-logs and rejects unknown flags", async () => {
    const result = await optimizeQuarantineCommand({
      plan: "logs-plan",
      "failure-logs": "Fatal panic: stack overflow at line 42",
      defect: "DEF-LOG-1",
    });

    expect(result.failure_logs).toBe("Fatal panic: stack overflow at line 42");
    const qFile = join(process.cwd(), "docs", "planning", "logs-plan", "QUARANTINED.md");
    expect(vfs.readFileSync(qFile, "utf-8")).toContain("Fatal panic: stack overflow at line 42");

    expect(() =>
      optimizeQuarantineCommand({
        plan: "logs-plan",
        "unknown-flag": "bad",
      }),
    ).toThrow(HarnessError);
  });
});

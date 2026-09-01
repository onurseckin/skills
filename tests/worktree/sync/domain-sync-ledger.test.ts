import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { GitResult, GitRunner } from "../../../olt/scripts/src/workflow/worktree/git.ts";
import {
  commitAndPushDomainSubphase,
  createDomainLedger,
  provisionDomainWorktree,
} from "../../../olt/scripts/src/engine/worktree/domain-sync.ts";
import { cleanupVirtualWorktreeFS, setupVirtualWorktreeFS } from "../fixtures/index.ts";

beforeEach(() => {
  setupVirtualWorktreeFS();
});

afterEach(() => {
  cleanupVirtualWorktreeFS();
});

function trackedDir(prefix: string): string {
  const dir = join(
    "/virtual",
    `domain-sync-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

type Call = { cwd: string; argv: readonly string[] };

function scripted(script: (call: Call, index: number) => GitResult): {
  runner: GitRunner;
  calls: Call[];
} {
  const calls: Call[] = [];
  const runner: GitRunner = (cwd, argv) => {
    const call = { cwd, argv };
    calls.push(call);
    return script(call, calls.length - 1);
  };
  return { runner, calls };
}

const ok = (stdout = ""): GitResult => ({ status: 0, stdout, stderr: "" });
const fail = (stderr = "", status = 1): GitResult => ({ status, stdout: "", stderr });

describe("Domain Sync: Ledger & Provisioning", () => {
  describe("createDomainLedger", () => {
    test("initializes domain ledger with valid parameters", () => {
      const ledger = createDomainLedger("main", "base123", "/root/path", "base-branch");
      expect(ledger.harnessBranch).toBe("main");
      expect(ledger.baseSha).toBe("base123");
      expect(ledger.root).toBe("/root/path");
      expect(ledger.baseBranch).toBe("base-branch");
      expect(ledger.domains).toEqual({});
      expect(ledger.commits).toEqual([]);
      expect(ledger.syncHistory).toEqual([]);
    });

    test("throws INVALID_ARGUMENT on empty harnessBranch, baseSha, or root", () => {
      expect(() => createDomainLedger("", "base123", "/root")).toThrow(
        /harnessBranch cannot be empty/,
      );
      expect(() => createDomainLedger("main", "", "/root")).toThrow(/baseSha cannot be empty/);
      expect(() => createDomainLedger("main", "base123", "")).toThrow(
        /root directory cannot be empty/,
      );
    });
  });

  describe("provisionDomainWorktree", () => {
    test("provisions an isolated domain worktree and registers it in the ledger", () => {
      const repoRoot = trackedDir("repo");
      const ledgerRoot = trackedDir("ledger");
      const ledger = createDomainLedger("main", "sha001", ledgerRoot);
      const { runner, calls } = scripted(() => ok());
      const now = new Date("2026-08-22T14:00:00.000Z");

      const config = provisionDomainWorktree(repoRoot, ledger, "frontend-ui", "run-1", runner, now);

      expect(config.domain).toBe("frontend-ui");
      expect(config.worktreeId).toBe("domain-frontend-ui");
      expect(config.branch).toBe("harness--frontend-ui-run-1");
      expect(config.baseSha).toBe("sha001");
      expect(config.headSha).toBe("sha001");
      expect(config.status).toBe("active");
      expect(config.createdAt).toBe("2026-08-22T14:00:00.000Z");
      expect(ledger.domains["frontend-ui"]).toBe(config);

      const worktreeCall = calls.find((c) => c.argv[0] === "worktree" && c.argv[1] === "add");
      expect(worktreeCall).toBeDefined();
      expect(worktreeCall?.argv).toContain("harness--frontend-ui-run-1");
    });

    test("throws INVALID_ARGUMENT on empty domain name", () => {
      const repoRoot = trackedDir("repo");
      const ledger = createDomainLedger("main", "sha001", "/root");
      expect(() => provisionDomainWorktree(repoRoot, ledger, "", "run-1")).toThrow(
        /domain name cannot be empty/,
      );
    });
  });

  describe("commitAndPushDomainSubphase", () => {
    test("rejects unrecognised commit tags", () => {
      const { runner } = scripted(() => ok());
      expect(() =>
        commitAndPushDomainSubphase({
          domain: "frontend-ui",
          taskId: "task-ui-1",
          worktreeId: "domain-frontend-ui",
          worktreePath: "/wt/frontend",
          writeScope: ["src/components/**"],
          label: "shiny button",
          commitType: "invalid-type",
          runner,
        }),
      ).toThrow(/not a recognised conventional-commit tag/);
    });

    test("rejects empty write scope", () => {
      const { runner } = scripted(() => ok());
      expect(() =>
        commitAndPushDomainSubphase({
          domain: "backend-system",
          taskId: "task-1",
          worktreeId: "domain-backend-system",
          worktreePath: "/wt/backend",
          writeScope: [],
          label: "some change",
          runner,
        }),
      ).toThrow(/has no write scope to commit for domain/);
    });

    test("throws ROLE_CONFINEMENT_VIOLATION if modifiedPaths violate write scope", () => {
      const { runner } = scripted(() => ok());
      expect(() =>
        commitAndPushDomainSubphase({
          domain: "frontend-ui",
          taskId: "task-ui-1",
          worktreeId: "domain-frontend-ui",
          worktreePath: "/wt/frontend",
          writeScope: ["src/ui/**"],
          modifiedPaths: ["src/ui/Button.tsx", "src/server/auth.ts"],
          label: "add button",
          runner,
        }),
      ).toThrow(/modified files outside its assigned write scope/);
    });

    test("creates domain-tagged commit with conventional commit subject", () => {
      const { runner, calls } = scripted((call) => {
        if (call.argv[0] === "add") return ok();
        if (call.argv[0] === "diff") return fail("", 1);
        if (call.argv[0] === "commit") return ok();
        if (call.argv[0] === "rev-parse") return ok("sha1234567890\n");
        if (call.argv[0] === "show") return ok(" 1 file changed, 50 insertions(+)\n");
        return ok();
      });

      const now = new Date("2026-08-22T14:10:00.000Z");
      const outcome = commitAndPushDomainSubphase({
        domain: "frontend-ui",
        taskId: "task-ui-1",
        worktreeId: "domain-frontend-ui",
        worktreePath: "/wt/frontend",
        writeScope: ["src/ui/**"],
        modifiedPaths: ["src/ui/Button.tsx"],
        label: "create shiny primary button component",
        commitType: "feat",
        pushOnCommit: true,
        maxCommitLines: 400,
        now,
        runner,
      });

      expect(outcome.committed).toBe(true);
      expect(outcome.pushed).toBe(true);
      expect(outcome.commit?.subject).toBe(
        "feat(frontend-ui): create shiny primary button component",
      );
      expect(outcome.commit?.sha).toBe("sha1234567890");
      expect(outcome.commit?.changedLines).toBe(50);
      expect(outcome.commit?.overLimit).toBe(false);
      expect(outcome.commit?.committedAt).toBe("2026-08-22T14:10:00.000Z");

      const commitCall = calls.find((c) => c.argv[0] === "commit");
      expect(commitCall?.argv).toContain(
        "feat(frontend-ui): create shiny primary button component",
      );
    });

    test("truncates overly long commit label to stay within 70 characters", () => {
      const { runner } = scripted((call) => {
        if (call.argv[0] === "add") return ok();
        if (call.argv[0] === "diff") return fail("", 1);
        if (call.argv[0] === "commit") return ok();
        if (call.argv[0] === "rev-parse") return ok("sha1234567890\n");
        if (call.argv[0] === "show") return ok(" 1 file changed, 10 insertions(+)\n");
        return ok();
      });

      const longLabel = "x".repeat(100);
      const outcome = commitAndPushDomainSubphase({
        domain: "backend-system",
        taskId: "task-be-1",
        worktreeId: "domain-backend-system",
        worktreePath: "/wt/backend",
        writeScope: ["src/api/**"],
        label: longLabel,
        runner,
      });

      expect(outcome.committed).toBe(true);
      expect(outcome.commit?.subject.length).toBeLessThanOrEqual(70);
      expect(outcome.commit?.subject.startsWith("feat(backend-system): ")).toBe(true);
      expect(outcome.commit?.subject.endsWith("…")).toBe(true);
    });

    test("warns when commit changed lines exceed maxCommitLines", () => {
      const { runner } = scripted((call) => {
        if (call.argv[0] === "add") return ok();
        if (call.argv[0] === "diff") return fail("", 1);
        if (call.argv[0] === "commit") return ok();
        if (call.argv[0] === "rev-parse") return ok("sha1234567890\n");
        if (call.argv[0] === "show") return ok(" 1 file changed, 450 insertions(+)\n");
        return ok();
      });

      const outcome = commitAndPushDomainSubphase({
        domain: "security-auth",
        taskId: "task-sec-1",
        worktreeId: "domain-security-auth",
        worktreePath: "/wt/sec",
        writeScope: ["src/auth/**"],
        label: "large auth overhaul",
        maxCommitLines: 400,
        runner,
      });

      expect(outcome.committed).toBe(true);
      expect(outcome.commit?.overLimit).toBe(true);
      expect(outcome.warning).toMatch(/over the 400-line target \(B22\.3\)/);
    });

    test("returns committed: false when no changes staged", () => {
      const { runner } = scripted((call) => {
        if (call.argv[0] === "add") return ok();
        if (call.argv[0] === "diff") return ok();
        return ok();
      });

      const outcome = commitAndPushDomainSubphase({
        domain: "core-engine",
        taskId: "task-ce-1",
        worktreeId: "domain-core-engine",
        worktreePath: "/wt/core",
        writeScope: ["src/core/**"],
        label: "no-op change",
        runner,
      });

      expect(outcome.committed).toBe(false);
      expect(outcome.pushed).toBe(false);
    });
  });
});

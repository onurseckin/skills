import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  acquireMailboxLock,
  ensureMailboxDirectories,
  releaseMailboxLock,
  resolveMailboxLockPath,
  resolveMailboxPaths,
} from "../../../olt/scripts/src/communication/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  resolvePolicyLocation,
  resolveSystemLockPath,
  withLock,
} from "../../../olt/scripts/src/policy/io-safety.ts";
import { cleanupVirtualCommunicationFS, setupVirtualCommunicationFS } from "../helpers.ts";

describe("Mailbox and System Lock Path Consolidation", () => {
  let testRoot: string;

  beforeEach(() => {
    setupVirtualCommunicationFS();
    testRoot = join(
      process.cwd(),
      "coverage",
      "scratch",
      `lock-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(testRoot, { recursive: true });
  });

  afterEach(() => {
    cleanupVirtualCommunicationFS();
  });

  describe("resolveMailboxLockPath (task-msg-2.1)", () => {
    it("consolidates agent mailbox locks into .olt/locks/mailboxes/", () => {
      const lockPath = resolveMailboxLockPath("worker-1", testRoot);
      expect(lockPath).toBe(join(testRoot, ".olt", "locks", "mailboxes", "worker-1.lock"));
    });

    it("defaults to process.cwd() when baseDir is omitted", () => {
      const lockPath = resolveMailboxLockPath("orchestrator-main");
      expect(lockPath).toBe(
        join(process.cwd(), ".olt", "locks", "mailboxes", "orchestrator-main.lock"),
      );
    });

    it("matches lockPath returned by resolveMailboxPaths", () => {
      const paths = resolveMailboxPaths("validator-05", testRoot);
      const directLockPath = resolveMailboxLockPath("validator-05", testRoot);
      expect(paths.lockPath).toBe(directLockPath);
      expect(paths.lockPath).toBe(
        join(testRoot, ".olt", "locks", "mailboxes", "validator-05.lock"),
      );
    });

    it("throws INVALID_ARGUMENT for non-string or empty agentId", () => {
      expect(() => resolveMailboxLockPath(undefined as unknown as string, testRoot)).toThrow(
        HarnessError,
      );
      expect(() => resolveMailboxLockPath("" as unknown as string, testRoot)).toThrow(HarnessError);
      expect(() => resolveMailboxLockPath("   ", testRoot)).toThrow(HarnessError);
    });

    it("throws PATH_SAFETY for path traversal or separator characters in agentId", () => {
      expect(() => resolveMailboxLockPath(".", testRoot)).toThrow(HarnessError);
      expect(() => resolveMailboxLockPath("..", testRoot)).toThrow(HarnessError);
      expect(() => resolveMailboxLockPath("../escape", testRoot)).toThrow(HarnessError);
      expect(() => resolveMailboxLockPath("sub/agent", testRoot)).toThrow(HarnessError);
      expect(() => resolveMailboxLockPath("sub\\agent", testRoot)).toThrow(HarnessError);
      expect(() => resolveMailboxLockPath("agent\0null", testRoot)).toThrow(HarnessError);
    });
  });

  describe("resolveSystemLockPath (task-msg-2.2)", () => {
    it("relocates repository flock and lock files into .olt/locks/", () => {
      const backlogFlock = resolveSystemLockPath("backlog.flock", testRoot);
      const defectsFlock = resolveSystemLockPath("defects.flock", testRoot);
      const policyLock = resolveSystemLockPath("policy.lock", testRoot);
      const auditorLock = resolveSystemLockPath("skill_auditor.lock", testRoot);

      expect(backlogFlock).toBe(join(testRoot, ".olt", "locks", "backlog.flock"));
      expect(defectsFlock).toBe(join(testRoot, ".olt", "locks", "defects.flock"));
      expect(policyLock).toBe(join(testRoot, ".olt", "locks", "policy.lock"));
      expect(auditorLock).toBe(join(testRoot, ".olt", "locks", "skill_auditor.lock"));
    });

    it("defaults to findRepoRoot() when repoRoot is omitted", () => {
      const lockPath = resolveSystemLockPath("system.lock");
      expect(lockPath).toBe(join(process.cwd(), ".olt", "locks", "system.lock"));
    });

    it("throws INVALID_ARGUMENT for non-string or empty lockName", () => {
      expect(() => resolveSystemLockPath(undefined as unknown as string, testRoot)).toThrow(
        HarnessError,
      );
      expect(() => resolveSystemLockPath("", testRoot)).toThrow(HarnessError);
      expect(() => resolveSystemLockPath("   ", testRoot)).toThrow(HarnessError);
    });

    it("throws PATH_SAFETY for path traversal or separator characters in lockName", () => {
      expect(() => resolveSystemLockPath(".", testRoot)).toThrow(HarnessError);
      expect(() => resolveSystemLockPath("..", testRoot)).toThrow(HarnessError);
      expect(() => resolveSystemLockPath("../escape.lock", testRoot)).toThrow(HarnessError);
      expect(() => resolveSystemLockPath("nested/lock.flock", testRoot)).toThrow(HarnessError);
      expect(() => resolveSystemLockPath("nested\\lock.flock", testRoot)).toThrow(HarnessError);
      expect(() => resolveSystemLockPath("lock\0null", testRoot)).toThrow(HarnessError);
    });
  });

  describe("Integration with Directory Lifecycle & Advisory Locking", () => {
    it("ensures mailbox directories create .olt/locks/mailboxes with mode 0o700", () => {
      const paths = resolveMailboxPaths("worker-integration", testRoot);
      ensureMailboxDirectories(paths);

      const lockDir = join(testRoot, ".olt", "locks", "mailboxes");
      expect(existsSync(lockDir)).toBe(true);
      const stat = statSync(lockDir);
      expect(stat.isDirectory()).toBe(true);
      expect(stat.mode & 0o777).toBe(0o700);
    });

    it("acquires advisory lock on consolidated mailbox lock path", () => {
      const lockPath = resolveMailboxLockPath("worker-locked", testRoot);
      const result = acquireMailboxLock(lockPath, "worker-locked");
      try {
        expect(result.acquired).toBe(true);
        expect(result.lockPath).toBe(lockPath);
        expect(existsSync(lockPath)).toBe(true);
      } finally {
        releaseMailboxLock(result);
      }
    });

    it("integrates withLock using resolved policy lock in .olt/locks/", () => {
      const location = resolvePolicyLocation(testRoot, undefined, true);
      const res = withLock(location, () => {
        return "policy-operation-success";
      });
      expect(res).toBe("policy-operation-success");
      const expectedLock = resolveSystemLockPath("policy.lock", testRoot);
      expect(existsSync(expectedLock)).toBe(true);
    });
  });

  describe("Architectural Invariants & Zero Comments", () => {
    it("verifies source files have zero comments and adhere to physical line budget", () => {
      const files = [
        "olt/scripts/src/communication/mailbox/mailbox-paths.ts",
        "olt/scripts/src/communication/mailbox/index.ts",
        "olt/scripts/src/communication/index.ts",
        "olt/scripts/src/policy/io-safety.ts",
        "olt/scripts/src/policy/index.ts",
      ];

      for (const relPath of files) {
        const fullPath = join(process.cwd(), relPath);
        const content = readFileSync(fullPath, "utf8");
        const lines = content.split("\n");
        expect(lines.length).toBeLessThanOrEqual(300);
        expect(content).not.toMatch(/\/\//);
        expect(content).not.toMatch(/\/\*/);
        expect(content).not.toContain("export *");
      }
    });
  });
});

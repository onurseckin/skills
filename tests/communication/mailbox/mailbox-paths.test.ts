import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  ensureMailboxDirectories,
  ensureMailboxDir,
  getInMemoryMailboxDirs,
  isInMemoryMailboxDir,
  isValidAgentId,
  listMailboxAgentIds,
  resetInMemoryMailboxDirs,
  resolveMailboxLockPath,
  resolveMailboxPaths,
  resolveSystemLockPath,
} from "../../../olt/scripts/src/communication/mailbox/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import type { MailboxPaths } from "../../../olt/scripts/src/communication/types.ts";
import { cleanupVirtualCommunicationFS, setupVirtualCommunicationFS } from "../helpers.ts";

describe("Mailbox Paths & Directory Provisioning Engine", () => {
  let tempDir: string;

  beforeEach(() => {
    setupVirtualCommunicationFS();
    tempDir = mkdtempSync(join(tmpdir(), "mailbox-paths-test-"));
  });

  afterEach(() => {
    cleanupVirtualCommunicationFS();
  });

  describe("isValidAgentId", () => {
    it("validates agentId strings and rejects non-strings, empty, and traversal strings", () => {
      expect(isValidAgentId("worker-1")).toBe(true);
      expect(isValidAgentId("agent_alpha")).toBe(true);
      expect(isValidAgentId(123)).toBe(false);
      expect(isValidAgentId(null)).toBe(false);
      expect(isValidAgentId("")).toBe(false);
      expect(isValidAgentId("   ")).toBe(false);
      expect(isValidAgentId(".")).toBe(false);
      expect(isValidAgentId("..")).toBe(false);
      expect(isValidAgentId("a/b")).toBe(false);
      expect(isValidAgentId("a\\b")).toBe(false);
      expect(isValidAgentId("a\0b")).toBe(false);
    });
  });

  describe("resolveMailboxLockPath", () => {
    it("resolves lock path relative to provided baseDir or default cwd", () => {
      const explicit = resolveMailboxLockPath("worker-1", tempDir);
      expect(explicit).toBe(join(tempDir, ".olt", "locks", "mailboxes", "worker-1.lock"));

      const defaultCwd = resolveMailboxLockPath("worker-2");
      expect(defaultCwd).toBe(
        join(resolve(process.cwd()), ".olt", "locks", "mailboxes", "worker-2.lock"),
      );
    });

    it("rejects non-string or whitespace agentId with INVALID_ARGUMENT", () => {
      expect(() => resolveMailboxLockPath("" as unknown as string)).toThrow(HarnessError);
      expect(() => resolveMailboxLockPath("   ")).toThrow(HarnessError);
      expect(() => resolveMailboxLockPath(null as unknown as string)).toThrow(HarnessError);
      expect(() => resolveMailboxLockPath(123 as unknown as string)).toThrow(HarnessError);
    });

    it("rejects unsafe traversal or separator characters with PATH_SAFETY", () => {
      expect(() => resolveMailboxLockPath(".")).toThrow(HarnessError);
      expect(() => resolveMailboxLockPath("..")).toThrow(HarnessError);
      expect(() => resolveMailboxLockPath("foo/../bar")).toThrow(HarnessError);
      expect(() => resolveMailboxLockPath("agent/nested")).toThrow(HarnessError);
      expect(() => resolveMailboxLockPath("agent\\nested")).toThrow(HarnessError);
      expect(() => resolveMailboxLockPath("agent\0null")).toThrow(HarnessError);
    });
  });

  describe("resolveMailboxPaths", () => {
    it("resolves all standard mailbox file paths under .olt/mailboxes/<agentId>", () => {
      const paths = resolveMailboxPaths("coordinator", tempDir);
      const expectedMailboxDir = join(tempDir, ".olt", "mailboxes", "coordinator");

      expect(paths.agentMailboxDir).toBe(expectedMailboxDir);
      expect(paths.inboxPath).toBe(join(expectedMailboxDir, "inbox.jsonl"));
      expect(paths.outboxPath).toBe(join(expectedMailboxDir, "outbox.jsonl"));
      expect(paths.archivePath).toBe(join(expectedMailboxDir, "archive.jsonl"));
      expect(paths.cursorPath).toBe(join(expectedMailboxDir, "cursor.json"));
      expect(paths.quarantinePath).toBe(join(expectedMailboxDir, "quarantine.log"));
      expect(paths.lockPath).toBe(join(tempDir, ".olt", "locks", "mailboxes", "coordinator.lock"));

      const cwdPaths = resolveMailboxPaths("agent-cwd");
      expect(cwdPaths.agentMailboxDir).toBe(
        join(resolve(process.cwd()), ".olt", "mailboxes", "agent-cwd"),
      );
    });

    it("rejects invalid or unsafe agentIds with appropriate HarnessErrors", () => {
      expect(() => resolveMailboxPaths("")).toThrow(HarnessError);
      expect(() => resolveMailboxPaths("   ")).toThrow(HarnessError);
      expect(() => resolveMailboxPaths(undefined as unknown as string)).toThrow(HarnessError);
      expect(() => resolveMailboxPaths("bad/traversal")).toThrow(HarnessError);
      expect(() => resolveMailboxPaths("bad\\traversal")).toThrow(HarnessError);
      expect(() => resolveMailboxPaths("..")).toThrow(HarnessError);
    });
  });

  describe("ensureMailboxDirectories", () => {
    it("creates agent mailbox and lock directories if they do not exist", () => {
      const paths = resolveMailboxPaths("provision-test", tempDir);
      expect(existsSync(paths.agentMailboxDir)).toBe(false);
      expect(existsSync(join(tempDir, ".olt", "locks", "mailboxes"))).toBe(false);

      ensureMailboxDirectories(paths);

      expect(existsSync(paths.agentMailboxDir)).toBe(true);
      expect(existsSync(join(tempDir, ".olt", "locks", "mailboxes"))).toBe(true);

      // Re-running when directories exist is a safe no-op
      expect(() => ensureMailboxDirectories(paths)).not.toThrow();
    });

    it("validates paths object and throws INVALID_ARGUMENT on missing fields", () => {
      expect(() => ensureMailboxDirectories(null as unknown as MailboxPaths)).toThrow(HarnessError);
      expect(() => ensureMailboxDirectories("string" as unknown as MailboxPaths)).toThrow(
        HarnessError,
      );
      expect(() =>
        ensureMailboxDirectories({
          agentMailboxDir: 123 as unknown as string,
          lockPath: "/tmp/lock",
        } as unknown as MailboxPaths),
      ).toThrow(HarnessError);
      expect(() =>
        ensureMailboxDirectories({
          agentMailboxDir: "   ",
          lockPath: "/tmp/lock",
        } as unknown as MailboxPaths),
      ).toThrow(HarnessError);
      expect(() =>
        ensureMailboxDirectories({
          agentMailboxDir: "/tmp/agent",
          lockPath: null as unknown as string,
        } as unknown as MailboxPaths),
      ).toThrow(HarnessError);
      expect(() =>
        ensureMailboxDirectories({
          agentMailboxDir: "/tmp/agent",
          lockPath: "  ",
        } as unknown as MailboxPaths),
      ).toThrow(HarnessError);
    });

    it("throws INTEGRITY when directory creation fails due to filesystem collision", () => {
      const blockerPath = join(tempDir, "blocker-file");
      writeFileSync(blockerPath, "collision", "utf8");
      const badPaths: MailboxPaths = {
        agentMailboxDir: join(blockerPath, "sub", "agent"),
        lockPath: join(tempDir, "safe", "lock.lock"),
        inboxPath: "",
        outboxPath: "",
        archivePath: "",
        cursorPath: "",
        quarantinePath: "",
      };
      expect(() => ensureMailboxDirectories(badPaths)).toThrow(HarnessError);
    });

    it("handles virtual in-memory mailbox paths and directories provisioning", () => {
      const vPaths = resolveMailboxPaths("virt-agent", "virtual:/memory/root");
      expect(vPaths.agentMailboxDir).toBe("virtual:/memory/root/.olt/mailboxes/virt-agent");
      expect(vPaths.inboxPath).toBe("virtual:/memory/root/.olt/mailboxes/virt-agent/inbox.jsonl");

      ensureMailboxDirectories(vPaths);
      expect(isInMemoryMailboxDir(vPaths.agentMailboxDir)).toBe(true);
      expect(getInMemoryMailboxDirs()).toContain(vPaths.agentMailboxDir);

      const ensured = ensureMailboxDir("virt-agent-2", "virtual:/memory/root");
      expect(isInMemoryMailboxDir(ensured.agentMailboxDir)).toBe(true);

      const ids = listMailboxAgentIds("virtual:/memory/root/.olt/mailboxes");
      expect(ids).toContain("virt-agent");
      expect(ids).toContain("virt-agent-2");

      resetInMemoryMailboxDirs();
      expect(getInMemoryMailboxDirs().length).toBe(0);
      expect(isInMemoryMailboxDir(vPaths.agentMailboxDir)).toBe(false);
      expect(listMailboxAgentIds()).toEqual([]);
    });
  });

  describe("resolveSystemLockPath", () => {
    it("resolves system lock path under .olt/locks", () => {
      const resolved = resolveSystemLockPath("policy.lock", tempDir);
      expect(resolved).toBe(join(tempDir, ".olt", "locks", "policy.lock"));

      const defaultCwd = resolveSystemLockPath("system.lock");
      expect(defaultCwd).toBe(join(resolve(process.cwd()), ".olt", "locks", "system.lock"));

      const oltRoot = resolveSystemLockPath("run.lock", join(tempDir, ".olt"));
      expect(oltRoot).toBe(join(tempDir, ".olt", "locks", "run.lock"));
    });

    it("rejects empty, non-string, or traversal lock names", () => {
      expect(() => resolveSystemLockPath("")).toThrow(HarnessError);
      expect(() => resolveSystemLockPath("   ")).toThrow(HarnessError);
      expect(() => resolveSystemLockPath(null as unknown as string)).toThrow(HarnessError);
      expect(() => resolveSystemLockPath("../escape.lock")).toThrow(HarnessError);
      expect(() => resolveSystemLockPath("bad/name.lock")).toThrow(HarnessError);
    });
  });
});

import { afterEach, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as os from "node:os";
import { join } from "node:path";
import {
  type VirtualFSSession,
  type VirtualMemoryFS,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";
import {
  deployCanonicalSkill,
  deploySkill,
  rollbackAssistantLinks,
  type AssistantLinkTransaction,
} from "../../../scripts/sync/skill-deployer.ts";
import {
  cleanupVirtualSyncFS,
  getVirtualSyncSession,
  mockSubprocess,
  scratchRoot,
  setupVirtualSyncFS,
  virtualReadlinkSync,
} from "../sync-fixture.ts";
import { git, initFakeSkillsRepo } from "./skill-deployer-fixtures.ts";

let subMock: { mockRestore: () => void } | undefined;
let tmpdirSpy: { mockRestore: () => void } | undefined;
let session: VirtualFSSession;
let vfs: VirtualMemoryFS;
let gitStatusOutput = "";

beforeAll(async () => {
  setupVirtualSyncFS();
  const root = scratchRoot(import.meta.path, "deploy-warmup");
  const sourceRepo = join(root, "repo");
  initFakeSkillsRepo(sourceRepo);
  const fakeHome = join(root, "home");
  const targetOlt = join(fakeHome, ".agents", "skills", "olt");
  try {
    await deployCanonicalSkill({
      sourceRepoRoot: sourceRepo,
      homeDir: fakeHome,
      targetOltDir: targetOlt,
      allowDirty: true,
    });
  } catch {}
  cleanupVirtualSyncFS();
});

beforeEach(() => {
  gitStatusOutput = "";
  vfs = setupVirtualSyncFS();
  session = getVirtualSyncSession();
  tmpdirSpy = spyOn(os, "tmpdir").mockReturnValue("/virtual/sync/tmp");
  subMock = mockSubprocess((cmd, args) => {
    if (cmd === "git") {
      const gitOut = (stdout: string | Buffer) => ({
        status: 0,
        stdout,
        stderr: "",
        output: ["", stdout, ""],
        pid: 1234,
      });
      if (args && args[0] === "status") return gitOut(gitStatusOutput);
      if (args && args[0] === "archive") return gitOut(Buffer.from("fake-archive"));
      return gitOut("");
    }
    if (cmd === "tar") {
      const cIdx = args ? args.indexOf("-C") : -1;
      const extractDir = cIdx !== -1 && args ? args[cIdx + 1] : undefined;
      if (extractDir) {
        vfs.mkdirSync(join(extractDir, "chatroom"), { recursive: true });
        vfs.writeFileSync(join(extractDir, "chatroom", "SKILL.md"), "head-chatroom\n", "utf-8");
        vfs.mkdirSync(join(extractDir, "olt"), { recursive: true });
        vfs.writeFileSync(join(extractDir, "olt", "SKILL.md"), "head-olt\n", "utf-8");
      }
      return { status: 0, stdout: "", stderr: "", output: ["", "", ""], pid: 1234 };
    }
    return { status: 0, stdout: "", stderr: "", output: ["", "", ""], pid: 1234 };
  });
});

afterEach(() => {
  if (subMock) {
    subMock.mockRestore();
    subMock = undefined;
  }
  tmpdirSpy?.mockRestore();
  tmpdirSpy = undefined;
  cleanupVirtualSyncFS();
});

describe("deployCanonicalSkill", () => {
  test("throws if sourceRepoRoot is not a valid skills repo checkout", async () => {
    const root = scratchRoot(import.meta.path, "deploy-invalid-repo");
    expect(deployCanonicalSkill({ sourceRepoRoot: root })).rejects.toThrow(
      /does not look like the skills repository/,
    );
  });

  test("successfully deploys canonical skill to target and links assistant dirs", async () => {
    const root = scratchRoot(import.meta.path, "deploy-canonical-success");
    const sourceRepo = join(root, "repo");
    initFakeSkillsRepo(sourceRepo);

    vfs.mkdirSync(join(sourceRepo, "node_modules"), { recursive: true });

    const fakeHome = join(root, "home");
    const legacyHome = join(fakeHome, ".agents", "skills", "orchestrating-long-tasks");
    vfs.mkdirSync(legacyHome, { recursive: true });
    vfs.writeFileSync(join(legacyHome, "old.txt"), "legacy\n", "utf-8");

    const targetOlt = join(fakeHome, ".agents", "skills", "olt");

    const result = await deployCanonicalSkill({
      sourceRepoRoot: sourceRepo,
      homeDir: fakeHome,
      targetOltDir: targetOlt,
      allowDirty: true,
    });

    expect(result.targetDir).toBe(targetOlt);
    expect(result.assistantDirsCount).toBe(9);
    expect(result.syncedCount + result.skippedCount).toBe(9);
    expect(result.syncedCount).toBeGreaterThan(0);
    expect(result.legacyHomePurged).toBe(true);

    expect(session.existsSync(join(targetOlt, "SKILL.md"))).toBe(true);
    expect(session.existsSync(join(targetOlt, "skill-config.json"))).toBe(true);
    expect(session.existsSync(join(targetOlt, "node_modules"))).toBe(true);
    expect(session.existsSync(legacyHome)).toBe(false);
  });

  test("second deployment is idempotent and reports skipped links", async () => {
    const root = scratchRoot(import.meta.path, "deploy-idempotency");
    const sourceRepo = join(root, "repo");
    initFakeSkillsRepo(sourceRepo);
    vfs.mkdirSync(join(sourceRepo, "node_modules"), { recursive: true });

    const fakeHome = join(root, "home");
    const targetOlt = join(fakeHome, ".agents", "skills", "olt");

    const testAssistantDir = join(fakeHome, ".claude", "skills");
    vfs.mkdirSync(testAssistantDir, { recursive: true });
    session.symlinkSync(targetOlt, join(testAssistantDir, "olt"));

    const result = await deployCanonicalSkill({
      sourceRepoRoot: sourceRepo,
      homeDir: fakeHome,
      targetOltDir: targetOlt,
      allowDirty: true,
    });

    expect(result.syncedCount + result.skippedCount).toBe(9);
    expect(result.skippedCount).toBeGreaterThan(0);
  });

  test("purges legacy home even when it contains a git repo", async () => {
    const root = scratchRoot(import.meta.path, "deploy-legacy-git-repo");
    const sourceRepo = join(root, "repo");
    initFakeSkillsRepo(sourceRepo);

    const fakeHome = join(root, "home");
    const legacyHome = join(fakeHome, ".agents", "skills", "orchestrating-long-tasks");
    vfs.mkdirSync(legacyHome, { recursive: true });
    git(["init", "--quiet", "--initial-branch", "main"], legacyHome);

    const targetOlt = join(fakeHome, ".agents", "skills", "olt");

    const result = await deployCanonicalSkill({
      sourceRepoRoot: sourceRepo,
      homeDir: fakeHome,
      targetOltDir: targetOlt,
      allowDirty: true,
    });

    expect(result.legacyHomePurged).toBe(true);
    expect(session.existsSync(legacyHome)).toBe(false);
  });

  test("handles legacyHomePurged failure when legacy home cannot be deleted", async () => {
    const root = scratchRoot(import.meta.path, "deploy-legacy-purge-failure");
    const sourceRepo = join(root, "repo");
    initFakeSkillsRepo(sourceRepo);

    const fakeHome = join(root, "home");
    const skillsDir = join(fakeHome, ".agents", "skills");
    const legacyHome = join(skillsDir, "orchestrating-long-tasks");
    const unremovableSub = join(legacyHome, "unremovable");
    vfs.mkdirSync(unremovableSub, { recursive: true });
    vfs.writeFileSync(join(unremovableSub, "file.txt"), "cannot delete", "utf-8");

    session.chmodSync(unremovableSub, 0o000);

    const targetOlt = join(fakeHome, ".agents", "skills", "olt");

    try {
      const result = await deployCanonicalSkill({
        sourceRepoRoot: sourceRepo,
        homeDir: fakeHome,
        targetOltDir: targetOlt,
        allowDirty: true,
      });

      expect(result.legacyHomePurged).toBe(false);
    } finally {
      session.chmodSync(unremovableSub, 0o755);
    }
  });

  test("handles assistant directory processing error gracefully via catch block", async () => {
    const root = scratchRoot(import.meta.path, "deploy-assistant-dir-error");
    const sourceRepo = join(root, "repo");
    initFakeSkillsRepo(sourceRepo);

    const fakeHome = join(root, "home");
    const blockedDir = join(fakeHome, ".cursor");
    vfs.mkdirSync(fakeHome, { recursive: true });
    vfs.writeFileSync(blockedDir, "blocking-file", "utf-8");

    const targetOlt = join(fakeHome, ".agents", "skills", "olt");

    const result = await deployCanonicalSkill({
      sourceRepoRoot: sourceRepo,
      homeDir: fakeHome,
      targetOltDir: targetOlt,
      allowDirty: true,
    });

    expect(result.targetDir).toBe(targetOlt);
  });

  test("rollbackAssistantLinks restores previous symlink state or removes newly created links", async () => {
    const root = scratchRoot(import.meta.path, "deploy-rollback-assistant-links");
    const dir1 = join(root, "dir1");
    const dir2 = join(root, "dir2");
    vfs.mkdirSync(dir1, { recursive: true });
    vfs.mkdirSync(dir2, { recursive: true });

    const targetA = join(root, "targetA");
    const targetB = join(root, "targetB");
    vfs.mkdirSync(targetA, { recursive: true });
    vfs.mkdirSync(targetB, { recursive: true });

    const txs: AssistantLinkTransaction[] = [
      {
        dir: dir1,
        oltPath: join(dir1, "olt"),
        previousTarget: targetA,
        existed: true,
        status: "created",
      },
      {
        dir: dir2,
        oltPath: join(dir2, "olt"),
        previousTarget: null,
        existed: false,
        status: "created",
      },
    ];

    session.symlinkSync(targetB, join(dir1, "olt"));
    session.symlinkSync(targetB, join(dir2, "olt"));

    rollbackAssistantLinks(txs, [root]);

    expect(virtualReadlinkSync(join(dir1, "olt"))).toBe(targetA);
    expect(session.existsSync(join(dir2, "olt"))).toBe(false);
  });
});

describe("deploySkill chatroom", () => {
  test("refuses on dirty chatroom/ tree without --allow-dirty and names dirty paths before copying", async () => {
    const root = scratchRoot(import.meta.path, "deploy-chatroom-dirty-refuse");
    const sourceRepo = join(root, "repo");
    initFakeSkillsRepo(sourceRepo);
    vfs.mkdirSync(join(sourceRepo, "chatroom"), { recursive: true });
    vfs.writeFileSync(join(sourceRepo, "chatroom", "SKILL.md"), "dirty-chatroom\n", "utf-8");

    gitStatusOutput = " M chatroom/SKILL.md\n?? chatroom/extra.ts\n";

    const fakeHome = join(root, "home");
    const targetChatroom = join(fakeHome, ".agents", "skills", "chatroom");

    await expect(
      deploySkill("chatroom", {
        sourceRepoRoot: sourceRepo,
        homeDir: fakeHome,
        targetChatroomDir: targetChatroom,
      }),
    ).rejects.toThrow(
      "refusing to sync from a dirty chatroom/ tree; commit these paths or pass --allow-dirty:\n  chatroom/SKILL.md\n  chatroom/extra.ts",
    );
  });

  test("target directory contents before refusal is byte-identical to after refusal", async () => {
    const root = scratchRoot(import.meta.path, "deploy-chatroom-byte-identical");
    const sourceRepo = join(root, "repo");
    initFakeSkillsRepo(sourceRepo);
    vfs.mkdirSync(join(sourceRepo, "chatroom"), { recursive: true });
    vfs.writeFileSync(join(sourceRepo, "chatroom", "SKILL.md"), "dirty-worktree\n", "utf-8");

    gitStatusOutput = " M chatroom/SKILL.md\n";

    const fakeHome = join(root, "home");
    const targetChatroom = join(fakeHome, ".agents", "skills", "chatroom");
    vfs.mkdirSync(targetChatroom, { recursive: true });
    vfs.writeFileSync(join(targetChatroom, "SKILL.md"), "mirror-initial-skill\n", "utf-8");
    vfs.writeFileSync(join(targetChatroom, "custom.json"), '{"version":1}\n', "utf-8");

    const beforeSkillBytes = vfs.readFileSync(join(targetChatroom, "SKILL.md"), "utf-8");
    const beforeCustomBytes = vfs.readFileSync(join(targetChatroom, "custom.json"), "utf-8");
    const beforeConfigExists = session.existsSync(join(targetChatroom, "skill-config.json"));

    let threw = false;
    try {
      await deploySkill("chatroom", {
        sourceRepoRoot: sourceRepo,
        homeDir: fakeHome,
        targetChatroomDir: targetChatroom,
        allowDirty: false,
      });
    } catch (err) {
      threw = true;
      expect((err as Error).message).toContain("refusing to sync from a dirty chatroom/ tree");
    }
    expect(threw).toBe(true);

    const afterSkillBytes = vfs.readFileSync(join(targetChatroom, "SKILL.md"), "utf-8");
    const afterCustomBytes = vfs.readFileSync(join(targetChatroom, "custom.json"), "utf-8");
    const afterConfigExists = session.existsSync(join(targetChatroom, "skill-config.json"));

    expect(afterSkillBytes).toBe(beforeSkillBytes);
    expect(afterCustomBytes).toBe(beforeCustomBytes);
    expect(afterConfigExists).toBe(beforeConfigExists);
  });

  test("succeeds with allowDirty: true", async () => {
    const root = scratchRoot(import.meta.path, "deploy-chatroom-allow-dirty");
    const sourceRepo = join(root, "repo");
    initFakeSkillsRepo(sourceRepo);
    vfs.mkdirSync(join(sourceRepo, "chatroom"), { recursive: true });
    vfs.writeFileSync(
      join(sourceRepo, "chatroom", "SKILL.md"),
      "dirty-worktree-content\n",
      "utf-8",
    );

    gitStatusOutput = " M chatroom/SKILL.md\n";

    const fakeHome = join(root, "home");
    const targetChatroom = join(fakeHome, ".agents", "skills", "chatroom");

    const result = await deploySkill("chatroom", {
      sourceRepoRoot: sourceRepo,
      homeDir: fakeHome,
      targetChatroomDir: targetChatroom,
      allowDirty: true,
    });

    expect(result.targetDir).toBe(targetChatroom);
    expect(vfs.readFileSync(join(targetChatroom, "SKILL.md"), "utf-8")).toBe(
      "dirty-worktree-content\n",
    );
    expect(session.existsSync(join(targetChatroom, "skill-config.json"))).toBe(true);
  });

  test("succeeds from HEAD when tree is clean", async () => {
    const root = scratchRoot(import.meta.path, "deploy-chatroom-clean-head");
    const sourceRepo = join(root, "repo");
    initFakeSkillsRepo(sourceRepo);
    vfs.mkdirSync(join(sourceRepo, "chatroom"), { recursive: true });
    vfs.writeFileSync(
      join(sourceRepo, "chatroom", "SKILL.md"),
      "worktree-dirty-ignored\n",
      "utf-8",
    );

    gitStatusOutput = "";

    const fakeHome = join(root, "home");
    const targetChatroom = join(fakeHome, ".agents", "skills", "chatroom");

    const result = await deploySkill("chatroom", {
      sourceRepoRoot: sourceRepo,
      homeDir: fakeHome,
      targetChatroomDir: targetChatroom,
      allowDirty: false,
    });

    expect(result.targetDir).toBe(targetChatroom);
    expect(vfs.readFileSync(join(targetChatroom, "SKILL.md"), "utf-8")).toBe("head-chatroom\n");
    expect(session.existsSync(join(targetChatroom, "skill-config.json"))).toBe(true);
  });
});

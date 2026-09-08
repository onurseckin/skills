import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { initCommand } from "../../../chatroom/scripts/src/cli/commands/lifecycle/init.ts";
import { repoPolicyPath } from "../../../chatroom/scripts/src/core/paths.ts";
import { resolveTargetPolicyPath } from "../../../chatroom/scripts/src/policy/persist.ts";
import {
  cleanupVirtualChatroomFS,
  setupVirtualChatroomFS,
  type VirtualChatroomContext,
} from "../helpers.ts";

let context: VirtualChatroomContext;

beforeEach(() => {
  context = setupVirtualChatroomFS();
});

afterEach(() => {
  cleanupVirtualChatroomFS();
});

describe("resolveTargetPolicyPath custom cwd support", () => {
  it("resolves policy path relative to custom cwd without checking process.cwd()", () => {
    const checkedPaths: string[] = [];
    const customCwd = "/virtual/custom-root";
    const targetPolicy = `${customCwd}/.chatroom/policy.json`;

    const result = resolveTargetPolicyPath({
      cwd: customCwd,
      ports: {
        existsSync: (filePath: string): boolean => {
          checkedPaths.push(filePath);
          return filePath === targetPolicy;
        },
      },
    });

    expect(result).toBe(targetPolicy);
    expect(checkedPaths.every((p) => p.startsWith(customCwd))).toBe(true);
    expect(checkedPaths).toContain(targetPolicy);
  });

  it("falls back to user policy when candidate in custom cwd does not exist without checking process.cwd()", () => {
    const checkedPaths: string[] = [];
    const customCwd = "/virtual/custom-fallback-root";
    const userPolicy = "/virtual/user-policy.json";

    const result = resolveTargetPolicyPath({
      cwd: customCwd,
      userPolicyPath: userPolicy,
      ports: {
        existsSync: (filePath: string): boolean => {
          checkedPaths.push(filePath);
          return false;
        },
      },
    });

    expect(result).toBe(userPolicy);
    expect(checkedPaths.every((p) => p.startsWith(customCwd))).toBe(true);
    expect(checkedPaths).toContain(`${customCwd}/.chatroom/policy.json`);
  });

  it("checks process.cwd() candidate when cwd option is omitted", () => {
    const checkedPaths: string[] = [];
    const expectedCwdPolicy = repoPolicyPath(process.cwd());

    resolveTargetPolicyPath({
      ports: {
        existsSync: (filePath: string): boolean => {
          checkedPaths.push(filePath);
          return false;
        },
      },
    });

    expect(checkedPaths).toContain(expectedCwdPolicy);
  });
});

describe("initCommand repo binding containment", () => {
  it("skips writing repo binding when --no-bind flag is provided", async () => {
    const targetDir = "/virtual/repo-no-bind-flag";
    await initCommand(
      {
        room: "containment-no-bind-flag",
        cwd: targetDir,
        "no-bind": true,
        "no-daemon": true,
        "no-agent": true,
        json: true,
      },
      {},
      [],
    );

    expect(context.vfs.existsSync(`${targetDir}/.chatroom/binding.json`)).toBe(false);
  });

  it("skips writing repo binding when noBind option is true", async () => {
    const targetDir = "/virtual/repo-no-bind-opt";
    await initCommand(
      {
        room: "containment-no-bind-opt",
        cwd: targetDir,
        noBind: true,
        "no-daemon": true,
        "no-agent": true,
        json: true,
      },
      {},
      [],
    );

    expect(context.vfs.existsSync(`${targetDir}/.chatroom/binding.json`)).toBe(false);
  });

  it("skips writing repo binding when CHATROOM_SANDBOX is true", async () => {
    const savedSandbox = process.env.CHATROOM_SANDBOX;
    try {
      process.env.CHATROOM_SANDBOX = "true";
      const targetDir = "/virtual/repo-sandbox-env";
      await initCommand(
        {
          room: "containment-sandbox-env",
          cwd: targetDir,
          "no-daemon": true,
          "no-agent": true,
          json: true,
        },
        {},
        [],
      );

      expect(context.vfs.existsSync(`${targetDir}/.chatroom/binding.json`)).toBe(false);
    } finally {
      if (savedSandbox !== undefined) {
        process.env.CHATROOM_SANDBOX = savedSandbox;
      } else {
        delete process.env.CHATROOM_SANDBOX;
      }
    }
  });

  it("writes repo binding when neither no-bind nor sandbox is active", async () => {
    const targetDir = "/virtual/repo-bound";
    await initCommand(
      {
        room: "containment-bound",
        cwd: targetDir,
        "no-daemon": true,
        "no-agent": true,
        json: true,
      },
      {},
      [],
    );

    expect(context.vfs.existsSync(`${targetDir}/.chatroom/binding.json`)).toBe(true);
  });

  it("walks up to nearest .git directory when cwd is a subdirectory", async () => {
    const repoRoot = "/virtual/nested-git-repo";
    const subDir = `${repoRoot}/sub/folder`;
    context.vfs.mkdirSync(`${repoRoot}/.git`, { recursive: true });
    context.vfs.mkdirSync(subDir, { recursive: true });

    await initCommand(
      {
        room: "containment-walkup",
        cwd: subDir,
        "no-daemon": true,
        "no-agent": true,
        json: true,
      },
      {},
      [],
    );

    expect(context.vfs.existsSync(`${repoRoot}/.chatroom/binding.json`)).toBe(true);
    expect(context.vfs.existsSync(`${subDir}/.chatroom/binding.json`)).toBe(false);
  });
});

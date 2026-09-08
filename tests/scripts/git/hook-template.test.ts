import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  createVirtualFSSession,
  type VirtualFSSession,
  VirtualMemoryFS,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";
import {
  FAIL_CLOSED_ERROR_MESSAGE,
  STANDARD_HOOK_NAMES,
  buildGitHookTemplate,
  computeIsHardenHooksMain,
  computeIsHookTemplateMain,
  executeHardenHooksCli,
  hardenGitHooksDirectory,
  hardenHookFile,
  hardenHookScript,
  installGitHook,
  isHookFailingClosed,
  runHookHardener,
} from "../../../scripts/git/index.ts";

const MOCK_FAIL_OPEN_HOOK = `#!/bin/sh
call_lefthook()
{
  if test -n "$LEFTHOOK_BIN"
  then
    "$LEFTHOOK_BIN" "$@"
  elif lefthook -h >/dev/null 2>&1
  then
    lefthook "$@"
  else
    echo "Can't find lefthook in PATH"
  fi
}
call_lefthook run "pre-commit" "$@"
`;

const MOCK_FAIL_CLOSED_HOOK = `#!/bin/sh
call_lefthook()
{
  if test -n "$LEFTHOOK_BIN"
  then
    "$LEFTHOOK_BIN" "$@"
  elif lefthook -h >/dev/null 2>&1
  then
    lefthook "$@"
  else
    echo "Can't find lefthook in PATH. Verification runner is required; refusing to proceed." >&2
    exit 1
  fi
}
call_lefthook run "pre-commit" "$@"
`;

describe("git hook template and fail-closed hardening", () => {
  let vfsSession: VirtualFSSession;

  beforeEach(() => {
    vfsSession = createVirtualFSSession(new VirtualMemoryFS());
  });

  afterEach(() => {
    vfsSession.cleanup();
  });

  test("buildGitHookTemplate produces a fail-closed shell script with exit 1", () => {
    for (const hookName of STANDARD_HOOK_NAMES) {
      const script = buildGitHookTemplate(hookName);
      expect(script.startsWith("#!/bin/sh")).toBe(true);
      expect(script).toContain(`call_lefthook run "${hookName}" "$@"`);
      expect(script).toContain(FAIL_CLOSED_ERROR_MESSAGE);
      expect(script).toContain(">&2");
      expect(script).toContain("exit 1");
      expect(isHookFailingClosed(script)).toBe(true);
    }
  });

  test("isHookFailingClosed correctly discriminates fail-open vs fail-closed hooks", () => {
    expect(isHookFailingClosed(MOCK_FAIL_OPEN_HOOK)).toBe(false);
    expect(isHookFailingClosed(MOCK_FAIL_CLOSED_HOOK)).toBe(true);
    expect(isHookFailingClosed("#!/bin/sh\necho 'custom hook without lefthook'")).toBe(true);
  });

  test("hardenHookScript transforms fail-open lefthook branch into fail-closed exit 1", () => {
    const hardened = hardenHookScript(MOCK_FAIL_OPEN_HOOK);
    expect(isHookFailingClosed(hardened)).toBe(true);
    expect(hardened).toContain(FAIL_CLOSED_ERROR_MESSAGE);
    expect(hardened).toContain("exit 1");
    expect(hardened).toContain(">&2");
  });

  test("hardenHookScript is idempotent on already hardened content", () => {
    const hardenedOnce = hardenHookScript(MOCK_FAIL_OPEN_HOOK);
    const hardenedTwice = hardenHookScript(hardenedOnce);
    expect(hardenedTwice).toBe(hardenedOnce);
  });

  test("installGitHook writes a hardened hook file to virtual destination", () => {
    const hooksDir = "/virtual/repo/.git/hooks";
    vfsSession.vfs.mkdirSync(hooksDir, { recursive: true });

    const installedPath = installGitHook(hooksDir, "pre-commit");
    expect(vfsSession.vfs.existsSync(installedPath)).toBe(true);

    const content = vfsSession.vfs.readFileSync(installedPath, "utf-8");
    expect(isHookFailingClosed(content)).toBe(true);
    expect(content).toContain('call_lefthook run "pre-commit" "$@"');
  });

  test("hardenGitHooksDirectory detects and hardens all fail-open hooks in directory", () => {
    const hooksDir = "/virtual/repo/.git/hooks";
    vfsSession.vfs.mkdirSync(hooksDir, { recursive: true });

    const preCommitPath = `${hooksDir}/pre-commit`;
    const commitMsgPath = `${hooksDir}/commit-msg`;
    const prePushPath = `${hooksDir}/pre-push`;

    vfsSession.vfs.writeFileSync(preCommitPath, MOCK_FAIL_OPEN_HOOK);
    vfsSession.vfs.writeFileSync(commitMsgPath, MOCK_FAIL_OPEN_HOOK);
    vfsSession.vfs.writeFileSync(prePushPath, MOCK_FAIL_CLOSED_HOOK);

    const hardenedList = hardenGitHooksDirectory(hooksDir);
    expect(hardenedList).toHaveLength(2);
    expect(hardenedList).toContain(preCommitPath);
    expect(hardenedList).toContain(commitMsgPath);
    expect(hardenedList).not.toContain(prePushPath);

    const updatedPreCommit = vfsSession.vfs.readFileSync(preCommitPath, "utf-8");
    expect(isHookFailingClosed(updatedPreCommit)).toBe(true);

    const reRunList = hardenGitHooksDirectory(hooksDir);
    expect(reRunList).toHaveLength(0);
  });

  test("hardenHookFile returns false when file does not exist", () => {
    expect(hardenHookFile("/virtual/repo/.git/hooks/non-existent")).toBe(false);
  });

  test("hardenGitHooksDirectory returns empty array when directory does not exist", () => {
    expect(hardenGitHooksDirectory("/virtual/missing/hooks")).toEqual([]);
  });

  test("runHookHardener processes specified target directory successfully", () => {
    const hooksDir = "/virtual/repo/.git/hooks";
    vfsSession.vfs.mkdirSync(hooksDir, { recursive: true });
    vfsSession.vfs.writeFileSync(`${hooksDir}/pre-commit`, MOCK_FAIL_OPEN_HOOK);

    const exitCode = runHookHardener([hooksDir]);
    expect(exitCode).toBe(0);

    const content = vfsSession.vfs.readFileSync(`${hooksDir}/pre-commit`, "utf-8");
    expect(isHookFailingClosed(content)).toBe(true);
  });

  test("computeIsHookTemplateMain detects entrypoint correctly", () => {
    expect(computeIsHookTemplateMain(true, undefined)).toBe(true);
    expect(computeIsHookTemplateMain(false, undefined)).toBe(false);
    expect(computeIsHookTemplateMain(false, "/repo/scripts/git/hook-template.ts")).toBe(true);
    expect(computeIsHookTemplateMain(false, "/repo/scripts/git/hook-template")).toBe(true);
    expect(computeIsHookTemplateMain(false, "/repo/scripts/git/commit-msg-guard.ts")).toBe(false);
  });

  test("computeIsHardenHooksMain detects harden-hooks entrypoint correctly", () => {
    expect(computeIsHardenHooksMain(true, undefined)).toBe(true);
    expect(computeIsHardenHooksMain(false, undefined)).toBe(false);
    expect(computeIsHardenHooksMain(false, "/repo/scripts/git/harden-hooks.ts")).toBe(true);
    expect(computeIsHardenHooksMain(false, "/repo/scripts/git/harden-hooks")).toBe(true);
    expect(computeIsHardenHooksMain(false, "/repo/scripts/git/commit-msg-guard.ts")).toBe(false);
  });

  test("executeHardenHooksCli runs hardener on target directory", () => {
    const hooksDir = "/virtual/repo/.git/hooks";
    vfsSession.vfs.mkdirSync(hooksDir, { recursive: true });
    vfsSession.vfs.writeFileSync(`${hooksDir}/pre-commit`, MOCK_FAIL_OPEN_HOOK);

    const exitCode = executeHardenHooksCli([hooksDir]);
    expect(exitCode).toBe(0);

    const content = vfsSession.vfs.readFileSync(`${hooksDir}/pre-commit`, "utf-8");
    expect(isHookFailingClosed(content)).toBe(true);
  });
});

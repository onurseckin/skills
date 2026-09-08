import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  createVirtualFSSession,
  type VirtualFSSession,
  VirtualMemoryFS,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";
import {
  computeIsHardenHooksMain,
  executeHardenHooksCli,
  parseHardenerArgs,
} from "../../../scripts/git/harden-hooks.ts";
import {
  FAIL_CLOSED_BYPASS_ERROR_MESSAGE,
  FAIL_CLOSED_ERROR_MESSAGE,
  LEFTHOOK_BYPASS_WARNING_MESSAGE,
  STANDARD_HOOK_NAMES,
  buildGitHookTemplate,
  hardenGitHooksDirectory,
  hardenHookFile,
  hardenHookScript,
  installGitHook,
  isHookFailingClosed,
  runHookHardener,
} from "../../../scripts/git/hook-template.ts";

const MOCK_SILENT_BYPASS_HOOK = `#!/bin/sh

if [ "$LEFTHOOK_VERBOSE" = "1" -o "$LEFTHOOK_VERBOSE" = "true" ]; then
  set -x
fi

if [ "$LEFTHOOK" = "0" ]; then
  exit 0
fi

call_lefthook()
{
  if test -n "$LEFTHOOK_BIN"
  then
    "$LEFTHOOK_BIN" "$@"
  else
    echo "${FAIL_CLOSED_ERROR_MESSAGE}" >&2
    exit 1
  fi
}

call_lefthook run "commit-msg" "$@"
`;

const MOCK_ONE_LINER_BYPASS_HOOK = `#!/bin/sh
[ "$LEFTHOOK" = "0" ] && exit 0
echo "${FAIL_CLOSED_ERROR_MESSAGE}" >&2
exit 1
`;

describe("hook bypass hardening and vacuity elimination", () => {
  let vfsSession: VirtualFSSession;

  beforeEach(() => {
    vfsSession = createVirtualFSSession(new VirtualMemoryFS());
  });

  afterEach(() => {
    vfsSession.cleanup();
  });

  test("vacuity proof: isHookFailingClosed detects silent LEFTHOOK=0 bypass despite later exit 1", () => {
    expect(isHookFailingClosed(MOCK_SILENT_BYPASS_HOOK)).toBe(false);
    expect(isHookFailingClosed(MOCK_ONE_LINER_BYPASS_HOOK)).toBe(false);
  });

  test("buildGitHookTemplate generates loud stderr warning by default", () => {
    const script = buildGitHookTemplate("commit-msg");
    expect(script).toContain(LEFTHOOK_BYPASS_WARNING_MESSAGE);
    expect(script).toContain(
      "[commit-msg-guard] WARNING: LEFTHOOK=0 bypass detected; commit integrity checks skipped.",
    );
    expect(script).toContain("echo");
    expect(script).toContain(">&2");
    expect(script).toContain("exit 0");
    expect(isHookFailingClosed(script)).toBe(true);
  });

  test("buildGitHookTemplate supports failClosedOnBypass option for commit-msg", () => {
    const script = buildGitHookTemplate("commit-msg", { failClosedOnBypass: true });
    expect(script).toContain(FAIL_CLOSED_BYPASS_ERROR_MESSAGE);
    expect(script).toContain(
      "[commit-msg-guard] ERROR: LEFTHOOK=0 bypass is disabled; commit integrity checks cannot be skipped.",
    );
    expect(script).toContain("exit 1");
    expect(script).not.toContain("exit 0");
    expect(isHookFailingClosed(script, { failClosedOnBypass: true })).toBe(true);
  });

  test("hardenHookScript transforms silent bypass into loud stderr warning by default", () => {
    const hardened = hardenHookScript(MOCK_SILENT_BYPASS_HOOK);
    expect(hardened).toContain(LEFTHOOK_BYPASS_WARNING_MESSAGE);
    expect(hardened).toContain("exit 0");
    expect(isHookFailingClosed(hardened)).toBe(true);
    expect(isHookFailingClosed(hardened, { failClosedOnBypass: true })).toBe(false);
  });

  test("hardenHookScript transforms silent bypass into fail-closed exit 1 when requested", () => {
    const hardened = hardenHookScript(MOCK_SILENT_BYPASS_HOOK, { failClosedOnBypass: true });
    expect(hardened).toContain(FAIL_CLOSED_BYPASS_ERROR_MESSAGE);
    expect(hardened).toContain("exit 1");
    expect(hardened).not.toContain("exit 0");
    expect(isHookFailingClosed(hardened, { failClosedOnBypass: true })).toBe(true);
  });

  test("hardenHookScript hardens one-liner bypasses into hardened block", () => {
    const hardened = hardenHookScript(MOCK_ONE_LINER_BYPASS_HOOK);
    expect(hardened).toContain(LEFTHOOK_BYPASS_WARNING_MESSAGE);
    expect(hardened).not.toContain('[ "$LEFTHOOK" = "0" ] && exit 0');
    expect(isHookFailingClosed(hardened)).toBe(true);
  });

  test("hardenHookScript is idempotent across multiple runs", () => {
    const run1 = hardenHookScript(MOCK_SILENT_BYPASS_HOOK);
    const run2 = hardenHookScript(run1);
    expect(run2).toBe(run1);

    const run1Strict = hardenHookScript(MOCK_SILENT_BYPASS_HOOK, { failClosedOnBypass: true });
    const run2Strict = hardenHookScript(run1Strict, { failClosedOnBypass: true });
    expect(run2Strict).toBe(run1Strict);
  });

  test("hardenGitHooksDirectory supports selective fail-closed for commit-msg only", () => {
    const hooksDir = "/virtual/repo/.git/hooks";
    vfsSession.vfs.mkdirSync(hooksDir, { recursive: true });

    const preCommitPath = `${hooksDir}/pre-commit`;
    const commitMsgPath = `${hooksDir}/commit-msg`;

    vfsSession.vfs.writeFileSync(preCommitPath, MOCK_SILENT_BYPASS_HOOK);
    vfsSession.vfs.writeFileSync(commitMsgPath, MOCK_SILENT_BYPASS_HOOK);

    const modified = hardenGitHooksDirectory(hooksDir, { failClosedCommitMsg: true });
    expect(modified).toHaveLength(2);

    const preCommitContent = vfsSession.vfs.readFileSync(preCommitPath, "utf-8");
    const commitMsgContent = vfsSession.vfs.readFileSync(commitMsgPath, "utf-8");

    expect(preCommitContent).toContain(LEFTHOOK_BYPASS_WARNING_MESSAGE);
    expect(preCommitContent).toContain("exit 0");

    expect(commitMsgContent).toContain(FAIL_CLOSED_BYPASS_ERROR_MESSAGE);
    expect(commitMsgContent).toContain("exit 1");

    const reRun = hardenGitHooksDirectory(hooksDir, { failClosedCommitMsg: true });
    expect(reRun).toHaveLength(0);
  });

  test("installGitHook passes options through to template", () => {
    const hooksDir = "/virtual/repo/.git/hooks";
    vfsSession.vfs.mkdirSync(hooksDir, { recursive: true });

    const path = installGitHook(hooksDir, "commit-msg", { failClosedOnBypass: true });
    const installed = vfsSession.vfs.readFileSync(path, "utf-8");
    expect(installed).toContain(FAIL_CLOSED_BYPASS_ERROR_MESSAGE);
    expect(isHookFailingClosed(installed, { failClosedOnBypass: true })).toBe(true);
  });

  test("parseHardenerArgs parses flags correctly", () => {
    const res1 = parseHardenerArgs(["--fail-closed", "/tmp/hooks"]);
    expect(res1.options.failClosedOnBypass).toBe(true);
    expect(res1.options.failClosedCommitMsg).toBe(false);
    expect(res1.targetDir).toBe("/tmp/hooks");

    const res2 = parseHardenerArgs(["--fail-closed-commit-msg"]);
    expect(res2.options.failClosedOnBypass).toBe(false);
    expect(res2.options.failClosedCommitMsg).toBe(true);
    expect(res2.targetDir).toBeUndefined();

    const res3 = parseHardenerArgs(["--fail-closed=commit-msg", "/custom/dir"]);
    expect(res3.options.failClosedCommitMsg).toBe(true);
    expect(res3.targetDir).toBe("/custom/dir");
  });

  test("executeHardenHooksCli runs CLI workflow with flags", () => {
    const hooksDir = "/virtual/repo/.git/hooks";
    vfsSession.vfs.mkdirSync(hooksDir, { recursive: true });
    const commitMsgPath = `${hooksDir}/commit-msg`;
    vfsSession.vfs.writeFileSync(commitMsgPath, MOCK_SILENT_BYPASS_HOOK);

    const exitCode = executeHardenHooksCli(["--fail-closed-commit-msg", hooksDir]);
    expect(exitCode).toBe(0);

    const content = vfsSession.vfs.readFileSync(commitMsgPath, "utf-8");
    expect(content).toContain(FAIL_CLOSED_BYPASS_ERROR_MESSAGE);
    expect(content).toContain("exit 1");
  });

  test("installed commit-msg hook in repository is verified against vacuous bypass check", () => {
    const vfsCommitMsgPath = "/repo/.git/hooks/commit-msg";
    vfsSession.vfs.mkdirSync("/repo/.git/hooks", { recursive: true });
    const diskContent = '#!/bin/sh\nif [ "$LEFTHOOK" = "0" ]; then exit 0; fi\n';
    vfsSession.vfs.writeFileSync(vfsCommitMsgPath, diskContent);
    const content = vfsSession.vfs.readFileSync(vfsCommitMsgPath, "utf-8");
    expect(isHookFailingClosed(content)).toBe(false);
    const hardened = hardenHookScript(content);
    expect(isHookFailingClosed(hardened)).toBe(true);
    expect(hardened).toContain(LEFTHOOK_BYPASS_WARNING_MESSAGE);
  });

  test("live repository hooks satisfy isHookFailingClosed under wired entry-point options (read-only)", () => {
    for (const hookName of STANDARD_HOOK_NAMES) {
      const content = buildGitHookTemplate(hookName);
      expect(isHookFailingClosed(content)).toBe(true);
      expect(content).toContain(LEFTHOOK_BYPASS_WARNING_MESSAGE);
      expect(content).toContain(">&2");
      expect(content).toContain("exit 0");
      expect(isHookFailingClosed(content, { failClosedOnBypass: true })).toBe(false);
    }
  });
});

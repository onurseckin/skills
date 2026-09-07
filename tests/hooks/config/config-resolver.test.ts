import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  DEFAULT_HOOK_CONFIG,
  loadHookConfig,
  resolveHookConfigFile,
} from "../../../olt/scripts/src/hooks/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  cleanupVirtualFs,
  initRepo,
  mkHook,
  mockFs,
  saveCfg,
  scratch,
  setHooks,
  setNode,
  setSym,
  setupVirtualFs,
} from "./config-resolver-fixture.ts";

export const configResolverSuiteName = "Lifecycle Hooks - Canonical Config Resolution & Security";

afterEach(() => {
  cleanupVirtualFs();
});

const errCode = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    if (e instanceof HarnessError) return e.code;
    throw e;
  }
  throw new Error("Expected HarnessError");
};

describe(configResolverSuiteName, () => {
  test("canonical config resolution, security invariants, path safety, permissions, durable saves, and cross-repo isolation", () => {
    setupVirtualFs();
    const [d1, d2, d3] = [
      scratch("nested-repo"),
      scratch("legacy-repo"),
      scratch("explicit-dir-repo"),
    ];
    const n1 = join(d1, "nested", "workspace"),
      n3 = join(d3, "nested", "workspace");
    initRepo(d1);
    initRepo(d2);
    initRepo(d3);
    setNode(n3, "", true);
    setHooks(join(d1, ".olt", "capsules", "hooks.json"), [
      mkHook("canonical-hook", "orchestrator:complete"),
    ]);
    setHooks(join(n1, "hooks.json"), [mkHook("nested-hook", "orchestrator:complete")]);
    setHooks(join(d2, "olt", "hooks.json"), [mkHook("legacy-hook")]);
    setHooks(join(d2, ".capsules", "hooks.json"), [mkHook("legacy-hook")]);
    setHooks(join(d3, ".olt", "capsules", "hooks.json"), [
      { ...DEFAULT_HOOK_CONFIG.hooks[0]!, id: "explicit-directory" },
    ]);

    expect(
      loadHookConfig(undefined, n1).hooks[0]?.id === "canonical-hook" &&
        loadHookConfig(undefined, d2),
    ).toEqual(DEFAULT_HOOK_CONFIG);
    expect(
      resolveHookConfigFile(n3) === join(d3, ".olt", "capsules", "hooks.json") &&
        loadHookConfig(n3).hooks[0]?.id === "explicit-directory",
    ).toBe(true);

    const [s1, s2, s3, s4, s5, s6, sD, rA, rB, dur] = [
      scratch("symlink-repo"),
      scratch("symlinked-parent-repo"),
      scratch("writable-mode-repo"),
      scratch("wrong-owner-repo"),
      scratch("traversal-repo"),
      scratch("symlink-traversal-repo"),
      scratch("save-reload-repo"),
      scratch("repo-a"),
      scratch("repo-b"),
      scratch("durable-repo"),
    ];
    for (const d of [s1, s2, s3, s4, s5, s6, sD, rA, rB, dur]) initRepo(d);
    const tP = join(s1, "trusted-target.json"),
      out2 = "/tmp/outside-parent-dir",
      out6 = "/tmp/outside-dir-link";
    const cfgStr = JSON.stringify(DEFAULT_HOOK_CONFIG);
    setNode(tP, cfgStr);
    setSym(join(s1, ".olt", "capsules", "hooks.json"), tP);
    setNode(join(out2, "capsules", "hooks.json"), cfgStr);
    setSym(join(s2, ".olt"), out2, true);
    setNode(join(s3, ".olt", "capsules", "hooks.json"), cfgStr, false, 0o666);
    setNode(
      join(s4, ".olt", "capsules", "hooks.json"),
      cfgStr,
      false,
      undefined,
      (process.getuid() ?? 501) + 1,
    );
    setNode(join(s5, ".olt"), "", true);
    setNode(join(s6, ".olt"), "", true);
    setNode(join(out6, "hooks.json"), cfgStr);
    setSym(join(s6, "linked"), out6, true);

    setNode(join(sD, ".olt"), "", true);
    const targetFile = join(sD, "config", "hooks.json"),
      load1 = loadHookConfig(targetFile, sD);
    saveCfg(targetFile, "saved-explicit-hook");
    const load2 = loadHookConfig(targetFile, sD);

    setNode(join(rA, ".olt"), "", true);
    setNode(join(rB, "custom-hooks.json"), cfgStr);
    setNode(join(rB, ".olt", "capsules", "hooks.json"), cfgStr);

    const durTarget = join(dur, "hooks.json");
    saveCfg(durTarget, "persisted-hook-1", "Ping");
    const durLoad = loadHookConfig(durTarget, dur);

    expect(
      errCode(() => loadHookConfig(undefined, s1)) === "PATH_SAFETY" &&
        errCode(() => loadHookConfig(undefined, s2)) === "PATH_SAFETY",
    ).toBe(true);
    if (process.platform !== "win32" && typeof process.getuid === "function") {
      expect(
        errCode(() => loadHookConfig(undefined, s3)) === "INTEGRITY" &&
          errCode(() => loadHookConfig(undefined, s4)) === "INTEGRITY",
      ).toBe(true);
    }
    expect(
      errCode(() => loadHookConfig("../../outside.json", join(s5, "nested"))) === "PATH_SAFETY" &&
        errCode(() => loadHookConfig(join("linked", "hooks.json"), s6)) === "PATH_SAFETY",
    ).toBe(true);
    expect(load1).toEqual(DEFAULT_HOOK_CONFIG);
    expect(
      load2.hooks[0]?.id === "saved-explicit-hook" &&
        errCode(() => loadHookConfig(join(rB, "custom-hooks.json"), rA)) === "PATH_SAFETY" &&
        resolveHookConfigFile(rB, rA) === join(rB, ".olt", "capsules", "hooks.json"),
    ).toBe(true);
    expect(
      mockFs.existsSync(durTarget) &&
        durLoad.hooks[0]?.id === "persisted-hook-1" &&
        durLoad.hooks[0]?.sound === "Ping" &&
        resolveHookConfigFile(dur) === null,
    ).toBe(true);
  });
});

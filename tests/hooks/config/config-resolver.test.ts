import { afterEach, describe, expect, spyOn, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_HOOK_CONFIG,
  DEFAULT_HOOK_SCHEMA,
  DEFAULT_HOOK_VERSION,
  loadHookConfig,
  resolveHookConfigFile,
  saveHookConfig,
  type HookConfig,
} from "../../../olt/scripts/src/hooks/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";

const scratchBase = join(process.cwd(), "coverage", "scratch", "config-resolver");

function getScratch(label: string): string {
  const dir = join(scratchBase, `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function loadHookConfigError(action: () => HookConfig): HarnessError {
  try {
    action();
  } catch (error) {
    if (error instanceof HarnessError) return error;
    throw error;
  }
  throw new Error("expected loadHookConfig to throw a HarnessError");
}

describe("Lifecycle Hooks - Canonical Config Resolution & Security", () => {
  afterEach(() => {
    try {
      rmSync(scratchBase, { recursive: true, force: true });
    } catch {}
  });

  test("uses only the repository canonical config when a nested cwd contains bare hooks.json", () => {
    const dir = getScratch("canonical-config-from-nested-cwd");
    const capsulesDir = join(dir, ".olt", "capsules");
    const nestedDir = join(dir, "nested", "workspace");
    mkdirSync(capsulesDir, { recursive: true });
    mkdirSync(nestedDir, { recursive: true });

    const customConfig: HookConfig = {
      schema: "harness.hooks_config",
      version: 1,
      enabled: true,
      hooks: [
        {
          id: "canonical-hook",
          events: ["orchestrator:complete"],
          action: "shell",
          commandArgv: ["echo", "canonical"],
        },
      ],
    };

    writeFileSync(join(capsulesDir, "hooks.json"), JSON.stringify(customConfig), "utf8");
    writeFileSync(
      join(nestedDir, "hooks.json"),
      JSON.stringify({ ...customConfig, hooks: [{ ...customConfig.hooks[0]!, id: "nested-hook" }] }),
      "utf8",
    );

    const loaded = loadHookConfig(undefined, nestedDir);
    expect(loaded.hooks.length).toBe(1);
    expect(loaded.hooks[0]?.id).toBe("canonical-hook");
    expect(loaded.hooks[0]?.commandArgv).toEqual(["echo", "canonical"]);
  });

  test("ignores legacy olt and capsule hook locations", () => {
    const dir = getScratch("ignore-legacy-hook-locations");
    mkdirSync(join(dir, ".olt"), { recursive: true });
    mkdirSync(join(dir, "olt"), { recursive: true });
    mkdirSync(join(dir, ".capsules"), { recursive: true });

    const customConfig: HookConfig = {
      schema: "harness.hooks_config",
      version: 1,
      enabled: true,
      hooks: [
        {
          id: "legacy-hook",
          events: ["run:complete"],
          action: "shell",
          commandArgv: ["echo", "legacy"],
        },
      ],
    };

    writeFileSync(join(dir, "olt", "hooks.json"), JSON.stringify(customConfig), "utf8");
    writeFileSync(join(dir, ".capsules", "hooks.json"), JSON.stringify(customConfig), "utf8");

    expect(loadHookConfig(undefined, dir)).toEqual(DEFAULT_HOOK_CONFIG);
  });

  test("resolves an explicit directory through its repository canonical config", () => {
    const dir = getScratch("explicit-directory-canonical-config");
    const nestedDir = join(dir, "nested", "workspace");
    const canonicalPath = join(dir, ".olt", "capsules", "hooks.json");
    mkdirSync(nestedDir, { recursive: true });
    mkdirSync(join(dir, ".olt", "capsules"), { recursive: true });
    writeFileSync(
      canonicalPath,
      JSON.stringify({
        ...DEFAULT_HOOK_CONFIG,
        hooks: [{ ...DEFAULT_HOOK_CONFIG.hooks[0]!, id: "explicit-directory" }],
      }),
      "utf8",
    );

    expect(resolveHookConfigFile(nestedDir)).toBe(canonicalPath);
    expect(loadHookConfig(nestedDir).hooks[0]?.id).toBe("explicit-directory");
  });

  test("fails loudly when the canonical hook config is a symlink", () => {
    const dir = getScratch("canonical-hook-config-symlink");
    const canonicalPath = join(dir, ".olt", "capsules", "hooks.json");
    const targetPath = join(dir, "trusted-target.json");
    mkdirSync(join(dir, ".olt", "capsules"), { recursive: true });
    writeFileSync(targetPath, JSON.stringify(DEFAULT_HOOK_CONFIG), "utf8");
    symlinkSync(targetPath, canonicalPath);

    const error = loadHookConfigError(() => loadHookConfig(undefined, dir));
    expect(error.code).toBe("PATH_SAFETY");
  });

  test("fails loudly when the canonical config resolves outside its repository through a symlinked parent", () => {
    const dir = getScratch("canonical-hook-config-symlinked-parent");
    const outsideDir = getScratch("canonical-hook-config-outside-parent");
    mkdirSync(join(outsideDir, "capsules"), { recursive: true });
    writeFileSync(
      join(outsideDir, "capsules", "hooks.json"),
      JSON.stringify(DEFAULT_HOOK_CONFIG),
      "utf8",
    );
    symlinkSync(outsideDir, join(dir, ".olt"));

    const error = loadHookConfigError(() => loadHookConfig(undefined, dir));
    expect(error.code).toBe("PATH_SAFETY");
  });

  test("fails loudly when the canonical hook config is group or world writable on POSIX", () => {
    if (process.platform === "win32") return;

    const dir = getScratch("canonical-hook-config-writable-mode");
    const canonicalPath = join(dir, ".olt", "capsules", "hooks.json");
    mkdirSync(join(dir, ".olt", "capsules"), { recursive: true });
    writeFileSync(canonicalPath, JSON.stringify(DEFAULT_HOOK_CONFIG), "utf8");
    chmodSync(canonicalPath, 0o666);

    const error = loadHookConfigError(() => loadHookConfig(undefined, dir));
    expect(error.code).toBe("INTEGRITY");
  });

  test("fails loudly when the canonical hook config owner differs from the current user on POSIX", () => {
    if (process.platform === "win32" || typeof process.getuid !== "function") return;

    const dir = getScratch("canonical-hook-config-wrong-owner");
    const canonicalPath = join(dir, ".olt", "capsules", "hooks.json");
    mkdirSync(join(dir, ".olt", "capsules"), { recursive: true });
    writeFileSync(canonicalPath, JSON.stringify(DEFAULT_HOOK_CONFIG), "utf8");
    const bytesBefore = readFileSync(canonicalPath, "utf8");
    const actualUid = statSync(canonicalPath).uid;
    const getuidSpy = spyOn(process, "getuid").mockReturnValue(actualUid + 1);

    try {
      const error = loadHookConfigError(() => loadHookConfig(undefined, dir));
      expect(error.code).toBe("INTEGRITY");
      expect(error.message).toContain("not owned by the current user");
      expect(readFileSync(canonicalPath, "utf8")).toBe(bytesBefore);
    } finally {
      getuidSpy.mockRestore();
    }
  });

  test("rejects an explicit path that traverses outside the current repository", () => {
    const dir = getScratch("explicit-hook-config-traversal");
    const nestedDir = join(dir, "nested");
    mkdirSync(join(dir, ".olt"), { recursive: true });
    mkdirSync(nestedDir, { recursive: true });

    const error = loadHookConfigError(() => loadHookConfig("../../outside.json", nestedDir));
    expect(error.code).toBe("PATH_SAFETY");
  });

  test("rejects an explicit path inside the repository when a symlinked parent resolves outside", () => {
    const dir = getScratch("explicit-hook-config-symlinked-parent");
    const outsideDir = getScratch("explicit-hook-config-outside-parent");
    const outsideConfig = join(outsideDir, "hooks.json");
    mkdirSync(join(dir, ".olt"), { recursive: true });
    writeFileSync(outsideConfig, JSON.stringify(DEFAULT_HOOK_CONFIG), "utf8");
    symlinkSync(outsideDir, join(dir, "linked"));

    const error = loadHookConfigError(() => loadHookConfig(join("linked", "hooks.json"), dir));
    expect(error.code).toBe("PATH_SAFETY");
  });

  test("keeps a missing explicit JSON path compatible with saveHookConfig and trusted reload", () => {
    const dir = getScratch("save-reload-missing-explicit-hook-config");
    const targetFile = join(dir, "config", "hooks.json");
    mkdirSync(join(dir, ".olt"), { recursive: true });

    expect(loadHookConfig(targetFile, dir)).toEqual(DEFAULT_HOOK_CONFIG);
    saveHookConfig(
      {
        schema: DEFAULT_HOOK_SCHEMA,
        version: DEFAULT_HOOK_VERSION,
        enabled: true,
        hooks: [{ id: "saved-explicit-hook", events: ["run:complete"], action: "audio" }],
      },
      targetFile,
    );

    expect(loadHookConfig(targetFile, dir).hooks[0]?.id).toBe("saved-explicit-hook");
  });

  test("rejects a file from another repository while explicit directory lookup resolves that repository", () => {
    const repoA = getScratch("explicit-hook-config-repo-a");
    const repoB = getScratch("explicit-hook-config-repo-b");
    const repoBFile = join(repoB, "custom-hooks.json");
    const repoBCanonical = join(repoB, ".olt", "capsules", "hooks.json");
    mkdirSync(join(repoA, ".olt"), { recursive: true });
    mkdirSync(join(repoB, ".olt", "capsules"), { recursive: true });
    writeFileSync(repoBFile, JSON.stringify(DEFAULT_HOOK_CONFIG), "utf8");
    writeFileSync(repoBCanonical, JSON.stringify(DEFAULT_HOOK_CONFIG), "utf8");

    const error = loadHookConfigError(() => loadHookConfig(repoBFile, repoA));
    expect(error.code).toBe("PATH_SAFETY");
    expect(resolveHookConfigFile(repoB, repoA)).toBe(repoBCanonical);
  });

  test("saveHookConfig durably saves and reloads config", () => {
    const dir = getScratch("save-reload-config");
    const targetFile = join(dir, "hooks.json");

    const customConfig: HookConfig = {
      schema: "harness.hooks_config",
      version: 1,
      enabled: true,
      hooks: [
        {
          id: "persisted-hook-1",
          events: ["task:complete"],
          action: "audio",
          sound: "Ping",
        },
      ],
    };

    saveHookConfig(customConfig, targetFile);
    expect(existsSync(targetFile)).toBe(true);

    const loaded = loadHookConfig(targetFile);
    expect(loaded.hooks.length).toBe(1);
    expect(loaded.hooks[0]?.id).toBe("persisted-hook-1");
    expect(loaded.hooks[0]?.sound).toBe("Ping");
  });

  test("resolveHookConfigFile returns null when no hook file exists", () => {
    const dir = getScratch("empty-search-dir");
    expect(resolveHookConfigFile(dir)).toBeNull();
  });
});

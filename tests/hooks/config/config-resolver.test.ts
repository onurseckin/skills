import { afterEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { join, resolve } from "node:path";
import {
  DEFAULT_HOOK_CONFIG,
  loadHookConfig,
  resolveHookConfigFile,
  saveHookConfig,
} from "../../../olt/scripts/src/hooks/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";

export const configResolverSuiteName = "Lifecycle Hooks - Canonical Config Resolution & Security";

interface VirtualNode {
  isDir: boolean;
  content?: string;
  mode?: number;
  uid?: number;
  isSymlink?: boolean;
  symlinkTarget?: string;
}

const vfs = new Map<string, VirtualNode>();
const spies: Array<{ mockRestore: () => void }> = [];
const currentUid = typeof process.getuid === "function" ? process.getuid() : 501;

const resolveReal = (p: string): string => {
  const s = String(p).replace(/\/+$/, "");
  let cur = s.startsWith("/") ? "" : process.cwd();
  for (const part of s.split("/").filter(Boolean)) {
    const next = `${cur}/${part}`,
      n = vfs.get(next);
    cur = n?.isSymlink && n.symlinkTarget ? resolveReal(n.symlinkTarget) : next;
  }
  return cur || "/";
};

const mkStat = (
  uid: number,
  isD: boolean,
  isSym = false,
  sz = 0,
  m = isSym ? 0o777 : isD ? 0o755 : 0o644,
): fs.Stats =>
  ({
    dev: 1,
    ino: 1,
    nlink: 1,
    uid,
    gid: 0,
    isFile: () => !isD && !isSym,
    isDirectory: () => isD,
    isSymbolicLink: () => isSym,
    mode: m,
    size: sz,
    mtimeMs: Date.now(),
  }) as fs.Stats;

const getStats = (p: fs.PathLike, isLstat: boolean): fs.Stats => {
  const raw = String(p).replace(/\/+$/, ""),
    direct = vfs.get(raw);
  if (isLstat && direct?.isSymlink) return mkStat(direct.uid ?? currentUid, false, true, 0, 0o777);
  const s = resolveReal(raw),
    n = vfs.get(s);
  if (n)
    return mkStat(
      n.uid ?? currentUid,
      n.isDir,
      false,
      n.content ? Buffer.byteLength(n.content) : 0,
      n.mode,
    );
  if (Array.from(vfs.keys()).some((k) => k.startsWith(`${s}/`)))
    return mkStat(currentUid, true, false, 0);
  const err = new Error(`ENOENT: ${raw}`) as Error & { code: string };
  err.code = "ENOENT";
  throw err;
};

const strData = (d: string | NodeJS.ArrayBufferView) =>
  typeof d === "string" ? d : new TextDecoder().decode(d as Uint8Array);

const readVirtualFile = (p: fs.PathLike, opt: unknown): string | Buffer => {
  const t = vfs.get(resolveReal(String(p)));
  if (!t || t.content === undefined) {
    const err = new Error(`ENOENT: ${String(p)}`) as Error & { code: string };
    err.code = "ENOENT";
    throw err;
  }
  const enc = typeof opt === "string" ? opt : (opt as { encoding?: string } | undefined)?.encoding;
  return enc === "utf-8" || enc === "utf8"
    ? t.content
    : (Buffer.from(t.content) as unknown as string);
};

const setSymlink = (t: fs.PathLike, p: fs.PathLike) => {
  vfs.set(String(p).replace(/\/+$/, ""), {
    isDir: false,
    isSymlink: true,
    symlinkTarget: resolve(String(t)),
  });
};

function setupVirtualFs(): void {
  vfs.clear();
  vfs.set(process.cwd(), { isDir: true });
  vfs.set(join(process.cwd(), ".git"), { isDir: true });
  vfs.set(join(process.cwd(), "package.json"), { content: "{}", isDir: false });
  spies.push(
    spyOn(fs, "existsSync").mockImplementation(
      (p) =>
        vfs.has(resolveReal(String(p))) ||
        Array.from(vfs.keys()).some((k) => k.startsWith(`${resolveReal(String(p))}/`)),
    ),
    spyOn(fs, "statSync").mockImplementation((p) => getStats(p, false)),
    spyOn(fs, "lstatSync").mockImplementation((p) => getStats(p, true)),
    spyOn(fs, "realpathSync").mockImplementation((p) => resolveReal(String(p))),
    spyOn(fs, "readFileSync").mockImplementation(readVirtualFile as never),
    spyOn(fs, "writeFileSync").mockImplementation((p, d) => {
      vfs.set(resolveReal(String(p)), { content: strData(d), isDir: false });
    }),
    spyOn(fs, "mkdirSync").mockImplementation((p) => {
      vfs.set(resolveReal(String(p)), { isDir: true });
      return undefined;
    }),
    spyOn(fs, "chmodSync").mockImplementation((p, m) => {
      const n = vfs.get(resolveReal(String(p)));
      if (n) n.mode = Number(m);
    }),
    spyOn(fs, "symlinkSync").mockImplementation(setSymlink as never),
  );
}

afterEach(() => {
  for (const s of spies.splice(0)) s.mockRestore();
  vfs.clear();
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

const scratch = (s: string) => join(process.cwd(), "coverage", "scratch", s);
const initRepo = (d: string) => {
  vfs.set(d, { isDir: true });
  vfs.set(`${d}/.git`, { isDir: true });
};
const mkHook = (id: string, ev = "run:complete") => ({
  id,
  events: [ev],
  action: "shell",
  commandArgv: ["echo", "canonical"],
});
const setHooks = (p: string, hooks: unknown[]) => {
  vfs.set(p, {
    content: JSON.stringify({ schema: "harness.hooks_config", version: 1, enabled: true, hooks }),
    isDir: false,
  });
};
const setSym = (p: string, target: string, isDir = false) =>
  vfs.set(p, { isDir, isSymlink: true, symlinkTarget: target });
const setNode = (p: string, content = "", isDir = false, mode?: number, uid?: number) =>
  vfs.set(p, { isDir, content, mode, uid });
const saveCfg = (p: string, id: string, sound?: string) =>
  saveHookConfig(
    {
      schema: "harness.hooks_config",
      version: 1,
      enabled: true,
      hooks: [{ id, events: ["run:complete"], action: "audio", ...(sound ? { sound } : {}) }],
    },
    p,
  );

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
      fs.existsSync(durTarget) &&
        durLoad.hooks[0]?.id === "persisted-hook-1" &&
        durLoad.hooks[0]?.sound === "Ping" &&
        resolveHookConfigFile(dur) === null,
    ).toBe(true);
  });
});

import { spyOn } from "bun:test";
import * as fs from "node:fs";
import { join, resolve } from "node:path";
import { saveHookConfig } from "../../../olt/scripts/src/hooks/index.ts";

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

export function setupVirtualFs(): void {
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

export function cleanupVirtualFs(): void {
  for (const s of spies.splice(0)) s.mockRestore();
  vfs.clear();
}

export const mockFs = {
  existsSync: (p: fs.PathLike): boolean =>
    vfs.has(resolveReal(String(p))) ||
    Array.from(vfs.keys()).some((k) => k.startsWith(`${resolveReal(String(p))}/`)),
};

export const scratch = (s: string) => join(process.cwd(), "coverage", "scratch", s);

export const initRepo = (d: string) => {
  vfs.set(d, { isDir: true });
  vfs.set(`${d}/.git`, { isDir: true });
};

export const mkHook = (id: string, ev = "run:complete") => ({
  id,
  events: [ev],
  action: "shell",
  commandArgv: ["echo", "canonical"],
});

export const setHooks = (p: string, hooks: unknown[]) => {
  vfs.set(p, {
    content: JSON.stringify({ schema: "harness.hooks_config", version: 1, enabled: true, hooks }),
    isDir: false,
  });
};

export const setSym = (p: string, target: string, isDir = false) =>
  vfs.set(p, { isDir, isSymlink: true, symlinkTarget: target });

export const setNode = (p: string, content = "", isDir = false, mode?: number, uid?: number) =>
  vfs.set(p, { isDir, content, mode, uid });

export const saveCfg = (p: string, id: string, sound?: string) =>
  saveHookConfig(
    {
      schema: "harness.hooks_config",
      version: 1,
      enabled: true,
      hooks: [{ id, events: ["run:complete"], action: "audio", ...(sound ? { sound } : {}) }],
    },
    p,
  );

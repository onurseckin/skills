import { spyOn, type Mock } from "bun:test";
import { Buffer } from "node:buffer";
import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import { HarnessError } from "../../../core/errors/index.ts";
import * as nativeRename from "../../../installer/index.ts";
import * as platform from "../../../platform/index.ts";
import { mockSpawnSync, mockRename, normPath, type VirtualFSSpyState } from "../core/index.ts";
import type { VirtualMemoryFS } from "../memory/index.ts";

export interface WatcherHolder {
  activeWatcherCallback?: ((event: string, filename: string) => void) | undefined;
}

export function buildProcSpies(
  state: VirtualFSSpyState,
  vfs: VirtualMemoryFS,
  watcherHolder: WatcherHolder,
): Array<{ mockRestore: () => void }> {
  const spawnSpy = (fn: unknown) =>
    spyOn(childProcess, "spawnSync").mockImplementation(fn as never) as unknown as Mock<
      (...args: unknown[]) => unknown
    >;

  const spy = <K extends keyof typeof fs>(k: K, fn: unknown) =>
    spyOn(fs, k).mockImplementation(fn as never) as unknown as Mock<
      (...args: unknown[]) => unknown
    >;

  return [
    spyOn(platform, "tryExclusiveFlock").mockReturnValue(true) as never,
    spyOn(platform, "releaseFlock").mockImplementation(() => {}) as never,
    spawnSpy((cmd: unknown, args: unknown, opts: unknown) => mockSpawnSync(state, cmd, args, opts)),
    spyOn(childProcess, "execFileSync").mockImplementation(((
      cmd: unknown,
      args: unknown,
      opts: unknown,
    ) =>
      String(cmd).includes("git")
        ? Buffer.from("main\n")
        : (childProcess.execFileSync as (...args: unknown[]) => unknown)(
            cmd,
            args,
            opts,
          )) as never),
    spyOn(childProcess, "execSync").mockImplementation(((cmd: unknown, opts: unknown) =>
      String(cmd).includes("git")
        ? Buffer.from("main\n")
        : (childProcess.execSync as (...args: unknown[]) => unknown)(cmd, opts)) as never),
    spyOn(childProcess, "execFile").mockImplementation(((
      cmd: unknown,
      args: unknown,
      optionsOrCallback: unknown,
      callback?: unknown,
    ) => {
      const cb = typeof optionsOrCallback === "function" ? optionsOrCallback : callback;
      const cmdStr = String(cmd);
      let stdout = "";
      if (cmdStr.includes("ps")) {
        stdout = `${process.pid} 1 ${process.pid}\n`;
      } else if (cmdStr.includes("git")) {
        stdout = "main\n";
      }
      if (typeof cb === "function") {
        queueMicrotask(() => {
          (cb as (err: Error | null, stdout: string, stderr: string) => void)(null, stdout, "");
        });
      }
      return {} as childProcess.ChildProcess;
    }) as never),
    spyOn(
      Bun as unknown as Record<string, (...args: unknown[]) => unknown>,
      "spawn" as never,
    ).mockImplementation(((options: { cmd?: string[] }) => {
      const outText =
        options.cmd?.[0] === "ps"
          ? `${process.pid} 1 ${process.pid}\n`
          : options.cmd?.[0] === "echo"
            ? options.cmd.slice(1).join(" ") + "\n"
            : "main\n";
      const isSleep = options.cmd?.[0] === "sleep";
      let resolveExit: ((code: number) => void) | undefined;
      const exitedPromise = new Promise<number>((resolve) => {
        resolveExit = resolve;
        if (!isSleep) resolve(0);
      });
      const killHandlers = ((
        globalThis as unknown as Record<string, unknown>
      ).__virtualFsKillHandlers ??= new Map<number, () => void>()) as Map<number, () => void>;
      killHandlers.set(999999, () => resolveExit?.(143));
      return {
        pid: 999999,
        exited: exitedPromise,
        stdout: new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode(outText));
            c.close();
          },
        }),
        stderr: new ReadableStream({
          start(c) {
            c.close();
          },
        }),
        kill: () => {
          resolveExit?.(143);
        },
        ref: () => {},
        unref: () => {},
      };
    }) as never),
    spyOn(nativeRename, "renameNoReplace").mockImplementation(((
      src: string,
      dst: string,
      label: string,
    ) => {
      const srcStr = normPath(src);
      const dstStr = normPath(dst);
      if (vfs.existsSync(dstStr) || state.symlinks.has(dstStr))
        throw new HarnessError("INVALID_STATE", `${label} destination already exists`);
      if (!vfs.existsSync(srcStr) && !state.symlinks.has(srcStr))
        throw new HarnessError("INVALID_STATE", `${label} rename failed with errno 2`);
      mockRename(state, srcStr, dstStr);
    }) as never),
    spyOn(nativeRename, "exchangePaths").mockImplementation(((
      l: string,
      r: string,
      label: string,
    ) => {
      const ls = normPath(l);
      const rs = normPath(r);
      if (!vfs.existsSync(ls) || !vfs.existsSync(rs))
        throw new HarnessError("INVALID_STATE", `${label} rename failed with errno 2`);
      const tmp = `${ls}.tmp-${Date.now()}`;
      mockRename(state, ls, tmp);
      mockRename(state, rs, ls);
      mockRename(state, tmp, rs);
    }) as never),
    spyOn(process, "cwd").mockImplementation(() => state.vfs.cwd()),
    spyOn(process, "chdir").mockImplementation(((dir: string) => {
      state.vfs.chdir(String(dir));
    }) as never),
    spy("watch", (_target: unknown, optionsOrCallback: unknown, maybeCallback?: unknown) => {
      const cb =
        typeof optionsOrCallback === "function"
          ? (optionsOrCallback as (event: string, filename: string) => void)
          : (maybeCallback as (event: string, filename: string) => void);
      watcherHolder.activeWatcherCallback = cb;
      return {
        close: () => {
          if (watcherHolder.activeWatcherCallback === cb) {
            watcherHolder.activeWatcherCallback = undefined;
          }
        },
        ref: () => {},
        unref: () => {},
        on: () => {},
        once: () => {},
        emit: () => false,
      } as unknown as fs.FSWatcher;
    }),
  ];
}

import { spyOn } from "bun:test";
import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as flockFfi from "../../../olt/scripts/src/platform/fs/flock-ffi.ts";
import * as platform from "../../../olt/scripts/src/platform/index.ts";

export function handleSpawnSync(
  _cmd: string,
  args?: readonly string[],
  opts?: unknown,
): childProcess.SpawnSyncReturns<Buffer> {
  const argvStr = Array.isArray(args) ? args.join(" ") : "";
  if (argvStr.includes("-z")) {
    return {
      status: 0,
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
      pid: 12345,
      output: [null, Buffer.alloc(0), Buffer.alloc(0)],
      signal: null,
      error: undefined,
    } as unknown as childProcess.SpawnSyncReturns<Buffer>;
  }
  let repo =
    typeof opts === "object" && opts !== null && typeof (opts as { cwd?: string }).cwd === "string"
      ? (opts as { cwd: string }).cwd
      : "/virtual/repo";
  if (Array.isArray(args)) {
    const cIdx = args.indexOf("-C");
    if (cIdx >= 0 && args[cIdx + 1]) repo = String(args[cIdx + 1]);
  }
  let stdoutText = "main\n";
  if (argvStr.includes("--is-inside-work-tree")) stdoutText = "true\n";
  else if (argvStr.includes("--git-path") && argvStr.includes("config.worktree"))
    stdoutText = ".git/config.worktree\n";
  else if (
    argvStr.includes("--git-dir") ||
    argvStr.includes("--git-common-dir") ||
    argvStr.includes("--absolute-git-dir")
  )
    stdoutText = `${repo}/.git\n`;
  else if (argvStr.includes("--show-toplevel")) stdoutText = `${repo}\n`;
  else if (argvStr.includes("rev-parse") || argvStr.includes("symbolic-ref"))
    stdoutText = "0".repeat(40) + "\n";

  return {
    status: 0,
    stdout: Buffer.from(stdoutText),
    stderr: Buffer.alloc(0),
    pid: 12345,
    output: [null, Buffer.from(stdoutText), Buffer.alloc(0)],
    signal: null,
    error: undefined,
  } as unknown as childProcess.SpawnSyncReturns<Buffer>;
}

export function createFspSpies(core: {
  statSpy: { getMockImplementation: () => Parameters<typeof fs.statSync>[0] | undefined };
  lstatSpy: { getMockImplementation: () => Parameters<typeof fs.lstatSync>[0] | undefined };
  mkdirSpy: { getMockImplementation: () => Parameters<typeof fs.mkdirSync>[0] | undefined };
  writeFileSpy: { getMockImplementation: () => Parameters<typeof fs.writeFileSync>[0] | undefined };
  readFileSpy: { getMockImplementation: () => Parameters<typeof fs.readFileSync>[0] | undefined };
  rmSpy: { getMockImplementation: () => Parameters<typeof fs.rmSync>[0] | undefined };
}) {
  return [
    spyOn(fsp, "lstat").mockImplementation(async (p, opts) =>
      (core.lstatSpy.getMockImplementation() as unknown as typeof fs.lstatSync)(
        p as unknown as fs.PathLike,
        opts as Parameters<typeof fs.lstatSync>[1],
      ),
    ),
    spyOn(fsp, "stat").mockImplementation(async (p, opts) =>
      (core.statSpy.getMockImplementation() as unknown as typeof fs.statSync)(
        p as unknown as fs.PathLike,
        opts as Parameters<typeof fs.statSync>[1],
      ),
    ),
    spyOn(fsp, "mkdir").mockImplementation(async (p, opts) =>
      (core.mkdirSpy.getMockImplementation() as unknown as typeof fs.mkdirSync)(
        p as unknown as fs.PathLike,
        opts as Parameters<typeof fs.mkdirSync>[1],
      ),
    ),
    spyOn(fsp, "writeFile").mockImplementation(async (p, data, opts) =>
      (core.writeFileSpy.getMockImplementation() as unknown as typeof fs.writeFileSync)(
        p as unknown as fs.PathLike,
        data as unknown as string,
        opts as Parameters<typeof fs.writeFileSync>[2],
      ),
    ),
    spyOn(fsp, "readFile").mockImplementation(
      async (p, opts) =>
        (core.readFileSpy.getMockImplementation() as unknown as typeof fs.readFileSync)(
          p as unknown as fs.PathLike,
          opts as Parameters<typeof fs.readFileSync>[1],
        ) as unknown as Buffer,
    ),
    spyOn(fsp, "rm").mockImplementation(async (p, opts) =>
      (core.rmSpy.getMockImplementation() as unknown as typeof fs.rmSync)(
        p as unknown as fs.PathLike,
        opts as Parameters<typeof fs.rmSync>[1],
      ),
    ),
    spyOn(fsp, "realpath").mockImplementation(async (p) => String(p)),
  ];
}

export function createProcessSpies() {
  return [
    spyOn(childProcess, "spawnSync").mockImplementation(handleSpawnSync),
    spyOn(flockFfi, "tryExclusiveFlock").mockReturnValue(true),
    spyOn(flockFfi, "releaseFlock").mockImplementation(() => {}),
    spyOn(platform, "tryExclusiveFlock").mockReturnValue(true),
    spyOn(platform, "releaseFlock").mockImplementation(() => {}),
  ];
}

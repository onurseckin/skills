import * as ffiModule from "bun:ffi";
import { readFileSync } from "node:fs";
import { HarnessError } from "../core/errors/harness-error.ts";

const EINTR = 4;
const EEXIST = 17;
const AT_FDCWD = -100;
const RENAME_NOREPLACE = 1;
const RENAME_EXCHANGE = 2;
const RENAME_EXCL = 4;

type NativeFunction = (...arguments_: unknown[]) => number | bigint;

interface RenameBindings {
  rename: NativeFunction;
  errno: NativeFunction;
  kind: "darwin" | "linux";
  handle: unknown;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function candidates(): string[] {
  if (process.platform === "darwin") return ["/usr/lib/libSystem.B.dylib"];
  if (process.platform !== "linux")
    throw new HarnessError(
      "UNSUPPORTED_PLATFORM",
      `atomic installer rename is unsupported on ${process.platform}`,
    );
  let maps = "";
  try {
    maps = readFileSync("/proc/self/maps", "utf8");
  } catch {}
  const loaded = [...maps.matchAll(/\s(\/\S*\/libc(?:-[^/\s]+)?\.so(?:\.\d+)*)\s*$/gm)].map(
    (match) => match[1]!,
  );
  const machine =
    process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "x86_64" : process.arch;
  return unique([
    ...loaded,
    "libc.so.6",
    `/lib/${machine}-linux-gnu/libc.so.6`,
    `/usr/lib/${machine}-linux-gnu/libc.so.6`,
    `/lib/libc.musl-${machine}.so.1`,
    `/usr/lib/libc.musl-${machine}.so.1`,
    "libc.so",
  ]);
}

function loadBindings(): RenameBindings {
  const ffi = ffiModule as unknown as {
    FFIType: { i32: "i32"; ptr: "ptr" };
    dlopen(
      path: string,
      symbols: Record<string, unknown>,
    ): {
      symbols: Record<string, NativeFunction>;
    };
  };
  const errnoName = process.platform === "darwin" ? "__error" : "__errno_location";
  const renameName = process.platform === "darwin" ? "renamex_np" : "renameat2";
  const renameArgs =
    process.platform === "darwin"
      ? [ffi.FFIType.ptr, ffi.FFIType.ptr, ffi.FFIType.i32]
      : [ffi.FFIType.i32, ffi.FFIType.ptr, ffi.FFIType.i32, ffi.FFIType.ptr, ffi.FFIType.i32];
  let lastError: unknown;
  for (const path of candidates()) {
    try {
      const library = ffi.dlopen(path, {
        [renameName]: { args: renameArgs, returns: ffi.FFIType.i32 },
        [errnoName]: { args: [], returns: ffi.FFIType.ptr },
      });
      return {
        rename: library.symbols[renameName]!,
        errno: library.symbols[errnoName]!,
        kind: process.platform as "darwin" | "linux",
        handle: library,
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw new HarnessError(
    "UNSUPPORTED_PLATFORM",
    `could not load atomic installer rename support: ${String(lastError)}`,
  );
}

const bindings = loadBindings();

function errno(): number {
  const ffi = ffiModule as unknown as { read: { i32(pointer: number | bigint): number } };
  return ffi.read.i32(bindings.errno() as number | bigint);
}

function invoke(source: string, destination: string, flag: number, label: string): void {
  const from = Buffer.from(`${source}\0`);
  const to = Buffer.from(`${destination}\0`);
  for (;;) {
    const result =
      bindings.kind === "darwin"
        ? bindings.rename(from, to, flag)
        : bindings.rename(AT_FDCWD, from, AT_FDCWD, to, flag);
    if (result === 0) return;
    const code = errno();
    if (code === EINTR) continue;
    const detail =
      code === EEXIST ? "destination already exists" : `rename failed with errno ${code}`;
    throw new HarnessError("INVALID_STATE", `${label} ${detail}`);
  }
}

export function renameNoReplace(source: string, destination: string, label: string): void {
  invoke(source, destination, bindings.kind === "darwin" ? RENAME_EXCL : RENAME_NOREPLACE, label);
}

export function exchangePaths(left: string, right: string, label: string): void {
  invoke(left, right, RENAME_EXCHANGE, label);
}

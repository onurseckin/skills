import { dlopen, FFIType, read } from "bun:ffi";
import { readFileSync } from "node:fs";
import { HarnessError } from "../errors/harness-error.ts";

const LOCK_EX = 2;
const LOCK_NB = 4;
const LOCK_UN = 8;

const EINTR = 4;

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export function linuxLibcCandidates(architecture: string, mapsText = ""): string[] {
  const loaded = [...mapsText.matchAll(/\s(\/\S*\/libc(?:-[^/\s]+)?\.so(?:\.\d+)*)\s*$/gm)].map(
    (match) => match[1]!,
  );
  const machine =
    architecture === "arm64" ? "aarch64" : architecture === "x64" ? "x86_64" : architecture;
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

function libraryCandidates(): string[] {
  if (process.platform === "darwin") return ["/usr/lib/libSystem.B.dylib"];
  if (process.platform === "linux") {
    let maps = "";
    try {
      maps = readFileSync("/proc/self/maps", "utf8");
    } catch {
      // Candidate fallbacks below remain valid when procfs is unavailable.
    }
    return linuxLibcCandidates(process.arch, maps);
  }
  throw new HarnessError(
    "UNSUPPORTED_PLATFORM",
    `inode-bound flock is unsupported on ${process.platform}`,
  );
}

type NativeFunction = (...arguments_: number[]) => number | bigint;

interface FlockBindings {
  flock: NativeFunction;
  errno: () => number | bigint;
  handle: unknown;
}

function loadBindings(): FlockBindings {
  const errnoName = process.platform === "darwin" ? "__error" : "__errno_location";
  let lastError: unknown;
  for (const path of libraryCandidates()) {
    try {
      const library = dlopen(path, {
        flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
        [errnoName]: { args: [], returns: FFIType.ptr },
      });
      const symbols = library.symbols as Record<string, NativeFunction>;
      return { flock: symbols.flock!, errno: symbols[errnoName]!, handle: library };
    } catch (error) {
      lastError = error;
    }
  }
  throw new HarnessError(
    "UNSUPPORTED_PLATFORM",
    `could not load a libc flock implementation: ${String(lastError)}`,
  );
}

const bindings = loadBindings();

function lastErrno(): number {
  return read.i32(bindings.errno());
}

function wouldBlock(errno: number): boolean {
  return errno === (process.platform === "darwin" ? 35 : 11);
}

export function tryExclusiveFlock(descriptor: number): boolean {
  for (;;) {
    if (bindings.flock(descriptor, LOCK_EX | LOCK_NB) === 0) return true;
    const errno = lastErrno();
    if (errno === EINTR) continue;
    if (wouldBlock(errno)) return false;
    throw new HarnessError("INVALID_STATE", `flock acquisition failed with errno ${errno}`);
  }
}

export function releaseFlock(descriptor: number): void {
  for (;;) {
    if (bindings.flock(descriptor, LOCK_UN) === 0) return;
    const errno = lastErrno();
    if (errno !== EINTR) {
      throw new HarnessError("INVALID_STATE", `flock release failed with errno ${errno}`);
    }
  }
}

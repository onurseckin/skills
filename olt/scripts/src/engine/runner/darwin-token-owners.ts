import * as ffi from "bun:ffi";
import { HarnessError } from "../../core/errors/index.ts";
import type { ProcessIdentity } from "./process-identity.ts";

const CTL_KERN = 1;
const KERN_PROCARGS2 = 49;
const MAX_PROCESS_ARGUMENT_BYTES = 16 * 1024 * 1024;
const MAX_TOKEN_SCAN_BYTES = 64 * 1024 * 1024;
const OWNERSHIP_ENV = "HARNESS_INTERNAL_OWNERSHIP_TOKEN";

type Pointer = number | bigint;
type Native = (...arguments_: Array<number | bigint>) => number | bigint;

let loadedSysctl:
  | { call: Native; pointer: (buffer: Uint8Array) => Pointer; handle: unknown }
  | undefined;

function sysctlNative(): NonNullable<typeof loadedSysctl> {
  if (loadedSysctl) return loadedSysctl;
  const runtime = ffi as unknown as {
    FFIType: Record<string, string>;
    ptr: (buffer: Uint8Array) => Pointer;
  };
  const types = runtime.FFIType;
  const handle = ffi.dlopen("/usr/lib/libSystem.B.dylib", {
    sysctl: {
      args: [types.ptr, types.u32, types.ptr, types.ptr, types.ptr, types.usize],
      returns: types.i32,
    },
  });
  loadedSysctl = {
    call: (handle.symbols as unknown as Record<string, Native>).sysctl!,
    pointer: runtime.ptr,
    handle,
  };
  return loadedSysctl;
}

export function processHasToken(pid: number, token: string, budget: { bytes: number }): boolean {
  if (!token) return false;
  const native = sysctlNative();
  const mib = Buffer.alloc(12);
  mib.writeInt32LE(CTL_KERN, 0);
  mib.writeInt32LE(KERN_PROCARGS2, 4);
  mib.writeInt32LE(pid, 8);
  const size = Buffer.alloc(8);
  if (Number(native.call(native.pointer(mib), 3, 0, native.pointer(size), 0, 0)) !== 0)
    return false;
  const byteLength = Number(size.readBigUInt64LE());
  if (
    !Number.isSafeInteger(byteLength) ||
    byteLength <= 4 ||
    byteLength > MAX_PROCESS_ARGUMENT_BYTES
  )
    return false;
  budget.bytes += byteLength;
  if (budget.bytes > MAX_TOKEN_SCAN_BYTES)
    throw new HarnessError("INVALID_STATE", "ownership-token environment scan is too large");
  const bytes = Buffer.alloc(byteLength);
  if (
    Number(
      native.call(native.pointer(mib), 3, native.pointer(bytes), native.pointer(size), 0, 0),
    ) !== 0
  )
    return false;
  return bytes.includes(Buffer.from(`${OWNERSHIP_ENV}=${token}\0`));
}

function sameIdentity(left: ProcessIdentity | undefined, right: ProcessIdentity | undefined) {
  return Boolean(left && right && left.pid === right.pid && left.birth === right.birth);
}

export function scanDarwinTokenOwners(
  pids: number[],
  token: string,
  identify: (pid: number) => ProcessIdentity | undefined,
): ProcessIdentity[] {
  if (!token) return [];
  const budget = { bytes: 0 };
  const owners: ProcessIdentity[] = [];
  for (const pid of pids) {
    if (pid === process.pid) continue;
    const before = identify(pid);
    if (!before) continue;
    let hasToken: boolean;
    try {
      hasToken = processHasToken(pid, token, budget);
    } catch (error) {
      const after = identify(pid);
      if (!after) continue;
      if (!sameIdentity(before, after))
        throw new HarnessError(
          "INVALID_STATE",
          `process identity changed during ownership-token scan for pid ${pid}`,
        );
      throw error;
    }
    const after = identify(pid);
    if (!after) continue;
    if (!sameIdentity(before, after))
      throw new HarnessError(
        "INVALID_STATE",
        `process identity changed during ownership-token scan for pid ${pid}`,
      );
    if (hasToken) owners.push(after);
  }
  return owners;
}
